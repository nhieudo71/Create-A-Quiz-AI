import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

import { AppError } from '../src/core/errors';

// Phải đặt trước khi import module đọc cấu hình (env được parse ngay lúc import).
process.env.DB_DATA_DIR = 'memory://';
process.env.NODE_ENV = 'test';

const LONG_TEXT =
  'Benh nhan nam gioi 45 tuoi nhap vien vi sot cao, ho khan va kho tho tang dan trong ba ngay gan day. ' +
  'Chan doan nghi ngo viem phoi cong dong, can lam them X-quang phoi va cong thuc mau do. ' +
  'Dieu tri ban dau gom khang sinh pho rong va bu dich truyen tinh the.';

/** Dựng file .docx tối giản (chỉ word/document.xml) đủ để mammoth đọc ra văn bản. */
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

/** Dựng file .xlsx tối giản bằng exceljs (đúng cấu trúc thật, có xl/). */
async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Duoc ly');
  rows.forEach((row) => sheet.addRow(row));
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/** Dựng file .pptx tối giản: đủ `ppt/slides/slideN.xml` để parser đọc. */
async function makePptx(slides: string[][], notes: string[] = []): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      '</Types>'
  );
  zip.file(
    'ppt/presentation.xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'
  );

  slides.forEach((paragraphs, i) => {
    const body = paragraphs
      .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
      .join('');
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        `<p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    );
  });

  notes.forEach((text, i) => {
    zip.file(
      `ppt/notesSlides/notesSlide${i + 1}.xml`,
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
        `<a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:notes>`
    );
  });

  return zip.generateAsync({ type: 'nodebuffer' });
}

/** Ảnh PNG 1x1 hợp lệ — đủ để nhận diện magic bytes, không cần nội dung chữ. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);


describe('Parser: nhận diện định dạng theo nội dung', () => {
  it('phân biệt PDF, văn bản, HTML và ảnh', async () => {
    const { detectDocumentKind } = await import('../src/modules/documents/parsers/pdf.parser');

    assert.equal(detectDocumentKind(Buffer.from('%PDF-1.7\n...')), 'pdf');
    assert.equal(detectDocumentKind(TINY_PNG), 'image');
    assert.equal(detectDocumentKind(Buffer.from('<html><body>Y khoa</body></html>')), 'html');
    assert.equal(detectDocumentKind(Buffer.from(LONG_TEXT)), 'text');
    assert.equal(detectDocumentKind(await makeDocx(LONG_TEXT)), 'docx');
  });

  it('phân biệt Word và Excel bằng cấu trúc ZIP bên trong', async () => {
    const { detectZipKind } = await import('../src/modules/documents/parsers/pdf.parser');

    assert.equal(await detectZipKind(await makeDocx(LONG_TEXT)), 'docx');
    assert.equal(await detectZipKind(await makeXlsx([['Thuốc', 'Liều']])), 'excel');
    assert.equal(await detectZipKind(await makePptx([['Amoxicillin']])), 'pptx');

    // ZIP thường (không phải tài liệu Office) không được nhận nhầm.
    const plainZip = new JSZip();
    plainZip.file('readme.txt', 'hello');
    const buffer = await plainZip.generateAsync({ type: 'nodebuffer' });
    assert.equal(await detectZipKind(buffer), null);
  });

  it('dữ liệu nhị phân ngẫu nhiên không bị nhận nhầm là văn bản', async () => {
    const { detectDocumentKind } = await import('../src/modules/documents/parsers/pdf.parser');
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0a, 0xff, 0xfe]);
    assert.equal(detectDocumentKind(binary), null);
  });

  it('văn bản mở đầu bằng "BM" (vd: trích BMJ) không bị nhận nhầm là ảnh BMP', async () => {
    const { detectDocumentKind } = await import('../src/modules/documents/parsers/pdf.parser');
    const text = 'BMJ 2024;384:e076123 nghien cuu ve viem phoi cong dong o nguoi lon';
    assert.equal(detectDocumentKind(Buffer.from(text, 'utf8')), 'text');
  });

  it('ảnh BMP thật vẫn được nhận diện', async () => {
    const { detectDocumentKind } = await import('../src/modules/documents/parsers/pdf.parser');
    // Header BMP 14 byte tối thiểu: "BM", size=64, reserved=0, offset=54
    const header = Buffer.alloc(54);
    header.write('BM', 0, 'latin1');
    header.writeUInt32LE(54, 2);
    header.writeUInt32LE(0, 6);
    header.writeUInt32LE(54, 10);
    assert.equal(detectDocumentKind(header), 'image');
  });
});


describe('Parser: đọc PowerPoint (.pptx)', () => {
  it('trích xuất chữ từ các slide theo đúng thứ tự', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    // Cố ý đặt nhiều slide để kiểm tra sắp xếp theo số, không theo chuỗi.
    const slides: string[][] = [];
    for (let i = 1; i <= 11; i++) slides.push([`Noi dung slide so ${i} ve duoc ly hoc lam sang`]);

    const result = await parser.extractText(await makePptx(slides), 'bai-giang.pptx');

    assert.ok(result.cleanText.includes('### Slide 1'), 'phải đánh số slide');
    assert.ok(result.cleanText.includes('### Slide 11'), 'phải đọc tới slide cuối');

    // slide2 phải đứng trước slide10 (sắp xếp theo số, không phải theo chuỗi).
    const idx2 = result.cleanText.indexOf('Noi dung slide so 2 ');
    const idx10 = result.cleanText.indexOf('Noi dung slide so 10 ');
    assert.ok(idx2 > -1 && idx10 > -1);
    assert.ok(idx2 < idx10, 'slide 2 phải đứng trước slide 10');
  });

  it('đọc cả ghi chú thuyết trình của giảng viên', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const result = await parser.extractText(
      await makePptx([['Amoxicillin uc che tong hop vach te bao vi khuan']], ['Luu y: benh nhan di ung penicillin']),
      'slide.pptx'
    );

    assert.ok(result.cleanText.includes('Ghi chú: Luu y: benh nhan di ung penicillin'));
  });

  it('nối các đoạn chữ bị PowerPoint tách rời trong cùng một dòng', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const zip = new JSZip();
    zip.file(
      'ppt/slides/slide1.xml',
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>' +
        '<a:p><a:r><a:t>Amoxi</a:t></a:r><a:r><a:t>cillin</a:t></a:r></a:p>' +
        '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
    );
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await parser.extractText(buffer, 'tach-dong.pptx');
    assert.ok(result.cleanText.includes('Amoxicillin'), 'phải nối run bị tách thành một từ');
  });

  it('báo lỗi rõ ràng khi slide chỉ có hình, không có chữ', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const buffer = await makePptx([[''], ['']]);
    await assert.rejects(
      () => parser.extractText(buffer, 'chi-co-hinh.pptx'),
      (err: any) => err instanceof AppError && /PowerPoint/.test(err.message)
    );
  });
});


describe('Parser: đọc văn bản thuần, Markdown, CSV, HTML', () => {
  it('đọc file .txt và chuẩn hoá xuống dòng CRLF về LF', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    // Mỗi từ trên một dòng, ngăn bằng CRLF thật.
    const crlfText = LONG_TEXT.split(' ').join('\r\n');
    const result = await parser.extractText(Buffer.from(crlfText, 'utf8'), 'bai.txt');

    assert.ok(result.cleanText.includes('viem'), 'phải đọc được nội dung');
    assert.ok(!result.cleanText.includes('\r'), 'phải chuẩn hoá CRLF về LF');
    assert.equal(result.pageCount, 0);
  });

  it('đọc file Markdown và giữ cú pháp cấu trúc', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const md = `# Dược lý\n\n- Paracetamol: giảm đau, hạ sốt\n- Amoxicillin: kháng sinh\n\n${LONG_TEXT}`;
    const result = await parser.extractText(Buffer.from(md, 'utf8'), 'ghi-chu.md');

    assert.ok(result.cleanText.includes('# Dược lý'), 'phải giữ tiêu đề Markdown');
    assert.ok(result.cleanText.includes('- Paracetamol'));
  });

  it('đọc file CSV', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const result = await parser.extractText(Buffer.from(`Thuoc,Lieu\n${LONG_TEXT}`, 'utf8'), 'bang.csv');

    assert.ok(result.cleanText.includes('Thuoc,Lieu'));
  });

  it('đọc file HTML: bỏ thẻ, giải mã entity, giữ nội dung', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const html =
      '<!doctype html><html><head><title>x</title><style>.a{color:red}</style></head>' +
      '<body><h1>B&#7879;nh h&#7885;c</h1>' +
      '<p>Nh&#7891;i m&aacute;u c&#417; tim &amp; &#273;&#7897;t qu&#7925;</p>' +
      "<script>alert('x')</script><ul><li>Tri&#7879;u ch&#7913;ng: &#273;au ng&#7921;c</li></ul></body></html>";
    const result = await parser.extractText(Buffer.from(html, 'utf8'), 'bai.html');

    assert.ok(result.cleanText.includes('Bệnh học'));
    assert.ok(result.cleanText.includes('Nhồi máu cơ tim & đột quỵ'));
    assert.ok(result.cleanText.includes('- Triệu chứng: đau ngực'));
    assert.ok(!result.cleanText.includes('alert'), 'phải bỏ nội dung <script>');
    assert.ok(!result.cleanText.includes('color:red'), 'phải bỏ nội dung <style>');
  });

  it('file text rỗng -> 422', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    await assert.rejects(
      () => parser.extractText(Buffer.from('   \n\n  ', 'utf8'), 'rong.txt'),
      (err: any) => err instanceof AppError && err.statusCode === 422
    );
  });

  it('giải mã được văn bản lưu bằng Windows-1258', async () => {
    const { decodeTextBuffer } = await import('../src/modules/documents/parsers/text.parser');
    // "Bệnh" ở windows-1258: B, ê (0xEA), dấu nặng (0xF2 - ký tự tổ hợp), n, h
    const win1258 = Buffer.from([0x42, 0xea, 0xf2, 0x6e, 0x68]);
    assert.equal(decodeTextBuffer(win1258), 'Bệnh');
  });

  it('giải mã được UTF-16LE có BOM', async () => {
    const { decodeTextBuffer } = await import('../src/modules/documents/parsers/text.parser');
    const text = 'Y khoa';
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
    assert.equal(decodeTextBuffer(buffer), text);
  });

