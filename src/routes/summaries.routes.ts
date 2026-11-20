import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';
import { SummariesService } from '../modules/summaries/summaries.service';
import { ExportService } from '../modules/export/export.service';

const listSummariesQuerySchema = z.object({
  subject_id: z.string().uuid().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const createSummaryBodySchema = z.object({
  title: z.string().trim().min(1, 'Tiêu đề không được để trống').max(255),
  summary: z.string().trim().min(1, 'Nội dung tóm tắt không được để trống'),
  subject_name: z.string().trim().optional(),
  subjectName: z.string().trim().optional(),
  subject_id: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  document_id: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
  source_filename: z.string().trim().max(255).optional(),
  sourceFilename: z.string().trim().max(255).optional(),
  key_takeaways: z.any().optional(),
  keyTakeaways: z.any().optional(),
  word_count: z.number().int().nonnegative().optional(),
  wordCount: z.number().int().nonnegative().optional()
});

export function registerSummariesRoutes(
  app: FastifyInstance,
  summariesService: SummariesService,
  exportService: ExportService
): void {
  /**
   * GET /api/v1/summaries
   * Lấy danh sách các bài học tóm tắt (hỗ trợ lọc theo môn học và tìm kiếm).
   */
  app.get('/api/v1/summaries', async (req, reply) => {
    const query = parseOrThrow(listSummariesQuerySchema, req.query);

    const data = await summariesService.listSummaries({
      subjectId: query.subject_id,
      search: query.search,
      limit: query.limit,
      offset: query.offset
    });

    return reply.send({ success: true, data });
  });

  /**
   * GET /api/v1/summaries/:id
   * Lấy chi tiết bài học tóm tắt theo ID.
   */
  app.get('/api/v1/summaries/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const data = await summariesService.getSummaryById(id);
    return reply.send({ success: true, data });
  });

  /**
   * POST /api/v1/summaries
   * Tạo bài học tóm tắt mới.
   */
  app.post('/api/v1/summaries', async (req, reply) => {
    const body = parseOrThrow(createSummaryBodySchema, req.body);

    const summary = await summariesService.createSummary({
      title: body.title,
      summary: body.summary,
      subjectName: body.subject_name ?? body.subjectName,
      subjectId: body.subject_id ?? body.subjectId,
      documentId: body.document_id ?? body.documentId,
      sourceFilename: body.source_filename ?? body.sourceFilename,
      keyTakeaways: body.key_takeaways ?? body.keyTakeaways,
      wordCount: body.word_count ?? body.wordCount
    });

    return reply.status(201).send({ success: true, data: summary });
  });

  /**
   * DELETE /api/v1/summaries/:id
   * Xoá bài học tóm tắt.
   */
  app.delete('/api/v1/summaries/:id', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const result = await summariesService.deleteSummary(id);
    return reply.send({ success: true, data: result });
  });

  /**
   * GET /api/v1/summaries/:id/export/docx
   * Xuất bài học tóm tắt ra file Word (.docx).
   */
  app.get('/api/v1/summaries/:id/export/docx', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const { buffer, filename } = await exportService.exportSummaryToDocx(id);

    reply.header(
      'content-type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`
    );
    return reply.send(buffer);
  });

  /**
   * GET /api/v1/summaries/:id/export/pdf
   * Xuất bài học tóm tắt ra trang HTML in ấn chuẩn CSS A4 (tự động mở hộp thoại in / Save as PDF).
   */
  app.get('/api/v1/summaries/:id/export/pdf', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const { html, filename } = await exportService.exportSummaryToPdfHtml(id);

    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header(
      'content-disposition',
      `inline; filename="${encodeURIComponent(filename)}"`
    );
    return reply.send(html);
  });
}
