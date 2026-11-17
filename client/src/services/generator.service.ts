import { GenerationProgress, QuestionItem, UploadDocumentResponse } from '../types/generator.types';
import { UNAUTHORIZED_MESSAGE, withAuthHeaders } from './http';

// File có thể lên tới 500MB: tải lên, trích xuất PDF và OCR scan đều có thể mất
// nhiều phút trên máy cục bộ. Timeout tính theo phút để không ném AbortError oan.
const UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
const GENERATE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * Gọi API và luôn trả lỗi thật cho người dùng.
 * Tuyệt đối KHÔNG sinh dữ liệu giả khi mất kết nối: đây là ứng dụng y khoa,
 * bộ câu hỏi mô phỏng có thể bị lưu và sử dụng nhầm như đề thật.
 */
async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: withAuthHeaders(init.headers),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
    }
    throw new Error('Không kết nối được tới máy chủ. Kiểm tra kết nối mạng hoặc việc khởi động Backend rồi thử lại.');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401) {
    throw new Error(UNAUTHORIZED_MESSAGE);
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error?.message || `${fallbackMessage} (Mã: ${response.status})`);
  }

  const json = await response.json().catch(() => null);
  if (!json || !json.success || json.data === undefined) {
    throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
  }
  return json.data as T;
}

export interface SavedDocumentSummary {
  id: string;
  original_filename: string;
  file_size_bytes: number;
  page_count: number;
  extracted_text_length: number;
  created_at: string;
}

export class GeneratorService {
  /**
   * Tải tài liệu PDF / DOCX lên máy chủ để trích xuất văn bản
   */
  static async uploadDocument(
    file: File,
    pageRange?: { fromPage?: number; toPage?: number }
  ): Promise<UploadDocumentResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const params = new URLSearchParams();
    if (pageRange?.fromPage) params.set('fromPage', String(pageRange.fromPage));
    if (pageRange?.toPage) params.set('toPage', String(pageRange.toPage));
    const qs = params.toString() ? `?${params.toString()}` : '';

    return requestJson<UploadDocumentResponse>(
      `/api/v1/documents/upload${qs}`,
      { method: 'POST', body: formData },
      UPLOAD_TIMEOUT_MS,
      'Lỗi máy chủ khi xử lý file'
    );
  }

  static async listSavedDocuments(): Promise<SavedDocumentSummary[]> {
    return requestJson<SavedDocumentSummary[]>(
      '/api/v1/documents',
      { method: 'GET' },
      30_000,
      'Không tải được danh sách tài liệu đã lưu'
    );
  }

  static async loadSavedDocument(id: string): Promise<UploadDocumentResponse> {
    return requestJson<UploadDocumentResponse>(
      `/api/v1/documents/${id}`,
      { method: 'GET' },
      30_000,
      'Không nạp được tài liệu'
    );
  }

  static async deleteSavedDocument(id: string): Promise<void> {
    await requestJson<{ deleted: boolean }>(
      `/api/v1/documents/${id}`,
      { method: 'DELETE' },
      30_000,
      'Không xoá được tài liệu'
    );
  }

  static async deepExplainQuestion(questionId: string): Promise<{ deep_explanation: string }> {
    return requestJson<{ deep_explanation: string }>(
      `/api/v1/questions/${questionId}/deep-explain`,
      { method: 'POST' },
      120_000,
      'Không tạo được giải thích chuyên sâu'
    );
  }

  /**
   * Gọi API sinh câu hỏi bằng AI
   */
  static async generateQuestions(params: {
    textContent: string;
    targetCount: number;
    subjectName: string;
    difficultyMode?: 'MIXED' | 'EASY' | 'HARD';
    questionTypes?: string[];
  }): Promise<QuestionItem[]> {
    const data = await requestJson<{ questions: QuestionItem[] }>(
      '/api/v1/questions/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text_content: params.textContent,
          target_count: params.targetCount,
          subject_name: params.subjectName,
          difficulty_mode: params.difficultyMode ?? 'MIXED',
          question_types: params.questionTypes ?? ['MCQ']
        })
      },
      GENERATE_TIMEOUT_MS,
      'Lỗi khi AI xử lý câu hỏi'
    );

    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error('AI không sinh được câu hỏi nào từ tài liệu này.');
    }
    return data.questions;
  }

  /**
   * Gọi API sinh câu hỏi bằng SSE để nhận tiến trình THẬT theo từng lô từ server.
   */
  static async generateQuestionsStream(
    params: {
      textContent: string;
      targetCount: number;
      subjectName: string;
      difficultyMode?: 'MIXED' | 'EASY' | 'HARD';
      questionTypes?: string[];
    },
    onProgress: (progress: GenerationProgress) => void
  ): Promise<QuestionItem[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GENERATE_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch('/api/v1/questions/generate?stream=true', {
        method: 'POST',
        headers: withAuthHeaders({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream'
        }),
        body: JSON.stringify({
          text_content: params.textContent,
          target_count: params.targetCount,
          subject_name: params.subjectName,
          difficulty_mode: params.difficultyMode ?? 'MIXED',
          question_types: params.questionTypes ?? ['MCQ']
        }),
        signal: controller.signal
      });
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new Error('Máy chủ phản hồi quá lâu. Vui lòng thử lại.');
      }
      throw new Error('Không kết nối được tới máy chủ. Kiểm tra kết nối hoặc việc khởi động Backend.');
    }

    try {
      if (response.status === 401) {
        throw new Error(UNAUTHORIZED_MESSAGE);
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || `Lỗi khi AI xử lý câu hỏi (Mã: ${response.status})`);
      }
      if (!response.body) {
        throw new Error('Trình duyệt không hỗ trợ đọc luồng tiến trình từ máy chủ.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let finalQuestions: QuestionItem[] | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          let eventName = 'message';
          const dataLines: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;

          const parsed = JSON.parse(dataLines.join('\n'));
          if (eventName === 'progress') {
            onProgress(parsed as GenerationProgress);
          } else if (eventName === 'result') {
            finalQuestions = parsed.questions as QuestionItem[];
          } else if (eventName === 'error') {
            throw new Error(parsed.message || 'Lỗi khi AI xử lý câu hỏi.');
          }
        }
      }

      if (!Array.isArray(finalQuestions) || finalQuestions.length === 0) {
        throw new Error('AI không sinh được câu hỏi nào từ tài liệu này.');
      }
      return finalQuestions;
    } finally {
      clearTimeout(timer);
    }
  }
}
