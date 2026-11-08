import React from 'react';
import {
  GeneratorConfig,
  UploadDocumentResponse,
  QuestionType,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_HINTS
} from '../../types/generator.types';
import { FileText, Sparkles, ArrowLeft, Layers, Check } from 'lucide-react';

interface GenerationConfigProps {
  docData: UploadDocumentResponse;
  config: GeneratorConfig;
  onUpdateConfig: (updates: Partial<GeneratorConfig>) => void;
  onStartGeneration: () => void;
  onBack: () => void;
}

const PRESET_COUNTS = [10, 20, 35, 50, 100];

const ALL_QUESTION_TYPES: QuestionType[] = [
  'MCQ',
  'MULTI_SELECT',
  'TRUE_FALSE',
  'FILL_BLANK',
  'MATCHING',
  'ORDERING',
  'LIKERT'
];

export const GenerationConfigView: React.FC<GenerationConfigProps> = ({
  docData,
  config,
  onUpdateConfig,
  onStartGeneration,
  onBack
}) => {
  const selectedTypes = config.questionTypes ?? ['MCQ'];

  const toggleType = (type: QuestionType) => {
    const isSelected = selectedTypes.includes(type);
    // Giữ ít nhất 1 loại: bỏ hết thì không sinh được câu nào.
    if (isSelected && selectedTypes.length === 1) return;
    const next = isSelected
      ? selectedTypes.filter((t) => t !== type)
      : [...selectedTypes, type];
    onUpdateConfig({ questionTypes: next });
  };

  return (
    <div className="w-full max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
      {/* Nút quay lại & Tiêu đề */}
      <div className="flex items-center justify-between pb-6 border-b border-slate-100">
        <button
          onClick={onBack}
          className="flex items-center space-x-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Chọn tài liệu khác</span>
        </button>
        <span className="text-xs px-2.5 py-1 rounded-full bg-medical-50 text-medical-700 font-medium">
          Bước 2: Cấu hình đề thi
        </span>
      </div>

      {/* Thông tin tài liệu đã nhận diện */}
      <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-lg bg-red-100 text-red-600 flex items-center justify-center flex-shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm truncate max-w-xs md:max-w-md">
              {docData.filename}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {docData.page_count > 0 ? `${docData.page_count} trang • ` : ''}
              {docData.text_length.toLocaleString()} ký tự đã trích xuất
            </p>
          </div>
        </div>
      </div>

      {/* Form cấu hình */}
      <div className="mt-6 space-y-6">
        {/* 1. Môn học */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">
            Tên môn học / Chuyên khoa
          </label>
          <input
            type="text"
            value={config.subjectName}
            onChange={(e) => onUpdateConfig({ subjectName: e.target.value })}
            placeholder="Ví dụ: Dược Lý Học, Giải Phẫu Bệnh, Nội Khoa..."
            className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:border-medical-500 focus:ring-2 focus:ring-medical-100 outline-none transition text-sm text-slate-800 font-medium"
          />
        </div>

        {/* 2. Chọn số lượng câu hỏi sinh ra (10, 20, 35, 50, 100) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">
              Số lượng câu hỏi cần tạo
            </label>
            <span className="text-xs text-slate-500">
              Đang chọn: <strong className="text-medical-600 font-bold">{config.targetCount} câu</strong>
            </span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {PRESET_COUNTS.map((count) => {
              const isSelected = config.targetCount === count;
              return (
                <button
                  key={count}
                  type="button"
                  onClick={() => onUpdateConfig({ targetCount: count })}
                  className={`py-2.5 px-3 rounded-xl text-sm font-semibold border transition-all text-center ${
                    isSelected
                      ? 'border-medical-600 bg-medical-50 text-medical-700 shadow-sm ring-1 ring-medical-600'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {count} câu
                </button>
              );
            })}
          </div>

          {config.targetCount >= 50 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center space-x-1">
              <Layers className="w-3.5 h-3.5 flex-shrink-0" />
              <span>
                Với số lượng {config.targetCount} câu, hệ thống sẽ tự động kích hoạt xử lý theo đợt (Batching) để bảo đảm chất lượng.
              </span>
            </p>
          )}
        </div>

        {/* 3. Loại câu hỏi */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">Dạng câu hỏi</label>
            <span className="text-xs text-slate-500">
              Đã chọn: <strong className="text-medical-600 font-bold">{selectedTypes.length} dạng</strong>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_QUESTION_TYPES.map((type) => {
              const isSelected = selectedTypes.includes(type);
              const isOnly = isSelected && selectedTypes.length === 1;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  disabled={isOnly}
                  title={isOnly ? 'Phải giữ ít nhất một dạng câu hỏi' : undefined}
                  className={`p-3 rounded-xl border text-left transition flex items-start space-x-2.5 ${
                    isSelected
                      ? 'border-medical-600 bg-medical-50/60 ring-1 ring-medical-600'
                      : 'border-slate-200 hover:bg-slate-50'
                  } ${isOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      isSelected ? 'bg-medical-600 border-medical-600 text-white' : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <Check className="w-3 h-3" />}
                  </span>
                  <span>
                    <span
                      className={`block text-xs font-bold ${
                        isSelected ? 'text-medical-900' : 'text-slate-700'
                      }`}
                    >
                      {QUESTION_TYPE_LABELS[type]}
                    </span>
                    <span className="block text-[11px] text-slate-500 mt-0.5">
                      {QUESTION_TYPE_HINTS[type]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selectedTypes.length > 1 && (
            <p className="text-xs text-slate-500 mt-2">
              Câu hỏi sẽ được chia đều cho {selectedTypes.length} dạng đã chọn.
            </p>
          )}
        </div>

        {/* 4. Phân bổ độ khó */}
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">
            Độ khó mong muốn
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: 'MIXED', label: 'Hỗn hợp chuẩn (30% Dễ - 50% TB - 20% Khó)' },
              { id: 'EASY', label: 'Củng cố cơ bản (Nhiều câu nhận biết)' },
              { id: 'HARD', label: 'Lâm sàng nâng cao (Case tình huống & chẩn đoán)' }
            ].map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => onUpdateConfig({ difficultyMode: mode.id as any })}
                className={`p-3 text-left rounded-xl border text-xs leading-relaxed transition ${
                  config.difficultyMode === mode.id
                    ? 'border-medical-600 bg-medical-50/50 text-medical-900 font-medium ring-1 ring-medical-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Nút Kích hoạt */}
      <div className="mt-8 pt-6 border-t border-slate-100">
        <button
          onClick={onStartGeneration}
          className="w-full py-3.5 px-6 rounded-xl bg-medical-600 hover:bg-medical-700 active:bg-medical-800 text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center space-x-2"
        >
          <Sparkles className="w-4 h-4" />
          <span>Bắt đầu tạo {config.targetCount} câu hỏi với AI</span>
        </button>
      </div>
    </div>
  );
};
