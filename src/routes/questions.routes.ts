import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError } from '../core/errors';
import { db } from '../core/database/db';
import { generateBodySchema, parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';
import { AIService, GeneratedQuestionItem } from '../modules/ai-generator/ai.service';
import { MedicalDocumentParser } from '../modules/documents/parsers/pdf.parser';

const updateQuestionBodySchema = z.object({
  content: z.string().min(3).optional(),
  difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  explanation: z.string().min(1).optional(),
  source_reference: z.string().nullable().optional(),
  options: z
    .array(
      z.object({
        option_id: z.string().uuid(),
        content: z.string().min(1),
        is_correct: z.boolean()
      })
    )
    .optional()
});

export const MAX_TEXT_CONTENT_CHARS = 30 * 1024 * 1024;

export function registerQuestionRoutes(
  app: FastifyInstance,
  aiService: AIService,
  docParser: MedicalDocumentParser,
  jsonBodyLimit: number
): void {
  // ============================================================================
  // 2. SINH CÂU HỎI VỚI AI (song song có giới hạn, có timeout & retry trong AIService)
  // ============================================================================
  app.post('/api/v1/questions/generate', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    bodyLimit: jsonBodyLimit,
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

  /** Chỉnh sửa nội dung / đáp án / giải thích của một câu hỏi đã lưu. */
  app.patch('/api/v1/questions/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(updateQuestionBodySchema, req.body);

    const existing = await db
      .selectFrom('questions')
      .select('id')
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    if (!existing) throw new NotFoundError('Không tìm thấy câu hỏi.');

    await db.transaction().execute(async (trx) => {
      const updates: Record<string, unknown> = { updated_at: new Date() };
      if (body.content !== undefined) updates.content = body.content;
      if (body.difficulty !== undefined) updates.difficulty = body.difficulty;
      if (body.explanation !== undefined) updates.explanation = body.explanation;
      if (body.source_reference !== undefined) updates.source_reference = body.source_reference;

      await trx.updateTable('questions').set(updates).where('id', '=', id).execute();

      if (body.options && body.options.length > 0) {
        for (const opt of body.options) {
          await trx
            .updateTable('question_options')
            .set({ content: opt.content, is_correct: opt.is_correct })
            .where('id', '=', opt.option_id)
            .where('question_id', '=', id)
            .execute();
        }
      }
    });

    return reply.send({ success: true, data: { updated: true } });
  });

  /** Nhờ AI giải thích chuyên sâu câu hỏi (so sánh đáp án đúng và các đáp án nhiễu). */
  app.post('/api/v1/questions/:id/deep-explain', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const question = await db
      .selectFrom('questions')
      .select(['id', 'content', 'explanation'])
      .where('id', '=', id)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    if (!question) throw new NotFoundError('Không tìm thấy câu hỏi.');

    const options = await db
      .selectFrom('question_options')
      .select(['option_label', 'content', 'is_correct'])
      .where('question_id', '=', id)
      .orderBy('option_label', 'asc')
      .execute();

    const deepExplanation = await aiService.deepExplainQuestion({
      content: question.content,
      explanation: question.explanation,
      options: options.map((o) => ({
        label: o.option_label,
        content: o.content,
        is_correct: o.is_correct
      }))
    });

    return reply.send({ success: true, data: { deep_explanation: deepExplanation } });
  });
}

/** Loại câu hỏi trùng nhau (AI đôi khi lặp lại câu ở các batch khác nhau) */
export function dedupeQuestions(items: GeneratedQuestionItem[]): GeneratedQuestionItem[] {
  const seen = new Set<string>();
  const result: GeneratedQuestionItem[] = [];
  for (const item of items) {
    const key = normalizeText(item.content);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const MIN_QUOTE_CHARS = 40;

/**
 * Kiểm chứng chống bịa đặt: đoạn trích dẫn `source_quote` phải xuất hiện thật trong tài liệu gốc.
 */
export function verifyGrounding(
  items: GeneratedQuestionItem[],
  sourceText: string
): { kept: GeneratedQuestionItem[]; droppedReasons: string[] } {
  const haystack = normalizeText(sourceText);
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
    if (!haystack.includes(normalizeText(quote))) {
      droppedReasons.push('trích dẫn không có trong tài liệu');
      continue;
    }
    kept.push(item);
  }

  return { kept, droppedReasons };
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
