import React, { useCallback, useEffect, useState } from 'react';
import { StudyQuestionItem, StudyService } from '../../services/study.service';
import { Brain, AlertTriangle, Bookmark, Play, RotateCw, Loader2, CheckCircle2 } from 'lucide-react';

interface StudyHubProps {
  onStartQuiz: (quizId: string, subjectName: string) => void;
}

export const StudyHub: React.FC<StudyHubProps> = ({ onStartQuiz }) => {
  const [mistakes, setMistakes] = useState<StudyQuestionItem[]>([]);
  const [srsCards, setSrsCards] = useState<StudyQuestionItem[]>([]);
  const [bookmarks, setBookmarks] = useState<StudyQuestionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeMode, setActiveMode] = useState<'NONE' | 'FLASHCARD' | 'MISTAKES' | 'BOOKMARKS'>('NONE');
  const [cardIdx, setCardIdx] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isStartingPractice, setIsStartingPractice] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadStudyData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [m, s, b] = await Promise.all([
        StudyService.getMistakes(),
        StudyService.getSrsDue(),
        StudyService.getBookmarked()
      ]);
      setMistakes(m);
      setSrsCards(s);
      setBookmarks(b);
    } catch {
      // ignore initial load error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudyData();
  }, [loadStudyData]);

  const handlePracticeMistakes = async () => {
    setIsStartingPractice(true);
    setErrorMsg(null);
    try {
      const res = await StudyService.startMistakePractice();
      onStartQuiz(res.quiz.id, res.subject_name);
    } catch (err: any) {
      setErrorMsg(err.message || 'Không tạo được bài ôn tập câu sai.');
    } finally {
      setIsStartingPractice(false);
    }
  };

  const handleRateCard = async (quality: 0 | 3 | 4 | 5) => {
    const card = srsCards[cardIdx];
    if (!card) return;
    try {
      await StudyService.reviewSrsCard(card.question_id, quality);
      const remaining = srsCards.filter((_, i) => i !== cardIdx);
      setSrsCards(remaining);
      setShowAnswer(false);
      if (cardIdx >= remaining.length) setCardIdx(0);
    } catch (err: any) {
      setErrorMsg(err.message || 'Không lưu được đánh giá thẻ.');
    }
  };

  const currentCard = srsCards[cardIdx];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
            <Brain className="w-5 h-5 text-medical-600" />
            <span>Trung Tâm Ôn Tập Thông Minh (Active Recall & SRS)</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Tự động tổng hợp câu hay sai, thẻ Flashcard đến hạn và câu bạn đã đánh dấu
          </p>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-medical-600" />}
      </div>

      {errorMsg && (
        <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 1. Ngân hàng câu sai */}
        <div className="p-4 rounded-xl bg-rose-50/60 border border-rose-200/80 flex flex-col justify-between space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-rose-700 uppercase tracking-wide">Câu hay sai</p>
              <p className="text-2xl font-extrabold text-rose-900 mt-0.5">{mistakes.length}</p>
            </div>
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveMode((m) => (m === 'MISTAKES' ? 'NONE' : 'MISTAKES'))}
              disabled={mistakes.length === 0}
              className="flex-1 px-3 py-1.5 rounded-lg border border-rose-300 text-xs font-semibold text-rose-800 hover:bg-rose-100 disabled:opacity-50 transition"
            >
              Xem danh sách
            </button>
            <button
              onClick={() => void handlePracticeMistakes()}
              disabled={mistakes.length === 0 || isStartingPractice}
              className="flex-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 transition flex items-center justify-center space-x-1"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Luyện ngay</span>
            </button>
          </div>
        </div>

        {/* 2. Flashcard SRS đến hạn */}
        <div className="p-4 rounded-xl bg-sky-50/70 border border-sky-200/80 flex flex-col justify-between space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-sky-700 uppercase tracking-wide">Flashcard SRS đến hạn</p>
              <p className="text-2xl font-extrabold text-sky-900 mt-0.5">{srsCards.length}</p>
            </div>
            <RotateCw className="w-5 h-5 text-sky-500" />
          </div>
          <button
            onClick={() => {
              setCardIdx(0);
              setShowAnswer(false);
              setActiveMode((m) => (m === 'FLASHCARD' ? 'NONE' : 'FLASHCARD'));
            }}
            disabled={srsCards.length === 0}
            className="w-full px-3 py-1.5 rounded-lg bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold disabled:opacity-50 transition"
          >
            {activeMode === 'FLASHCARD' ? 'Đóng Flashcard' : 'Ôn thẻ Flashcard'}
          </button>
        </div>

        {/* 3. Đã đánh dấu & ghi chú */}
        <div className="p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 flex flex-col justify-between space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">Đã đánh dấu / Ghi chú</p>
              <p className="text-2xl font-extrabold text-amber-900 mt-0.5">{bookmarks.length}</p>
            </div>
            <Bookmark className="w-5 h-5 text-amber-500" />
          </div>
          <button
            onClick={() => setActiveMode((m) => (m === 'BOOKMARKS' ? 'NONE' : 'BOOKMARKS'))}
            disabled={bookmarks.length === 0}
            className="w-full px-3 py-1.5 rounded-lg border border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition"
          >
            {activeMode === 'BOOKMARKS' ? 'Đóng danh sách' : 'Xem câu đã lưu'}
          </button>
        </div>
      </div>

      {/* Flashcard Player */}
      {activeMode === 'FLASHCARD' && (
        <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
          {!currentCard ? (
            <div className="text-center py-6 space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-sm font-bold text-slate-800">Tuyệt vời! Bạn đã ôn hết thẻ đến hạn hôm nay.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-semibold text-medical-700">{currentCard.subject_name}</span>
                <span>
                  Thẻ {cardIdx + 1} / {srsCards.length}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900 leading-relaxed">{currentCard.content}</p>

              {!showAnswer ? (
                <button
                  onClick={() => setShowAnswer(true)}
                  className="w-full py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold transition"
                >
                  Lật xem đáp án & giải thích
                </button>
              ) : (
                <div className="space-y-3 pt-2 border-t border-slate-200">
                  <div className="space-y-1">
                    {currentCard.options
                      .filter((o) => o.is_correct)
                      .map((o) => (
                        <p key={o.option_id} className="text-xs font-bold text-emerald-700 bg-emerald-50 p-2 rounded-lg">
                          Đáp án đúng ({o.option_label}): {o.content}
                        </p>
                      ))}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">{currentCard.explanation}</p>
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    <button
                      onClick={() => void handleRateCard(0)}
                      className="py-2 rounded-lg bg-rose-100 hover:bg-rose-200 text-rose-800 text-xs font-bold"
                    >
                      Quên (Hôm nay)
                    </button>
                    <button
                      onClick={() => void handleRateCard(3)}
                      className="py-2 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold"
                    >
                      Khó
                    </button>
                    <button
                      onClick={() => void handleRateCard(4)}
                      className="py-2 rounded-lg bg-sky-100 hover:bg-sky-200 text-sky-800 text-xs font-bold"
                    >
                      Nhớ
                    </button>
                    <button
                      onClick={() => void handleRateCard(5)}
                      className="py-2 rounded-lg bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-xs font-bold"
                    >
                      Rất dễ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Danh sách câu hay sai / Đã đánh dấu */}
      {(activeMode === 'MISTAKES' || activeMode === 'BOOKMARKS') && (
        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {(activeMode === 'MISTAKES' ? mistakes : bookmarks).map((item) => (
            <div key={item.question_id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-medical-700">{item.subject_name}</span>
                {item.wrong_count ? (
                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">
                    Sai {item.wrong_count} lần
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-bold text-slate-900">{item.content}</p>
              <p className="text-xs text-emerald-700 font-medium">
                Đáp án: {item.options.filter((o) => o.is_correct).map((o) => o.content).join('; ')}
              </p>
              {item.personal_note && (
                <p className="text-xs text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                  Ghi chú: {item.personal_note}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
