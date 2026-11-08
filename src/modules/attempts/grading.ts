import {
  QuestionPayload,
  QuestionType,
  isScorableType
} from '../../core/question-types';

/**
 * Chấm điểm một câu trả lời.
 *
 * Tách riêng khỏi service để có một nơi duy nhất quyết định "thế nào là đúng" cho
 * mọi loại câu hỏi. Chấm điểm sai im lặng là lỗi nguy hiểm nhất của ứng dụng thi
 * cử — đề y khoa chấm sai khiến người học ghi nhớ kiến thức sai.
 */

export interface GradableOption {
  id: string;
  label: string;
  content: string;
  is_correct: boolean;
}

export interface GradableQuestion {
  question_type: QuestionType;
  payload: QuestionPayload | null;
  options: GradableOption[];
}

/** Câu trả lời thô của người dùng, hình dạng khác nhau theo loại câu hỏi. */
export interface AnswerResponse {
  /** MCQ, TRUE_FALSE */
  option_id?: string | null;
  /** MULTI_SELECT */
  option_ids?: string[] | null;
  /** FILL_BLANK */
  text?: string | null;
  /** MATCHING: left_label -> right_label */
  pairs?: Record<string, string> | null;
  /** ORDERING: thứ tự nhãn người dùng sắp xếp */
  order?: string[] | null;
  /** LIKERT: mức được chọn */
  level?: string | null;
}

export interface GradeResult {
  isCorrect: boolean;
  /** Chuỗi rỗng khi không có đáp án (LIKERT hoặc câu bỏ trống). */
  idCorrectOptionIds: string[];
}

/** Chuẩn hoá để so sánh "Đau đầu" với "đau đầu " và bỏ khác biệt dấu tiếng Việt. */
function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function gradeAnswer(question: GradableQuestion, response: AnswerResponse): GradeResult {
  const correctIds = question.options.filter((o) => o.is_correct).map((o) => o.id);

  // Likert là câu khảo sát: không có đáp án đúng nên luôn 0 điểm, không tính vào mẫu số.
  if (!isScorableType(question.question_type)) {
    return { isCorrect: false, idCorrectOptionIds: [] };
  }

  switch (question.question_type) {
    case 'MCQ':
    case 'TRUE_FALSE': {
      const chosen = response.option_id;
      if (!chosen) return { isCorrect: false, idCorrectOptionIds: correctIds };
      return { isCorrect: correctIds.includes(chosen), idCorrectOptionIds: correctIds };
    }

    case 'MULTI_SELECT': {
      const chosen = response.option_ids ?? [];
      if (chosen.length === 0) return { isCorrect: false, idCorrectOptionIds: correctIds };
      // Đúng khi chọn đủ và không thừa: so sánh hai tập hợp.
      const chosenSet = new Set(chosen);
      const correctSet = new Set(correctIds);
      const sameSize = chosenSet.size === correctSet.size;
      const sameMembers = [...chosenSet].every((id) => correctSet.has(id));
      return { isCorrect: sameSize && sameMembers, idCorrectOptionIds: correctIds };
    }

    case 'FILL_BLANK': {
      const typed = (response.text ?? '').trim();
      if (!typed) return { isCorrect: false, idCorrectOptionIds: correctIds };
      // Đáp án chuẩn nằm ở option có is_correct; chấp nhận khác biệt hoa/thường và dấu.
      const answer = question.options.find((o) => o.is_correct)?.content ?? '';
      const isCorrect = normalizeText(typed) === normalizeText(answer);
      return { isCorrect, idCorrectOptionIds: correctIds };
    }

    case 'MATCHING': {
      const pairs = question.payload?.pairs ?? [];
      const chosen = response.pairs ?? {};
      if (pairs.length === 0 || Object.keys(chosen).length === 0) {
        return { isCorrect: false, idCorrectOptionIds: correctIds };
      }
      // Tất cả các cặp phải khớp mới tính là đúng.
      const allMatch = pairs.every((p) => chosen[p.left_label] === p.right_label);
      return { isCorrect: allMatch, idCorrectOptionIds: correctIds };
    }

    case 'ORDERING': {
      const expected = question.payload?.correctOrder ?? [];
      const chosen = response.order ?? [];
      if (expected.length === 0 || chosen.length !== expected.length) {
        return { isCorrect: false, idCorrectOptionIds: correctIds };
      }
      const isCorrect = expected.every((label, i) => chosen[i] === label);
      return { isCorrect, idCorrectOptionIds: correctIds };
    }

    default:
      return { isCorrect: false, idCorrectOptionIds: correctIds };
  }
}

/** Câu trả lời có nội dung thật sự (dùng để đếm "đã làm" và tính điểm). */
export function hasResponse(response: AnswerResponse | null | undefined): boolean {
  if (!response) return false;
  if (response.option_id) return true;
  if (response.text && response.text.trim()) return true;
  if (response.level) return true;
  if (response.option_ids && response.option_ids.length > 0) return true;
  if (response.order && response.order.length > 0) return true;
  if (response.pairs && Object.keys(response.pairs).length > 0) return true;
  return false;
}
