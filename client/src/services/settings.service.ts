import {
  ConnectionTestResult,
  CreateProviderInput,
  PublicSettings,
  UpdateProviderInput
} from '../types/settings.types';
import { UNAUTHORIZED_MESSAGE, withAuthHeaders } from './http';

const REQUEST_TIMEOUT_MS = 30 * 1000;
const TEST_CONNECTION_TIMEOUT_MS = 40 * 1000;

async function requestJson<T>(url: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

export class SettingsService {
  static async getSettings(): Promise<PublicSettings> {
    return requestJson<PublicSettings>('/api/v1/settings', { method: 'GET' });
  }

  static async updateAISettings(patch: {
    activeProviderId?: string | null;
    temperature?: number;
    requestTimeoutMs?: number;
  }): Promise<PublicSettings> {
    return requestJson<PublicSettings>('/api/v1/settings/ai', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
  }

  static async createProvider(input: CreateProviderInput): Promise<PublicSettings> {
    return requestJson<PublicSettings>('/api/v1/settings/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }

  static async updateProvider(id: string, input: UpdateProviderInput): Promise<PublicSettings> {
    return requestJson<PublicSettings>(`/api/v1/settings/providers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }

  static async deleteProvider(id: string): Promise<PublicSettings> {
    return requestJson<PublicSettings>(`/api/v1/settings/providers/${id}`, { method: 'DELETE' });
  }

  static async testProvider(id: string): Promise<ConnectionTestResult> {
    return requestJson<ConnectionTestResult>(
      `/api/v1/settings/providers/${id}/test`,
      { method: 'POST' },
      TEST_CONNECTION_TIMEOUT_MS
    );
  }

  static async startOAuthLogin(id: string): Promise<{ authorizeUrl: string }> {
    return requestJson<{ authorizeUrl: string }>(`/api/v1/settings/providers/${id}/oauth/start`, {
      method: 'POST'
    });
  }

  static async getOAuthLoginStatus(id: string): Promise<{ status: 'pending' | 'done' | 'error'; message?: string }> {
    return requestJson(`/api/v1/settings/providers/${id}/oauth/status`, { method: 'GET' });
  }
}
