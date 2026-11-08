import React from 'react';
import { Check, X } from 'lucide-react';
import { AttemptQuestion } from '../../types/quiz.types';
import { AnswerResponse } from '../../types/quiz.types';

/**
 * Khu vực trả lời của MỘT câu hỏi, hiển thị theo đúng loại câu.
 *
 * Mọi loại đều gửi lên cùng một hình dạng `AnswerResponse`, server chấm theo loại.
 * Trạng thái `locked` = đã chấm xong (chế độ phản hồi tức thì) nên không cho sửa
 * và tô màu đúng/sai.
 */

interface QuestionAnswerPanelProps {
  question: AttemptQuestion;
  response: AnswerResponse;
  onChange: (next: AnswerResponse) => void;
  /** Đáp án đúng do server trả về sau khi chấm; null = chưa chấm */
  correctOptionIds: string[] | null;
  locked: boolean;
}

const LABEL_CLASS =
  'w-7 h-7 rounded-lg font-bold text-xs flex items-center justify-center flex-shrink-0 transition';

function optionStyle(args: {
  isSelected: boolean;
  isCorrectOption: boolean;
  showResult: boolean;
}): string {
  const { isSelected, isCorrectOption, showResult } = args;

  if (showResult) {
    if (isCorrectOption) return 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold';
    if (isSelected) return 'border-rose-400 bg-rose-50 text-rose-900';
    return 'border-slate-200 bg-white text-slate-500';
  }
  if (isSelected) {
    return 'border-medical-600 bg-medical-50/70 text-medical-950 font-semibold ring-1 ring-medical-600';
  }
  return 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700';
}

