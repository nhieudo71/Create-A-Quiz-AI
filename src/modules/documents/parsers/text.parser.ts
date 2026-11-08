import { AppError } from '../../../core/errors';

/**
 * Xử lý các định dạng văn bản thuần: .txt .md .markdown .csv .json .html .htm
 *
 * Nhóm này không có "magic bytes" riêng như PDF/ZIP nên phải nhận diện bằng cách
 * thử giải mã: nếu nội dung đọc ra thành ký tự hợp lệ thì coi là văn bản. Cách này
 * an toàn hơn tin vào phần mở rộng tên file do client gửi (có thể bị đổi tùy ý).
 */

/** Ký tự điều khiển không in được (giữ lại \t \n \r) — dấu hiệu của file nhị phân. */
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/** Tỉ lệ ký tự điều khiển vượt ngưỡng này thì coi là file nhị phân, không phải văn bản. */
const BINARY_CONTROL_RATIO = 0.05;
/** Chỉ cần lấy mẫu đầu file để phân loại, không quét toàn bộ (file có thể tới 20MB). */
const BINARY_SAMPLE_BYTES = 8192;

/**
 * Làm sạch văn bản trích xuất được: chuẩn hoá xuống dòng, bỏ ký tự điều khiển,
 * gộp các dòng trống liên tiếp. Dùng chung cho mọi định dạng để đầu ra đồng nhất
 * trước khi gửi cho AI.
 */
export function cleanExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(CONTROL_CHARS_RE, '')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

function hasBom(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return true;
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return true;
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return true;
  return false;
}

/**
 * Giải mã buffer thành chuỗi, tự dò bảng mã.
 *
 * Thứ tự thử: BOM -> UTF-8 nghiêm ngặt -> Windows-1258. Tài liệu y khoa cũ của
 * Việt Nam rất thường lưu bằng bảng mã Windows (TCVN3/VNI quy đổi), nên nếu chỉ
 * đọc UTF-8 sẽ ra ký tự rác. UTF-8 được thử ở chế độ `fatal` để nếu sai thì ném
 * lỗi ngay thay vì lặng lẽ thay bằng ký tự thay thế U+FFFD.
 */
export function decodeTextBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3)).normalize('NFC');
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2)).normalize('NFC');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2)).normalize('NFC');
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).normalize('NFC');
  } catch {
    // Không phải UTF-8 hợp lệ -> thử bảng mã tiếng Việt kiểu Windows.
    // Windows-1258 ghép dấu thành ký tự tổ hợp rời (NFD), nên phải chuẩn hoá về NFC:
    // nếu không, "Bệnh" sẽ thành "Bê" + dấu nặng và so sánh chuỗi / tìm kiếm sẽ sai.
    return new TextDecoder('windows-1258').decode(buf).normalize('NFC');
  }
}

/**
 * Đoán xem buffer có phải dữ liệu nhị phân (ảnh, file nén, thực thi...) hay không.
 * Nội dung UTF-16 có BOM chứa nhiều byte 0 nên phải loại trừ trước khi kiểm tra.
 */
export function looksBinary(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  if (hasBom(buf)) return false;

  const sample = buf.subarray(0, Math.min(buf.length, BINARY_SAMPLE_BYTES));
  if (sample.includes(0)) return true;

  const controls = sample.toString('latin1').match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  return !!controls && controls.length / sample.length > BINARY_CONTROL_RATIO;
}

// ---------------------------------------------------------------------------
// HTML -> văn bản thuần
// ---------------------------------------------------------------------------

/** Bảng thực thể HTML phổ biến trong tài liệu tiếng Việt và ký hiệu y khoa. */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  deg: '°',
  plusmn: '±',
  times: '×',
  divide: '÷',
  micro: 'µ',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  mu: 'μ',
  rarr: '→',
  larr: '←',
  sup2: '²',
  sup3: '³',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  le: '≤',
  ge: '≥',
  ne: '≠',
  bull: '•',
  dagger: '†',
  sect: '§',
  para: '¶',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  asymp: '≈',
  infin: '∞',
  sum: '∑',
  radic: '√',
  prime: '′',
  Prime: '″'
};

