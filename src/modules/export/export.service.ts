import ExcelJS from 'exceljs';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { db } from '../../core/database/db';
import { AppError, NotFoundError } from '../../core/errors';
import { AttemptsService } from '../attempts/attempts.service';
import type { GeneratedQuestionItem } from '../ai-generator/ai.service';
import { HtmlQuizService } from './html-quiz.service';

export class ExportService {
  readonly htmlQuiz = new HtmlQuizService();
  /** Tải toàn bộ câu hỏi + đáp án của một đề thi để xuất file. */
  private async loadQuizWithQuestions(quizId: string) {
    const quiz = await db
      .selectFrom('quizzes')
      .innerJoin('subjects', 'subjects.id', 'quizzes.subject_id')
      .select([
        'quizzes.id',
        'quizzes.title',
        'quizzes.mode',
        'quizzes.total_questions',
        'subjects.name as subject_name'
      ])
      .where('quizzes.id', '=', quizId)
      .executeTakeFirst();

    if (!quiz) throw new NotFoundError('Không tìm thấy đề thi.');

    const questions = await db
      .selectFrom('quiz_questions')
      .innerJoin('questions', 'questions.id', 'quiz_questions.question_id')
      .select([
        'quiz_questions.display_order',
        'questions.id as question_id',
        'questions.content',
        'questions.difficulty',
        'questions.explanation',
        'questions.source_reference',
        'questions.question_type'
      ])
      .where('quiz_questions.quiz_id', '=', quizId)
      .orderBy('quiz_questions.display_order', 'asc')
      .execute();

    const qIds = questions.map((q) => q.question_id);
    const options =
      qIds.length > 0
        ? await db
            .selectFrom('question_options')
            .select(['question_id', 'option_label', 'content', 'is_correct'])
            .where('question_id', 'in', qIds)
            .orderBy('option_label', 'asc')
            .execute()
        : [];

    return {
      quiz,
      questions: questions.map((q) => ({
        ...q,
        options: options.filter((o) => o.question_id === q.question_id)
      }))
    };
  }

