import path from 'path';
import { AppError } from '../../../core/errors';

/**
 * OCR dự phòng cho PDF dạng ảnh scan (không có text layer nhúng sẵn).
 *
 * `pdf-parse` chỉ đọc được text đã nhúng trong PDF; với file scan (mỗi trang
 * chỉ là một bức ảnh) nó luôn trả về chuỗi rỗng. Module này render từng trang
 * ra ảnh PNG bằng pdfjs-dist + @napi-rs/canvas rồi nhận diện chữ bằng
 * Tesseract.js (tiếng Việt + tiếng Anh, phù hợp tài liệu y khoa song ngữ).
 *
 * Nạp động (dynamic import): các gói này khá nặng (pdfjs-dist, canvas native,
 * mô hình ngôn ngữ Tesseract) và chỉ cần thiết khi đường trích xuất text
 * thông thường thất bại, nên không tải chúng ở mọi lượt khởi động ứng dụng
 * hay mọi lượt xử lý PDF có text layer bình thường.
 */

/** Giới hạn số trang OCR mỗi lần để tránh một file scan hàng trăm trang làm treo request. */
export const OCR_MAX_PAGES = 20;
/** Giới hạn số ảnh OCR mỗi lần để tránh một lượt tải lên làm treo request. */
export const OCR_MAX_IMAGES = 10;
/** Độ phân giải render trang: đủ nét để Tesseract đọc tốt mà không quá nặng bộ nhớ. */
const RENDER_SCALE = 2.0;

export interface OcrResult {
  text: string;
  pagesProcessed: number;
}

/**
 * Nhận diện văn bản từ một PDF dạng ảnh scan.
 * Ném AppError 422 nếu bất kỳ bước nào (render hay OCR) thất bại hoàn toàn.
 */
export async function ocrScannedPdf(buffer: Buffer): Promise<OcrResult> {
  let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  let canvasPkg: typeof import('@napi-rs/canvas');
  let tesseract: typeof import('tesseract.js');

  try {
    [pdfjs, canvasPkg, tesseract] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
      import('tesseract.js')
    ]);
  } catch {
    // Thiếu thư viện OCR (ví dụ bản dựng tối giản) -> báo lỗi gốc "không có text", không phải lỗi hệ thống.
    throw new AppError(
      'Tài liệu không có văn bản đọc được (có thể là file scan hình ảnh). Vui lòng dùng PDF có text layer hoặc file Word (.docx).',
      422
    );
  }

  // Đường dẫn font chuẩn của pdfjs-dist. Thiếu nó, các trang dùng font chuẩn của PDF
  // (Helvetica, Times...) sẽ render ra ảnh trắng — pdfjs chỉ cảnh báo chứ không ném lỗi,
  // nên OCR lặng lẽ trả về chuỗi rỗng. Phải là đường dẫn hệ thống tệp thuần, KHÔNG phải
  // URL file:// (pdfjs đọc trực tiếp bằng fs, không qua trình phân giải URL).
  const standardFontDataUrl = getPdfjsResourcePath('standard_fonts');

  let doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl,
      isEvalSupported: false
    }).promise;
  } catch {
    throw new AppError('Không đọc được file PDF (file bị hỏng hoặc được mã hóa bằng mật khẩu).', 422);
  }

  const pageCount = Math.min(doc.numPages, OCR_MAX_PAGES);

  let worker: Awaited<ReturnType<typeof tesseract.createWorker>>;
  try {
    worker = await createOcrWorker(tesseract);
  } catch (err) {
    await doc.destroy().catch(() => undefined);
    throw err;
  }

  try {
    const pagesText: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = canvasPkg.createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext('2d');

      // @napi-rs/canvas triển khai ngữ cảnh vẽ 2D tương thích API DOM, nhưng kiểu dữ liệu
      // của nó không khớp 100% với kiểu pdfjs-dist mong đợi (và dự án không nạp lib "DOM").
      await page.render({ canvasContext: ctx as any, viewport }).promise;

      const pngBuffer = canvas.toBuffer('image/png');
      const { data } = await worker.recognize(pngBuffer);
      pagesText.push(data.text);
      page.cleanup();
    }
    return { text: pagesText.join('\n\n'), pagesProcessed: pageCount };
  } catch {
    throw new AppError(
      'Không nhận diện được văn bản từ ảnh scan trong PDF. Hãy thử file PDF rõ nét hơn hoặc nhập tay nội dung.',
      422
    );
  } finally {
    await worker.terminate().catch(() => undefined);
    await doc.destroy().catch(() => undefined);
  }
}

/**
 * Nhận diện văn bản từ một hay nhiều ảnh rời (PNG/JPEG/WebP/BMP/TIFF) — dùng khi
 * người dùng tải lên ảnh chụp tài liệu thay vì file PDF/DOCX.
 *
 * Tesseract nhận trực tiếp Buffer ảnh nên nhánh này không cần render qua canvas;
 * chỉ nạp Tesseract.js, không đụng tới pdfjs-dist (xem ocrScannedPdf cho nhánh PDF).
 */
export async function ocrImages(buffers: Buffer[]): Promise<OcrResult> {
  if (buffers.length === 0) {
    throw new AppError('Không có ảnh nào để nhận diện.', 400);
  }
  if (buffers.length > OCR_MAX_IMAGES) {
    throw new AppError(`Chỉ nhận diện tối đa ${OCR_MAX_IMAGES} ảnh mỗi lần.`, 413);
  }

  let tesseract: typeof import('tesseract.js');
  try {
    tesseract = await import('tesseract.js');
  } catch {
    throw new AppError(
      'Máy chủ chưa cài đặt thư viện nhận diện chữ (OCR) nên không đọc được ảnh. Vui lòng dùng PDF hoặc Word (.docx).',
      422
    );
  }

  const worker = await createOcrWorker(tesseract);
  try {
    const texts: string[] = [];
    for (const buffer of buffers) {
      const { data } = await worker.recognize(buffer);
      texts.push(data.text);
    }
    return { text: texts.join('\n\n'), pagesProcessed: buffers.length };
  } catch {
    throw new AppError(
      'Không nhận diện được văn bản trong ảnh. Hãy thử ảnh rõ nét hơn, chụp thẳng trang giấy và đủ sáng.',
      422
    );
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

/**
 * Tạo worker Tesseract với hai ngôn ngữ tiếng Việt + tiếng Anh (tài liệu y khoa
 * trong nước thường trộn thuật ngữ Latin). Lần chạy đầu cần mạng để tải dữ liệu
 * ngôn ngữ, sau đó được cache lại.
 */
async function createOcrWorker(
  tesseract: typeof import('tesseract.js')
): Promise<Awaited<ReturnType<typeof tesseract.createWorker>>> {
  try {
    return await tesseract.createWorker('eng+vie');
  } catch {
    throw new AppError(
      'Không khởi tạo được bộ nhận diện chữ (OCR). Kiểm tra kết nối mạng ở lần chạy đầu tiên rồi thử lại.',
      503
    );
  }
}

/**
 * Đường dẫn tuyệt đối tới một thư mục tài nguyên bên trong gói pdfjs-dist
 * (standard_fonts, cmaps...). pdfjs đọc các thư mục này trực tiếp bằng fs nên
 * phải trả về đường dẫn hệ thống tệp kèm dấu '/' ở cuối, không phải URL file://.
 */
function getPdfjsResourcePath(dirName: string): string {
  const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  // Windows nhận cả '/' nên chuẩn hoá về '/' cho thống nhất giữa các nền tảng.
  return `${path.join(pkgDir, dirName).replace(/\\/g, '/')}/`;
}
