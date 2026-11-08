import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';

// Chạy DB nhúng PGlite trên bộ nhớ (không đụng tới thư mục data thật), và KHÔNG chạy
// migration: mọi truy vấn ghi sẽ lỗi, mô phỏng "DB sập" một cách xác định.
// Các biến này phải đặt trước khi nạp app vì env được parse ngay lúc import.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

const UUID = '11111111-1111-4111-8111-111111111111';

const validQuestion = {
  content: 'Câu hỏi thử nghiệm?',
  difficulty: 'EASY',
  explanation: 'Giải thích',
  source_reference: 'Tài liệu',
  options: [
    { label: 'A', content: 'Đáp án A', is_correct: true },
    { label: 'B', content: 'Đáp án B', is_correct: false },
    { label: 'C', content: 'Đáp án C', is_correct: false },
    { label: 'D', content: 'Đáp án D', is_correct: false }
  ]
};

describe('API: validation và xử lý lỗi', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    app = buildApp();
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('GET /health trả 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
  });

  it('generate: thiếu text_content -> 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/questions/generate', payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().success, false);
  });

  it('generate: text quá ngắn -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/generate',
      payload: { text_content: 'ngắn' }
    });
    assert.equal(res.statusCode, 400);
  });

  it('JSON hỏng -> 400 (không phải 500)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/generate',
      headers: { 'content-type': 'application/json' },
      payload: '{"text_content": '
    });
    assert.equal(res.statusCode, 400);
  });

  it('Content-Type không được hỗ trợ -> 415', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/generate',
      headers: { 'content-type': 'application/xml' },
      payload: '<a/>'
    });
    assert.equal(res.statusCode, 415);
  });

  it('body là text/plain (không phải object) -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/questions/generate',
      headers: { 'content-type': 'text/plain' },
      payload: 'abc'
    });
    assert.equal(res.statusCode, 400);
  });

  it('upload: không phải multipart -> 415', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/documents/upload', payload: {} });
    assert.equal(res.statusCode, 415);
  });

  it('quizzes: danh sách câu hỏi rỗng -> 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/quizzes', payload: { questions: [] } });
    assert.equal(res.statusCode, 400);
  });

  it('quizzes: câu hỏi có 2 đáp án đúng -> 400', async () => {
    const bad = {
      ...validQuestion,
      options: validQuestion.options.map((o) => ({ ...o, is_correct: true }))
    };
    const res = await app.inject({ method: 'POST', url: '/api/v1/quizzes', payload: { questions: [bad] } });
    assert.equal(res.statusCode, 400);
  });

  it('quizzes: nhãn đáp án trùng -> 400', async () => {
    const bad = {
      ...validQuestion,
      options: validQuestion.options.map((o) => ({ ...o, label: 'A' }))
    };
    const res = await app.inject({ method: 'POST', url: '/api/v1/quizzes', payload: { questions: [bad] } });
    assert.equal(res.statusCode, 400);
  });

  it('quizzes: mode không hợp lệ -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { mode: 'HACK', questions: [validQuestion] }
    });
    assert.equal(res.statusCode, 400);
  });

  it('quizzes: DB sập -> lỗi thật, KHÔNG trả thành công giả', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề', subject_name: 'Dược', mode: 'EXAM', questions: [validQuestion] }
    });
    assert.equal(res.statusCode, 500);
    const body = res.json();
    assert.equal(body.success, false);
    // Không rò rỉ chi tiết nội bộ (địa chỉ DB, mã lỗi kết nối...)
    assert.ok(!/127\.0\.0\.1|ECONNREFUSED/.test(res.body));
  });

  it('start: id không phải UUID -> 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/quizzes/abc/start' });
    assert.equal(res.statusCode, 400);
  });

  it('start: DB sập -> 500, không trả đề rỗng giả', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${UUID}/start` });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().success, false);
  });

  it('submit: thiếu answers -> 400', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/attempts/${UUID}/submit`, payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it('submit: question_id trùng -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${UUID}/submit`,
      payload: {
        answers: [
          { question_id: UUID, selected_option_id: null },
          { question_id: UUID, selected_option_id: null }
        ]
      }
    });
    assert.equal(res.statusCode, 400);
  });

  it('submit: DB sập -> 500, không báo SUBMITTED giả', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${UUID}/submit`,
      payload: { answers: [{ question_id: UUID, selected_option_id: null }] }
    });
    assert.equal(res.statusCode, 500);
    assert.equal(res.json().success, false);
  });

  it('history: DB sập -> 500, không trả danh sách rỗng giả', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/attempts/history' });
    assert.equal(res.statusCode, 500);
  });
});
