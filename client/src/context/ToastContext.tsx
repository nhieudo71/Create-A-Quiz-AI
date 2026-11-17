import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

type ToastListener = (item: Omit<ToastItem, 'id'>) => void;
let listener: ToastListener | null = null;

/** Cho phép gọi thông báo từ bất kỳ hook hoặc component nào. */
export const toast = {
  success(message: string, title = 'Thành công') {
    listener?.({ type: 'success', title, message });
  },
  error(message: string, title = 'Có lỗi xảy ra') {
    listener?.({ type: 'error', title, message });
  },
  warning(message: string, title = 'Cảnh báo') {
    listener?.({ type: 'warning', title, message });
  },
  info(message: string, title = 'Thông báo') {
    listener?.({ type: 'info', title, message });
  }
};

interface ToastContextValue {
  pushToast: (item: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (item: Omit<ToastItem, 'id'>) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setItems((prev) => [...prev.slice(-4), { ...item, id }]);
      const duration = item.type === 'error' || item.type === 'warning' ? 7000 : 4500;
      setTimeout(() => removeToast(id), duration);
    },
    [removeToast]
  );

  useEffect(() => {
    listener = pushToast;
    return () => {
      if (listener === pushToast) listener = null;
    };
  }, [pushToast]);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        className="fixed top-4 right-4 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0 no-print"
      >
        {items.map((item) => {
          const styleMap: Record<ToastType, string> = {
            success: 'bg-emerald-50 border-emerald-300 text-emerald-900',
            error: 'bg-rose-50 border-rose-300 text-rose-900',
            warning: 'bg-amber-50 border-amber-300 text-amber-900',
            info: 'bg-sky-50 border-sky-300 text-sky-900'
          };
          const iconMap: Record<ToastType, React.ReactNode> = {
            success: <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />,
            error: <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />,
            warning: <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />,
            info: <Info className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
          };

          return (
            <div
              key={item.id}
              className={`pointer-events-auto rounded-2xl border p-3.5 shadow-lg backdrop-blur-sm flex items-start gap-3 transition-all ${styleMap[item.type]}`}
            >
              {iconMap[item.type]}
              <div className="flex-1 min-w-0">
                {item.title && <p className="text-xs font-extrabold">{item.title}</p>}
                <p className="text-xs font-medium leading-relaxed break-words">{item.message}</p>
              </div>
              <button
                onClick={() => removeToast(item.id)}
                className="p-1 rounded-lg opacity-60 hover:opacity-100 transition flex-shrink-0"
                aria-label="Đóng thông báo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return toast;
}
