/**
 * Ước lượng thời gian sinh câu hỏi để giao diện hiển thị đếm ngược.
 *
 * Server không báo tiến trình theo từng batch (request là một lượt gọi dài), nên
 * thời gian còn lại chỉ có thể ước lượng. Cách làm: ghi lại thời gian thật của các
 * lần sinh trước để lần sau ước lượng sát hơn, và quy đổi tuyến tính theo số câu.
 *
 * Ước lượng chỉ để người dùng biết phải chờ bao lâu — không dùng cho bất kỳ quyết
 * định nghiệp vụ nào, nên sai số chấp nhận được.
 */

const STORAGE_KEY = 'medquiz.generationHistory';
const HISTORY_LIMIT = 8;

/** Kích thước batch và độ song song, phải khớp với /api/v1/questions/generate. */
const BATCH_SIZE = 25;
const MAX_CONCURRENCY = 4;
/** Ước lượng thô cho một lượt gọi AI khi chưa có dữ liệu lịch sử. */
const SECONDS_PER_BATCH = 45;

interface GenerationRecord {
  count: number;
  seconds: number;
  at: number;
}

function readHistory(): GenerationRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is GenerationRecord =>
        r && typeof r.count === 'number' && r.count > 0 && typeof r.seconds === 'number' && r.seconds > 0
    );
  } catch {
    return [];
  }
}

function writeHistory(records: GenerationRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-HISTORY_LIMIT)));
  } catch {
    // Hết dung lượng hoặc chế độ riêng tư: bỏ qua, chỉ mất phần ước lượng chính xác hơn.
  }
}

/**
 * Ghi nhận thời gian thật của một lần sinh câu hỏi.
 * Gọi khi request thành công; lần sau ước lượng sẽ dựa trên số liệu này.
 */
export function recordGenerationDuration(targetCount: number, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || targetCount <= 0) return;
  const history = readHistory();
  history.push({ count: targetCount, seconds, at: Date.now() });
  writeHistory(history);
}

/** Thời gian dự kiến (giây) cho `targetCount` câu hỏi. */
export function estimateGenerationSeconds(targetCount: number): number {
  if (targetCount <= 0) return 0;

  const history = readHistory();
  if (history.length > 0) {
    const avgSecondsPerQuestion =
      history.reduce((sum, r) => sum + r.seconds / r.count, 0) / history.length;
    // Không hạ thấp hơn 10 giây: tránh đếm ngược về 0 rồi vẫn phải chờ.
    return Math.max(10, Math.round(avgSecondsPerQuestion * targetCount));
  }

  const batches = Math.ceil(targetCount / BATCH_SIZE);
  const rounds = Math.ceil(batches / MAX_CONCURRENCY);
  return Math.max(10, rounds * SECONDS_PER_BATCH);
}

/** Định dạng giây thành mm:ss (hoặc "h:mm:ss" khi vượt một giờ). */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
