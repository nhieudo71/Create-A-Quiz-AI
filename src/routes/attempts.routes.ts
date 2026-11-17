import { FastifyInstance } from 'fastify';
import {
  checkAnswerBodySchema,
  parseOrThrow,
  submitBodySchema,
  uuidParamsSchema
} from '../core/validation/schemas';
import { AttemptsService } from '../modules/attempts/attempts.service';

export function registerAttemptRoutes(
  app: FastifyInstance,
  attemptsService: AttemptsService
): void {
  // ============================================================================
  // 4. LƯỢT THI, CHẤM ĐIỂM & LỊCH SỬ
  // ============================================================================
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

  app.get('/api/v1/attempts/in-progress', async (req, reply) => {
    const inProgress = await attemptsService.getInProgressAttempt();
    return reply.send({ success: true, data: inProgress });
  });

  app.get('/api/v1/attempts/analytics', async (req, reply) => {
    const analytics = await attemptsService.getAnalytics();
    return reply.send({ success: true, data: analytics });
  });

  app.get('/api/v1/attempts/:id/resume', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const data = await attemptsService.resumeAttempt(id);
    return reply.send({ success: true, data });
  });

  app.put('/api/v1/attempts/:id/draft', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(checkAnswerBodySchema, req.body);
    const result = await attemptsService.saveDraftAnswer(id, {
      question_id: body.question_id,
      selected_option_id: body.selected_option_id ?? null,
      response: body.response ?? null
    });
    return reply.send({ success: true, data: result });
  });

  app.delete('/api/v1/attempts/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    await attemptsService.abandonAttempt(id);
    return reply.send({ success: true, data: { deleted: true } });
  });
}
