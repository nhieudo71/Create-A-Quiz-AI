import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { extname } from 'path';
import { AppError } from '../../../core/errors';
import { ocrScannedPdf, ocrImages, OcrResult } from './ocr';
import {
  cleanExtractedText,
  decodeTextBuffer,
  extractTextFromPlainText,
  looksBinary
} from './text.parser';
import { extractTextFromExcel } from './excel.parser';
import { extractTextFromPptx } from './pptx.parser';

export type { OcrResult };

/** Dưới ngưỡng này coi như PDF không có text layer thật sự (scan hình ảnh, bìa trống...). */
const OCR_FALLBACK_THRESHOLD_CHARS = 100;

export type DocumentKind = 'pdf' | 'docx' | 'pptx' | 'excel' | 'text' | 'html' | 'image';

/** Giới hạn bảo vệ tài nguyên khi xử lý file người dùng tải lên */
export const PDF_MAX_PAGES = 5000;
// Ứng dụng chạy offline một máy nên chấp nhận file lớn; ngưỡng này chỉ để chặn
// zip bomb (DOCX vài chục MB giải nén thành hàng GB), không phải giới hạn sử dụng.
export const DOCX_MAX_UNCOMPRESSED_BYTES = 1500 * 1024 * 1024;
export const DOCX_MAX_ENTRIES = 50_000;
/** Số từ tối đa của một đoạn gửi cho AI, tránh vượt cửa sổ ngữ cảnh của model */
export const MAX_CHUNK_WORDS = 12_000;

/**
 * Các phần mở rộng được chấp nhận, dùng cho thông báo lỗi và cho client đồng bộ.
 * Việc nhận diện thật vẫn dựa trên nội dung file, danh sách này chỉ để báo lỗi rõ ràng.
 */
export const SUPPORTED_EXTENSIONS = [
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.html',
  '.htm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff'
] as const;

/**
 * Nhận diện loại file theo nội dung (magic bytes / đặc trưng cấu trúc), không tin
 * đuôi file hay MIME do client gửi.
 *
 * Nhóm ZIP (.docx/.xlsx) dùng chung magic bytes `PK\x03\x04` nên phải xem cấu trúc
 * bên trong để phân biệt; việc đó làm ở `detectZipKind()` (cần giải nén nên là bất đồng bộ).
 */
export function detectDocumentKind(buf: Buffer): DocumentKind | null {
  if (buf.length === 0) return null;

  // PDF: cho phép vài byte rác trước header (một số máy in/scan hay chèn vào).
  if (buf.subarray(0, 1024).includes('%PDF-', 0, 'latin1')) return 'pdf';

  const kind = detectImageKind(buf);
  if (kind) return kind;

  // ZIP: DOCX/XLSX/ODT/EPUB đều bắt đầu bằng PK. Phân loại chi tiết ở detectZipKind.
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'docx';
  }

  if (looksBinary(buf)) return null;

  // Không phải nhị phân: coi là văn bản. Phân biệt HTML bằng sự xuất hiện của thẻ.
  const head = decodeTextBuffer(buf.subarray(0, 4096)).toLowerCase();
  if (/<(!doctype\s+html|html|head|body|div|p|table|h1|meta|br)\b/.test(head)) return 'html';
  return 'text';
}

/** Nhận diện ảnh theo magic bytes của các định dạng phổ biến. */
function detectImageKind(buf: Buffer): DocumentKind | null {
  if (buf.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image';
  // BMP: "BM" + kích thước file (4 byte LE) + 4 byte reserved phải bằng 0.
  // Chỉ so hai chữ "BM" là chưa đủ: một file văn bản mở đầu bằng "BMJ..." cũng khớp.
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    const size = buf.readUInt32LE(2);
    const reserved = buf.readUInt32LE(6);
    if (reserved === 0 && size >= 14) return 'image';
  }
  // TIFF: "II*\0" (little-endian) hoặc "MM\0*" (big-endian)
  if (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) return 'image';
  if (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a) return 'image';
  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return 'image';
  }

  return null;
}

/**
 * Phân biệt Word / Excel / định dạng ZIP khác bằng cách đọc danh sách tệp bên trong.
 * Chỉ đọc thư mục trung tâm của ZIP (không giải nén nội dung) nên rẻ và an toàn.
 */
