import React, { useState, useEffect, useMemo } from 'react';
import { QuizService } from '../../services/quiz.service';
import { ReviewAttemptResponse } from '../../types/quiz.types';
import { Award, BookOpen, Check, X, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';

interface AttemptReviewProps {
  attemptId: string;
  onBack: () => void;
}

/**
 * Xem lại một lượt thi đã nộp: điểm, đáp án đúng và giải thích.
 * Dữ liệu lấy từ server nên đáp án đúng chỉ xuất hiện ở đây sau khi đã nộp.
 */
export const AttemptReview: React.FC<AttemptReviewProps> = ({ attemptId, onBack }) => {
  const [review, setReview] = useState<ReviewAttemptResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'WRONG' | 'CORRECT'>('ALL');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const data = await QuizService.reviewAttempt(attemptId);
        if (!cancelled) setReview(data);
      } catch (err: any) {
        if (!cancelled) setErrorMessage(err.message || 'Không tải được kết quả bài thi.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  const scoreOnTen = useMemo(() => {
    if (!review || review.total_questions === 0) return 0;
    return Number(((review.correct_count / review.total_questions) * 10).toFixed(1));
  }, [review]);

  const wrongCount = review ? review.total_questions - review.correct_count : 0;

  const details = useMemo(() => {
    if (!review) return [];
    if (filter === 'WRONG') return review.details.filter((d) => !d.is_correct);
    if (filter === 'CORRECT') return review.details.filter((d) => d.is_correct);
    return review.details;
  }, [review, filter]);

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-slate-500 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-medical-600" />
        <p className="text-sm">Đang tải kết quả bài thi...</p>
      </div>
    );
  }

  if (errorMessage || !review) {
    return (
      <div className="max-w-md mx-auto py-16 bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h3 className="font-bold text-slate-900">Không xem được bài thi</h3>
        <p className="text-xs text-slate-500 leading-relaxed">
          {errorMessage || 'Dữ liệu bài thi không khả dụng.'}
        </p>
        <button
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
        >
          Quay lại lịch sử
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 py-2">
      <button
        onClick={onBack}
        className="flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 transition"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Quay lại lịch sử</span>
      </button>

      <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-medical-600 to-sky-400 text-white flex items-center justify-center mx-auto mb-4 shadow-md">
          <Award className="w-8 h-8" />
        </div>

        <span className="text-xs font-bold uppercase tracking-wider text-medical-600 bg-medical-50 px-3 py-1 rounded-full">
          Kết Quả Đã Lưu Trên Máy Chủ
        </span>

        <div className="mt-3">
          <span className="text-5xl font-extrabold text-slate-900 tracking-tight">{scoreOnTen}</span>
          <span className="text-slate-400 font-semibold text-xl"> / 10 Điểm</span>
        </div>

        <p className="text-sm text-slate-500 mt-2 font-medium">
          Đúng {review.correct_count}/{review.total_questions} câu ({review.score_percentage}%)
        </p>

        {review.status === 'TIMED_OUT' && (
          <p className="text-xs text-rose-600 mt-1 font-bold">Bài thi kết thúc do hết thời gian.</p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-base">Đối Chiếu Đáp Án & Giải Thích Chi Tiết</h3>

          <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded-lg transition ${filter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
            >
              Tất cả ({review.details.length})
            </button>
            <button
              onClick={() => setFilter('WRONG')}
              className={`px-3 py-1 rounded-lg transition ${filter === 'WRONG' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600'}`}
            >
              Câu sai ({wrongCount})
            </button>
            <button
              onClick={() => setFilter('CORRECT')}
              className={`px-3 py-1 rounded-lg transition ${filter === 'CORRECT' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'}`}
            >
              Câu đúng ({review.correct_count})
            </button>
          </div>
        </div>

        {details.length === 0 ? (
          <p className="text-center text-xs text-slate-500 py-8">Không có câu hỏi nào khớp bộ lọc.</p>
        ) : (
          <div className="space-y-6">
            {details.map((detail, idx) => (
              <div
                key={detail.question_id}
                className={`p-5 rounded-2xl border ${
                  detail.is_correct ? 'border-emerald-200 bg-emerald-50/20' : 'border-rose-200 bg-rose-50/20'
                }`}
              >
                <div className="flex items-start justify-between">
                  <span className="font-bold text-sm text-slate-800">
                    Câu {idx + 1}: {detail.content}
                  </span>
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center space-x-1 flex-shrink-0 ml-3 ${
                      detail.is_correct ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                    }`}
                  >
                    {detail.is_correct ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                    <span>{detail.is_correct ? 'Chính xác' : 'Sai'}</span>
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {detail.options.map((opt) => {
                    const isUserChoice = detail.selected_option_id === opt.option_id;

                    let style = 'border-slate-200 bg-white text-slate-700';
                    if (opt.is_correct) style = 'border-emerald-400 bg-emerald-50 text-emerald-900 font-semibold';
                    else if (isUserChoice) style = 'border-rose-300 bg-rose-50 text-rose-900 line-through';

                    return (
                      <div
                        key={opt.option_id}
                        className={`p-2.5 rounded-xl border text-xs flex items-center space-x-2 ${style}`}
                      >
                        <span className="w-5 h-5 rounded font-bold flex items-center justify-center bg-white/80 border border-slate-200 flex-shrink-0">
                          {opt.label}
                        </span>
                        <span>{opt.content}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 p-3.5 rounded-xl bg-white border border-slate-200/80 text-xs text-slate-600">
                  <p className="font-bold text-slate-800 flex items-center space-x-1.5 mb-1">
                    <BookOpen className="w-3.5 h-3.5 text-medical-600" />
                    <span>Giải thích chi tiết:</span>
                  </p>
                  <p className="leading-relaxed">{detail.explanation}</p>
                  {detail.source_reference && (
                    <p className="text-[11px] text-slate-400 italic mt-1.5">
                      Căn cứ tài liệu: {detail.source_reference}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
