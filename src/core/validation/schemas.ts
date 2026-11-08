import { z } from 'zod';
import { BadRequestError } from '../errors';

const DEFAULT_EXPLANATION = 'Không có giải thích';

const QUESTION_TYPES = [
  'MCQ',
  'MULTI_SELECT',
  'TRUE_FALSE',
  'FILL_BLANK',
  'MATCHING',
  'ORDERING',
  'LIKERT'
] as const;

const matchingPairSchema = z.object({
  left_label: z.enum(['A', 'B', 'C', 'D']),
  left: z.string().trim().min(1).max(2000),
  // Nhãn vế phải: cần cho việc chấm điểm khi vế phải được trộn thứ tự.
  right_label: z.enum(['A', 'B', 'C', 'D']),
  right: z.string().trim().min(1).max(2000)
});

const payloadSchema = z
  .object({
    pairs: z.array(matchingPairSchema).max(4).optional(),
    correctOrder: z.array(z.enum(['A', 'B', 'C', 'D'])).max(4).optional(),
    scale: z.array(z.string().trim().min(1).max(200)).min(2).max(7).optional(),
    stem: z.string().max(2000).optional()
  })
  .optional()
  .nullable();

// ---------------------------------------------------------------------------
// Câu hỏi + đáp án (khớp ràng buộc của docs/DATABASE_SCHEMA.sql)
// ---------------------------------------------------------------------------
const optionSchema = z.object({
  label: z.enum(['A', 'B', 'C', 'D']),
  content: z.string().trim().min(1, 'Nội dung đáp án không được để trống').max(2000),
  is_correct: z.boolean()
});

export const questionSchema = z
  .object({
    content: z.string().trim().min(1, 'Nội dung câu hỏi không được để trống').max(5000),
    difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
    explanation: z
      .string()
      .trim()
      .max(10000)
      .default(DEFAULT_EXPLANATION)
      .transform((v) => v || DEFAULT_EXPLANATION),
    // Cột source_reference là VARCHAR(255): cắt bớt thay vì để DB báo lỗi
    source_reference: z
      .string()
      .nullish()
      .transform((v) => (v ? v.trim().slice(0, 255) || null : null)),
    question_type: z.enum(QUESTION_TYPES).default('MCQ'),
    payload: payloadSchema,
    options: z
      .array(optionSchema)
      .min(2, 'Mỗi câu hỏi phải có ít nhất 2 đáp án')
      .max(4, 'Mỗi câu hỏi tối đa 4 đáp án')
      .superRefine((opts, ctx) => {
        if (new Set(opts.map((o) => o.label)).size !== opts.length) {
          ctx.addIssue({ code: 'custom', message: 'Nhãn đáp án bị trùng nhau' });
        }
      })
  })
  .superRefine((q, ctx) => {
    const correctCount = q.options.filter((o) => o.is_correct).length;

    // Câu Đúng/Sai chỉ có 2 phương án A, B; các loại còn lại đúng 4.
    const expectedOptions = q.question_type === 'TRUE_FALSE' ? 2 : 4;
    if (q.options.length !== expectedOptions) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `Loại câu hỏi ${q.question_type} cần đúng ${expectedOptions} phương án`
      });
    }

    switch (q.question_type) {
      case 'MCQ':
      case 'TRUE_FALSE':
      case 'FILL_BLANK':
        if (correctCount !== 1) {
          ctx.addIssue({ code: 'custom', path: ['options'], message: 'Câu hỏi này phải có đúng 1 đáp án đúng' });
        }
        break;

      case 'MULTI_SELECT':
        if (correctCount < 2) {
          ctx.addIssue({ code: 'custom', path: ['options'], message: 'Câu nhiều đáp án cần ít nhất 2 phương án đúng' });
        }
        break;

      case 'MATCHING':
        if (!q.payload?.pairs || q.payload.pairs.length !== 4) {
          ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Câu ghép đôi cần đúng 4 cặp; payload.pairs không hợp lệ' });
        }
        break;

      case 'ORDERING': {
        const order = q.payload?.correctOrder;
        if (!order || order.length !== 4 || new Set(order).size !== 4) {
          ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Câu sắp xếp cần payload.correctOrder là hoán vị của A, B, C, D' });
        }
        break;
      }

      case 'LIKERT':
        if (!q.payload?.scale || q.payload.scale.length < 2) {
          ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Câu Likert cần payload.scale với ít nhất 2 mức' });
        }
        break;
    }
  });

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------
export const generateBodySchema = z.object({
  text_content: z
    .string({ required_error: 'Thiếu nội dung tài liệu (text_content)' })
    .refine((v) => v.trim().length >= 100, 'Nội dung tài liệu quá ngắn (dưới 100 ký tự) để AI trích xuất câu hỏi.'),
  // Giữ nguyên hành vi cũ: kẹp giá trị vào khoảng 5..100, mặc định 10
  target_count: z.coerce
    .number()
    .default(10)
    .transform((n) => Math.min(100, Math.max(5, Math.round(n) || 10))),
  subject_name: z
    .string()
    .trim()
    .max(150, 'Tên môn học tối đa 150 ký tự')
    .optional()
    .transform((v) => v || 'Y Khoa Tổng Quát'),
  // Độ khó mong muốn; trước đây UI gửi lên nhưng server bỏ qua hoàn toàn.
  difficulty_mode: z.enum(['MIXED', 'EASY', 'HARD']).default('MIXED'),
  // Các loại câu hỏi muốn sinh. Bỏ trống = chỉ MCQ (giữ hành vi cũ).
  question_types: z
    .array(z.enum(QUESTION_TYPES))
    .max(7)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : (['MCQ'] as const).slice()))
});

