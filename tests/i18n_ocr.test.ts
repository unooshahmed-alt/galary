import { describe, it, expect } from 'vitest';
import en from '../src/i18n/en';
import dv from '../src/i18n/dv';
import { parseBillText } from '../src/lib/ocr';

function keys(o: unknown, prefix = ''): string[] {
  if (typeof o !== 'object' || o === null) return [prefix];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}
const valueAt = (o: unknown, k: string) => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown>)?.[p], o);

describe('translations', () => {
  it('Dhivehi has every English key', () => {
    const missing = keys(en).filter((k) => typeof valueAt(dv, k) !== 'string');
    expect(missing).toEqual([]);
  });
  it('Dhivehi strings are not empty and keep placeholders', () => {
    for (const k of keys(en)) {
      const e = String(valueAt(en, k));
      const d = String(valueAt(dv, k));
      expect(d.length > 0).toBe(true);
      for (const ph of e.match(/\{\w+\}/g) ?? []) expect(d.includes(ph) ? ph : `${k} missing ${ph}`).toBe(ph);
    }
  });
  it('Dhivehi navigation is written in Thaana', () => {
    for (const v of Object.values(dv.nav)) expect(/[ހ-޿]/.test(v)).toBe(true);
  });
});

describe('OCR bill parsing (suggestions only)', () => {
  it('extracts invoice number, dates and amounts', () => {
    const f = parseBillText(`FUEL SUPPLIES PVT LTD\nMale', Maldives\nInvoice No: INV-2026/104\nDate: 12/10/2026\nDue Date: 11/11/2026\nSub Total 5,000.00\nGST 8% 400.00\nTotal Amount 5,400.00`);
    expect(f.supplier).toBe('FUEL SUPPLIES PVT LTD');
    expect(f.invoiceNo).toBe('INV-2026/104');
    expect(f.billDate).toBe('2026-10-12');
    expect(f.dueDate).toBe('2026-11-11');
    expect(f.subtotal).toBe(5000);
    expect(f.tax).toBe(400);
    expect(f.total).toBe(5400);
  });
});
