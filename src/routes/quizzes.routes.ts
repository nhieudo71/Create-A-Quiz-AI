import { FastifyInstance } from 'fastify';
import {
  createQuizBodySchema,
  parseOrThrow,
  updateQuizBodySchema,
  uuidParamsSchema
} from '../core/validation/schemas';
import { AttemptsService } from '../modules/attempts/attempts.service';

export function registerQuizRoutes(
  app: FastifyInstance,
  attemptsService: AttemptsService
): void {
  // ============================================================================
  // 3. ĐỀ THI & THƯ VIỆN MÔN HỌC
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

  app.get('/api/v1/quizzes/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const quiz = await attemptsService.getQuizById(id);
    return reply.send({ success: true, data: quiz });
  });

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
}
