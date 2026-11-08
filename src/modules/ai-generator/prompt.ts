import { AppError } from '../../core/errors';
import {
  QuestionPayload,
  QuestionType,
  QUESTION_TYPE_PROMPT
} from '../../core/question-types';

export interface GeneratedQuestionItem {
  content: string;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  explanation: string;
  source_reference: string | null;
  /** Đoạn văn bản NGUYÊN VĂN trong tài liệu làm căn cứ cho câu hỏi. */
  source_quote?: string | null;
  question_type?: QuestionType;
  payload?: QuestionPayload | null;
  options: Array<{
    label: 'A' | 'B' | 'C' | 'D';
    content: string;
    is_correct: boolean;
  }>;
}

export type DifficultyMode = 'MIXED' | 'EASY' | 'HARD';

const DIFFICULTY_INSTRUCTIONS: Record<DifficultyMode, string> = {
  MIXED:
    'Phân bổ độ khó theo tỉ lệ: khoảng 30% câu EASY (nhận biết/định nghĩa), 50% câu MEDIUM (hiểu, so sánh), 20% câu HARD (tình huống lâm sàng, chẩn đoán, tính toán liều).',
  EASY:
    'Ưu tiên câu hỏi mức EASY củng cố kiến thức cơ bản: định nghĩa, phân loại, cơ chế tác dụng cốt lõi. Không đặt câu hỏi tình huống phức tạp.',
  HARD:
    'Ưu tiên câu hỏi mức HARD: ca lâm sàng ngắn, chẩn đoán phân biệt, lựa chọn thuốc/phác đồ, tính liều và tương tác thuốc. Phần lớn câu phải ở mức HARD, tối đa 20% ở mức MEDIUM, không có câu EASY.'
};

/**
 * Prompt dùng chung cho MỌI nhà cung cấp AI.
 * Tách khỏi lớp gọi mạng để câu chữ hướng dẫn chỉ tồn tại ở một chỗ: đổi provider
 * không được làm thay đổi chất lượng câu hỏi sinh ra.
 */
