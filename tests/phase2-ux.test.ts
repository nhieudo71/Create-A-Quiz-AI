import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('API: Giai đoạn 2 - Lưu nháp, khôi phục & phân tích', () => {
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

  it('lưu nháp đáp án và khôi phục nguyên trạng lượt thi đang làm dở', async () => {
    const quizRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề kiểm tra nháp',
        subject_name: 'Nội Khoa Nháp',
        mode: 'PRACTICE',
        questions: [
          {
            content: 'Câu 1 nháp?',
            difficulty: 'EASY',
            explanation: 'Giải thích 1',
            source_reference: null,
            options: [
              { label: 'A', content: 'Đúng', is_correct: true },
              { label: 'B', content: 'Sai 1', is_correct: false },
              { label: 'C', content: 'Sai 2', is_correct: false },
              { label: 'D', content: 'Sai 3', is_correct: false }
            ]
          },
          {
            content: 'Câu 2 nháp?',
            difficulty: 'HARD',
            explanation: 'Giải thích 2',
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
    assert.equal(quizRes.statusCode, 201);
    const quizId = quizRes.json().data.id;

    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    assert.equal(startRes.statusCode, 200);
    const startData = startRes.json().data;
    const attemptId = startData.attempt_id;
    const firstQ = startData.questions[0];
    const pickedOpt = firstQ.options.find((o: any) => o.content === 'Đúng');

    // Lưu nháp câu 1
    const draftRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/attempts/${attemptId}/draft`,
      payload: {
        question_id: firstQ.question_id,
        selected_option_id: pickedOpt.option_id,
        response: { option_id: pickedOpt.option_id }
      }
    });
    assert.equal(draftRes.statusCode, 200);

    // Kiểm tra /in-progress
    const inProgRes = await app.inject({ method: 'GET', url: '/api/v1/attempts/in-progress' });
    assert.equal(inProgRes.statusCode, 200);
    assert.equal(inProgRes.json().data.attempt_id, attemptId);
    assert.equal(inProgRes.json().data.answered_count, 1);

    // Khôi phục lượt thi
    const resumeRes = await app.inject({ method: 'GET', url: `/api/v1/attempts/${attemptId}/resume` });
    assert.equal(resumeRes.statusCode, 200);
    const resumeData = resumeRes.json().data;
    assert.equal(resumeData.draft_answers.length, 1);
    assert.equal(resumeData.draft_answers[0].question_id, firstQ.question_id);
    assert.equal(resumeData.draft_answers[0].selected_option_id, pickedOpt.option_id);

    // Nộp bài và kiểm tra analytics
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      payload: {
        answers: [{ question_id: firstQ.question_id, selected_option_id: pickedOpt.option_id }]
      }
    });
    assert.equal(submitRes.statusCode, 200);

    const inProgAfter = await app.inject({ method: 'GET', url: '/api/v1/attempts/in-progress' });
    assert.equal(inProgAfter.json().data, null);

    const analyticsRes = await app.inject({ method: 'GET', url: '/api/v1/attempts/analytics' });
    assert.equal(analyticsRes.statusCode, 200);
    const analytics = analyticsRes.json().data;
    assert.ok(analytics.trend.length >= 1);
    assert.ok(analytics.by_subject.some((s: any) => s.subject_name === 'Nội Khoa Nháp'));
    assert.ok(analytics.by_difficulty.length >= 1);
  });
});
