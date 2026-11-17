import { randomUUID } from 'crypto';
import { sql, Transaction } from 'kysely';
import { db } from '../../core/database/db';
import type { DatabaseSchema } from '../../core/database/types';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import type { GeneratedQuestionItem } from '../ai-generator/ai.service';
import { QuestionPayload, QuestionType, isScorableType } from '../../core/question-types';
import { gradeAnswer, AnswerResponse, hasResponse, GradableQuestion } from './grading';
import { shuffleOptions, shuffleQuestions } from './shuffle';
import { updateSrsAfterSubmit } from '../study/study.service';

const EXAM_TIME_LIMIT_SECONDS = 1800;
const PRACTICE_TIME_LIMIT_SECONDS = 0;
const SUBMIT_GRACE_PERIOD_MS = 30_000;
const MAX_SUBJECT_CREATE_TRIES = 3;

export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

export interface SubmitAnswerItem {
  question_id: string;
  /** Tương thích câu MCQ/Đúng-Sai cũ; các loại khác dùng `response`. */
  selected_option_id?: string | null;
  response?: AnswerResponse | null;
}

export interface CreateQuizInput {
  title: string;
  subjectName: string;
  mode: 'PRACTICE' | 'EXAM';
  instantFeedback?: boolean;
  questions: GeneratedQuestionItem[];
}

export class AttemptsService {
  /**
   * Tạo đề thi từ danh sách câu hỏi đã sinh.
   * Id sinh phía server để thứ tự câu hỏi và đáp án khớp nhau chính xác,
   * tránh phụ thuộc vào thứ tự trả về của RETURNING.
   */
  async createQuizFromQuestions(input: CreateQuizInput) {
    const { title, subjectName, mode, questions } = input;
    // Mặc định bật phản hồi tức thì: người dùng cần biết đúng/sai ngay khi trả lời.
    const instantFeedback = input.instantFeedback ?? true;

    return await db.transaction().execute(async (trx) => {
      const subject = await this.getOrCreateSubject(trx, subjectName);
      const timeLimit = mode === 'EXAM' ? EXAM_TIME_LIMIT_SECONDS : PRACTICE_TIME_LIMIT_SECONDS;

      const [quiz] = await trx
        .insertInto('quizzes')
        .values({
          title,
          subject_id: subject.id,
          mode,
          time_limit_seconds: timeLimit,
          total_questions: questions.length,
          instant_feedback: instantFeedback
        })
        .returningAll()
        .execute();

      const questionRows = questions.map((q) => ({
        id: randomUUID(),
        document_id: null,
        subject_id: subject.id,
        content: q.content,
        difficulty: q.difficulty,
        explanation: q.explanation,
        source_reference: q.source_reference,
        question_type: q.question_type ?? 'MCQ',
        payload: q.payload ? JSON.stringify(q.payload) : null
      }));

      // Một lệnh INSERT cho cả bộ thay vì N lệnh trong vòng lặp
      if (questionRows.length > 0) {
        await trx.insertInto('questions').values(questionRows).execute();

        const optionRows = questions.flatMap((q, index) =>
          q.options.map((opt) => ({
            question_id: questionRows[index].id,
            option_label: opt.label,
            content: opt.content,
            is_correct: opt.is_correct
          }))
        );
        await trx.insertInto('question_options').values(optionRows).execute();

        await trx
          .insertInto('quiz_questions')
          .values(
            questionRows.map((row, index) => ({
              quiz_id: quiz.id,
              question_id: row.id,
              display_order: index + 1
            }))
          )
          .execute();
      }

      return quiz;
    });
  }

  /**
   * Bắt đầu một lượt thi. Chế độ Ôn tập (PRACTICE) không có giới hạn thời gian.
   */
  async startAttempt(quizId: string, userId = DEFAULT_USER_ID) {
    const quiz = await db
      .selectFrom('quizzes')
      .selectAll()
      .where('id', '=', quizId)
      .executeTakeFirst();

    if (!quiz) {
      throw new NotFoundError('Không tìm thấy bài thi.');
    }

    // Lấy câu hỏi liên kết (ẩn is_correct và explanation để chống gian lận)
    const questions = await db
      .selectFrom('quiz_questions')
      .innerJoin('questions', 'questions.id', 'quiz_questions.question_id')
      .select([
        'quiz_questions.display_order',
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.question_type',
        'questions.payload'
      ])
      .where('quiz_questions.quiz_id', '=', quizId)
      .orderBy('quiz_questions.display_order', 'asc')
      .execute();

    if (questions.length === 0) {
      throw new ConflictError('Đề thi này không có câu hỏi nào.');
    }

    const questionIds = questions.map((q) => q.question_id);
    const options = await db
      .selectFrom('question_options')
      .select(['id as option_id', 'question_id', 'option_label', 'content'])
      .where('question_id', 'in', questionIds)
      .execute();

    const now = new Date();
    // PRACTICE: time_limit = 0 nghĩa là không giới hạn thời gian (expires_at = NULL).
    // Không dùng "|| 1800" vì 0 là giá trị hợp lệ, không phải "thiếu cấu hình".
    const durationSeconds =
      quiz.mode === 'PRACTICE'
        ? PRACTICE_TIME_LIMIT_SECONDS
        : quiz.time_limit_seconds || EXAM_TIME_LIMIT_SECONDS;
    const expiresAt = durationSeconds > 0 ? new Date(now.getTime() + durationSeconds * 1000) : null;

    const [attempt] = await db
      .insertInto('quiz_attempts')
      .values({
        quiz_id: quizId,
        user_id: userId,
        status: 'IN_PROGRESS',
        total_questions: questions.length,
        correct_count: 0,
        score_percentage: 0,
        started_at: now,
        expires_at: expiresAt,
        submitted_at: null
      })
      .returningAll()
      .execute();

    return this.buildAttemptPayload(quiz, attempt, durationSeconds, questions, options);
  }

