import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type Tone = 'success' | 'error' | 'info';
interface ToastItem { id: number; tone: Tone; text: string }
interface ToastApi { show: (text: string, tone?: Tone) => void; success: (t: string) => void; error: (t: string) => void }

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((text: string, tone: Tone = 'info') => {
    const id = nextId++;
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  const api: ToastApi = { show, success: (t) => show(t, 'success'), error: (t) => show(t, 'error') };
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${
            i.tone === 'success' ? 'bg-emerald-700' : i.tone === 'error' ? 'bg-coral-600' : 'bg-slate-800'}`}>
            <Icon name={i.tone === 'success' ? 'check' : i.tone === 'error' ? 'alert' : 'info'} size={16} className="mt-0.5" />
            <span>{i.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('useToast must be used inside ToastProvider');
  return v;
}
