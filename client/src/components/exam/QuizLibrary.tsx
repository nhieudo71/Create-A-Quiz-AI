import React, { useCallback, useEffect, useState } from 'react';
import { QuizService } from '../../services/quiz.service';
import { SavedQuiz, SubjectSummary } from '../../types/quiz.types';
import {
  FolderOpen,
  BookOpen,
  Play,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  X,
  Check,
  RefreshCw,
  FileQuestion
} from 'lucide-react';

interface QuizLibraryProps {
  /** Mở phòng thi cho một đề đã lưu (không cần tạo lại đề). */
  onStartQuiz: (quizId: string, subjectName: string) => void;
}

const MODE_LABEL: Record<SavedQuiz['mode'], string> = {
  EXAM: 'Thi thật (có giờ)',
  PRACTICE: 'Ôn tập (không giới hạn giờ)'
};

/**
 * Thư viện đề thi theo môn học trong Phòng thi.
 * - Danh mục môn học: lấy từ các đề đã lưu trên server (bảng subjects/quizzes).
 * - Mỗi môn hiển thị các đề thi đã tạo trước đó (từ "Tạo Đề AI"), có thể:
 *   làm bài ngay, sửa (đổi tên/đổi môn), hoặc xoá vĩnh viễn.
 * - Dữ liệu được lưu vĩnh viễn trong CSDL cho tới khi người dùng chủ động xoá.
 */
export const QuizLibrary: React.FC<QuizLibraryProps> = ({ onStartQuiz }) => {
  const [subjects, setSubjects] = useState<SubjectSummary[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<SavedQuiz[]>([]);

  const [isLoadingSubjects, setIsLoadingSubjects] = useState(true);
  const [isLoadingQuizzes, setIsLoadingQuizzes] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [editingQuiz, setEditingQuiz] = useState<SavedQuiz | null>(null);
  const [deletingQuizId, setDeletingQuizId] = useState<string | null>(null);

  const loadSubjects = useCallback(async () => {
    setIsLoadingSubjects(true);
    setErrorMessage(null);
    try {
      const list = await QuizService.getSubjects();
      setSubjects(list);
      // Giữ môn đang chọn nếu vẫn còn tồn tại, không thì chọn môn đầu tiên
      setSelectedSubjectId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err: any) {
      setErrorMessage(err.message || 'Không tải được danh mục môn học.');
      setSubjects([]);
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  const loadQuizzes = useCallback(async (subjectId: string) => {
    setIsLoadingQuizzes(true);
    setErrorMessage(null);
    try {
      const data = await QuizService.getQuizzesBySubject(subjectId);
      setQuizzes(data.quizzes);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không tải được danh sách đề thi.');
      setQuizzes([]);
    } finally {
      setIsLoadingQuizzes(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (selectedSubjectId) void loadQuizzes(selectedSubjectId);
    else setQuizzes([]);
  }, [selectedSubjectId, loadQuizzes]);

  const handleDelete = async (quiz: SavedQuiz) => {
    if (!window.confirm(`Xoá vĩnh viễn đề "${quiz.title}"? Hành động này không thể hoàn tác.`)) return;
    setDeletingQuizId(quiz.id);
    setErrorMessage(null);
    try {
      await QuizService.deleteQuiz(quiz.id);
      setQuizzes((prev) => prev.filter((q) => q.id !== quiz.id));
      await loadSubjects();
    } catch (err: any) {
      setErrorMessage(err.message || 'Không xoá được đề thi.');
    } finally {
      setDeletingQuizId(null);
    }
  };

  const handleSaveEdit = async (title: string, subjectName: string) => {
    if (!editingQuiz) return;
    const updated = await QuizService.updateQuiz(editingQuiz.id, { title, subjectName });
    setEditingQuiz(null);
    await loadSubjects();
    // Nếu đề được chuyển sang môn khác, chuyển luôn danh sách đang xem sang môn đó
    if (updated.subject_id !== selectedSubjectId) {
      setSelectedSubjectId(updated.subject_id);
    } else if (selectedSubjectId) {
      await loadQuizzes(selectedSubjectId);
    }
  };

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId) ?? null;

  if (isLoadingSubjects) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-medical-600" /> Thư Viện Đề Thi
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Các đề đã tạo được lưu vĩnh viễn theo từng môn học cho tới khi bạn xoá.
          </p>
        </div>
        <button
          onClick={() => void loadSubjects()}
          title="Tải lại"
          className="p-2 rounded-lg text-slate-400 hover:bg-slate-100"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {errorMessage}
          </span>
          <button onClick={() => setErrorMessage(null)} className="text-rose-500 hover:text-rose-700 font-bold">
            Đóng
          </button>
        </div>
      )}

      {subjects.length === 0 ? (
        <div className="p-10 rounded-2xl border border-dashed border-slate-300 text-center text-sm text-slate-500">
          Chưa có môn học nào. Hãy sang tab <strong>"Tạo Đề AI"</strong> để tạo và lưu đề thi đầu tiên.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4">
          {/* Danh mục môn học */}
          <div className="space-y-1.5">
            {subjects.map((subject) => (
              <button
                key={subject.id}
                onClick={() => setSelectedSubjectId(subject.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition flex items-center justify-between gap-2 ${
                  selectedSubjectId === subject.id
                    ? 'border-medical-600 bg-medical-50 text-medical-800'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <BookOpen className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{subject.name}</span>
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 flex-shrink-0">
                  {subject.quiz_count}
                </span>
              </button>
            ))}
          </div>

          {/* Danh sách đề thi của môn đang chọn */}
          <div className="space-y-3">
            {isLoadingQuizzes ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : quizzes.length === 0 ? (
              <div className="p-10 rounded-2xl border border-dashed border-slate-300 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
                <FileQuestion className="w-8 h-8 text-slate-300" />
                <span>Môn "{selectedSubject?.name}" chưa có đề thi nào.</span>
              </div>
            ) : (
              quizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-900 text-sm truncate">{quiz.title}</h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {quiz.total_questions} câu • {MODE_LABEL[quiz.mode]}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingQuiz(quiz)}
                      title="Sửa đề thi"
                      className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void handleDelete(quiz)}
                      disabled={deletingQuizId === quiz.id}
                      title="Xoá vĩnh viễn"
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      {deletingQuizId === quiz.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => onStartQuiz(quiz.id, selectedSubject?.name ?? quiz.title)}
                      className="ml-1 px-3.5 py-2 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" /> Làm bài
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {editingQuiz && (
        <EditQuizModal
          quiz={editingQuiz}
          currentSubjectName={selectedSubject?.name ?? ''}
          onClose={() => setEditingQuiz(null)}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
};

interface EditQuizModalProps {
  quiz: SavedQuiz;
  currentSubjectName: string;
  onClose: () => void;
  onSave: (title: string, subjectName: string) => Promise<void>;
}

const EditQuizModal: React.FC<EditQuizModalProps> = ({ quiz, currentSubjectName, onClose, onSave }) => {
  const [title, setTitle] = useState(quiz.title);
  const [subjectName, setSubjectName] = useState(currentSubjectName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !subjectName.trim()) {
      setError('Tiêu đề và tên môn học không được để trống.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(title.trim(), subjectName.trim());
    } catch (err: any) {
      setError(err?.message || 'Không lưu được thay đổi.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">Sửa đề thi</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tiêu đề đề thi</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={255}
              required
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Môn học <span className="text-slate-400 font-normal">(gõ tên môn mới để chuyển đề sang môn khác)</span>
            </label>
            <input
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              maxLength={150}
              required
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold disabled:opacity-60 flex items-center space-x-1.5"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span>Lưu thay đổi</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


