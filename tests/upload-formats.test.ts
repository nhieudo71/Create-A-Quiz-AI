import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

// DB nhúng trên bộ nhớ: route upload không chạm DB nên không cần migration.
process.env.DB_MODE = 'embedded';
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

const LONG_TEXT =
  'Benh nhan nam gioi 45 tuoi nhap vien vi sot cao, ho khan va kho tho tang dan trong ba ngay gan day. ' +
  'Chan doan nghi ngo viem phoi cong dong, can lam them X-quang phoi va cong thuc mau do.';

/** Ghép multipart/form-data thủ công để inject được file kèm tên + content-type. */
function multipart(filename: string, content: Buffer, contentType: string) {
  const boundary = '----testboundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
    'utf8'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, content, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }
  };
}

async function makeXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Duoc ly');
  sheet.addRow(['Thuốc', 'Liều lượng', 'Chỉ định']);
  sheet.addRow(['Paracetamol', '500mg', 'Giảm đau, hạ sốt']);
  sheet.addRow(['Amoxicillin', '500mg', 'Nhiễm khuẩn hô hấp']);
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

async function makeDocx(text: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>'
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('API upload: đa định dạng tài liệu', () => {
  let app: FastifyInstance;
  let closeDatabase: () => Promise<void>;

  before(async () => {
    const { buildApp } = await import('../src/app');
    const dbModule = await import('../src/core/database/db');
    app = buildApp();
    closeDatabase = dbModule.closeDatabase;
    await app.ready();
  });

  after(async () => {
    await app.close();
    await closeDatabase();
  });

  const upload = async (filename: string, content: Buffer, contentType: string) => {
    const { payload, headers } = multipart(filename, content, contentType);
    return app.inject({
      method: 'POST',
      url: '/api/v1/documents/upload',
      payload,
      headers
    });
  };

  it('nhận file .txt', async () => {
    const res = await upload('bai-giang.txt', Buffer.from(LONG_TEXT, 'utf8'), 'text/plain');
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.filename, 'bai-giang.txt');
    assert.ok(body.data.text_length >= LONG_TEXT.length - 10);
    assert.ok(body.data.preview_text.includes('viem phoi cong dong'));
  });

  it('nhận file .md giữ cú pháp Markdown', async () => {
    const md = `# Dược lý\n\n- Paracetamol\n\n${LONG_TEXT}`;
    const res = await upload('ghi-chu.md', Buffer.from(md, 'utf8'), 'text/markdown');
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().data.preview_text.includes('# Dược lý'));
  });

  it('nhận file .csv', async () => {
    const res = await upload('bang.csv', Buffer.from(`Thuoc,Lieu\n${LONG_TEXT}`, 'utf8'), 'text/csv');
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().data.preview_text.includes('Thuoc,Lieu'));
  });

  it('nhận file .html đã bỏ thẻ', async () => {
    const html = `<!doctype html><html><body><h1>Dược lý</h1><p>${LONG_TEXT}</p></body></html>`;
    const res = await upload('bai.html', Buffer.from(html, 'utf8'), 'text/html');
    assert.equal(res.statusCode, 201);
    const preview = res.json().data.preview_text;
    assert.ok(preview.includes('Dược lý'));
    assert.ok(!preview.includes('<h1>'), 'phải bỏ thẻ HTML');
  });

  it('nhận file .xlsx', async () => {
    const res = await upload(
      'duoc-ly.xlsx',
      await makeXlsx(),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    assert.equal(res.statusCode, 201);
    const preview = res.json().data.preview_text;
    assert.ok(preview.includes('Paracetamol | 500mg | Giảm đau, hạ sốt'));
  });

  it('nhận file .docx', async () => {
    const res = await upload(
      'bai.docx',
      await makeDocx(LONG_TEXT),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    assert.equal(res.statusCode, 201);
    assert.ok(res.json().data.preview_text.includes('viem phoi cong dong'));
  });

  it('file .txt quá ngắn -> 422', async () => {
    const res = await upload('ngan.txt', Buffer.from('qua ngan', 'utf8'), 'text/plain');
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().success, false);
  });

  it('định dạng không hỗ trợ -> 415', async () => {
    const zip = new JSZip();
    zip.file('content.xml', '<x/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const res = await upload('tai-lieu.odt', buffer, 'application/vnd.oasis.opendocument.text');
    assert.equal(res.statusCode, 415);
    assert.equal(res.json().success, false);
  });
});
