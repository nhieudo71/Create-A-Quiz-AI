import React, { useState } from 'react';
import { GeneratorContainer } from './components/generator/GeneratorContainer';
import { useQuizGeneratorContext } from './context/QuizGeneratorContext';
import { ExamRoom } from './components/exam/ExamRoom';
import { QuizLibrary } from './components/exam/QuizLibrary';
import { AttemptReview } from './components/history/AttemptReview';
import { HistoryDashboard } from './components/history/HistoryDashboard';
import { SettingsPage } from './components/settings/SettingsPage';
import { QuizService } from './services/quiz.service';
import { Stethoscope, FileText, Clock, BookOpen, Sparkles, Play, Loader2, Settings } from 'lucide-react';
import { QuestionItem } from './types/generator.types';

// Đề mẫu Y khoa có sẵn để dùng thử ngay khi chưa có tài liệu
const SAMPLE_MEDICAL_QUESTIONS: QuestionItem[] = [
  {
    content:
      'Thuốc nào sau đây là kháng sinh thuộc nhóm Beta-lactam có cơ chế ức chế tổng hợp vách tế bào vi khuẩn?',
    difficulty: 'EASY',
    explanation:
      'Amoxicillin thuộc phân nhóm Aminopenicillin của họ Beta-lactam, gắn đặc hiệu vào PBPs ức chế tổng hợp peptidoglycan.',
    source_reference: 'Dược lý học lâm sàng - Bài 3: Kháng sinh',
    options: [
      { label: 'A', content: 'Amoxicillin', is_correct: true },
      { label: 'B', content: 'Gentamicin', is_correct: false },
      { label: 'C', content: 'Doxycycline', is_correct: false },
      { label: 'D', content: 'Ciprofloxacin', is_correct: false }
    ]
  },
  {
    content:
      'Cấu trúc giải phẫu nào sau đây ngăn cách tâm nhĩ phải và tâm thất phải ở tim người bình thường?',
    difficulty: 'EASY',
    explanation:
      'Van ba lá (Tricuspid valve) nằm giữa tâm nhĩ phải và tâm thất phải, đảm bảo dòng máu chỉ chảy một chiều từ nhĩ xuống thất.',
    source_reference: 'Giải phẫu học - Hệ tuần hoàn',
    options: [
      { label: 'A', content: 'Van hai lá', is_correct: false },
      { label: 'B', content: 'Van ba lá', is_correct: true },
      { label: 'C', content: 'Van động mạch chủ', is_correct: false },
      { label: 'D', content: 'Van động mạch phổi', is_correct: false }
    ]
  },
  {
    content:
      'Tác dụng phụ nguy hiểm nhất cần theo dõi sát khi sử dụng thuốc chống đông Heparin không phân đoạn là gì?',
    difficulty: 'MEDIUM',
    explanation:
      'HIT (Heparin-Induced Thrombocytopenia) - giảm tiểu cầu do heparin là biến chứng miễn dịch có thể gây huyết khối tắc mạch đe dọa tính mạng.',
    source_reference: 'Dược lý lâm sàng - Huyết học',
    options: [
      { label: 'A', content: 'Tăng huyết áp kịch phát', is_correct: false },
      { label: 'B', content: 'Giảm tiểu cầu do Heparin (HIT)', is_correct: true },
      { label: 'C', content: 'Suy thận cấp thể thiểu niệu', is_correct: false },
      { label: 'D', content: 'Tăng kali máu', is_correct: false }
    ]
  },
  {
    content: 'Trong sốc phản vệ độ II, thuốc đầu tay ưu tiên tiêm bắp ngay lập tức cho bệnh nhân là gì?',
    difficulty: 'EASY',
    explanation:
      'Adrenaline 1mg/1ml tiêm bắp ngay là chỉ định sống còn theo phác đồ cấp cứu sốc phản vệ của Bộ Y tế.',
    source_reference: 'Thông tư 51/2017/TT-BYT Hướng dẫn phòng, chẩn đoán và xử trí phản vệ',
    options: [
      { label: 'A', content: 'Methylprednisolone', is_correct: false },
      { label: 'B', content: 'Diphenhydramine', is_correct: false },
      { label: 'C', content: 'Adrenaline (Epinephrine)', is_correct: true },
      { label: 'D', content: 'Salbutamol khí dung', is_correct: false }
    ]
  },
  {
    content:
      'Bệnh nhân nam 62 tuổi, tiền sử đái tháo đường type 2 và tăng huyết áp. Nhóm thuốc hạ áp nào được ưu tiên lựa chọn để bảo vệ chức năng thận?',
    difficulty: 'MEDIUM',
    explanation:
      'Thuốc ức chế men chuyển (ACEi) hoặc ức chế thụ thể AT1 (ARB) có tác dụng giãn tiểu động mạch đi cầu thận, giảm áp lực lọc và làm chậm tiến triển bệnh thận đái tháo đường.',
    source_reference: 'Khuyến cáo KDIGO và ADA',
    options: [
      { label: 'A', content: 'Ức chế men chuyển (ACEi) / Chẹn thụ thể (ARB)', is_correct: true },
      { label: 'B', content: 'Chẹn kênh Canxi nhóm Dihydropyridine', is_correct: false },
      { label: 'C', content: 'Lợi tiểu quai Furosemide', is_correct: false },
      { label: 'D', content: 'Chẹn Beta giao cảm không chọn lọc', is_correct: false }
    ]
  }
];

