import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('API: Giai đoạn 3 - Học tập thông minh & Ngân hàng câu hỏi', () => {
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

  it('tự động ghi nhận câu sai vào SRS, ôn tập câu sai, Flashcard, ghép đề & bookmark', async () => {
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề Dược Lý SRS',
        subject_name: 'Dược Lý SRS',
        mode: 'PRACTICE',
        questions: [
          {
            content: 'Câu dễ SRS?',
            difficulty: 'EASY',
            explanation: 'Giải thích dễ',
            source_reference: 'Sách 1',
            options: [
              { label: 'A', content: 'Đúng', is_correct: true },
              { label: 'B', content: 'Sai', is_correct: false },
              { label: 'C', content: 'Sai 2', is_correct: false },
              { label: 'D', content: 'Sai 3', is_correct: false }
            ]
          },
          {
            content: 'Câu khó SRS?',
            difficulty: 'HARD',
            explanation: 'Giải thích khó',
            source_reference: 'Sách 2',
            options: [
              { label: 'A', content: 'Đúng', is_correct: true },
              { label: 'B', content: 'Sai', is_correct: false },
              { label: 'C', content: 'Sai 2', is_correct: false },
              { label: 'D', content: 'Sai 3', is_correct: false }
            ]
          }
        ]
      }
    });
    assert.equal(quizRes.statusCode, 201);
    const subjectId = quizRes.json().data.subject_id;
    const quizId = quizRes.json().data.id;

    // Bắt đầu và cố tình trả lời sai 1 câu
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const startData = startRes.json().data;
    const q1 = startData.questions[0];
    const wrongOpt = q1.options.find((o: any) => o.content === 'Sai');

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${startData.attempt_id}/submit`,
      payload: {
        answers: [{ question_id: q1.question_id, selected_option_id: wrongOpt.option_id }]
      }
    });
    assert.equal(submitRes.statusCode, 200);

    // 1. Kiểm tra ngân hàng câu sai
    const mistakesRes = await app.inject({ method: 'GET', url: '/api/v1/study/mistakes' });
    assert.equal(mistakesRes.statusCode, 200);
    assert.ok(mistakesRes.json().data.length >= 1);

    // 2. Tạo bài luyện tập câu sai
    const practiceRes = await app.inject({
      method: 'POST',
      url: '/api/v1/study/mistakes/practice',
      payload: { subject_id: subjectId }
    });
    assert.equal(practiceRes.statusCode, 201);
    assert.ok(practiceRes.json().data.quiz.id);

    // 3. Kiểm tra thẻ SRS đến hạn & chấm điểm Flashcard
    const srsDueRes = await app.inject({ method: 'GET', url: '/api/v1/study/srs-due' });
    assert.equal(srsDueRes.statusCode, 200);
    assert.ok(srsDueRes.json().data.length >= 1);

    const reviewCardRes = await app.inject({
      method: 'POST',
      url: '/api/v1/study/srs-review',
      payload: { question_id: q1.question_id, quality: 5 }
    });
    assert.equal(reviewCardRes.statusCode, 200);
    assert.ok(reviewCardRes.json().data.interval_days >= 1);

    // 4. Tạo đề tổng hợp theo môn
    const composeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes/compose',
      payload: {
        subject_id: subjectId,
        mode: 'EXAM',
        total_questions: 2,
        easy_pct: 50,
        medium_pct: 0,
        hard_pct: 50
      }
    });
    assert.equal(composeRes.statusCode, 201);
    assert.equal(composeRes.json().data.quiz.total_questions, 2);

    // 5. Đánh dấu & ghi chú cá nhân
    const bmRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/questions/${q1.question_id}/bookmark`,
      payload: { is_flagged: true, personal_note: 'Cần học kỹ cơ chế thuốc này' }
    });
    assert.equal(bmRes.statusCode, 200);

    const bmListRes = await app.inject({ method: 'GET', url: '/api/v1/questions/bookmarked' });
    assert.equal(bmListRes.statusCode, 200);
    assert.equal(bmListRes.json().data[0].personal_note, 'Cần học kỹ cơ chế thuốc này');
  });
});
