import { requestJson } from './quiz.service';

export interface StudyQuestionItem {
  question_id: string;
  content: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  explanation: string;
  source_reference: string | null;
  question_type: string;
  subject_id: string;
  subject_name: string;
  wrong_count?: number;
  correct_count?: number;
  interval_days?: number;
  is_flagged?: boolean | null;
  personal_note?: string | null;
  options: Array<{
    option_id: string;
    option_label: string;
    content: string;
    is_correct: boolean;
  }>;
}

export class StudyService {
  static async getMistakes(subjectId?: string): Promise<StudyQuestionItem[]> {
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    return requestJson<StudyQuestionItem[]>(
      `/api/v1/study/mistakes${qs}`,
      { method: 'GET' },
      'Không tải được danh sách câu hay sai'
    );
  }

  static async startMistakePractice(subjectId?: string, limit = 30): Promise<{
    quiz: { id: string };
    subject_name: string;
  }> {
    return requestJson(
      '/api/v1/study/mistakes/practice',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject_id: subjectId, limit })
      },
      'Không tạo được bài ôn tập câu sai'
    );
  }

  static async getSrsDue(subjectId?: string): Promise<StudyQuestionItem[]> {
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    return requestJson<StudyQuestionItem[]>(
      `/api/v1/study/srs-due${qs}`,
      { method: 'GET' },
      'Không tải được thẻ Flashcard đến hạn'
    );
  }

  static async reviewSrsCard(questionId: string, quality: 0 | 3 | 4 | 5): Promise<{
    question_id: string;
    interval_days: number;
    next_review_at: string;
  }> {
    return requestJson(
      '/api/v1/study/srs-review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, quality })
      },
      'Không lưu được kết quả ôn tập thẻ'
    );
  }

  static async composeQuiz(params: {
    subjectId: string;
    title?: string;
    mode: 'PRACTICE' | 'EXAM';
    totalQuestions: number;
    easyPct: number;
    mediumPct: number;
    hardPct: number;
  }): Promise<{ quiz: { id: string }; subject_name: string }> {
    return requestJson(
      '/api/v1/quizzes/compose',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: params.subjectId,
          title: params.title,
          mode: params.mode,
          total_questions: params.totalQuestions,
          easy_pct: params.easyPct,
          medium_pct: params.mediumPct,
          hard_pct: params.hardPct
        })
      },
      'Không tạo được đề thi tổng hợp'
    );
  }

  static async saveBookmark(
    questionId: string,
    isFlagged: boolean,
    personalNote: string | null
  ): Promise<{ question_id: string; is_flagged: boolean; personal_note: string | null }> {
    return requestJson(
      `/api/v1/questions/${questionId}/bookmark`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_flagged: isFlagged, personal_note: personalNote })
      },
      'Không lưu được đánh dấu / ghi chú'
    );
  }

  static async getBookmarked(subjectId?: string): Promise<StudyQuestionItem[]> {
    const qs = subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : '';
    return requestJson<StudyQuestionItem[]>(
      `/api/v1/questions/bookmarked${qs}`,
      { method: 'GET' },
      'Không tải được danh sách câu đã đánh dấu'
    );
  }
}
