import { BackupCounts } from '../types/settings.types';
import { UNAUTHORIZED_MESSAGE, withAuthHeaders } from './http';

const REQUEST_TIMEOUT_MS = 60 * 1000;

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: withAuthHeaders(init.headers), signal: controller.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
    }
    throw new Error('Không kết nối được tới máy chủ. Kiểm tra Backend đã khởi động chưa.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new Error(UNAUTHORIZED_MESSAGE);
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `Yêu cầu thất bại (Mã: ${response.status})`);
  }

  const json = await response.json().catch(() => null);
  if (!json || !json.success || json.data === undefined) {
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
  }
  return json.data as T;
}

export class BackupService {
  static async getCounts(): Promise<BackupCounts> {
    return requestJson<BackupCounts>('/api/v1/backup/counts', { method: 'GET' });
  }

  /**
   * Tải bản sao lưu về máy người dùng dưới dạng tệp .json.
   * Dùng fetch thủ công (không qua requestJson) vì cần Blob, không phải JSON đã bóc data.
   */
  static async downloadBackup(): Promise<void> {
    const response = await fetch('/api/v1/backup/export', { headers: withAuthHeaders() });
    if (response.status === 401) throw new Error(UNAUTHORIZED_MESSAGE);
    if (!response.ok) throw new Error(`Không xuất được bản sao lưu (Mã: ${response.status})`);

    const json = await response.json();
    const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medquiz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Đọc tệp .json do người dùng chọn thành object JS. */
  static async readBackupFile(file: File): Promise<unknown> {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Tệp đã chọn không phải JSON hợp lệ.');
    }
  }

  /** Xem trước số lượng bản ghi trong tệp sao lưu trước khi phục hồi. */
  static async previewBackup(payload: unknown): Promise<BackupCounts> {
    return requestJson<BackupCounts>('/api/v1/backup/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /** Phục hồi: XOÁ sạch dữ liệu hiện có rồi nạp lại từ bản sao lưu. */
  static async restoreBackup(payload: unknown): Promise<{ restoredTables: number; restoredRows: number }> {
    return requestJson('/api/v1/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }
}
