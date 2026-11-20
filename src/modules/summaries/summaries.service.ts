import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { db } from '../../core/database/db';
import { ConflictError, NotFoundError } from '../../core/errors';

export interface ListSummariesOptions {
  subjectId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface CreateSummaryDto {
  title: string;
  summary: string;
  subjectName?: string;
  subjectId?: string;
  documentId?: string;
  sourceFilename?: string;
  keyTakeaways?: any;
  wordCount?: number;
}

export interface DocumentSummaryItem {
  id: string;
  title: string;
  subject_id: string | null;
  document_id: string | null;
  summary: string;
  key_takeaways: unknown | null;
  source_filename: string | null;
  word_count: number;
  created_at: Date;
  updated_at: Date;
  subject_name: string | null;
}

const MAX_SUBJECT_CREATE_TRIES = 3;

function countWords(text: string): number {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export class SummariesService {
  /**
   * Tra cứu hoặc tạo mới môn học theo tên (không phân biệt hoa thường).
   */
  private async getOrCreateSubject(subjectName: string): Promise<string> {
    const cleanName = subjectName.trim();
    for (let attempt = 0; attempt < MAX_SUBJECT_CREATE_TRIES; attempt++) {
      const existing = await db
        .selectFrom('subjects')
        .selectAll()
        .where(sql<string>`lower(${sql.ref('name')})`, '=', cleanName.toLowerCase())
        .executeTakeFirst();

      if (existing) return existing.id;

      const [inserted] = await db
        .insertInto('subjects')
        .values({
          code: `SUB_${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          name: cleanName,
          description: `Môn học ${cleanName}`
        })
        .onConflict((oc) => oc.doNothing())
        .returningAll()
        .execute();

      if (inserted) return inserted.id;
    }

    throw new ConflictError('Không thể tạo môn học, vui lòng thử lại.');
  }

  /**
   * Lấy danh sách các bài học tóm tắt, hỗ trợ tìm kiếm và lọc theo môn học.
   */
  async listSummaries(options: ListSummariesOptions = {}): Promise<DocumentSummaryItem[]> {
    let query = db
      .selectFrom('document_summaries')
      .leftJoin('subjects', 'subjects.id', 'document_summaries.subject_id')
      .select([
        'document_summaries.id',
        'document_summaries.title',
        'document_summaries.subject_id',
        'document_summaries.document_id',
        'document_summaries.summary',
        'document_summaries.key_takeaways',
        'document_summaries.source_filename',
        'document_summaries.word_count',
        'document_summaries.created_at',
        'document_summaries.updated_at',
        'subjects.name as subject_name'
      ]);

    if (options.subjectId) {
      query = query.where('document_summaries.subject_id', '=', options.subjectId);
    }

    if (options.search?.trim()) {
      const term = `%${options.search.trim().toLowerCase()}%`;
      query = query.where((eb) =>
        eb.or([
          sql<boolean>`lower(document_summaries.title) LIKE ${term}`,
          sql<boolean>`lower(document_summaries.summary) LIKE ${term}`,
          sql<boolean>`coalesce(lower(document_summaries.source_filename), '') LIKE ${term}`,
          sql<boolean>`coalesce(lower(subjects.name), '') LIKE ${term}`
        ])
      );
    }

    query = query.orderBy('document_summaries.created_at', 'desc');

    if (options.limit && options.limit > 0) {
      query = query.limit(options.limit);
    }

    if (options.offset && options.offset > 0) {
      query = query.offset(options.offset);
    }

    const rows = await query.execute();
    return rows as DocumentSummaryItem[];
  }

  /**
   * Lấy chi tiết bài học tóm tắt theo ID. Ném NotFoundError nếu không tìm thấy.
   */
  async getSummaryById(id: string): Promise<DocumentSummaryItem> {
    const summary = await db
      .selectFrom('document_summaries')
      .leftJoin('subjects', 'subjects.id', 'document_summaries.subject_id')
      .select([
        'document_summaries.id',
        'document_summaries.title',
        'document_summaries.subject_id',
        'document_summaries.document_id',
        'document_summaries.summary',
        'document_summaries.key_takeaways',
        'document_summaries.source_filename',
        'document_summaries.word_count',
        'document_summaries.created_at',
        'document_summaries.updated_at',
        'subjects.name as subject_name'
      ])
      .where('document_summaries.id', '=', id)
      .executeTakeFirst();

    if (!summary) {
      throw new NotFoundError('Không tìm thấy bài tóm tắt.');
    }

    return summary as DocumentSummaryItem;
  }

  /**
   * Tạo bài học tóm tắt mới.
   * Tự động tra cứu hoặc tạo subject nếu có subjectName.
   * Tự động tính word_count nếu không được cung cấp.
   */
  async createSummary(data: CreateSummaryDto): Promise<DocumentSummaryItem> {
    let subjectId = data.subjectId;
    if (!subjectId && data.subjectName?.trim()) {
      subjectId = await this.getOrCreateSubject(data.subjectName.trim());
    }

    const computedWordCount =
      data.wordCount && data.wordCount > 0
        ? data.wordCount
        : countWords(data.summary);

    const [inserted] = await db
      .insertInto('document_summaries')
      .values({
        title: data.title.trim(),
        subject_id: subjectId ?? null,
        document_id: data.documentId ?? null,
        summary: data.summary,
        key_takeaways: data.keyTakeaways ? JSON.stringify(data.keyTakeaways) : null,
        source_filename: data.sourceFilename?.trim() || null,
        word_count: computedWordCount
      })
      .returningAll()
      .execute();

    return await this.getSummaryById(inserted.id);
  }

  /**
   * Xoá bài học tóm tắt theo ID.
   */
  async deleteSummary(id: string): Promise<{ deleted: boolean }> {
    const result = await db
      .deleteFrom('document_summaries')
      .where('id', '=', id)
      .executeTakeFirst();

    if (Number(result.numDeletedRows) === 0) {
      throw new NotFoundError('Không tìm thấy bài tóm tắt để xoá.');
    }

    return { deleted: true };
  }
}
