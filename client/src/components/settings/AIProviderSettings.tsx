import React, { useEffect, useState } from 'react';
import { Plus, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { CreateProviderInput, PublicProvider, PublicSettings, UpdateProviderInput } from '../../types/settings.types';
import { SettingsService } from '../../services/settings.service';
import { ProviderCard } from './ProviderCard';
import { ProviderFormModal } from './ProviderFormModal';

export const AIProviderSettings: React.FC = () => {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalState, setModalState] = useState<'closed' | 'create' | PublicProvider>('closed');

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSettings(await SettingsService.getSettings());
    } catch (err: any) {
      setError(err?.message || 'Không tải được cấu hình.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (input: CreateProviderInput) => {
    setSettings(await SettingsService.createProvider(input));
  };

  const handleUpdate = async (id: string, input: UpdateProviderInput) => {
    setSettings(await SettingsService.updateProvider(id, input));
  };

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`Xoá nhà cung cấp "${label}"? Hành động này không thể hoàn tác.`)) return;
    try {
      setSettings(await SettingsService.deleteProvider(id));
    } catch (err: any) {
      setError(err?.message || 'Không xoá được.');
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      setSettings(await SettingsService.updateAISettings({ activeProviderId: id }));
    } catch (err: any) {
      setError(err?.message || 'Không đặt được provider mặc định.');
    }
  };

  const handleLoginOAuth = async (provider: PublicProvider) => {
    try {
      const { authorizeUrl } = await SettingsService.startOAuthLogin(provider.id);
      window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      pollOAuthStatus(provider.id);
    } catch (err: any) {
      setError(err?.message || 'Không bắt đầu được đăng nhập.');
    }
  };

  const pollOAuthStatus = (providerId: string) => {
    const startedAt = Date.now();
    const interval = setInterval(async () => {
      if (Date.now() - startedAt > 2 * 60 * 1000) {
        clearInterval(interval);
        return;
      }
      try {
        const status = await SettingsService.getOAuthLoginStatus(providerId);
        if (status.status === 'done') {
          clearInterval(interval);
          void load();
        } else if (status.status === 'error') {
          clearInterval(interval);
          setError(status.message || 'Đăng nhập thất bại.');
        }
      } catch {
        // Bỏ qua lỗi tạm thời của một lần poll, vòng sau thử lại
      }
    }, 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {error}
          </span>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 font-bold">
            Đóng
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Nhà cung cấp AI</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Thêm nhiều nguồn AI và chọn nguồn nào dùng để sinh câu hỏi. Khoá API được lưu
            trên máy của bạn, tách biệt hoàn toàn khỏi dữ liệu đề thi để không bị lộ khi sao lưu.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => void load()} title="Tải lại" className="p-2 rounded-lg text-slate-400 hover:bg-slate-100">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setModalState('create')}
            className="px-3.5 py-2 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Thêm
          </button>
        </div>
      </div>

      {settings && settings.providers.length === 0 && (
        <div className="p-6 rounded-2xl border border-dashed border-slate-300 text-center text-sm text-slate-500">
          Chưa có nhà cung cấp AI nào. Bấm "Thêm" để kết nối Gemini, OpenAI, Anthropic, một dịch vụ
          tương thích OpenAI, AI chạy cục bộ (Ollama), hoặc đăng nhập ChatGPT.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {settings?.providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            meta={settings.providerMeta[p.type]}
            isActive={settings.ai.activeProviderId === p.id}
            onSetActive={() => void handleSetActive(p.id)}
            onEdit={() => setModalState(p)}
            onDelete={() => void handleDelete(p.id, p.label)}
            onLoginOAuth={() => void handleLoginOAuth(p)}
          />
        ))}
      </div>

      {modalState !== 'closed' && settings && (
        <ProviderFormModal
          providerMeta={settings.providerMeta}
          editing={modalState === 'create' ? null : modalState}
          onClose={() => setModalState('closed')}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
};

