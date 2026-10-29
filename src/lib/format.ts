import type { Lang } from './i18n';

const numberFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });

export function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** "MVR 1,234.50" — amounts are always shown left-to-right, also inside Dhivehi text. */
export function money(v: unknown, currency = 'MVR'): string {
  const n = toNumber(v);
  const s = numberFmt.format(Math.abs(n));
  return `${n < 0 ? '−' : ''}${currency} ${s}`;
}

export const num = (v: unknown) => numberFmt.format(toNumber(v));
export const qty = (v: unknown) => qtyFmt.format(toNumber(v));

/** Round to laari to avoid floating point drift in the UI. */
export const round2 = (v: number) => Math.round(v * 100) / 100;

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_DV = ['ޖެނުއަރީ', 'ފެބްރުއަރީ', 'މާޗް', 'އޭޕްރިލް', 'މެއި', 'ޖޫން', 'ޖުލައި', 'އޮގަސްޓު', 'ސެޕްޓެމްބަރު', 'އޮކްޓޫބަރު', 'ނޮވެމްބަރު', 'ޑިސެމްބަރު'];

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function date(v: unknown, lang: Lang = 'en'): string {
  const d = parseDate(v);
  if (!d) return '—';
  const m = lang === 'dv' ? MONTHS_DV[d.getMonth()] : MONTHS_EN[d.getMonth()];
  return `${String(d.getDate()).padStart(2, '0')} ${m} ${d.getFullYear()}`;
}

export function dateTime(v: unknown, lang: Lang = 'en'): string {
  const d = parseDate(v);
  if (!d) return '—';
  return `${date(d, lang)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function monthLabel(v: unknown, lang: Lang = 'en'): string {
  const d = parseDate(v);
  if (!d) return '';
  return `${(lang === 'dv' ? MONTHS_DV : MONTHS_EN)[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

/** Local ISO date (yyyy-mm-dd) without timezone shifting. */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type RangePreset = 'today' | 'week' | 'month' | 'year' | 'custom';

export function rangeFor(preset: RangePreset, now = new Date()): { from: string; to: string } {
  const to = isoDate(now);
  if (preset === 'today') return { from: to, to };
  if (preset === 'week') {
    const d = new Date(now);
    const day = (d.getDay() + 6) % 7; // Monday start
    d.setDate(d.getDate() - day);
    return { from: isoDate(d), to };
  }
  if (preset === 'year') return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

/** Pick the name in the current language, falling back to the other. */
export function dname(en?: string | null, dvName?: string | null, lang: Lang = 'en'): string {
  const a = (en ?? '').trim();
  const b = (dvName ?? '').trim();
  return (lang === 'dv' ? b || a : a || b) || '—';
}

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
