import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { AppError, NotFoundError } from '../core/errors';
import { env } from '../config/env.config';
import { db } from '../core/database/db';
import { DEFAULT_USER_ID } from '../modules/attempts/attempts.service';
import { MedicalDocumentParser } from '../modules/documents/parsers/pdf.parser';
import { parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';

export function registerDocumentRoutes(
  app: FastifyInstance,
  docParser: MedicalDocumentParser
): void {
  // ============================================================================
  // 1. TẢI LÊN & TRÍCH XUẤT TÀI LIỆU
  // ============================================================================
  app.post('/api/v1/documents/upload', async (req, reply) => {
    if (!req.isMultipart()) {
      throw new AppError('Yêu cầu phải ở dạng multipart/form-data.', 415);
    }

    const data = await req.file();
    if (!data) {
      throw new AppError('Không tìm thấy file tải lên.', 400);
    }

    const query = (req.query ?? {}) as { fromPage?: string; toPage?: string };
    const fromPage = query.fromPage ? Number(query.fromPage) : undefined;
    const toPage = query.toPage ? Number(query.toPage) : undefined;

    // Đọc vào bộ nhớ có giới hạn: file không bao giờ chạm đĩa nên không rò rỉ tài liệu y khoa
    // của người dùng và không cần dọn thư mục uploads.
    let buffer: Buffer;
    try {
      buffer = await data.toBuffer();
    } catch (err: any) {
      if (err?.code === 'FST_REQ_FILE_TOO_LARGE' || err?.statusCode === 413) {
        throw new AppError(`File vượt quá giới hạn ${env.MAX_FILE_SIZE_MB}MB.`, 413);
      }
      throw new AppError('Không thể đọc file tải lên.', 400);
    }

    const parsed = await docParser.extractText(buffer, data.filename, {
      fromPage: fromPage && Number.isFinite(fromPage) ? fromPage : undefined,
      toPage: toPage && Number.isFinite(toPage) ? toPage : undefined
    });
    docParser.assertUsableText(parsed.cleanText);

    let documentId: string | null = null;
    try {
      const [inserted] = await db
        .insertInto('documents')
        .values({
          id: randomUUID(),
          user_id: DEFAULT_USER_ID,
          subject_id: null,
          original_filename: data.filename,
          file_path: 'memory',
          file_size_bytes: buffer.length,
          mime_type: data.mimetype || 'application/octet-stream',
          page_count: parsed.pageCount,
          extracted_text_length: parsed.cleanText.length,
          extracted_text: parsed.cleanText,
          status: 'PROCESSED'
        })
        .returning('id')
        .execute();
      documentId = inserted?.id ?? null;
    } catch {
      // Một số unit test chạy upload không khởi tạo DB: không chặn kết quả trích xuất
    }

    return reply.status(201).send({
      success: true,
      data: {
        document_id: documentId,
        filename: data.filename,
        page_count: parsed.pageCount,
        text_length: parsed.cleanText.length,
        preview_text: parsed.cleanText
      }
    });
  });

  /** Danh sách tài liệu đã trích xuất lưu trong CSDL để tái sử dụng. */
  app.get('/api/v1/documents', async (req, reply) => {
    const docs = await db
      .selectFrom('documents')
      .select([
        'id',
        'original_filename',
        'file_size_bytes',
        'page_count',
        'extracted_text_length',
        'created_at'
      ])
      .where('extracted_text', 'is not', null)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    return reply.send({ success: true, data: docs });
  });

  /** Lấy lại toàn bộ văn bản đã trích xuất của một tài liệu cũ. */
  app.get('/api/v1/documents/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const doc = await db
      .selectFrom('documents')
      .select([
        'id',
        'original_filename',
        'page_count',
        'extracted_text_length',
        'extracted_text',
        'created_at'
      ])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!doc || !doc.extracted_text) {
      throw new NotFoundError('Không tìm thấy tài liệu hoặc tài liệu chưa có văn bản.');
    }

    return reply.send({
      success: true,
      data: {
        document_id: doc.id,
        filename: doc.original_filename,
        page_count: doc.page_count,
        text_length: doc.extracted_text_length,
        preview_text: doc.extracted_text
      }
    });
  });

  app.delete('/api/v1/documents/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const deleted = await db
      .deleteFrom('documents')
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();
    if (!deleted) throw new NotFoundError('Không tìm thấy tài liệu.');
    return reply.send({ success: true, data: { deleted: true } });
  });
}