export function buildGenerationPrompt(
  textChunk: string,
  count: number,
  subjectName: string,
  difficultyMode: DifficultyMode,
  questionTypes: QuestionType[] = ['MCQ']
): string {
  const types = questionTypes.length > 0 ? questionTypes : (['MCQ'] as QuestionType[]);
  const isMixedTypes = types.length > 1;

  const typeBlock = types.map((t) => `- ${t}: ${QUESTION_TYPE_PROMPT[t]}`).join('\n');

  const distribution = isMixedTypes
    ? `Chia đều ${count} câu cho ${types.length} loại câu hỏi ở trên (mỗi loại khoảng ${Math.max(
        1,
        Math.floor(count / types.length)
      )} câu). Trường "question_type" của mỗi câu phải ghi đúng một trong: ${types.join(', ')}.`
    : `Tất cả ${count} câu đều là loại "${types[0]}". Trường "question_type" của mỗi câu luôn là "${types[0]}".`;

  return `
Bạn là một Giáo sư kiêm Chuyên gia Khảo thí Y học hàng đầu.
Nhiệm vụ: Đọc kỹ tài liệu Y khoa dưới đây và biên soạn CHÍNH XÁC ${count} câu hỏi cho môn học: ${subjectName}.

LOẠI CÂU HỎI ĐƯỢC PHÉP:
${typeBlock}

${distribution}

NGUYÊN TẮC CHỐNG BỊA ĐẶT (QUAN TRỌNG NHẤT):
1. Mỗi câu hỏi PHẢI bắt nguồn từ một câu/đoạn cụ thể trong tài liệu. Chép NGUYÊN VĂN đoạn đó vào trường "source_quote".
2. Tuyệt đối KHÔNG dùng kiến thức ngoài tài liệu, kể cả khi bạn biết chắc nó đúng. Nếu tài liệu không nói tới, không được hỏi.
3. KHÔNG tự suy luận thêm số liệu (liều lượng, tỉ lệ, thời gian, chỉ số xét nghiệm) mà tài liệu không ghi rõ.
4. Nếu tài liệu không đủ nội dung để tạo đủ ${count} câu, hãy trả về SỐ CÂU ÍT HƠN nhưng mỗi câu đều có căn cứ. KHÔNG bịa thêm cho đủ số lượng.
5. "source_quote" phải là chuỗi ký tự xuất hiện y nguyên trong tài liệu, không diễn giải lại, không rút gọn bằng dấu "...".

YÊU CẦU BẮT BUỘC:
1. Số phương án: 4 phương án (A, B, C, D) cho tất cả các loại, TRỪ TRUE_FALSE chỉ có 2 phương án (A, B).
2. Đáp án nhiễu: phải là kiến thức cùng chủ đề nhưng tài liệu không khẳng định là đúng; không đưa đáp án nhiễu cũng đúng về mặt y khoa.
3. Lời giải thích (explanation): Phải chỉ rõ vì sao đáp án đúng chính xác, bám sát đoạn trích dẫn, không thêm kiến thức ngoài.
4. Trích dẫn (source_reference): Ghi vị trí đoạn trích (số trang, tên mục, hoặc số slide nếu tài liệu có đánh dấu).
5. Phân bố độ khó: ${DIFFICULTY_INSTRUCTIONS[difficultyMode]}
   Trường "difficulty" của mỗi câu phải phản ánh đúng mức độ thực tế của câu đó (EASY | MEDIUM | HARD).

Chỉ trả về JSON đúng cấu trúc sau, không kèm giải thích ngoài JSON:
{"questions":[{"content":"...","question_type":"MCQ","difficulty":"EASY","explanation":"...","source_reference":"...","source_quote":"...","payload":null,"options":[{"label":"A","content":"...","is_correct":true},{"label":"B","content":"...","is_correct":false},{"label":"C","content":"...","is_correct":false},{"label":"D","content":"...","is_correct":false}]}]}

Ví dụ payload theo loại (chỉ điền cho đúng loại, loại khác để null):
- MATCHING: "payload":{"pairs":[{"left_label":"A","left":"...","right":"..."},{"left_label":"B","left":"...","right":"..."},{"left_label":"C","left":"...","right":"..."},{"left_label":"D","left":"...","right":"..."}]}
- ORDERING: "payload":{"correctOrder":["C","A","D","B"]}
- LIKERT: "payload":{"scale":["Rất không đồng ý","Không đồng ý","Trung lập","Đồng ý","Rất đồng ý"]}

--- TÀI LIỆU Y KHOA NGUỒN ---
${textChunk}
    `;
}


/**
 * JSON Schema cho các nhà cung cấp hỗ trợ ép kiểu đầu ra (Gemini, OpenAI, Ollama).
 * Những nơi không hỗ trợ (Anthropic, OpenAI-Compatible) vẫn dùng prompt ở trên.
 */
export const QUESTION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          content: { type: 'string' },
          question_type: {
            type: 'string',
            enum: ['MCQ', 'MULTI_SELECT', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'ORDERING', 'LIKERT']
          },
          difficulty: { type: 'string', enum: ['EASY', 'MEDIUM', 'HARD'] },
          explanation: { type: 'string' },
          source_reference: { type: 'string' },
          source_quote: { type: 'string' },
          payload: {
            type: 'object',
            properties: {
              pairs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    left_label: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                    left: { type: 'string' },
                    right: { type: 'string' }
                  },
                  required: ['left_label', 'left', 'right']
                }
              },
              correctOrder: {
                type: 'array',
                items: { type: 'string', enum: ['A', 'B', 'C', 'D'] }
              },
              scale: { type: 'array', items: { type: 'string' } }
            }
          },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                content: { type: 'string' },
                is_correct: { type: 'boolean' }
              },
              required: ['label', 'content', 'is_correct']
            }
          }
        },
        required: ['content', 'question_type', 'difficulty', 'explanation', 'source_reference', 'source_quote', 'options']
      }
    }
  },
  required: ['questions']
} as const;


