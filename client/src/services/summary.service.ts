import { UNAUTHORIZED_MESSAGE, withAuthHeaders } from './http';

export interface DocumentSummaryItem {
  id: string;
  title: string;
  subject_id: string | null;
  subject_name: string | null;
  summary: string;
  key_takeaways: unknown | null;
  source_filename: string | null;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSummaryPayload {
  title: string;
  summary: string;
  subjectName?: string;
  subject_name?: string;
  subjectId?: string;
  subject_id?: string;
  documentId?: string;
  document_id?: string;
  sourceFilename?: string;
  source_filename?: string;
  keyTakeaways?: unknown;
  key_takeaways?: unknown;
  wordCount?: number;
  word_count?: number;
}

export type CreateSummaryDto = CreateSummaryPayload;

export interface SummaryFilterParams {
  subjectId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export type SummaryFilterQuery = SummaryFilterParams;

const REQUEST_TIMEOUT_MS = 30 * 1000;

async function requestJson<T>(url: string, init: RequestInit, fallbackMessage: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
    throw new Error('Không kết nối được tới máy chủ. Kiểm tra kết nối mạng hoặc trạng thái máy chủ.');
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

export class SummaryService {
  /**
   * Lấy danh sách các bài học tóm tắt trong kho
   */
  static async list(params?: SummaryFilterParams): Promise<DocumentSummaryItem[]> {
    const searchParams = new URLSearchParams();
    if (params?.subjectId) {
      searchParams.set('subjectId', params.subjectId);
      searchParams.set('subject_id', params.subjectId);
    }
    if (params?.search) {
      searchParams.set('search', params.search);
    }
    if (params?.limit) {
      searchParams.set('limit', String(params.limit));
    }
    if (params?.offset) {
      searchParams.set('offset', String(params.offset));
    }

    const qs = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return requestJson<DocumentSummaryItem[]>(
      `/api/v1/summaries${qs}`,
      { method: 'GET' },
      'Không thể tải danh sách bài học tóm tắt'
    );
  }

  /**
   * Lấy chi tiết một bài tóm tắt theo ID
   */
  static async get(id: string): Promise<DocumentSummaryItem> {
    return requestJson<DocumentSummaryItem>(
      `/api/v1/summaries/${encodeURIComponent(id)}`,
      { method: 'GET' },
      'Không thể tải chi tiết bài học tóm tắt'
    );
  }

  /**
   * Lưu bài học tóm tắt mới vào CSDL
   */
  static async create(payload: CreateSummaryPayload): Promise<DocumentSummaryItem> {
    const computedWordCount =
      payload.wordCount ??
      payload.word_count ??
      (payload.summary ? payload.summary.trim().split(/\s+/).filter(Boolean).length : 0);

    const body = {
      title: payload.title,
      summary: payload.summary,
      subjectName: payload.subjectName || payload.subject_name,
      subject_name: payload.subjectName || payload.subject_name,
      subjectId: payload.subjectId || payload.subject_id,
      subject_id: payload.subjectId || payload.subject_id,
      documentId: payload.documentId || payload.document_id,
      document_id: payload.documentId || payload.document_id,
      sourceFilename: payload.sourceFilename || payload.source_filename,
      source_filename: payload.sourceFilename || payload.source_filename,
      keyTakeaways: payload.keyTakeaways ?? payload.key_takeaways,
      key_takeaways: payload.keyTakeaways ?? payload.key_takeaways,
      wordCount: computedWordCount,
      word_count: computedWordCount
    };

    return requestJson<DocumentSummaryItem>(
      '/api/v1/summaries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      'Không thể lưu bài học tóm tắt vào CSDL'
    );
  }

  /**
   * Xoá bài học tóm tắt theo ID
   */
  static async delete(id: string): Promise<void> {
    await requestJson<{ deleted?: boolean }>(
      `/api/v1/summaries/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      'Không thể xoá bài học tóm tắt'
    );
  }

  /**
   * Đường dẫn API xuất file Word (.docx)
   */
  static getDocxExportUrl(id: string): string {
    return `/api/v1/summaries/${encodeURIComponent(id)}/export/docx`;
  }

  /**
   * Đường dẫn API xem và in bản PDF
   */
  static getPdfExportUrl(id: string): string {
    return `/api/v1/summaries/${encodeURIComponent(id)}/export/pdf`;
  }

  /**
   * Tải tệp Word (.docx) trực tiếp (có header xác thực)
   */
  static async downloadDocx(id: string, fallbackFilename = 'Bai-hoc-tom-tat.docx'): Promise<void> {
    const response = await fetch(SummaryService.getDocxExportUrl(id), {
      headers: withAuthHeaders()
    });

    if (response.status === 401) throw new Error(UNAUTHORIZED_MESSAGE);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Không tải được file Word (Mã: ${response.status})`);
    }

    let filename = fallbackFilename;
    const disposition = response.headers.get('content-disposition');
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '').trim();
      }
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Mở giao diện xem/in ấn PDF trong tab mới
   */
  static async openPdfPrintView(id: string): Promise<void> {
    const response = await fetch(SummaryService.getPdfExportUrl(id), {
      headers: withAuthHeaders()
    });

    if (response.status === 401) throw new Error(UNAUTHORIZED_MESSAGE);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Không mở được bản in PDF (Mã: ${response.status})`);
    }

    const html = await response.text();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  // Alias methods để tương thích hoàn toàn với tất cả tài liệu thiết kế và đặc tả
  static getSummaries = SummaryService.list;
  static getSummaryById = SummaryService.get;
  static createSummary = SummaryService.create;
  static deleteSummary = SummaryService.delete;
  static getExportDocxUrl = SummaryService.getDocxExportUrl;
  static getExportPdfUrl = SummaryService.getPdfExportUrl;
}
