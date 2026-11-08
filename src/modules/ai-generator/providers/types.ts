import { AppError } from '../../../core/errors';
import { ProviderConfig, ProviderType } from '../../settings/settings.types';

export interface GenerateContext {
  prompt: string;
  temperature: number;
  timeoutMs: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  /** Model thực tế đã dùng để thử */
  model?: string;
}

/**
 * Hợp đồng chung cho mọi nguồn AI.
 * Thêm nhà cung cấp mới = thêm một lớp cài đặt interface này rồi đăng ký trong factory.
 * Phần còn lại của ứng dụng không cần biết đang gọi dịch vụ nào.
 */
export interface AIProvider {
  readonly type: ProviderType;
  readonly label: string;
  /** Sinh văn bản thô (kỳ vọng là JSON theo schema của prompt). */
  generateText(ctx: GenerateContext): Promise<string>;
  /** Gọi thử một yêu cầu rất nhỏ để xác nhận khoá/địa chỉ/model đúng. */
  testConnection(): Promise<ConnectionTestResult>;
}

/** Cấu hình sai (thiếu khoá, thiếu baseUrl) thì báo ngay, đừng gọi mạng rồi mới lỗi. */
export function requireApiKey(config: ProviderConfig): string {
  const key = config.apiKey?.trim();
  if (!key) {
    throw new AppError(`Chưa nhập khoá API cho "${config.label}".`, 400);
  }
  return key;
}

export function requireBaseUrl(config: ProviderConfig): string {
  const url = config.baseUrl?.trim();
  if (!url) {
    throw new AppError(`Chưa nhập địa chỉ máy chủ (baseUrl) cho "${config.label}".`, 400);
  }
  return url.replace(/\/+$/, '');
}
