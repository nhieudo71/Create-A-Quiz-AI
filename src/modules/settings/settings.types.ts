import { z } from 'zod';

/**
 * Các nguồn AI được hỗ trợ.
 * `openai-compatible` dùng chung giao thức với `openai` nhưng trỏ tới baseUrl khác
 * (Groq, OpenRouter, DeepSeek, vLLM, LM Studio...), nên tách tên để giao diện
 * gợi ý đúng và để người dùng hiểu mình đang cấu hình cái gì.
 */
export const PROVIDER_TYPES = [
  'gemini',
  'openai',
  'anthropic',
  'openai-compatible',
  'local',
  'chatgpt-oauth'
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface ProviderMeta {
  label: string;
  /** Có bắt buộc khoá API không (Local AI và ChatGPT OAuth thì không) */
  requiresApiKey: boolean;
  /** Có bắt buộc người dùng nhập baseUrl không */
  requiresBaseUrl: boolean;
  defaultBaseUrl: string | null;
  defaultModel: string;
  /** Gợi ý hiển thị dưới ô nhập trong giao diện */
  hint: string;
  /** Cảnh báo hiển thị nổi bật (dùng cho luồng không chính thức) */
  warning?: string;
}

/**
 * Thông tin tĩnh của từng loại nhà cung cấp. Máy chủ trả bảng này cho giao diện
 * để nhãn/giá trị mặc định chỉ tồn tại ở MỘT nơi, tránh client và server lệch nhau.
 */
export const PROVIDER_META: Record<ProviderType, ProviderMeta> = {
  gemini: {
    label: 'Google Gemini',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultBaseUrl: null,
    defaultModel: 'gemini-2.5-flash',
    hint: 'Lấy khoá tại aistudio.google.com/apikey. Hỗ trợ ràng buộc JSON schema nên đầu ra ổn định nhất.'
  },
  openai: {
    label: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    hint: 'Khoá bắt đầu bằng "sk-", lấy tại platform.openai.com/api-keys.'
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    hint: 'Khoá bắt đầu bằng "sk-ant-", lấy tại console.anthropic.com.'
  },
  'openai-compatible': {
    label: 'OpenAI Compatible',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    hint: 'Bất kỳ dịch vụ nào theo chuẩn /chat/completions: Groq, OpenRouter, DeepSeek, vLLM, LM Studio. Để trống khoá nếu máy chủ không yêu cầu.'
  },
  local: {
    label: 'Local AI (Ollama)',
    requiresApiKey: false,
    requiresBaseUrl: false,
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:7b',
    hint: 'Chạy hoàn toàn trên máy bạn, không gửi tài liệu y khoa ra ngoài. Cần cài Ollama và tải model trước (ollama pull <model>).'
  },
  'chatgpt-oauth': {
    label: 'ChatGPT OAuth (thử nghiệm)',
    requiresApiKey: false,
    requiresBaseUrl: false,
    defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
    defaultModel: 'gpt-5',
    hint: 'Đăng nhập bằng tài khoản ChatGPT Plus/Pro thay vì trả tiền theo token.',
    warning:
      'Đây là luồng KHÔNG chính thức, dùng chung điểm cuối với Codex CLI. OpenAI có thể thay đổi hoặc chặn bất cứ lúc nào, và việc dùng ngoài công cụ chính thức có thể vi phạm điều khoản dịch vụ. Hãy dùng khoá API nếu cần sự ổn định.'
  }
};

const oauthTokensSchema = z.object({
  accessToken: z.string().max(4000).nullish(),
  refreshToken: z.string().max(4000).nullish(),
  /** Mốc hết hạn, tính bằng mili-giây kể từ epoch */
  expiresAt: z.number().int().nullish(),
  /** Mã tài khoản ChatGPT, cần gửi kèm header khi gọi backend */
  accountId: z.string().max(200).nullish()
});

export type OAuthTokens = z.infer<typeof oauthTokensSchema>;

export const providerConfigSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(PROVIDER_TYPES),
  label: z.string().trim().min(1, 'Tên hiển thị không được để trống').max(80),
  model: z.string().trim().min(1, 'Tên model không được để trống').max(160),
  // null = dùng giá trị mặc định của loại provider
  baseUrl: z.string().trim().max(500).nullish(),
  apiKey: z.string().max(1000).nullish(),
  enabled: z.boolean().default(true),
  oauth: oauthTokensSchema.nullish(),
  createdAt: z.string()
});

export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const aiSettingsSchema = z.object({
  /** null = chưa chọn; khi đó dùng provider bật đầu tiên hoặc GEMINI_API_KEY trong .env */
  activeProviderId: z.string().uuid().nullable().default(null),
  /** Nhiệt độ thấp giúp bám sát tài liệu y khoa, hạn chế ảo giác */
  temperature: z.number().min(0).max(2).default(0.2),
  requestTimeoutMs: z
    .number()
    .int()
    .min(5_000)
    .max(600_000)
    .default(180_000)
});

export type AISettings = z.infer<typeof aiSettingsSchema>;

export const settingsSchema = z.object({
  version: z.number().int().default(1),
  ai: aiSettingsSchema.default({ activeProviderId: null, temperature: 0.2, requestTimeoutMs: 180_000 }),
  providers: z.array(providerConfigSchema).default([]),
  updatedAt: z.string().optional()
});

export type Settings = z.infer<typeof settingsSchema>;

/** Bản đã che bí mật, an toàn để gửi xuống giao diện. */
export interface PublicProvider {
  id: string;
  type: ProviderType;
  label: string;
  model: string;
  baseUrl: string | null;
  /** Chỉ cho biết đã có khoá hay chưa — KHÔNG bao giờ gửi khoá thật xuống trình duyệt */
  hasApiKey: boolean;
  enabled: boolean;
  /** Trạng thái đăng nhập OAuth, cũng chỉ là cờ boolean */
  oauthConnected: boolean;
  oauthExpiresAt: number | null;
  createdAt: string;
}

export interface PublicSettings {
  version: number;
  ai: AISettings;
  providers: PublicProvider[];
  /** Bảng meta để giao diện dựng form mà không cần hardcode */
  providerMeta: Record<ProviderType, ProviderMeta>;
  updatedAt?: string;
}
