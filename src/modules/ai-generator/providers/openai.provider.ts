import { ProviderConfig } from '../../settings/settings.types';
import { QUESTION_JSON_SCHEMA } from '../prompt';
import { postJson } from './http';
import { AIProvider, ConnectionTestResult, GenerateContext, requireApiKey } from './types';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * OpenAI và mọi dịch vụ theo chuẩn /chat/completions.
 * `openai-compatible` và `chatgpt-oauth` kế thừa lớp này và chỉ thay phần
 * xác thực / địa chỉ, nên giao thức chỉ được cài đặt ở một chỗ.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly type: 'openai' | 'openai-compatible' = 'openai';

  constructor(protected readonly config: ProviderConfig) {}

  get label(): string {
    return this.config.label;
  }

  protected baseUrl(): string {
    return this.config.baseUrl?.trim().replace(/\/+$/, '') ?? '';
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${requireApiKey(this.config)}` };
  }

  /** Đường dẫn chat completions; tách riêng để lớp con ghi đè. */
  protected chatPath(): string {
    return '/chat/completions';
  }

  /** Gửi response_format json_schema hay không (máy chủ tự dựng hay từ chối trường này). */
  protected supportsJsonSchema(): boolean {
    return true;
  }

  async generateText(ctx: GenerateContext): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.config.model,
      temperature: ctx.temperature,
      messages: [
        {
          role: 'system',
          content:
            'Bạn là chuyên gia khảo thí y khoa. Chỉ trả về JSON hợp lệ, không thêm lời dẫn, không dùng khối mã.'
        },
        { role: 'user', content: ctx.prompt }
      ]
    };

    if (this.supportsJsonSchema()) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'medical_questions', strict: false, schema: QUESTION_JSON_SCHEMA }
      };
    }

    const data = await postJson<ChatCompletionResponse>(`${this.baseUrl()}${this.chatPath()}`, {
      headers: this.authHeaders(),
      body,
      timeoutMs: ctx.timeoutMs,
      providerLabel: this.label
    });

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${this.label} trả về phản hồi rỗng.`);
    }
    return content;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const data = await postJson<ChatCompletionResponse>(`${this.baseUrl()}${this.chatPath()}`, {
        headers: this.authHeaders(),
        body: {
          model: this.config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Trả lời đúng một chữ: OK' }]
        },
        timeoutMs: 30_000,
        providerLabel: this.label
      });
      const text = data.choices?.[0]?.message?.content?.trim().slice(0, 40) ?? '';
      return { ok: true, message: `Kết nối thành công. Phản hồi: "${text}"`, model: this.config.model };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? 'Không kết nối được', model: this.config.model };
    }
  }
}

/**
 * Dịch vụ tương thích OpenAI do người dùng tự nhập địa chỉ (Groq, OpenRouter,
 * DeepSeek, vLLM, LM Studio...).
 * Không gửi response_format: nhiều máy chủ tự dựng trả 400 khi gặp trường này,
 * trong khi prompt đã đủ để model trả JSON.
 */
export class GenericOpenAICompatibleProvider extends OpenAICompatibleProvider {
  readonly type = 'openai-compatible' as const;

  protected authHeaders(): Record<string, string> {
    // Nhiều máy chủ cục bộ không yêu cầu khoá: chỉ gửi khi người dùng đã nhập
    const key = this.config.apiKey?.trim();
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  protected supportsJsonSchema(): boolean {
    return false;
  }
}

