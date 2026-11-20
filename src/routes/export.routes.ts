import { FastifyInstance } from 'fastify';
import { AppError } from '../core/errors';
import { parseOrThrow, uuidParamsSchema } from '../core/validation/schemas';
import { ExportService } from '../modules/export/export.service';

export function registerExportRoutes(app: FastifyInstance, exportService: ExportService): void {
  app.get('/api/v1/quizzes/:id/export/docx', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const query = (req.query ?? {}) as { answers?: string };
    const includeAnswers = query.answers !== 'false';

    const { buffer, filename } = await exportService.exportQuizToDocx(id, includeAnswers);
    reply.header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return reply.send(buffer);
  });

  app.get('/api/v1/quizzes/:id/export/anki', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const { csv, filename } = await exportService.exportQuizToAnkiCsv(id);
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return reply.send(csv);
  });

  app.post('/api/v1/quizzes/import/excel', async (req, reply) => {
    if (!req.isMultipart()) {
      throw new AppError('Yêu cầu phải ở dạng multipart/form-data.', 415);
    }
    const data = await req.file();
    if (!data) throw new AppError('Không tìm thấy file Excel tải lên.', 400);

    const query = (req.query ?? {}) as { subjectName?: string; title?: string };
    const subjectName = query.subjectName?.trim() || 'Nhập từ Excel';
    const buffer = await data.toBuffer();

    const result = await exportService.importQuizFromExcel(buffer, subjectName, query.title);
    return reply.status(201).send({ success: true, data: result });
  });

  app.get('/api/v1/quizzes/:id/export/html', async (req, reply) => {
    const { id } = parseOrThrow(uuidParamsSchema, req.params);
    const { html, filename } = await exportService.exportQuizToInteractiveHtml(id);
    reply.header('content-type', 'text/html; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    return reply.send(html);
  });

  app.post('/api/v1/quizzes/import/html', async (req, reply) => {
    if (!req.isMultipart()) {
      throw new AppError('Yêu cầu phải ở dạng multipart/form-data.', 415);
    }
    const data = await req.file();
    if (!data) throw new AppError('Không tìm thấy file HTML tải lên.', 400);

    const query = (req.query ?? {}) as { subjectName?: string; title?: string };
    const buffer = await data.toBuffer();
    const htmlContent = buffer.toString('utf8');

    const result = await exportService.importQuizFromHtml(htmlContent, query.subjectName, query.title);
    return reply.status(201).send({ success: true, data: result });
  });

  app.post('/api/v1/quizzes/seed-pathology', async (_req, reply) => {
    const result = await exportService.seedGpbPathologyBank();
    return reply.status(201).send({ success: true, data: result });
  });
}
