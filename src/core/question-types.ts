/**
 * Các loại câu hỏi được hỗ trợ.
 *
 * Mọi loại dùng CHUNG một cột `questions.content` làm phần dẫn và bảng
 * `question_options` làm phương án — nên các loại mới không cần bảng riêng.
 * Trường `payload` (JSONB trên bảng questions) chứa phần dữ liệu riêng của loại
 * câu hỏi đó (ví dụ thứ tự đúng của câu "sắp xếp", cặp ghép đúng của câu
 * "ghép đôi", thang điểm của Likert).
 *
 * Quy ước về đáp án đúng theo từng loại:
 * - MCQ            : đúng 1 option có is_correct = true.
 * - MULTI_SELECT   : từ 2 option trở lên có is_correct = true.
 * - TRUE_FALSE     : 2 option, option "Đúng" có is_correct = true nếu mệnh đề đúng.
 * - FILL_BLANK     : 1 option có is_correct = true, nội dung là đáp án chuẩn.
 * - MATCHING       : option nhãn A,B,C,D là các vế trái; payload.pairs[i].right
 *                    là vế phải đúng của vế trái thứ i.
 * - ORDERING       : option nhãn A,B,C,D liệt kê các mục; payload.correctOrder là
 *                    mảng nhãn theo đúng thứ tự.
 * - LIKERT         : KHÔNG dùng để chấm điểm; payload.scale là các mức (1..n).
 */
export type QuestionType =
  | 'MCQ'
  | 'MULTI_SELECT'
  | 'TRUE_FALSE'
  | 'FILL_BLANK'
  | 'MATCHING'
  | 'ORDERING'
  | 'LIKERT';

/** Câu Likert là câu khảo sát, không có đáp án đúng/sai nên không tính điểm. */
export function isScorableType(type: QuestionType): boolean {
  return type !== 'LIKERT';
}

/** Một cặp ghép đôi của câu MATCHING. */
export interface MatchingPair {
  /** Nhãn vế trái, trùng với option_label. */
  left_label: 'A' | 'B' | 'C' | 'D';
  /** Vế trái (hiển thị). */
  left: string;
  /** Nhãn vế phải tương ứng (dùng để chấm khi người dùng chọn cặp). */
  right_label: 'A' | 'B' | 'C' | 'D';
  /** Vế phải đúng tương ứng. */
  right: string;
}

/** Dữ liệu riêng theo loại câu hỏi. Để trống (null) với các loại không cần. */
export interface QuestionPayload {
  /** MATCHING: danh sách cặp đúng. */
  pairs?: MatchingPair[];
  /** ORDERING: các nhãn theo thứ tự đúng. */
  correctOrder?: Array<'A' | 'B' | 'C' | 'D'>;
  /** LIKERT: các mức của thang đo, thấp đến cao. */
  scale?: string[];
  /** Câu hỏi dạng nhóm (dùng chung phần dẫn cho nhiều câu) — hiện chưa dùng, giữ chỗ. */
  stem?: string;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Trắc nghiệm 1 đáp án',
  MULTI_SELECT: 'Nhiều đáp án đúng',
  TRUE_FALSE: 'Đúng / Sai',
  FILL_BLANK: 'Điền khuyết',
  MATCHING: 'Ghép đôi',
  ORDERING: 'Sắp xếp thứ tự',
  LIKERT: 'Thang đánh giá (Likert)'
};

/** Mô tả ngắn dùng trong prompt hướng dẫn AI sinh câu hỏi. */
export const QUESTION_TYPE_PROMPT: Record<QuestionType, string> = {
  MCQ:
    'Câu hỏi trắc nghiệm 4 phương án, CHỈ 1 đáp án đúng nhất (is_correct: true), 3 phương án nhiễu hợp lý.',
  MULTI_SELECT:
    'Câu hỏi có 4 phương án, trong đó CÓ ÍT NHẤT 2 phương án đúng (is_correct: true). Ghi rõ trong phần dẫn "Chọn tất cả đáp án đúng".',
  TRUE_FALSE:
    'Một mệnh đề khẳng định rút từ tài liệu. Tạo đúng 2 phương án nhãn A và B: A = "Đúng", B = "Sai". Đặt is_correct: true ở phương án phản ánh đúng sự thật theo tài liệu.',
  FILL_BLANK:
    'Câu nhận định có một chỗ trống ký hiệu ______ (sáu gạch dưới). Tạo 4 phương án là các từ/cụm từ có thể điền; đúng 1 phương án đúng theo tài liệu.',
  MATCHING:
    'Cho danh sách các khái niệm ở cột trái. Mỗi phương án (A,B,C,D) là một khái niệm cột trái; trường payload.pairs liệt kê cặp left/right đúng. Đặt is_correct: true cho TẤT CẢ phương án (vì đáp án đúng được chấm theo payload.pairs).',
  ORDERING:
    'Liệt kê 4 bước/sự kiện (A,B,C,D) đang bị xáo trộn thứ tự. payload.correctOrder ghi thứ tự đúng. Đặt is_correct: true cho TẤT CẢ phương án (chấm theo correctOrder).',
  LIKERT:
    'Câu khảo sát thái độ/mức độ tự tin, KHÔNG có đáp án đúng. payload.scale ghi các mức (vd 5 mức). Đặt is_correct: false cho mọi phương án.'
};
