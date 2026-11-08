import React, { useEffect, useState } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import {
  CreateProviderInput,
  ProviderMeta,
  ProviderType,
  PublicProvider,
  UpdateProviderInput
} from '../../types/settings.types';

interface ProviderFormModalProps {
  providerMeta: Record<ProviderType, ProviderMeta>;
  editing: PublicProvider | null;
  onClose: () => void;
  onCreate: (input: CreateProviderInput) => Promise<void>;
  onUpdate: (id: string, input: UpdateProviderInput) => Promise<void>;
}

const ORDERED_TYPES: ProviderType[] = ['gemini', 'openai', 'anthropic', 'openai-compatible', 'local', 'chatgpt-oauth'];

export const ProviderFormModal: React.FC<ProviderFormModalProps> = ({
  providerMeta,
  editing,
  onClose,
  onCreate,
  onUpdate
}) => {
  const [type, setType] = useState<ProviderType>(editing?.type ?? 'gemini');
  const meta = providerMeta[type];

  const [label, setLabel] = useState(editing?.label ?? meta.label);
  const [model, setModel] = useState(editing?.model ?? meta.defaultModel);
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? meta.defaultBaseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) return;
    setLabel(meta.label);
    setModel(meta.defaultModel);
    setBaseUrl(meta.defaultBaseUrl ?? '');
  }, [type, editing, meta]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (editing) {
        await onUpdate(editing.id, {
          label,
          model,
          baseUrl: meta.requiresBaseUrl || baseUrl ? baseUrl : null,
          apiKey: apiKey === '' ? undefined : apiKey
        });
      } else {
        await onCreate({ type, label, model, baseUrl: baseUrl || null, apiKey: apiKey || null });
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold text-slate-900 text-sm">
            {editing ? `Sửa nhà cung cấp "${editing.label}"` : 'Thêm nhà cung cấp AI'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {!editing && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Nguồn AI</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ProviderType)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100"
              >
                {ORDERED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {providerMeta[t].label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {meta.warning && (
            <div className="flex items-start space-x-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{meta.warning}</span>
            </div>
          )}

          <p className="text-xs text-slate-500 -mt-1">{meta.hint}</p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Tên hiển thị</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={80}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100"
            />
          </div>

          {type !== 'chatgpt-oauth' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Model</label>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={meta.defaultModel}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100"
              />
            </div>
          )}

          {(meta.requiresBaseUrl || type === 'local' || type === 'anthropic' || type === 'openai') && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Địa chỉ máy chủ (baseUrl){meta.requiresBaseUrl ? '' : ' — tuỳ chọn'}
              </label>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={meta.defaultBaseUrl ?? ''}
                required={meta.requiresBaseUrl}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100 font-mono"
              />
            </div>
          )}

          {type !== 'chatgpt-oauth' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Khoá API{meta.requiresApiKey ? '' : ' — tuỳ chọn'}
                {editing?.hasApiKey && (
                  <span className="text-slate-400 font-normal"> (đang có khoá, để trống để giữ nguyên)</span>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editing?.hasApiKey ? '••••••••••••' : 'Dán khoá API vào đây'}
                required={meta.requiresApiKey && !editing}
                autoComplete="off"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 text-sm outline-none focus:border-medical-500 focus:ring-2 focus:ring-medical-100 font-mono"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold disabled:opacity-60 flex items-center space-x-1.5"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{editing ? 'Lưu thay đổi' : 'Thêm nhà cung cấp'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
