import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fs from 'fs';
import path from 'path';
import { AppError, NotFoundError } from './core/errors';
import { env, isLoopbackHost } from './config/env.config';
import { pingDatabase } from './core/database/db';
import { registerAuth } from './core/security/auth';
import {
  checkAnswerBodySchema,
  createQuizBodySchema,
  generateBodySchema,
  parseOrThrow,
  submitBodySchema,
  updateQuizBodySchema,
  uuidParamsSchema
} from './core/validation/schemas';
import { AIService, GeneratedQuestionItem } from './modules/ai-generator/ai.service';
import { MedicalDocumentParser } from './modules/documents/parsers/pdf.parser';
import { AttemptsService } from './modules/attempts/attempts.service';
import { settingsStore } from './modules/settings/settings.store';
import { providerConfigSchema, PROVIDER_META } from './modules/settings/settings.types';
import { createProviderBodySchema, updateAISettingsBodySchema, updateProviderBodySchema } from './modules/settings/settings.requests';
import { beginChatGPTLogin, getChatGPTLoginStatus } from './modules/settings/oauth.server';
import { createProvider } from './modules/ai-generator/providers/factory';
import { BackupService } from './modules/backup/backup.service';
import { randomUUID } from 'crypto';



// Văn bản trích xuất từ file lớn (giáo trình vài trăm trang) có thể rất dài.
// Giới hạn theo ký tự phải đi kèm trần body JSON, nếu không request sẽ bị chặn
// ở tầng body trước khi handler kịp báo lỗi rõ ràng. Tỉ lệ ~3 byte/ký tự UTF-8.
const MAX_TEXT_CONTENT_CHARS = 30 * 1024 * 1024;
const JSON_BODY_LIMIT = 96 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = env.MAX_FILE_SIZE_MB * 1024 * 1024 + 1024 * 1024;

/**
 * Origin được coi là "của chính ứng dụng".
 * Bản web dev chạy Vite ở cổng 5273 và proxy sang backend, nên Origin mà trình duyệt
 * gửi tới không trùng Host mà backend nhìn thấy — phải cho phép tường minh, nhưng
 * CHỈ trong môi trường development.
 */
function isTrustedOrigin(origin: string | undefined, host: string): boolean {
  if (!origin) return true; // điều hướng trực tiếp, không phải request do script trang khác phát
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (originHost === host) return true;
  if (env.NODE_ENV === 'development') {
    return DEV_ORIGIN_HOSTS.has(originHost);
  }
  return false;
}

const DEV_ORIGIN_HOSTS = new Set(['localhost:5273', '127.0.0.1:5273']);

export interface BuildAppOptions {
  /** Tắt rate limit khi chạy test để test độc lập nhau */
  disableRateLimit?: boolean;
}

/**
 * Giới hạn tốc độ theo route. Mặc định toàn cục rất chặt vì đây là app cục bộ một người dùng.
 * Riêng /generate chỉ cho 10 request/5 phút: mỗi request đốt quota Gemini và chạy lâu.
 */