  private buildAttemptPayload(
    quiz: { id: string; title: string; mode: 'PRACTICE' | 'EXAM'; instant_feedback: boolean },
    attempt: { id: string; started_at: Date; expires_at: Date | null },
    durationSeconds: number,
    questions: Array<{
      display_order: number;
      question_id: string;
      content: string;
      difficulty: string;
      question_type: string;
      payload: unknown;
    }>,
    options: Array<{ option_id: string; question_id: string; option_label: string; content: string }>
  ) {
    const shuffledQuestions = shuffleQuestions(questions, attempt.id);

    return {
      attempt_id: attempt.id,
      quiz_id: quiz.id,
      title: quiz.title,
      mode: quiz.mode,
      time_limit_seconds: durationSeconds,
      started_at: attempt.started_at,
      expires_at: attempt.expires_at,
      total_questions: questions.length,
      instant_feedback: quiz.instant_feedback,
      questions: shuffledQuestions.map((q, index) => {
        const questionType = (q.question_type as QuestionType) ?? 'MCQ';
        const questionOptions = options.filter((opt) => opt.question_id === q.question_id);

        return {
          display_order: index + 1,
          question_id: q.question_id,
          content: q.content,
          difficulty: q.difficulty,
          question_type: questionType,
          payload: q.payload ?? null,
          options: buildDisplayOptions(questionOptions, attempt.id, q.question_id, questionType)
        };
      })
    };
  }

