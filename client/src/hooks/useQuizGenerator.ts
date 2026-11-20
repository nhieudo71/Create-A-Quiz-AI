import { useState, useCallback } from 'react';
import {
  GeneratorConfig,
  GenerationProgress,
  GeneratorStep,
  QuestionItem,
  UploadDocumentResponse
} from '../types/generator.types';
import { GeneratorService } from '../services/generator.service';
import { QuizService } from '../services/quiz.service';
import { SummaryService } from '../services/summary.service';
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
  const [documentSummary, setDocumentSummary] = useState<string | null>(null);
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);
  const [savedQuizId, setSavedQuizId] = useState<string | null>(null);
  const [isAutoSaved, setIsAutoSaved] = useState<boolean>(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedSummaryId, setSavedSummaryId] = useState<string | null>(null);
  const [isSummarySaved, setIsSummarySaved] = useState<boolean>(false);

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

      // Auto-save đề thi vào CSDL ngay khi sinh xong (Task 3)
      if (generated.length > 0) {
        try {
          const autoSaveTitle = `Đề thi ${config.subjectName} (${generated.length} câu) - ${new Date().toLocaleDateString('vi-VN')}`;
          const res = await QuizService.createQuiz({
            title: autoSaveTitle,
            subjectName: config.subjectName,
            mode: 'EXAM',
            questions: generated
          });
          if (res?.id) {
            setSavedQuizId(res.id);
            setIsAutoSaved(true);
            setSavedAt(new Date());
            toast.success(`Đã tự động lưu đề thi vào CSDL`, 'Tự động lưu');
          }
        } catch (saveErr: any) {
          console.error('Tự động lưu đề thi thất bại:', saveErr);
          toast.warning('Không thể tự động lưu đề thi vào CSDL. Bạn có thể lưu thủ công.', 'Tự động lưu');
        }
      }

      // Kích hoạt tóm tắt tài liệu tự động nếu rawText có văn bản (Task 2 & Task 4)
      if (rawText && rawText.trim().length > 0) {
        setIsSummarizing(true);
        GeneratorService.summarizeDocument(rawText, config.subjectName)
          .then(async (summary) => {
            setDocumentSummary(summary);
            toast.success('Đã hoàn thành tóm tắt kiến thức cốt lõi từ tài liệu!', 'Tóm tắt tài liệu');

            // Tự động lưu bài tóm tắt vào CSDL để xuất hiện ngay trong Kho Ôn Tập (Summary Study Hub)
            try {
              const defaultTitle = docData?.filename
                ? `Bài tóm tắt: ${docData.filename.replace(/\.[^/.]+$/, '')}`
                : `Bài tóm tắt: ${config.subjectName} - ${new Date().toLocaleDateString('vi-VN')}`;

              const wordCount = summary.trim().split(/\s+/).filter(Boolean).length;
              const saved = await SummaryService.create({
                title: defaultTitle,
                summary,
                subjectName: config.subjectName,
                documentId: docData?.id || undefined,
                sourceFilename: docData?.filename || selectedFile?.name || undefined,
                wordCount
              });

              if (saved?.id) {
                setSavedSummaryId(saved.id);
                setIsSummarySaved(true);
                toast.success('Đã tự động lưu bài tóm tắt vào Kho Ôn Tập!', 'Tự động lưu');
              }
            } catch (sumSaveErr: any) {
              console.error('Lỗi khi tự động lưu bài tóm tắt vào CSDL:', sumSaveErr);
            }
          })
          .catch((sumErr: any) => {
            console.error('Lỗi khi tóm tắt tài liệu:', sumErr);
          })
          .finally(() => {
            setIsSummarizing(false);
          });
      }
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
   * Nạp văn bản tóm tắt hoặc nội dung trực tiếp để tạo đề ngay (Active Recall)
   */
  const loadTextForGeneration = useCallback((text: string, subjectName?: string, sourceTitle?: string) => {
    setRawText(text);
    if (subjectName) {
      setConfig((prev) => ({ ...prev, subjectName }));
    }
    setDocData({
      id: 'summary-import',
      filename: sourceTitle ? `${sourceTitle}.txt` : 'bai-hoc-tom-tat.txt',
      page_count: 1,
      text_length: text.length,
      preview_text: text.slice(0, 500)
    });
    setDocumentSummary(text);
    setStep('CONFIG');
    setQuestions([]);
    setErrorMessage(null);
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
    setDocumentSummary(null);
    setIsSummarizing(false);
    setSavedQuizId(null);
    setIsAutoSaved(false);
    setSavedAt(null);
    setSavedSummaryId(null);
    setIsSummarySaved(false);
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
    documentSummary,
    setDocumentSummary,
    isSummarizing,
    savedQuizId,
    setSavedQuizId,
    isAutoSaved,
    setIsAutoSaved,
    savedAt,
    setSavedAt,
    savedSummaryId,
    setSavedSummaryId,
    isSummarySaved,
    setIsSummarySaved,
    loadTextForGeneration,
    handleUploadFile,
    handleUpdateConfig,
    handleStartGeneration,
    handleUpdateQuestion,
    handleDeleteQuestion,
    handleReset
  };
}
