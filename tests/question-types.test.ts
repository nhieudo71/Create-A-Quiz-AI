import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';

// Dùng DB nhúng thật để kiểm tra trọn luồng: tạo đề -> bắt đầu -> chấm tức thì
// -> nộp bài -> xem lại. Đây là chỗ các lỗi "chấm đúng nhưng lưu sai" lộ ra.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

const mcq = {
  content: 'Thuốc nào là kháng sinh beta-lactam?',
  difficulty: 'EASY',
  explanation: 'Amoxicillin là beta-lactam.',
  source_reference: 'Trang 12',
  question_type: 'MCQ',
  options: [
    { label: 'A', content: 'Amoxicillin', is_correct: true },
    { label: 'B', content: 'Gentamicin', is_correct: false },
    { label: 'C', content: 'Doxycycline', is_correct: false },
    { label: 'D', content: 'Ciprofloxacin', is_correct: false }
  ]
};

const trueFalse = {
  content: 'Heparin gây giảm tiểu cầu (HIT).',
  difficulty: 'MEDIUM',
  explanation: 'HIT là biến chứng miễn dịch của heparin.',
  source_reference: 'Trang 20',
  question_type: 'TRUE_FALSE',
  options: [
    { label: 'A', content: 'Đúng', is_correct: true },
    { label: 'B', content: 'Sai', is_correct: false }
  ]
};

const multiSelect = {
  content: 'Chọn tất cả đáp án đúng về ACEi.',
  difficulty: 'MEDIUM',
  explanation: 'ACEi giảm áp lực cầu thận và bảo vệ thận.',
  source_reference: 'Trang 30',
  question_type: 'MULTI_SELECT',
  options: [
    { label: 'A', content: 'Bảo vệ thận ở ĐTĐ', is_correct: true },
    { label: 'B', content: 'Gây tăng kali máu', is_correct: true },
    { label: 'C', content: 'Là kháng sinh', is_correct: false },
    { label: 'D', content: 'Chỉ dùng cho trẻ em', is_correct: false }
  ]
};

const fillBlank = {
  content: 'Adrenaline tiêm bắp là thuốc đầu tay trong ______.',
  difficulty: 'HARD',
  explanation: 'Sốc phản vệ cần adrenaline ngay.',
  source_reference: 'Trang 40',
  question_type: 'FILL_BLANK',
  options: [
    { label: 'A', content: 'sốc phản vệ', is_correct: true },
    { label: 'B', content: 'tăng huyết áp', is_correct: false },
    { label: 'C', content: 'đái tháo đường', is_correct: false },
    { label: 'D', content: 'viêm phổi', is_correct: false }
  ]
};

const matching = {
  content: 'Ghép thuốc với cơ chế tác dụng.',
  difficulty: 'HARD',
  explanation: 'Mỗi thuốc có cơ chế riêng.',
  source_reference: 'Trang 50',
  question_type: 'MATCHING',
  payload: {
    pairs: [
      { left_label: 'A', left: 'Amoxicillin', right_label: 'C', right: 'Ức chế vách' },
      { left_label: 'B', left: 'Gentamicin', right_label: 'D', right: 'Ức chế ribosome' },
      { left_label: 'C', left: 'Warfarin', right_label: 'A', right: 'Kháng vitamin K' },
      { left_label: 'D', left: 'Furosemide', right_label: 'B', right: 'Ức chế quai Henle' }
    ]
  },
  options: [
    { label: 'A', content: 'Amoxicillin', is_correct: true },
    { label: 'B', content: 'Gentamicin', is_correct: true },
    { label: 'C', content: 'Warfarin', is_correct: true },
    { label: 'D', content: 'Furosemide', is_correct: true }
  ]
};

const ordering = {
  content: 'Sắp xếp các bước xử trí sốc phản vệ.',
  difficulty: 'HARD',
  explanation: 'Adrenaline luôn là bước đầu tiên.',
  source_reference: 'Trang 60',
  question_type: 'ORDERING',
  payload: { correctOrder: ['C', 'A', 'D', 'B'] },
  options: [
    { label: 'A', content: 'Gọi hỗ trợ', is_correct: true },
    { label: 'B', content: 'Theo dõi', is_correct: true },
    { label: 'C', content: 'Tiêm adrenaline', is_correct: true },
    { label: 'D', content: 'Thở oxy', is_correct: true }
  ]
};

const likert = {
  content: 'Bạn tự tin về cấp cứu sốc phản vệ?',
  difficulty: 'EASY',
  explanation: 'Câu khảo sát.',
  source_reference: 'Trang 70',
  question_type: 'LIKERT',
  payload: { scale: ['Rất thấp', 'Thấp', 'Trung bình', 'Cao', 'Rất cao'] },
  options: [
    { label: 'A', content: 'A', is_correct: false },
    { label: 'B', content: 'B', is_correct: false },
    { label: 'C', content: 'C', is_correct: false },
    { label: 'D', content: 'D', is_correct: false }
  ]
};