  /**
   * Nộp bài và chấm điểm phía server.
   * - Khóa dòng lượt thi (FOR UPDATE) để hai lần nộp đồng thời không cùng lúc thành công.
   * - Chỉ chấp nhận đáp án thuộc đúng đề thi, và đáp án được chọn phải thuộc đúng câu hỏi.
   * - Điểm luôn chia cho TỔNG số câu của đề nên không thể vượt quá 100%.
   */
  async submitAttempt(attemptId: string, answers: SubmitAnswerItem[]) {
    return await db.transaction().execute(async (trx) => {
      const attempt = await trx
        .selectFrom('quiz_attempts')
        .selectAll()
        .where('id', '=', attemptId)
        .forUpdate()
        .executeTakeFirst();

      if (!attempt) {
        throw new NotFoundError('Không tìm thấy lượt thi.');
      }

      if (attempt.status !== 'IN_PROGRESS') {
        throw new ConflictError('Bài thi này đã được nộp hoặc đã kết thúc trước đó.');
      }

      const quizQuestions = await trx
        .selectFrom('quiz_questions')
        .select('question_id')
        .where('quiz_id', '=', attempt.quiz_id)
        .execute();

      if (quizQuestions.length === 0) {
        throw new ConflictError('Đề thi này không có câu hỏi nào để chấm điểm.');
      }

      const quizQuestionIds = quizQuestions.map((q) => q.question_id);
      const belongsToQuiz = new Set(quizQuestionIds);

      if (answers.some((a) => !belongsToQuiz.has(a.question_id))) {
        throw new BadRequestError('Bài nộp chứa câu hỏi không thuộc đề thi này.');
      }

      // Nạp đủ dữ liệu để chấm: loại câu hỏi, payload (cặp ghép/thứ tự đúng) và đáp án.
      const questionRows = await trx
        .selectFrom('questions')
        .select(['id', 'question_type', 'payload'])
        .where('id', 'in', quizQuestionIds)
        .execute();

      const options = await trx
        .selectFrom('question_options')
        .select(['id', 'question_id', 'option_label', 'content', 'is_correct'])
        .where('question_id', 'in', quizQuestionIds)
        .execute();

      const optionOwner = new Map<string, string>();
      for (const opt of options) optionOwner.set(opt.id, opt.question_id);

      // Câu bỏ trống phải được lưu là "không trả lời"; client cũ chỉ gửi selected_option_id.
      for (const a of answers) {
        const ids = a.selected_option_id ? [a.selected_option_id] : a.response?.option_ids ?? [];
        for (const id of ids) {
          if (optionOwner.get(id) !== a.question_id) {
            throw new BadRequestError('Đáp án được chọn không thuộc câu hỏi tương ứng.');
          }
        }
        if (a.response?.option_id && optionOwner.get(a.response.option_id) !== a.question_id) {
          throw new BadRequestError('Đáp án được chọn không thuộc câu hỏi tương ứng.');
        }
      }

      const questionById = new Map(questionRows.map((q) => [q.id, q]));

      const now = new Date();
      const isExpired =
        attempt.expires_at !== null &&
        now.getTime() > new Date(attempt.expires_at).getTime() + SUBMIT_GRACE_PERIOD_MS;

      let correctCount = 0;
      let scorableTotal = 0;

      const answerRows = answers.map((a) => {
        const row = questionById.get(a.question_id);
        const questionType = (row?.question_type as QuestionType) ?? 'MCQ';
        const payload = (row?.payload as QuestionPayload | null) ?? null;

        const gradable: GradableQuestion = {
          question_type: questionType,
          payload,
          options: options
            .filter((o) => o.question_id === a.question_id)
            .map((o) => ({
              id: o.id,
              label: o.option_label,
              content: o.content,
              is_correct: o.is_correct
            }))
        };

        // Hợp nhất hai dạng đầu vào: `selected_option_id` (client cũ) và `response` (nhiều loại câu).
        const response: AnswerResponse = a.response ?? { option_id: a.selected_option_id ?? null };

        const graded = gradeAnswer(gradable, response);
        if (isScorableType(questionType)) scorableTotal++;
        if (graded.isCorrect) correctCount++;

        return {
          attempt_id: attemptId,
          question_id: a.question_id,
          selected_option_id: a.selected_option_id ?? response.option_id ?? null,
          response: JSON.stringify(response),
          is_correct: graded.isCorrect,
          answered_at: now
        };
      });

      // Xoá các bản nháp cũ (nếu có) trước khi ghi đáp án chính thức đã chấm
      await trx.deleteFrom('attempt_answers').where('attempt_id', '=', attemptId).execute();

      if (answerRows.length > 0) {
        await trx.insertInto('attempt_answers').values(answerRows).execute();

        // Cập nhật trạng thái SRS / đếm số lần sai cho các câu có chấm điểm
        const srsItems = answerRows
          .filter((row) => {
            const q = questionById.get(row.question_id);
            const qType = ((q?.question_type as QuestionType) ?? 'MCQ');
            return isScorableType(qType);
          })
          .map((row) => ({ questionId: row.question_id, isCorrect: row.is_correct }));
        await updateSrsAfterSubmit(trx, srsItems, now);
      }

      // Mẫu số là số câu CÓ THỂ chấm (bỏ câu Likert khảo sát, không có đáp án đúng).
      const total = scorableTotal > 0 ? scorableTotal : quizQuestionIds.length;
      const answeredCount = answers.filter((a) => hasResponse(a.response ?? { option_id: a.selected_option_id ?? null }))
        .length;
      const score = Math.min(100, Number(((correctCount / total) * 100).toFixed(2)));
      const status = isExpired ? 'TIMED_OUT' : 'SUBMITTED';

      await trx
        .updateTable('quiz_attempts')
        .set({
          status,
          correct_count: correctCount,
          score_percentage: score,
          total_questions: total,
          submitted_at: now
        })
        .where('id', '=', attemptId)
        .execute();

      return {
        attempt_id: attemptId,
        status,
        correct_count: correctCount,
        total_questions: total,
        unanswered_count: total - answeredCount,
        score_percentage: score,
        time_spent_seconds: Math.max(
          0,
          Math.round((now.getTime() - new Date(attempt.started_at).getTime()) / 1000)
        ),
        is_expired: isExpired
      };
    });
  }

