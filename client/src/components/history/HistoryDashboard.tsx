import React, { useState, useEffect, useMemo } from 'react';
import { QuizService } from '../../services/quiz.service';
import { HistoryEntry } from '../../types/quiz.types';
import {
  Award,
  CheckCircle,
  Clock,
  Play,
  TrendingUp,
  BookOpen,
  Calendar,
  Loader2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';

interface HistoryDashboardProps {
  /** Tăng mỗi khi có bài nộp mới để buộc tải lại danh sách */
  refreshKey?: number;
  onReviewPastAttempt: (attemptId: string) => void;
  onRetakePastAttempt: (quizId: string, subject: string) => void;
  onGoToExamTab: () => void;
}

/**
 * Lịch sử thi đọc từ CSDL trên máy chủ (thay cho localStorage trước đây).
 * Nhờ vậy lịch sử không mất khi xóa dữ liệu trình duyệt và điểm luôn là điểm
 * do server chấm.
 */
export const HistoryDashboard: React.FC<HistoryDashboardProps> = ({
  refreshKey = 0,
  onReviewPastAttempt,
  onRetakePastAttempt,
  onGoToExamTab
}) => {
  const [attempts, setAttempts] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const list = await QuizService.getHistory();
      setAttempts(list);
    } catch (err: any) {
      setErrorMessage(err.message || 'Không tải được lịch sử thi.');
      setAttempts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey]);

  // Chỉ tính thống kê trên các lượt đã nộp (bỏ lượt đang làm dở)
  const finished = useMemo(() => attempts.filter((a) => a.status !== 'IN_PROGRESS'), [attempts]);

  const stats = useMemo(() => {
    if (finished.length === 0) {
      return { totalAttempts: 0, averageScore: 0, averagePercentage: 0, bestScore: 0, totalQuestions: 0 };
    }

    let sumScore = 0;
    let sumPercentage = 0;
    let bestScore = 0;
    let totalQuestions = 0;

    for (const a of finished) {
      // Điểm thang 10 lấy từ tỉ lệ đúng server trả về, không tin số điểm client tự tính
      const scoreOnTen =
        a.total_questions > 0 ? (a.correct_count / a.total_questions) * 10 : 0;
      sumScore += scoreOnTen;
      sumPercentage += a.score_percentage;
      if (scoreOnTen > bestScore) bestScore = scoreOnTen;
      totalQuestions += a.total_questions;
    }

    return {
      totalAttempts: finished.length,
      averageScore: Number((sumScore / finished.length).toFixed(1)),
      averagePercentage: Math.round(sumPercentage / finished.length),
      bestScore: Number(bestScore.toFixed(1)),
      totalQuestions
    };
  }, [finished]);

  const formatSeconds = (sec: number) => {
    const safe = Math.max(0, Math.round(sec));
    const m = Math.floor(safe / 60);
    const s = safe % 60;
    return `${m}p ${s.toString().padStart(2, '0')}s`;
  };

  const formatDate = (isoString: string) => {
    const d = new Date(isoString);
    return `${d.toLocaleDateString('vi-VN')} lúc ${d.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit'
    })}`;
  };

  const scoreOnTen = (entry: HistoryEntry) =>
    entry.total_questions > 0 ? Number(((entry.correct_count / entry.total_questions) * 10).toFixed(1)) : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Lịch Sử Thi & Thống Kê Năng Lực Y Khoa</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Kết quả được lưu trên máy chủ — theo dõi tiến bộ và xem lại mọi lời giải chi tiết
          </p>
        </div>

        <button
          onClick={() => void loadData()}
          className="text-xs text-slate-500 hover:text-medical-600 transition self-start sm:self-auto flex items-center space-x-1"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Tải lại</span>
        </button>
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading && attempts.length === 0 && (
        <div className="py-16 text-center text-slate-500 space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-medical-600" />
          <p className="text-sm">Đang tải lịch sử thi...</p>
        </div>
      )}

      {!isLoading && !errorMessage && finished.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Lượt thi đã làm</p>
              <p className="text-2xl font-bold text-slate-900">{stats.totalAttempts}</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
              <Award className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Điểm trung bình</p>
              <p className="text-2xl font-bold text-slate-900">
                {stats.averageScore} <span className="text-xs font-normal text-slate-400">/ 10</span>
              </p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Tỷ lệ đúng TB</p>
              <p className="text-2xl font-bold text-slate-900">{stats.averagePercentage}%</p>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-sm flex items-center space-x-4">
            <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs text-slate-400 font-medium">Điểm cao nhất</p>
              <p className="text-2xl font-bold text-slate-900">
                {stats.bestScore} <span className="text-xs font-normal text-slate-400">/ 10</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {!isLoading && attempts.length === 0 && !errorMessage ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center max-w-lg mx-auto shadow-sm space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-medical-50 text-medical-600 flex items-center justify-center mx-auto">
            <BookOpen className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">Chưa Có Dữ Liệu Lần Thi Nào</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
              Khi bạn hoàn thành một bài thi, điểm số và toàn bộ đáp án chi tiết sẽ được lưu trên máy chủ và
              hiển thị tại đây.
            </p>
          </div>
          <button
            onClick={onGoToExamTab}
            className="px-5 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold shadow-sm transition inline-flex items-center space-x-1.5"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Vào Thi Thử Ngay</span>
          </button>
        </div>
      ) : null}

      {attempts.length > 0 && (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-800">
              Danh Sách Các Bài Thi ({attempts.length})
            </h3>
            <span className="text-xs text-slate-400">Bấm vào từng bài để xem lại giải thích chi tiết</span>
          </div>

          <div className="divide-y divide-slate-100">
            {attempts.map((record) => {
              const score = scoreOnTen(record);
              const isHigh = score >= 8;
              const isMedium = score >= 5 && score < 8;
              const isInProgress = record.status === 'IN_PROGRESS';

              return (
                <div
                  key={record.attempt_id}
                  className="p-5 hover:bg-slate-50/80 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div
                    className={`space-y-1.5 flex-1 ${isInProgress ? '' : 'cursor-pointer'}`}
                    onClick={() => !isInProgress && onReviewPastAttempt(record.attempt_id)}
                  >
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="text-xs px-2.5 py-0.5 rounded-md font-bold bg-medical-50 text-medical-700 border border-medical-200">
                        {record.mode === 'EXAM' ? 'Thi thử' : 'Ôn tập'}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center space-x-1">
                        <Calendar className="w-3 h-3" />
                        <span>{formatDate(record.started_at)}</span>
                      </span>
                      {record.status === 'TIMED_OUT' && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          Hết giờ
                        </span>
                      )}
                      {isInProgress && (
                        <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Đang làm
                        </span>
                      )}
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm md:text-base">{record.quiz_title}</h4>

                    <div className="flex items-center space-x-4 text-xs text-slate-500">
                      <span className="flex items-center space-x-1">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                        <span>
                          Đúng {record.correct_count}/{record.total_questions} câu
                        </span>
                      </span>
                      {record.submitted_at && (
                        <span className="flex items-center space-x-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            {formatSeconds(
                              (new Date(record.submitted_at).getTime() -
                                new Date(record.started_at).getTime()) /
                                1000
                            )}
                          </span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 self-end md:self-auto">
                    {!isInProgress && (
                      <div
                        className={`px-4 py-2 rounded-2xl text-center border font-bold text-sm ${
                          isHigh
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : isMedium
                            ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}
                      >
                        <div className="text-base leading-none font-extrabold">{score}</div>
                        <div className="text-[10px] uppercase tracking-wider font-semibold opacity-75 mt-0.5">
                          {record.score_percentage}%
                        </div>
                      </div>
                    )}

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReviewPastAttempt(record.attempt_id);
                        }}
                        className="px-3 py-2 rounded-xl text-slate-500 hover:text-medical-600 hover:bg-medical-50 transition text-xs font-semibold"
                        title="Xem lại đáp án"
                      >
                        Xem lại
                      </button>

                      {!isInProgress && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            // Làm lại đề đã lưu: mở lượt thi mới cho cùng quiz_id
                            onRetakePastAttempt(record.quiz_id, record.quiz_title);
                          }}
                          className="p-2 rounded-xl text-slate-500 hover:text-medical-600 hover:bg-medical-50 transition"
                          title="Làm lại đề này"
                        >
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
