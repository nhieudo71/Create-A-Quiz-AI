import { useState, useCallback } from 'react';
import {
  GeneratorConfig,
  GenerationProgress,
  GeneratorStep,
  QuestionItem,
  UploadDocumentResponse
} from '../types/generator.types';
import { GeneratorService } from '../services/generator.service';
import { getMaxFileSizeMb } from '../services/http';
import { estimateGenerationSeconds, recordGenerationDuration } from '../services/eta.service';
import {
  DOCUMENT_FORMAT_GROUPS,
  hasSupportedExtension
} from '../constants/documentFormats';

const INITIAL_CONFIG: GeneratorConfig = {
  subjectName: 'Dược Lý Học',
  targetCount: 20,
  difficultyMode: 'MIXED',
  questionTypes: ['MCQ']
};

const INITIAL_PROGRESS: GenerationProgress = {
  current: 0,
  total: 20,
  percent: 0,
  status: 'IDLE',
  message: ''
};

export function useQuizGenerator() {
  const [step, setStep] = useState<GeneratorStep>('UPLOAD');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [docData, setDocData] = useState<UploadDocumentResponse | null>(null);
  const [rawText, setRawText] = useState<string>('');
  const [config, setConfig] = useState<GeneratorConfig>(INITIAL_CONFIG);
  const [progress, setProgress] = useState<GenerationProgress>(INITIAL_PROGRESS);
  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [estimatedSeconds, setEstimatedSeconds] = useState<number>(0);

  /**
   * Xử lý tải tài liệu lên
   */
  const handleUploadFile = useCallback(async (file: File) => {
    // 1. Kiểm tra dung lượng theo giới hạn máy chủ công bố (mặc định 500MB)
    const maxSizeMb = getMaxFileSizeMb();
    if (file.size > maxSizeMb * 1024 * 1024) {
      const actualMb = (file.size / 1024 / 1024).toFixed(1);
      setErrorMessage(
        `File ${actualMb}MB vượt quá giới hạn ${maxSizeMb}MB.`
      );
      return;
    }

    // 2. Kiểm tra định dạng (chỉ báo lỗi sớm; máy chủ vẫn tự nhận diện theo nội dung)
    if (!hasSupportedExtension(file.name)) {
      setErrorMessage(
        `Định dạng file không được hỗ trợ. Chấp nhận: ${DOCUMENT_FORMAT_GROUPS.map(
          (g) => g.extensions
        ).join(', ')}.`
      );
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage(null);
      setSelectedFile(file);

      const result = await GeneratorService.uploadDocument(file);
      setDocData(result);
      setRawText(result.preview_text || '');
      setStep('CONFIG');
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải file lên. Vui lòng thử lại.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Cập nhật cấu hình tạo đề
   */
  const handleUpdateConfig = useCallback((updates: Partial<GeneratorConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  /**
   * Kích hoạt tiến trình sinh câu hỏi
   */
  const handleStartGeneration = useCallback(async () => {
    if (!docData && !rawText) {
      setErrorMessage('Thiếu dữ liệu văn bản từ tài liệu.');
      return;
    }

    setStep('GENERATING');
    setIsLoading(true);
    setErrorMessage(null);

    const total = config.targetCount;
    const estimate = estimateGenerationSeconds(total);
    setEstimatedSeconds(estimate);
    setElapsedSeconds(0);

    setProgress({
      current: 0,
      total,
      percent: 5,
      status: 'PARSING',
      message: 'Đang tiền xử lý văn bản và phân tích thuật ngữ y khoa...'
    });

    // Khai báo ngoài try để luôn dọn được ở finally (tránh timer chạy tiếp khi lỗi)
    let progressTimer: ReturnType<typeof setInterval> | undefined;
    let clockTimer: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();

    try {
      clockTimer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      // Mô phỏng tiến trình mượt mà cho sinh viên theo dõi
      progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (prev.percent < 85) {
            const nextPercent = prev.percent + 15;
            const currentQuestions = Math.round((nextPercent / 100) * total);
            return {
              ...prev,
              percent: nextPercent,
              current: currentQuestions,
              status: 'GENERATING',
              message: `AI đang biên soạn câu hỏi (${currentQuestions}/${total} câu)...`
            };
          }
          return prev;
        });
      }, 1500);

      const generated = await GeneratorService.generateQuestions({
        textContent: rawText,
        targetCount: total,
        subjectName: config.subjectName,
        difficultyMode: config.difficultyMode,
        questionTypes: config.questionTypes
      });

      setProgress({
        current: generated.length,
        total: generated.length,
        percent: 100,
        status: 'COMPLETED',
        message: 'Hoàn tất sinh câu hỏi!'
      });

      setQuestions(generated);
      setStep('REVIEW');

      // Ghi nhận thời gian thật để các lần sau ước lượng chính xác hơn
      recordGenerationDuration(total, (Date.now() - startedAt) / 1000);
    } catch (err: any) {
      setProgress((prev) => ({ ...prev, status: 'FAILED' }));
      setErrorMessage(err.message || 'Lỗi khi gọi AI. Vui lòng kiểm tra lại cấu hình.');
      setStep('CONFIG');
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (clockTimer) clearInterval(clockTimer);
      setIsLoading(false);
    }
  }, [docData, rawText, config]);

  /**
   * Cập nhật 1 câu hỏi trong danh sách Review
   */
  const handleUpdateQuestion = useCallback((index: number, updated: QuestionItem) => {
    setQuestions((prev) => {
      const next = [...prev];
      next[index] = updated;
      return next;
    });
  }, []);

  /**
   * Xóa 1 câu hỏi không phù hợp khỏi bộ đề
   */
  const handleDeleteQuestion = useCallback((index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Đặt lại toàn bộ tiến trình
   */
  const handleReset = useCallback(() => {
    setStep('UPLOAD');
    setSelectedFile(null);
    setDocData(null);
    setRawText('');
    setQuestions([]);
    setErrorMessage(null);
    setElapsedSeconds(0);
    setEstimatedSeconds(0);
    setProgress(INITIAL_PROGRESS);
  }, []);

  return {
    step,
    setStep,
    selectedFile,
    docData,
    config,
    progress,
    questions,
    isLoading,
    errorMessage,
    setErrorMessage,
    elapsedSeconds,
    estimatedSeconds,
    handleUploadFile,
    handleUpdateConfig,
    handleStartGeneration,
    handleUpdateQuestion,
    handleDeleteQuestion,
    handleReset
  };
}
