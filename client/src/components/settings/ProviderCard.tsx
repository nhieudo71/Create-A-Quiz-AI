import React, { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Pencil,
  Trash2,
  PlugZap,
  LogIn,
  Star
} from 'lucide-react';
import { ProviderMeta, PublicProvider } from '../../types/settings.types';
import { SettingsService } from '../../services/settings.service';

interface ProviderCardProps {
  provider: PublicProvider;
  meta: ProviderMeta;
  isActive: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onLoginOAuth: () => void;
}

/**
 * Thẻ hiển thị một nhà cung cấp AI đã cấu hình: trạng thái, nút Dùng làm mặc định,
 * Kiểm tra kết nối, Sửa, Xoá. "Kiểm tra kết nối" gọi thật tới dịch vụ với một
 * yêu cầu rất nhỏ ("Trả lời đúng một chữ: OK") để xác nhận khoá/baseUrl đúng
 * TRƯỚC khi người dùng tải tài liệu lên và chờ cả phút để biết là sai cấu hình.
 */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  meta,
  isActive,
  onSetActive,
  onEdit,
  onDelete,
  onLoginOAuth
}) => {
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const handleTest = async () => {
    setTestState('loading');
    setTestMessage(null);
    try {
      const result = await SettingsService.testProvider(provider.id);
      setTestState(result.ok ? 'ok' : 'fail');
      setTestMessage(result.message);
    } catch (err: any) {
      setTestState('fail');
      setTestMessage(err?.message || 'Không kiểm tra được kết nối.');
    }
  };

  const needsOAuthLogin = provider.type === 'chatgpt-oauth' && !provider.oauthConnected;

  return (
    <div
      className={`rounded-2xl border p-4 transition ${
        isActive ? 'border-medical-600 bg-medical-50/40 ring-1 ring-medical-600' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-slate-900 text-sm truncate">{provider.label}</h4>
            {isActive && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-medical-600 text-white flex items-center gap-1">
                <Star className="w-2.5 h-2.5 fill-current" /> Đang dùng
              </span>
            )}
            {!provider.enabled && (
              <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                Đã tắt
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {meta.label} • {provider.model || '(chưa đặt model)'}
          </p>
          {provider.baseUrl && <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{provider.baseUrl}</p>}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} title="Sửa" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} title="Xoá" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {provider.type === 'chatgpt-oauth' && (
        <p className="text-[11px] mt-2 flex items-center gap-1.5 text-slate-500">
          {provider.oauthConnected ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Đã đăng nhập ChatGPT
            </>
          ) : (
            <>
              <XCircle className="w-3.5 h-3.5 text-amber-500" /> Chưa đăng nhập
            </>
          )}
        </p>
      )}

      {testMessage && (
        <p className={`text-[11px] mt-2 ${testState === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
          {testMessage}
        </p>
      )}

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {!isActive && (
          <button
            onClick={onSetActive}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            Dùng làm mặc định
          </button>
        )}

        {needsOAuthLogin ? (
          <button
            onClick={onLoginOAuth}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 flex items-center gap-1.5"
          >
            <LogIn className="w-3 h-3" /> Đăng nhập ChatGPT
          </button>
        ) : (
          <button
            onClick={handleTest}
            disabled={testState === 'loading'}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 flex items-center gap-1.5 disabled:opacity-60"
          >
            {testState === 'loading' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <PlugZap className="w-3 h-3" />
            )}
            Kiểm tra kết nối
          </button>
        )}
      </div>
    </div>
  );
};