export async function detectZipKind(buf: Buffer): Promise<DocumentKind | null> {
  let zip;
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: false });
  } catch {
    return null;
  }

  const names = Object.keys(zip.files);
  if (names.some((n) => n.startsWith('word/'))) return 'docx';
  if (names.some((n) => n.startsWith('ppt/'))) return 'pptx';
  if (names.some((n) => n.startsWith('xl/'))) return 'excel';
  return null;
}

/**
 * Đọc thư mục trung tâm của ZIP để từ chối "zip bomb" TRƯỚC khi giải nén.
 * Lưu ý: dựa trên kích thước khai báo trong header nên chỉ giảm thiểu, không loại bỏ hoàn toàn rủi ro.
 */
export function assertSafeZip(
  buf: Buffer,
  maxBytes = DOCX_MAX_UNCOMPRESSED_BYTES,
  maxEntries = DOCX_MAX_ENTRIES
): void {
  const tooBig = () => new AppError('File DOCX có cấu trúc nén bất thường (quá lớn sau khi giải nén).', 422);
  const corrupt = () => new AppError('File DOCX bị hỏng hoặc không phải tệp Word hợp lệ.', 422);

  const minEocd = 22;
  let eocd = -1;
  const lowest = Math.max(0, buf.length - minEocd - 0xffff);
  for (let i = buf.length - minEocd; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw corrupt();

  const entries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) throw tooBig(); // ZIP64: không hỗ trợ
  if (entries > maxEntries) throw tooBig();

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw corrupt();
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) throw tooBig();
    total += size;
    if (total > maxBytes) throw tooBig();
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
}

export class MedicalDocumentParser {
  /**
   * `ocrFallback` để trống thì dùng OCR thật (Tesseract). Tham số này tồn tại để
   * unit test kiểm tra logic quyết định "khi nào gọi OCR" mà không phải chạy nhận
   * diện ảnh thật (chậm và cần tải dữ liệu ngôn ngữ qua mạng).
   *
   * `imageOcr` tương tự nhưng cho nhánh ảnh rời (PNG/JPEG...) — tách riêng vì ảnh
   * rời không cần render qua PDF nên là một đường xử lý khác hẳn.
   */
  constructor(
    private readonly ocrFallback: (buffer: Buffer) => Promise<OcrResult> = ocrScannedPdf,
    private readonly imageOcr: (buffer: Buffer) => Promise<OcrResult> = (buf) => ocrImages([buf])
  ) {}

  private clean(raw: string): string {
    return cleanExtractedText(raw);
  }

  async extractTextFromPDF(buffer: Buffer): Promise<{ cleanText: string; pageCount: number; usedOcr?: boolean }> {
    // Lỗi ở bước đọc text layer KHÔNG được coi là kết luận cuối cùng: pdf-parse có
    // thể hỏng vì lý do không liên quan tới nội dung file, mà file scan cũng chính là
    // loại dễ làm nó lỗi. Luôn cho OCR một cơ hội trước khi báo file hỏng.
    let embeddedText = '';
    let pageCount = 0;
    let readFailure: unknown = null;

    try {
      // Truyền Uint8Array mới thay vì Buffer: pdf.js phiên bản cũ bên trong pdf-parse
      // đọc sai offset khi nhận Buffer trong một số môi trường (gặp thật với tsx ở
      // `npm run dev`, báo "bad XRef entry" dù file hợp lệ). Bản sao này nhỏ (tối đa
      // bằng kích thước file tải lên) và chạy đúng ở cả dev lẫn bản build.
      const data = await pdfParse(new Uint8Array(buffer) as unknown as Buffer, { max: PDF_MAX_PAGES });
      embeddedText = this.clean(data.text);
      pageCount = data.numpages;
    } catch (err) {
      readFailure = err;
    }

    // Lớp text nhúng sẵn quá ngắn hoặc trống, hoặc đọc text layer thất bại: nhiều khả
    // năng đây là PDF scan (mỗi trang chỉ là một bức ảnh). Thử OCR.
    if (embeddedText.length < OCR_FALLBACK_THRESHOLD_CHARS) {
      let ocrError: unknown = null;
      try {
        const ocr = await this.ocrFallback(buffer);
        const ocrText = this.clean(ocr.text);
        if (ocrText.length >= OCR_FALLBACK_THRESHOLD_CHARS) {
          return { cleanText: ocrText, pageCount: pageCount || ocr.pagesProcessed, usedOcr: true };
        }
      } catch (err) {
        ocrError = err;
      }

      // Bước đọc text layer đã lỗi và OCR cũng không cứu được: đây thực sự là file
      // hỏng/mã hóa, nên báo đúng nguyên nhân gốc thay vì "thiếu nội dung".
      if (readFailure && ocrError) {
        throw new AppError('Không đọc được file PDF (file bị hỏng hoặc được mã hóa bằng mật khẩu).', 422);
      }
      // OCR thất bại dù text layer đọc được: lỗi của OCR (ảnh mờ, không có chữ) mô tả
      // đúng tình trạng hiện tại hơn là im lặng trả về chuỗi rỗng.
      if (ocrError) throw ocrError;
    }

    if (readFailure) {
      throw new AppError('Không đọc được file PDF (file bị hỏng hoặc được mã hóa bằng mật khẩu).', 422);
    }

    return { cleanText: embeddedText, pageCount };
  }

