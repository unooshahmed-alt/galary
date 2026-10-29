import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';
import { useI18n } from '@/lib/i18n';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-ocean-700 text-white hover:bg-ocean-800 focus-visible:ring-ocean-400',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus-visible:ring-ocean-300',
  ghost: 'text-slate-700 hover:bg-slate-100 focus-visible:ring-ocean-300',
  danger: 'bg-coral-600 text-white hover:bg-coral-500 focus-visible:ring-coral-500',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-400',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: string;
  loading?: boolean;
}
export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm',
        variants[variant], className,
      )}
    >
      {loading ? <Spinner size={14} /> : icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" opacity="0.25" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// ------------------------------------------------------------------ Form controls
const control = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-ocean-500 focus:outline-none focus:ring-2 focus:ring-ocean-200 disabled:bg-slate-100 disabled:text-slate-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  const numeric = p.type === 'number' || p.type === 'date' || p.inputMode === 'decimal';
  return <input ref={ref} {...p} dir={numeric ? 'ltr' : p.dir} className={cx(control, numeric && 'text-start', className)} />;
});

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(control, 'pe-8', className)}>{children}</select>;
}

export function Textarea({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={cx(control, className)} />;
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={cx('flex items-start gap-2 text-sm', disabled ? 'opacity-60' : 'cursor-pointer')}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-ocean-700 focus:ring-ocean-400"
        checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="text-slate-800">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function Field({ label, required, error, hint, children, className }: { label: ReactNode; required?: boolean; error?: string | null; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {label}{required && <span className="text-coral-600"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-coral-600">{error}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ Layout pieces
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: () => void }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        {back && (
          <button onClick={back} className="mt-1 rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Back">
            <Icon name="chevronLeft" className="rtl:rotate-180" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
          {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-ocean-50 text-ocean-800 ring-ocean-200',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  violet: 'bg-violet-50 text-violet-800 ring-violet-200',
};
export function Badge({ tone = 'slate', children }: { tone?: keyof typeof badgeTones | string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', badgeTones[tone] ?? badgeTones.slate)}>{children}</span>;
}

const statusTone: Record<string, string> = {
  draft: 'slate', pending_approval: 'amber', approved: 'blue', rejected: 'red', voided: 'slate', partially_paid: 'violet',
  paid: 'green', unpaid: 'amber', overdue: 'red', planned: 'slate', active: 'blue', returned: 'violet', under_review: 'amber',
  closed: 'green', calculated: 'blue', finalized: 'green', reversed: 'red', issued: 'blue', superseded: 'slate', valid: 'green',
  recorded: 'blue', inactive: 'slate', present: 'green', absent: 'red', sick_leave: 'amber', approved_leave: 'violet', due_soon: 'amber',
};
export function StatusBadge({ status }: { status?: string | null }) {
  const { t } = useI18n();
  if (!status) return null;
  const label = t(`status.${status}`) !== `status.${status}` ? t(`status.${status}`) : t(`attendanceStatus.${status}`);
  return <Badge tone={statusTone[status] ?? 'slate'}>{label}</Badge>;
}

export function Stat({ label, value, hint, tone = 'default', icon, onClick }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn'; icon?: string; onClick?: () => void }) {
  const toneCls = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-coral-600', warn: 'text-amber-700' }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp onClick={onClick} className={cx('flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-start shadow-sm', onClick && 'hover:border-ocean-300 hover:shadow')}>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">{icon && <Icon name={icon} size={15} className="text-ocean-600" />}{label}</div>
      <div className={cx('mt-1.5 whitespace-nowrap text-lg font-semibold tabular-nums sm:text-xl', toneCls)} dir="ltr" style={{ textAlign: 'start' }}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </Comp>
  );
}

export function EmptyState({ icon = 'inbox', title, text, action }: { icon?: string; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <div className="mb-3 rounded-full bg-ocean-50 p-3 text-ocean-600"><Icon name={icon} size={24} /></div>
      <div className="font-medium text-slate-800">{title}</div>
      {text && <div className="mt-1 max-w-md text-sm text-slate-500">{text}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'success'; title?: ReactNode; children?: ReactNode }) {
  const cls = {
    info: 'border-ocean-200 bg-ocean-50 text-ocean-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  const icon = { info: 'info', warn: 'alert', error: 'alert', success: 'check' }[tone];
  return (
    <div className={cx('flex gap-2 rounded-lg border px-3 py-2.5 text-sm', cls)} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={16} className="mt-0.5" />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((tb) => (
        <button key={tb.id} role="tab" aria-selected={value === tb.id} onClick={() => onChange(tb.id)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
            value === tb.id ? 'border-ocean-700 text-ocean-800' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {tb.label}{tb.count !== undefined && <span className="ms-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{tb.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cx('grid gap-x-6 gap-y-3 text-sm', cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3')}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="mt-0.5 break-words text-slate-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Amount displayed LTR even inside RTL text. */
export function Money({ value, currency, className }: { value: unknown; currency?: string; className?: string }) {
  const n = Number(value ?? 0);
  return <bdi className={cx('whitespace-nowrap tabular-nums', n < 0 && 'text-coral-600', className)} dir="ltr">{formatMoney(n, currency)}</bdi>;
}
function formatMoney(n: number, currency = 'MVR') {
  const s = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
  return `${n < 0 ? '−' : ''}${currency} ${s}`;
}

export function Disclosure({ title, children, defaultOpen = false }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-slate-200">
      <button className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-slate-700" onClick={() => setOpen(!open)}>
        {title}<Icon name="chevronDown" className={open ? 'rotate-180 transition' : 'transition'} />
      </button>
      {open && <div className="border-t border-slate-100 p-3">{children}</div>}
    </div>
  );
}
