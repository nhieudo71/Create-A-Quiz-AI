import React, { useState, useMemo } from 'react';
import { QuestionItem, Difficulty } from '../../types/generator.types';
import { QuestionCard } from './QuestionCard';
import { QuizService } from '../../services/quiz.service';
import { SummaryService } from '../../services/summary.service';
import { toast } from '../../context/ToastContext';
import {
  CheckCircle,
  Play,
  RefreshCw,
  Search,
  Loader2,
  Copy,
  Check,
  Download,
  BookOpen,
  Sparkles,
  ListOrdered,
  FileDown,
  Printer,
  ExternalLink
} from 'lucide-react';

interface QuestionReviewListProps {
  questions: QuestionItem[];
  subjectName: string;
  documentSummary?: string | null;
  isSummarizing?: boolean;
  savedQuizId?: string | null;
  isAutoSaved?: boolean;
  savedAt?: Date | null;
  savedSummaryId?: string | null;
  onNavigateToSummaries?: () => void;
  onUpdateQuestion: (index: number, updated: QuestionItem) => void;
  onDeleteQuestion: (index: number) => void;
  onReset: () => void;
  onStartQuiz: (questions: QuestionItem[]) => void;
}

/**
 * Trình phân tích Markdown an toàn, tối ưu hiệu năng hiển thị tài liệu y khoa
 */
