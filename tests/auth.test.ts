import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Test riêng cho cơ chế xác thực x-app-token (Bug 3).
// Node test runner chạy mỗi file trong một tiến trình riêng, nên APP_AUTH_TOKEN đặt ở đây
// không ảnh hưởng tới tests/api.test.ts (file đó kiểm tra luồng không bật xác thực).
// Phải đặt TRƯỚC khi import app vì env.config parse ngay lúc nạp module.
const TEST_TOKEN = 'a'.repeat(64);
const WRONG_TOKEN = 'b'.repeat(64);

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_AUTH_TOKEN = TEST_TOKEN;

describe('Xác thực: header x-app-token', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    closeDatabase = dbModule.closeDatabase;
    app = buildApp({ disableRateLimit: true });
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('/health không cần token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
  });

  it('/api/* thiếu token -> 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/attempts/history' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().success, false);
  });

  it('/api/* sai token -> 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attempts/history',
      headers: { 'x-app-token': WRONG_TOKEN }
    });
    assert.equal(res.statusCode, 401);
  });

  it('/api/* đúng token -> không bị chặn bởi lớp xác thực', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/attempts/history',
      headers: { 'x-app-token': TEST_TOKEN }
    });
    // DB nhúng không có bảng nên có thể lỗi 500 — điều cần khẳng định là ĐÃ QUA lớp 401.
    assert.notEqual(res.statusCode, 401);
  });

  it('/app-config.json trả token cho cùng origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/app-config.json',
      headers: { host: '127.0.0.1:3000' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.authToken, TEST_TOKEN);
  });

  it('/app-config.json từ chối origin lạ (không rò rỉ token)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/app-config.json',
      headers: { host: '127.0.0.1:3000', origin: 'https://evil.example.com' }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.includes(TEST_TOKEN), false);
  });

  it('/app-config.json đọc được từ chính origin của nó', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/app-config.json',
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.authToken, TEST_TOKEN);
  });
});
