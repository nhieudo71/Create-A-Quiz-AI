import { Difficulty, QuestionPayload, QuestionType } from './generator.types';

// ---------------------------------------------------------------------------
// Kiểu dữ liệu khớp chính xác với phản hồi của Backend (src/modules/attempts).
// Mọi id ở đây do server sinh (UUID) — KHÔNG trùng với index mảng câu hỏi.
// ---------------------------------------------------------------------------

export interface AttemptOption {
  option_id: string;
  label: string;
  content: string;
}

export interface AttemptQuestion {
  display_order: number;
  question_id: string;
  content: string;
  difficulty: Difficulty;
  question_type: QuestionType;
  payload: QuestionPayload | null;
  options: AttemptOption[];
}

export interface StartAttemptResponse {
  attempt_id: string;
  quiz_id: string;
  title: string;
  mode: 'PRACTICE' | 'EXAM';
  /** 0 = không giới hạn thời gian (chế độ Ôn tập) */
  time_limit_seconds: number;
  started_at: string;
  /** null = không có hạn nộp */
  expires_at: string | null;
  total_questions: number;
  /** Bật = hiện đáp án + giải thích ngay sau khi trả lời từng câu */
  instant_feedback: boolean;
  questions: AttemptQuestion[];
}

/**
 * Câu trả lời gửi lên server. Hình dạng thay đổi theo loại câu hỏi.
 * MCQ/TRUE_FALSE dùng `option_id`; các loại khác dùng đúng trường tương ứng.
 */
export interface AnswerResponse {
  option_id?: string | null;
  option_ids?: string[] | null;
  text?: string | null;
  pairs?: Record<string, string> | null;
  order?: string[] | null;
  level?: string | null;
}

export interface SubmitAnswerPayload {
  question_id: string;
  selected_option_id?: string | null;
  response?: AnswerResponse | null;
}

export interface SubmitAttemptResponse {
  attempt_id: string;
  status: 'SUBMITTED' | 'TIMED_OUT';
  correct_count: number;
  total_questions: number;
  unanswered_count: number;
  score_percentage: number;
  time_spent_seconds: number;
  is_expired: boolean;
}

/** Kết quả chấm tức thì một câu (không ghi CSDL). */
export interface CheckAnswerResponse {
  question_id: string;
  question_type: QuestionType;
  is_correct: boolean;
  explanation: string;
  source_reference: string | null;
  payload: QuestionPayload | null;
  correct_option_ids: string[];
}

export interface ReviewOption extends AttemptOption {
  is_correct: boolean;
}

export interface MatchingRightItem {
  right_label: string;
  content: string;
}

export interface ReviewDetail {
  question_id: string;
  content: string;
  difficulty: Difficulty;
  explanation: string;
  source_reference: string | null;
  question_type: QuestionType;
  payload: QuestionPayload | null;
  selected_option_id: string | null;
  response: string | null;
  is_correct: boolean;
  options: ReviewOption[];
  matching_right_column: MatchingRightItem[];
}

export interface ReviewAttemptResponse {
  attempt_id: string;
  status: 'SUBMITTED' | 'TIMED_OUT';
  score_percentage: number;
  correct_count: number;
  total_questions: number;
  started_at: string;
  submitted_at: string | null;
  details: ReviewDetail[];
}

export interface HistoryEntry {
  attempt_id: string;
  quiz_id: string;
  quiz_title: string;
  mode: 'PRACTICE' | 'EXAM';
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT';
  score_percentage: number;
  correct_count: number;
  total_questions: number;
  started_at: string;
  submitted_at: string | null;
}

// ---------------------------------------------------------------------------
// Danh mục môn học & thư viện đề thi (Phòng thi)
// ---------------------------------------------------------------------------
export interface SubjectSummary {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  quiz_count: number;
}

export interface SavedQuiz {
  id: string;
  title: string;
  subject_id: string;
  mode: 'PRACTICE' | 'EXAM';
  time_limit_seconds: number;
  total_questions: number;
  created_at: string;
}

export interface SubjectQuizzesResponse {
  subject: { id: string; name: string };
  quizzes: SavedQuiz[];
}