  async extractTextFromDocx(buffer: Buffer): Promise<{ cleanText: string; pageCount: number }> {
    assertSafeZip(buffer);
    try {
      const result = await mammoth.extractRawText({ buffer });
      return { cleanText: this.clean(result.value), pageCount: 0 };
    } catch {
      throw new AppError('Không đọc được file Word (.docx). File có thể bị hỏng hoặc không đúng định dạng.', 422);
    }
  }

  /** Đọc bảng tính Excel (.xlsx): mỗi dòng thành một dòng văn bản, các cột ngăn bằng " | ". */
  async extractTextFromSpreadsheet(buffer: Buffer): Promise<{ cleanText: string; pageCount: number }> {
    assertSafeZip(buffer);
    const text = await extractTextFromExcel(buffer);
    // pageCount = 0 nghĩa là "không đếm được theo trang" (giống DOCX), UI hiển thị số đoạn thay thế.
    return { cleanText: this.clean(text), pageCount: 0 };
  }

  /** Đọc bài giảng PowerPoint (.pptx): mỗi slide thành một khối, kèm ghi chú thuyết trình. */
  async extractTextFromPresentation(buffer: Buffer): Promise<{ cleanText: string; pageCount: number }> {
    assertSafeZip(buffer);
    const text = await extractTextFromPptx(buffer);
    return { cleanText: this.clean(text), pageCount: 0 };
  }

  /** Đọc văn bản thuần: .txt .md .markdown .csv .json và các định dạng cùng loại. */
  async extractTextFromText(buffer: Buffer): Promise<{ cleanText: string; pageCount: number }> {
    if (looksBinary(buffer)) {
      throw new AppError('File này không phải văn bản đọc được (nội dung nhị phân).', 415);
    }
    return { cleanText: this.clean(extractTextFromPlainText(buffer, false)), pageCount: 0 };
  }

  /** Đọc file HTML: bỏ thẻ, giữ lại chữ hiển thị. */
  async extractTextFromHtml(buffer: Buffer): Promise<{ cleanText: string; pageCount: number }> {
    return { cleanText: this.clean(extractTextFromPlainText(buffer, true)), pageCount: 0 };
  }

  /** Ảnh chụp tài liệu: nhận diện chữ bằng OCR. */
  async extractTextFromImage(buffer: Buffer): Promise<{ cleanText: string; pageCount: number; usedOcr?: boolean }> {
    const ocr = await this.imageOcr(buffer);
    return { cleanText: this.clean(ocr.text), pageCount: ocr.pagesProcessed, usedOcr: true };
  }