  /**
   * Chấm MỘT câu trả lời để hiện phản hồi tức thì.
   *
   * Cố ý KHÔNG ghi vào CSDL: người dùng có thể đổi đáp án nhiều lần trước khi nộp,
   * và điểm chính thức chỉ được chốt ở `submitAttempt`. Endpoint này chỉ trả lời
   * "đúng hay sai" để giao diện hiển thị.
   */
  async checkAnswer(attemptId: string, input: SubmitAnswerItem) {
    const attempt = await db
      .selectFrom('quiz_attempts')
      .select(['id', 'quiz_id', 'status'])
      .where('id', '=', attemptId)
      .executeTakeFirst();

    if (!attempt) {
      throw new NotFoundError('Không tìm thấy lượt thi.');
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictError('Bài thi đã kết thúc, không thể chấm câu trả lời.');
    }

    const link = await db
      .selectFrom('quiz_questions')
      .select('question_id')
      .where('quiz_id', '=', attempt.quiz_id)
      .where('question_id', '=', input.question_id)
      .executeTakeFirst();

    if (!link) {
      throw new BadRequestError('Câu hỏi không thuộc đề thi này.');
    }

    const question = await db
      .selectFrom('questions')
      .select(['id', 'question_type', 'payload', 'explanation', 'source_reference'])
      .where('id', '=', input.question_id)
      .executeTakeFirst();

    if (!question) {
      throw new NotFoundError('Không tìm thấy câu hỏi.');
    }

    const options = await db
      .selectFrom('question_options')
      .select(['id', 'option_label', 'content', 'is_correct'])
      .where('question_id', '=', input.question_id)
      .execute()
      .then((rows) =>
        rows.map((o) => ({ ...o, option_id: o.id, label: o.option_label }))
      );

    const questionType = (question.question_type as QuestionType) ?? 'MCQ';
    const payload = (question.payload as QuestionPayload | null) ?? null;
    const response: AnswerResponse = input.response ?? { option_id: input.selected_option_id ?? null };

    // Cùng một luật với submitAttempt: không nhận đáp án của câu khác, nếu không
    // người dùng sẽ "chấm" được câu này bằng id của câu kia và thấy kết quả vô nghĩa.
    const ownedIds = new Set(options.map((o) => o.id));
    const submittedIds = [
      ...(input.selected_option_id ? [input.selected_option_id] : []),
      ...(response.option_ids ?? []),
      ...(response.option_id ? [response.option_id] : [])
    ];
    if (submittedIds.some((id) => !ownedIds.has(id))) {
      throw new BadRequestError('Đáp án được chọn không thuộc câu hỏi tương ứng.');
    }

    const graded = gradeAnswer(
      {
        question_type: questionType,
        payload,
        options: options.map((o) => ({
          id: o.id,
          label: o.option_label,
          content: o.content,
          is_correct: o.is_correct
        }))
      },
      response
    );

    return {
      question_id: input.question_id,
      question_type: questionType,
      is_correct: graded.isCorrect,
      explanation: question.explanation,
      source_reference: question.source_reference,
      payload,
      // Trả đáp án đúng để giao diện tô xanh; không lộ gì trước khi người dùng chọn
      // vì endpoint chỉ được gọi SAU khi họ đã trả lời.
      correct_option_ids: options.filter((o) => o.is_correct).map((o) => o.id)
    };
  }

  /**
   * Xem lại chi tiết bài làm: chỉ trả đáp án đúng + giải thích sau khi đã nộp.
   */
  async reviewAttempt(attemptId: string) {
    const attempt = await db
      .selectFrom('quiz_attempts')
      .selectAll()
      .where('id', '=', attemptId)
      .executeTakeFirst();

    if (!attempt) {
      throw new NotFoundError('Không tìm thấy lượt thi.');
    }

    if (attempt.status === 'IN_PROGRESS') {
      throw new ConflictError('Bài thi chưa được nộp nên chưa thể xem đáp án.');
    }

    const answers = await db
      .selectFrom('attempt_answers')
      .innerJoin('questions', 'questions.id', 'attempt_answers.question_id')
      .select([
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.explanation',
        'questions.source_reference',
        'questions.question_type',
        'questions.payload',
        'attempt_answers.selected_option_id',
        'attempt_answers.response',
        'attempt_answers.is_correct'
      ])
      .where('attempt_answers.attempt_id', '=', attemptId)
      .execute();

    const questionIds = answers.map((a) => a.question_id);
    const options = questionIds.length
      ? await db
          .selectFrom('question_options')
          .selectAll()
          .where('question_id', 'in', questionIds)
          .execute()
      : [];

    // Sắp xếp lại theo đúng thứ tự đã trộn lúc làm bài (trộn tất định theo attempt id),
    // nếu không người dùng sẽ thấy đề xem lại khác với đề vừa làm.
    const ordered = shuffleQuestions(answers, attempt.id);

    return {
      attempt_id: attempt.id,
      status: attempt.status,
      score_percentage: attempt.score_percentage,
      correct_count: attempt.correct_count,
      total_questions: attempt.total_questions,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      details: ordered.map((ans) => {
        const questionType = (ans.question_type as QuestionType) ?? 'MCQ';
        // Đánh lại nhãn giống y hệt lúc làm bài để người dùng đối chiếu đúng vị trí.
        const displayOptions = buildDisplayOptions(
          options.filter((opt) => opt.question_id === ans.question_id).map((opt) => ({
            option_id: opt.id,
            question_id: opt.question_id,
            option_label: opt.option_label,
            content: opt.content
          })),
          attempt.id,
          ans.question_id,
          questionType
        );

        const correctness = new Map(
          options.filter((opt) => opt.question_id === ans.question_id).map((opt) => [opt.id, opt.is_correct])
        );

        return {
          question_id: ans.question_id,
          content: ans.content,
          difficulty: ans.difficulty,
          explanation: ans.explanation,
          source_reference: ans.source_reference,
          question_type: questionType,
          payload: ans.payload ?? null,
          selected_option_id: ans.selected_option_id,
          response: ans.response ?? null,
          is_correct: ans.is_correct,
          options: displayOptions.map((opt) => ({
            option_id: opt.option_id,
            label: opt.label,
            content: opt.content,
            is_correct: correctness.get(opt.option_id) === true
          })),
          matching_right_column: buildMatchingRightColumn(
            (ans.payload as QuestionPayload | null) ?? null,
            attempt.id,
            ans.question_id
          )
        };
      })
    };
  }

