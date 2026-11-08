import { QuestionItem } from '../types/generator.types';
import {
  StartAttemptResponse,
  SubmitAttemptResponse,
  ReviewAttemptResponse,
  HistoryEntry,
  SubjectSummary,
  SubjectQuizzesResponse,
  SavedQuiz,
  SubmitAnswerPayload,
  CheckAnswerResponse,
  AnswerResponse
} from '../types/quiz.types';
import { UNAUTHORIZED_MESSAGE, withAuthHeaders } from './http';

const REQUEST_TIMEOUT_MS = 30 * 1000;

/**
 * Gọi API và luôn trả lỗi thật cho người dùng.
 * Bài thi là dữ liệu y khoa: tuyệt đối không tự chấm điểm hay tự dựng đề
 * khi máy chủ không phản hồi — điểm phải do server quyết định.
 */
async function requestJson<T>(url: string, init: RequestInit, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: withAuthHeaders(init.headers),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
    }
    throw new Error('Không kết nối được tới máy chủ. Kiểm tra Backend đã khởi động chưa rồi thử lại.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new Error(UNAUTHORIZED_MESSAGE);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `${fallbackMessage} (Mã: ${response.status})`);
  }

  const json = await response.json().catch(() => null);
  if (!json || !json.success || json.data === undefined) {
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
  }
  return json.data as T;
}

export class QuizService {
  /**
   * Lưu bộ câu hỏi thành một đề thi trên server.
   * Server sinh id cho câu hỏi/đáp án nên đây là bước bắt buộc trước khi thi.
   */
  static async createQuiz(params: {
    title?: string;
    subjectName: string;
    mode: 'PRACTICE' | 'EXAM';
    instantFeedback?: boolean;
    questions: QuestionItem[];
  }): Promise<{ id: string }> {
    return requestJson<{ id: string }>(
      '/api/v1/quizzes',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: params.title,
          subject_name: params.subjectName,
          mode: params.mode,
          instant_feedback: params.instantFeedback,
          questions: params.questions.map((q) => ({
            content: q.content,
            difficulty: q.difficulty,
            explanation: q.explanation,
            source_reference: q.source_reference || null,
            question_type: q.question_type ?? 'MCQ',
            payload: q.payload ?? null,
            options: q.options
          }))
        })
      },
      'Không tạo được đề thi trên máy chủ'
    );
  }

  /**
   * Bắt đầu lượt thi. Server chốt thời gian bắt đầu và hạn nộp (expires_at),
   * đây là mốc giờ chuẩn — đồng hồ trên giao diện chỉ để hiển thị.
   */
  static async startAttempt(quizId: string): Promise<StartAttemptResponse> {
    return requestJson<StartAttemptResponse>(
      `/api/v1/quizzes/${quizId}/start`,
      { method: 'POST' },
      'Không bắt đầu được lượt thi'
    );
  }

  /**
   * Nộp bài. Điểm số do server chấm từ đáp án đúng trong CSDL.
   */
  static async submitAttempt(
    attemptId: string,
    answers: SubmitAnswerPayload[]
  ): Promise<SubmitAttemptResponse> {
    return requestJson<SubmitAttemptResponse>(
      `/api/v1/attempts/${attemptId}/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      },
      'Không nộp được bài thi'
    );
  }

  /**
   * Chấm ngay MỘT câu vừa trả lời để hiện đúng/sai + giải thích.
   * Không ghi vào CSDL — điểm chính thức chỉ chốt khi nộp bài.
   */
  static async checkAnswer(
    attemptId: string,
    questionId: string,
    response: AnswerResponse
  ): Promise<CheckAnswerResponse> {
    return requestJson<CheckAnswerResponse>(
      `/api/v1/attempts/${attemptId}/check`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: questionId,
          selected_option_id: response.option_id ?? null,
          response
        })
      },
      'Không chấm được câu trả lời'
    );
  }

  /** Xem lại đáp án + giải thích (server chỉ trả sau khi đã nộp). */
  static async reviewAttempt(attemptId: string): Promise<ReviewAttemptResponse> {
    return requestJson<ReviewAttemptResponse>(
      `/api/v1/attempts/${attemptId}/review`,
      { method: 'GET' },
      'Không tải được kết quả bài thi'
    );
  }

  /** Lịch sử các lượt thi đã lưu trong CSDL. */
  static async getHistory(): Promise<HistoryEntry[]> {
    return requestJson<HistoryEntry[]>(
      '/api/v1/attempts/history',
      { method: 'GET' },
      'Không tải được lịch sử thi'
    );
  }

  // -------------------------------------------------------------------------
  // Danh mục môn học & thư viện đề thi (Phòng thi)
  // -------------------------------------------------------------------------

  /** Danh mục môn học kèm số đề thi hiện có. */
  static async getSubjects(): Promise<SubjectSummary[]> {
    return requestJson<SubjectSummary[]>(
      '/api/v1/subjects',
      { method: 'GET' },
      'Không tải được danh mục môn học'
    );
  }

  /** Các đề thi đã lưu thuộc một môn học. */
  static async getQuizzesBySubject(subjectId: string): Promise<SubjectQuizzesResponse> {
    return requestJson<SubjectQuizzesResponse>(
      `/api/v1/subjects/${subjectId}/quizzes`,
      { method: 'GET' },
      'Không tải được danh sách đề thi'
    );
  }

  /** Đổi tên đề thi và/hoặc chuyển đề sang môn học khác. */
  static async updateQuiz(
    quizId: string,
    updates: { title?: string; subjectName?: string }
  ): Promise<SavedQuiz> {
    return requestJson<SavedQuiz>(
      `/api/v1/quizzes/${quizId}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: updates.title,
          subject_name: updates.subjectName
        })
      },
      'Không cập nhật được đề thi'
    );
  }

  /** Xoá vĩnh viễn một đề thi đã lưu (cùng các lượt thi liên quan). */
  static async deleteQuiz(quizId: string): Promise<void> {
    await requestJson<{ deleted: boolean }>(
      `/api/v1/quizzes/${quizId}`,
      { method: 'DELETE' },
      'Không xoá được đề thi'
    );
  }
}