describe('Parser: đọc Excel (.xlsx)', () => {
  it('nối ô trong cùng dòng bằng " | " và giữ tên sheet', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const buffer = await makeXlsx([
      ['Thuốc', 'Liều lượng', 'Chỉ định'],
      ['Paracetamol', '500mg', 'Giảm đau, hạ sốt'],
      ['Amoxicillin', '500mg', 'Nhiễm khuẩn hô hấp']
    ]);
    const result = await parser.extractText(buffer, 'duoc-ly.xlsx');

    assert.ok(result.cleanText.includes('Duoc ly'), 'phải có tên sheet');
    assert.ok(result.cleanText.includes('Thuốc | Liều lượng | Chỉ định'));
    assert.ok(result.cleanText.includes('Paracetamol | 500mg | Giảm đau, hạ sốt'));
    assert.equal(result.pageCount, 0, 'Excel không đếm theo trang');
  });

  it('bỏ ô trống để dòng không bị "a |  |  | b"', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('S');
    sheet.addRow(['A', null, 'B']);
    const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    const result = await parser.extractText(buffer, 'x.xlsx');
    assert.ok(result.cleanText.includes('A | B'));
    assert.ok(!result.cleanText.includes('A |  | B'));
  });

  it('Excel rỗng -> 422 với thông báo rõ ràng', async () => {
    const { extractTextFromExcel } = await import('../src/modules/documents/parsers/excel.parser');

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Trong');
    const buffer = Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);

    await assert.rejects(
      () => extractTextFromExcel(buffer),
      (err: any) => err instanceof AppError && err.statusCode === 422
    );
  });

  it('file .xlsx hỏng -> 422', async () => {
    const { extractTextFromExcel } = await import('../src/modules/documents/parsers/excel.parser');
    // ZIP hợp lệ nhưng không có workbook.xml
    const zip = new JSZip();
    zip.file('xl/fake.txt', 'x');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await assert.rejects(
      () => extractTextFromExcel(buffer),
      (err: any) => err instanceof AppError && err.statusCode === 422
    );
  });
});