/**
 * Thực thể HTML Latin-1 (tên không dấu) — hay gặp trong HTML do Word xuất ra.
 * Sinh tự động từ bảng Unicode thay vì liệt kê tay để không bỏ sót ký tự nào.
 */
const LATIN1_ENTITY_NAMES = [
  'nbsp', 'iexcl', 'cent', 'pound', 'curren', 'yen', 'brvbar', 'sect',
  'uml', 'copy', 'ordf', 'laquo', 'not', 'shy', 'reg', 'macr',
  'deg', 'plusmn', 'sup2', 'sup3', 'acute', 'micro', 'para', 'middot',
  'cedil', 'sup1', 'ordm', 'raquo', 'frac14', 'frac12', 'frac34', 'iquest',
  'Agrave', 'Aacute', 'Acirc', 'Atilde', 'Auml', 'Aring', 'AElig', 'Ccedil',
  'Egrave', 'Eacute', 'Ecirc', 'Euml', 'Igrave', 'Iacute', 'Icirc', 'Iuml',
  'ETH', 'Ntilde', 'Ograve', 'Oacute', 'Ocirc', 'Otilde', 'Ouml', 'times',
  'Oslash', 'Ugrave', 'Uacute', 'Ucirc', 'Uuml', 'Yacute', 'THORN', 'szlig',
  'agrave', 'aacute', 'acirc', 'atilde', 'auml', 'aring', 'aelig', 'ccedil',
  'egrave', 'eacute', 'ecirc', 'euml', 'igrave', 'iacute', 'icirc', 'iuml',
  'eth', 'ntilde', 'ograve', 'oacute', 'ocirc', 'otilde', 'ouml', 'divide',
  'oslash', 'ugrave', 'uacute', 'ucirc', 'uuml', 'yacute', 'thorn', 'yuml'
];

for (let i = 0; i < LATIN1_ENTITY_NAMES.length; i++) {
  const name = LATIN1_ENTITY_NAMES[i];
  if (NAMED_ENTITIES[name] === undefined) {
    NAMED_ENTITIES[name] = String.fromCharCode(160 + i);
  }
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return codePointToString(Number.parseInt(body.slice(2), 16), match);
    }
    if (body.startsWith('#')) {
      return codePointToString(Number.parseInt(body.slice(1), 10), match);
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

/** Đổi mã điểm Unicode sang ký tự; mã không hợp lệ thì giữ nguyên chuỗi gốc. */
function codePointToString(code: number, fallback: string): string {
  // Loại surrogate (D800-DFFF) và giá trị ngoài BMP hợp lệ: String.fromCodePoint sẽ ném lỗi.
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return fallback;
  if (code >= 0xd800 && code <= 0xdfff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}
/**
 * Chuyển HTML sang văn bản thuần.
 *
 * Không dùng thư viện DOM: nội dung chỉ cần đủ sạch để AI đọc hiểu, còn việc dựng
 * cây DOM đầy đủ sẽ kéo theo một parser HTML nặng mà dự án không cần.
 */
export function htmlToText(html: string): string {
  let text = html;

  // Bỏ hẳn nội dung không mang văn bản hiển thị.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|head|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Thẻ ngắt khối/biểu mẫu -> ký tự xuống dòng tương ứng.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|section|article|header|footer|table|tr|blockquote|pre|h[1-6])>/gi, '\n');
  text = text.replace(/<(h[1-6])\b[^>]*>/gi, '\n');
  text = text.replace(/<li\b[^>]*>/gi, '\n- ');
  text = text.replace(/<\/(td|th)>/gi, ' | ');

  // Toàn bộ thẻ còn lại.
  text = text.replace(/<[^>]+>/g, ' ');

  return decodeEntities(text);
}

/**
 * Trích xuất văn bản từ nhóm định dạng văn bản thuần.
 * Markdown giữ nguyên cú pháp vì AI đọc được trực tiếp và cấu trúc (#, -, bảng)
 * vẫn mang thông tin phân cấp hữu ích cho việc soạn câu hỏi.
 */
export function extractTextFromPlainText(buffer: Buffer, isHtml: boolean): string {
  const decoded = decodeTextBuffer(buffer);
  const text = isHtml ? htmlToText(decoded) : decoded;

  if (!text.trim()) {
    throw new AppError('File văn bản rỗng, không có nội dung để trích xuất.', 422);
  }
  return text;
}
