import { randomUUID } from 'crypto';
import { sql, Transaction } from 'kysely';
import { db } from '../../core/database/db';
import type { DatabaseSchema } from '../../core/database/types';
import { BadRequestError, NotFoundError } from '../../core/errors';
import { isScorableType, QuestionType } from '../../core/question-types';

export interface SrsGradeInput {
  questionId: string;
  isCorrect: boolean;
}

/**
 * Cập nhật trạng thái lặp lại ngắt quãng (SRS) cho danh sách câu hỏi sau khi nộp bài.
 */
export async function updateSrsAfterSubmit(
  trx: Transaction<DatabaseSchema>,
  items: SrsGradeInput[],
  now: Date
): Promise<void> {
  if (items.length === 0) return;

  const qIds = items.map((i) => i.questionId);
  const existingRows = await trx
    .selectFrom('question_srs')
    .selectAll()
    .where('question_id', 'in', qIds)
    .execute();
  const existingMap = new Map(existingRows.map((r) => [r.question_id, r]));

  for (const item of items) {
    const prev = existingMap.get(item.questionId);
    const prevEase = prev ? Number(prev.ease_factor) : 2.5;
    const prevReps = prev ? prev.repetitions : 0;
    const prevInterval = prev ? prev.interval_days : 0;

    let nextEase = prevEase;
    let nextReps = prevReps;
    let nextInterval = prevInterval;
    let nextReviewAt = now;

    if (item.isCorrect) {
      nextReps = prevReps + 1;
      if (nextReps === 1) nextInterval = 1;
      else if (nextReps === 2) nextInterval = 6;
      else nextInterval = Math.max(1, Math.round(prevInterval * prevEase));
      nextEase = Math.max(1.3, Number((prevEase + 0.05).toFixed(2)));
      nextReviewAt = new Date(now.getTime() + nextInterval * 86_400_000);
    } else {
      nextReps = 0;
      nextInterval = 0;
      nextEase = Math.max(1.3, Number((prevEase - 0.2).toFixed(2)));
      nextReviewAt = now;
    }

    await trx
      .insertInto('question_srs')
      .values({
        question_id: item.questionId,
        ease_factor: nextEase,
        interval_days: nextInterval,
        repetitions: nextReps,
        wrong_count: item.isCorrect ? 0 : 1,
        correct_count: item.isCorrect ? 1 : 0,
        last_reviewed_at: now,
        next_review_at: nextReviewAt
      })
      .onConflict((oc) =>
        oc.column('question_id').doUpdateSet({
          ease_factor: nextEase,
          interval_days: nextInterval,
          repetitions: nextReps,
          wrong_count: (prev?.wrong_count ?? 0) + (item.isCorrect ? 0 : 1),
          correct_count: (prev?.correct_count ?? 0) + (item.isCorrect ? 1 : 0),
          last_reviewed_at: now,
          next_review_at: nextReviewAt
        })
      )
      .execute();
  }
}

export class StudyService {
  /** Danh sách câu hỏi hay sai (wrong_count > 0) kèm đáp án đúng & giải thích. */
  async getMistakes(subjectId?: string, limit = 50) {
    let query = db
      .selectFrom('question_srs')
      .innerJoin('questions', 'questions.id', 'question_srs.question_id')
      .innerJoin('subjects', 'subjects.id', 'questions.subject_id')
      .leftJoin('question_bookmarks', 'question_bookmarks.question_id', 'questions.id')
      .select([
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.explanation',
        'questions.source_reference',
        'questions.question_type',
        'questions.payload',
        'subjects.id as subject_id',
        'subjects.name as subject_name',
        'question_srs.wrong_count',
        'question_srs.correct_count',
        'question_srs.next_review_at',
        'question_bookmarks.is_flagged',
        'question_bookmarks.personal_note'
      ])
      .where('questions.is_deleted', '=', false)
      .where('question_srs.wrong_count', '>', 0);

    if (subjectId) {
      query = query.where('questions.subject_id', '=', subjectId);
    }

    const rows = await query
      .orderBy('question_srs.wrong_count', 'desc')
      .limit(limit)
      .execute();

    return await this.attachOptions(rows);
  }

