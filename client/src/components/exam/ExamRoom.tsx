import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { QuizService } from '../../services/quiz.service';
import {
  StartAttemptResponse,
  SubmitAttemptResponse,
  ReviewAttemptResponse,
  AttemptQuestion,
  AnswerResponse,
  CheckAnswerResponse
} from '../../types/quiz.types';
import { QuestionAnswerPanel } from './QuestionAnswerPanel';
import { QUESTION_TYPE_LABELS } from '../../types/generator.types';
import {
  Clock,
  Flag,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Award,
  RotateCcw,
  Check,
  X,
  Loader2,
  Lightbulb
} from 'lucide-react';

interface ExamRoomProps {
  quizId: string;
  subjectName: string;
  /** Lần thử mới -> buộc tải lại lượt thi khi "Làm lại đề" */
  attemptKey?: number;
  onExit: () => void;
  onAttemptFinished?: () => void;
}

/** Câu trả lời xong ngay khi bấm nên chấm tự động; loại khác cần bấm "Kiểm tra". */
const AUTO_CHECK_TYPES = new Set(['MCQ', 'TRUE_FALSE', 'LIKERT']);

export const ExamRoom: React.FC<ExamRoomProps> = ({
  quizId,
  subjectName,
  attemptKey = 0,
  onExit,
  onAttemptFinished
}) => {
  const [attempt, setAttempt] = useState<StartAttemptResponse | null>(null);
  const [result, setResult] = useState<SubmitAttemptResponse | null>(null);
  const [review, setReview] = useState<ReviewAttemptResponse | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  // question_id -> câu trả lời dạng chung cho mọi loại câu hỏi
  const [answers, setAnswers] = useState<Record<string, AnswerResponse>>({});
  // question_id -> kết quả chấm tức thì (chỉ khi instant_feedback bật)
  const [checks, setChecks] = useState<Record<string, CheckAnswerResponse>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<'ALL' | 'WRONG' | 'CORRECT'>('ALL');

  const [isBooting, setIsBooting] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hasSubmittedRef = useRef(false);

  const bootAttempt = useCallback(async () => {
    const data = await QuizService.startAttempt(quizId);
    setAttempt(data);
    setAnswers({});
    setChecks({});
    setFlagged(new Set());
    setCurrentIdx(0);
    setTimeLeft(
      data.expires_at
        ? Math.max(0, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000))
        : data.time_limit_seconds
    );
    return data;
  }, [quizId]);

  // ---------------------------------------------------------------------
  // Khởi động lượt thi
  // ---------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsBooting(true);
      setErrorMessage(null);
      hasSubmittedRef.current = false;

      try {
        await bootAttempt();
        if (cancelled) return;
        setResult(null);
        setReview(null);
      } catch (err: any) {
        if (!cancelled) setErrorMessage(err.message || 'Không bắt đầu được lượt thi.');
      } finally {
        if (!cancelled) setIsBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootAttempt, attemptKey]);

  // ---------------------------------------------------------------------
  // Nộp bài (điểm do server chấm)
  // ---------------------------------------------------------------------
  const submitExam = useCallback(
    async (autoSubmitted = false) => {
      if (!attempt || hasSubmittedRef.current) return;
      hasSubmittedRef.current = true;

      setIsSubmitting(true);
      setShowConfirmModal(false);

      try {
        const payload = attempt.questions.map((q) => ({
          question_id: q.question_id,
          selected_option_id: answers[q.question_id]?.option_id ?? null,
          response: answers[q.question_id] ?? null
        }));

        const submitResult = await QuizService.submitAttempt(attempt.attempt_id, payload);
        setResult(submitResult);

        try {
          const reviewData = await QuizService.reviewAttempt(attempt.attempt_id);
          setReview(reviewData);
        } catch {
          setReview(null);
        }

        if (autoSubmitted) {
          setErrorMessage('Đã hết giờ làm bài. Hệ thống đã tự động thu bài.');
        }
        onAttemptFinished?.();
      } catch (err: any) {
        hasSubmittedRef.current = false;
        setErrorMessage(err.message || 'Không nộp được bài. Vui lòng thử lại.');
        if (autoSubmitted) setShowConfirmModal(true);
      } finally {
        setIsSubmitting(false);
      }
    },
    [attempt, answers, onAttemptFinished]
  );

  // ---------------------------------------------------------------------
  // Đếm ngược
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!attempt || result || timeLeft <= 0) return;
    if (!attempt.expires_at) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          void submitExam(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [attempt, result, timeLeft, submitExam]);

  const formatTime = (seconds: number) => {
    const safe = Math.max(0, seconds);
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  /** Chấm một câu và lưu kết quả để hiển thị đúng/sai + giải thích. */
  const runCheck = useCallback(
    async (questionId: string, response: AnswerResponse) => {
      if (!attempt || !attempt.instant_feedback) return;
      setCheckingId(questionId);
      try {
        const result = await QuizService.checkAnswer(attempt.attempt_id, questionId, response);
        setChecks((prev) => ({ ...prev, [questionId]: result }));
      } catch {
        // Chấm tức thì lỗi không được chặn việc làm bài: người dùng vẫn nộp được,
        // điểm chính thức vẫn do server chấm khi nộp.
        setChecks((prev) => {
          const next = { ...prev };
          delete next[questionId];
          return next;
        });
      } finally {
        setCheckingId(null);
      }
    },
    [attempt]
  );

  const handleAnswerChange = useCallback(
    (question: AttemptQuestion, next: AnswerResponse) => {
      if (result) return;
      // Đã chấm tức thì thì khoá câu đó, không cho đổi nữa.
      if (checks[question.question_id]) return;

      setAnswers((prev) => ({ ...prev, [question.question_id]: next }));

      if (AUTO_CHECK_TYPES.has(question.question_type)) {
        void runCheck(question.question_id, next);
      }
    },
    [result, checks, runCheck]
  );

  const toggleFlag = (questionId: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  };

  const questions = attempt?.questions ?? [];
  const currentQ: AttemptQuestion | undefined = questions[currentIdx];
  const answeredCount = Object.keys(answers).filter((id) => {
    const r = answers[id];
    return Boolean(
      r.option_id || r.text?.trim() || r.level || r.option_ids?.length || r.order?.length
    );
  }).length;
  const unansweredCount = questions.length - answeredCount;
  const isTimeCritical = timeLeft > 0 && timeLeft < 300;
  const hasTimeLimit = Boolean(attempt?.expires_at);

  const scoreOnTen = useMemo(() => {
    if (!result || result.total_questions === 0) return 0;
    return Number(((result.correct_count / result.total_questions) * 10).toFixed(1));
  }, [result]);

  const wrongCount = result ? result.total_questions - result.correct_count : 0;

  const filteredDetails = useMemo(() => {
    if (!review) return [];
    if (reviewFilter === 'WRONG') return review.details.filter((d) => !d.is_correct);
    if (reviewFilter === 'CORRECT') return review.details.filter((d) => d.is_correct);
    return review.details;
  }, [review, reviewFilter]);

  if (isBooting) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center text-slate-500 space-y-3">
        <Loader2 className="w-8 h-8 animate-spin mx-auto text-medical-600" />
        <p className="text-sm">Đang chuẩn bị đề thi từ máy chủ...</p>
      </div>
    );
  }

  if (errorMessage && !attempt) {
    return (
      <div className="max-w-md mx-auto py-16 bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-4 shadow-sm">
        <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-7 h-7" />
        </div>
        <h3 className="font-bold text-slate-900">Không mở được phòng thi</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{errorMessage}</p>
        <button
          onClick={onExit}
          className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold"
        >
          Quay lại
        </button>
      </div>
    );
  }

  if (!attempt) return null;

  // ---------------------------------------------------------------------
  // MÀN HÌNH KẾT QUẢ
  // ---------------------------------------------------------------------
  if (result) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 py-4">
        {errorMessage && (
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 text-center">
            {errorMessage}
          </div>
        )}

        <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200 shadow-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-medical-600 to-sky-400 text-white flex items-center justify-center mx-auto mb-4 shadow-md">
            <Award className="w-8 h-8" />
          </div>

          <span className="text-xs font-bold uppercase tracking-wider text-medical-600 bg-medical-50 px-3 py-1 rounded-full">
            Kết Quả Bài Thi • {subjectName}
          </span>

          <div className="mt-3">
            <span className="text-5xl font-extrabold text-slate-900 tracking-tight">{scoreOnTen}</span>
            <span className="text-slate-400 font-semibold text-xl"> / 10 Điểm</span>
          </div>

          <p className="text-sm text-slate-500 mt-2 font-medium">
            Đúng {result.correct_count}/{result.total_questions} câu ({result.score_percentage}%) • Thời gian làm
            bài: {formatTime(result.time_spent_seconds)}
          </p>

          {result.unanswered_count > 0 && (
            <p className="text-xs text-amber-600 mt-1 font-medium">
              Bạn bỏ trống {result.unanswered_count} câu.
            </p>
          )}

          {result.status === 'TIMED_OUT' && (
            <p className="text-xs text-rose-600 mt-1 font-bold">
              Bài thi kết thúc do hết thời gian quy định.
            </p>
          )}

          <p className="text-[11px] text-slate-400 mt-2">
            Điểm số được chấm và lưu trên máy chủ.
          </p>

          <div className="mt-6 flex justify-center space-x-3">
            <button
              onClick={onExit}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 transition"
            >
              Về Trang Chủ
            </button>
            <button
              onClick={() => {
                hasSubmittedRef.current = false;
                setResult(null);
                setReview(null);
                setErrorMessage(null);
                setIsBooting(true);
                void (async () => {
                  try {
                    await bootAttempt();
                  } catch (err: any) {
                    setErrorMessage(err.message || 'Không bắt đầu lại được lượt thi.');
                  } finally {
                    setIsBooting(false);
                  }
                })();
              }}
              className="px-5 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold shadow-sm transition flex items-center space-x-1.5"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Làm Lại Đề Này</span>
            </button>
          </div>
        </div>

        {review ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-base">Đối Chiếu Đáp Án & Giải Thích Chi Tiết</h3>

              <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setReviewFilter('ALL')}
                  className={`px-3 py-1 rounded-lg transition ${reviewFilter === 'ALL' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
                >
                  Tất cả ({review.details.length})
                </button>
                <button
                  onClick={() => setReviewFilter('WRONG')}
                  className={`px-3 py-1 rounded-lg transition ${reviewFilter === 'WRONG' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600'}`}
                >
                  Câu sai ({wrongCount})
                </button>
                <button
                  onClick={() => setReviewFilter('CORRECT')}
                  className={`px-3 py-1 rounded-lg transition ${reviewFilter === 'CORRECT' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600'}`}
                >
                  Câu đúng ({result.correct_count})
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {filteredDetails.map((detail, idx) => (
                <div
                  key={detail.question_id}
                  className={`p-5 rounded-2xl border ${
                    detail.is_correct ? 'border-emerald-200 bg-emerald-50/20' : 'border-rose-200 bg-rose-50/20'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {QUESTION_TYPE_LABELS[detail.question_type]}
                      </span>
                      <p className="font-bold text-sm text-slate-800 mt-0.5">
                        Câu {idx + 1}: {detail.content}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center space-x-1 flex-shrink-0 ml-3 ${
                        detail.is_correct ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {detail.is_correct ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      <span>{detail.is_correct ? 'Chính xác' : 'Sai'}</span>
                    </span>
                  </div>

                  <ReviewAnswerBlock detail={detail} />

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
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-xs text-slate-500">
            Không tải được phần đối chiếu đáp án. Xem lại chi tiết trong tab "Lịch Sử Thi".
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // MÀN HÌNH LÀM BÀI
  // ---------------------------------------------------------------------
  const currentResponse: AnswerResponse = currentQ ? answers[currentQ.question_id] ?? {} : {};
  const currentCheck: CheckAnswerResponse | undefined = currentQ ? checks[currentQ.question_id] : undefined;
  const isCurrentLocked = Boolean(currentCheck);
  const canSubmitCheck =
    currentQ &&
    !currentCheck &&
    !AUTO_CHECK_TYPES.has(currentQ.question_type) &&
    (Boolean(currentResponse.option_ids?.length) ||
      Boolean(currentResponse.text?.trim()) ||
      Boolean(currentResponse.order?.length) ||
      Boolean(currentResponse.pairs && Object.keys(currentResponse.pairs).length === 4));

  return (
    <div className="max-w-5xl mx-auto space-y-4 py-2">
      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 text-center">
          {errorMessage}
        </div>
      )}

      <div className="sticky top-20 z-40 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/90 shadow-sm p-4 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-medical-700 bg-medical-50 px-2.5 py-0.5 rounded-md">
            Phòng Thi: {subjectName}
          </span>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Câu {currentIdx + 1} / {questions.length} • Đã làm: {answeredCount}/{questions.length}
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {hasTimeLimit ? (
            <div
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl font-mono text-sm font-bold border transition ${
                isTimeCritical
                  ? 'bg-rose-50 border-rose-300 text-rose-600 animate-pulse'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatTime(timeLeft)}</span>
            </div>
          ) : (
            <span className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
              Không giới hạn thời gian
            </span>
          )}

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl bg-medical-600 hover:bg-medical-700 active:bg-medical-800 disabled:opacity-60 text-white font-bold text-xs shadow-sm transition flex items-center space-x-1.5"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{isSubmitting ? 'Đang nộp...' : 'Nộp Bài'}</span>
          </button>
        </div>
      </div>

      {currentQ && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm flex flex-col justify-between min-h-[420px]">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-slate-500">CÂU HỎI SỐ {currentIdx + 1}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-medical-700 bg-medical-50 px-2 py-0.5 rounded">
                    {QUESTION_TYPE_LABELS[currentQ.question_type]}
                  </span>
                </div>

                <button
                  onClick={() => toggleFlag(currentQ.question_id)}
                  className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition ${
                    flagged.has(currentQ.question_id)
                      ? 'border-amber-400 bg-amber-50 text-amber-800'
                      : 'border-slate-200 text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Flag className="w-3.5 h-3.5" />
                  <span>{flagged.has(currentQ.question_id) ? 'Đã đánh dấu cờ' : 'Đánh dấu xem lại'}</span>
                </button>
              </div>

              <h3 className="text-base md:text-lg font-bold text-slate-900 mt-4 leading-relaxed">
                {currentQ.content}
              </h3>

              <QuestionAnswerPanel
                question={currentQ}
                response={currentResponse}
                onChange={(next) => handleAnswerChange(currentQ, next)}
                correctOptionIds={currentCheck ? currentCheck.correct_option_ids : null}
                locked={isCurrentLocked || Boolean(result)}
              />

              {/* Nút kiểm tra cho loại cần chọn nhiều bước */}
              {!AUTO_CHECK_TYPES.has(currentQ.question_type) && !currentCheck && (
                <button
                  onClick={() => void runCheck(currentQ.question_id, currentResponse)}
                  disabled={!canSubmitCheck || checkingId === currentQ.question_id}
                  className="mt-4 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold transition flex items-center space-x-1.5"
                >
                  {checkingId === currentQ.question_id && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Kiểm tra đáp án</span>
                </button>
              )}

              {checkingId === currentQ.question_id && AUTO_CHECK_TYPES.has(currentQ.question_type) && (
                <p className="mt-4 text-xs text-slate-400 flex items-center space-x-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang chấm...</span>
                </p>
              )}

              {/* Phản hồi tức thì */}
              {currentCheck && (
                <div
                  className={`mt-5 p-4 rounded-xl border ${
                    currentCheck.is_correct
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-rose-50 border-rose-200'
                  }`}
                >
                  <p
                    className={`font-bold text-sm flex items-center space-x-1.5 ${
                      currentCheck.is_correct ? 'text-emerald-800' : 'text-rose-800'
                    }`}
                  >
                    {currentCheck.is_correct ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    <span>{currentCheck.is_correct ? 'Chính xác!' : 'Chưa đúng'}</span>
                  </p>

                  {currentQ.question_type !== 'LIKERT' && (
                    <div className="mt-2 text-xs text-slate-700 leading-relaxed flex items-start space-x-1.5">
                      <Lightbulb className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <span>{currentCheck.explanation}</span>
                    </div>
                  )}

                  {currentCheck.source_reference && (
                    <p className="text-[11px] text-slate-500 italic mt-1.5">
                      Căn cứ: {currentCheck.source_reference}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-6 border-t border-slate-100 mt-8">
              <button
                onClick={() => setCurrentIdx((prev) => Math.max(0, prev - 1))}
                disabled={currentIdx === 0}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Câu trước</span>
              </button>

              <button
                onClick={() => setCurrentIdx((prev) => Math.min(questions.length - 1, prev + 1))}
                disabled={currentIdx === questions.length - 1}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Câu kế tiếp</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">Danh Sách Câu Hỏi</h4>
              <span className="text-[11px] text-slate-400">
                {answeredCount}/{questions.length} đã chọn
              </span>
            </div>

            <div className="grid grid-cols-5 gap-2 max-h-[380px] overflow-y-auto pr-1">
              {questions.map((q, idx) => {
                const isAnswered = Boolean(answers[q.question_id]);
                const isCurrent = currentIdx === idx;
                const isFlag = flagged.has(q.question_id);
                const check = checks[q.question_id];

                let btnStyle = 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100';
                if (check) {
                  btnStyle = check.is_correct
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold'
                    : 'border-rose-400 bg-rose-50 text-rose-800 font-bold';
                } else if (isAnswered) {
                  btnStyle = 'border-emerald-500 bg-emerald-50 text-emerald-800 font-bold';
                }
                if (isCurrent) btnStyle += ' ring-2 ring-medical-600 ring-offset-1 font-extrabold';

                return (
                  <button
                    key={q.question_id}
                    onClick={() => setCurrentIdx(idx)}
                    className={`h-9 rounded-lg text-xs font-medium border relative transition flex items-center justify-center ${btnStyle}`}
                  >
                    {idx + 1}
                    {isFlag && <span className="w-2 h-2 rounded-full bg-amber-500 absolute top-1 right-1" />}
                  </button>
                );
              })}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-400" />
                <span>Đúng / đã trả lời</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded bg-rose-100 border border-rose-400" />
                <span>Đã trả lời (sai)</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded bg-slate-100 border border-slate-200" />
                <span>Chưa làm</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3 h-3 rounded bg-amber-400" />
                <span>Đánh dấu xem lại</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-100 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="font-bold text-slate-900 text-lg">Bạn có chắc muốn nộp bài?</h3>
              {unansweredCount > 0 ? (
                <p className="text-xs text-amber-600 mt-2 font-medium bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  Cảnh báo: Bạn còn <strong>{unansweredCount}</strong> câu chưa chọn đáp án. Các câu chưa làm sẽ
                  bị tính là sai.
                </p>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  Bạn đã hoàn thành đủ {questions.length}/{questions.length} câu hỏi.
                </p>
              )}
              <p className="text-[11px] text-slate-400 mt-2">
                Bài đã nộp không thể sửa lại. Điểm sẽ được chấm ngay trên máy chủ.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                className="py-2.5 rounded-xl border border-slate-200 font-semibold text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Tiếp tục làm bài
              </button>
              <button
                onClick={() => void submitExam(false)}
                disabled={isSubmitting}
                className="py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 font-bold text-xs text-white shadow-sm disabled:opacity-60 flex items-center justify-center space-x-1.5"
              >
                {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSubmitting ? 'Đang nộp...' : 'Xác nhận nộp bài'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Khối hiển thị đáp án trong màn xem lại, theo từng loại câu hỏi.
 * Tách riêng để phần thân màn kết quả không phình quá mức đọc được.
 */
const ReviewAnswerBlock: React.FC<{ detail: ReviewAttemptResponse['details'][number] }> = ({ detail }) => {
  const type = detail.question_type;

  if (type === 'MATCHING') {
    const pairs = detail.payload?.pairs ?? [];
    return (
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {pairs.map((pair) => (
          <div
            key={pair.left_label}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-xs flex items-center space-x-2"
          >
            <span className="w-5 h-5 rounded font-bold flex items-center justify-center bg-slate-100 text-slate-600 flex-shrink-0">
              {pair.left_label}
            </span>
            <span className="text-slate-800">{pair.left}</span>
            <span className="text-slate-400">→</span>
            <span className="text-emerald-700 font-semibold">
              {pair.right_label}. {pair.right}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'ORDERING') {
    const order = detail.payload?.correctOrder ?? [];
    const byLabel = new Map(detail.options.map((o) => [o.label, o.content]));
    return (
      <div className="mt-4 p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 text-xs">
        <p className="font-bold text-emerald-800 mb-1.5">Thứ tự đúng:</p>
        <ol className="space-y-1 list-decimal list-inside text-slate-800">
          {order.map((label) => (
            <li key={label}>{byLabel.get(label) ?? label}</li>
          ))}
        </ol>
      </div>
    );
  }

  if (type === 'LIKERT') {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Câu khảo sát (không tính điểm). Mức đã chọn:{' '}
        <strong>{detail.response ? JSON.parse(detail.response).level ?? '—' : '—'}</strong>
      </p>
    );
  }

  if (type === 'FILL_BLANK') {
    const answer = detail.options.find((o) => o.is_correct)?.content;
    let typed = '';
    try {
      typed = detail.response ? JSON.parse(detail.response).text ?? '' : '';
    } catch {
      typed = '';
    }
    return (
      <div className="mt-4 p-3 rounded-xl border border-slate-200 bg-white text-xs space-y-1">
        <p className="text-slate-600">
          Bạn đã điền: <strong className={detail.is_correct ? 'text-emerald-700' : 'text-rose-700'}>{typed || '(bỏ trống)'}</strong>
        </p>
        <p className="text-slate-600">
          Đáp án đúng: <strong className="text-emerald-700">{answer}</strong>
        </p>
      </div>
    );
  }

  // MCQ / MULTI_SELECT / TRUE_FALSE
  // MULTI_SELECT lưu nhiều lựa chọn trong response.option_ids, nên phải đọc thêm
  // chứ không chỉ dựa vào selected_option_id (chỉ giữ được một).
  const chosenIds = new Set<string>();
  if (detail.selected_option_id) chosenIds.add(detail.selected_option_id);
  if (detail.response) {
    try {
      const parsed = JSON.parse(detail.response) as { option_id?: string; option_ids?: string[] };
      if (parsed.option_id) chosenIds.add(parsed.option_id);
      for (const id of parsed.option_ids ?? []) chosenIds.add(id);
    } catch {
      // response cũ dạng chuỗi thường: bỏ qua, đã có selected_option_id
    }
  }

  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
      {detail.options.map((opt) => {
        const isUserChoice = chosenIds.has(opt.option_id);

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
  );
};
