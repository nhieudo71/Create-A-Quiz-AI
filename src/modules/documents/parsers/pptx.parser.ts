import JSZip from 'jszip';
import { AppError } from '../../../core/errors';

/**
 * Trích xuất văn bản từ PowerPoint (.pptx).
 *
 * PPTX là một file ZIP chứa XML. Bài giảng y khoa thường nằm ở slide, nên đọc
 * trực tiếp `ppt/slides/slideN.xml` — không cần thư viện ngoài, dùng `jszip` đã có.
 *
 * Ghi chú thuyết trình (`ppt/notesSlides/`) được đọc kèm vì rất nhiều giảng viên
 * để nội dung quan trọng ở đó chứ không đưa lên slide.
 */

/** Giới hạn số slide đọc mỗi file: bài giảng thật hiếm khi vượt, file rác thì có. */
export const PPTX_MAX_SLIDES = 2000;
/** Tổng số ký tự tối đa thu được từ một file PPTX. */
export const PPTX_MAX_CHARS = 5_000_000;

/** Giải mã các thực thể XML về ký tự thật. */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * Lấy chữ từ một file XML của slide.
 *
 * Mỗi đoạn văn (`a:p`) được xuống dòng riêng, mỗi lần chạy chữ (`a:t`) là một
 * mảnh trong đoạn. PowerPoint tách text thành nhiều run vì định dạng, nên phải
 * nối chúng lại, nếu không "Amoxi" + "cillin" thành hai dòng rời rạc.
 */
function extractTextFromSlideXml(xml: string): string {
  const paragraphs: string[] = [];
  const paragraphRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;

  let match: RegExpExecArray | null;
  while ((match = paragraphRe.exec(xml)) !== null) {
    const inner = match[1];
    const runs: string[] = [];
    const runRe = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;

    let run: RegExpExecArray | null;
    while ((run = runRe.exec(inner)) !== null) {
      runs.push(unescapeXml(run[1]));
    }

    const text = runs.join('').replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }

  return paragraphs.join('\n');
}

/**
 * Sắp xếp đúng thứ tự slide theo số.
 * So sánh chuỗi sẽ đặt slide10.xml trước slide2.xml — bài giảng bị đảo thứ tự.
 */
function slideOrder(name: string): number {
  const m = name.match(/(\d+)\.xml$/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

export async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw new AppError('Không đọc được file PowerPoint (.pptx). File có thể bị hỏng hoặc có mật khẩu bảo vệ.', 422);
  }

  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideOrder(a) - slideOrder(b))
    .slice(0, PPTX_MAX_SLIDES);

  if (slideNames.length === 0) {
    throw new AppError('File PowerPoint không có slide nào đọc được.', 422);
  }

  const noteNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
    .sort((a, b) => slideOrder(a) - slideOrder(b));

  const sections: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < slideNames.length; i++) {
    if (totalChars >= PPTX_MAX_CHARS) break;

    const slideXml = await zip.file(slideNames[i])?.async('string');
    const slideText = slideXml ? extractTextFromSlideXml(slideXml) : '';
    // Notes chỉ có ý nghĩa khi gắn đúng slide; file notesSlideN khớp số với slideN.
    const notesXml = noteNames[i] ? await zip.file(noteNames[i])?.async('string') : null;
    const notesText = notesXml ? extractTextFromSlideXml(notesXml) : '';

    const parts: string[] = [slideText.trim()];
    if (notesText.trim()) parts.push(`Ghi chú: ${notesText.trim()}`);

    const content = parts.filter(Boolean).join('\n');
    if (content) {
      sections.push(`### Slide ${i + 1}\n${content}`);
      totalChars += content.length;
    }
  }

  const joined = sections.join('\n\n');
  if (!joined.trim()) {
    throw new AppError(
      'File PowerPoint không có nội dung chữ đọc được. Slide có thể chỉ chứa hình ảnh — ' +
        'hãy xuất slide sang PDF rồi tải lên để dùng OCR.',
      422
    );
  }

  return joined;
}
