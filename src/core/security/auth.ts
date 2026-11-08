import { createHash, timingSafeEqual } from 'crypto';
import { FastifyInstance } from 'fastify';

const sha256 = (value: string) => createHash('sha256').update(value).digest();

/**
 * Yêu cầu header `x-app-token` cho mọi route /api/*.
 * - Chống trang web bất kỳ trong trình duyệt gọi vào API cục bộ (CSRF / DNS rebinding).
 * - So sánh qua băm SHA-256 + timingSafeEqual để tránh rò rỉ độ dài/nội dung token.
 * - /health và file tĩnh của giao diện không cần token.
 * Nếu không cấu hình token thì không bật (chỉ hợp lệ khi lắng nghe trên loopback, xem env.config).
 */
export function registerAuth(app: FastifyInstance, token: string): void {
  if (!token) return;
  const expected = sha256(token);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;

    const header = req.headers['x-app-token'];
    const provided = Array.isArray(header) ? header[0] : header;

    if (!provided || !timingSafeEqual(sha256(provided), expected)) {
      return reply.status(401).send({
        success: false,
        error: { code: 401, message: 'Chưa xác thực danh tính' }
      });
    }
  });
}