  /**
   * Tự nhận diện định dạng theo nội dung rồi trích xuất văn bản.
   *
   * `filename` chỉ dùng để chọn cách đọc khi nội dung không phân biệt được — ví dụ
   * một file ZIP chứa `xl/` (Excel) hay `word/` (Word), hoặc file văn bản thuần có
   * đuôi `.md` cần giữ nguyên cú pháp Markdown. Không dùng đuôi file để quyết định
   * tin hay không tin nội dung.
   */
  async extractText(buffer: Buffer, filename = ''): Promise<{ cleanText: string; pageCount: number }> {
    const kind = detectDocumentKind(buffer);

    if (kind === null) {
      throw new AppError(
        `Không nhận diện được định dạng file. Hệ thống hỗ trợ: ${SUPPORTED_EXTENSIONS.join(', ')}.`,
        415
      );
    }

    if (kind === 'pdf') return this.extractTextFromPDF(buffer);
    if (kind === 'image') return this.extractTextFromImage(buffer);
    if (kind === 'excel') return this.extractTextFromSpreadsheet(buffer);

    // Văn bản thuần và HTML khó phân biệt tuyệt đối bằng nội dung (một file HTML rút
    // gọn có thể chỉ có vài thẻ). Khi nội dung đoán là "text" nhưng đuôi file nói rõ
    // là HTML thì tin đuôi file — ngược lại thì giữ theo nội dung để không bỏ sót thẻ.
    const ext = extname(filename).toLowerCase();
    if (kind === 'text' && (ext === '.html' || ext === '.htm')) return this.extractTextFromHtml(buffer);
    if (kind === 'html') return this.extractTextFromHtml(buffer);
    if (kind === 'text') return this.extractTextFromText(buffer);

    // Còn lại là file ZIP: phân biệt Word / PowerPoint / Excel bằng cấu trúc bên trong.
    const zipKind = await detectZipKind(buffer);
    if (zipKind === 'excel') return this.extractTextFromSpreadsheet(buffer);
    if (zipKind === 'pptx') return this.extractTextFromPresentation(buffer);
    if (zipKind === 'docx') return this.extractTextFromDocx(buffer);

    // ZIP hợp lệ nhưng không phải Word/PowerPoint/Excel: nêu đúng định dạng người dùng đã chọn
    // để họ biết file nào đang bị từ chối.
    const label = ext ? `"${filename}" (${ext})` : 'File nén này';
    throw new AppError(
      `${label} không phải tài liệu Word (.docx), PowerPoint (.pptx) hay Excel (.xlsx). ` +
        'Các định dạng nén khác như .doc, .ppt, .xls, .odt, .epub chưa được hỗ trợ — ' +
        'hãy lưu lại thành .docx/.pptx/.xlsx hoặc .pdf rồi tải lên.',
      415
    );
  }

  /** Chặn sớm tài liệu không có văn bản (kể cả sau khi đã thử OCR) hoặc quá ngắn để sinh câu hỏi */
  assertUsableText(cleanText: string): void {
    if (!cleanText || cleanText.trim().length < 100) {
      throw new AppError(
        'Không trích xuất được văn bản từ tài liệu (đã thử cả đọc text layer lẫn nhận diện OCR cho ảnh ' +
          'nhưng không đủ nội dung). File có thể là ảnh chất lượng quá thấp, trống, hoặc bị mã hóa. ' +
          'Hãy thử file rõ nét hơn, hoặc dùng PDF có text layer / Word (.docx) / Excel (.xlsx).',
        422
      );
    }
  }

  splitIntoChunks(fullText: string, targetChunks: number): string[] {
    const words = fullText.split(/\s+/).filter(Boolean);
    const totalWords = words.length;
    const chunkCount = Math.max(1, Math.floor(targetChunks) || 1);

    if (totalWords <= 3000 || chunkCount <= 1) {
      return totalWords <= MAX_CHUNK_WORDS ? [fullText] : [words.slice(0, MAX_CHUNK_WORDS).join(' ')];
    }

    const wordsPerChunk = Math.ceil(totalWords / chunkCount);
    const overlapWords = 150;
    const chunks: string[] = [];

    for (let i = 0; i < totalWords; i += wordsPerChunk) {
      const start = Math.max(0, i - overlapWords);
      const end = Math.min(totalWords, i + wordsPerChunk, start + MAX_CHUNK_WORDS);
      chunks.push(words.slice(start, end).join(' '));
    }

    return chunks;
  }
}