describe('Parser: ảnh chụp tài liệu (OCR)', () => {
  it('ảnh PNG được định tuyến sang OCR, không gọi nhánh PDF', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');

    const pdfCalls: Buffer[] = [];
    const imageCalls: Buffer[] = [];
    const parser = new MedicalDocumentParser(
      async (buf) => {
        pdfCalls.push(buf);
        return { text: 'khong dung', pagesProcessed: 1 };
      },
      async (buf) => {
        imageCalls.push(buf);
        return { text: LONG_TEXT, pagesProcessed: 1 };
      }
    );

    const result = await parser.extractText(TINY_PNG, 'chup-tai-lieu.png');

    assert.equal(pdfCalls.length, 0, 'không được gọi OCR PDF cho file ảnh');
    assert.equal(imageCalls.length, 1);
    assert.ok(result.cleanText.includes('viem phoi cong dong'));
    assert.equal(result.pageCount, 1);
  });

  it('OCR ảnh lỗi -> ném lỗi chứ không trả chuỗi rỗng', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser(
      async () => ({ text: '', pagesProcessed: 0 }),
      async () => {
        throw new AppError('Không nhận diện được văn bản trong ảnh.', 422);
      }
    );

    await assert.rejects(
      () => parser.extractText(TINY_PNG, 'mo.png'),
      (err: any) => err instanceof AppError && err.statusCode === 422
    );
  });
});

describe('Parser: từ chối định dạng không hỗ trợ', () => {
  it('ZIP không phải Word/Excel -> 415 kèm tên file', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const zip = new JSZip();
    zip.file('content.xml', '<x/>');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    await assert.rejects(
      () => parser.extractText(buffer, 'tai-lieu.odt'),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 415);
        assert.ok(err.message.includes('tai-lieu.odt'), 'thông báo phải nêu tên file');
        return true;
      }
    );
  });

  it('file nhị phân lạ -> 415 kèm danh sách định dạng hỗ trợ', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    const binary = Buffer.alloc(64, 0x00);
    await assert.rejects(
      () => parser.extractText(binary, 'unknown.bin'),
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 415);
        assert.ok(err.message.includes('.pdf'));
        assert.ok(err.message.includes('.xlsx'));
        return true;
      }
    );
  });

  it('file rỗng -> 415', async () => {
    const { MedicalDocumentParser } = await import('../src/modules/documents/parsers/pdf.parser');
    const parser = new MedicalDocumentParser();

    await assert.rejects(
      () => parser.extractText(Buffer.alloc(0), 'empty.pdf'),
      (err: any) => err instanceof AppError && err.statusCode === 415
    );
  });
});

});
