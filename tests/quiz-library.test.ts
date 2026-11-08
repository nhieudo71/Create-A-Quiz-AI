import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Dùng DB nhúng thật (schema đầy đủ) để kiểm tra đúng ràng buộc khoá ngoại
// giữa subjects/quizzes/quiz_questions/quiz_attempts khi sửa/xoá đề thi.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

const validQuestion = {
  content: 'Câu hỏi thư viện đề thi?',
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

describe('API: Danh mục môn học & Thư viện đề thi (Phòng thi)', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const migrateModule = await import('../src/core/database/migrate');
    await migrateModule.runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('GET /api/v1/subjects: trống khi chưa có đề thi nào', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/subjects' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().data, []);
  });

  it('tạo đề thi -> môn học xuất hiện trong danh mục kèm đúng số đề', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề Dược Lý 1',
        subject_name: 'Dược Lý Thư Viện',
        mode: 'EXAM',
        questions: [validQuestion]
      }
    });
    assert.equal(createRes.statusCode, 201);

    const subjectsRes = await app.inject({ method: 'GET', url: '/api/v1/subjects' });
    assert.equal(subjectsRes.statusCode, 200);
    const subject = subjectsRes.json().data.find((s: any) => s.name === 'Dược Lý Thư Viện');
    assert.ok(subject, 'phải thấy môn học vừa tạo trong danh mục');
    assert.equal(subject.quiz_count, 1);
  });

  it('GET /api/v1/subjects/:id/quizzes: liệt kê đúng các đề của môn', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề Giải Phẫu 1',
        subject_name: 'Giải Phẫu Thư Viện',
        mode: 'PRACTICE',
        questions: [validQuestion]
      }
    });
    const subjectId = createRes.json().data.subject_id;

    const res = await app.inject({ method: 'GET', url: `/api/v1/subjects/${subjectId}/quizzes` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().data.subject.name, 'Giải Phẫu Thư Viện');
    assert.equal(res.json().data.quizzes.length, 1);
    assert.equal(res.json().data.quizzes[0].title, 'Đề Giải Phẫu 1');
  });

  it('GET /api/v1/subjects/:id/quizzes: môn không tồn tại -> 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/11111111-1111-4111-8111-111111111111/quizzes'
    });
    assert.equal(res.statusCode, 404);
  });

  it('PATCH /api/v1/quizzes/:id: đổi tên đề thi', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề Cũ', subject_name: 'Sinh Lý Thư Viện', mode: 'EXAM', questions: [validQuestion] }
    });
    const quizId = createRes.json().data.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quizzes/${quizId}`,
      payload: { title: 'Đề Mới Đã Sửa' }
    });
    assert.equal(patchRes.statusCode, 200);
    assert.equal(patchRes.json().data.title, 'Đề Mới Đã Sửa');
  });

  it('PATCH /api/v1/quizzes/:id: chuyển đề sang môn mới (tạo môn nếu chưa có)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề Chuyển Môn', subject_name: 'Môn Gốc', mode: 'EXAM', questions: [validQuestion] }
    });
    const quizId = createRes.json().data.id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/quizzes/${quizId}`,
      payload: { subject_name: 'Môn Đích Mới' }
    });
    assert.equal(patchRes.statusCode, 200);

    const subjectsRes = await app.inject({ method: 'GET', url: '/api/v1/subjects' });
    const destSubject = subjectsRes.json().data.find((s: any) => s.name === 'Môn Đích Mới');
    assert.ok(destSubject);
    assert.equal(patchRes.json().data.subject_id, destSubject.id);
  });

  it('PATCH /api/v1/quizzes/:id: không có trường nào -> 400', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { subject_name: 'Môn Patch Rỗng', questions: [validQuestion] }
    });
    const quizId = createRes.json().data.id;

    const res = await app.inject({ method: 'PATCH', url: `/api/v1/quizzes/${quizId}`, payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it('PATCH /api/v1/quizzes/:id: đề không tồn tại -> 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/quizzes/11111111-1111-4111-8111-111111111111',
      payload: { title: 'x' }
    });
    assert.equal(res.statusCode, 404);
  });

  it('DELETE /api/v1/quizzes/:id: xoá vĩnh viễn, giữ nguyên môn học', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề Sẽ Bị Xoá', subject_name: 'Môn Giữ Lại', mode: 'EXAM', questions: [validQuestion] }
    });
    const quizId = createRes.json().data.id;
    const subjectId = createRes.json().data.subject_id;

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/quizzes/${quizId}` });
    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.json().data.deleted, true);

    // Môn học vẫn tồn tại trong danh mục, nhưng không còn đề thi
    const quizzesRes = await app.inject({ method: 'GET', url: `/api/v1/subjects/${subjectId}/quizzes` });
    assert.equal(quizzesRes.statusCode, 200);
    assert.equal(quizzesRes.json().data.quizzes.length, 0);

    // Lượt thi không mở lại được nữa vì đề đã bị xoá
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    assert.equal(startRes.statusCode, 404);
  });

  it('DELETE /api/v1/quizzes/:id: xoá kèm lượt thi đã nộp mà không lỗi FK', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: { title: 'Đề Có Lượt Thi', subject_name: 'Môn Có Lượt Thi', mode: 'EXAM', questions: [validQuestion] }
    });
    const quizId = createRes.json().data.id;

    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    assert.equal(startRes.statusCode, 200);
    const attemptId = startRes.json().data.attempt_id;
    const questionId = startRes.json().data.questions[0].question_id;
    const optionId = startRes.json().data.questions[0].options[0].option_id;

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      payload: { answers: [{ question_id: questionId, selected_option_id: optionId }] }
    });
    assert.equal(submitRes.statusCode, 200);

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/quizzes/${quizId}` });
    assert.equal(delRes.statusCode, 200);
  });

  it('DELETE /api/v1/quizzes/:id: đề không tồn tại -> 404', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/quizzes/11111111-1111-4111-8111-111111111111'
    });
    assert.equal(res.statusCode, 404);
  });
});

