import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Dùng DB nhúng thật (không phải memory://) để test được full vòng xuất/nhập dữ liệu
// qua các bảng có khoá ngoại với nhau. DB_DATA_DIR=memory:// vẫn tạo được bảng vì
// PGlite hỗ trợ chế độ bộ nhớ, ta chỉ cần trỏ đúng đường dẫn schema SQL.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');


describe('API: Sao lưu & phục hồi dữ liệu', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;
  let runMigrations: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const migrateModule = await import('../src/core/database/migrate');
    runMigrations = migrateModule.runMigrations;
    await runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('GET /api/v1/backup/counts trả 0 cho CSDL trống', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/backup/counts' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.subjects, 0);
  });

  it('xuất rồi phục hồi lại giữ nguyên dữ liệu (round-trip)', async () => {
    const validQuestion = {
      content: 'Câu backup test?',
      difficulty: 'EASY',
      explanation: 'Giải thích',
      source_reference: 'Tài liệu',
      options: [
        { label: 'A', content: 'A', is_correct: true },
        { label: 'B', content: 'B', is_correct: false },
        { label: 'C', content: 'C', is_correct: false },
        { label: 'D', content: 'D', is_correct: false }
      ]
    };
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề backup', subject_name: 'Backup Test', mode: 'EXAM', questions: [validQuestion] }
    });
    assert.equal(createRes.statusCode, 201);

    const exportRes = await app.inject({ method: 'GET', url: '/api/v1/backup/export' });
    assert.equal(exportRes.statusCode, 200);
    const backup = exportRes.json().data;
    assert.equal(backup.format, 'tao-trac-nghiem-backup');
    assert.ok(backup.tables.quizzes.length >= 1);

    const previewRes = await app.inject({ method: 'POST', url: '/api/v1/backup/preview', payload: backup });
    assert.equal(previewRes.statusCode, 200);
    assert.ok(previewRes.json().data.quizzes >= 1);

    const restoreRes = await app.inject({ method: 'POST', url: '/api/v1/backup/restore', payload: backup });
    assert.equal(restoreRes.statusCode, 200);

    const countsAfter = await app.inject({ method: 'GET', url: '/api/v1/backup/counts' });
    assert.equal(countsAfter.json().data.quizzes, backup.tables.quizzes.length);
  });

  it('phục hồi tệp sai định dạng -> 400, không xoá dữ liệu hiện có', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/v1/backup/counts' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/backup/restore',
      payload: { format: 'something-else', version: 1, tables: {} }
    });
    assert.equal(res.statusCode, 400);
    const after = await app.inject({ method: 'GET', url: '/api/v1/backup/counts' });
    assert.deepEqual(after.json().data, before.json().data);
  });

  it('phục hồi bản sao lưu từ phiên bản tương lai -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/backup/restore',
      payload: { format: 'tao-trac-nghiem-backup', version: 999, tables: {} }
    });
    assert.equal(res.statusCode, 400);
  });
});
