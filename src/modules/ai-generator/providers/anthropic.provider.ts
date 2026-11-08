import { ProviderConfig } from '../../settings/settings.types';
import { postJson } from './http';
import { AIProvider, ConnectionTestResult, GenerateContext, requireApiKey } from './types';

interface MessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic Claude (Messages API).
 * Claude không có tuỳ chọn ép JSON schema như Gemini/OpenAI nên dựa hoàn toàn
 * vào chỉ dẫn trong prompt + bóc tách chuỗi (xem prompt.ts: extractJsonPayload).
 */
export class AnthropicProvider implements AIProvider {
  readonly type = 'anthropic' as const;

  constructor(private readonly config: ProviderConfig) {}

  get label(): string {
    return this.config.label;
  }

  private baseUrl(): string {
    return (this.config.baseUrl?.trim() || ANTHROPIC_BASE_URL).replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': requireApiKey(this.config),
      'anthropic-version': ANTHROPIC_VERSION
    };
  }

  async generateText(ctx: GenerateContext): Promise<string> {
    const data = await postJson<MessagesResponse>(`${this.baseUrl()}/messages`, {
      headers: this.headers(),
      body: {
        model: this.config.model,
        max_tokens: 8192,
        temperature: ctx.temperature,
        system:
          'Bạn là chuyên gia khảo thí y khoa. Chỉ trả về JSON hợp lệ theo đúng cấu trúc được yêu cầu, không thêm lời dẫn, không dùng khối mã markdown.',
        messages: [{ role: 'user', content: ctx.prompt }]
      },
      timeoutMs: ctx.timeoutMs,
      providerLabel: this.label
    });

    const text = data.content?.find((block) => block.type === 'text')?.text;
    if (!text) {
      throw new Error(`${this.label} trả về phản hồi rỗng.`);
    }
    return text;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    try {
      const data = await postJson<MessagesResponse>(`${this.baseUrl()}/messages`, {
        headers: this.headers(),
        body: {
          model: this.config.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Trả lời đúng một chữ: OK' }]
        },
        timeoutMs: 30_000,
        providerLabel: this.label
      });
      const text = data.content?.find((b) => b.type === 'text')?.text?.trim().slice(0, 40) ?? '';
      return { ok: true, message: `Kết nối thành công. Phản hồi: "${text}"`, model: this.config.model };
    } catch (err: any) {
      return { ok: false, message: err?.message ?? 'Không kết nối được', model: this.config.model };
    }
  }
}
