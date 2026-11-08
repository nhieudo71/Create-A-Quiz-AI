import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from '@google/generative-ai';
import { AppError } from '../../../core/errors';
import { env } from '../../../config/env.config';
import { ProviderConfig } from '../../settings/settings.types';
import { ConnectionTestResult, AIProvider, GenerateContext, requireApiKey } from './types';
import { extractHttpStatus, withRetry } from './retry';

/**
 * Google Gemini.
 * Safety settings được mở hoàn toàn: tài liệu y khoa luôn chứa các từ như
 * "tử vong", "độc chất", "liều chết", "ung thư" và bộ lọc mặc định sẽ chặn oan.
 * Đây là công cụ học tập nội bộ, không phải nơi phát tán nội dung nguy hại.
 */
export class GeminiProvider implements AIProvider {
  readonly type = 'gemini' as const;
  readonly label = 'Google Gemini';

  constructor(private readonly config: ProviderConfig) {}

  private client(): GoogleGenerativeAI {
    return new GoogleGenerativeAI(requireApiKey(this.config));
  }

  async generateText(ctx: GenerateContext): Promise<string> {
    // Dùng SDK cho đường sinh câu hỏi: nó hỗ trợ responseSchema nên đầu ra
    // bám đúng cấu trúc hơn hẳn việc dặn bằng lời.
    const model = this.client().getGenerativeModel({
      model: this.config.model || env.GEMINI_MODEL,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: ctx.temperature,
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            questions: {
              type: SchemaType.ARRAY,
              items: {
                type: SchemaType.OBJECT,
                properties: {
                  content: { type: SchemaType.STRING },
                  difficulty: { type: SchemaType.STRING, enum: ['EASY', 'MEDIUM', 'HARD'] },
                  explanation: { type: SchemaType.STRING },
                  source_reference: { type: SchemaType.STRING },
                  source_quote: { type: SchemaType.STRING },
                  options: {
                    type: SchemaType.ARRAY,
                    items: {
                      type: SchemaType.OBJECT,
                      properties: {
                        label: { type: SchemaType.STRING, enum: ['A', 'B', 'C', 'D'] },
                        content: { type: SchemaType.STRING },
                        is_correct: { type: SchemaType.BOOLEAN }
                      },
                      required: ['label', 'content', 'is_correct']
                    }
                  }
                },
                required: ['content', 'difficulty', 'explanation', 'source_reference', 'source_quote', 'options']
              }
            }
          },
          required: ['questions']
        }
      }
    });

    try {
      // Thử lại khi Google báo quá tải (429/502/503). Không thử lại lỗi cấu hình
      // hay lỗi bộ lọc an toàn vì chúng sẽ hỏng y nguyên ở lần sau.
      const result = await withRetry(
        () => model.generateContent(ctx.prompt, { timeout: ctx.timeoutMs }),
        { attempts: 3 }
      );
      const response = await result.response;

      if (response.candidates?.[0]?.finishReason === 'SAFETY') {
        throw new AppError(
          'Tài liệu chứa nội dung bị bộ lọc an toàn AI tạm chặn. Hãy rà soát lại đoạn văn bản này.',
          422
        );
      }
      return response.text();
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(describeGeminiError(err), 502);
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const model = this.client().getGenerativeModel({ model: this.config.model || env.GEMINI_MODEL });
      // Nút "Kiểm tra kết nối" không nên thử lại: người dùng đang chờ kết quả
      // ngay, vài giây là đủ để biết khoá có dùng được hay không.
      const result = await model.generateContent('Trả lời đúng một chữ: OK', { timeout: 30_000 });
      const text = result.response.text().trim().slice(0, 40);
      return { ok: true, message: `Kết nối thành công. Phản hồi: "${text}"`, model: this.config.model };
    } catch (err: any) {
      return { ok: false, message: describeGeminiError(err), model: this.config.model };
    }
  }
}

/**
 * Dịch lỗi thô của SDK sang câu tiếng Việt nói rõ người dùng nên làm gì.
 *
 * Lỗi gốc từ Google là tiếng Anh và thường chỉ nói "503 Service Unavailable",
 * không cho biết đây là sự cố tạm thời hay cấu hình sai. Giữ nguyên văn bản gốc
 * sẽ khiến người dùng tưởng khoá API của mình hỏng.
 */
export function describeGeminiError(err: any): string {
  const status = extractHttpStatus(err);
  const raw = String(err?.message ?? '').trim();

  if (status === 503 || /experiencing high demand/i.test(raw)) {
    return (
      'Gemini đang quá tải tạm thời (mã 503) và không phản hồi sau vài lần thử lại. ' +
      'Đây là sự cố phía Google, không phải khoá API hay tài liệu của bạn. ' +
      'Chờ khoảng 1-2 phút rồi thử lại, hoặc chuyển sang nhà cung cấp AI khác trong tab Cài đặt.'
    );
  }
  if (status === 429) {
    return (
      'Đã vượt hạn mức gọi Gemini (mã 429). Chờ vài phút rồi thử lại, ' +
      'hoặc giảm số câu hỏi mỗi lần để dùng ít lượt hơn.'
    );
  }
  if (status === 401 || status === 403) {
    return `Khoá API Gemini không hợp lệ hoặc không có quyền dùng model này (mã ${status}). Kiểm tra lại khoá trong tab Cài đặt.`;
  }
  if (status === 404) {
    return (
      'Không tìm thấy model Gemini đã chọn (mã 404). Google định kỳ ngừng hỗ trợ model cũ; ' +
      'hãy đổi sang model mới hơn trong tab Cài đặt.'
    );
  }
  if (/aborted|timeout|timed out/i.test(raw)) {
    return (
      'Gemini không phản hồi kịp thời gian chờ. ' +
      'Tăng thời gian chờ trong Cài đặt, giảm số câu hỏi mỗi lần, hoặc thử model nhẹ hơn.'
    );
  }
  return `Lỗi Gemini: ${raw || 'không xác định'}`;
}
