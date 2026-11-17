import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('API: Giai đoạn 4 - Lưu tài liệu tái sử dụng & sửa câu hỏi', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const { runMigrations } = await import('../src/core/database/migrate');
    await runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('upload tài liệu -> lưu vào DB -> liệt kê, nạp lại và xoá tài liệu', async () => {
    const boundary = '----MedQuizBoundary123';
    const contentText =
      'Amoxicillin là kháng sinh nhóm Beta-lactam phổ rộng, thường dùng điều trị nhiễm khuẩn hô hấp cấp tính ở người lớn và trẻ em.';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="duoc-ly.txt"',
      'Content-Type: text/plain',
      '',
      contentText,
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const uploadRes = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload
    });
    assert.equal(uploadRes.statusCode, 201);
    const docId = uploadRes.json().data.document_id;
    assert.ok(docId);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/documents' });
    assert.equal(listRes.statusCode, 200);
    assert.ok(listRes.json().data.some((d: any) => d.id === docId));

    const getRes = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}` });
    assert.equal(getRes.statusCode, 200);
    assert.ok(getRes.json().data.preview_text.includes('Amoxicillin'));

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${docId}` });
    assert.equal(delRes.statusCode, 200);
  });

  it('PATCH /api/v1/questions/:id cập nhật nội dung & giải thích câu hỏi', async () => {
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề sửa câu hỏi',
        subject_name: 'Sinh Lý',
        mode: 'PRACTICE',
        questions: [
          {
            content: 'Nội dung cũ?',
            difficulty: 'EASY',
            explanation: 'Giải thích cũ',
            source_reference: null,
            options: [
              { label: 'A', content: 'Đúng', is_correct: true },
              { label: 'B', content: 'Sai 1', is_correct: false },
              { label: 'C', content: 'Sai 2', is_correct: false },
              { label: 'D', content: 'Sai 3', is_correct: false }
            ]
          }
        ]
      }
    });
    const quizId = quizRes.json().data.id;
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const questionId = startRes.json().data.questions[0].question_id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/questions/${questionId}`,
      payload: { content: 'Nội dung mới đã chỉnh sửa?', difficulty: 'HARD', explanation: 'Giải thích mới' }
    });
    assert.equal(patchRes.statusCode, 200);

    const startRes2 = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    assert.equal(startRes2.json().data.questions[0].content, 'Nội dung mới đã chỉnh sửa?');
    assert.equal(startRes2.json().data.questions[0].difficulty, 'HARD');
  });
});
