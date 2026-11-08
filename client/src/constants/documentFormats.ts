/**
 * Danh sách định dạng tài liệu được hỗ trợ ở phía giao diện.
 *
 * Phải khớp với `SUPPORTED_EXTENSIONS` trong
 * `src/modules/documents/parsers/pdf.parser.ts`. Việc kiểm tra ở client chỉ để báo
 * lỗi sớm và mở đúng bộ lọc file; máy chủ vẫn tự nhận diện lại theo nội dung
 * (magic bytes), nên đổi đuôi file không qua mặt được.
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
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

/** Chuỗi cho thuộc tính `accept` của <input type="file"> */
export const DOCUMENT_ACCEPT_ATTR = SUPPORTED_DOCUMENT_EXTENSIONS.join(',');

/** Nhóm định dạng kèm nhãn hiển thị, dùng cho phần gợi ý dưới vùng kéo thả. */
export const DOCUMENT_FORMAT_GROUPS: ReadonlyArray<{ label: string; extensions: string }> = [
  { label: 'Tài liệu', extensions: 'PDF, DOCX' },
  { label: 'Bài giảng', extensions: 'PPTX' },
  { label: 'Bảng tính', extensions: 'XLSX' },
  { label: 'Văn bản', extensions: 'TXT, MD, CSV, HTML' },
  { label: 'Ảnh (OCR)', extensions: 'PNG, JPG, JPEG, WEBP, BMP, TIFF' }
];

/** Kiểm tra nhanh theo đuôi file (chỉ để báo lỗi sớm ở client). */
export function hasSupportedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SUPPORTED_DOCUMENT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
