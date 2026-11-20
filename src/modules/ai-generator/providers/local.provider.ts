import { ProviderConfig } from '../../settings/settings.types';
import { QUESTION_JSON_SCHEMA } from '../prompt';
import { postJson } from './http';
import { AIProvider, ConnectionTestResult, GenerateContext } from './types';

interface OllamaGenerateResponse {
  response?: string;
}

const LOCAL_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';

/**
 * AI chạy cục bộ qua Ollama (/api/generate).
 * Không cần khoá API: an toàn cho tài liệu y khoa nhạy cảm vì không rời khỏi máy.
 * Vẫn dùng `format` kiểu JSON Schema vì Ollama hỗ trợ cùng cú pháp với OpenAI.
 */
export class LocalAIProvider implements AIProvider {
  readonly type = 'local' as const;

  constructor(private readonly config: ProviderConfig) {}

  get label(): string {
    return this.config.label;
  }

  private baseUrl(): string {
    return (this.config.baseUrl?.trim() || LOCAL_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async generateText(ctx: GenerateContext): Promise<string> {
    const isText = ctx.responseFormat === 'text';
    const requestBody: Record<string, unknown> = {
      model: this.config.model,
      prompt: ctx.prompt,
      stream: false,
      options: { temperature: ctx.temperature }
    };
    if (!isText) {
      requestBody.format = QUESTION_JSON_SCHEMA;
    }

    const data = await postJson<OllamaGenerateResponse>(`${this.baseUrl()}/api/generate`, {
      body: requestBody,
      timeoutMs: ctx.timeoutMs,
      providerLabel: this.label
    });

    if (!data.response) {
      throw new Error(`${this.label} trả về phản hồi rỗng. Kiểm tra model đã được "ollama pull" chưa.`);
    }
    return data.response;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const data = await postJson<OllamaGenerateResponse>(`${this.baseUrl()}/api/generate`, {
        body: { model: this.config.model, prompt: 'Trả lời đúng một chữ: OK', stream: false },
        timeoutMs: 30_000,
        providerLabel: this.label
      });
      const text = data.response?.trim().slice(0, 40) ?? '';
      return { ok: true, message: `Kết nối thành công. Phản hồi: "${text}"`, model: this.config.model };
    } catch (err: any) {
      return {
        ok: false,
        message:
          `${err?.message ?? 'Không kết nối được'}. Kiểm tra Ollama đã chạy (ollama serve) ` +
          `và model "${this.config.model}" đã được tải (ollama pull ${this.config.model}).`,
        model: this.config.model
      };
    }
  }
}
