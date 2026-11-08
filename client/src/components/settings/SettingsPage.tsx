import React, { useState } from 'react';
import { Sparkles, DatabaseBackup } from 'lucide-react';
import { AIProviderSettings } from './AIProviderSettings';
import { BackupSettings } from './BackupSettings';

type SettingsTab = 'AI' | 'BACKUP';

/** Trang Cài đặt: nhà cung cấp AI (đa nguồn) + sao lưu/phục hồi dữ liệu. */
export const SettingsPage: React.FC = () => {
  const [tab, setTab] = useState<SettingsTab>('AI');

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">Cài đặt</h2>
        <p className="text-sm text-slate-500 mt-1">
          Quản lý nguồn AI dùng để sinh câu hỏi và sao lưu dữ liệu đề thi của bạn.
        </p>
      </div>

      <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl w-fit mb-5">
        <button
          onClick={() => setTab('AI')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            tab === 'AI' ? 'bg-white text-medical-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Nhà cung cấp AI</span>
        </button>
        <button
          onClick={() => setTab('BACKUP')}
          className={`flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
            tab === 'BACKUP' ? 'bg-white text-medical-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <DatabaseBackup className="w-3.5 h-3.5" />
          <span>Sao lưu dữ liệu</span>
        </button>
      </div>

      {tab === 'AI' ? <AIProviderSettings /> : <BackupSettings />}
    </div>
  );
};
