import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';
import { QuestionType } from '../core/question-types';
import { StudyService } from '../modules/study/study.service';

const subjectQuerySchema = z.object({
  subjectId: z.string().uuid().optional()
});

const srsReviewBodySchema = z.object({
  question_id: z.string().uuid(),
  quality: z.union([z.literal(0), z.literal(3), z.literal(4), z.literal(5)])
});

const composeQuizBodySchema = z.object({
  subject_id: z.string().uuid(),
  title: z.string().max(255).optional(),
  mode: z.enum(['PRACTICE', 'EXAM']).default('EXAM'),
  total_questions: z.number().int().min(1).max(100),
  easy_pct: z.number().int().min(0).max(100).optional(),
  medium_pct: z.number().int().min(0).max(100).optional(),
  hard_pct: z.number().int().min(0).max(100).optional(),
  question_types: z
    .array(z.enum(['MCQ', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'ORDERING', 'LIKERT']))
    .optional()
});

const bookmarkBodySchema = z.object({
  is_flagged: z.boolean(),
  personal_note: z.string().max(2000).nullable().optional()
});

export function registerStudyRoutes(app: FastifyInstance, studyService: StudyService): void {
  app.get('/api/v1/study/mistakes', async (req, reply) => {
    const { subjectId } = parseOrThrow(subjectQuerySchema, req.query);
    const data = await studyService.getMistakes(subjectId);
    return reply.send({ success: true, data });
  });

  app.post('/api/v1/study/mistakes/practice', async (req, reply) => {
    const body = parseOrThrow(
      z.object({ subject_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).optional() }),
      req.body ?? {}
    );
    const data = await studyService.createMistakePracticeQuiz(body.subject_id, body.limit);
    return reply.status(201).send({ success: true, data });
  });

  app.get('/api/v1/study/srs-due', async (req, reply) => {
    const { subjectId } = parseOrThrow(subjectQuerySchema, req.query);
    const data = await studyService.getSrsDue(subjectId);
    return reply.send({ success: true, data });
  });

  app.post('/api/v1/study/srs-review', async (req, reply) => {
    const body = parseOrThrow(srsReviewBodySchema, req.body);
    const data = await studyService.reviewSrsCard(body.question_id, body.quality);
    return reply.send({ success: true, data });
  });

  app.post('/api/v1/quizzes/compose', async (req, reply) => {
    const body = parseOrThrow(composeQuizBodySchema, req.body);
    const data = await studyService.composeQuizFromBank({
      subjectId: body.subject_id,
      title: body.title,
      mode: body.mode,
      totalQuestions: body.total_questions,
      easyPct: body.easy_pct,
      mediumPct: body.medium_pct,
      hardPct: body.hard_pct,
      questionTypes: body.question_types as QuestionType[] | undefined
    });
    return reply.status(201).send({ success: true, data });
  });

  app.put('/api/v1/questions/:id/bookmark', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const body = parseOrThrow(bookmarkBodySchema, req.body);
    const data = await studyService.upsertBookmark(id, body.is_flagged, body.personal_note ?? null);
    return reply.send({ success: true, data });
  });

  app.get('/api/v1/questions/bookmarked', async (req, reply) => {
    const { subjectId } = parseOrThrow(subjectQuerySchema, req.query);
    const data = await studyService.getBookmarkedQuestions(subjectId);
    return reply.send({ success: true, data });
  });
}
