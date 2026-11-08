import React, { useState } from 'react';
import { QuestionItem, Difficulty } from '../../types/generator.types';
import { Trash2, Edit3, Check, X, BookOpen } from 'lucide-react';

interface QuestionCardProps {
  index: number;
  question: QuestionItem;
  onUpdate: (updated: QuestionItem) => void;
  onDelete: () => void;
}

const DIFFICULTY_STYLES: Record<Difficulty, { label: string; bg: string; text: string }> = {
  EASY: { label: 'Dễ', bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  MEDIUM: { label: 'Trung bình', bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
  HARD: { label: 'Khó / Lâm sàng', bg: 'bg-rose-50 border-rose-200', text: 'text-rose-700' }
};

export const QuestionCard: React.FC<QuestionCardProps> = ({
  index,
  question,
  onUpdate,
  onDelete
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<QuestionItem>(question);

  const handleSaveEdit = () => {
    onUpdate(draft);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setDraft(question);
    setIsEditing(false);
  };

  const diffStyle = DIFFICULTY_STYLES[question.difficulty] || DIFFICULTY_STYLES.MEDIUM;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 transition-all hover:border-slate-300">
      {/* Header: Số thứ tự câu hỏi + Badge độ khó + Nút thao tác */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-sm flex items-center justify-center">
            #{index + 1}
          </span>
          <span
            className={`text-xs px-2.5 py-1 rounded-full border font-medium ${diffStyle.bg} ${diffStyle.text}`}
          >
            {diffStyle.label}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          {isEditing ? (
            <>
              <button
                onClick={handleSaveEdit}
                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition"
                title="Lưu chỉnh sửa"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={handleCancelEdit}
                className="p-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition"
                title="Hủy"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                title="Chỉnh sửa câu hỏi"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                title="Xóa câu hỏi này"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Nội dung câu hỏi */}
      <div className="mt-4">
        {isEditing ? (
          <textarea
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            className="w-full p-3 rounded-xl border border-slate-300 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-medical-500"
            rows={3}
          />
        ) : (
          <p className="text-sm md:text-base font-semibold text-slate-800 leading-relaxed">
            {question.content}
          </p>
        )}
      </div>

      {/* Danh sách 4 lựa chọn A, B, C, D */}
      <div className="mt-4 space-y-2">
        {draft.options.map((option, optIdx) => {
          const isCorrect = option.is_correct;
          return (
            <div
              key={option.label}
              className={`p-3 rounded-xl border flex items-center justify-between text-sm transition-colors ${
                isCorrect
                  ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 font-medium'
                  : 'bg-slate-50/50 border-slate-200 text-slate-700'
              }`}
            >
              <div className="flex items-center space-x-3 w-full mr-2">
                <span
                  className={`w-6 h-6 rounded-md font-bold text-xs flex items-center justify-center flex-shrink-0 ${
                    isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {option.label}
                </span>

                {isEditing ? (
                  <input
                    type="text"
                    value={option.content}
                    onChange={(e) => {
                      const newOptions = [...draft.options];
                      newOptions[optIdx].content = e.target.value;
                      setDraft({ ...draft, options: newOptions });
                    }}
                    className="w-full px-2 py-1 bg-white rounded border border-slate-300 text-xs"
                  />
                ) : (
                  <span className="text-sm">{option.content}</span>
                )}
              </div>

              {isEditing ? (
                <button
                  type="button"
                  onClick={() => {
                    const newOptions = draft.options.map((opt, i) => ({
                      ...opt,
                      is_correct: i === optIdx
                    }));
                    setDraft({ ...draft, options: newOptions });
                  }}
                  className={`text-xs px-2 py-1 rounded font-semibold ${
                    isCorrect ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isCorrect ? 'Đáp án đúng' : 'Chọn đúng'}
                </button>
              ) : (
                isCorrect && (
                  <span className="text-xs font-bold text-emerald-700 px-2 py-0.5 rounded-full bg-emerald-100 flex-shrink-0">
                    Đáp án đúng
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Lời giải thích chuyên sâu (Explanation Box) */}
      <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-700 mb-1.5">
          <BookOpen className="w-4 h-4 text-medical-600" />
          <span>Giải thích cơ chế & Trích dẫn Y khoa:</span>
        </div>

        {isEditing ? (
          <textarea
            value={draft.explanation}
            onChange={(e) => setDraft({ ...draft, explanation: e.target.value })}
            className="w-full p-2.5 rounded-lg border border-slate-300 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-medical-500"
            rows={2}
          />
        ) : (
          <p className="text-xs text-slate-600 leading-relaxed">{question.explanation}</p>
        )}

        {question.source_reference && !isEditing && (
          <p className="text-[11px] text-slate-400 mt-2 italic">
            Cơ sở tài liệu: {question.source_reference}
          </p>
        )}
      </div>
    </div>
  );
};
