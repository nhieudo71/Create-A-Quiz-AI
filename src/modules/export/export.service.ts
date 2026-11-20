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
}
