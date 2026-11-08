import React, { useEffect, useRef, useState } from 'react';
import { Download, Upload, Loader2, AlertTriangle, DatabaseBackup, RefreshCw } from 'lucide-react';
import { BackupCounts } from '../../types/settings.types';
import { BackupService } from '../../services/backup.service';

const TABLE_LABELS: Record<string, string> = {
  subjects: 'Môn học',
  documents: 'Tài liệu đã tải lên',
  questions: 'Câu hỏi',
  question_options: 'Đáp án',
  quizzes: 'Đề thi',
  quiz_questions: 'Liên kết câu hỏi - đề thi',
  quiz_attempts: 'Lượt làm bài',
  attempt_answers: 'Câu trả lời đã nộp'
};

/**
 * Tab "Sao lưu dữ liệu": xuất toàn bộ môn học/câu hỏi/đề thi/lịch sử ra một tệp
 * .json, hoặc phục hồi từ một tệp đã xuất trước đó.
 *
 * Phục hồi là thao tác PHÁ HUỶ: xoá sạch dữ liệu hiện có trước khi nạp lại
 * (xem backup.service.ts phía server). Cảnh báo rõ ràng trước khi gọi API.
 */
export const BackupSettings: React.FC = () => {
  const [counts, setCounts] = useState<BackupCounts | null>(null);
  const [isLoadingCounts, setIsLoadingCounts] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pendingFile, setPendingFile] = useState<{ payload: unknown; preview: BackupCounts } | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCounts = async () => {
    setIsLoadingCounts(true);
    try {
      setCounts(await BackupService.getCounts());
    } catch (err: any) {
      setError(err?.message || 'Không tải được số liệu hiện có.');
    } finally {
      setIsLoadingCounts(false);
    }
  };

  useEffect(() => {
    void loadCounts();
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    try {
      await BackupService.downloadBackup();
      setNotice('Đã tải bản sao lưu xuống máy.');
    } catch (err: any) {
      setError(err?.message || 'Không xuất được bản sao lưu.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelected = async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const payload = await BackupService.readBackupFile(file);
      const preview = await BackupService.previewBackup(payload);
      setPendingFile({ payload, preview });
    } catch (err: any) {
      setError(err?.message || 'Tệp sao lưu không hợp lệ.');
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingFile) return;
    setIsRestoring(true);
    setError(null);
    try {
      await BackupService.restoreBackup(pendingFile.payload);
      setNotice('Phục hồi dữ liệu thành công.');
      setPendingFile(null);
      await loadCounts();
    } catch (err: any) {
      setError(err?.message || 'Không phục hồi được dữ liệu.');
    } finally {
      setIsRestoring(false);
    }
  };

  const totalCurrent = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold">
            Đóng
          </button>
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-emerald-600 hover:text-emerald-800 font-bold">
            Đóng
          </button>
        </div>
      )}

      {/* XUẤT */}
      <div className="rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <DatabaseBackup className="w-4 h-4 text-medical-600" /> Sao lưu dữ liệu
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Xuất toàn bộ môn học, câu hỏi, đề thi và lịch sử làm bài thành một tệp .json để lưu trữ
              hoặc chuyển sang máy khác. Khoá API trong tab Nhà cung cấp AI KHÔNG được bao gồm.
            </p>
          </div>
          <button
            onClick={() => void loadCounts()}
            title="Tải lại số liệu"
            className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 flex-shrink-0"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {isLoadingCounts ? (
            <Loader2 className="w-4 h-4 animate-spin text-slate-400 col-span-full" />
          ) : (
            Object.entries(counts ?? {}).map(([key, value]) => (
              <div key={key} className="rounded-xl bg-slate-50 border border-slate-200/80 px-3 py-2">
                <p className="text-slate-400">{TABLE_LABELS[key] ?? key}</p>
                <p className="font-bold text-slate-800">{value.toLocaleString()}</p>
              </div>
            ))
          )}
        </div>

        <button
          onClick={() => void handleExport()}
          disabled={isExporting || totalCurrent === 0}
          className="mt-4 px-4 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5"
        >
          {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Tải xuống bản sao lưu (.json)
        </button>
      </div>

      {/* PHỤC HỒI */}
      <div className="rounded-2xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
          <Upload className="w-4 h-4 text-medical-600" /> Phục hồi từ bản sao lưu
        </h3>
        <p className="text-xs text-rose-600 font-semibold mt-1 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          Phục hồi sẽ XOÁ TOÀN BỘ dữ liệu hiện có rồi nạp lại từ tệp đã chọn. Hành động không thể hoàn tác.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
            e.target.value = '';
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 text-xs font-bold hover:bg-slate-50 flex items-center gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" /> Chọn tệp sao lưu (.json)
        </button>

        {pendingFile && (
          <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-xs font-bold text-amber-900">Xem trước nội dung sẽ phục hồi:</p>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              {Object.entries(pendingFile.preview).map(([key, value]) => (
                <div key={key} className="rounded-lg bg-white border border-amber-200/80 px-2.5 py-1.5">
                  <p className="text-amber-700">{TABLE_LABELS[key] ?? key}</p>
                  <p className="font-bold text-amber-900">{value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setPendingFile(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-white"
              >
                Huỷ
              </button>
              <button
                onClick={() => void handleConfirmRestore()}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-60 flex items-center gap-1.5"
              >
                {isRestoring && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Xác nhận XOÁ & phục hồi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

