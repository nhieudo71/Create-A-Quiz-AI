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
import { SettingsService } from '../services/settings.service';
import { toast } from '../context/ToastContext';
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
      toast.success(`Đã trích xuất ${result.text_length.toLocaleString()} ký tự từ "${result.filename}".`, 'Tải tài liệu thành công');
    } catch (err: any) {
      const msg = err.message || 'Không thể tải file lên. Vui lòng thử lại.';
      setErrorMessage(msg);
      toast.error(msg, 'Lỗi tải tài liệu');
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
      const msg = 'Thiếu dữ liệu văn bản từ tài liệu.';
      setErrorMessage(msg);
      toast.error(msg);
      return;
    }

    // Kiểm tra nhanh cấu hình AI trước khi chạy để báo rõ nếu chưa nhập API Key
    try {
      const settings = await SettingsService.getSettings();
      const active = settings.providers.find((p) => p.id === settings.ai.activeProviderId);
      if (active) {
        const meta = settings.providerMeta[active.type];
        if (meta?.requiresApiKey && !active.hasApiKey) {
          const msg = `Nhà cung cấp "${active.label}" chưa có API Key. Vui lòng vào tab Cài Đặt để nhập API Key trước khi tạo đề.`;
          setErrorMessage(msg);
          toast.error(msg, 'Chưa nhập API Key');
          return;
        }
      }
    } catch {
      // Nếu không đọc được cài đặt thì để server kiểm tra tiếp
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

    let clockTimer: ReturnType<typeof setInterval> | undefined;
    const startedAt = Date.now();

    try {
      clockTimer = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);

      const generated = await GeneratorService.generateQuestionsStream(
        {
          textContent: rawText,
          targetCount: total,
          subjectName: config.subjectName,
          difficultyMode: config.difficultyMode,
          questionTypes: config.questionTypes
        },
        (realProgress) => {
          setProgress(realProgress);
        }
      );

      setProgress({
        current: generated.length,
        total: generated.length,
        percent: 100,
        status: 'COMPLETED',
        message: 'Hoàn tất sinh câu hỏi!'
      });

      setQuestions(generated);
      setStep('REVIEW');
      toast.success(`AI đã biên soạn xong ${generated.length} câu hỏi!`, 'Tạo đề thành công');

      // Ghi nhận thời gian thật để các lần sau ước lượng chính xác hơn
      recordGenerationDuration(total, (Date.now() - startedAt) / 1000);
    } catch (err: any) {
      setProgress((prev) => ({ ...prev, status: 'FAILED' }));
      const msg = err.message || 'Lỗi khi gọi AI. Vui lòng kiểm tra lại cấu hình.';
      setErrorMessage(msg);
      const isMissingKey = /api key|chưa cấu hình nhà cung cấp|401|403/i.test(msg);
      toast.error(msg, isMissingKey ? 'Chưa nhập hoặc sai API Key' : 'Lỗi tạo đề AI');
      setStep('CONFIG');
    } finally {
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
