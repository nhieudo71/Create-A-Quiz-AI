import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

/**
 * Chấm điểm là phần nguy hiểm nhất của ứng dụng thi cử: chấm sai im lặng khiến
 * người học ghi nhớ kiến thức sai. Bộ test này khoá hành vi của từng loại câu hỏi.
 */

type Gradable = {
  question_type: any;
  payload: any;
  options: Array<{ id: string; label: string; content: string; is_correct: boolean }>;
};

function makeOptions(correctIds: string[], all = ['o1', 'o2', 'o3', 'o4']) {
  const labels = ['A', 'B', 'C', 'D'];
  return all.map((id, i) => ({
    id,
    label: labels[i],
    content: `Nội dung ${labels[i]}`,
    is_correct: correctIds.includes(id)
  }));
}

describe('Chấm điểm: từng loại câu hỏi', () => {
  it('MCQ: đúng khi chọn đúng option, sai khi chọn nhiễu hoặc bỏ trống', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const q: Gradable = { question_type: 'MCQ', payload: null, options: makeOptions(['o2']) };

    assert.equal(gradeAnswer(q, { option_id: 'o2' }).isCorrect, true);
    assert.equal(gradeAnswer(q, { option_id: 'o1' }).isCorrect, false);
    assert.equal(gradeAnswer(q, { option_id: null }).isCorrect, false);
  });

  it('TRUE_FALSE: 2 phương án, chấm theo is_correct', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const options = [
      { id: 't', label: 'A', content: 'Đúng', is_correct: false },
      { id: 'f', label: 'B', content: 'Sai', is_correct: true }
    ];
    const q: Gradable = { question_type: 'TRUE_FALSE', payload: null, options };

    assert.equal(gradeAnswer(q, { option_id: 'f' }).isCorrect, true);
    assert.equal(gradeAnswer(q, { option_id: 't' }).isCorrect, false);
  });

  it('MULTI_SELECT: chỉ đúng khi chọn đủ và không thừa', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const q: Gradable = { question_type: 'MULTI_SELECT', payload: null, options: makeOptions(['o1', 'o3']) };

    assert.equal(gradeAnswer(q, { option_ids: ['o1', 'o3'] }).isCorrect, true);
    // Thiếu một đáp án -> sai
    assert.equal(gradeAnswer(q, { option_ids: ['o1'] }).isCorrect, false);
    // Thừa đáp án -> sai
    assert.equal(gradeAnswer(q, { option_ids: ['o1', 'o2', 'o3'] }).isCorrect, false);
    // Bỏ trống -> sai
    assert.equal(gradeAnswer(q, { option_ids: [] }).isCorrect, false);
  });

  it('FILL_BLANK: chấp nhận khác hoa/thường và dấu, từ chối sai nội dung', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const options = [
      { id: 'a', label: 'A', content: 'Amoxicillin', is_correct: true },
      { id: 'b', label: 'B', content: 'Gentamicin', is_correct: false },
      { id: 'c', label: 'C', content: 'Doxycycline', is_correct: false },
      { id: 'd', label: 'D', content: 'Ciprofloxacin', is_correct: false }
    ];
    const q: Gradable = { question_type: 'FILL_BLANK', payload: null, options };

    assert.equal(gradeAnswer(q, { text: 'Amoxicillin' }).isCorrect, true);
    assert.equal(gradeAnswer(q, { text: '  amoxicillin  ' }).isCorrect, true);
    assert.equal(gradeAnswer(q, { text: 'Gentamicin' }).isCorrect, false);
    assert.equal(gradeAnswer(q, { text: '' }).isCorrect, false);
  });

  it('MATCHING: chỉ đúng khi ghép đúng cả 4 cặp', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const q: Gradable = {
      question_type: 'MATCHING',
      payload: {
        pairs: [
          { left_label: 'A', left: 'L1', right_label: 'B', right: 'R2' },
          { left_label: 'B', left: 'L2', right_label: 'A', right: 'R1' },
          { left_label: 'C', left: 'L3', right_label: 'D', right: 'R4' },
          { left_label: 'D', left: 'L4', right_label: 'C', right: 'R3' }
        ]
      },
      options: makeOptions(['o1', 'o2', 'o3', 'o4'])
    };

    const correct = { pairs: { A: 'B', B: 'A', C: 'D', D: 'C' } };
    assert.equal(gradeAnswer(q, correct).isCorrect, true);

    // Đúng 3/4 cặp vẫn là sai: không chấm điểm từng phần để tránh "đoán dần".
    const almost = { pairs: { A: 'B', B: 'A', C: 'D', D: 'B' } };
    assert.equal(gradeAnswer(q, almost).isCorrect, false);
  });

  it('ORDERING: đúng khi thứ tự khớp hoàn toàn', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const q: Gradable = {
      question_type: 'ORDERING',
      payload: { correctOrder: ['C', 'A', 'D', 'B'] },
      options: makeOptions(['o1', 'o2', 'o3', 'o4'])
    };

    assert.equal(gradeAnswer(q, { order: ['C', 'A', 'D', 'B'] }).isCorrect, true);
    assert.equal(gradeAnswer(q, { order: ['A', 'C', 'D', 'B'] }).isCorrect, false);
    assert.equal(gradeAnswer(q, { order: ['C', 'A', 'D'] }).isCorrect, false);
  });

  it('LIKERT: không bao giờ được tính điểm (câu khảo sát)', async () => {
    const { gradeAnswer } = await import('../src/modules/attempts/grading');
    const q: Gradable = {
      question_type: 'LIKERT',
      payload: { scale: ['Thấp', 'Trung bình', 'Cao'] },
      options: makeOptions([])
    };

    assert.equal(gradeAnswer(q, { level: 'Cao' }).isCorrect, false);
  });
});

