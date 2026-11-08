import React, { useState, useMemo } from 'react';
import { QuestionItem, Difficulty } from '../../types/generator.types';
import { QuestionCard } from './QuestionCard';
import { QuizService } from '../../services/quiz.service';
import { CheckCircle, Play, RefreshCw, Search, Loader2 } from 'lucide-react';

interface QuestionReviewListProps {
  questions: QuestionItem[];
  subjectName: string;
  onUpdateQuestion: (index: number, updated: QuestionItem) => void;
  onDeleteQuestion: (index: number) => void;
  onReset: () => void;
  onStartQuiz: (questions: QuestionItem[]) => void;
}

export const QuestionReviewList: React.FC<QuestionReviewListProps> = ({
  questions,
  subjectName,
  onUpdateQuestion,
  onDeleteQuestion,
  onReset,
  onStartQuiz
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState<'ALL' | Difficulty>('ALL');
  const [saveState, setSaveState] = useState<'IDLE' | 'SAVING' | 'SAVED'>('IDLE');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Thống kê độ khó
  const stats = useMemo(() => {
    return {
      easy: questions.filter((q) => q.difficulty === 'EASY').length,
      medium: questions.filter((q) => q.difficulty === 'MEDIUM').length,
      hard: questions.filter((q) => q.difficulty === 'HARD').length
    };
  }, [questions]);

  // Lọc câu hỏi theo từ khóa và độ khó.
  // Giữ lại vị trí trong mảng gốc: chỉ số hiển thị (sau khi lọc) KHÁC chỉ số thật,
  // nếu dùng nhầm thì sửa/xóa sẽ tác động lên một câu khác.
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

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header thanh công cụ & Tóm tắt kết quả */}
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
                ? 'Đang lưu...'
                : saveState === 'SAVED'
                ? 'Đã lưu vào CSDL!'
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
              // Khoá theo nội dung câu hỏi: bộ lọc thay đổi vẫn giữ đúng danh tính thẻ
              key={`${originalIndex}-${question.content.slice(0, 40)}`}
              index={originalIndex}
              question={question}
              onUpdate={(updated) => onUpdateQuestion(originalIndex, updated)}
              onDelete={() => onDeleteQuestion(originalIndex)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