  /**
   * Lưu nháp câu trả lời khi đang làm bài (không chấm điểm, chỉ giữ trạng thái để khôi phục nếu tải lại trang).
   */
  async saveDraftAnswer(attemptId: string, input: SubmitAnswerItem) {
    const attempt = await db
      .selectFrom('quiz_attempts')
      .selectAll()
      .where('id', '=', attemptId)
      .executeTakeFirst();

    if (!attempt) throw new NotFoundError('Không tìm thấy lượt làm bài.');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictError('Bài thi này đã được nộp trước đó.');
    }
    if (attempt.expires_at && new Date() > new Date(attempt.expires_at)) {
      throw new ConflictError('Đã hết thời gian làm bài.');
    }

    const belongs = await db
      .selectFrom('quiz_questions')
      .select('question_id')
      .where('quiz_id', '=', attempt.quiz_id)
      .where('question_id', '=', input.question_id)
      .executeTakeFirst();

    if (!belongs) {
      throw new BadRequestError('Câu hỏi không thuộc bài thi này.');
    }

    const responseJson = input.response !== undefined && input.response !== null
      ? JSON.stringify(input.response)
      : null;

    await db
      .insertInto('attempt_answers')
      .values({
        attempt_id: attemptId,
        question_id: input.question_id,
        selected_option_id: input.selected_option_id ?? null,
        response: responseJson,
        is_correct: false,
        answered_at: new Date()
      })
      .onConflict((oc) =>
        oc.columns(['attempt_id', 'question_id']).doUpdateSet({
          selected_option_id: input.selected_option_id ?? null,
          response: responseJson,
          answered_at: new Date()
        })
      )
      .execute();