  /** Xuất đề thi ra file Word (.docx), có tuỳ chọn kèm đáp án & giải thích. */
  async exportQuizToDocx(
    quizId: string,
    includeAnswers = true
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { quiz, questions } = await this.loadQuizWithQuestions(quizId);

    const children: Paragraph[] = [
      new Paragraph({
        text: quiz.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 120 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Môn học: ${quiz.subject_name}  •  Tổng số câu: ${questions.length}`,
            italics: true,
            size: 20
          })
        ],
        spacing: { after: 240 }
      })
    ];

    questions.forEach((q, idx) => {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `Câu ${idx + 1}: `, bold: true }),
            new TextRun({ text: q.content })
          ],
          spacing: { before: 160, after: 80 }
        })
      );

      for (const opt of q.options) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `    ${opt.option_label}. `, bold: true }),
              new TextRun({ text: opt.content })
            ],
            spacing: { after: 40 }
          })
        );
      }
    });

    if (includeAnswers) {
      children.push(
        new Paragraph({
          text: 'ĐÁP ÁN & GIẢI THÍCH CHI TIẾT',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 320, after: 160 }
        })
      );

      questions.forEach((q, idx) => {
        const correctLabels = q.options
          .filter((o) => o.is_correct)
          .map((o) => o.option_label)
          .join(', ');

        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: `Câu ${idx + 1}: `, bold: true }),
              new TextRun({ text: `Đáp án ${correctLabels || '—'}`, bold: true }),
              new TextRun({ text: q.explanation ? ` — ${q.explanation}` : '' })
            ],
            spacing: { after: 80 }
          })
        );
      });
    }

    const doc = new Document({
      sections: [{ properties: {}, children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = quiz.title.replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '-').slice(0, 60);
    return { buffer, filename: `${safeName || 'de-thi'}.docx` };
  }

  /** Xuất đề thi sang CSV tương thích Anki (Front; Back). */
  async exportQuizToAnkiCsv(quizId: string): Promise<{ csv: string; filename: string }> {
    const { quiz, questions } = await this.loadQuizWithQuestions(quizId);

    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const lines: string[] = [];

    for (const q of questions) {
      const optsHtml = q.options.map((o) => `${o.option_label}. ${o.content}`).join('<br>');
      const front = `<b>${q.content}</b><br><br>${optsHtml}`;

      const correctText = q.options
        .filter((o) => o.is_correct)
        .map((o) => `${o.option_label}. ${o.content}`)
        .join('; ');
      const back = `<b>Đáp án: ${correctText}</b><br><br>${q.explanation}${
        q.source_reference ? `<br><i>Nguồn: ${q.source_reference}</i>` : ''
      }`;

      lines.push(`${escapeCsv(front)},${escapeCsv(back)}`);
    }

    const safeName = quiz.title.replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '-').slice(0, 60);
    // Thêm UTF-8 BOM để Excel / Anki trên Windows đọc tiếng Việt chuẩn
    return { csv: `\uFEFF${lines.join('\n')}`, filename: `${safeName || 'anki'}-anki.csv` };
  }

  /** Nhập ngân hàng câu hỏi trực tiếp từ file Excel (.xlsx) hoặc CSV, bỏ qua bước gọi AI. */
  async importQuizFromExcel(
    buffer: Buffer,
    subjectName: string,
    title?: string
  ): Promise<{ quiz: any; importedCount: number }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as any);
    } catch {
      throw new AppError('Không đọc được file Excel (.xlsx). Hãy kiểm tra lại định dạng.', 422);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError('File Excel không có trang tính nào.', 422);

    const questions: GeneratedQuestionItem[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Bỏ qua dòng tiêu đề
      const getCell = (col: number) => String(row.getCell(col).text ?? '').trim();

      const content = getCell(1);
      const optA = getCell(2);
      const optB = getCell(3);
      const optC = getCell(4);
      const optD = getCell(5);
      const correctCol = getCell(6).toUpperCase();
      const diffRaw = getCell(7).toUpperCase();
      const explanation = getCell(8) || 'Theo tài liệu ôn tập.';
      const sourceRef = getCell(9) || null;

      if (!content || !optA || !optB) return;

      const difficulty: 'EASY' | 'MEDIUM' | 'HARD' =
        diffRaw === 'EASY' || diffRaw === 'HARD' ? diffRaw : 'MEDIUM';

      const correctSet = new Set(
        correctCol
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter((s) => ['A', 'B', 'C', 'D'].includes(s))
      );
      if (correctSet.size === 0) correctSet.add('A');

      const options = [
        { label: 'A' as const, content: optA, is_correct: correctSet.has('A') },
        { label: 'B' as const, content: optB, is_correct: correctSet.has('B') },
        ...(optC ? [{ label: 'C' as const, content: optC, is_correct: correctSet.has('C') }] : []),
        ...(optD ? [{ label: 'D' as const, content: optD, is_correct: correctSet.has('D') }] : [])
      ];

      questions.push({
        content,
        difficulty,
        explanation,
        source_reference: sourceRef,
        question_type: correctSet.size > 1 ? 'MULTI_SELECT' : 'MCQ',
        options
      });
    });

    if (questions.length === 0) {
      throw new AppError(
        'Không tìm thấy câu hỏi hợp lệ nào. Cột chuẩn: [1: Câu hỏi | 2: A | 3: B | 4: C | 5: D | 6: Đáp án đúng (A/B/C/D) | 7: Độ khó | 8: Giải thích].',
        422
      );
    }

    const attemptsService = new AttemptsService();
    const quiz = await attemptsService.createQuizFromQuestions({
      title: title?.trim() || `Bộ đề nhập Excel - ${subjectName} (${questions.length} câu)`,
      subjectName,
      mode: 'PRACTICE',
      instantFeedback: true,
      questions: questions.slice(0, 100)
    });

    return { quiz, importedCount: Math.min(questions.length, 100) };
  }

  /** Xuất đề thi ra file HTML độc lập tương tác offline (Single-Page App). */
  async exportQuizToInteractiveHtml(quizId: string): Promise<{ html: string; filename: string }> {
    return this.htmlQuiz.exportQuizToInteractiveHtml(quizId);
  }

  /** Nhập đề thi từ file HTML chứa mảng ALL_CATEGORIES hoặc questions. */
  async importQuizFromHtml(
    htmlContent: string,
    subjectName?: string,
    title?: string
  ): Promise<{ quizzes: any[]; importedCount: number }> {
    return this.htmlQuiz.importQuizFromHtml(htmlContent, subjectName, title);
  }

  /** Nạp sẵn ngân hàng 604 câu hỏi Giải Phẫu Bệnh mẫu từ GPB.html. */
  async seedGpbPathologyBank(): Promise<{ subject: any; quizzesCount: number; questionsCount: number }> {
    return this.htmlQuiz.seedGpbPathologyBank();
  }

  /**
   * Xuất bài học tóm tắt sang file Word (.docx) chuẩn cấu trúc học tập Y khoa.
   */
  async exportSummaryToDocx(summaryId: string): Promise<{ buffer: Buffer; filename: string }> {
    const summary = await db
      .selectFrom('document_summaries')
      .leftJoin('subjects', 'subjects.id', 'document_summaries.subject_id')
      .select([
        'document_summaries.id',
        'document_summaries.title',
        'document_summaries.summary',
        'document_summaries.key_takeaways',
        'document_summaries.source_filename',
        'document_summaries.word_count',
        'document_summaries.created_at',
        'subjects.name as subject_name'
      ])
      .where('document_summaries.id', '=', summaryId)
      .executeTakeFirst();

    if (!summary) {
      throw new NotFoundError('Không tìm thấy bài tóm tắt.');
    }

    const children: Paragraph[] = [];

    // Tiêu đề bài học
    children.push(
      new Paragraph({
        text: summary.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 200, after: 140 }
      })
    );

    // Thông tin metadata
    const createdAtStr = new Date(summary.created_at).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const estReadTime = Math.max(1, Math.ceil((summary.word_count || 1) / 200));

    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Môn học: ', bold: true, size: 20 }),
          new TextRun({ text: `${summary.subject_name || 'Y khoa tổng quát'}  •  `, size: 20 }),
          new TextRun({ text: 'Tài liệu gốc: ', bold: true, size: 20 }),
          new TextRun({ text: `${summary.source_filename || 'Tài liệu tải lên'}  •  `, size: 20 }),
          new TextRun({ text: 'Số từ: ', bold: true, size: 20 }),
          new TextRun({ text: `${summary.word_count} từ (~${estReadTime} phút đọc)  •  `, size: 20 }),
          new TextRun({ text: 'Ngày tạo: ', bold: true, size: 20 }),
          new TextRun({ text: createdAtStr, size: 20 })
        ],
        spacing: { after: 240 }
      })
    );

    // Điểm ghi nhớ trọng tâm (Key Takeaways)
    let takeaways: string[] = [];
    if (summary.key_takeaways) {
      if (Array.isArray(summary.key_takeaways)) {
        takeaways = summary.key_takeaways.map(String);
      } else if (typeof summary.key_takeaways === 'string') {
        try {
          const parsed = JSON.parse(summary.key_takeaways);
          if (Array.isArray(parsed)) takeaways = parsed.map(String);
          else if (typeof parsed === 'object' && parsed) takeaways = Object.values(parsed).map(String);
        } catch {
          takeaways = [summary.key_takeaways];
        }
      } else if (typeof summary.key_takeaways === 'object') {
        takeaways = Object.values(summary.key_takeaways).map(String);
      }
    }

    if (takeaways.length > 0) {
      children.push(
        new Paragraph({
          text: 'ĐIỂM GHI NHỚ TRỌNG TÂM (KEY TAKEAWAYS)',
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 }
        })
      );

      for (const item of takeaways) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({ text: '• ', bold: true, color: '0F766E' }),
              new TextRun({ text: item, bold: true })
            ],
            bullet: { level: 0 },
            spacing: { after: 60 }
          })
        );
      }

      children.push(
        new Paragraph({
          spacing: { after: 140 }
        })
      );
    }

    // Nội dung bài học tóm tắt
    children.push(
      new Paragraph({
        text: 'NỘI DUNG TÓM TẮT BÀI HỌC',
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 120 }
      })
    );

    const bodyParagraphs = parseMarkdownToDocx(summary.summary);
    children.push(...bodyParagraphs);

    // Chân trang tài liệu
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'MedQuiz AI - Active Recall Learning System • Tài liệu ôn tập chuyên sâu',
            italics: true,
            color: '64748B',
            size: 18
          })
        ],
        spacing: { before: 400, after: 100 }
      })
    );

    const doc = new Document({
      sections: [{ properties: {}, children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = summary.title
      .replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    return { buffer, filename: `[Tom-tat]-${safeName || 'bai-hoc'}.docx` };
  }

  /**
   * Xuất bài học tóm tắt sang trang HTML in ấn chuẩn CSS A4 (@media print)
   * Tự động kích hoạt hộp thoại in / Save as PDF trực tiếp từ trình duyệt/Electron.
   */
  async exportSummaryToPdfHtml(summaryId: string): Promise<{ html: string; filename: string }> {
    const summary = await db
      .selectFrom('document_summaries')
      .leftJoin('subjects', 'subjects.id', 'document_summaries.subject_id')
      .select([
        'document_summaries.id',
        'document_summaries.title',
        'document_summaries.summary',
        'document_summaries.key_takeaways',
        'document_summaries.source_filename',
        'document_summaries.word_count',
        'document_summaries.created_at',
        'subjects.name as subject_name'
      ])
      .where('document_summaries.id', '=', summaryId)
      .executeTakeFirst();

    if (!summary) {
      throw new NotFoundError('Không tìm thấy bài tóm tắt.');
    }

    let takeaways: string[] = [];
    if (summary.key_takeaways) {
      if (Array.isArray(summary.key_takeaways)) {
        takeaways = summary.key_takeaways.map(String);
      } else if (typeof summary.key_takeaways === 'string') {
        try {
          const parsed = JSON.parse(summary.key_takeaways);
          if (Array.isArray(parsed)) takeaways = parsed.map(String);
          else if (typeof parsed === 'object' && parsed) takeaways = Object.values(parsed).map(String);
        } catch {
          takeaways = [summary.key_takeaways];
        }
      } else if (typeof summary.key_takeaways === 'object') {
        takeaways = Object.values(summary.key_takeaways).map(String);
      }
    }

    const createdAtStr = new Date(summary.created_at).toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const estReadTime = Math.max(1, Math.ceil((summary.word_count || 1) / 200));
    const renderedContent = markdownToPrintHtml(summary.summary);

    const safeName = summary.title
      .replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(summary.title)} - MedQuiz AI Study Hub</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 15mm 20mm 15mm;
    }
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1e293b;
      background-color: #f8fafc;
      line-height: 1.65;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }
    .no-print {
      position: sticky;
      top: 0;
      z-index: 50;
      background: #0f172a;
      color: #fff;
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    }
    .no-print .brand {
      font-weight: 700;
      font-size: 15px;
      color: #2dd4bf;
    }
    .no-print .hint {
      font-size: 12px;
      color: #94a3b8;
    }
    .no-print .btn-group {
      display: flex;
      gap: 10px;
    }
    .no-print button {
      background: #0d9488;
      color: #fff;
      border: none;
      padding: 6px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .no-print button:hover {
      background: #0f766e;
    }
    .no-print button.secondary {
      background: #334155;
    }
    .no-print button.secondary:hover {
      background: #475569;
    }
    .page-container {
      max-width: 800px;
      margin: 24px auto;
      background: #ffffff;
      padding: 40px 48px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 20px 25px -5px rgba(0, 0, 0, 0.05);
    }
    .header-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #0f766e;
      background: #ccfbf1;
      padding: 4px 10px;
      border-radius: 9999px;
      margin-bottom: 12px;
    }
    h1.doc-title {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.3;
      margin-bottom: 16px;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 12px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px 16px;
      background: #f1f5f9;
      padding: 14px 18px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 24px;
    }
    .meta-item {
      display: flex;
      gap: 6px;
    }
    .meta-label {
      font-weight: 600;
      color: #475569;
    }
    .meta-value {
      color: #0f172a;
      font-weight: 500;
    }
    .takeaways-box {
      background: #f0fdfa;
      border: 1px solid #99f6e4;
      border-left: 4px solid #0d9488;
      border-radius: 6px;
      padding: 16px 20px;
      margin-bottom: 28px;
      page-break-inside: avoid;
    }
    .takeaways-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f766e;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .takeaways-list {
      list-style-type: none;
    }
    .takeaways-list li {
      position: relative;
      padding-left: 20px;
      margin-bottom: 6px;
      font-size: 13.5px;
      color: #134e4a;
      font-weight: 500;
      line-height: 1.5;
    }
    .takeaways-list li::before {
      content: "★";
      position: absolute;
      left: 0;
      color: #0d9488;
      font-size: 12px;
    }
    .summary-content {
      font-size: 14px;
      color: #334155;
    }
    .summary-h1 {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      margin-top: 24px;
      margin-bottom: 12px;
      page-break-after: avoid;
    }
    .summary-h2 {
      font-size: 17px;
      font-weight: 700;
      color: #0f766e;
      margin-top: 20px;
      margin-bottom: 10px;
      border-left: 3px solid #0d9488;
      padding-left: 8px;
      page-break-after: avoid;
    }
    .summary-h3 {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin-top: 16px;
      margin-bottom: 8px;
      page-break-after: avoid;
    }
    .summary-h4 {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      margin-top: 12px;
      margin-bottom: 6px;
      page-break-after: avoid;
    }
    .summary-p {
      margin-bottom: 12px;
      text-align: justify;
    }
    .summary-ul, .summary-ol {
      margin: 8px 0 14px 24px;
    }
    .summary-ul li, .summary-ol li {
      margin-bottom: 5px;
    }
    .summary-blockquote {
      border-left: 4px solid #cbd5e1;
      padding: 8px 16px;
      margin: 12px 0;
      color: #475569;
      background: #f8fafc;
      font-style: italic;
    }
    .inline-code {
      background: #e2e8f0;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
    .footer-note {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px dashed #cbd5e1;
      font-size: 11px;
      color: #64748b;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    @media print {
      body {
        background-color: #ffffff;
        font-size: 12pt;
        line-height: 1.5;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
      .page-container {
        max-width: 100%;
        margin: 0;
        padding: 0;
        box-shadow: none;
        border-radius: 0;
      }
      h1.doc-title {
        font-size: 20pt;
      }
      .summary-h2 {
        font-size: 14pt;
      }
      .summary-h3 {
        font-size: 12pt;
      }
      .summary-p {
        font-size: 11pt;
      }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <div>
      <div class="brand">MedQuiz AI • Tóm Tắt Bài Học</div>
      <div class="hint">Hộp thoại in sẽ tự động mở. Chọn <strong>"Save as PDF"</strong> để lưu file vector chuẩn.</div>
    </div>
    <div class="btn-group">
      <button onclick="window.print()">In / Lưu PDF</button>
      <button class="secondary" onclick="window.close()">Đóng</button>
    </div>
  </div>

  <div class="page-container">
    <div class="header-badge">Tài liệu ôn tập y khoa</div>
    <h1 class="doc-title">${escapeHtml(summary.title)}</h1>

    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Môn học:</span>
        <span class="meta-value">${escapeHtml(summary.subject_name || 'Y khoa tổng quát')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Nguồn:</span>
        <span class="meta-value">${escapeHtml(summary.source_filename || 'Tài liệu tải lên')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Dung lượng:</span>
        <span class="meta-value">${summary.word_count} từ (~${estReadTime} phút đọc)</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Ngày biên soạn:</span>
        <span class="meta-value">${createdAtStr}</span>
      </div>
    </div>

    ${
      takeaways.length > 0
        ? `<div class="takeaways-box">
      <div class="takeaways-title">
        <span>⚡ Điểm Ghi Nhớ Trọng Tâm (Key Takeaways)</span>
      </div>
      <ul class="takeaways-list">
        ${takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}
      </ul>
    </div>`
        : ''
    }

    <div class="summary-content">
      ${renderedContent}
    </div>

    <div class="footer-note">
      <span>MedQuiz AI — Active Recall & Spaced Repetition Learning System</span>
      <span>In ngày ${new Date().toLocaleDateString('vi-VN')}</span>
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>`;

    return { html, filename: `[Tom-tat]-${safeName || 'bai-hoc'}.html` };
  }
}

/** Helper phân tách định dạng inline (in đậm, in nghiêng) cho Word TextRun */
function parseInlineFormattingDocx(text: string): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.substring(lastIndex, match.index) }));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true }));
    } else if (token.startsWith('*') && token.endsWith('*')) {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true }));
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.substring(lastIndex) }));
  }

  return runs.length > 0 ? runs : [new TextRun({ text })];
}

