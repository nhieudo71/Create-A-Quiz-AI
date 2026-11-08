import { QuestionItem, UploadDocumentResponse } from '../types/generator.types';
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

export class GeneratorService {
  /**
   * Tải tài liệu PDF / DOCX lên máy chủ để trích xuất văn bản
   */
  static async uploadDocument(file: File): Promise<UploadDocumentResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return requestJson<UploadDocumentResponse>(
      '/api/v1/documents/upload',
      { method: 'POST', body: formData },
      UPLOAD_TIMEOUT_MS,
      'Lỗi máy chủ khi xử lý file'
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
}
