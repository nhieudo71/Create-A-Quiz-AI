import React from 'react';
import { GenerationProgress } from '../../types/generator.types';
import { Loader2, Sparkles, Brain, Timer } from 'lucide-react';
import { formatDuration } from '../../services/eta.service';

interface RealtimeProgressBarProps {
  progress: GenerationProgress;
  subjectName: string;
  /** Số giây đã trôi qua kể từ khi bắt đầu sinh câu hỏi */
  elapsedSeconds?: number;
  /** Ước lượng tổng thời gian cần thiết, tính bằng giây */
  estimatedSeconds?: number;
}

export const RealtimeProgressBar: React.FC<RealtimeProgressBarProps> = ({
  progress,
  subjectName,
  elapsedSeconds = 0,
  estimatedSeconds = 0
}) => {
  const remainingSeconds = Math.max(0, estimatedSeconds - elapsedSeconds);
  const isOverEstimate = estimatedSeconds > 0 && elapsedSeconds > estimatedSeconds;

  return (
    <div className="w-full max-w-xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
      {/* Icon trạng thái */}
      <div className="w-16 h-16 rounded-full bg-medical-50 text-medical-600 flex items-center justify-center mx-auto mb-4 relative">
        <Loader2 className="w-8 h-8 animate-spin" />
        <Sparkles className="w-4 h-4 text-amber-500 absolute top-2 right-2 animate-pulse" />
      </div>

      <h3 className="text-xl font-bold text-slate-800">
        AI Đang Biên Soạn Đề Thi {subjectName}
      </h3>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
        {progress.message || 'Hệ thống đang trích xuất thuật ngữ và xây dựng ngân hàng câu hỏi...'}
      </p>

      {/* Thanh tiến trình (Progress Bar) */}
      <div className="mt-6">
        <div className="flex justify-between items-center text-xs font-semibold text-slate-600 mb-2">
          <span>Tiến trình xử lý</span>
          <span className="text-medical-600 font-bold">{progress.percent}%</span>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-200/60">
          <div
            className="h-full bg-gradient-to-r from-medical-500 to-medical-600 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.max(5, progress.percent)}%` }}
          />
        </div>
        <div className="flex justify-between items-center text-xs text-slate-400 mt-2">
          <span>Khởi tạo</span>
          <span>
            {progress.current} / {progress.total} câu hỏi
          </span>
        </div>
      </div>

      {/* Đếm ngược thời gian dự kiến hoàn thành */}
      {estimatedSeconds > 0 && (
        <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-slate-600">
            <Timer className="w-4 h-4 text-medical-600" />
            <span className="text-xs font-semibold">
              {isOverEstimate ? 'Đang lâu hơn dự kiến' : 'Dự kiến hoàn thành sau'}
            </span>
          </div>
          <div className="text-right">
            <div className="text-base font-bold tabular-nums text-slate-800">
              {formatDuration(isOverEstimate ? elapsedSeconds - estimatedSeconds : remainingSeconds)}
            </div>
            <div className="text-[10px] text-slate-400 tabular-nums">
              Đã chạy {formatDuration(elapsedSeconds)}
              {!isOverEstimate && ` • tổng ~${formatDuration(estimatedSeconds)}`}
            </div>
          </div>
        </div>
      )}

      {/* Hộp mẹo ôn thi Y khoa (Medical Learning Tip) */}
      <div className="mt-8 p-4 rounded-xl bg-blue-50/60 border border-blue-100 text-left flex items-start space-x-3">
        <Brain className="w-5 h-5 text-medical-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-800">Mẹo ôn thi Y khoa hiệu quả:</p>
          <p>
            Phương pháp <strong>Active Recall</strong> (chủ động gợi nhớ qua trắc nghiệm) kết hợp đọc kỹ phần <strong>Giải thích cơ chế</strong> giúp tăng khả năng ghi nhớ dài hạn lên 300% so với chỉ đọc lại slide.
          </p>
        </div>
      </div>
    </div>
  );
};
