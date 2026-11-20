import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Thiết lập DB nhúng trong bộ nhớ để không ảnh hưởng dữ liệu thật
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('MedQuiz AI 2.0: Integration Test & Certification Suite', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  const sampleQuestions = [
    {
      content: 'Thuốc nào sau đây là thuốc kháng Histamin H1 thế hệ 2 không gây buồn ngủ?',
      difficulty: 'EASY',
      explanation: 'Loratadine và Cetirizine là các kháng Histamin H1 thế hệ 2, ít qua hàng rào máu não nên ít gây buồn ngủ.',
      source_reference: 'Dược lý học lâm sàng - Bộ Y tế',
      question_type: 'MCQ',
      options: [
        { label: 'A', content: 'Loratadine', is_correct: true },
        { label: 'B', content: 'Diphenhydramine', is_correct: false },
        { label: 'C', content: 'Chlorpheniramine', is_correct: false },
        { label: 'D', content: 'Promethazine', is_correct: false }
      ]
    },
    {
      content: 'Kháng sinh Penicillin diệt khuẩn bằng cách ức chế tổng hợp thành tế bào vi khuẩn?',
      difficulty: 'MEDIUM',
      explanation: 'Penicillin gắn vào PBP (Penicillin-Binding Proteins) ức chế tổng hợp Peptidoglycan cấu tạo thành tế bào vi khuẩn.',
      source_reference: 'Vi sinh & Ký sinh trùng y học',
      question_type: 'TRUE_FALSE',
      options: [
        { label: 'A', content: 'Đúng', is_correct: true },
        { label: 'B', content: 'Sai', is_correct: false }
      ]
    }
  ];

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

  // ==========================================================================
  // FEATURE 1: EXAM EXIT & ATTEMPT LIFECYCLE
  // ==========================================================================
  describe('Feature 1: Exam Exit & Attempt Lifecycle', () => {
    let testQuizId: string;

    before(async () => {
      const quizRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quizzes',
        payload: {
          title: 'Đề thi Vòng đời & Thoát phòng thi',
          subject_name: 'Dược Lý Lâm Sàng',
          mode: 'EXAM',
          questions: sampleQuestions
        }
      });
      assert.equal(quizRes.statusCode, 201);
      testQuizId = quizRes.json().data.id;
    });

    it('bắt đầu lượt thi -> trạng thái IN_PROGRESS và tạo phiên hợp lệ', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${testQuizId}/start`
      });
      assert.equal(res.statusCode, 200);
      const data = res.json().data;
      assert.ok(data.attempt_id);
      assert.equal(data.total_questions, 2);
      assert.equal(data.questions.length, 2);

      // Kiểm tra có thể truy vấn lượt thi đang làm dở
      const inProgRes = await app.inject({
        method: 'GET',
        url: '/api/v1/attempts/in-progress'
      });
      assert.equal(inProgRes.statusCode, 200);
      assert.equal(inProgRes.json().data.attempt_id, data.attempt_id);
    });

    it('huỷ lượt thi (abandon) qua POST /api/v1/attempts/:id/abandon -> giải phóng phòng thi', async () => {
      // Lấy attempt đang chạy
      const inProgRes = await app.inject({ method: 'GET', url: '/api/v1/attempts/in-progress' });
      const currentAttemptId = inProgRes.json().data.attempt_id;
      assert.ok(currentAttemptId);

      // Gọi endpoint abandon
      const abandonRes = await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${currentAttemptId}/abandon`
      });
      assert.equal(abandonRes.statusCode, 200);
      assert.equal(abandonRes.json().success, true);
      assert.equal(abandonRes.json().data.deleted, true);

      // Sau khi huỷ, không còn lượt thi nào đang chạy dở
      const afterRes = await app.inject({ method: 'GET', url: '/api/v1/attempts/in-progress' });
      assert.equal(afterRes.statusCode, 200);
      assert.equal(afterRes.json().data, null);

      // Gọi huỷ lần 2 sẽ trả về 404
      const secondAbandon = await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${currentAttemptId}/abandon`
      });
      assert.equal(secondAbandon.statusCode, 404);
    });

    it('hoàn thành bài thi qua POST /api/v1/attempts/:id/complete -> tính điểm và lưu lịch sử', async () => {
      // Bắt đầu một lượt thi mới
      const startRes = await app.inject({
        method: 'POST',
        url: `/api/v1/quizzes/${testQuizId}/start`
      });
      const { attempt_id, questions } = startRes.json().data;

      const completeRes = await app.inject({
        method: 'POST',
        url: `/api/v1/attempts/${attempt_id}/complete`,
        payload: {
          answers: [
            {
              question_id: questions[0].question_id,
              selected_option_id: questions[0].options.find((o: any) => o.label === 'A').option_id
            },
            {
              question_id: questions[1].question_id,
              selected_option_id: questions[1].options.find((o: any) => o.label === 'A').option_id
            }
          ]
        }
      });
      assert.equal(completeRes.statusCode, 200);
      const result = completeRes.json().data;
      assert.equal(result.attempt_id, attempt_id);
      assert.equal(typeof result.score_percentage, 'number');
      assert.equal(result.total_questions, 2);

      // Kiểm tra lượt thi không còn IN_PROGRESS nữa (phòng thi đã thoát sạch)
      const inProgRes = await app.inject({ method: 'GET', url: '/api/v1/attempts/in-progress' });
      assert.equal(inProgRes.json().data, null);

      // Kiểm tra xem lại kết quả qua GET /api/v1/attempts/:id/review
      const reviewRes = await app.inject({
        method: 'GET',
        url: `/api/v1/attempts/${attempt_id}/review`
      });
      assert.equal(reviewRes.statusCode, 200);
      assert.equal(reviewRes.json().data.attempt_id, attempt_id);
      assert.equal(reviewRes.json().data.details.length, 2);
    });
  });

  // ==========================================================================
  // FEATURE 2: DOCUMENT SUMMARIZATION
  // ==========================================================================
  describe('Feature 2: Document Summarization (POST /api/v1/generator/summarize)', () => {
    it('thiếu trường text_content -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generator/summarize',
        payload: { subject_name: 'Dược Lý' }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().success, false);
      assert.ok(res.json().error.message.includes('text_content'));
    });

    it('văn bản quá ngắn (dưới 10 ký tự) -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generator/summarize',
        payload: {
          text_content: 'Quá ngắn',
          subject_name: 'Dược Lý'
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().success, false);
      assert.ok(res.json().error.message.includes('tối thiểu 10 ký tự'));
    });

    it('thiếu trường subject_name -> 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generator/summarize',
        payload: {
          text_content: 'Hội chứng vành cấp bao gồm nhồi máu cơ tim có ST chênh lên và không có ST chênh lên.'
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().success, false);
      assert.ok(res.json().error.message.includes('subject_name'));
    });

    it('payload hợp lệ nhưng chưa cấu hình AI provider -> 400 thông báo lỗi thân thiện', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/generator/summarize',
        payload: {
          text_content: 'Viêm ruột thừa cấp là một cấp cứu ngoại khoa thường gặp nhất trong các bệnh lý đau bụng cấp.',
          subject_name: 'Ngoại Khoa Tiêu Hoá'
        }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().success, false);
      assert.ok(res.json().error.message.includes('nhà cung cấp AI'));
    });
  });

  // ==========================================================================
  // FEATURE 3: AUTO-SAVE QUIZ INTEGRITY
  // ==========================================================================
  describe('Feature 3: Auto-Save Quiz Integrity', () => {
    it('POST /api/v1/quizzes lưu đầy đủ quiz + questions + options và truy xuất trọn vẹn qua GET /api/v1/quizzes/:id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/quizzes',
        payload: {
          title: 'Đề thi Tự Động Lưu - Kiểm thử Toàn vẹn',
          subject_name: 'Huyết Học Lâm Sàng',
          mode: 'PRACTICE',
          instant_feedback: true,
          questions: sampleQuestions
        }
      });
      assert.equal(createRes.statusCode, 201);
      const savedQuiz = createRes.json().data;
      assert.ok(savedQuiz.id);
      assert.equal(savedQuiz.title, 'Đề thi Tự Động Lưu - Kiểm thử Toàn vẹn');
      assert.equal(savedQuiz.total_questions, 2);

      // GET /api/v1/quizzes/:id
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/v1/quizzes/${savedQuiz.id}`
      });
      assert.equal(getRes.statusCode, 200);
      const quizDetail = getRes.json().data;
      assert.equal(quizDetail.id, savedQuiz.id);
      assert.equal(quizDetail.title, 'Đề thi Tự Động Lưu - Kiểm thử Toàn vẹn');
      assert.equal(quizDetail.subject_name, 'Huyết Học Lâm Sàng');
      assert.equal(quizDetail.total_questions, 2);
      assert.equal(quizDetail.questions.length, 2);

      // Kiểm tra câu hỏi 1
      const q1 = quizDetail.questions[0];
      assert.ok(q1.id || q1.question_id);
      assert.ok(q1.content.includes('Loratadine') || q1.content.includes('Histamin'));
      assert.equal(q1.options.length, 4);
      assert.equal(q1.options.filter((o: any) => o.is_correct).length, 1);

      // Kiểm tra câu hỏi 2 (TRUE_FALSE)
      const q2 = quizDetail.questions[1];
      assert.equal(q2.question_type, 'TRUE_FALSE');
      assert.equal(q2.options.length, 2);
    });

    it('GET /api/v1/quizzes/:id với id không tồn tại -> 404 Not Found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quizzes/00000000-0000-0000-0000-000000000000'
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().success, false);
    });
  });

  // ==========================================================================
  // FEATURE 5: AI MODEL DISCOVERY
  // ==========================================================================
  describe('Feature 5: AI Model Discovery (POST /api/v1/settings/models/discover)', () => {
    it('nhà cung cấp không hợp lệ -> 400 validation error', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: { type: 'unknown_provider' }
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().success, false);
    });

    it('Gemini: không có apiKey -> trả về danh sách model đề xuất chuẩn', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: { type: 'gemini' }
      });
      assert.equal(res.statusCode, 200);
      const { models } = res.json().data;
      assert.ok(Array.isArray(models));
      assert.ok(models.length >= 3);
      assert.ok(models.some((m: any) => m.id.includes('gemini-2.5-flash')));
      assert.ok(models.some((m: any) => m.recommended === true));
    });

    it('OpenAI: không có apiKey -> trả về danh sách model GPT chuẩn', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: { type: 'openai' }
      });
      assert.equal(res.statusCode, 200);
      const { models } = res.json().data;
      assert.ok(Array.isArray(models));
      assert.ok(models.some((m: any) => m.id === 'gpt-4o-mini'));
      assert.ok(models.some((m: any) => m.recommended === true));
    });

    it('Anthropic: trả về danh sách model Claude chuẩn mực', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: { type: 'anthropic' }
      });
      assert.equal(res.statusCode, 200);
      const { models } = res.json().data;
      assert.ok(Array.isArray(models));
      assert.ok(models.some((m: any) => m.id.includes('claude-3-7-sonnet')));
    });

    it('Local / OpenAI-compatible: xử lý kết nối máy chủ hoặc fallback an toàn', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: {
          type: 'local',
          baseUrl: 'http://127.0.0.1:9999' // Cổng giả không có server
        }
      });
      assert.equal(res.statusCode, 200);
      const { models } = res.json().data;
      assert.ok(Array.isArray(models));
      assert.ok(models.some((m: any) => m.id.includes('llama') || m.id.includes('qwen')));
    });

    it('Gemini với apiKey không hợp lệ trong môi trường test -> fallback danh sách an toàn không sập server', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/models/discover',
        payload: {
          type: 'gemini',
          apiKey: 'fake_test_key_12345'
        }
      });
      assert.equal(res.statusCode, 200);
      const { models } = res.json().data;
      assert.ok(Array.isArray(models));
      assert.ok(models.length >= 2);
    });
  });
});
