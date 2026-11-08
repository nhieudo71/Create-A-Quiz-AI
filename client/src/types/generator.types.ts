export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';

/**
 * Các loại câu hỏi. Giữ đồng bộ với src/core/question-types.ts ở server.
 */
export type QuestionType =
  | 'MCQ'
  | 'MULTI_SELECT'
  | 'TRUE_FALSE'
  | 'FILL_BLANK'
  | 'MATCHING'
  | 'ORDERING'
  | 'LIKERT';

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Trắc nghiệm 1 đáp án',
  MULTI_SELECT: 'Nhiều đáp án đúng',
  TRUE_FALSE: 'Đúng / Sai',
  FILL_BLANK: 'Điền khuyết',
  MATCHING: 'Ghép đôi',
  ORDERING: 'Sắp xếp thứ tự',
  LIKERT: 'Thang đánh giá (Likert)'
};

export const QUESTION_TYPE_HINTS: Record<QuestionType, string> = {
  MCQ: 'Câu hỏi + 4 phương án, 1 đáp án đúng',
  MULTI_SELECT: 'Chọn từ 2 đáp án đúng trở lên',
  TRUE_FALSE: 'Mệnh đề Đúng/Sai',
  FILL_BLANK: 'Điền từ vào chỗ trống',
  MATCHING: 'Ghép cột trái với cột phải',
  ORDERING: 'Sắp xếp các bước theo thứ tự',
  LIKERT: 'Thang đánh giá mức độ (không chấm điểm)'
};

export interface QuestionOption {
  label: 'A' | 'B' | 'C' | 'D';
  content: string;
  is_correct: boolean;
}

export interface MatchingPair {
  left_label: 'A' | 'B' | 'C' | 'D';
  left: string;
  right_label: 'A' | 'B' | 'C' | 'D';
  right: string;
}

export interface QuestionPayload {
  pairs?: MatchingPair[];
  correctOrder?: Array<'A' | 'B' | 'C' | 'D'>;
  scale?: string[];
  stem?: string;
}

export interface QuestionItem {
  id?: string;
  content: string;
  difficulty: Difficulty;
  explanation: string;
  source_reference: string;
  question_type?: QuestionType;
  payload?: QuestionPayload | null;
  options: QuestionOption[];
}

export interface UploadDocumentResponse {
  filename: string;
  page_count: number;
  text_length: number;
  preview_text: string;
}

export interface GeneratorConfig {
  subjectName: string;
  targetCount: number; // 10, 20, 35, 50, 100
  difficultyMode: 'MIXED' | 'EASY' | 'HARD';
  questionTypes: QuestionType[];
}

export interface GenerationProgress {
  current: number;
  total: number;
  percent: number;
  status: 'IDLE' | 'PARSING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
  message: string;
}

export type GeneratorStep = 'UPLOAD' | 'CONFIG' | 'GENERATING' | 'REVIEW';