  /** Danh sách câu hỏi đến hạn ôn tập Flashcard / SRS. */
  async getSrsDue(subjectId?: string, limit = 30) {
    const now = new Date();
    let query = db
      .selectFrom('question_srs')
      .innerJoin('questions', 'questions.id', 'question_srs.question_id')
      .innerJoin('subjects', 'subjects.id', 'questions.subject_id')
      .leftJoin('question_bookmarks', 'question_bookmarks.question_id', 'questions.id')
      .select([
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.explanation',
        'questions.source_reference',
        'questions.question_type',
        'questions.payload',
        'subjects.id as subject_id',
        'subjects.name as subject_name',
        'question_srs.wrong_count',
        'question_srs.correct_count',
        'question_srs.interval_days',
        'question_srs.next_review_at',
        'question_bookmarks.is_flagged',
        'question_bookmarks.personal_note'
      ])
      .where('questions.is_deleted', '=', false)
      .where('question_srs.next_review_at', '<=', now);

    if (subjectId) {
      query = query.where('questions.subject_id', '=', subjectId);
    }

    const rows = await query
      .orderBy('question_srs.next_review_at', 'asc')
      .limit(limit)
      .execute();

    return await this.attachOptions(rows);
  }

  /** Chấm mức độ nhớ trên Flashcard (SM-2: quality 0=Quên, 3=Khó, 4=Nhớ, 5=Rất dễ). */
  async reviewSrsCard(questionId: string, quality: 0 | 3 | 4 | 5) {
    const q = await db
      .selectFrom('questions')
      .select('id')
      .where('id', '=', questionId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    if (!q) throw new NotFoundError('Không tìm thấy câu hỏi.');

    const now = new Date();
    const prev = await db
      .selectFrom('question_srs')
      .selectAll()
      .where('question_id', '=', questionId)
      .executeTakeFirst();

    const prevEase = prev ? Number(prev.ease_factor) : 2.5;
    const prevReps = prev ? prev.repetitions : 0;
    const prevInterval = prev ? prev.interval_days : 0;

    let nextReps = prevReps;
    let nextInterval = prevInterval;
    if (quality < 3) {
      nextReps = 0;
      nextInterval = 0;
    } else {
      nextReps = prevReps + 1;
      if (nextReps === 1) nextInterval = 1;
      else if (nextReps === 2) nextInterval = 6;
      else nextInterval = Math.max(1, Math.round(prevInterval * prevEase));
    }

    const delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
    const nextEase = Math.max(1.3, Number((prevEase + delta).toFixed(2)));
    const nextReviewAt =
      nextInterval === 0 ? now : new Date(now.getTime() + nextInterval * 86_400_000);

    await db
      .insertInto('question_srs')
      .values({
        question_id: questionId,
        ease_factor: nextEase,
        interval_days: nextInterval,
        repetitions: nextReps,
        wrong_count: quality < 3 ? 1 : 0,
        correct_count: quality >= 3 ? 1 : 0,
        last_reviewed_at: now,
        next_review_at: nextReviewAt
      })
      .onConflict((oc) =>
        oc.column('question_id').doUpdateSet({
          ease_factor: nextEase,
          interval_days: nextInterval,
          repetitions: nextReps,
          wrong_count: (prev?.wrong_count ?? 0) + (quality < 3 ? 1 : 0),
          correct_count: (prev?.correct_count ?? 0) + (quality >= 3 ? 1 : 0),
          last_reviewed_at: now,
          next_review_at: nextReviewAt
        })
      )
      .execute();

    return {
      question_id: questionId,
      interval_days: nextInterval,
      next_review_at: nextReviewAt.toISOString()
    };
  }

  /** Tạo nhanh một bài ôn tập từ các câu hay sai (để mở ngay trong Phòng thi). */
  async createMistakePracticeQuiz(subjectId?: string, limit = 30) {
    const mistakes = await this.getMistakes(subjectId, limit);
    if (mistakes.length === 0) {
      throw new BadRequestError('Bạn chưa có câu hỏi nào trả lời sai để ôn tập.');
    }

    const targetSubjectId = subjectId ?? mistakes[0].subject_id;
    const subject = await db
      .selectFrom('subjects')
      .select(['id', 'name'])
      .where('id', '=', targetSubjectId)
      .executeTakeFirst();

    return await db.transaction().execute(async (trx) => {
      const [quiz] = await trx
        .insertInto('quizzes')
        .values({
          id: randomUUID(),
          title: `Ôn tập câu sai${subject ? ` - ${subject.name}` : ''} (${mistakes.length} câu)`,
          subject_id: targetSubjectId,
          mode: 'PRACTICE',
          time_limit_seconds: 0,
          total_questions: mistakes.length,
          instant_feedback: true
        })
        .returningAll()
        .execute();

      await trx
        .insertInto('quiz_questions')
        .values(
          mistakes.map((m, idx) => ({
            quiz_id: quiz.id,
            question_id: m.question_id,
            display_order: idx + 1
          }))
        )
        .execute();

      return { quiz, subject_name: subject?.name ?? 'Ôn tập câu sai' };
    });
  }

  /** Tạo đề thi tổng hợp từ Ngân hàng câu hỏi theo môn & phân bổ độ khó. */
  async composeQuizFromBank(input: {
    subjectId: string;
    title?: string;
    mode: 'PRACTICE' | 'EXAM';
    totalQuestions: number;
    easyPct?: number;
    mediumPct?: number;
    hardPct?: number;
    questionTypes?: QuestionType[];
    subtopic?: string;
  }) {
    const subject = await db
      .selectFrom('subjects')
      .select(['id', 'name'])
      .where('id', '=', input.subjectId)
      .executeTakeFirst();
    if (!subject) throw new NotFoundError('Không tìm thấy môn học.');

    let query = db
      .selectFrom('questions')
      .select(['id', 'difficulty', 'question_type'])
      .where('subject_id', '=', input.subjectId)
      .where('is_deleted', '=', false);

    if (input.subtopic && input.subtopic.trim()) {
      query = query.where('subtopic', '=', input.subtopic.trim());
    }

    if (input.questionTypes && input.questionTypes.length > 0) {
      query = query.where('question_type', 'in', input.questionTypes);
    }

    const pool = await query.execute();
    if (pool.length === 0) {
      throw new BadRequestError('Môn học này chưa có câu hỏi nào trong ngân hàng.');
    }

    const desiredTotal = Math.min(input.totalQuestions, pool.length, 100);
    const easyPct = input.easyPct ?? 30;
    const mediumPct = input.mediumPct ?? 50;

    const shuffle = <T,>(arr: T[]): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    const byDiff = {
      EASY: shuffle(pool.filter((q) => q.difficulty === 'EASY')),
      MEDIUM: shuffle(pool.filter((q) => q.difficulty === 'MEDIUM')),
      HARD: shuffle(pool.filter((q) => q.difficulty === 'HARD'))
    };

    const wantEasy = Math.round((desiredTotal * easyPct) / 100);
    const wantMedium = Math.round((desiredTotal * mediumPct) / 100);
    const wantHard = Math.max(0, desiredTotal - wantEasy - wantMedium);

    const picked = [
      ...byDiff.EASY.slice(0, wantEasy),
      ...byDiff.MEDIUM.slice(0, wantMedium),
      ...byDiff.HARD.slice(0, wantHard)
    ];

    const pickedIds = new Set(picked.map((p) => p.id));
    if (picked.length < desiredTotal) {
      const remaining = shuffle(pool.filter((q) => !pickedIds.has(q.id)));
      picked.push(...remaining.slice(0, desiredTotal - picked.length));
    }

    const finalPicked = shuffle(picked).slice(0, desiredTotal);
    const timeLimit = input.mode === 'EXAM' ? 1800 : 0;

    const quiz = await db.transaction().execute(async (trx) => {
      const [created] = await trx
        .insertInto('quizzes')
        .values({
          id: randomUUID(),
          title: input.title?.trim() || `Đề tổng hợp ${subject.name} (${finalPicked.length} câu)`,
          subject_id: subject.id,
          mode: input.mode,
          time_limit_seconds: timeLimit,
          total_questions: finalPicked.length,
          instant_feedback: input.mode === 'PRACTICE'
        })
        .returningAll()
        .execute();

      await trx
        .insertInto('quiz_questions')
        .values(
          finalPicked.map((q, idx) => ({
            quiz_id: created.id,
            question_id: q.id,
            display_order: idx + 1
          }))
        )
        .execute();

      return created;
    });

    return { quiz, subject_name: subject.name };
  }

  /** Gắn cờ / lưu ghi chú cá nhân cho một câu hỏi. */
  async upsertBookmark(questionId: string, isFlagged: boolean, personalNote: string | null) {
    const q = await db
      .selectFrom('questions')
      .select('id')
      .where('id', '=', questionId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
    if (!q) throw new NotFoundError('Không tìm thấy câu hỏi.');

    if (!isFlagged && !personalNote?.trim()) {
      await db.deleteFrom('question_bookmarks').where('question_id', '=', questionId).execute();
      return { question_id: questionId, is_flagged: false, personal_note: null };
    }

    const note = personalNote?.trim() || null;
    await db
      .insertInto('question_bookmarks')
      .values({
        question_id: questionId,
        is_flagged: isFlagged,
        personal_note: note,
        updated_at: new Date()
      })
      .onConflict((oc) =>
        oc.column('question_id').doUpdateSet({
          is_flagged: isFlagged,
          personal_note: note,
          updated_at: new Date()
        })
      )
      .execute();

    return { question_id: questionId, is_flagged: isFlagged, personal_note: note };
  }

  /** Lấy danh sách câu hỏi đã đánh dấu / có ghi chú. */
  async getBookmarkedQuestions(subjectId?: string) {
    let query = db
      .selectFrom('question_bookmarks')
      .innerJoin('questions', 'questions.id', 'question_bookmarks.question_id')
      .innerJoin('subjects', 'subjects.id', 'questions.subject_id')
      .select([
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.explanation',
        'questions.source_reference',
        'questions.question_type',
        'questions.payload',
        'subjects.id as subject_id',
        'subjects.name as subject_name',
        'question_bookmarks.is_flagged',
        'question_bookmarks.personal_note',
        'question_bookmarks.updated_at'
      ])
      .where('questions.is_deleted', '=', false)
      .where((eb) =>
        eb.or([
          eb('question_bookmarks.is_flagged', '=', true),
          eb('question_bookmarks.personal_note', 'is not', null)
        ])
      );

    if (subjectId) {
      query = query.where('questions.subject_id', '=', subjectId);
    }

    const rows = await query.orderBy('question_bookmarks.updated_at', 'desc').execute();
    return await this.attachOptions(rows);
  }

  private async attachOptions<T extends { question_id: string }>(rows: T[]) {
    if (rows.length === 0) return [];
    const qIds = rows.map((r) => r.question_id);
    const options = await db
      .selectFrom('question_options')
      .select(['id as option_id', 'question_id', 'option_label', 'content', 'is_correct'])
      .where('question_id', 'in', qIds)
      .orderBy('option_label', 'asc')
      .execute();

    return rows.map((r) => ({
      ...r,
      options: options.filter((o) => o.question_id === r.question_id)
    }));
  }
}

export function shouldTrackSrs(questionType: QuestionType): boolean {
  return isScorableType(questionType);
}
