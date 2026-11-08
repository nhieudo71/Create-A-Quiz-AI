import { ProviderConfig } from '../../settings/settings.types';
import { isTokenFresh, refreshOAuthTokens } from '../../settings/oauth.service';
import { QUESTION_JSON_SCHEMA } from '../prompt';
import { postJson } from './http';
import { AIProvider, ConnectionTestResult, GenerateContext } from './types';
import { AppError } from '../../../core/errors';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const CHATGPT_BASE_URL = 'https://chatgpt.com/backend-api/codex';

/**
 * ChatGPT qua phiên đăng nhập OAuth (không chính thức, xem oauth.service.ts).
 * Dùng access token Bearer thay vì khoá API, và cần header chatgpt-account-id.
 * Tự làm mới token khi gần hết hạn trước mỗi lần gọi.
 */
export class ChatGPTOAuthProvider implements AIProvider {
  readonly type = 'chatgpt-oauth' as const;

  constructor(private config: ProviderConfig) {}

  get label(): string {
    return this.config.label;
  }

  private baseUrl(): string {
    return (this.config.baseUrl?.trim() || CHATGPT_BASE_URL).replace(/\/+$/, '');
  }

  private async ensureFreshToken(): Promise<void> {
    if (isTokenFresh(this.config.oauth)) return;
    this.config = await refreshOAuthTokens(this.config);
  }

  private authHeaders(): Record<string, string> {
    if (!this.config.oauth?.accessToken) {
      throw new AppError(
        `"${this.config.label}" chưa đăng nhập ChatGPT. Hãy bấm "Đăng nhập ChatGPT" trong Cài đặt.`,
        401
      );
    }
    const headers: Record<string, string> = { Authorization: `Bearer ${this.config.oauth.accessToken}` };
    if (this.config.oauth.accountId) headers['chatgpt-account-id'] = this.config.oauth.accountId;
    return headers;
  }

  async generateText(ctx: GenerateContext): Promise<string> {
    await this.ensureFreshToken();

    const data = await postJson<ChatCompletionResponse>(`${this.baseUrl()}/chat/completions`, {
      headers: this.authHeaders(),
      body: {
        model: this.config.model,
        temperature: ctx.temperature,
        messages: [
          {
            role: 'system',
            content:
              'Bạn là chuyên gia khảo thí y khoa. Chỉ trả về JSON hợp lệ, không thêm lời dẫn, không dùng khối mã.'
          },
          { role: 'user', content: ctx.prompt }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'medical_questions', strict: false, schema: QUESTION_JSON_SCHEMA }
        }
      },
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
      await this.ensureFreshToken();
      const data = await postJson<ChatCompletionResponse>(`${this.baseUrl()}/chat/completions`, {
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
