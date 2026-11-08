import { AppError } from '../../../core/errors';

/**
 * Thử lại các lời gọi AI khi nhà cung cấp báo quá tải.
 *
 * Gemini hay trả 503 "This model is currently experiencing high demand" theo
 * từng đợt ngắn. Trước đây một lần chạm đỉnh như vậy là hỏng cả batch sinh câu
 * hỏi, dù chỉ cần chờ vài giây là qua. Thử lại có kiểm soát giải quyết đúng
 * loại sự cố này mà không che mất lỗi cấu hình thật.
 */

/**
 * Mã HTTP nên thử lại.
 *
 * Chỉ gồm những mã mà nhà cung cấp TỪ CHỐI yêu cầu ngay từ đầu, chưa xử lý gì:
 *  - 429: vượt hạn mức tạm thời
 *  - 502/503: hạ tầng phía họ đang quá tải hoặc có sự cố
 *
 * Cố ý KHÔNG gồm:
 *  - 500: máy chủ có thể đã chạy xong mới lỗi, thử lại có thể bị tính phí hai lần
 *  - 504 / timeout cục bộ: không biết phía kia đã xử lý hay chưa
 *  - các mã 4xx còn lại (400/401/403/404): lỗi cấu hình, thử lại cũng hỏng y cũ
 */
export const TRANSIENT_STATUS: ReadonlySet<number> = new Set([429, 502, 503]);

export const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 800;
const DEFAULT_MAX_DELAY_MS = 8_000;

export function isTransientStatus(status: number | null | undefined): boolean {
  return typeof status === 'number' && TRANSIENT_STATUS.has(status);
}

/**
 * Lấy mã HTTP từ lỗi thô của SDK.
 *
 * `GoogleGenerativeAIFetchError` đặt mã ở `status`, nhiều SDK khác dùng
 * `statusCode`. Trả null với AppError của ta: `statusCode` ở đó đã được ánh xạ
 * sang mã riêng (phần lớn lỗi nhà cung cấp thành 502), nên dùng nó để quyết
 * định thử lại sẽ khiến mọi lỗi đều bị coi là "quá tải".
 */
export function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object' || err instanceof AppError) return null;
  const candidate = err as { status?: unknown; statusCode?: unknown };
  const value = candidate.status ?? candidate.statusCode;
  return typeof value === 'number' ? value : null;
}

/**
 * Chờ theo cấp số nhân, có jitter.
 *
 * Jitter cần thiết vì các batch sinh câu hỏi chạy song song: không có nó, cả
 * nhóm cùng quá tải sẽ thử lại đúng một thời điểm và lại cùng bị chặn.
 */
export function retryDelayMs(
  attempt: number,
  baseMs: number = DEFAULT_BASE_DELAY_MS,
  maxMs: number = DEFAULT_MAX_DELAY_MS
): number {
  const exponential = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
  return Math.round(exponential * (1 + Math.random() * 0.25));
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  /** Tổng số lần thử, tính cả lần đầu tiên. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Cho phép test chạy tức thì thay vì chờ thật. */
  sleep?: (ms: number) => Promise<void>;
  /** Mặc định: chỉ thử lại khi lỗi mang mã HTTP tạm thời. */
  isRetryable?: (err: unknown) => boolean;
}

/**
 * Chạy `operation`, thử lại khi lỗi thuộc loại tạm thời.
 * Lỗi không tạm thời được ném ra ngay từ lần đầu, không chờ vô ích.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_RETRY_ATTEMPTS);
  const wait = options.sleep ?? defaultSleep;
  const shouldRetry = options.isRetryable ?? ((err: unknown) => isTransientStatus(extractHttpStatus(err)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      await wait(retryDelayMs(attempt, options.baseDelayMs, options.maxDelayMs));
    }
  }
  throw lastError;
}
