import { sql } from 'kysely';
import { db } from '../../core/database/db';
import { AppError } from '../../core/errors';
import type { DatabaseSchema } from '../../core/database/types';

export const BACKUP_FORMAT_VERSION = 1;

/**
 * Thứ tự bảng theo ràng buộc khoá ngoại: cha trước con.
 * Dùng để XUẤT (không quan trọng thứ tự) và để NHẬP (bắt buộc đúng thứ tự
 * này, nếu không insert con trước cha sẽ lỗi FK).
 */
const TABLE_ORDER = [
  'subjects',
  'documents',
  'questions',
  'question_options',
  'quizzes',
  'quiz_questions',
  'quiz_attempts',
  'attempt_answers'
] as const;

type TableName = (typeof TABLE_ORDER)[number];

export interface BackupPayload {
  format: 'tao-trac-nghiem-backup';
  version: number;
  exportedAt: string;
  tables: Record<TableName, unknown[]>;
}

/**
 * Sao lưu / phục hồi TOÀN BỘ dữ liệu quiz (môn học, câu hỏi, đề thi, lịch sử làm bài).
 *
 * CỐ Ý không bao gồm cấu hình nhà cung cấp AI / khoá API (xem settings.store.ts):
 * một bản sao lưu dữ liệu học tập có thể được chia sẻ hoặc chuyển máy một cách an toàn
 * mà không vô tình làm lộ khoá API của người xuất.
 */
export class BackupService {
  /** Xuất toàn bộ dữ liệu thành một đối tượng JSON có thể ghi thẳng ra tệp. */
  async exportAll(): Promise<BackupPayload> {
    const tables = {} as Record<TableName, unknown[]>;
    for (const table of TABLE_ORDER) {
      tables[table] = await db.selectFrom(table).selectAll().execute();
    }
    return {
      format: 'tao-trac-nghiem-backup',
      version: BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      tables
    };
  }

  /**
   * Phục hồi: XOÁ sạch dữ liệu hiện có rồi nạp lại từ bản sao lưu, trong một
   * giao dịch duy nhất. Giữ nguyên UUID gốc để các mối quan hệ không bị đứt.
   *
   * Đây là thao tác PHÁ HUỶ có chủ đích — người dùng đã được cảnh báo rõ ở giao diện
   * trước khi gọi, server không tự suy đoán "hợp nhất" dữ liệu vì dễ gây trùng/rối.
   */
  async restoreAll(payload: unknown): Promise<{ restoredTables: number; restoredRows: number }> {
    const parsed = this.validatePayload(payload);

    let restoredRows = 0;
    await db.transaction().execute(async (trx) => {
      // Xoá theo thứ tự ngược (con trước cha) để không vi phạm khoá ngoại
      for (const table of [...TABLE_ORDER].reverse()) {
        await trx.deleteFrom(table).execute();
      }

      // Nạp lại theo thứ tự cha trước con
      for (const table of TABLE_ORDER) {
        const rows = parsed.tables[table];
        if (!rows || rows.length === 0) continue;
        // Kysely insertInto nhận object[]; ép kiểu vì schema của từng bảng khác nhau
        await (trx.insertInto(table) as any).values(rows).execute();
        restoredRows += rows.length;
      }

      // PGlite/Postgres không tự đồng bộ lại identity khi insert kèm id tường minh,
      // nhưng mọi id ở đây là UUID sinh sẵn (gen_random_uuid trong SQL mặc định
      // chỉ áp dụng khi KHÔNG truyền id), nên không cần reset sequence nào.
    });

    return { restoredTables: TABLE_ORDER.length, restoredRows };
  }

  private validatePayload(payload: unknown): BackupPayload {
    if (!payload || typeof payload !== 'object') {
      throw new AppError('Tệp sao lưu không hợp lệ: không phải JSON object.', 400);
    }
    const candidate = payload as Partial<BackupPayload>;
    if (candidate.format !== 'tao-trac-nghiem-backup') {
      throw new AppError('Tệp không phải bản sao lưu của MedQuiz AI.', 400);
    }
    if (typeof candidate.version !== 'number' || candidate.version > BACKUP_FORMAT_VERSION) {
      throw new AppError(
        `Phiên bản sao lưu (${candidate.version}) mới hơn ứng dụng hiện tại. Hãy cập nhật ứng dụng trước.`,
        400
      );
    }
    if (!candidate.tables || typeof candidate.tables !== 'object') {
      throw new AppError('Tệp sao lưu thiếu dữ liệu bảng.', 400);
    }
    for (const table of TABLE_ORDER) {
      const rows = (candidate.tables as any)[table];
      if (rows !== undefined && !Array.isArray(rows)) {
        throw new AppError(`Dữ liệu bảng "${table}" trong tệp sao lưu không hợp lệ.`, 400);
      }
    }
    return candidate as BackupPayload;
  }

  /** Số liệu tổng quan để hiển thị trước khi người dùng xác nhận phục hồi. */
  async previewPayload(payload: unknown): Promise<Record<string, number>> {
    const parsed = this.validatePayload(payload);
    const summary: Record<string, number> = {};
    for (const table of TABLE_ORDER) {
      summary[table] = parsed.tables[table]?.length ?? 0;
    }
    return summary;
  }

  /** Số liệu hiện có trong CSDL, dùng để hiển thị trước khi xuất/phục hồi. */
  async currentCounts(): Promise<Record<string, number>> {
    const summary: Record<string, number> = {};
    for (const table of TABLE_ORDER) {
      const row = await db
        .selectFrom(table)
        .select(sql<number>`count(*)`.as('count'))
        .executeTakeFirstOrThrow();
      summary[table] = Number(row.count);
    }
    return summary;
  }
}
