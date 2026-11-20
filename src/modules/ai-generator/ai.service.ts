import { randomUUID } from 'crypto';
import { env } from '../../config/env.config';
import { AppError } from '../../core/errors';
import { QuestionType } from '../../core/question-types';
import { settingsStore } from '../settings/settings.store';
import { ProviderConfig } from '../settings/settings.types';
import { createProvider } from './providers/factory';
import {
  buildGenerationPrompt,
  DifficultyMode,
  extractJsonPayload,
  GeneratedQuestionItem,
  validateQuestions
} from './prompt';

export type { GeneratedQuestionItem, DifficultyMode };

/**
 * Điều phối việc sinh câu hỏi bằng AI: chọn nhà cung cấp đang hoạt động
 * (cấu hình trong Cài đặt), gọi nó, rồi xác thực đầu ra theo cùng một chuẩn
 * bất kể model nào trả lời.
 */
export class AIService {
  async generateBatch(
    textChunk: string,
    count: number,
    subjectName: string,
    difficultyMode: DifficultyMode = 'MIXED',
    questionTypes: QuestionType[] = ['MCQ']
  ): Promise<GeneratedQuestionItem[]> {
    const config = this.resolveActiveProvider();
    const provider = createProvider(config);
    const prompt = buildGenerationPrompt(textChunk, count, subjectName, difficultyMode, questionTypes);
    const timeoutMs = settingsStore.getRequestTimeoutMs();
    const temperature = settingsStore.getTemperature();

    const rawText = await provider.generateText({ prompt, temperature, timeoutMs });
    const payload = extractJsonPayload(rawText);
    return validateQuestions(payload);
  }

  /**
   * Giải thích chuyên sâu một câu hỏi: phân tích đáp án đúng và lý do từng phương án nhiễu sai.
   */
  async deepExplainQuestion(input: {
    content: string;
    options: Array<{ label: string; content: string; is_correct: boolean }>;
    explanation: string;
  }): Promise<string> {
    const config = this.resolveActiveProvider();
    const provider = createProvider(config);
    const timeoutMs = settingsStore.getRequestTimeoutMs();

    const optionsText = input.options
      .map((o) => `${o.label}. ${o.content} ${o.is_correct ? '(ĐÁP ÁN ĐÚNG)' : '(Nhiễu)'}`)
      .join('\n');

    const prompt = [
      'Bạn là giảng viên Y khoa. Hãy giải thích chuyên sâu, ngắn gọn và rõ ràng bằng tiếng Việt cho câu hỏi sau:',
      `Câu hỏi: ${input.content}`,
      `Các phương án:\n${optionsText}`,
      `Giải thích tóm tắt hiện có: ${input.explanation}`,
      'Yêu cầu trả lời theo 2 phần: (1) Cơ chế / lý do chọn đáp án đúng; (2) Giải thích ngắn gọn vì sao từng phương án nhiễu còn lại không đúng.'
    ].join('\n\n');

    return await provider.generateText({ prompt, temperature: 0.3, timeoutMs, responseFormat: 'text' });
  }

  /**
   * Tóm tắt và tổng hợp kiến thức y khoa cốt lõi từ văn bản tài liệu tải lên.
   */
  async summarizeDocument(textChunk: string, subjectName: string): Promise<string> {
    const config = this.resolveActiveProvider();
    const provider = createProvider(config);
    const timeoutMs = settingsStore.getRequestTimeoutMs();

    // Giới hạn độ dài để tránh vượt context limit
    const truncated = textChunk.slice(0, 35000);

    const prompt = [
      `Bạn là một giáo sư, chuyên gia y khoa đầu ngành phụ trách bộ môn "${subjectName}".`,
      'Hãy phân tích tài liệu y khoa dưới đây và lập bản tổng hợp kiến thức cốt lõi ôn thi trắc nghiệm theo định dạng Markdown chuẩn đẹp gồm các mục sau:',
      '# 📌 TỔNG HỢP KIẾN THỨC Y KHOA TRỌNG TÂM',
      '## 1. Khái Quát & Mục Tiêu Học Tập Cốt Lõi (Executive Summary)',
      '- Tóm tắt các định nghĩa, vai trò và phạm vi nội dung then chốt trong 3-5 gạch đầu dòng.',
      '## 2. Các Khái Niệm, Cơ Chế & Thuật Ngữ Mấu Chốt',
      '- Trình bày chi tiết cơ chế bệnh sinh, phân loại giải phẫu, cơ chế tác dụng dược lý.',
      '## 3. Bảng Ngọc Lâm Sàng (High-Yield Clinical Pearls)',
      '- Những điểm then chốt bắt buộc phải nhớ khi đi lâm sàng và làm bài thi trắc nghiệm.',
      '## 4. Các Cạm Bẫy Trắc Nghiệm Hay Gặp (Common Exam Traps)',
      '- Những điểm dễ nhầm lẫn giữa các bệnh lý / triệu chứng / chỉ định / chống chỉ định.',
      '',
      `--- NỘI DUNG TÀI LIỆU (${subjectName}) ---`,
      truncated
    ].join('\n\n');

    return await provider.generateText({ prompt, temperature: 0.3, timeoutMs, responseFormat: 'text' });
  }

  /**
   * Provider đang hoạt động theo cấu hình Cài đặt. Nếu người dùng chưa cấu hình
   * gì cả thì dùng GEMINI_API_KEY trong .env (hành vi cũ, để không phá vỡ các
   * bản cài đặt hiện có khi nâng cấp lên bản có đa nhà cung cấp).
   */
  private resolveActiveProvider(): ProviderConfig {
    const configured = settingsStore.getActiveProvider();
    if (configured) return configured;

    if (env.GEMINI_API_KEY) {
      return {
        id: randomUUID(),
        type: 'gemini',
        label: 'Google Gemini (.env)',
        model: env.GEMINI_MODEL,
        baseUrl: null,
        apiKey: env.GEMINI_API_KEY,
        enabled: true,
        oauth: null,
        createdAt: new Date().toISOString()
      };
    }

    throw new AppError(
      'Chưa cấu hình nhà cung cấp AI nào. Vào tab Cài đặt để thêm Gemini, OpenAI, Anthropic, Local AI... rồi thử lại.',
      400
    );
  }
}
