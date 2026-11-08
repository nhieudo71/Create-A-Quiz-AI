import { Generated } from 'kysely';

export interface SubjectTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface DocumentTable {
  id: Generated<string>;
  user_id: string;
  subject_id: string | null;
  original_filename: string;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  page_count: number;
  extracted_text_length: number;
  status: 'UPLOADED' | 'PARSING' | 'PROCESSED' | 'FAILED';
  created_at: Generated<Date>;
}

export interface QuestionTable {
  id: Generated<string>;
  document_id: string | null;
  subject_id: string;
  content: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  explanation: string;
  source_reference: string | null;
  question_type: Generated<string>;
  payload: unknown | null;
  is_deleted: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface QuestionOptionTable {
  id: Generated<string>;
  question_id: string;
  option_label: 'A' | 'B' | 'C' | 'D';
  content: string;
  is_correct: boolean;
  created_at: Generated<Date>;
}

export interface QuizTable {
  id: Generated<string>;
  title: string;
  subject_id: string;
  mode: 'PRACTICE' | 'EXAM';
  time_limit_seconds: number;
  total_questions: number;
  instant_feedback: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface QuizQuestionTable {
  quiz_id: string;
  question_id: string;
  display_order: number;
}

export interface QuizAttemptTable {
  id: Generated<string>;
  quiz_id: string;
  user_id: string;
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'TIMED_OUT';
  total_questions: number;
  correct_count: number;
  score_percentage: number;
  started_at: Generated<Date>;
  // NULL = không giới hạn thời gian (chế độ Ôn tập)
  expires_at: Date | null;
  submitted_at: Date | null;
}

export interface AttemptAnswerTable {
  id: Generated<string>;
  attempt_id: string;
  question_id: string;
  selected_option_id: string | null;
  // Đáp án dạng văn bản/chọn nhiều/thứ tự, lưu dạng JSON để không phải thêm cột
  // mỗi lần có loại câu hỏi mới.
  response: unknown | null;
  is_correct: boolean;
  answered_at: Generated<Date>;
}

export interface DatabaseSchema {
  subjects: SubjectTable;
  documents: DocumentTable;
  questions: QuestionTable;
  question_options: QuestionOptionTable;
  quizzes: QuizTable;
  quiz_questions: QuizQuestionTable;
  quiz_attempts: QuizAttemptTable;
  attempt_answers: AttemptAnswerTable;
}
