import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { db } from '../../core/database/db';
import { AppError, NotFoundError } from '../../core/errors';
import { AttemptsService } from '../attempts/attempts.service';
import type { GeneratedQuestionItem } from '../ai-generator/ai.service';

export interface ParsedCategory {
  id?: string;
  title: string;
  desc?: string;
  questions: GeneratedQuestionItem[];
}

export class HtmlQuizService {
  private attemptsService = new AttemptsService();

  /**
   * Phân tích nội dung file HTML để trích xuất đề thi và câu hỏi.
   * Hỗ trợ định dạng embedded script (như GPB.html: ALL_CATEGORIES / QUIZ_DATA)
   * và định dạng mảng questions JSON trong script tag.
   */
  parseQuizFromHtml(htmlContent: string): ParsedCategory[] {
    const categories: ParsedCategory[] = [];

    // 1. Thử tìm khối JSON ALL_CATEGORIES hoặc QUIZ_DATA hoặc CATEGORIES
    const catMarker = htmlContent.match(
      /(?:const|let|var)\s+(?:ALL_CATEGORIES|QUIZ_DATA|CATEGORIES)\s*=\s*\[/i
    );

    if (catMarker && typeof catMarker.index === 'number') {
      const openBracketIdx = catMarker.index + catMarker[0].length - 1;
      const arrayStr = this.extractBalancedArray(htmlContent, openBracketIdx);
      if (arrayStr) {
        const rawCats = this.safeParseArray(arrayStr);
        if (Array.isArray(rawCats)) {
          for (const c of rawCats) {
            const rawQuestions = Array.isArray(c.questions) ? c.questions : [];
            const mappedQuestions = this.mapRawQuestions(rawQuestions);
            if (mappedQuestions.length > 0) {
              categories.push({
                id: c.id,
                title: String(c.title || c.name || 'Chuyên đề Y khoa').trim(),
                desc: c.desc ? String(c.desc).trim() : undefined,
                questions: mappedQuestions
              });
            }
          }
        }
      }
    }

    // 2. Thử tìm mảng questions đơn lẻ: const questions = [...] hoặc let questions = [...]
    if (categories.length === 0) {
      const qMarker = htmlContent.match(
        /(?:const|let|var)\s+(?:questions|QUESTIONS|QUIZ_QUESTIONS)\s*=\s*\[/i
      );
      if (qMarker && typeof qMarker.index === 'number') {
        const openBracketIdx = qMarker.index + qMarker[0].length - 1;
        const arrayStr = this.extractBalancedArray(htmlContent, openBracketIdx);
        if (arrayStr) {
          const rawQ = this.safeParseArray(arrayStr);
          if (Array.isArray(rawQ)) {
            const mappedQuestions = this.mapRawQuestions(rawQ);
            if (mappedQuestions.length > 0) {
              const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
              const title = titleMatch ? titleMatch[1].trim() : 'Đề thi nhập từ HTML';
              categories.push({
                title,
                questions: mappedQuestions
              });
            }
          }
        }
      }
    }

    if (categories.length === 0) {
      throw new AppError(
        'Không tìm thấy dữ liệu câu hỏi trong tệp HTML. Tệp cần chứa cấu trúc trắc nghiệm tương thích GPB.html hoặc mảng questions.',
        422
      );
    }

    return categories;
  }

  /** Trích xuất chuỗi JSON mảng khớp chính xác dấu ngoặc mở [ và đóng ] */
  private extractBalancedArray(text: string, startIndex: number): string | null {
    let depth = 0;
    let inString: string | null = null;
    let escape = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === '\\') {
        escape = true;
        continue;
      }
      if (inString) {
        if (char === inString) inString = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        continue;
      }
      if (char === '[') depth++;
      else if (char === ']') {
        depth--;
        if (depth === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }
    return null;
  }

  /** Chuyển đổi an toàn chuỗi JavaScript mảng (hỗ trợ cả JSON chuẩn và JS Object literal có unquoted keys) */
  private safeParseArray(arrayStr: string): any[] | null {
    try {
      return JSON.parse(arrayStr);
    } catch {
      try {
        const sandbox = {};
        const result = vm.runInNewContext(`(${arrayStr})`, sandbox, { timeout: 1000 });
        if (Array.isArray(result)) return result;
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Chuyển đổi mảng câu hỏi thô sang chuẩn GeneratedQuestionItem của ứng dụng. */
  private mapRawQuestions(rawList: any[]): GeneratedQuestionItem[] {
    const result: GeneratedQuestionItem[] = [];
    const LABELS: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];

    for (const q of rawList) {
      const content = String(q.question || q.content || q.text || '').trim();
      const rawOptions = Array.isArray(q.options) ? q.options : [];
      if (!content || rawOptions.length < 2) continue;

      const correctIndex = typeof q.correct === 'number' ? q.correct : 0;
      const subtopic = q.subtopic ? String(q.subtopic).trim() : null;
      const explanation = q.explanation ? String(q.explanation).trim() : 'Theo tài liệu Giải Phẫu Bệnh.';

      const options = rawOptions.slice(0, 4).map((opt: any, idx: number) => {
        const text = typeof opt === 'string' ? opt.trim() : String(opt?.text || opt?.content || '').trim();
        const isCorrect = typeof opt === 'object' && opt.is_correct !== undefined
          ? Boolean(opt.is_correct)
          : idx === correctIndex;
        return {
          label: LABELS[idx] || 'A',
          content: text,
          is_correct: isCorrect
        };
      });

      result.push({
        content,
        difficulty: (q.difficulty === 'EASY' || q.difficulty === 'HARD') ? q.difficulty : 'MEDIUM',
        explanation,
        source_reference: q.source_reference ? String(q.source_reference).trim() : null,
        subtopic,
        question_type: 'MCQ',
        options
      });
    }

    return result;
  }

  /**
   * Nạp sẵn Ngân hàng câu hỏi Giải Phẫu Bệnh từ GPB.html vào CSDL nếu chưa có.
   */
  async seedGpbPathologyBank(): Promise<{ subject: any; quizzesCount: number; questionsCount: number }> {
    // Tìm file GPB.html ở các vị trí khả thi
    const candidates = [
      path.join(process.cwd(), 'GPB.html'),
      path.join(process.cwd(), '..', 'GPB.html'),
      path.join(__dirname, '..', '..', '..', 'GPB.html')
    ];

    let htmlPath: string | null = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        htmlPath = p;
        break;
      }
    }

    if (!htmlPath) {
      throw new NotFoundError('Không tìm thấy tệp GPB.html trong thư mục gốc của ứng dụng.');
    }

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const categories = this.parseQuizFromHtml(htmlContent);

    const subjectName = 'Giải Phẫu Bệnh';
    let totalQuestions = 0;
    let quizzesCount = 0;

    // Kiểm tra xem môn đã có chưa
    const existingSubject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('name', '=', subjectName)
      .executeTakeFirst();

    for (const cat of categories) {
      // Kiểm tra đề thi đã tồn tại chưa để tránh tạo trùng
      const existingQuiz = existingSubject
        ? await db
            .selectFrom('quizzes')
            .select(['id', 'title'])
            .where('subject_id', '=', existingSubject.id)
            .where('title', '=', cat.title)
            .executeTakeFirst()
        : null;

      if (!existingQuiz) {
        // Tối đa 100 câu/đề theo ràng buộc của database
        const qList = cat.questions.slice(0, 100);
        await this.attemptsService.createQuizFromQuestions({
          title: cat.title,
          subjectName,
          mode: 'PRACTICE',
          instantFeedback: true,
          questions: qList
        });
        quizzesCount++;
        totalQuestions += qList.length;
      }
    }

    const finalSubject = await db
      .selectFrom('subjects')
      .selectAll()
      .where('name', '=', subjectName)
      .executeTakeFirst();

    return {
      subject: finalSubject,
      quizzesCount,
      questionsCount: totalQuestions
    };
  }

  /**
   * Nhập đề thi từ tệp HTML do người dùng tải lên.
   */
  async importQuizFromHtml(
    htmlContent: string,
    overrideSubjectName?: string,
    overrideTitle?: string
  ): Promise<{ quizzes: any[]; importedCount: number }> {
    const categories = this.parseQuizFromHtml(htmlContent);
    const createdQuizzes: any[] = [];
    let totalQuestions = 0;

    for (const cat of categories) {
      const subjectName = overrideSubjectName?.trim() || 'Giải Phẫu Bệnh';
      const title = overrideTitle?.trim() || cat.title;
      const qList = cat.questions.slice(0, 100);

      const quiz = await this.attemptsService.createQuizFromQuestions({
        title,
        subjectName,
        mode: 'PRACTICE',
        instantFeedback: true,
        questions: qList
      });

      createdQuizzes.push(quiz);
      totalQuestions += qList.length;
    }

    return { quizzes: createdQuizzes, importedCount: totalQuestions };
  }

  /**
   * Xuất đề thi ra một file HTML offline tương tác hoàn chỉnh (Single-Page App).
   * Giống định dạng GPB.html: có giao diện đẹp, dark/light mode, sticky header,
   * live progress, filter chips, và bảng điều hướng câu hỏi.
   */
  async exportQuizToInteractiveHtml(quizId: string): Promise<{ html: string; filename: string }> {
    const quiz = await db
      .selectFrom('quizzes')
      .innerJoin('subjects', 'subjects.id', 'quizzes.subject_id')
      .select([
        'quizzes.id',
        'quizzes.title',
        'quizzes.mode',
        'quizzes.time_limit_seconds',
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
        'questions.subtopic',
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

    const fullQuestions = questions.map((q) => {
      const qOptions = options.filter((o) => o.question_id === q.question_id);
      const correctIdx = qOptions.findIndex((o) => o.is_correct);
      return {
        question: q.content,
        options: qOptions.map((o) => o.content),
        correct: correctIdx >= 0 ? correctIdx : 0,
        explanation: q.explanation,
        subtopic: q.subtopic || 'Chung',
        difficulty: q.difficulty,
        source_reference: q.source_reference
      };
    });

    const quizDataJson = JSON.stringify(
      [
        {
          id: quiz.id,
          title: quiz.title,
          subject: quiz.subject_name,
          questionCount: fullQuestions.length,
          questions: fullQuestions
        }
      ],
      null,
      2
    );

    const safeTitle = quiz.title.replace(/[^\w\s\u00C0-\u1EF9-]/g, '').trim() || 'De-Thi';
    const filename = `${safeTitle}.html`;

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.escapeHtml(quiz.title)} - ${this.escapeHtml(quiz.subject_name)}</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-hover: #0369a1;
      --primary-light: #e0f2fe;
      --primary-text: #0369a1;
      --success: #10b981;
      --success-light: #d1fae5;
      --success-dark: #065f46;
      --danger: #ef4444;
      --danger-light: #fee2e2;
      --danger-dark: #991b1b;
      --warning: #f59e0b;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.07), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
      --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.08);
    }
    [data-theme="dark"] {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --border: #334155;
      --primary-light: #082f49;
      --primary-text: #7dd3fc;
      --success-light: #064e3b;
      --success-dark: #a7f3d0;
      --danger-light: #7f1d1d;
      --danger-dark: #fecaca;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg); color: var(--text); min-height: 100vh; line-height: 1.5; }
    header { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #fff; padding: 24px 20px; text-align: center; position: relative; }
    header h1 { font-size: 1.6rem; font-weight: 800; }
    header p { font-size: 0.9rem; opacity: 0.9; margin-top: 4px; }
    .theme-btn { position: absolute; top: 16px; right: 20px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 6px 12px; border-radius: 9999px; cursor: pointer; font-size: 0.85rem; font-weight: 600; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .sticky-bar { position: sticky; top: 10px; z-index: 100; background: var(--card-bg); border: 2px solid var(--border); border-radius: 16px; padding: 14px 20px; margin-bottom: 24px; box-shadow: var(--shadow-lg); backdrop-filter: blur(10px); }
    .sticky-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
    .stats-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .stat-badge { padding: 6px 12px; border-radius: 10px; font-size: 0.85rem; font-weight: 700; }
    .stat-total { background: var(--primary-light); color: var(--primary-text); }
    .stat-correct { background: var(--success-light); color: var(--success-dark); }
    .stat-wrong { background: var(--danger-light); color: var(--danger-dark); }
    .progress-bar { width: 100%; height: 8px; background: var(--border); border-radius: 9999px; overflow: hidden; margin-top: 10px; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #10b981, #0284c7); width: 0%; transition: width 0.3s; }
    .quiz-layout { display: grid; grid-template-columns: 1fr 320px; gap: 24px; align-items: start; }
    @media (max-width: 900px) { .quiz-layout { grid-template-columns: 1fr; } }
    .filter-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-btn { background: var(--card-bg); border: 1px solid var(--border); color: var(--text); padding: 6px 14px; border-radius: 20px; cursor: pointer; font-size: 0.85rem; font-weight: 600; }
    .filter-btn.active { background: var(--primary); border-color: var(--primary); color: #fff; }
    .questions-list { display: flex; flex-direction: column; gap: 18px; }
    .q-card { background: var(--card-bg); border: 2px solid var(--border); border-radius: 16px; padding: 20px; box-shadow: var(--shadow); scroll-margin-top: 100px; }
    .q-card.answered-correct { border-color: var(--success); }
    .q-card.answered-wrong { border-color: var(--danger); }
    .q-meta { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 0.85rem; font-weight: 700; color: var(--text-muted); }
    .q-tag { background: var(--primary-light); color: var(--primary-text); padding: 2px 10px; border-radius: 6px; }
    .q-title { font-size: 1.05rem; font-weight: 700; margin-bottom: 14px; line-height: 1.5; }
    .options-grid { display: grid; gap: 10px; }
    .opt-btn { background: var(--bg); border: 2px solid var(--border); color: var(--text); padding: 12px 16px; border-radius: 12px; cursor: pointer; font-size: 0.92rem; text-align: left; display: flex; align-items: center; gap: 12px; transition: all 0.15s; }
    .opt-btn:hover:not(:disabled) { border-color: var(--primary); background: var(--card-bg); }
    .opt-label { font-weight: 800; width: 26px; height: 26px; border-radius: 8px; background: var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0; }
    .opt-btn.is-correct { border-color: var(--success); background: var(--success-light); color: var(--success-dark); }
    .opt-btn.is-correct .opt-label { background: var(--success); color: #fff; }
    .opt-btn.is-wrong { border-color: var(--danger); background: var(--danger-light); color: var(--danger-dark); }
    .opt-btn.is-wrong .opt-label { background: var(--danger); color: #fff; }
    .explanation-box { margin-top: 14px; padding: 14px; border-radius: 12px; background: var(--primary-light); border: 1px solid var(--border); font-size: 0.88rem; color: var(--text); display: none; }
    .explanation-box.show { display: block; }
    .palette-box { position: sticky; top: 100px; background: var(--card-bg); border: 2px solid var(--border); border-radius: 16px; padding: 18px; box-shadow: var(--shadow); }
    .palette-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; max-height: 400px; overflow-y: auto; margin-top: 12px; padding-right: 4px; }
    .p-btn { height: 36px; border-radius: 8px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-weight: 700; font-size: 0.85rem; cursor: pointer; }
    .p-btn.correct { background: var(--success-light); border-color: var(--success); color: var(--success-dark); }
    .p-btn.wrong { background: var(--danger-light); border-color: var(--danger); color: var(--danger-dark); }
  </style>
</head>
<body>
  <header>
    <h1>${this.escapeHtml(quiz.title)}</h1>
    <p>Môn học: ${this.escapeHtml(quiz.subject_name)} • Đề thi tương tác offline</p>
    <button class="theme-btn" onclick="toggleTheme()">🌓 Đổi Giao Diện</button>
  </header>

  <div class="container">
    <div class="sticky-bar">
      <div class="sticky-row">
        <div>
          <strong>${this.escapeHtml(quiz.title)}</strong>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">
            Tổng cộng: <strong>${fullQuestions.length} câu</strong>
          </div>
        </div>
        <div class="stats-group">
          <span class="stat-badge stat-total" id="stat-answered">Đã làm: 0/${fullQuestions.length}</span>
          <span class="stat-badge stat-correct" id="stat-correct">Đúng: 0</span>
          <span class="stat-badge stat-wrong" id="stat-wrong">Sai: 0</span>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" id="progress-fill"></div>
      </div>
    </div>

    <div class="quiz-layout">
      <div class="quiz-left">
        <div class="filter-row">
          <button class="filter-btn active" onclick="setFilter('all', this)">Tất cả (${fullQuestions.length})</button>
          <button class="filter-btn" onclick="setFilter('unanswered', this)">Chưa làm</button>
          <button class="filter-btn" onclick="setFilter('wrong', this)">Làm sai</button>
          <button class="filter-btn" onclick="setFilter('correct', this)">Làm đúng</button>
        </div>
        <div class="questions-list" id="questions-list"></div>
      </div>

      <div class="palette-box">
        <h4 style="font-size:0.9rem; text-transform:uppercase; font-weight:800; color:var(--text-muted)">Bảng Câu Hỏi</h4>
        <div class="palette-grid" id="palette-grid"></div>
      </div>
    </div>
  </div>

  <script>
    const QUIZ_DATA = ${quizDataJson};
    const questions = QUIZ_DATA[0].questions;
    const userAnswers = {};
    let currentFilter = 'all';

    function init() {
      renderQuestions();
      renderPalette();
      updateStats();
    }

    function toggleTheme() {
      const current = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    }

    function renderQuestions() {
      const list = document.getElementById('questions-list');
      list.innerHTML = '';
      const labels = ['A', 'B', 'C', 'D'];

      questions.forEach((q, qIdx) => {
        const isAnswered = userAnswers[qIdx] !== undefined;
        const isCorrect = isAnswered && userAnswers[qIdx] === q.correct;

        let visible = true;
        if (currentFilter === 'unanswered' && isAnswered) visible = false;
        if (currentFilter === 'correct' && (!isAnswered || !isCorrect)) visible = false;
        if (currentFilter === 'wrong' && (!isAnswered || isCorrect)) visible = false;

        const card = document.createElement('div');
        card.className = 'q-card ' + (isAnswered ? (isCorrect ? 'answered-correct' : 'answered-wrong') : '');
        card.id = 'q-' + qIdx;
        card.style.display = visible ? 'block' : 'none';

        let optionsHtml = '';
        q.options.forEach((optText, oIdx) => {
          let btnClass = 'opt-btn';
          if (isAnswered) {
            if (oIdx === q.correct) btnClass += ' is-correct';
            else if (oIdx === userAnswers[qIdx]) btnClass += ' is-wrong';
          }
          optionsHtml += \`
            <button class="\${btnClass}" onclick="answerQuestion(\${qIdx}, \${oIdx})">
              <span class="opt-label">\${labels[oIdx]}</span>
              <span>\${escapeHtml(optText)}</span>
            </button>
          \`;
        });

        card.innerHTML = \`
          <div class="q-meta">
            <span>CÂU \${qIdx + 1}</span>
            <span class="q-tag">\${escapeHtml(q.subtopic || 'Y khoa')}</span>
          </div>
          <div class="q-title">\${escapeHtml(q.question)}</div>
          <div class="options-grid">\${optionsHtml}</div>
          <div class="explanation-box \${isAnswered ? 'show' : ''}">
            <strong>💡 Giải thích:</strong> \${escapeHtml(q.explanation || 'Theo tài liệu ôn tập.')}
            \${q.source_reference ? '<br><small style="color:var(--text-muted)">Căn cứ: ' + escapeHtml(q.source_reference) + '</small>' : ''}
          </div>
        \`;
        list.appendChild(card);
      });
    }

    function renderPalette() {
      const palette = document.getElementById('palette-grid');
      palette.innerHTML = '';
      questions.forEach((q, idx) => {
        const isAnswered = userAnswers[idx] !== undefined;
        const isCorrect = isAnswered && userAnswers[idx] === q.correct;
        const btn = document.createElement('button');
        btn.className = 'p-btn ' + (isAnswered ? (isCorrect ? 'correct' : 'wrong') : '');
        btn.innerText = idx + 1;
        btn.onclick = () => {
          const el = document.getElementById('q-' + idx);
          if (el) {
            el.style.display = 'block';
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        };
        palette.appendChild(btn);
      });
    }

    function answerQuestion(qIdx, optIdx) {
      userAnswers[qIdx] = optIdx;
      renderQuestions();
      renderPalette();
      updateStats();
    }

    function updateStats() {
      const total = questions.length;
      let answered = 0;
      let correct = 0;
      let wrong = 0;
      for (let i = 0; i < total; i++) {
        if (userAnswers[i] !== undefined) {
          answered++;
          if (userAnswers[i] === questions[i].correct) correct++;
          else wrong++;
        }
      }
      document.getElementById('stat-answered').innerText = 'Đã làm: ' + answered + '/' + total;
      document.getElementById('stat-correct').innerText = 'Đúng: ' + correct;
      document.getElementById('stat-wrong').innerText = 'Sai: ' + wrong;
      const pct = total > 0 ? (answered / total) * 100 : 0;
      document.getElementById('progress-fill').style.width = pct + '%';
    }

    function setFilter(filter, btn) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderQuestions();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    window.onload = init;
  </script>
</body>
</html>`;

    return { html, filename };
  }

  private escapeHtml(str: string): string {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
