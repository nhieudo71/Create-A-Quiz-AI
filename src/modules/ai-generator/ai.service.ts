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
