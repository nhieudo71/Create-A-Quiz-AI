import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen,
  Search,
  Filter,
  Sparkles,
  FileDown,
  Printer,
  Copy,
  Check,
  Trash2,
  Play,
  Clock,
  FileText,
  RefreshCw,
  AlertCircle,
  Calendar,
  ChevronRight,
  ArrowLeft,
  BookMarked,
  GraduationCap,
  FolderOpen,
  Loader2,
  X
} from 'lucide-react';
import { SummaryService, DocumentSummaryItem } from '../../services/summary.service';
import { toast } from '../../context/ToastContext';

export interface SummaryStudyHubProps {
  onNavigateToGenerator?: (summaryText?: string, subjectName?: string, sourceTitle?: string) => void;
}

/**
 * Trình phân tích Markdown an toàn, định dạng chuyên biệt cho tài liệu Y khoa
 */
function renderInlineFormatted(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-bold text-slate-900 dark:text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs text-medical-700 dark:text-medical-400 font-semibold"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const MedicalMarkdownReader: React.FC<{ content: string }> = ({ content }) => {
  const blocks = useMemo(() => {
    const lines = content.split('\n');
    const result: React.ReactNode[] = [];
    let listBuffer: string[] = [];
    let isOrderedList = false;

    const flushList = () => {
      if (listBuffer.length > 0) {
        if (isOrderedList) {
          result.push(
            <ol key={`ol-${result.length}`} className="space-y-2 my-3 pl-2">
              {listBuffer.map((item, idx) => (
                <li key={idx} className="flex items-start text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  <span className="font-bold text-medical-600 dark:text-medical-400 mr-2 min-w-[1.4rem]">
                    {idx + 1}.
                  </span>
                  <span className="flex-1">{renderInlineFormatted(item)}</span>
                </li>
              ))}
            </ol>
          );
        } else {
          result.push(
            <ul key={`ul-${result.length}`} className="space-y-2 my-3 pl-2">
              {listBuffer.map((item, idx) => (
                <li key={idx} className="flex items-start text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  <span className="w-1.5 h-1.5 rounded-full bg-medical-500 mt-2 mr-2.5 flex-shrink-0" />
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
          <h4 key={i} className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-5 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-medical-500 inline-block" />
            <span>{renderInlineFormatted(line.slice(4))}</span>
          </h4>
        );
      } else if (line.startsWith('## ')) {
        flushList();
        result.push(
          <h3
            key={i}
            className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-2 mt-6 mb-3 text-medical-900 dark:text-medical-300 flex items-center gap-2.5"
          >
            <BookMarked className="w-5 h-5 text-medical-600 dark:text-medical-400 flex-shrink-0" />
            <span>{renderInlineFormatted(line.slice(3))}</span>
          </h3>
        );
      } else if (line.startsWith('# ')) {
        flushList();
        result.push(
          <h2
            key={i}
            className="text-lg sm:text-xl font-black text-slate-900 dark:text-white border-b-2 border-medical-500/30 pb-2.5 mt-7 mb-4 tracking-tight"
          >
            {renderInlineFormatted(line.slice(2))}
          </h2>
        );
      } else if (line.startsWith('> ')) {
        flushList();
        result.push(
          <blockquote
            key={i}
            className="border-l-4 border-medical-500 bg-medical-50/70 dark:bg-medical-950/30 pl-4 py-3 my-3 rounded-r-xl text-xs sm:text-sm text-slate-800 dark:text-slate-200 italic shadow-2xs"
          >
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-medical-600 dark:text-medical-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 not-italic font-medium">
                {renderInlineFormatted(line.slice(2))}
              </div>
            </div>
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
          <p key={i} className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed my-2.5">
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

// Hàm định dạng màu sắc cho huy hiệu môn học
function getSubjectBadgeClass(subject: string): string {
  const hash = subject.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const colors = [
    'bg-medical-50 text-medical-700 border-medical-200 dark:bg-medical-950/50 dark:text-medical-300 dark:border-medical-800',
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800',
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800',
    'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800',
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800',
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
  ];
  return colors[hash % colors.length];
}

export const SummaryStudyHub: React.FC<SummaryStudyHubProps> = ({ onNavigateToGenerator }) => {
  const [summaries, setSummaries] = useState<DocumentSummaryItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');

  const [isExportingDocx, setIsExportingDocx] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);
  const [isCopied, setIsCopied] = useState<boolean>(false);

  const [deleteConfirmItem, setDeleteConfirmItem] = useState<DocumentSummaryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [mobileShowReader, setMobileShowReader] = useState<boolean>(false);

  // Tải danh sách bài tóm tắt
  const loadSummaries = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const items = await SummaryService.list();
      setSummaries(items);
      if (items.length > 0 && !selectedId) {
        setSelectedId(items[0].id);
      }
    } catch (err: any) {
      const msg = err.message || 'Không thể tải danh sách bài học tóm tắt.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadSummaries();
  }, [loadSummaries]);

  // Danh sách các môn học độc nhất
  const uniqueSubjects = useMemo(() => {
    const subs = new Set<string>();
    for (const item of summaries) {
      if (item.subject_name && item.subject_name.trim()) {
        subs.add(item.subject_name.trim());
      }
    }
    return Array.from(subs).sort();
  }, [summaries]);

  // Bộ lọc bài học theo từ khóa và môn học
  const filteredSummaries = useMemo(() => {
    return summaries.filter((item) => {
      const matchSubject =
        selectedSubject === 'ALL' ||
        (item.subject_name && item.subject_name.trim() === selectedSubject);

      const q = searchTerm.toLowerCase().trim();
      const matchSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.subject_name && item.subject_name.toLowerCase().includes(q)) ||
        (item.source_filename && item.source_filename.toLowerCase().includes(q)) ||
        (item.summary && item.summary.toLowerCase().includes(q));

      return matchSubject && matchSearch;
    });
  }, [summaries, selectedSubject, searchTerm]);

  // Bài học hiện tại được chọn để hiển thị trong Reader Mode
  const activeSummary = useMemo(() => {
    if (!selectedId) return filteredSummaries[0] || null;
    return summaries.find((s) => s.id === selectedId) || filteredSummaries[0] || null;
  }, [summaries, filteredSummaries, selectedId]);

  // Thống kê tổng hợp (KPI stats)
  const stats = useMemo(() => {
    const totalLessons = summaries.length;
    const totalWords = summaries.reduce((acc, s) => acc + (s.word_count || 0), 0);
    const totalMinutes = Math.ceil(totalWords / 200);
    const totalSubjects = uniqueSubjects.length;
    return { totalLessons, totalWords, totalMinutes, totalSubjects };
  }, [summaries, uniqueSubjects]);

  // Thao tác: Tải file Word (.docx)
  const handleDownloadDocx = async (summary: DocumentSummaryItem) => {
    setIsExportingDocx(true);
    try {
      const filename = `[Tom-tat]-${summary.title.replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1EA0-\u1EF9]/g, '_')}.docx`;
      await SummaryService.downloadDocx(summary.id, filename);
      toast.success('Đã tải tài liệu Word (.docx) bài học thành công!');
    } catch (err: any) {
      toast.error(err.message || 'Không tải được file Word (.docx)');
    } finally {
      setIsExportingDocx(false);
    }
  };

  // Thao tác: In / Tải PDF
  const handleOpenPdf = async (summary: DocumentSummaryItem) => {
    setIsExportingPdf(true);
    try {
      await SummaryService.openPdfPrintView(summary.id);
    } catch (err: any) {
      toast.error(err.message || 'Không mở được bản in PDF');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Thao tác: Sao chép nội dung tóm tắt
  const handleCopy = async (summary: DocumentSummaryItem) => {
    try {
      await navigator.clipboard.writeText(summary.summary);
      setIsCopied(true);
      toast.success('Đã sao chép toàn bộ nội dung bài tóm tắt!');
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = summary.summary;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setIsCopied(true);
      toast.success('Đã sao chép nội dung bài tóm tắt!');
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // Thao tác: Tạo đề thi từ bài học này (Active Recall)
  const handleGenerateExam = (summary: DocumentSummaryItem) => {
    if (onNavigateToGenerator) {
      onNavigateToGenerator(summary.summary, summary.subject_name || undefined, summary.title);
      toast.success(`Đã nạp nội dung bài học "${summary.title}" vào bộ sinh đề AI!`);
    }
  };

  // Thao tác: Xác nhận xoá bài học
  const handleConfirmDelete = async () => {
    if (!deleteConfirmItem) return;
    setIsDeleting(true);
    try {
      await SummaryService.delete(deleteConfirmItem.id);
      setSummaries((prev) => prev.filter((item) => item.id !== deleteConfirmItem.id));
      if (selectedId === deleteConfirmItem.id) {
        setSelectedId(null);
      }
      toast.success(`Đã xoá bài học "${deleteConfirmItem.title}" khỏi kho ôn tập.`);
      setDeleteConfirmItem(null);
    } catch (err: any) {
      toast.error(err.message || 'Không thể xoá bài học.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Huy hiệu thống kê tổng quan */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-medical-600 to-sky-500 text-white flex items-center justify-center shadow-xs">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                  Kho Bài Học Tóm Tắt & Ôn Tập
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Summary Study Hub • Active Recall Medical Review
                </p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 max-w-2xl leading-relaxed">
              Không gian học tập kiến thức y khoa cốt lõi chắt lọc tự động từ tài liệu tải lên. Ôn tập nhanh chóng, tra cứu bẫy thi cử và tải tài liệu Word (.docx) / PDF (.pdf).
            </p>
          </div>

          {/* Huy hiệu thống kê nhanh (KPIs) */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center space-x-3 shadow-2xs">
              <div className="w-8 h-8 rounded-xl bg-medical-50 dark:bg-medical-950/50 text-medical-600 dark:text-medical-400 flex items-center justify-center">
                <GraduationCap className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">
                  {stats.totalLessons}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Bài học
                </div>
              </div>
            </div>

            <div className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center space-x-3 shadow-2xs">
              <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">
                  ~{stats.totalMinutes} phút
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Ôn tập
                </div>
              </div>
            </div>

            <div className="px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-center space-x-3 shadow-2xs">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <FolderOpen className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-black text-slate-900 dark:text-white">
                  {stats.totalSubjects}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Môn học
                </div>
              </div>
            </div>

            <button
              onClick={() => void loadSummaries()}
              title="Làm mới dữ liệu"
              className="p-3 rounded-2xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* 2. Thanh tìm kiếm & bộ lọc môn học */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Ô tìm kiếm tức thì */}
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Tìm kiếm bài học, môn học, từ khoá..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-medical-500 focus:bg-white dark:focus:bg-slate-900 transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Bộ lọc môn học */}
          <div className="flex items-center space-x-2 w-full sm:w-auto">
            <div className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">
              <Filter className="w-3.5 h-3.5" />
              <span>Môn học:</span>
            </div>
            <select
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value)}
              className="flex-1 sm:flex-initial px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-medical-500"
            >
              <option value="ALL">Tất cả môn học ({summaries.length})</option>
              {uniqueSubjects.map((sub) => {
                const count = summaries.filter((s) => s.subject_name === sub).length;
                return (
                  <option key={sub} value={sub}>
                    {sub} ({count})
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      {/* 3. Trạng thái tải & lỗi */}
      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 text-xs font-semibold text-rose-800 dark:text-rose-300 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button
            onClick={() => void loadSummaries()}
            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* 4. Nội dung chính: 2 Cột Master-Detail */}
      {isLoading && summaries.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-16 text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-medical-600 mx-auto" />
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Đang tải dữ liệu bài học tóm tắt...
          </p>
        </div>
      ) : summaries.length === 0 ? (
        /* Empty State hoàn toàn: Chưa có bài học nào */
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-10 sm:p-16 text-center max-w-xl mx-auto shadow-xs space-y-6">
          <div className="w-20 h-20 rounded-3xl bg-medical-50 dark:bg-medical-950/50 text-medical-600 dark:text-medical-400 flex items-center justify-center mx-auto shadow-inner">
            <BookOpen className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              Kho Bài Học Tóm Tắt Đang Trống
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
              Khi bạn tải slide bài giảng, giáo trình hoặc tài liệu y khoa lên để tạo đề thi, AI sẽ tự động chắt lọc kiến thức cốt lõi và lưu trữ bài học vào đây để bạn tiện ôn tập mọi lúc.
            </p>
          </div>

          <div className="pt-2">
            <button
              onClick={() => onNavigateToGenerator && onNavigateToGenerator()}
              className="px-6 py-3 rounded-xl bg-medical-600 hover:bg-medical-700 active:bg-medical-800 text-white text-xs font-bold shadow-md hover:shadow-lg transition inline-flex items-center space-x-2"
            >
              <Sparkles className="w-4 h-4" />
              <span>Tải tài liệu & Tạo bài học đầu tiên</span>
            </button>
          </div>
        </div>
      ) : filteredSummaries.length === 0 ? (
        /* Empty Filter State: Có bài học nhưng không khớp bộ lọc */
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-12 text-center space-y-4">
          <Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
          <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
            Không tìm thấy bài học nào phù hợp với bộ lọc hiện tại.
          </p>
          <button
            onClick={() => {
              setSearchTerm('');
              setSelectedSubject('ALL');
            }}
            className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
          >
            Xoá bộ lọc
          </button>
        </div>
      ) : (
        /* Bố cục 2 cột Master-Detail */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Cột trái: Danh sách thẻ bài học (Card List) */}
          <div
            className={`lg:col-span-5 xl:col-span-4 space-y-3 ${
              mobileShowReader ? 'hidden lg:block' : 'block'
            }`}
          >
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-semibold px-1">
              <span>{filteredSummaries.length} bài học tóm tắt</span>
              {searchTerm && <span>Từ khoá: &quot;{searchTerm}&quot;</span>}
            </div>

            <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
              {filteredSummaries.map((item) => {
                const isSelected = activeSummary?.id === item.id;
                const readingMinutes = Math.max(1, Math.ceil((item.word_count || 0) / 200));
                const subject = item.subject_name || 'Y Khoa Chung';

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setMobileShowReader(true);
                    }}
                    className={`group p-4 rounded-2xl border transition cursor-pointer relative ${
                      isSelected
                        ? 'bg-white dark:bg-slate-900 border-medical-500 dark:border-medical-500 shadow-sm ring-2 ring-medical-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs hover:shadow-xs'
                    }`}
                  >
                    <div className="space-y-2.5">
                      {/* Huy hiệu môn học & ngày */}
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${getSubjectBadgeClass(
                            subject
                          )}`}
                        >
                          {subject}
                        </span>
                        <div className="flex items-center space-x-1 text-[11px] text-slate-400">
                          <Calendar className="w-3 h-3" />
                          <span>
                            {new Date(item.created_at).toLocaleDateString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric'
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Tiêu đề bài học */}
                      <h3
                        className={`text-xs sm:text-sm font-bold line-clamp-2 transition ${
                          isSelected
                            ? 'text-medical-800 dark:text-medical-300'
                            : 'text-slate-800 dark:text-slate-100 group-hover:text-medical-600 dark:group-hover:text-medical-400'
                        }`}
                      >
                        {item.title}
                      </h3>

                      {/* File nguồn nếu có */}
                      {item.source_filename && (
                        <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 truncate">
                          <FileText className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{item.source_filename}</span>
                        </div>
                      )}

                      {/* Meta thời gian đọc & số từ */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <div className="flex items-center space-x-2">
                          <span className="flex items-center space-x-1">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{readingMinutes} phút</span>
                          </span>
                          <span>•</span>
                          <span>{item.word_count?.toLocaleString() || 0} từ</span>
                        </div>

                        <ChevronRight
                          className={`w-3.5 h-3.5 transition-transform ${
                            isSelected
                              ? 'text-medical-600 dark:text-medical-400 translate-x-0.5'
                              : 'text-slate-300 dark:text-slate-600 group-hover:text-slate-400'
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cột phải: Chế độ Đọc Bài Học (Reader Mode) */}
          <div
            className={`lg:col-span-7 xl:col-span-8 ${
              mobileShowReader ? 'block' : 'hidden lg:block'
            }`}
          >
            {activeSummary ? (
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden sticky top-20">
                {/* Mobile back button */}
                <div className="lg:hidden p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50">
                  <button
                    onClick={() => setMobileShowReader(false)}
                    className="flex items-center space-x-1.5 text-xs font-bold text-medical-700 dark:text-medical-400"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Quay lại danh sách bài học</span>
                  </button>
                  <span className="text-[11px] text-slate-400 font-medium truncate max-w-[200px]">
                    {activeSummary.title}
                  </span>
                </div>

                {/* Thanh công cụ học tập & xuất file */}
                <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-800/20">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* 📥 Tải Word */}
                    <button
                      onClick={() => void handleDownloadDocx(activeSummary)}
                      disabled={isExportingDocx}
                      className="px-3.5 py-2 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-xs font-bold text-blue-700 dark:text-blue-300 flex items-center space-x-1.5 transition disabled:opacity-60 shadow-2xs"
                      title="Tải bài học tóm tắt dạng tài liệu Word (.docx)"
                    >
                      {isExportingDocx ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                      ) : (
                        <FileDown className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      )}
                      <span>Tải Word (.docx)</span>
                    </button>

                    {/* 📄 Tải PDF / In */}
                    <button
                      onClick={() => void handleOpenPdf(activeSummary)}
                      disabled={isExportingPdf}
                      className="px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-300 flex items-center space-x-1.5 transition disabled:opacity-60 shadow-2xs"
                      title="Mở bản in hoặc lưu file PDF (.pdf) chuẩn A4"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                      ) : (
                        <Printer className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                      )}
                      <span>In / Tải PDF</span>
                    </button>

                    {/* 📋 Sao chép */}
                    <button
                      onClick={() => void handleCopy(activeSummary)}
                      className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center space-x-1.5 transition shadow-2xs"
                      title="Sao chép toàn bộ văn bản tóm tắt"
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                            Đã chép!
                          </span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          <span>Sao chép</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* 🎯 Tạo đề thi từ bài này */}
                    {onNavigateToGenerator && (
                      <button
                        onClick={() => handleGenerateExam(activeSummary)}
                        className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold shadow-xs hover:shadow flex items-center space-x-1.5 transition"
                        title="Tạo đề thi trắc nghiệm AI từ bài học này để luyện tập Active Recall"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Tạo đề thi từ bài này</span>
                      </button>
                    )}

                    {/* 🗑️ Xoá bài học */}
                    <button
                      onClick={() => setDeleteConfirmItem(activeSummary)}
                      className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-rose-300 dark:hover:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-400 hover:text-rose-600 transition"
                      title="Xoá bài học khỏi kho"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Khu vực nội dung bài học (Reader view) */}
                <div className="p-6 sm:p-8 space-y-6 max-h-[calc(100vh-250px)] overflow-y-auto">
                  {/* Banner thông tin bài học */}
                  <div className="space-y-3 pb-6 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${getSubjectBadgeClass(
                          activeSummary.subject_name || 'Y Khoa Chung'
                        )}`}
                      >
                        {activeSummary.subject_name || 'Y Khoa Chung'}
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400 flex items-center space-x-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>
                          Thời gian đọc ước tính: ~
                          {Math.max(1, Math.ceil((activeSummary.word_count || 0) / 200))} phút
                        </span>
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {activeSummary.word_count?.toLocaleString() || 0} từ
                      </span>
                    </div>

                    <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-tight">
                      {activeSummary.title}
                    </h2>

                    {activeSummary.source_filename && (
                      <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
                        <FileText className="w-3.5 h-3.5 text-medical-600 dark:text-medical-400" />
                        <span>Tài liệu nguồn: <strong>{activeSummary.source_filename}</strong></span>
                      </div>
                    )}
                  </div>

                  {/* Render văn bản Markdown y khoa */}
                  <div className="prose prose-slate dark:prose-invert max-w-none">
                    <MedicalMarkdownReader content={activeSummary.summary} />
                  </div>

                  {/* Footer chân trang của bài học */}
                  <div className="pt-6 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
                    <div>
                      Biên soạn tự động bởi MedQuiz AI • Bản quyền học tập Active Recall
                    </div>
                    {onNavigateToGenerator && (
                      <button
                        onClick={() => handleGenerateExam(activeSummary)}
                        className="text-medical-600 dark:text-medical-400 font-bold hover:underline inline-flex items-center space-x-1"
                      >
                        <span>Kiểm tra Active Recall bằng trắc nghiệm</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-16 text-center space-y-3">
                <BookOpen className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">
                  Chọn một bài học từ danh sách bên trái để bắt đầu đọc ôn tập.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal xác nhận xoá bài học */}
      {deleteConfirmItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-3 text-rose-600 dark:text-rose-400">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Xác nhận xoá bài học
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Bạn có chắc chắn muốn xoá bài học{' '}
              <strong className="text-slate-900 dark:text-white">
                &quot;{deleteConfirmItem.title}&quot;
              </strong>{' '}
              khỏi kho tài liệu ôn tập? Hành động này sẽ xoá bản tóm tắt vĩnh viễn khỏi CSDL và không thể hoàn tác.
            </p>

            <div className="pt-2 flex items-center justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirmItem(null)}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition"
              >
                Huỷ bỏ
              </button>
              <button
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-xs font-bold shadow-xs hover:shadow flex items-center space-x-1.5 transition"
              >
                {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isDeleting ? 'Đang xoá...' : 'Xác nhận xoá'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