describe('API: Nhiều loại câu hỏi (chấm tức thì, trộn, chấm điểm)', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;
  let quizId: string;

  const allQuestions = [mcq, trueFalse, multiSelect, fillBlank, matching, ordering, likert];

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const migrateModule = await import('../src/core/database/migrate');
    await migrateModule.runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes',
      payload: {
        title: 'Đề đa dạng loại câu hỏi',
        subject_name: 'Dược Lý Đa Dạng',
        mode: 'PRACTICE',
        instant_feedback: true,
        questions: allQuestions
      }
    });
    assert.equal(res.statusCode, 201, res.body);
    quizId = res.json().data.id;
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('tạo đề nhận đủ 7 loại câu hỏi (kể cả TRUE_FALSE chỉ 2 đáp án)', async () => {
    // Nếu schema còn ép "đúng 4 đáp án" thì request tạo đề đã bị 400 ở bước trên.
    assert.ok(quizId, 'đề phải được tạo thành công');
  });

  it('start: trả về loại câu hỏi, payload và instant_feedback', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    assert.equal(res.statusCode, 200, res.body);

    const data = res.json().data;
    assert.equal(data.instant_feedback, true);
    assert.equal(data.questions.length, 7);

    const types = data.questions.map((q: any) => q.question_type).sort();
    assert.deepEqual(types, [
      'FILL_BLANK',
      'LIKERT',
      'MATCHING',
      'MCQ',
      'MULTI_SELECT',
      'ORDERING',
      'TRUE_FALSE'
    ]);

    const tf = data.questions.find((q: any) => q.question_type === 'TRUE_FALSE');
    assert.equal(tf.options.length, 2, 'TRUE_FALSE chỉ có 2 phương án');

    const m = data.questions.find((q: any) => q.question_type === 'MATCHING');
    assert.ok(m.payload?.pairs?.length === 4, 'MATCHING phải kèm payload.pairs');
  });

  it('không lộ đáp án đúng khi đang làm bài', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const payloadText = res.body;
    assert.ok(!payloadText.includes('is_correct'), 'không được trả is_correct lúc làm bài');
    assert.ok(!payloadText.includes('explanation'), 'không được trả explanation lúc làm bài');
  });

  it('mỗi lượt bắt đầu ra thứ tự câu hỏi khác nhau', async () => {
    const a = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const b = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });

    const idsA = a.json().data.questions.map((q: any) => q.question_id);
    const idsB = b.json().data.questions.map((q: any) => q.question_id);

    assert.notDeepEqual(idsA, idsB, 'hai lượt khác nhau phải có thứ tự khác nhau');
    assert.equal(new Set(idsA).size, idsA.length, 'không được trùng câu');
  });

  it('check: chấm tức thì đúng/sai cho từng loại câu hỏi', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;
    const attemptId = attempt.attempt_id;

    const find = (type: string) => attempt.questions.find((q: any) => q.question_type === type);

    // MCQ: chọn đúng
    const mcqQ = find('MCQ');
    const mcqCorrect = mcqQ.options.find((o: any) => o.content === 'Amoxicillin');
    const mcqRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: mcqQ.question_id, response: { option_id: mcqCorrect.option_id } }
    });
    assert.equal(mcqRes.statusCode, 200, mcqRes.body);
    assert.equal(mcqRes.json().data.is_correct, true);
    assert.ok(mcqRes.json().data.explanation, 'phải trả giải thích');

    // TRUE_FALSE: chọn "Sai" -> phải sai
    const tfQ = find('TRUE_FALSE');
    const tfWrong = tfQ.options.find((o: any) => o.content === 'Sai');
    const tfRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: tfQ.question_id, response: { option_id: tfWrong.option_id } }
    });
    assert.equal(tfRes.json().data.is_correct, false);

    // MULTI_SELECT: chọn đúng cả 2
    const msQ = find('MULTI_SELECT');
    const msCorrect = msQ.options
      .filter((o: any) => o.content === 'Bảo vệ thận ở ĐTĐ' || o.content === 'Gây tăng kali máu')
      .map((o: any) => o.option_id);
    const msRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: msQ.question_id, response: { option_ids: msCorrect } }
    });
    assert.equal(msRes.json().data.is_correct, true);

    // FILL_BLANK: gõ khác hoa/thường vẫn đúng
    const fbQ = find('FILL_BLANK');
    const fbRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: fbQ.question_id, response: { text: 'SỐC PHẢN VỆ' } }
    });
    assert.equal(fbRes.json().data.is_correct, true);

    // MATCHING: ghép đúng cả 4 cặp
    const mQ = find('MATCHING');
    const mPairs: Record<string, string> = {};
    for (const p of mQ.payload.pairs) mPairs[p.left_label] = p.right_label;
    const mRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: mQ.question_id, response: { pairs: mPairs } }
    });
    assert.equal(mRes.json().data.is_correct, true);

    // ORDERING: đúng thứ tự
    const oQ = find('ORDERING');
    const oRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: oQ.question_id, response: { order: oQ.payload.correctOrder } }
    });
    assert.equal(oRes.json().data.is_correct, true);

    // LIKERT: không bao giờ tính đúng
    const lQ = find('LIKERT');
    const lRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: lQ.question_id, response: { level: 'Cao' } }
    });
    assert.equal(lRes.json().data.is_correct, false);
  });

  it('check không ghi vào CSDL: đổi đáp án nhiều lần vẫn chấm lại được', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;
    const attemptId = attempt.attempt_id;
    const mcqQ = attempt.questions.find((q: any) => q.question_type === 'MCQ');

    const correct = mcqQ.options.find((o: any) => o.content === 'Amoxicillin');
    const wrong = mcqQ.options.find((o: any) => o.content === 'Gentamicin');

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: mcqQ.question_id, response: { option_id: wrong.option_id } }
    });
    assert.equal(first.json().data.is_correct, false);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/check`,
      payload: { question_id: mcqQ.question_id, response: { option_id: correct.option_id } }
    });
    assert.equal(second.json().data.is_correct, true, 'phải chấm lại được sau khi đổi đáp án');
  });

  it('nộp bài chấm đúng điểm và LOẠI câu Likert khỏi mẫu số', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;
    const attemptId = attempt.attempt_id;

    const byType: Record<string, any> = {};
    for (const q of attempt.questions) byType[q.question_type] = q;

    const answers = [
      {
        question_id: byType.MCQ.question_id,
        response: {
          option_id: byType.MCQ.options.find((o: any) => o.content === 'Amoxicillin').option_id
        }
      },
      {
        question_id: byType.TRUE_FALSE.question_id,
        response: { option_id: byType.TRUE_FALSE.options.find((o: any) => o.content === 'Đúng').option_id }
      },
      {
        question_id: byType.MULTI_SELECT.question_id,
        response: {
          option_ids: byType.MULTI_SELECT.options
            .filter((o: any) => o.content === 'Bảo vệ thận ở ĐTĐ' || o.content === 'Gây tăng kali máu')
            .map((o: any) => o.option_id)
        }
      },
      { question_id: byType.FILL_BLANK.question_id, response: { text: 'sốc phản vệ' } },
      {
        question_id: byType.MATCHING.question_id,
        response: {
          pairs: Object.fromEntries(
            byType.MATCHING.payload.pairs.map((p: any) => [p.left_label, p.right_label])
          )
        }
      },
      {
        question_id: byType.ORDERING.question_id,
        response: { order: byType.ORDERING.payload.correctOrder }
      },
      { question_id: byType.LIKERT.question_id, response: { level: 'Cao' } }
    ];

    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      payload: { answers }
    });
    assert.equal(submitRes.statusCode, 200, submitRes.body);

    const result = submitRes.json().data;
    // 6 câu chấm được, tất cả đúng; Likert không tính vào mẫu số.
    assert.equal(result.total_questions, 6, 'Likert phải bị loại khỏi mẫu số');
    assert.equal(result.correct_count, 6);
    assert.equal(result.score_percentage, 100);
  });

  it('xem lại: trả đúng thứ tự đã trộn và loại câu hỏi', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;
    const attemptId = attempt.attempt_id;

    // Bỏ trống hết: mục đích là kiểm tra thứ tự và hình dạng dữ liệu xem lại.
    await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attemptId}/submit`,
      payload: { answers: attempt.questions.map((q: any) => ({ question_id: q.question_id })) }
    });

    const reviewRes = await app.inject({
      method: 'GET',
      url: `/api/v1/attempts/${attemptId}/review`
    });
    assert.equal(reviewRes.statusCode, 200, reviewRes.body);

    const details = reviewRes.json().data.details;
    assert.deepEqual(
      details.map((d: any) => d.question_id),
      attempt.questions.map((q: any) => q.question_id),
      'thứ tự xem lại phải khớp thứ tự lúc làm bài'
    );

    const matchingDetail = details.find((d: any) => d.question_type === 'MATCHING');
    assert.equal(matchingDetail.matching_right_column.length, 4, 'phải có cột phải cho câu ghép đôi');
  });

  it('từ chối đáp án không thuộc câu hỏi', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;

    const mcqQ = attempt.questions.find((q: any) => q.question_type === 'MCQ');
    const tfQ = attempt.questions.find((q: any) => q.question_type === 'TRUE_FALSE');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.attempt_id}/check`,
      payload: { question_id: mcqQ.question_id, response: { option_id: tfQ.options[0].option_id } }
    });
    assert.equal(res.statusCode, 400, 'đáp án của câu khác phải bị từ chối');
  });

  it('từ chối check khi lượt thi đã nộp', async () => {
    const startRes = await app.inject({ method: 'POST', url: `/api/v1/quizzes/${quizId}/start` });
    const attempt = startRes.json().data;

    await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.attempt_id}/submit`,
      payload: { answers: [] }
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/attempts/${attempt.attempt_id}/check`,
      payload: { question_id: attempt.questions[0].question_id, response: { option_id: null } }
    });
    assert.equal(res.statusCode, 409, 'bài đã nộp thì không chấm câu được nữa');
  });
});