describe('Phát hiện câu đã trả lời', () => {
  it('mọi loại câu trả lời có nội dung đều được nhận diện', async () => {
    const { hasResponse } = await import('../src/modules/attempts/grading');

    assert.equal(hasResponse({ option_id: 'x' }), true);
    assert.equal(hasResponse({ option_ids: ['a'] }), true);
    assert.equal(hasResponse({ text: 'abc' }), true);
    assert.equal(hasResponse({ level: 'Cao' }), true);
    assert.equal(hasResponse({ order: ['A'] }), true);
    assert.equal(hasResponse({ pairs: { A: 'B' } }), true);

    assert.equal(hasResponse({}), false);
    assert.equal(hasResponse({ text: '   ' }), false);
    assert.equal(hasResponse({ option_ids: [] }), false);
    assert.equal(hasResponse(null), false);
  });
});

describe('Trộn thứ tự: tất định theo lượt thi', () => {
  it('cùng attempt id cho cùng thứ tự, khác attempt id cho thứ tự khác', async () => {
    const { shuffleQuestions } = await import('../src/modules/attempts/shuffle');
    const items = Array.from({ length: 20 }, (_, i) => ({ question_id: `q${i}` }));

    const a1 = shuffleQuestions(items, 'attempt-A');
    const a2 = shuffleQuestions(items, 'attempt-A');
    const b1 = shuffleQuestions(items, 'attempt-B');

    assert.deepEqual(
      a1.map((x) => x.question_id),
      a2.map((x) => x.question_id),
      'cùng lượt thi phải ra cùng thứ tự (để xem lại khớp)'
    );
    assert.notDeepEqual(
      a1.map((x) => x.question_id),
      b1.map((x) => x.question_id),
      'lượt khác phải ra thứ tự khác'
    );
  });

  it('không làm mất hay nhân đôi câu hỏi', async () => {
    const { shuffleQuestions } = await import('../src/modules/attempts/shuffle');
    const items = Array.from({ length: 37 }, (_, i) => ({ question_id: `q${i}` }));
    const out = shuffleQuestions(items, 'attempt-x');

    assert.equal(out.length, items.length);
    assert.equal(new Set(out.map((x) => x.question_id)).size, items.length);
  });

  it('trộn đáp án cũng tất định theo (attempt, question)', async () => {
    const { shuffleOptions } = await import('../src/modules/attempts/shuffle');
    const opts = ['A', 'B', 'C', 'D'].map((l) => ({ option_id: `o${l}` }));

    const first = shuffleOptions(opts, 'att-1', 'q-1');
    const again = shuffleOptions(opts, 'att-1', 'q-1');
    assert.deepEqual(first.map((o) => o.option_id), again.map((o) => o.option_id));
    assert.equal(new Set(first.map((o) => o.option_id)).size, 4);
  });
});
