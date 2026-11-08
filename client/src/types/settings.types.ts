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
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  defaultBaseUrl: string | null;
  defaultModel: string;
  hint: string;
  warning?: string;
}

export interface PublicProvider {
  id: string;
  type: ProviderType;
  label: string;
  model: string;
  baseUrl: string | null;
  hasApiKey: boolean;
  enabled: boolean;
  oauthConnected: boolean;
  oauthExpiresAt: number | null;
  createdAt: string;
}

export interface AISettings {
  activeProviderId: string | null;
  temperature: number;
  requestTimeoutMs: number;
}

export interface PublicSettings {
  version: number;
  ai: AISettings;
  providers: PublicProvider[];
  providerMeta: Record<ProviderType, ProviderMeta>;
  updatedAt?: string;
}

export interface CreateProviderInput {
  type: ProviderType;
  label: string;
  model?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  enabled?: boolean;
}

export interface UpdateProviderInput {
  label?: string;
  model?: string;
  baseUrl?: string | null;
  /** Chuỗi rỗng xoá khoá hiện có; undefined giữ nguyên khoá cũ */
  apiKey?: string | null;
  enabled?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  model?: string;
}

export interface BackupCounts {
  subjects: number;
  documents: number;
  questions: number;
  question_options: number;
  quizzes: number;
  quiz_questions: number;
  quiz_attempts: number;
  attempt_answers: number;
  [key: string]: number;
}
