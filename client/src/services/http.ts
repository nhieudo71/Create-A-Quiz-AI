/**
 * Xác thực phía client.
 *
 * Máy chủ chặn mọi route /api/* khi biến APP_AUTH_TOKEN được đặt, và yêu cầu header
 * `x-app-token`. Token được lấy theo thứ tự ưu tiên:
 *   1. Electron preload (desktop): token do tiến trình main sinh ra mỗi lần chạy.
 *   2. /app-config.json (bản web/Docker chạy cùng origin): token do chính máy chủ công bố.
 *   3. Không có token: chế độ phát triển cục bộ, máy chủ không bật xác thực.
 *
 * Token được đọc đúng một lần rồi dùng lại cho mọi request.
 */

const TOKEN_HEADER = 'x-app-token';
const AUTH_TOKEN_TIMEOUT_MS = 5 * 1000;

// Giới hạn dung lượng do máy chủ công bố trong /app-config.json. Giữ một nguồn
// duy nhất để thông báo lỗi ở client và cấu hình multipart của server không lệch nhau.
// Mặc định khớp giá trị mặc định của server khi chưa đọc được cấu hình.
let maxFileSizeMb = 500;

export function getMaxFileSizeMb(): number {
  return maxFileSizeMb;
}

export function setMaxFileSizeMb(value: unknown): void {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    maxFileSizeMb = value;
  }
}

interface ElectronBridge {
  getAuthToken?: () => string | Promise<string>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge & Record<string, unknown>;
  }
}

let cachedToken: string | null = null;
let pending: Promise<string | null> | null = null;

async function readFromElectron(): Promise<string | null> {
  const bridge = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!bridge || typeof bridge.getAuthToken !== 'function') return null;
  try {
    const token = await bridge.getAuthToken();
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

async function readFromServer(): Promise<string | null> {
  // Có timeout: nếu máy chủ treo, giao diện vẫn phải hiển thị thay vì màn hình trắng.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_TOKEN_TIMEOUT_MS);
  try {
    const response = await fetch('/app-config.json', {
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) return null;
    const json = await response.json().catch(() => null);
    setMaxFileSizeMb(json?.data?.maxFileSizeMb);
    const token = json?.data?.authToken;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Nạp token (chỉ chạy một lần, các lần sau trả về cùng một promise).
 * Không bao giờ ném lỗi: thiếu token thì ứng dụng vẫn chạy ở chế độ không xác thực.
 */
export function resolveAuthToken(): Promise<string | null> {
  if (!pending) {
    pending = (async () => {
      const token = (await readFromElectron()) ?? (await readFromServer());
      cachedToken = token;
      return token;
    })();
  }
  return pending;
}

/** Token đã nạp (null nếu chưa nạp xong hoặc máy chủ không bật xác thực). */
export function getAuthToken(): string | null {
  return cachedToken;
}

/**
 * Ghép header xác thực vào header có sẵn.
 * Không đặt Content-Type: để trình duyệt tự sinh boundary cho multipart/form-data.
 */
export function withAuthHeaders(headers?: HeadersInit): Record<string, string> {
  const merged: Record<string, string> = {};
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      merged[key] = value;
    });
  }
  if (cachedToken) merged[TOKEN_HEADER] = cachedToken;
  return merged;
}

/** Thông báo lỗi thống nhất khi máy chủ từ chối danh tính. */
export const UNAUTHORIZED_MESSAGE =
  'Máy chủ từ chối yêu cầu (chưa xác thực danh tính). Hãy khởi động lại ứng dụng.';
