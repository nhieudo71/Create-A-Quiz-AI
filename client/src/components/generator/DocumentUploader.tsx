import React, { useRef, useState } from 'react';
import { UploadCloud, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { DOCUMENT_ACCEPT_ATTR, DOCUMENT_FORMAT_GROUPS } from '../../constants/documentFormats';
import { getMaxFileSizeMb } from '../../services/http';

interface DocumentUploaderProps {
  onFileSelected: (file: File) => void;
  isLoading: boolean;
  errorMessage: string | null;
}

export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  onFileSelected,
  isLoading,
  errorMessage
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      onFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelected(e.target.files[0]);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Tải Lên Tài Liệu Bài Giảng Y Khoa</h2>
        <p className="text-slate-500 mt-1">
          Hỗ trợ giáo trình, slide bài giảng, bảng tính và ảnh chụp tài liệu — tối đa {getMaxFileSizeMb()}MB
        </p>
      </div>

      {/* Vùng Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isLoading && fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200 ${
          isDragOver
            ? 'border-medical-500 bg-medical-50 scale-[1.01]'
            : 'border-slate-300 hover:border-medical-500 hover:bg-slate-50'
        } ${isLoading ? 'opacity-60 pointer-events-none' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={DOCUMENT_ACCEPT_ATTR}
          onChange={handleFileInputChange}
          className="hidden"
          disabled={isLoading}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-medical-50 text-medical-600 flex items-center justify-center">
            {isLoading ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : (
              <UploadCloud className="w-8 h-8" />
            )}
          </div>

          <div className="space-y-1">
            <p className="font-semibold text-slate-700">
              {isLoading ? 'Đang trích xuất văn bản tài liệu...' : 'Kéo thả file vào đây hoặc bấm để chọn'}
            </p>
            <p className="text-xs text-slate-400">Slide bài giảng, bảng tính, văn bản, ảnh chụp tài liệu...</p>
          </div>
        </div>
      </div>

      {/* Danh sách định dạng được hỗ trợ */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DOCUMENT_FORMAT_GROUPS.map((group) => (
          <div
            key={group.label}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-center"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {group.label}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-700">{group.extensions}</p>
          </div>
        ))}
      </div>

      {/* Thông báo lỗi nếu có */}
      {errorMessage && (
        <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200 flex items-center space-x-3 text-red-700 text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Gợi ý tính năng */}
      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center space-x-2 text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>Trích xuất thuật ngữ y học</span>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>Tự động chia batching 10-100 câu</span>
        </div>
        <div className="flex items-center space-x-2 text-xs text-slate-600 bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
          <span>Giải thích chi tiết theo tài liệu</span>
        </div>
      </div>
    </div>
  );
};