function renderInlineFormatted(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-slate-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-xs text-indigo-700 font-semibold"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const MarkdownViewer: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => {
    const lines = content.split('\n');
    const result: React.ReactNode[] = [];
    let listBuffer: string[] = [];
    let isOrderedList = false;

    const flushList = () => {
      if (listBuffer.length > 0) {
        if (isOrderedList) {
          result.push(
            <ol key={`ol-${result.length}`} className="space-y-1.5 my-3 pl-2">
              {listBuffer.map((item, idx) => (
                <li key={idx} className="flex items-start text-xs sm:text-sm text-slate-700 leading-relaxed">
                  <span className="font-bold text-indigo-600 mr-2 min-w-[1.2rem]">{idx + 1}.</span>
                  <span className="flex-1">{renderInlineFormatted(item)}</span>
                </li>
              ))}
            </ol>
          );
        } else {
          result.push(
            <ul key={`ul-${result.length}`} className="space-y-1.5 my-3 pl-2">
              {listBuffer.map((item, idx) => (
                <li key={idx} className="flex items-start text-xs sm:text-sm text-slate-700 leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 mr-2 flex-shrink-0" />
                  <span className="flex-1">{renderInlineFormatted(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        listBuffer = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        flushList();
        continue;
      }

      if (line.startsWith('### ')) {
        flushList();
        result.push(
          <h4 key={i} className="text-sm font-bold text-slate-800 mt-4 mb-2 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-indigo-500 inline-block" />
            <span>{renderInlineFormatted(line.slice(4))}</span>
          </h4>
        );
      } else if (line.startsWith('## ')) {
        flushList();
        result.push(
          <h3 key={i} className="text-base font-bold text-slate-900 border-b border-slate-100 pb-1.5 mt-5 mb-2.5 text-indigo-900 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600 inline-block flex-shrink-0" />
            <span>{renderInlineFormatted(line.slice(3))}</span>
          </h3>
        );
      } else if (line.startsWith('# ')) {
        flushList();
        result.push(
          <h2 key={i} className="text-lg sm:text-xl font-extrabold text-slate-900 border-b border-indigo-100 pb-2 mt-6 mb-3 text-indigo-950">
            {renderInlineFormatted(line.slice(2))}
          </h2>
        );
      } else if (line.startsWith('> ')) {
        flushList();
        result.push(
          <blockquote key={i} className="border-l-4 border-indigo-400 bg-indigo-50/60 pl-3.5 py-2 my-2.5 rounded-r-lg text-xs sm:text-sm text-slate-700 italic">
            {renderInlineFormatted(line.slice(2))}
          </blockquote>
        );
      } else if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('+ ')) {
        if (isOrderedList) flushList();
        isOrderedList = false;
        listBuffer.push(line.replace(/^[-*+]\s+/, ''));
      } else if (/^\d+\.\s+/.test(line)) {
        if (!isOrderedList) flushList();
        isOrderedList = true;
        listBuffer.push(line.replace(/^\d+\.\s+/, ''));
      } else {
        flushList();
        result.push(
          <p key={i} className="text-xs sm:text-sm text-slate-700 leading-relaxed my-2">
            {renderInlineFormatted(line)}
          </p>
        );
      }
    }
    flushList();
    return result;
  }, [content]);

  return <div className="space-y-1">{blocks}</div>;
};

export const QuestionReviewList: React.FC<QuestionReviewListProps> = ({
  questions,
  subjectName,
  documentSummary = null,
  isSummarizing = false,
  savedQuizId = null,
  isAutoSaved = false,
  savedAt = null,
  savedSummaryId = null,
  onNavigateToSummaries,
  onUpdateQuestion,
  onDeleteQuestion,
  onReset,
  onStartQuiz
}) => {
  const [activeTab, setActiveTab] = useState<'QUESTIONS' | 'SUMMARY'>('QUESTIONS');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<'ALL' | Difficulty>('ALL');
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED'>('IDLE');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // Thống kê độ khó
  const stats = useMemo(() => {
    return {
      easy: questions.filter((q) => q.difficulty === 'EASY').length,
      medium: questions.filter((q) => q.difficulty === 'MEDIUM').length,
      hard: questions.filter((q) => q.difficulty === 'HARD').length
    };
  }, [questions]);

  // Lọc câu hỏi theo từ khóa và độ khó
  const filteredQuestions = useMemo(() => {
    return questions
      .map((question, originalIndex) => ({ question, originalIndex }))
      .filter(({ question }) => {
        const matchSearch =
          question.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
          question.explanation.toLowerCase().includes(searchTerm.toLowerCase());
        const matchDiff =
          filterDifficulty === 'ALL' || question.difficulty === filterDifficulty;
        return matchSearch && matchDiff;
      });
  }, [questions, searchTerm, filterDifficulty]);

  const handleSaveBank = async () => {
    if (questions.length === 0) return;

    setSaveState('SAVING');
    setSaveError(null);

    try {
      await QuizService.createQuiz({
        title: `Bộ đề ${subjectName} (${questions.length} câu)`,
        subjectName,
        mode: 'PRACTICE',
        questions
      });
      setSaveState('SAVED');
      setTimeout(() => setSaveState('IDLE'), 3000);
    } catch (err: any) {
      setSaveState('IDLE');
      setSaveError(err.message || 'Không lưu được bộ đề lên máy chủ.');
    }
  };

  const handleCopySummary = async () => {
    if (!documentSummary) return;
    try {
      await navigator.clipboard.writeText(documentSummary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = documentSummary;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadMarkdown = () => {
    if (!documentSummary) return;
    const blob = new Blob([documentSummary], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const cleanSubject = subjectName.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_');
    a.download = `Tom-tat-${cleanSubject}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportDocx = async () => {
    if (!documentSummary) return;
    setIsExportingDocx(true);
    try {
      let targetId = savedSummaryId;
      if (!targetId) {
        const created = await SummaryService.create({
          title: `Bài tóm tắt: ${subjectName} - ${new Date().toLocaleDateString('vi-VN')}`,
          summary: documentSummary,
          subjectName
        });
        targetId = created.id;
      }
      await SummaryService.downloadDocx(targetId, `Tom-tat-${subjectName.replace(/\s+/g, '_')}.docx`);
      toast.success('Đã tải tài liệu Word (.docx) bài tóm tắt thành công!');
    } catch (err: any) {
      toast.error(err.message || 'Không thể tải file Word (.docx)');
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportPdf = async () => {
    if (!documentSummary) return;
    setIsExportingPdf(true);
    try {
      let targetId = savedSummaryId;
      if (!targetId) {
        const created = await SummaryService.create({
          title: `Bài tóm tắt: ${subjectName} - ${new Date().toLocaleDateString('vi-VN')}`,
          summary: documentSummary,
          subjectName
        });
        targetId = created.id;
      }
      await SummaryService.openPdfPrintView(targetId);
    } catch (err: any) {
      toast.error(err.message || 'Không thể mở bản in PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* 1. Huy hiệu xác nhận tự động lưu vào CSDL (Auto-Save Confirmation Badge) */}
      {isAutoSaved && (
        <div className="bg-gradient-to-r from-emerald-50 via-teal-50/50 to-emerald-50 border border-emerald-200/90 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-start sm:items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 shadow-xs">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-emerald-900">
                  ✓ Đã tự động lưu vào CSDL
                </span>
                {savedAt && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    lúc {savedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                {savedQuizId && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-emerald-200/70 text-emerald-900 font-semibold">
                    Mã đề: {savedQuizId.slice(0, 8)}...
                  </span>
                )}
              </div>
              <p className="text-xs text-emerald-700 mt-1">
                Bộ đề thi đã được lưu trữ vĩnh viễn vào CSDL. Dữ liệu không bị mất khi làm mới hoặc rời trang.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-stretch sm:self-auto">
            <button
              onClick={() => onStartQuiz(questions)}
              className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold shadow-xs hover:shadow flex items-center justify-center space-x-1.5 transition"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Vào thi ngay</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. Header thanh công cụ & Tóm tắt kết quả */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold">
              AI Sinh Thành Công
            </span>
            <span className="text-xs text-slate-400">• Môn: {subjectName}</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mt-1">
            Đã Tạo {questions.length} Câu Hỏi Trắc Nghiệm
          </h2>
          <div className="flex items-center space-x-4 text-xs text-slate-500 mt-2">
            <span>Dễ: <strong className="text-emerald-600">{stats.easy}</strong></span>
            <span>TB: <strong className="text-amber-600">{stats.medium}</strong></span>
            <span>Khó: <strong className="text-rose-600">{stats.hard}</strong></span>
          </div>
        </div>

        {/* Nút thao tác nhanh */}
        <div className="flex items-center space-x-2">
          <button
            onClick={onReset}
            className="px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 text-xs font-semibold flex items-center space-x-1.5 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tạo đề mới</span>
          </button>

          <button
            onClick={() => void handleSaveBank()}
            disabled={saveState === 'SAVING' || questions.length === 0}
            className={`px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-60 ${
              saveState === 'SAVED'
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {saveState === 'SAVING' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4" />
            )}
            <span>
              {saveState === 'SAVING'
                ? 'Đang đồng bộ...'
                : saveState === 'SAVED'
                ? 'Đã đồng bộ CSDL!'
                : isAutoSaved
                ? 'Đồng bộ lại CSDL'
                : 'Lưu bộ đề'}
            </span>
          </button>

          <button
            onClick={() => onStartQuiz(questions)}
            className="px-5 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 active:bg-medical-800 text-white text-xs font-bold shadow-sm hover:shadow flex items-center space-x-1.5 transition"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Làm bài ngay</span>
          </button>
        </div>
      </div>

      {saveError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
          {saveError}
        </div>
      )}

      {/* 3. Thanh chuyển Tab giữa "Bộ Câu Hỏi" và "Tóm Tắt & Tổng Hợp Kiến Thức" */}
      <div className="flex items-center border-b border-slate-200 space-x-2">
        <button
          onClick={() => setActiveTab('QUESTIONS')}
          className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === 'QUESTIONS'
              ? 'border-medical-600 text-medical-700 bg-medical-50/40 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <ListOrdered className="w-4 h-4" />
          <span>Danh Sách Câu Hỏi ({questions.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('SUMMARY')}
          className={`flex items-center space-x-2 py-3 px-4 text-xs font-bold border-b-2 transition ${
            activeTab === 'SUMMARY'
              ? 'border-indigo-600 text-indigo-700 bg-indigo-50/40 rounded-t-lg'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
          }`}
        >
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <span>Tóm Tắt & Tổng Hợp Kiến Thức Cốt Lõi</span>
          {isSummarizing && (
            <span className="flex items-center space-x-1 text-[11px] text-indigo-600 font-normal ml-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Đang tóm tắt...</span>
            </span>
          )}
          {!isSummarizing && documentSummary && (
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold ml-1">
              ✓ Sẵn sàng
            </span>
          )}
        </button>
      </div>

      {/* 4. Nội dung theo Tab */}
      {activeTab === 'QUESTIONS' ? (
        <>
          {/* Thông báo gợi ý tóm tắt nếu đã hoàn thành */}
          {documentSummary && (
            <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-3 flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 text-indigo-900 font-medium">
                <Sparkles className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span>
                  Bản <strong>Tóm Tắt & Tổng Hợp Kiến Thức Cốt Lõi</strong> từ tài liệu đã sẵn sàng!
                </span>
              </div>
              <button
                onClick={() => setActiveTab('SUMMARY')}
                className="px-2.5 py-1 bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 font-bold rounded-lg shadow-2xs transition"
              >
                Xem tóm tắt ngay →
              </button>
            </div>
          )}

          {/* Bộ lọc & Tìm kiếm */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Tìm kiếm nội dung câu hỏi..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-medical-500"
              />
            </div>

            {/* Bộ lọc độ khó */}
            <div className="flex items-center space-x-1.5 self-start sm:self-auto bg-white p-1 rounded-xl border border-slate-200">
              {(['ALL', 'EASY', 'MEDIUM', 'HARD'] as const).map((diff) => (
                <button
                  key={diff}
                  onClick={() => setFilterDifficulty(diff)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    filterDifficulty === diff
                      ? 'bg-medical-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {diff === 'ALL'
                    ? 'Tất cả'
                    : diff === 'EASY'
                    ? 'Dễ'
                    : diff === 'MEDIUM'
                    ? 'TB'
                    : 'Khó'}
                </button>
              ))}
            </div>
          </div>

          {/* Danh sách câu hỏi */}
          {filteredQuestions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              Không tìm thấy câu hỏi phù hợp với bộ lọc.
            </div>
          ) : (
            <div className="space-y-4">
              {filteredQuestions.map(({ question, originalIndex }) => (
                <QuestionCard
                  key={`${originalIndex}-${question.content.slice(0, 40)}`}
                  index={originalIndex}
                  question={question}
                  onUpdate={(updated) => onUpdateQuestion(originalIndex, updated)}
                  onDelete={() => onDeleteQuestion(originalIndex)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        /* Tab Tóm Tắt & Tổng Hợp Kiến Thức Cốt Lõi */
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span>Tóm Tắt & Tổng Hợp Kiến Thức Cốt Lõi</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 uppercase tracking-wide">
                    High-Yield Medical Review
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Trọng tâm bệnh học, dược lý, tiêu chuẩn vàng và điểm bẫy thi cử môn {subjectName}
                </p>
              </div>
            </div>

            {/* Actions: Hub link, Export Word, Export PDF, Copy & Download MD */}
            <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
              {onNavigateToSummaries && (
                <button
                  onClick={onNavigateToSummaries}
                  className="px-3 py-2 rounded-xl bg-medical-50 hover:bg-medical-100 border border-medical-200 text-xs font-bold text-medical-800 flex items-center space-x-1.5 transition shadow-2xs"
                  title="Chuyển sang Kho Tài Liệu Tóm Tắt để ôn tập chuyên sâu"
                >
                  <BookOpen className="w-4 h-4 text-medical-600" />
                  <span>Xem trong Kho Tài Liệu Tóm Tắt</span>
                  <ExternalLink className="w-3 h-3 text-medical-500" />
                </button>
              )}

              <button
                onClick={() => void handleExportDocx()}
                disabled={!documentSummary || isSummarizing || isExportingDocx}
                className="px-3 py-2 rounded-xl border border-blue-200 bg-blue-50/70 hover:bg-blue-100 text-xs font-semibold text-blue-700 flex items-center space-x-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                title="Tải bài học tóm tắt dạng Word (.docx)"
              >
                {isExportingDocx ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                ) : (
                  <FileDown className="w-4 h-4 text-blue-600" />
                )}
                <span>Tải Word (.docx)</span>
              </button>

              <button
                onClick={() => void handleExportPdf()}
                disabled={!documentSummary || isSummarizing || isExportingPdf}
                className="px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-xs font-semibold text-rose-700 flex items-center space-x-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
                title="Mở hoặc in bài học tóm tắt định dạng PDF"
              >
                {isExportingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin text-rose-600" />
                ) : (
                  <Printer className="w-4 h-4 text-rose-600" />
                )}
                <span>In / Tải PDF</span>
              </button>

              <button
                onClick={() => void handleCopySummary()}
                disabled={!documentSummary || isSummarizing}
                className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 active:bg-slate-100 text-xs font-semibold text-slate-700 flex items-center space-x-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sao chép toàn bộ tóm tắt"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700 font-bold">Đã chép!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-500" />
                    <span>Sao chép</span>
                  </>
                )}
              </button>

              <button
                onClick={handleDownloadMarkdown}
                disabled={!documentSummary || isSummarizing}
                className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 active:bg-indigo-200 border border-indigo-200 text-xs font-semibold text-indigo-700 flex items-center space-x-1.5 transition disabled:opacity-50 disabled:cursor-not-allowed"
                title="Tải về file ghi chú Markdown"
              >
                <Download className="w-4 h-4 text-indigo-600" />
                <span>.md</span>
              </button>
            </div>
          </div>

          {/* Thân tài liệu tóm tắt */}
          {isSummarizing ? (
            <div className="py-16 text-center space-y-4">
              <div className="inline-flex p-4 rounded-full bg-indigo-50 text-indigo-600">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">
                  AI đang tổng hợp và chắt lọc kiến thức y khoa cốt lõi...
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                  Đang phân loại cơ chế tác động, tiêu chuẩn chẩn đoán, phác đồ điều trị và các bẫy câu hỏi thường gặp. Bạn có thể sang tab làm bài ngay, kết quả tóm tắt sẽ hiển thị tại đây khi hoàn thành.
                </p>
              </div>
            </div>
          ) : documentSummary ? (
            <div className="prose prose-slate max-w-none text-slate-800">
              <MarkdownViewer content={documentSummary} />
            </div>
          ) : (
            <div className="py-12 text-center text-slate-500 text-xs space-y-2">
              <BookOpen className="w-8 h-8 mx-auto text-slate-300" />
              <p>Chưa có bản tóm tắt nào cho tài liệu này.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
