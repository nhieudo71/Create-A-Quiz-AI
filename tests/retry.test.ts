import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../src/core/errors';
import {
  DEFAULT_RETRY_ATTEMPTS,
  extractHttpStatus,
  isTransientStatus,
  retryDelayMs,
  withRetry
} from '../src/modules/ai-generator/providers/retry';

/** Lỗi giả lập đúng hình dạng GoogleGenerativeAIFetchError (có `status`). */
function fetchError(status: number, message = 'fetch failed'): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

/** Ghi lại các khoảng chờ thay vì chờ thật để test chạy tức thì. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return {
    waits,
    sleep: async (ms: number) => {
      waits.push(ms);
    }
  };
}

describe('Retry: phân loại lỗi', () => {
  it('coi 429/502/503 là tạm thời (đáng thử lại)', () => {
    assert.equal(isTransientStatus(429), true);
    assert.equal(isTransientStatus(502), true);
    assert.equal(isTransientStatus(503), true);
  });

  it('KHÔNG thử lại lỗi cấu hình và lỗi mơ hồ', () => {
    // 401/403 = khoá sai; 400/404 = yêu cầu/model sai. Thử lại chỉ tốn thời gian.
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(isTransientStatus(status), false, `mã ${status} không nên thử lại`);
    }
    // 500 và 504 cố ý bị loại: máy chủ có thể đã xử lý xong rồi mới lỗi,
    // thử lại có thể khiến người dùng bị tính phí hai lần.
    assert.equal(isTransientStatus(500), false);
    assert.equal(isTransientStatus(504), false);
    assert.equal(isTransientStatus(undefined), false);
    assert.equal(isTransientStatus(null), false);
  });

  it('đọc được mã từ `status` của SDK Google', () => {
    assert.equal(extractHttpStatus(fetchError(503)), 503);
  });

  it('đọc được mã từ `statusCode` của SDK khác', () => {
    const err = Object.assign(new Error('nope'), { statusCode: 429 });
    assert.equal(extractHttpStatus(err), 429);
  });

  it('bỏ qua AppError: mã của ta đã được ánh xạ, không phản ánh lỗi gốc', () => {
    // Mọi lỗi nhà cung cấp đều được http.ts bọc thành AppError 502.
    // Nếu dùng statusCode đó để quyết định thì lỗi 401 cũng "đáng thử lại".
    assert.equal(extractHttpStatus(new AppError('lỗi mạng', 502)), null);
  });

  it('trả null với lỗi không có mã', () => {
    assert.equal(extractHttpStatus(new Error('boom')), null);
    assert.equal(extractHttpStatus(null), null);
    assert.equal(extractHttpStatus('chuỗi'), null);
  });
});

describe('Retry: chờ theo cấp số nhân', () => {
  it('tăng dần theo số lần thử', () => {
    const first = retryDelayMs(1, 1000, 60_000);
    const second = retryDelayMs(2, 1000, 60_000);
    const third = retryDelayMs(3, 1000, 60_000);

    // Jitter ±25% nên so sánh theo khoảng, không so bằng số tuyệt đối.
    assert.ok(first >= 1000 && first <= 1250, `lần 1 = ${first}`);
    assert.ok(second >= 2000 && second <= 2500, `lần 2 = ${second}`);
    assert.ok(third >= 4000 && third <= 5000, `lần 3 = ${third}`);
  });

  it('không vượt quá mức trần', () => {
    const delay = retryDelayMs(20, 1000, 8_000);
    assert.ok(delay <= 10_000, `phải bị chặn ở mức trần, nhận ${delay}`);
  });
});

describe('Retry: withRetry', () => {
  it('trả kết quả ngay khi lần đầu thành công', async () => {
    const { sleep, waits } = recordingSleep();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls++;
        return 'xong';
      },
      { sleep }
    );

    assert.equal(result, 'xong');
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  it('thử lại khi gặp 503 rồi thành công', async () => {
    const { sleep, waits } = recordingSleep();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw fetchError(503, 'This model is currently experiencing high demand');
        return 'lần thứ ba';
      },
      { sleep }
    );

    assert.equal(result, 'lần thứ ba');
    assert.equal(calls, 3);
    // Hai lần hỏng => hai lần chờ, lần thành công không chờ thêm.
    assert.equal(waits.length, 2);
  });

  it('bỏ cuộc sau khi hết số lần thử và ném lỗi gốc', async () => {
    const { sleep, waits } = recordingSleep();
    let calls = 0;

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw fetchError(503);
          },
          { attempts: 3, sleep }
        ),
      (err: any) => err.status === 503
    );

    assert.equal(calls, 3);
    // Lần thử cuối thất bại thì không chờ vô ích nữa.
    assert.equal(waits.length, 2);
  });

  it('không thử lại lỗi cấu hình (401)', async () => {
    const { sleep, waits } = recordingSleep();
    let calls = 0;

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw fetchError(401, 'API key not valid');
          },
          { sleep }
        ),
      (err: any) => err.status === 401
    );

    // Điểm mấu chốt: khoá sai thì gọi lại 3 lần cũng sai, chỉ làm người dùng chờ lâu hơn.
    assert.equal(calls, 1);
    assert.deepEqual(waits, []);
  });

  it('không thử lại AppError do ta ném ra', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;

    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls++;
            throw new AppError('Tài liệu bị bộ lọc an toàn chặn', 422);
          },
          { sleep }
        ),
      /bộ lọc an toàn/
    );

    assert.equal(calls, 1);
  });

  it('luôn thử ít nhất một lần dù cấu hình sai', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        return 'ok';
      },
      { attempts: 0, sleep: async () => {} }
    );

    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  it('cho phép thay điều kiện thử lại', async () => {
    const { sleep } = recordingSleep();
    let calls = 0;

    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('lỗi bất kỳ');
        return 'ổn';
      },
      { sleep, isRetryable: () => true }
    );

    assert.equal(result, 'ổn');
    assert.equal(calls, 2);
  });

  it('mặc định là 3 lần thử', () => {
    assert.equal(DEFAULT_RETRY_ATTEMPTS, 3);
  });
});

