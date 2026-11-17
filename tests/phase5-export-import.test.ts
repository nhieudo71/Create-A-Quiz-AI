import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';

process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';
process.env.APP_SCHEMA_PATH = path.join(__dirname, '..', 'docs', 'DATABASE_SCHEMA.sql');

describe('API: Giai đoạn 5 - Xuất Word, Anki & Nhập Excel', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    const { runMigrations } = await import('../src/core/database/migrate');
    await runMigrations();
    app = buildApp({ disableRateLimit: true });
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  it('nhập đề từ Excel (.xlsx) -> xuất Word (.docx) & Anki (.csv)', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('CauHoi');
    sheet.addRow(['Câu hỏi', 'A', 'B', 'C', 'D', 'Đáp án đúng', 'Độ khó', 'Giải thích']);
    sheet.addRow([
      'Thuốc nào ức chế men chuyển?',
      'Enalapril',
      'Amlodipine',
      'Furosemide',
      'Atenolol',
      'A',
      'EASY',
      'Enalapril thuộc nhóm ACEi.'
    ]);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const boundary = '----MedQuizExcelBoundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="questions.xlsx"\r\n' +
          'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
      ),
      xlsxBuf,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/quizzes/import/excel?subjectName=TimMach',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    });
    assert.equal(importRes.statusCode, 201);
    const imported = importRes.json().data;
    assert.equal(imported.importedCount, 1);
    const quizId = imported.quiz.id;

    // Xuất Word (.docx) — kiểm tra magic bytes ZIP (PK\x03\x04)
    const docxRes = await app.inject({ method: 'GET', url: `/api/v1/quizzes/${quizId}/export/docx` });
    assert.equal(docxRes.statusCode, 200);
    assert.equal(docxRes.rawPayload[0], 0x50);
    assert.equal(docxRes.rawPayload[1], 0x4b);

    // Xuất Anki (.csv)
    const ankiRes = await app.inject({ method: 'GET', url: `/api/v1/quizzes/${quizId}/export/anki` });
    assert.equal(ankiRes.statusCode, 200);
    assert.ok(ankiRes.body.includes('Enalapril'));
  });
});
