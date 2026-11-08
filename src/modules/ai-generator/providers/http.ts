import { AppError } from '../../../core/errors';

export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  /** Nhãn hiển thị trong thông báo lỗi, ví dụ "OpenAI" */
  providerLabel: string;
}

/**
 * Gọi API JSON với timeout và thông báo lỗi đọc được.
 *
 * Điểm quan trọng: thông báo lỗi KHÔNG được chứa khoá API hay header xác thực.
 * Lỗi mạng được dịch sang tiếng Việt dễ hiểu vì người dùng cuối không đọc được
 * "ECONNREFUSED".
 */
export async function postJson<T>(url: string, options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new AppError(
        `${options.providerLabel} không phản hồi sau ${Math.round(options.timeoutMs / 1000)}s. ` +
          'Tăng thời gian chờ trong Cài đặt hoặc thử model nhẹ hơn.',
        504
      );
    }
    throw new AppError(
      `Không kết nối được tới ${options.providerLabel}. ` +
        'Kiểm tra địa chỉ máy chủ, kết nối mạng và việc dịch vụ đã chạy chưa.',
      503
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text();

  if (!response.ok) {
    throw new AppError(
      `${options.providerLabel} từ chối yêu cầu (${response.status}): ${summarizeErrorBody(rawText)}`,
      mapStatus(response.status)
    );
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    throw new AppError(`${options.providerLabel} trả về dữ liệu không phải JSON.`, 502);
  }
}

/** Cắt ngắn phần thân lỗi để không nhét cả trang HTML vào thông báo. */
export function summarizeErrorBody(rawText: string): string {
  if (!rawText) return 'không có nội dung trả về';
  try {
    const json = JSON.parse(rawText);
    const message =
      json?.error?.message ?? json?.error ?? json?.message ?? json?.detail ?? rawText;
    return String(typeof message === 'string' ? message : JSON.stringify(message)).slice(0, 300);
  } catch {
    return rawText.replace(/\s+/g, ' ').slice(0, 300);
  }
}

/**
 * Giữ nguyên mã ý nghĩa khi chuyển lỗi của nhà cung cấp sang mã của ta.
 * 401/403 là cấu hình sai (khoá hỏng) — người dùng cần biết để sửa, không phải lỗi hệ thống.
 */
function mapStatus(status: number): number {
  if (status === 401 || status === 403) return 401;
  if (status === 429) return 429;
  if (status === 404) return 404;
  return 502;
}
