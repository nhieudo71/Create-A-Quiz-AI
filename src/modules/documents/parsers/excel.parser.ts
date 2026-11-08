import { AppError } from '../../../core/errors';

/**
 * Trích xuất văn bản từ bảng tính Excel (.xlsx).
 *
 * Mỗi dòng được nối thành một dòng văn bản, các ô ngăn cách bằng " | ". Cách này
 * giữ được mối liên hệ giữa các cột (ví dụ "Thuốc | Liều lượng | Chỉ định") mà nếu
 * chỉ nối tất cả ô lại sẽ mất hẳn ngữ cảnh để AI hiểu.
 */

/** Giới hạn số dòng đọc mỗi sheet: bảng tính y khoa thật hiếm khi vượt, còn file rác thì có. */
export const EXCEL_MAX_ROWS = 5000;
/** Giới hạn số sheet xử lý, tránh file nhiều tab bất thường. */
export const EXCEL_MAX_SHEETS = 20;
/** Tổng số ký tự tối đa thu được từ một file Excel. */
export const EXCEL_MAX_CHARS = 2_000_000;

/** Chuyển giá trị ô của exceljs (có thể là object công thức, hyperlink, rich text...) về chuỗi. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    // Ô công thức: dùng kết quả đã tính, không lấy công thức.
    if ('result' in obj) return cellToString(obj.result);
    if ('error' in obj) return '';
    // Rich text: nối các đoạn.
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((part: any) => String(part?.text ?? '')).join('').trim();
    }
    // Hyperlink: chỉ lấy phần chữ hiển thị.
    if ('text' in obj) return cellToString(obj.text);
  }

  return String(value).trim();
}

export async function extractTextFromExcel(buffer: Buffer): Promise<string> {
  let ExcelJS: typeof import('exceljs');
  try {
    // Nạp động: exceljs khá nặng và chỉ cần khi người dùng thật sự tải file Excel.
    const mod: any = await import('exceljs');
    // exceljs là CommonJS: khi biên dịch sang CommonJS cho Node, `import()` trả về
    // namespace có `default` bọc ngoài module.exports. Lấy đúng lớp cần dùng.
    ExcelJS = (mod?.Workbook ? mod : mod?.default) as typeof import('exceljs');
  } catch {
    throw new AppError('Máy chủ chưa cài đặt thư viện đọc file Excel.', 500);
  }

  if (typeof ExcelJS?.Workbook !== 'function') {
    throw new AppError('Không nạp được thư viện đọc file Excel trên máy chủ.', 500);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new AppError('Không đọc được file Excel (.xlsx). File có thể bị hỏng hoặc có mật khẩu bảo vệ.', 422);
  }

  const lines: string[] = [];
  let totalChars = 0;
  let sheetIndex = 0;

  for (const sheet of workbook.worksheets) {
    if (sheetIndex >= EXCEL_MAX_SHEETS) break;
    sheetIndex++;

    // Bỏ sheet ẩn: thường là sheet phụ/cấu hình, không phải nội dung bài giảng.
    if (sheet.state && sheet.state !== 'visible') continue;

    const sheetLines: string[] = [];
    let rowCount = 0;

    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= EXCEL_MAX_ROWS || totalChars >= EXCEL_MAX_CHARS) return;
      rowCount++;

      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = cellToString(cell.value);
        if (text) cells.push(text);
      });

      if (cells.length === 0) return;
      const line = cells.join(' | ');
      sheetLines.push(line);
      totalChars += line.length + 1;
    });

    if (sheetLines.length > 0) {
      lines.push(`### ${sheet.name}\n${sheetLines.join('\n')}`);
    }
  }

  const joined = lines.join('\n\n');
  if (!joined.trim()) {
    throw new AppError(
      'File Excel không có dữ liệu chữ nào đọc được. Kiểm tra lại file có nội dung trong các ô hay không.',
      422
    );
  }

  return joined;
}