/** Chuyển đổi cú pháp Markdown sang mảng Paragraph của docx */
function parseMarkdownToDocx(markdownText: string): Paragraph[] {
  const lines = markdownText.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) continue;

    if (line.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2).trim(),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 }
        })
      );
    } else if (line.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3).trim(),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 }
        })
      );
    } else if (line.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4).trim(),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 160, after: 80 }
        })
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormattingDocx(line.slice(2).trim()),
          bullet: { level: 0 },
          spacing: { after: 60 }
        })
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+\.)\s*(.*)$/);
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${match ? match[1] : ''} `, bold: true }),
            ...parseInlineFormattingDocx(match ? match[2] : line)
          ],
          spacing: { after: 60 }
        })
      );
    } else if (line.startsWith('>')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormattingDocx(line.replace(/^>\s*/, '')),
          spacing: { before: 80, after: 80 },
          indent: { left: 400 }
        })
      );
    } else {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormattingDocx(line),
          spacing: { after: 100 }
        })
      );
    }
  }

  return paragraphs;
}

/** Tránh tấn công XSS khi render nội dung người dùng/AI vào HTML */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Chuyển đổi Markdown đơn giản sang semantic HTML in ấn */
function markdownToPrintHtml(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const htmlParts: string[] = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  const closeLists = () => {
    if (inUl) {
      htmlParts.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      htmlParts.push('</ol>');
      inOl = false;
    }
    if (inBlockquote) {
      htmlParts.push('</blockquote>');
      inBlockquote = false;
    }
  };

  const formatInline = (text: string): string => {
    let formatted = escapeHtml(text);
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.+?)__/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/_([^_]+?)_/g, '<em>$1</em>');
    formatted = formatted.replace(/`([^`]+?)`/g, '<code class="inline-code">$1</code>');
    return formatted;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      closeLists();
      continue;
    }

    if (line.startsWith('# ')) {
      closeLists();
      htmlParts.push(`<h1 class="summary-h1">${formatInline(line.slice(2))}</h1>`);
    } else if (line.startsWith('## ')) {
      closeLists();
      htmlParts.push(`<h2 class="summary-h2">${formatInline(line.slice(3))}</h2>`);
    } else if (line.startsWith('### ')) {
      closeLists();
      htmlParts.push(`<h3 class="summary-h3">${formatInline(line.slice(4))}</h3>`);
    } else if (line.startsWith('#### ')) {
      closeLists();
      htmlParts.push(`<h4 class="summary-h4">${formatInline(line.slice(5))}</h4>`);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      if (inOl) {
        htmlParts.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        htmlParts.push('<ul class="summary-ul">');
        inUl = true;
      }
      htmlParts.push(`<li>${formatInline(line.slice(2))}</li>`);
    } else if (/^\d+\.\s/.test(line)) {
      if (inUl) {
        htmlParts.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        htmlParts.push('<ol class="summary-ol">');
        inOl = true;
      }
      const text = line.replace(/^\d+\.\s*/, '');
      htmlParts.push(`<li>${formatInline(text)}</li>`);
    } else if (line.startsWith('>')) {
      if (!inBlockquote) {
        closeLists();
        htmlParts.push('<blockquote class="summary-blockquote">');
        inBlockquote = true;
      }
      htmlParts.push(`<p>${formatInline(line.replace(/^>\s*/, ''))}</p>`);
    } else {
      closeLists();
      htmlParts.push(`<p class="summary-p">${formatInline(line)}</p>`);
    }
  }

  closeLists();
  return htmlParts.join('\n');
}