/**
 * Bóc JSON khỏi văn bản trả về.
 * Model nhỏ và model cục bộ thường bọc JSON trong ```json ... ``` hoặc thêm lời dẫn
 * dù đã dặn không làm vậy. Ném lỗi rõ ràng thay vì trả về mảng rỗng.
 */
export function extractJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new AppError('AI trả về nội dung rỗng.', 502);
  }

  const candidates: string[] = [trimmed];

  // Bỏ khối rào ```json ... ```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Lấy từ dấu { đầu tiên tới dấu } cuối cùng
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // thử ứng viên tiếp theo
    }
  }

  throw new AppError(
    'AI trả về nội dung không phải JSON hợp lệ. Hãy thử lại hoặc đổi sang model khác.',
    502
  );
}

/**
 * Xác thực nghiêm ngặt từng câu hỏi AI sinh ra.
 * Không tin dữ liệu từ model: sai cấu trúc thì báo lỗi, KHÔNG tự sửa thành câu hỏi
 * gần đúng — đề y khoa sai một đáp án là vô giá trị.
 */
export function validateQuestions(payload: unknown): GeneratedQuestionItem[] {
  const parsed = payload as { questions?: unknown };
  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new AppError('Định dạng dữ liệu trả về từ AI không đúng cấu trúc yêu cầu.', 502);
  }

  const validTypes: QuestionType[] = [
    'MCQ',
    'MULTI_SELECT',
    'TRUE_FALSE',
    'FILL_BLANK',
    'MATCHING',
    'ORDERING',
    'LIKERT'
  ];

  return parsed.questions.map((q: any) => {
    const options = q?.options;
    if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
      throw new AppError('Câu hỏi sinh ra phải có từ 2 đến 4 đáp án.', 502);
    }

    const type: QuestionType = validTypes.includes(q?.question_type) ? q.question_type : 'MCQ';
    const correctCount = options.filter((o: any) => o.is_correct === true).length;

    // Quy tắc đáp án đúng khác nhau theo loại, nên kiểm tra riêng thay vì một điều kiện chung.
    const optionCountOk = type === 'TRUE_FALSE' ? options.length === 2 : options.length === 4;
    if (!optionCountOk) {
      throw new AppError(`Câu hỏi loại ${type} có số đáp án không hợp lệ.`, 502);
    }

    if (type === 'MCQ' || type === 'TRUE_FALSE' || type === 'FILL_BLANK') {
      if (correctCount !== 1) {
        throw new AppError(`Câu hỏi loại ${type} phải có đúng 1 đáp án đúng.`, 502);
      }
    } else if (type === 'MULTI_SELECT') {
      if (correctCount < 2) {
        throw new AppError('Câu hỏi nhiều đáp án cần ít nhất 2 phương án đúng.', 502);
      }
    } else if (type === 'MATCHING') {
      const pairs = q?.payload?.pairs;
      if (!Array.isArray(pairs) || pairs.length !== 4) {
        throw new AppError('Câu ghép đôi thiếu payload.pairs với 4 cặp.', 502);
      }
    } else if (type === 'ORDERING') {
      const order = q?.payload?.correctOrder;
      if (!Array.isArray(order) || order.length !== 4 || new Set(order).size !== 4) {
        throw new AppError('Câu sắp xếp thiếu payload.correctOrder hợp lệ.', 502);
      }
    } else if (type === 'LIKERT') {
      const scale = q?.payload?.scale;
      if (!Array.isArray(scale) || scale.length < 2) {
        throw new AppError('Câu Likert thiếu payload.scale hợp lệ.', 502);
      }
    }

    return {
      content: String(q.content ?? ''),
      question_type: type,
      difficulty: q.difficulty,
      explanation: String(q.explanation ?? ''),
      source_reference: q.source_reference ? String(q.source_reference) : null,
      source_quote: q.source_quote ? String(q.source_quote) : null,
      payload: q?.payload ?? null,
      options: options.map((o: any) => ({
        label: o.label,
        content: String(o.content ?? ''),
        is_correct: o.is_correct === true
      }))
    } as GeneratedQuestionItem;
  });
}
