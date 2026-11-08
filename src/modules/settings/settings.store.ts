import fs from 'fs';
import path from 'path';
import { env } from '../../config/env.config';
import { AppError } from '../../core/errors';
import {
  AISettings,
  ProviderConfig,
  PROVIDER_META,
  PublicProvider,
  PublicSettings,
  Settings,
  settingsSchema
} from './settings.types';

/**
 * Lưu cấu hình người dùng dưới dạng một tệp JSON.
 *
 * Vì sao không dùng bảng CSDL: cấu hình chứa khoá API. Nếu để trong CSDL thì
 * bản sao lưu dữ liệu (xuất ra tệp .json gửi đi chia sẻ) sẽ mang theo khoá thật.
 * Tách ra tệp riêng bảo đảm sao lưu không bao giờ chứa bí mật.
 *
 * Ghi nguyên tử: ghi ra tệp tạm rồi đổi tên, để mất điện giữa chừng không
 * làm hỏng tệp cấu hình hiện có.
 */
export class SettingsStore {
  private readonly filePath: string | null;
  private cache: Settings | null = null;

  constructor(filePath?: string | null) {
    if (filePath === null) {
      this.filePath = null;
      return;
    }
    if (filePath) {
      this.filePath = filePath;
      return;
    }
    // 'memory://' (môi trường test) không ghi gì xuống đĩa
    if (env.DB_DATA_DIR === 'memory://') {
      this.filePath = null;
      return;
    }
    this.filePath = env.APP_SETTINGS_PATH || path.join(env.DB_DATA_DIR, 'settings.json');
  }

  /** Đọc toàn bộ cấu hình (đã chuẩn hoá theo schema). */
  get(): Settings {
    if (this.cache) return this.cache;

    if (!this.filePath || !fs.existsSync(this.filePath)) {
      this.cache = settingsSchema.parse({});
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const result = settingsSchema.safeParse(parsed);
      if (!result.success) {
        // Tệp hỏng hoặc do phiên bản cũ: giữ nguyên tệp để người dùng không mất dữ liệu,
        // nhưng chạy bằng cấu hình mặc định thay vì làm sập ứng dụng.
        console.error('[Settings] Tệp cấu hình không hợp lệ, dùng mặc định:', result.error.message);
        this.cache = settingsSchema.parse({});
        return this.cache;
      }
      // Chuẩn hoá: provider thiếu baseUrl/model thì điền theo meta của loại đó
      const normalized: Settings = {
        ...result.data,
        providers: result.data.providers.map((p) => this.applyDefaults(p))
      };
      this.cache = normalized;
      return normalized;
    } catch (err: any) {
      console.error('[Settings] Không đọc được tệp cấu hình:', err?.message);
      this.cache = settingsSchema.parse({});
      return this.cache;
    }
  }
  /** Ghi đè toàn bộ cấu hình. Chỉ nhận dữ liệu đã qua schema. */
  save(next: Settings): Settings {
    const normalized: Settings = {
      ...next,
      version: 1,
      providers: next.providers.map((p) => this.applyDefaults(p)),
      ai: next.ai,
      updatedAt: new Date().toISOString()
    };

    // Bảo đảm activeProviderId trỏ tới provider còn tồn tại
    if (
      normalized.ai.activeProviderId &&
      !normalized.providers.some((p) => p.id === normalized.ai.activeProviderId)
    ) {
      normalized.ai.activeProviderId = null;
    }

    this.cache = normalized;
    this.persist(normalized);
    return normalized;
  }

  /** Cập nhật một phần cấu hình AI (không đụng tới danh sách provider). */
  updateAI(patch: Partial<AISettings>): Settings {
    const current = this.get();
    return this.save({ ...current, ai: { ...current.ai, ...patch } });
  }

  /** Thêm mới hoặc thay thế một provider (khớp theo id). */
  upsertProvider(provider: ProviderConfig): Settings {
    const current = this.get();
    const exists = current.providers.some((p) => p.id === provider.id);
    const providers = exists
      ? current.providers.map((p) => (p.id === provider.id ? provider : p))
      : [...current.providers, provider];

    return this.save({ ...current, providers });
  }

  removeProvider(id: string): Settings {
    const current = this.get();
    return this.save({ ...current, providers: current.providers.filter((p) => p.id !== id) });
  }

  /** Provider đang hoạt động, hoặc null nếu chưa cấu hình gì. */
  getActiveProvider(): ProviderConfig | null {
    const { ai, providers } = this.get();
    if (ai.activeProviderId) {
      const active = providers.find((p) => p.id === ai.activeProviderId && p.enabled);
      if (active) return active;
    }
    // Chưa chọn ai: dùng provider bật đầu tiên để ứng dụng vẫn chạy được
    return providers.find((p) => p.enabled) ?? null;
  }

  getTemperature(): number {
    return this.get().ai.temperature;
  }

  getRequestTimeoutMs(): number {
    return this.get().ai.requestTimeoutMs;
  }



  /** Bản che bí mật để gửi xuống giao diện. */
  toPublic(settings: Settings = this.get()): PublicSettings {
    return {
      version: settings.version,
      ai: settings.ai,
      providers: settings.providers.map((p) => this.toPublicProvider(p)),
      providerMeta: PROVIDER_META,
      updatedAt: settings.updatedAt
    };
  }

  toPublicProvider(p: ProviderConfig): PublicProvider {
    return {
      id: p.id,
      type: p.type,
      label: p.label,
      model: p.model,
      baseUrl: p.baseUrl ?? null,
      hasApiKey: Boolean(p.apiKey),
      enabled: p.enabled,
      oauthConnected: Boolean(p.oauth?.accessToken || p.oauth?.refreshToken),
      oauthExpiresAt: p.oauth?.expiresAt ?? null,
      createdAt: p.createdAt
    };
  }

  /** Điền baseUrl/model mặc định theo loại provider nếu người dùng để trống. */
  private applyDefaults(p: ProviderConfig): ProviderConfig {
    const meta = PROVIDER_META[p.type];
    const baseUrl = (p.baseUrl ?? '').trim() || meta.defaultBaseUrl;
    return {
      ...p,
      model: p.model?.trim() || meta.defaultModel,
      baseUrl: baseUrl ? baseUrl.replace(/\/+$/, '') : null,
      apiKey: p.apiKey?.trim() || null
    };
  }

  private persist(settings: Settings): void {
    if (!this.filePath) return;

    const dir = path.dirname(this.filePath);
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), {
        encoding: 'utf8',
        // Trên POSIX: chỉ chủ sở hữu đọc được. Windows bỏ qua tuỳ chọn này.
        mode: 0o600
      });
      fs.renameSync(tmp, this.filePath);
    } catch (err: any) {
      // Ghi thất bại là lỗi thật: người dùng vừa nhập khoá API và tưởng đã lưu.
      // Không được im lặng nuốt lỗi rồi báo thành công.
      this.cache = null;
      throw new AppError(
        `Không ghi được tệp cấu hình: ${err?.message ?? 'lỗi không xác định'}`,
        500
      );
    }
  }
}

/** Dùng chung cho toàn ứng dụng (một phiên chạy, một người dùng). */
export const settingsStore = new SettingsStore();
