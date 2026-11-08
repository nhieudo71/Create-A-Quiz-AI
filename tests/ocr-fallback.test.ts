import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AppError } from '../src/core/errors';
import type { OcrResult } from '../src/modules/documents/parsers/ocr';

// Phải đặt trước khi import module đọc cấu hình (env được parse ngay lúc import).
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

/**
 * Dựng một PDF một trang tối giản có text layer thật, để kiểm tra nhánh
 * "PDF bình thường" mà không cần file mẫu đi kèm.
 */
function makeTextPdf(text: string, repeat = 1): Buffer {
  const body = Array.from({ length: repeat }, () => `(${text}) Tj`).join(' T* ');
  const content = `BT /F1 20 Tf 40 700 Td ${body} ET`;
  const objs: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    4: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    5: `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  };

  const parts: Buffer[] = [];
  const offsets: Record<number, number> = {};
  const push = (s: string) => parts.push(Buffer.from(s, 'latin1'));
  const size = () => parts.reduce((n, b) => n + b.length, 0);

  push('%PDF-1.4\n');
  for (let i = 1; i <= 5; i++) {
    offsets[i] = size();
    push(`${i} 0 obj\n${objs[i]}\nendobj\n`);
  }
  const xrefStart = size();
  push('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return Buffer.concat(parts);
}

/** OCR giả: trả về đúng nội dung mong muốn và ghi lại số lần bị gọi. */
function stubOcr(result: OcrResult | (() => Promise<OcrResult>)) {
  const calls: Buffer[] = [];
  const fn = async (buffer: Buffer): Promise<OcrResult> => {
    calls.push(buffer);
    return typeof result === 'function' ? result() : result;
  };
  return { fn, calls };
}

const LONG_TEXT =
  'Benh nhan nam gioi 45 tuoi nhap vien vi sot cao, ho khan va kho tho tang dan trong ba ngay gan day. ' +
  'Chan doan nghi ngo viem phoi cong dong, can lam them X-quang phoi va cong thuc mau do.';

describe('Parser: OCR dự phòng cho PDF scan', () => {
  it('PDF có text layer: KHÔNG gọi OCR', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const { fn, calls } = stubOcr({ text: 'khong duoc dung', pagesProcessed: 1 });
    const parser = new MedicalDocumentParser(fn);

    const result = await parser.extractText(makeTextPdf('Hello OCR fallback test', 12));

    assert.equal(calls.length, 0, 'không được chạy OCR khi PDF đã có text layer');
    assert.equal((result as any).usedOcr, undefined);
    assert.ok(result.cleanText.includes('Hello OCR fallback test'));
  });

  it('PDF scan (text layer rỗng): dùng kết quả OCR', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const { fn, calls } = stubOcr({ text: LONG_TEXT, pagesProcessed: 2 });
    const parser = new MedicalDocumentParser(fn);

    // PDF không có nội dung chữ nào -> mô phỏng đúng file scan.
    const result = await parser.extractText(makeTextPdf(''));

    assert.equal(calls.length, 1, 'phải chạy OCR đúng một lần');
    assert.equal((result as any).usedOcr, true);
    assert.equal(result.cleanText, LONG_TEXT);
    // pdf-parse vẫn đếm được số trang dù không đọc được chữ; chỉ khi nó không đếm
    // được (0) mới lấy số trang từ kết quả OCR.
    assert.equal(result.pageCount, 1);
  });

  it('OCR trả về quá ít chữ: giữ nguyên text layer ngắn, không bịa nội dung', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const { fn } = stubOcr({ text: 'abc', pagesProcessed: 1 });
    const parser = new MedicalDocumentParser(fn);

    const result = await parser.extractText(makeTextPdf(''));

    assert.equal((result as any).usedOcr, undefined);
    assert.equal(result.cleanText, '');
    assert.throws(() => parser.assertUsableText(result.cleanText), AppError);
  });

  it('OCR lỗi khi text layer rỗng: ném lỗi OCR thay vì trả văn bản rỗng lặng lẽ', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const { fn } = stubOcr(async () => {
      throw new AppError('Không nhận diện được văn bản từ ảnh scan trong PDF.', 422);
    });
    const parser = new MedicalDocumentParser(fn);

    await assert.rejects(
      () => parser.extractText(makeTextPdf('')),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /nhận diện/);
        return true;
      }
    );
  });

  it('thông báo lỗi cuối cùng nói rõ đã thử OCR', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser(stubOcr({ text: '', pagesProcessed: 1 }).fn);

    assert.throws(
      () => parser.assertUsableText('quá ngắn'),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 422);
        assert.match(err.message, /OCR/);
        return true;
      }
    );
  });
});