    return { saved: true };
  }

  /**
   * Tìm lượt thi đang làm dở gần nhất (còn hạn). Lượt đã quá hạn sẽ được đánh dấu TIMED_OUT.
   */
  async getInProgressAttempt(userId = DEFAULT_USER_ID) {
    const now = new Date();
    await db
      .updateTable('quiz_attempts')
      .set({ status: 'TIMED_OUT' })
      .where('user_id', '=', userId)
      .where('status', '=', 'IN_PROGRESS')
      .where('expires_at', 'is not', null)
      .where('expires_at', '<', now)
      .execute();

    const row = await db
      .selectFrom('quiz_attempts')
      .innerJoin('quizzes', 'quizzes.id', 'quiz_attempts.quiz_id')
      .innerJoin('subjects', 'subjects.id', 'quizzes.subject_id')
      .select([
        'quiz_attempts.id as attempt_id',
        'quiz_attempts.quiz_id',
        'quizzes.title as quiz_title',
        'subjects.name as subject_name',
        'quizzes.mode',
        'quiz_attempts.total_questions',
        'quiz_attempts.started_at',
        'quiz_attempts.expires_at'
      ])
      .where('quiz_attempts.user_id', '=', userId)
      .where('quiz_attempts.status', '=', 'IN_PROGRESS')
      .orderBy('quiz_attempts.started_at', 'desc')
      .executeTakeFirst();

    if (!row) return null;

    const answeredRow = await db
      .selectFrom('attempt_answers')
      .select(sql<string>`count(*)`.as('count'))
      .where('attempt_id', '=', row.attempt_id)
      .executeTakeFirst();

    return {
      ...row,
      answered_count: Number(answeredRow?.count ?? 0)
    };
  }

  /**
   * Khôi phục toàn bộ dữ liệu một lượt thi đang làm dở (câu hỏi theo đúng thứ tự cũ + đáp án nháp).
   */
  async resumeAttempt(attemptId: string) {
    const attempt = await db
      .selectFrom('quiz_attempts')
      .selectAll()
      .where('id', '=', attemptId)
      .executeTakeFirst();

    if (!attempt) throw new NotFoundError('Không tìm thấy lượt làm bài.');
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictError('Lượt thi này đã kết thúc.');
    }
    if (attempt.expires_at && new Date() > new Date(attempt.expires_at)) {
      await db
        .updateTable('quiz_attempts')
        .set({ status: 'TIMED_OUT' })
        .where('id', '=', attemptId)
        .execute();
      throw new ConflictError('Lượt thi đã hết thời gian làm bài.');
    }

    const quiz = await db
      .selectFrom('quizzes')
      .selectAll()
      .where('id', '=', attempt.quiz_id)
      .executeTakeFirst();

    if (!quiz) throw new NotFoundError('Không tìm thấy bài thi.');

    const questions = await db
      .selectFrom('quiz_questions')
      .innerJoin('questions', 'questions.id', 'quiz_questions.question_id')
      .select([
        'quiz_questions.display_order',
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.question_type',
        'questions.payload'
      ])
      .where('quiz_questions.quiz_id', '=', quiz.id)
      .orderBy('quiz_questions.display_order', 'asc')
      .execute();

    const questionIds = questions.map((q) => q.question_id);
    const options = questionIds.length > 0
      ? await db
          .selectFrom('question_options')
          .select(['id as option_id', 'question_id', 'option_label', 'content'])
          .where('question_id', 'in', questionIds)
          .execute()
      : [];

    const draftRows = await db
      .selectFrom('attempt_answers')
      .select(['question_id', 'selected_option_id', 'response'])
      .where('attempt_id', '=', attemptId)
      .execute();

    const durationSeconds =
      quiz.mode === 'PRACTICE'
        ? PRACTICE_TIME_LIMIT_SECONDS
        : quiz.time_limit_seconds || EXAM_TIME_LIMIT_SECONDS;

    const payload = this.buildAttemptPayload(quiz, attempt, durationSeconds, questions, options);
    return {
      ...payload,
      draft_answers: draftRows.map((d) => ({
        question_id: d.question_id,
        selected_option_id: d.selected_option_id,
        response: d.response ?? null
      }))
    };
  }

  /**
   * Huỷ một lượt thi đang làm dở (chỉ cho phép khi IN_PROGRESS).
   */
  async abandonAttempt(attemptId: string): Promise<void> {
    const deleted = await db
      .deleteFrom('quiz_attempts')
      .where('id', '=', attemptId)
      .where('status', '=', 'IN_PROGRESS')
      .returning('id')
      .executeTakeFirst();

    if (!deleted) {
      throw new NotFoundError('Không tìm thấy lượt thi đang làm dở để huỷ.');
    }
  }

  /**
   * Thống kê phân tích năng lực: xu hướng điểm, tỉ lệ đúng theo môn và theo độ khó.
   */
  async getAnalytics(userId = DEFAULT_USER_ID) {
    const recentAttempts = await db
      .selectFrom('quiz_attempts')
      .innerJoin('quizzes', 'quizzes.id', 'quiz_attempts.quiz_id')
      .innerJoin('subjects', 'subjects.id', 'quizzes.subject_id')
      .select([
        'quiz_attempts.id as attempt_id',
        'quizzes.title as quiz_title',
        'subjects.name as subject_name',
        'quiz_attempts.score_percentage',
        'quiz_attempts.started_at'
      ])
      .where('quiz_attempts.user_id', '=', userId)
      .where('quiz_attempts.status', '!=', 'IN_PROGRESS')
      .orderBy('quiz_attempts.started_at', 'desc')
      .limit(15)
      .execute();

    const bySubjectRows = await db
      .selectFrom('quiz_attempts')
      .innerJoin('quizzes', 'quizzes.id', 'quiz_attempts.quiz_id')
      .innerJoin('subjects', 'subjects.id', 'quizzes.subject_id')
      .select([
        'subjects.id as subject_id',
        'subjects.name as subject_name',
        sql<string>`count(${sql.ref('quiz_attempts.id')})`.as('attempt_count'),
        sql<string>`round(avg(${sql.ref('quiz_attempts.score_percentage')})::numeric, 1)`.as('avg_percentage')
      ])
      .where('quiz_attempts.user_id', '=', userId)
      .where('quiz_attempts.status', '!=', 'IN_PROGRESS')
      .groupBy(['subjects.id', 'subjects.name'])
      .orderBy('avg_percentage', 'asc')
      .execute();

    const byDifficultyRows = await db
      .selectFrom('attempt_answers')
      .innerJoin('quiz_attempts', 'quiz_attempts.id', 'attempt_answers.attempt_id')
      .innerJoin('questions', 'questions.id', 'attempt_answers.question_id')
      .select([
        'questions.difficulty',
        sql<string>`count(*)`.as('total'),
        sql<string>`sum(case when ${sql.ref('attempt_answers.is_correct')} then 1 else 0 end)`.as('correct')
      ])
      .where('quiz_attempts.user_id', '=', userId)
      .where('quiz_attempts.status', '!=', 'IN_PROGRESS')
      .where('questions.question_type', '!=', 'LIKERT')
      .groupBy('questions.difficulty')
      .execute();

    return {
      trend: [...recentAttempts].reverse().map((r) => ({
        attempt_id: r.attempt_id,
        quiz_title: r.quiz_title,
        subject_name: r.subject_name,
        score_percentage: Number(r.score_percentage),
        started_at: r.started_at
      })),
      by_subject: bySubjectRows.map((r) => ({
        subject_id: r.subject_id,
        subject_name: r.subject_name,
        attempt_count: Number(r.attempt_count),
        avg_percentage: Number(r.avg_percentage ?? 0)
      })),
      by_difficulty: byDifficultyRows.map((r) => {
        const total = Number(r.total);
        const correct = Number(r.correct ?? 0);
        return {
          difficulty: r.difficulty as 'EASY' | 'MEDIUM' | 'HARD',
          total,
          correct,
          accuracy_percentage: total > 0 ? Math.round((correct / total) * 100) : 0
        };
      })
    };
  }

  /**
   * Lấy lịch sử các lần thi
   */
  async getHistory(userId = DEFAULT_USER_ID) {
    return await db
      .selectFrom('quiz_attempts')
      .innerJoin('quizzes', 'quizzes.id', 'quiz_attempts.quiz_id')
      .select([
        'quiz_attempts.id as attempt_id',
        // Cần cho nút "Làm lại": client gọi /quizzes/:id/start, không cần tải lại câu hỏi.
        'quiz_attempts.quiz_id',
        'quizzes.title as quiz_title',
        'quizzes.mode',
        'quiz_attempts.status',
        'quiz_attempts.score_percentage',
        'quiz_attempts.correct_count',
        'quiz_attempts.total_questions',
        'quiz_attempts.started_at',
        'quiz_attempts.submitted_at'
      ])
      .where('quiz_attempts.user_id', '=', userId)
      .orderBy('quiz_attempts.started_at', 'desc')
      .limit(20)
      .execute();
  }

  /**
   * Danh mục môn học kèm số đề thi hiện có — dùng cho "Phòng thi" phân loại theo môn.
   */
  async listSubjects() {
    const rows = await db
      .selectFrom('subjects')
      .leftJoin('quizzes', 'quizzes.subject_id', 'subjects.id')
      .select([
        'subjects.id',
        'subjects.name',
        'subjects.description',
        'subjects.created_at',
        sql<string>`count(distinct ${sql.ref('quizzes.id')})`.as('quiz_count')
      ])
      .groupBy(['subjects.id', 'subjects.name', 'subjects.description', 'subjects.created_at'])
      .orderBy('subjects.name', 'asc')
      .execute();

    return rows.map((r) => ({ ...r, quiz_count: Number(r.quiz_count) }));
  }

  /** Các đề thi đã lưu thuộc một môn học, mới nhất lên đầu. */
  async listQuizzesBySubject(subjectId: string) {
    const subject = await db
      .selectFrom('subjects')
      .select(['id', 'name'])
      .where('id', '=', subjectId)
      .executeTakeFirst();

    if (!subject) {
      throw new NotFoundError('Không tìm thấy môn học.');
    }

    const quizzes = await db
      .selectFrom('quizzes')
      .selectAll()
      .where('subject_id', '=', subjectId)
      .orderBy('created_at', 'desc')
      .execute();

    return { subject, quizzes };
  }

  /**
   * Sửa đề thi: đổi tiêu đề và/hoặc chuyển sang môn học khác (tạo môn mới nếu tên chưa tồn tại).
   */
  async updateQuiz(quizId: string, input: { title?: string; subjectName?: string }) {
    return await db.transaction().execute(async (trx) => {
      const quiz = await trx
        .selectFrom('quizzes')
        .selectAll()
        .where('id', '=', quizId)
        .executeTakeFirst();

      if (!quiz) {
        throw new NotFoundError('Không tìm thấy đề thi.');
      }

      let subjectId = quiz.subject_id;
      if (input.subjectName !== undefined) {
        const subject = await this.getOrCreateSubject(trx, input.subjectName);
        subjectId = subject.id;
      }

      const [updated] = await trx
        .updateTable('quizzes')
        .set({
          title: input.title ?? quiz.title,
          subject_id: subjectId
        })
        .where('id', '=', quizId)
        .returningAll()
        .execute();

      return updated;
    });
  }

  /**
   * Xoá vĩnh viễn một đề thi: lượt thi (và câu trả lời liên quan) bị xoá cascade,
   * câu hỏi không còn gắn với đề thi nào khác cũng bị xoá để không để lại dữ liệu mồ côi.
   * Môn học được GIỮ LẠI (có thể vẫn chứa các đề thi khác).
   */
  async deleteQuiz(quizId: string): Promise<void> {
    await db.transaction().execute(async (trx) => {
      const quiz = await trx
        .selectFrom('quizzes')
        .select('id')
        .where('id', '=', quizId)
        .executeTakeFirst();

      if (!quiz) {
        throw new NotFoundError('Không tìm thấy đề thi.');
      }

      const links = await trx
        .selectFrom('quiz_questions')
        .select('question_id')
        .where('quiz_id', '=', quizId)
        .execute();
      const questionIds = links.map((l) => l.question_id);

      // quiz_attempts -> ON DELETE RESTRICT với quizzes, nên phải xoá trước;
      // attempt_answers cascade tự động theo attempt_id.
      await trx.deleteFrom('quiz_attempts').where('quiz_id', '=', quizId).execute();

      // quiz_questions cascade tự động khi xoá quizzes, nhưng xoá trước ở đây để
      // tính chính xác những câu hỏi nào trở thành "mồ côi" (không còn đề thi nào dùng).
      await trx.deleteFrom('quiz_questions').where('quiz_id', '=', quizId).execute();

      if (questionIds.length > 0) {
        const stillLinked = await trx
          .selectFrom('quiz_questions')
          .select('question_id')
          .where('question_id', 'in', questionIds)
          .execute();
        const stillLinkedIds = new Set(stillLinked.map((l) => l.question_id));
        const orphanIds = questionIds.filter((id) => !stillLinkedIds.has(id));

        // Xoá câu hỏi mồ côi -> cascade xoá question_options tương ứng.
        if (orphanIds.length > 0) {
          await trx.deleteFrom('questions').where('id', 'in', orphanIds).execute();
        }
      }

      await trx.deleteFrom('quizzes').where('id', '=', quizId).execute();
    });
  }

  /**
   * Tìm môn học theo tên (không phân biệt hoa/thường), tạo mới nếu chưa có.
   * Mã môn sinh ngẫu nhiên thay vì Date.now() để hai request đồng thời không trùng mã.
   * Nếu hai request cùng tạo một môn: ON CONFLICT để một bên thắng, vòng sau đọc lại.
   */
  private async getOrCreateSubject(trx: Transaction<DatabaseSchema>, subjectName: string) {
    for (let attempt = 0; attempt < MAX_SUBJECT_CREATE_TRIES; attempt++) {
      const existing = await trx
        .selectFrom('subjects')
        .selectAll()
        .where(sql<string>`lower(${sql.ref('name')})`, '=', subjectName.toLowerCase())
        .executeTakeFirst();

      if (existing) return existing;

      const [inserted] = await trx
        .insertInto('subjects')
        .values({
          code: `SUB_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          name: subjectName,
          description: `Môn học ${subjectName}`
        })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .execute();

      if (inserted) return inserted;
    }

    throw new ConflictError('Không thể tạo môn học, vui lòng thử lại.');
  }
}

const DISPLAY_LABELS = ['A', 'B', 'C', 'D'] as const;

/**
 * Dựng danh sách phương án để HIỂN THỊ: trộn thứ tự rồi đánh lại nhãn A,B,C,D liền mạch.
 *
 * Chấm điểm luôn dựa trên `option_id` nên đổi nhãn hiển thị là an toàn với
 * MCQ / MULTI_SELECT / TRUE_FALSE / FILL_BLANK.
 *
 * Hai loại KHÔNG được đánh lại nhãn, vì nhãn mang ý nghĩa dữ liệu:
 * - MATCHING: `payload.pairs` tham chiếu nhãn vế trái; đổi nhãn sẽ làm cặp bị lệch.
 * - ORDERING: `payload.correctOrder` là mảng nhãn; đổi nhãn sẽ làm mất thứ tự đúng.
 *   (Vẫn trộn thứ tự hiển thị, chỉ giữ nguyên nhãn gốc.)
 */
function buildDisplayOptions(
  options: Array<{ option_id: string; question_id: string; option_label: string; content: string }>,
  attemptId: string,
  questionId: string,
  questionType: QuestionType
): Array<{ option_id: string; label: string; content: string }> {
  const shuffled = shuffleOptions(options, attemptId, questionId);
  const keepOriginalLabels = questionType === 'MATCHING' || questionType === 'ORDERING';

  return shuffled.map((opt, index) => ({
    option_id: opt.option_id,
    label: keepOriginalLabels ? opt.option_label : DISPLAY_LABELS[index] ?? opt.option_label,
    content: opt.content
  }));
}

/**
 * Dựng cột phải của câu ghép đôi cho người dùng chọn.
 * Trộn thứ tự nhưng trả kèm `right_label` gốc — đáp án được chấm theo nhãn đó,
 * không theo vị trí hiển thị.
 */
export function buildMatchingRightColumn(
  payload: QuestionPayload | null,
  attemptId: string,
  questionId: string
): Array<{ right_label: string; content: string }> {
  const pairs = payload?.pairs ?? [];
  const items = pairs.map((p) => ({ option_id: `${p.left_label}`, right_label: p.right_label, content: p.right }));
  return shuffleOptions(items, attemptId, questionId).map(({ right_label, content }) => ({
    right_label,
    content
  }));
}
