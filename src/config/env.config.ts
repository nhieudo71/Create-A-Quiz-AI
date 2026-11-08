import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

const envSchema = z
  .object({
    PORT: z.string().default('3000').transform(Number),
    // Mặc định chỉ lắng nghe trên loopback: ứng dụng desktop không được lộ API ra mạng LAN
    HOST: z.string().default('127.0.0.1'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    GEMINI_API_KEY: z.string().optional().default(''),
    // Tên model có thể đổi bằng env vì Google định kỳ ngừng hỗ trợ các model cũ
    GEMINI_MODEL: z.string().trim().min(1).default('gemini-2.5-flash'),
    // Token bắt buộc cho mọi route /api/*. Electron tự sinh ngẫu nhiên mỗi lần chạy.
    APP_AUTH_TOKEN: z.string().optional().default(''),
    // 'embedded' = PGlite (Desktop, không cần cài PostgreSQL); 'postgres' = server dùng DATABASE_URL
    DB_MODE: z.enum(['embedded', 'postgres']).default('embedded'),
    // Thư mục dữ liệu PGlite; 'memory://' dùng cho test
    DB_DATA_DIR: z.string().default('data'),
    // Nơi lưu cấu hình người dùng (nhà cung cấp AI, khoá API).
    // Để trống -> <DB_DATA_DIR>/settings.json. 'memory://' -> không ghi đĩa (dùng cho test).
    // Tách khỏi CSDL để bản sao lưu dữ liệu KHÔNG bao giờ chứa khoá API.
    APP_SETTINGS_PATH: z.string().optional().default(''),
    // Dùng khi DB_MODE=postgres
    DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/tao_trac_nghiem'),
    MAX_FILE_SIZE_MB: z.string().default('500').transform(Number)
  })
  .superRefine((cfg, ctx) => {
    if (!Number.isInteger(cfg.PORT) || cfg.PORT < 0 || cfg.PORT > 65535) {
      ctx.addIssue({ code: 'custom', path: ['PORT'], message: 'PORT phải là số nguyên từ 0 đến 65535' });
    }
    if (!Number.isFinite(cfg.MAX_FILE_SIZE_MB) || cfg.MAX_FILE_SIZE_MB <= 0 || cfg.MAX_FILE_SIZE_MB > 1000) {
      ctx.addIssue({ code: 'custom', path: ['MAX_FILE_SIZE_MB'], message: 'MAX_FILE_SIZE_MB phải nằm trong khoảng 1-1000' });
    }
    if (cfg.APP_AUTH_TOKEN && cfg.APP_AUTH_TOKEN.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['APP_AUTH_TOKEN'], message: 'APP_AUTH_TOKEN phải dài tối thiểu 32 ký tự' });
    }
    // Chặn cấu hình nguy hiểm: mở API ra ngoài loopback mà không có xác thực
    if (cfg.NODE_ENV === 'production' && !isLoopbackHost(cfg.HOST) && !cfg.APP_AUTH_TOKEN) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_AUTH_TOKEN'],
        message: `Từ chối khởi động: HOST=${cfg.HOST} mở API ra ngoài máy cục bộ nhưng chưa đặt APP_AUTH_TOKEN`
      });
    }
  });

export const env = envSchema.parse(process.env);
