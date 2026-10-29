import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Textarea, Alert } from './ui';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';

export function Modal({ open, onClose, title, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" className={`flex max-h-[95vh] w-full ${width} flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export interface ConfirmOptions {
  title?: ReactNode;
  message?: ReactNode;
  confirmLabel?: ReactNode;
  tone?: 'primary' | 'danger' | 'success';
  /** Ask for a reason / comment; `true` = required */
  reason?: boolean | 'optional';
  reasonLabel?: ReactNode;
}

/** Confirmation dialog used before every sensitive / financial action. */
export function useConfirm() {
  const { t } = useI18n();
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | null) => void }) | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState(false);

  const confirm = (o: ConfirmOptions = {}) => new Promise<string | null>((resolve) => { setText(''); setErr(false); setState({ ...o, resolve }); });

  const close = (v: string | null) => { state?.resolve(v); setState(null); };
  const ok = () => {
    if (state?.reason === true && !text.trim()) { setErr(true); return; }
    close(text.trim());
  };

  const dialog = (
    <Modal open={!!state} onClose={() => close(null)} title={state?.title ?? t('common.confirmTitle')} size="sm"
      footer={<>
        <Button onClick={() => close(null)}>{t('common.cancel')}</Button>
        <Button variant={state?.tone ?? 'primary'} onClick={ok}>{state?.confirmLabel ?? t('common.confirm')}</Button>
      </>}>
      <div className="space-y-3 text-sm text-slate-700">
        {state?.message && <div>{state.message}</div>}
        {state?.reason && (
          <Field label={state.reasonLabel ?? t('common.reason')} required={state.reason === true} error={err ? t('common.reasonRequired') : null}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <Alert tone="info">{t('common.irreversible')}</Alert>
      </div>
    </Modal>
  );
  return { confirm, dialog };
}
