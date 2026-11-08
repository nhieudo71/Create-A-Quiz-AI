/**
 * Trộn thứ tự câu hỏi và đáp án.
 *
 * Yêu cầu: mỗi lần bắt đầu một lượt làm bài phải ra thứ tự khác, nhưng khi xem lại
 * bài đã nộp thì phải thấy ĐÚNG thứ tự lúc làm.
 *
 * Cách giải: trộn có hạt giống tất định (deterministic) theo attempt id. Cùng một
 * attempt id luôn cho cùng một thứ tự, nên không cần lưu thứ tự đã trộn vào CSDL —
 * cả lúc làm bài lẫn lúc xem lại đều tính ra được cùng kết quả.
 */

/** Băm chuỗi thành số 32-bit (FNV-1a rút gọn) làm hạt giống. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Bộ sinh số giả ngẫu nhiên tất định (mulberry32). */
function makeRng(seed: string): () => number {
  let t = hashSeed(seed);
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates với nguồn ngẫu nhiên cho trước; trả về mảng mới. */
function shuffleWith<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Trộn danh sách câu hỏi theo lượt thi. */
export function shuffleQuestions<T extends { question_id: string }>(
  questions: readonly T[],
  attemptId: string
): T[] {
  return shuffleWith(questions, makeRng(`q:${attemptId}`));
}

/**
 * Trộn các phương án của MỘT câu hỏi.
 * Hạt giống riêng theo câu để hai câu khác nhau không bị cùng một hoán vị.
 */
export function shuffleOptions<T extends { option_id: string }>(
  options: readonly T[],
  attemptId: string,
  questionId: string
): T[] {
  return shuffleWith(options, makeRng(`o:${attemptId}:${questionId}`));
}