function registerRateLimits(app: FastifyInstance, enable: boolean): void {
  if (!enable) return;

  app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: () => 'local'
  });
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = fastify({
    bodyLimit: UPLOAD_BODY_LIMIT,
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' }
  });

  app.register(helmet, { contentSecurityPolicy: false });

  // CORS: chỉ cho phép khi chạy dev (Vite ở :5273). Bản build giao diện chạy cùng origin nên không cần CORS.
  if (env.NODE_ENV === 'development') {
    app.register(cors, {
      origin: [/^http:\/\/localhost:5273$/, /^http:\/\/127\.0\.0\.1:5273$/],
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['content-type', 'x-app-token']
    });
  }

  registerAuth(app, env.APP_AUTH_TOKEN);
  registerRateLimits(app, !options.disableRateLimit);

  app.register(multipart, {
    limits: {
      fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024,
      files: 1,
      fields: 5,
      parts: 10
    }
  });

  const aiService = new AIService();
  const docParser = new MedicalDocumentParser();
  const attemptsService = new AttemptsService();
  const backupService = new BackupService();


  // Healthcheck: báo trạng thái DB thật thay vì luôn "ok"
  app.get('/health', async (req, reply) => {
    const startedAt = Date.now();
    let database: 'up' | 'down' = 'up';
    try {
      await pingDatabase();
    } catch (err) {
      database = 'down';
      req.log.error(err, 'Health check: không kết nối được cơ sở dữ liệu');
    }

    const payload = {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptime_seconds: Math.round(process.uptime()),
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    };
    return reply.status(database === 'up' ? 200 : 503).send(payload);
  });

  // Cấu hình công khai cho giao diện. Nằm NGOÀI /api/ nên không bị hook xác thực chặn
  // (nếu chặn thì giao diện không có cách nào lấy token để gọi API — bài toán con gà quả trứng).
  //
  // Bảo vệ: chỉ trả token cho request cùng origin. Request do JavaScript ở trang khác
  // origin luôn kèm header Origin, nên bị từ chối ở đây — đúng mối đe dọa mà x-app-token
  // sinh ra để chặn (CSRF / DNS rebinding). Điều hướng trực tiếp trên thanh địa chỉ
  // (không có Origin) vẫn đọc được, nhưng đó là người dùng thật, không phải trang web lạ.
  app.get('/app-config.json', async (req, reply) => {
    reply.header('cache-control', 'no-store');

    if (!isTrustedOrigin(req.headers.origin, req.headers.host ?? '')) {
      return reply.status(403).send({
        success: false,
        error: { code: 403, message: 'Không cho phép đọc cấu hình từ origin khác.' }
      });
    }

    return reply.send({
      success: true,
      data: { authToken: env.APP_AUTH_TOKEN, maxFileSizeMb: env.MAX_FILE_SIZE_MB }
    });
  });

  // ============================================================================
  // 1. TẢI LÊN & TRÍCH XUẤT TÀI LIỆU
  // ============================================================================
  app.post('/api/v1/documents/upload', async (req, reply) => {
    if (!req.isMultipart()) {
      throw new AppError('Yêu cầu phải ở dạng multipart/form-data.', 415);
    }

    const data = await req.file();
    if (!data) {
      throw new AppError('Không tìm thấy file tải lên.', 400);
    }

    // Đọc vào bộ nhớ có giới hạn: file không bao giờ chạm đĩa nên không rò rỉ tài liệu y khoa
    // của người dùng và không cần dọn thư mục uploads.
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err: any) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE' || err?.statusCode === 413) {
        throw new AppError(`File vượt quá giới hạn ${env.MAX_FILE_SIZE_MB}MB.`, 413);
      }
      throw new AppError('Không thể đọc file tải lên.', 400);
    }

    const parsed = await docParser.extractText(buffer, data.filename);
    docParser.assertUsableText(parsed.cleanText);

    return reply.status(201).send({
      success: true,
      data: {
        filename: data.filename,
        page_count: parsed.pageCount,
        text_length: parsed.cleanText.length,
        preview_text: parsed.cleanText
      }
    });
  });

  // ============================================================================
  // 2. SINH CÂU HỎI VỚI AI (song song có giới hạn, có timeout & retry trong AIService)
  // ============================================================================
  app.post('/api/v1/questions/generate', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    bodyLimit: JSON_BODY_LIMIT,
    handler: async (req, reply) => {
      const body = parseOrThrow(generateBodySchema, req.body);
      if (body.text_content.length > MAX_TEXT_CONTENT_CHARS) {
        throw new AppError('Nội dung tài liệu quá lớn để xử lý.', 413);
      }

      const targetCount = body.target_count;
      const BATCH_SIZE = 25;
      // Tăng song song 2 -> 4: mỗi batch là một request mạng độc lập, chờ đợi chủ
      // yếu là độ trễ của nhà cung cấp AI. Tăng song song cắt thời gian gần như
      // theo bậc mà không đổi chất lượng — vẫn mỗi đoạn văn bản một batch riêng.
      // 4 là mức an toàn cho hạn mức phổ biến của Gemini/OpenAI ở gói miễn phí/cơ bản.
      const MAX_CONCURRENCY = 4;
      const numBatches = Math.ceil(targetCount / BATCH_SIZE);
      const chunks = docParser.splitIntoChunks(body.text_content, numBatches);

      // Mỗi batch dùng một đoạn văn bản riêng: tránh việc tài liệu ngắn bị gửi lặp
      // nhiều lần dẫn đến câu hỏi trùng lặp. Nếu số đoạn ít hơn số batch thì dừng.
      const usableBatches = Math.min(numBatches, chunks.length);
      const batchJobs: Array<{ chunk: string; count: number }> = [];
      let remaining = targetCount;
      for (let i = 0; i < usableBatches && remaining > 0; i++) {
        const count = Math.min(BATCH_SIZE, remaining);
        batchJobs.push({ chunk: chunks[i], count });
        remaining -= count;
      }

      const results: GeneratedQuestionItem[][] = [];
      for (let start = 0; start < batchJobs.length; start += MAX_CONCURRENCY) {
        const group = batchJobs.slice(start, start + MAX_CONCURRENCY);
        const groupResults = await Promise.all(
          group.map((job) =>
            aiService.generateBatch(
              job.chunk,
              job.count,
              body.subject_name,
              body.difficulty_mode,
              body.question_types
            )
          )
        );
        results.push(...groupResults);
      }

      // Kiểm chứng chống bịa: mỗi câu phải có đoạn trích dẫn xuất hiện thật trong
      // tài liệu gốc. Loại câu không qua được kiểm chứng thay vì trả về đề có thể sai.
      const { kept, droppedReasons } = verifyGrounding(results.flat(), body.text_content);

      const questions = dedupeQuestions(kept).slice(0, targetCount);
      if (droppedReasons.length > 0) {
        req.log.warn(
          { dropped: droppedReasons.length, total: results.flat().length },
          'Đã loại câu hỏi không có căn cứ trong tài liệu'
        );
      }
      if (questions.length === 0) {
        throw new AppError(
          results.flat().length > 0
            ? 'AI sinh được câu hỏi nhưng không câu nào trích dẫn được nguyên văn từ tài liệu, ' +
                'nên đã bị loại để tránh nội dung bịa đặt. Hãy thử lại hoặc dùng model mạnh hơn.'
            : 'AI không sinh được câu hỏi nào từ tài liệu này.',
          502
        );
      }

      return reply.send({
        success: true,
        data: {
          total_generated: questions.length,
          requested: targetCount,
          dropped_ungrounded: droppedReasons.length,
          questions
        }
      });
    }
  });

  // ============================================================================
  // 3. ĐỀ THI & PHÒNG THI
  // ============================================================================
  app.post('/api/v1/quizzes', async (req, reply) => {
    const body = parseOrThrow(createQuizBodySchema, req.body);

    const quiz = await attemptsService.createQuizFromQuestions({
      title: body.title || `Đề thi ${body.subject_name}`,
      subjectName: body.subject_name,
      mode: body.mode,
      instantFeedback: body.instant_feedback,
      questions: body.questions
    });
    return reply.status(201).send({ success: true, data: quiz });
  });

  app.post('/api/v1/quizzes/:id/start', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const attemptData = await attemptsService.startAttempt(id);
    return reply.send({ success: true, data: attemptData });
  });

  app.post('/api/v1/attempts/:id/submit', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(submitBodySchema, req.body);

    const result = await attemptsService.submitAttempt(id, body.answers);
    return reply.send({ success: true, data: result });
  });

  // Chấm tức thì MỘT câu để giao diện hiện đúng/sai + giải thích ngay khi người dùng chọn.
  // Cố ý không ghi CSDL: điểm chính thức chỉ chốt ở /submit.
  app.post('/api/v1/attempts/:id/check', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(checkAnswerBodySchema, req.body);

    const result = await attemptsService.checkAnswer(id, {
      question_id: body.question_id,
      selected_option_id: body.selected_option_id ?? null,
      response: body.response ?? null
    });
    return reply.send({ success: true, data: result });
  });

  app.get('/api/v1/attempts/:id/review', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const review = await attemptsService.reviewAttempt(id);
    return reply.send({ success: true, data: review });
  });

  app.get('/api/v1/attempts/history', async (req, reply) => {
    const history = await attemptsService.getHistory();
    return reply.send({ success: true, data: history });
  });

  // ----------------------------------------------------------------------------
  // Danh mục môn học & thư viện đề thi (Phòng thi): mỗi môn có các đề thi đã lưu,
  // có thể sửa (đổi tên/đổi môn) hoặc xoá vĩnh viễn.
  // ----------------------------------------------------------------------------
  app.get('/api/v1/subjects', async (req, reply) => {
    const subjects = await attemptsService.listSubjects();
    return reply.send({ success: true, data: subjects });
  });

  app.get('/api/v1/subjects/:id/quizzes', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const data = await attemptsService.listQuizzesBySubject(id);
    return reply.send({ success: true, data });
  });

  app.patch('/api/v1/quizzes/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(updateQuizBodySchema, req.body);
    const quiz = await attemptsService.updateQuiz(id, {
      title: body.title,
      subjectName: body.subject_name
    });
    return reply.send({ success: true, data: quiz });
  });

  app.delete('/api/v1/quizzes/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    await attemptsService.deleteQuiz(id);
    return reply.send({ success: true, data: { deleted: true } });
  });

  // ============================================================================
  // 5. CÀI ĐẶT: NHÀ CUNG CẤP AI
  // ============================================================================
  app.get('/api/v1/settings', async (req, reply) => {
    return reply.send({ success: true, data: settingsStore.toPublic() });
  });

  app.patch('/api/v1/settings/ai', async (req, reply) => {
    const body = parseOrThrow(updateAISettingsBodySchema, req.body);
    const settings = settingsStore.updateAI(body);
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.post('/api/v1/settings/providers', async (req, reply) => {
    const body = parseOrThrow(createProviderBodySchema, req.body);
    const meta = PROVIDER_META[body.type];
    const provider = providerConfigSchema.parse({
      id: randomUUID(),
      type: body.type,
      label: body.label,
      model: body.model || meta.defaultModel,
      baseUrl: body.baseUrl ?? null,
      apiKey: body.apiKey ?? null,
      enabled: body.enabled,
      oauth: null,
      createdAt: new Date().toISOString()
    });
    const settings = settingsStore.upsertProvider(provider);
    return reply.status(201).send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.patch('/api/v1/settings/providers/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(updateProviderBodySchema, req.body);
    const current = settingsStore.get().providers.find((p) => p.id === id);
    if (!current) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);

    const updated = {
      ...current,
      ...body,
      // apiKey undefined = giữ nguyên; chuỗi rỗng/null = xoá khoá đang lưu
      apiKey: body.apiKey === undefined ? current.apiKey : body.apiKey || null,
      baseUrl: body.baseUrl === undefined ? current.baseUrl : body.baseUrl || null
    };
    const settings = settingsStore.upsertProvider(providerConfigSchema.parse(updated));
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.delete('/api/v1/settings/providers/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const settings = settingsStore.removeProvider(id);
    return reply.send({ success: true, data: settingsStore.toPublic(settings) });
  });

  app.post('/api/v1/settings/providers/:id/test', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const config = settingsStore.get().providers.find((p) => p.id === id);
    if (!config) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);

    const provider = createProvider(config);
    const result = await provider.testConnection();
    return reply.send({ success: true, data: result });
  });

  // Đăng nhập ChatGPT OAuth (thử nghiệm, xem oauth.service.ts)
  app.post('/api/v1/settings/providers/:id/oauth/start', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const config = settingsStore.get().providers.find((p) => p.id === id);
    if (!config) throw new AppError('Không tìm thấy nhà cung cấp AI này.', 404);
    if (config.type !== 'chatgpt-oauth') {
      throw new AppError('Nhà cung cấp này không dùng đăng nhập OAuth.', 400);
    }
    const { authorizeUrl } = await beginChatGPTLogin(id);
    return reply.send({ success: true, data: { authorizeUrl } });
  });

  app.get('/api/v1/settings/providers/:id/oauth/status', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const status = getChatGPTLoginStatus(id);
    return reply.send({ success: true, data: status });
  });

  // ============================================================================
  // 6. SAO LƯU & PHỤC HỒI DỮ LIỆU
  // ============================================================================
  app.get('/api/v1/backup/export', async (req, reply) => {
    const payload = await backupService.exportAll();
    const filename = `medquiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send({ success: true, data: payload });
  });

  app.get('/api/v1/backup/counts', async (req, reply) => {
    const counts = await backupService.currentCounts();
    return reply.send({ success: true, data: counts });
  });

  app.post('/api/v1/backup/preview', {
    bodyLimit: JSON_BODY_LIMIT,
    handler: async (req, reply) => {
      const summary = await backupService.previewPayload(req.body);
      return reply.send({ success: true, data: summary });
    }
  });

  app.post('/api/v1/backup/restore', {
    bodyLimit: JSON_BODY_LIMIT,
    handler: async (req, reply) => {
      const result = await backupService.restoreAll(req.body);
      return reply.send({ success: true, data: result });
    }
  });

  // ============================================================================
  // 4. PHỤC VỤ GIAO DIỆN TĨNH (bản web/desktop đã build)
  // ============================================================================
  const clientDistPath = path.join(process.cwd(), 'client', 'dist');
  if (fs.existsSync(clientDistPath)) {
    app.register(fastifyStatic, {
      root: clientDistPath,
      prefix: '/',
      wildcard: false
    });

    app.setNotFoundHandler((req, reply) => {
      if (!req.raw.url?.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({
        success: false,
        error: { code: 404, message: 'API Endpoint không tồn tại.' }
      });
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      return reply.status(404).send({
        success: false,
        error: { code: 404, message: 'API Endpoint không tồn tại.' }
      });
    });
  }

  // ============================================================================
  // Error handler
  // ============================================================================
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        success: false,
        error: { code: error.statusCode, message: error.message }
      });
    }

    const code = (error as any).code as string | undefined;
    const statusCode = (error as any).statusCode as number | undefined;

    if (code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.status(413).send({
        success: false,
        error: { code: 413, message: `Dung lượng dữ liệu gửi lên quá lớn (tối đa ${Math.round(JSON_BODY_LIMIT / 1024 / 1024)}MB).` }
      });
    }

    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({
        success: false,
        error: { code: 413, message: `File vượt quá giới hạn ${env.MAX_FILE_SIZE_MB}MB.` }
      });
    }

    if (statusCode === 429) {
      return reply.status(429).send({
        success: false,
        error: { code: 429, message: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.' }
      });
    }

    // Lỗi 4xx do Fastify sinh ra (JSON hỏng -> 400, sai Content-Type -> 415...)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        success: false,
        error: { code: statusCode, message: error.message }
      });
    }

    // Lỗi không lường trước: chỉ ghi log ở server, không rò rỉ chi tiết cho client
    return reply.status(500).send({
      success: false,
      error: { code: 500, message: 'Lỗi hệ thống máy chủ nội bộ.' }
    });
  });

  return app;
}

/** Loại câu hỏi trùng nhau (AI đôi khi lặp lại câu ở các batch khác nhau) */
function dedupeQuestions(items: GeneratedQuestionItem[]): GeneratedQuestionItem[] {
  const seen = new Set<string>();
  const result: GeneratedQuestionItem[] = [];
  for (const item of items) {
    const key = normalize(item.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Kiểm chứng chống bịa đặt.
 *
 * Model được yêu cầu chép nguyên văn một đoạn tài liệu vào `source_quote`. Ở đây
 * ta kiểm tra đoạn đó có thật trong tài liệu gốc hay không. Model bịa câu hỏi thì
 * gần như luôn kèm một đoạn trích không tồn tại — hoặc không trích gì cả.
 *
 * Cách so khớp: chuẩn hoá cả hai bên (bỏ dấu, chữ thường, gộp khoảng trắng) rồi
 * tìm chuỗi con. Chuẩn hoá là bắt buộc vì model thường sửa nhẹ khoảng trắng, dấu
 * gạch nối và dấu tiếng Việt trong lúc chép lại.
 *
 * Ngưỡng: đoạn trích dưới `MIN_QUOTE_CHARS` ký tự không đủ bằng chứng (một cụm
 * 3 chữ như "tăng huyết áp" xuất hiện khắp tài liệu), nên bị coi như không có.
 */
const MIN_QUOTE_CHARS = 40;

function verifyGrounding(
  items: GeneratedQuestionItem[],
  sourceText: string
): { kept: GeneratedQuestionItem[]; droppedReasons: string[] } {
  const haystack = normalize(sourceText);
  const kept: GeneratedQuestionItem[] = [];
  const droppedReasons: string[] = [];

  for (const item of items) {
    const quote = (item.source_quote ?? '').trim();
    if (!quote) {
      droppedReasons.push('thiếu trích dẫn');
      continue;
    }
    if (quote.length < MIN_QUOTE_CHARS) {
      droppedReasons.push('trích dẫn quá ngắn');
      continue;
    }
    if (!haystack.includes(normalize(quote))) {
      droppedReasons.push('trích dẫn không có trong tài liệu');
      continue;
    }
    kept.push(item);
  }

  return { kept, droppedReasons };
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export { NotFoundError, isLoopbackHost };