export const QuestionAnswerPanel: React.FC<QuestionAnswerPanelProps> = ({
  question,
  response,
  onChange,
  correctOptionIds,
  locked
}) => {
  const showResult = correctOptionIds !== null;
  const type = question.question_type;

  // ---------------------------------------------------------------
  // Nhiều đáp án đúng: hộp kiểm, phải chọn xong rồi mới chấm.
  // Không tự chấm khi bấm từng ô (sẽ chốt sớm khi người dùng chưa chọn xong).
  // ---------------------------------------------------------------
  if (type === 'MULTI_SELECT') {
    const selected = new Set(response.option_ids ?? []);
    return (
      <div className="mt-6 space-y-3">
        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
          Chọn tất cả đáp án đúng rồi bấm “Kiểm tra”
        </p>
        {question.options.map((opt) => {
          const isSelected = selected.has(opt.option_id);
          const isCorrectOption = correctOptionIds?.includes(opt.option_id) ?? false;
          return (
            <button
              key={opt.option_id}
              disabled={locked}
              onClick={() => {
                const next = new Set(selected);
                if (next.has(opt.option_id)) next.delete(opt.option_id);
                else next.add(opt.option_id);
                onChange({ option_ids: [...next] });
              }}
              className={`w-full p-4 rounded-xl border text-left flex items-center space-x-3 transition-all ${optionStyle(
                { isSelected, isCorrectOption, showResult }
              )}`}
            >
              <span
                className={`${LABEL_CLASS} rounded ${
                  isSelected ? 'bg-medical-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isSelected ? <Check className="w-4 h-4" /> : opt.label}
              </span>
              <span className="text-sm">{opt.content}</span>
              {showResult && isCorrectOption && <Check className="w-4 h-4 ml-auto text-emerald-600" />}
            </button>
          );
        })}
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Điền khuyết: gõ tự do. Thứ tự đáp án không có ý nghĩa nên ẩn danh sách lựa chọn.
  // ---------------------------------------------------------------
  if (type === 'FILL_BLANK') {
    const correctText = showResult
      ? question.options.find((o) => correctOptionIds?.includes(o.option_id))?.content
      : undefined;
    return (
      <div className="mt-6 space-y-2">
        <input
          type="text"
          value={response.text ?? ''}
          disabled={locked}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Nhập từ hoặc cụm từ còn thiếu..."
          className={`w-full px-4 py-3 rounded-xl border text-sm font-medium outline-none transition ${
            showResult
              ? response.option_ids?.length || correctOptionIds
                ? 'border-slate-300 bg-slate-50 text-slate-600'
                : 'border-slate-300'
              : 'border-slate-300 focus:border-medical-500 focus:ring-2 focus:ring-medical-100 text-slate-800'
          }`}
        />
        {showResult && correctText && (
          <p className="text-xs text-slate-600">
            Đáp án đúng: <strong className="text-emerald-700">{correctText}</strong>
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Ghép đôi: mỗi vế trái một dropdown chọn vế phải.
  // ---------------------------------------------------------------
  if (type === 'MATCHING') {
    const pairs = question.payload?.pairs ?? [];
    // Cột phải lấy từ payload, trộn thứ tự để không lộ cặp đúng theo vị trí.
    const rightItems = pairs.map((p) => ({ label: p.right_label, content: p.right }));
    const chosen = response.pairs ?? {};

    return (
      <div className="mt-6 space-y-3">
        {pairs.map((pair) => {
          const selectedRight = chosen[pair.left_label] ?? '';
          const isPairCorrect = showResult && selectedRight === pair.right_label;

          return (
            <div
              key={pair.left_label}
              className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-2 ${
                showResult
                  ? isPairCorrect
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : 'border-rose-300 bg-rose-50/50'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center space-x-2 flex-1">
                <span className={`${LABEL_CLASS} bg-slate-100 text-slate-600`}>{pair.left_label}</span>
                <span className="text-sm text-slate-800">{pair.left}</span>
              </div>

              <span className="text-slate-400 text-xs hidden sm:block">→</span>

              <select
                value={selectedRight}
                disabled={locked}
                onChange={(e) =>
                  onChange({ pairs: { ...chosen, [pair.left_label]: e.target.value } })
                }
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white text-slate-800 outline-none focus:border-medical-500"
              >
                <option value="">-- Chọn --</option>
                {rightItems.map((item) => (
                  <option key={item.label} value={item.label}>
                    {item.label}. {item.content}
                  </option>
                ))}
              </select>

              {showResult &&
                (isPairCorrect ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <X className="w-4 h-4 text-rose-600 flex-shrink-0" />
                ))}
            </div>
          );
        })}

        {showResult && (
          <p className="text-xs text-slate-600">
            Cặp đúng:{' '}
            {pairs.map((p) => `${p.left_label}–${p.right_label}`).join(', ')}
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Sắp xếp: bấm theo thứ tự đúng; bấm lại để bỏ.
  // ---------------------------------------------------------------
  if (type === 'ORDERING') {
    const currentOrder = response.order ?? [];
    return (
      <div className="mt-6 space-y-3">
        <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block">
          Bấm theo đúng thứ tự ({currentOrder.length}/{question.options.length} đã chọn)
        </p>

        {question.options.map((opt) => {
          const position = currentOrder.indexOf(opt.label);
          const isPicked = position >= 0;
          return (
            <button
              key={opt.option_id}
              disabled={locked}
              onClick={() => {
                const next = isPicked
                  ? currentOrder.filter((l) => l !== opt.label)
                  : [...currentOrder, opt.label];
                onChange({ order: next });
              }}
              className={`w-full p-4 rounded-xl border text-left flex items-center space-x-3 transition-all ${optionStyle(
                { isSelected: isPicked, isCorrectOption: false, showResult: false }
              )}`}
            >
              <span
                className={`${LABEL_CLASS} ${
                  isPicked ? 'bg-medical-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {isPicked ? position + 1 : opt.label}
              </span>
              <span className="text-sm">{opt.content}</span>
            </button>
          );
        })}

        {showResult && (
          <p className="text-xs text-slate-600">
            Thứ tự đúng:{' '}
            <strong className="text-emerald-700">
              {(question.payload?.correctOrder ?? []).join(' → ')}
            </strong>
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Likert: thang đánh giá, không có đáp án đúng.
  // ---------------------------------------------------------------
  if (type === 'LIKERT') {
    const scale = question.payload?.scale ?? [];
    return (
      <div className="mt-6 space-y-2">
        <p className="text-xs text-slate-500">Câu khảo sát — không tính điểm.</p>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {scale.map((level) => {
            const isSelected = response.level === level;
            return (
              <button
                key={level}
                disabled={locked}
                onClick={() => onChange({ level })}
                className={`p-3 rounded-xl border text-xs font-semibold transition text-center ${
                  isSelected
                    ? 'border-medical-600 bg-medical-50 text-medical-800 ring-1 ring-medical-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Mặc định: MCQ và TRUE_FALSE — chọn một phương án.
  // ---------------------------------------------------------------
  return (
    <div className="mt-6 space-y-3">
      {question.options.map((opt) => {
        const isSelected = response.option_id === opt.option_id;
        const isCorrectOption = correctOptionIds?.includes(opt.option_id) ?? false;
        return (
          <button
            key={opt.option_id}
            disabled={locked}
            onClick={() => onChange({ option_id: opt.option_id })}
            className={`w-full p-4 rounded-xl border text-left flex items-center space-x-3 transition-all ${optionStyle(
              { isSelected, isCorrectOption, showResult }
            )}`}
          >
            <span
              className={`${LABEL_CLASS} ${
                isSelected ? 'bg-medical-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {opt.label}
            </span>
            <span className="text-sm">{opt.content}</span>
            {showResult && isCorrectOption && <Check className="w-4 h-4 ml-auto text-emerald-600" />}
            {showResult && isSelected && !isCorrectOption && (
              <X className="w-4 h-4 ml-auto text-rose-600" />
            )}
          </button>
        );
      })}
    </div>
  );
};
