import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('API & Service: Hỗ trợ GPB.html, Import/Export HTML và Seed dữ liệu Giải Phẫu Bệnh', () => {
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

  it('HtmlQuizService: parse đúng 13 chuyên đề và 604 câu hỏi từ GPB.html', async () => {
    const { HtmlQuizService } = await import('../src/modules/export/html-quiz.service');
    const service = new HtmlQuizService();
    const gpbPath = path.join(__dirname, '..', 'GPB.html');
    const html = fs.readFileSync(gpbPath, 'utf8');

    const categories = service.parseQuizFromHtml(html);
    assert.equal(categories.length, 13, 'Phải nhận diện đủ 13 chuyên đề GPB');

    const totalQuestions = categories.reduce((sum, c) => sum + c.questions.length, 0);
    assert.equal(totalQuestions, 604, 'Tổng số câu hỏi phải là 604 câu');

    // Kiểm tra câu đầu tiên của chuyên đề 1 (Bệnh Lý Dạ Dày)
    const firstCat = categories[0];
    assert.equal(firstCat.title, 'Bệnh Lý Dạ Dày');
    assert.equal(firstCat.questions.length, 55);
    const q1 = firstCat.questions[0];
    assert.equal(q1.content, 'Viêm dạ dày cấp thường do nguyên nhân');
    assert.equal(q1.options.length, 4);
    assert.equal(q1.options[2].is_correct, true);
    assert.equal(q1.subtopic, 'I. VIÊM DẠ DÀY (CÂU 1–15)');
  });

  it('POST /api/v1/quizzes/seed-pathology: nạp kho đề GPB vào CSDL', async () => {
    const token = process.env.APP_AUTH_TOKEN || 'test-token';
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes/seed-pathology',
      headers: { 'x-app-token': token }
    });

    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.subject.name, 'Giải Phẫu Bệnh');
    assert.equal(body.data.quizzesCount, 13);
    assert.equal(body.data.questionsCount, 604);
  });

  it('GET /api/v1/quizzes/:id/export/html: xuất đề thi ra file HTML độc lập tương tác', async () => {
    const token = process.env.APP_AUTH_TOKEN || 'test-token';

    // Lấy danh sách đề của môn Giải Phẫu Bệnh vừa seed
    const subjRes = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects',
      headers: { 'x-app-token': token }
    });
    const subjects = subjRes.json().data;
    const gpb = subjects.find((s: any) => s.name === 'Giải Phẫu Bệnh');
    assert.ok(gpb, 'Môn Giải Phẫu Bệnh phải tồn tại');

    const quizzesRes = await app.inject({
      method: 'GET',
      url: `/api/v1/subjects/${gpb.id}/quizzes`,
      headers: { 'x-app-token': token }
    });
    const quizzes = quizzesRes.json().data.quizzes;
    assert.ok(quizzes.length >= 13);
    const targetQuiz = quizzes[0];

    // Xuất HTML
    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/v1/quizzes/${targetQuiz.id}/export/html`,
      headers: { 'x-app-token': token }
    });

    assert.equal(exportRes.statusCode, 200);
    assert.match(exportRes.headers['content-type'] as string, /text\/html/);
    const html = exportRes.body;
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /QUIZ_DATA/);
    assert.match(html, /answerQuestion/);
    assert.match(html, /palette-grid/);
    assert.match(html, /progress-bar/);
  });

  it('POST /api/v1/quizzes/import/html: nhập file HTML mới vào hệ thống', async () => {
    const token = process.env.APP_AUTH_TOKEN || 'test-token';
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <head><title>Trắc Nghiệm Tim Mạch</title></head>
      <body>
        <script>
          const QUIZ_DATA = [
            {
              title: "Điện Tâm Đồ Cơ Bản",
              questions: [
                {
                  question: "Sóng P trên ECG biểu thị cho hiện tượng gì?",
                  options: ["Khử cực tâm nhĩ", "Khử cực tâm thất", "Tái cực tâm thất", "Tái cực tâm nhĩ"],
                  correct: 0,
                  subtopic: "Sóng điện tim"
                }
              ]
            }
          ];
        </script>
      </body>
      </html>
    `;

    const boundary = '----HtmlQuizBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="test.html"\r\n` +
          `Content-Type: text/html\r\n\r\n`
      ),
      Buffer.from(sampleHtml),
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes/import/html?subjectName=Tim%20M%E1%BA%A1ch',
      headers: {
        'x-app-token': token,
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    });

    assert.equal(res.statusCode, 201);
    const data = res.json().data;
    assert.equal(data.importedCount, 1);
    assert.equal(data.quizzes.length, 1);
    assert.equal(data.quizzes[0].title, 'Điện Tâm Đồ Cơ Bản');
  });
});
