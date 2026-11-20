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
import { AIService } from './modules/ai-generator/ai.service';
import { MedicalDocumentParser } from './modules/documents/parsers/pdf.parser';
import { AttemptsService } from './modules/attempts/attempts.service';
import { BackupService } from './modules/backup/backup.service';
import { StudyService } from './modules/study/study.service';
import { ExportService } from './modules/export/export.service';
import { SummariesService } from './modules/summaries/summaries.service';
import { registerDocumentRoutes } from './routes/documents.routes';
import { registerQuestionRoutes } from './routes/questions.routes';
import { registerQuizRoutes } from './routes/quizzes.routes';
import { registerAttemptRoutes } from './routes/attempts.routes';
import { registerSettingsRoutes } from './routes/settings.routes';
import { registerBackupRoutes } from './routes/backup.routes';
import { registerStudyRoutes } from './routes/study.routes';
import { registerExportRoutes } from './routes/export.routes';
import { registerSummariesRoutes } from './routes/summaries.routes';

// Văn bản trích xuất từ file lớn (giáo trình vài trăm trang) có thể rất dài.
// Giới hạn theo ký tự phải đi kèm trần body JSON, nếu không request sẽ bị chặn
// ở tầng body trước khi handler kịp báo lỗi rõ ràng. Tỉ lệ ~3 byte/ký tự UTF-8.
const JSON_BODY_LIMIT = 96 * 1024 * 1024;
const UPLOAD_BODY_LIMIT = env.MAX_FILE_SIZE_MB * 1024 * 1024 + 1024 * 1024;

const DEV_ORIGIN_HOSTS = new Set(['localhost:5273', '127.0.0.1:5273']);

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

export interface BuildAppOptions {
  /** Tắt rate limit khi chạy test để test độc lập nhau */
  disableRateLimit?: boolean;
}

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
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
  const studyService = new StudyService();
  const exportService = new ExportService();
  const summariesService = new SummariesService();

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

  // Đăng ký các nhóm route
  registerDocumentRoutes(app, docParser);
  registerQuestionRoutes(app, aiService, docParser, JSON_BODY_LIMIT);
  registerQuizRoutes(app, attemptsService);
  registerAttemptRoutes(app, attemptsService);
  registerSettingsRoutes(app);
  registerBackupRoutes(app, backupService, JSON_BODY_LIMIT);
  registerStudyRoutes(app, studyService);
  registerExportRoutes(app, exportService);
  registerSummariesRoutes(app, summariesService, exportService);

  // ============================================================================
  // PHỤC VỤ GIAO DIỆN TĨNH (bản web/desktop đã build)
  // ============================================================================
  const clientDistPath =
    process.env.CLIENT_DIST_PATH ||
    (fs.existsSync(path.join(__dirname, '..', 'client', 'dist'))
      ? path.join(__dirname, '..', 'client', 'dist')
      : path.join(process.cwd(), 'client', 'dist'));
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
        error: {
          code: 413,
          message: `Dung lượng dữ liệu gửi lên quá lớn (tối đa ${Math.round(JSON_BODY_LIMIT / 1024 / 1024)}MB).`
        }
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

    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        success: false,
        error: { code: statusCode, message: error.message }
      });
    }

    return reply.status(500).send({
      success: false,
      error: { code: 500, message: 'Lỗi hệ thống máy chủ nội bộ.' }
    });
  });

  return app;
}

export { NotFoundError, isLoopbackHost };