export const createQuizBodySchema = z.object({
  title: z.string().trim().max(255, 'Tiêu đề tối đa 255 ký tự').optional(),
  subject_name: z
    .string()
    .trim()
    .max(150, 'Tên môn học tối đa 150 ký tự')
    .optional()
    .transform((v) => v || 'Y Khoa'),
  mode: z.enum(['PRACTICE', 'EXAM']).default('EXAM'),
  // Hiện đáp án + giải thích ngay sau mỗi câu. Mặc định bật cho chế độ luyện tập.
  instant_feedback: z.boolean().optional(),
  questions: z
    .array(questionSchema)
    .min(1, 'Cần ít nhất 1 câu hỏi để tạo đề thi.')
    .max(100, 'Một đề thi tối đa 100 câu hỏi.')
});

export const uuidParamsSchema = z.object({
  id: z.string().uuid('Mã định danh không hợp lệ')
});

export const updateQuizBodySchema = z
  .object({
    title: z.string().trim().min(1, 'Tiêu đề không được để trống').max(255, 'Tiêu đề tối đa 255 ký tự').optional(),
    subject_name: z
      .string()
      .trim()
      .min(1, 'Tên môn học không được để trống')
      .max(150, 'Tên môn học tối đa 150 ký tự')
      .optional()
  })
  .refine((data) => data.title !== undefined || data.subject_name !== undefined, {
    message: 'Cần ít nhất một trường để cập nhật (title hoặc subject_name).'
  });

// Câu trả lời của các loại mới (nhiều đáp án, điền khuyết, ghép đôi, sắp xếp).
const answerResponseSchema = z
  .object({
    option_id: z.string().uuid().nullable().optional(),
    option_ids: z.array(z.string().uuid()).max(4).optional(),
    text: z.string().max(2000).nullable().optional(),
    pairs: z.record(z.string(), z.string()).optional(),
    order: z.array(z.string()).max(4).optional(),
    level: z.string().max(200).nullable().optional()
  })
  .nullable()
  .optional();

export const submitBodySchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.string().uuid('question_id không hợp lệ'),
        selected_option_id: z.string().uuid('selected_option_id không hợp lệ').nullable().optional(),
        response: answerResponseSchema
      })
    )
    .max(100, 'Tối đa 100 câu trả lời')
    .refine(
      (arr) => new Set(arr.map((a) => a.question_id)).size === arr.length,
      'Mỗi câu hỏi chỉ được trả lời một lần'
    )
});

// Kiểm tra MỘT câu trả lời ngay khi người dùng chọn (phản hồi tức thì).
// Không ghi vào CSDL: điểm chính thức vẫn do lần nộp bài quyết định.
export const checkAnswerBodySchema = z.object({
  question_id: z.string().uuid('question_id không hợp lệ'),
  selected_option_id: z.string().uuid('selected_option_id không hợp lệ').nullable().optional(),
  response: answerResponseSchema
});

// ---------------------------------------------------------------------------
// Helper: parse hoặc ném BadRequestError (HTTP 400) với thông điệp dễ đọc
// ---------------------------------------------------------------------------
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
    throw new BadRequestError(`${where}${issue.message}`);
  }
  return result.data;
}