type Tab = 'GENERATE' | 'EXAM' | 'HISTORY' | 'SETTINGS';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('GENERATE');

  // Tiến trình sinh câu hỏi nằm ở provider phía trên App nên vẫn chạy khi đổi tab.
  // Đọc ở đây để hiện chỉ báo trên thanh điều hướng.
  const { step: generatorStep, progress: generatorProgress } = useQuizGeneratorContext();
  const isGenerating = generatorStep === 'GENERATING';

  // Phiên thi đang mở (đề đã lưu trên server)
  const [activeQuizId, setActiveQuizId] = useState<string | null>(null);
  const [activeSubject, setActiveSubject] = useState<string>('Dược Lý & Nội Khoa');
  const [attemptKey, setAttemptKey] = useState<number>(0);
  const [isPreparingExam, setIsPreparingExam] = useState<boolean>(false);
  const [examError, setExamError] = useState<string | null>(null);

  // Xem lại một lượt thi trong quá khứ
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  // Đánh dấu khi Lịch sử cần tải lại (sau khi nộp bài)
  const [historyVersion, setHistoryVersion] = useState<number>(0);

  /**
   * Lưu đề lên server rồi mở phòng thi.
   * Bắt buộc phải qua server: câu hỏi/đáp án cần id thật để chấm điểm và chốt giờ.
   */
  const startExamWithQuestions = async (
    questions: QuestionItem[],
    subject: string,
    mode: 'PRACTICE' | 'EXAM' = 'EXAM'
  ) => {
    if (questions.length === 0) {
      setExamError('Bộ câu hỏi rỗng nên không thể tạo đề thi.');
      return;
    }

    setIsPreparingExam(true);
    setExamError(null);

    try {
      const quiz = await QuizService.createQuiz({
        title: `Bài thi ${subject} (${questions.length} câu)`,
        subjectName: subject,
        mode,
        questions
      });

      setActiveQuizId(quiz.id);
      setActiveSubject(subject);
      setReviewAttemptId(null);
      setAttemptKey((prev) => prev + 1);
      setActiveTab('EXAM');
    } catch (err: any) {
      setExamError(err.message || 'Không tạo được đề thi trên máy chủ.');
    } finally {
      setIsPreparingExam(false);
    }
  };

  const handleStartSampleExam = () => {
    void startExamWithQuestions(SAMPLE_MEDICAL_QUESTIONS, 'Dược Lý & Cấp Cứu Y Khoa (Đề Mẫu)');
  };

  /** Làm lại một đề đã có trên server: không cần tạo lại đề, chỉ mở lượt mới */
  const handleRetakeQuiz = (quizId: string, subject: string) => {
    setActiveQuizId(quizId);
    setActiveSubject(subject);
    setReviewAttemptId(null);
    setAttemptKey((prev) => prev + 1);
    setActiveTab('EXAM');
  };

  /** Mở một đề đã lưu từ Thư viện đề thi (danh mục theo môn học) */
  const handleStartLibraryQuiz = (quizId: string, subject: string) => {
    handleRetakeQuiz(quizId, subject);
  };

  const handleReviewAttempt = (attemptId: string) => {
    setReviewAttemptId(attemptId);
    setActiveQuizId(null);
    setActiveTab('HISTORY');
  };

  const goToTab = (tab: Tab) => {
    if (tab === 'EXAM') setReviewAttemptId(null);
    setActiveTab(tab);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div
            className="flex items-center space-x-3 cursor-pointer"
            onClick={() => goToTab('GENERATE')}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-medical-600 to-sky-400 text-white flex items-center justify-center shadow-sm">
              <Stethoscope className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-lg tracking-tight text-slate-900">
                  MedQuiz<span className="text-medical-600">.AI</span>
                </span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-medical-50 text-medical-700 border border-medical-200">
                  Medical EdTech
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                Tạo đề & Luyện thi trắc nghiệm Y khoa chuẩn Active Recall
              </p>
            </div>
          </div>

          <nav className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => goToTab('GENERATE')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'GENERATE'
                  ? 'bg-white text-medical-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Tạo Đề AI</span>
              {isGenerating && (
                <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-medical-100 text-medical-700 text-[10px] font-bold">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />
                  <span>{generatorProgress.percent}%</span>
                </span>
              )}
            </button>

            <button
              onClick={() => goToTab('EXAM')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'EXAM'
                  ? 'bg-white text-medical-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Phòng Thi</span>
            </button>

            <button
              onClick={() => goToTab('HISTORY')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'HISTORY'
                  ? 'bg-white text-medical-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Lịch Sử Thi</span>
            </button>

            <button
              onClick={() => goToTab('SETTINGS')}
              className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'SETTINGS'
                  ? 'bg-white text-medical-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Cài Đặt</span>
            </button>
          </nav>
        </div>
      </header>

      {examError && (
        <div className="max-w-6xl w-full mx-auto px-4 pt-4">
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center justify-between">
            <span>{examError}</span>
            <button onClick={() => setExamError(null)} className="text-rose-500 hover:text-rose-700 font-bold">
              Đóng
            </button>
          </div>
        </div>
      )}

      {isPreparingExam && (
        <div className="max-w-6xl w-full mx-auto px-4 pt-4">
          <div className="p-3 rounded-xl bg-medical-50 border border-medical-200 text-xs font-semibold text-medical-800 flex items-center space-x-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Đang lưu đề thi lên máy chủ...</span>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:py-8">
        {activeTab === 'GENERATE' && (
          <GeneratorContainer
            onStartExamRoom={(questions, subject, mode) =>
              void startExamWithQuestions(questions, subject, mode)
            }
          />
        )}

        {activeTab === 'EXAM' &&
          (activeQuizId ? (
            <ExamRoom
              quizId={activeQuizId}
              attemptKey={attemptKey}
              subjectName={activeSubject}
              onExit={() => setActiveQuizId(null)}
              onAttemptFinished={() => setHistoryVersion((v) => v + 1)}
            />
          ) : (
            <div className="bg-white rounded-3xl border border-slate-200 p-8 md:p-12 text-center max-w-2xl mx-auto shadow-sm space-y-6">
              <div className="w-20 h-20 rounded-3xl bg-medical-50 text-medical-600 flex items-center justify-center mx-auto shadow-inner">
                <Clock className="w-10 h-10" />
              </div>

              <div>
                <h2 className="text-2xl font-bold text-slate-900">Phòng Thi Trắc Nghiệm Y Khoa</h2>
                <p className="text-sm text-slate-500 mt-2 max-w-md mx-auto">
                  Đồng hồ đếm ngược, bảng câu hỏi đánh dấu cờ, tự động thu bài khi hết giờ. Điểm số và thời
                  gian nộp được chốt trên máy chủ nên không thể sửa trên trình duyệt.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-left text-xs text-slate-600 space-y-2 max-w-md mx-auto">
                <div className="flex items-center space-x-2 font-bold text-slate-700">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <span>Quy chế thi:</span>
                </div>
                <p>
                  • Đề AI sinh ra: <strong>30 phút đếm ngược</strong>.
                </p>
                <p>• Chế độ ôn tập: không giới hạn thời gian.</p>
                <p>• Mỗi câu có đúng 4 phương án, chỉ 1 đáp án chính xác.</p>
                <p>
                  • Đáp án và lời giải chỉ hiển thị sau khi bạn bấm <strong>Nộp bài</strong>.
                </p>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
                <button
                  onClick={() => goToTab('GENERATE')}
                  className="px-5 py-3 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  Tải slide để tạo đề riêng
                </button>
                <button
                  onClick={handleStartSampleExam}
                  disabled={isPreparingExam}
                  className="px-6 py-3 rounded-xl bg-medical-600 hover:bg-medical-700 active:bg-medical-800 disabled:opacity-60 text-white text-xs font-bold shadow-md hover:shadow-lg transition flex items-center justify-center space-x-2"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Vào thi thử ngay (Đề mẫu Y khoa)</span>
                </button>
              </div>
            </div>
          ))}

        {activeTab === 'EXAM' && !activeQuizId && (
          <div className="mt-8">
            <QuizLibrary onStartQuiz={handleStartLibraryQuiz} />
          </div>
        )}

        {activeTab === 'HISTORY' &&
          (reviewAttemptId ? (
            <AttemptReview
              attemptId={reviewAttemptId}
              onBack={() => {
                setReviewAttemptId(null);
                setActiveTab('HISTORY');
              }}
            />
          ) : (
            <HistoryDashboard
              refreshKey={historyVersion}
              onReviewPastAttempt={handleReviewAttempt}
              onRetakePastAttempt={handleRetakeQuiz}
              onGoToExamTab={() => goToTab('EXAM')}
            />
          ))}

        {activeTab === 'SETTINGS' && <SettingsPage />}
      </main>


      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400 bg-white">
        MedQuiz AI • Nền tảng ôn thi trắc nghiệm y khoa bám sát giáo trình & giảng đường
      </footer>
    </div>
  );
};
