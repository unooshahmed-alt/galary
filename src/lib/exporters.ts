/**
 * Real Excel (.xlsx via ExcelJS) and PDF (via html2pdf) exports.
 * PDFs are rendered from HTML with the Noto Sans Thaana web font, so Dhivehi
 * text (right-to-left, with fili/vowel marks) renders exactly as on screen.
 */
import type { ExportLang } from './i18n';
import { money, num, qty, date as fmtDate } from './format';

export type ColType = 'text' | 'money' | 'number' | 'qty' | 'date' | 'datetime';
export interface ExportColumn {
  header: string;
  key: string;
  type?: ColType;
  /** Optional value accessor for derived cells. */
  value?: (row: Record<string, unknown>) => unknown;
  width?: number;
}
export interface ExportSpec {
  fileName: string;
  title: string;
  subtitle?: string;
  meta?: [string, string][];
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number | string>;
  lang: ExportLang;
  currency?: string;
  landscape?: boolean;
  /** Extra HTML blocks appended after the table (PDF only) */
  footerHtml?: string;
}

const cellValue = (c: ExportColumn, r: Record<string, unknown>) => (c.value ? c.value(r) : r[c.key]);

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function display(c: ExportColumn, v: unknown, currency: string, lang: ExportLang): string {
  if (v === null || v === undefined || v === '') return '';
  switch (c.type) {
    case 'money': return money(v, currency);
    case 'number': return num(v);
    case 'qty': return qty(v);
    case 'date': return fmtDate(v, lang === 'dv' ? 'dv' : 'en');
    case 'datetime': return String(v).replace('T', ' ').slice(0, 16);
    default: return String(v);
  }
}

// ---------------------------------------------------------------- Excel
export async function exportExcel(spec: ExportSpec): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Galary';
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.title.slice(0, 28).replace(/[\\/*?:[\]]/g, ' ') || 'Report', {
    views: [{ rightToLeft: spec.lang === 'dv', state: 'frozen', ySplit: 0 }],
  });
  const fontName = spec.lang === 'en' ? 'Calibri' : 'Faruma';
  ws.addRow([spec.title]).font = { bold: true, size: 14, name: fontName };
  if (spec.subtitle) ws.addRow([spec.subtitle]).font = { italic: true, name: fontName };
  for (const [k, v] of spec.meta ?? []) ws.addRow([k, v]).font = { name: fontName, color: { argb: 'FF475569' } };
  ws.addRow([]);
  const headerRow = ws.addRow(spec.columns.map((c) => c.header));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: fontName };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145673' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  const headerIndex = headerRow.number;
  ws.views = [{ rightToLeft: spec.lang === 'dv', state: 'frozen', ySplit: headerIndex }];

  for (const r of spec.rows) {
    const row = ws.addRow(spec.columns.map((c) => {
      const v = cellValue(c, r);
      if (v === null || v === undefined || v === '') return null;
      if (c.type === 'money' || c.type === 'number' || c.type === 'qty') return Number(v);
      if (c.type === 'date') return new Date(`${String(v).slice(0, 10)}T00:00:00`);
      return typeof v === 'object' ? JSON.stringify(v) : String(v);
    }));
    row.font = { name: fontName };
  }
  if (spec.totals) {
    const t = ws.addRow(spec.columns.map((c, i) => (i === 0 && spec.totals![c.key] === undefined ? 'Total' : spec.totals![c.key] ?? null)));
    t.font = { bold: true, name: fontName };
    t.eachCell((cell) => { cell.border = { top: { style: 'thin' } }; });
  }
  spec.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money' || c.type === 'number') col.numFmt = '#,##0.00';
    if (c.type === 'qty') col.numFmt = '#,##0.###';
    if (c.type === 'date') col.numFmt = 'dd-mmm-yyyy';
    col.width = c.width ?? Math.min(48, Math.max(12, c.header.length + 2, ...spec.rows.slice(0, 200).map((r) => String(cellValue(c, r) ?? '').length + 2)));
  });
  ws.autoFilter = { from: { row: headerIndex, column: 1 }, to: { row: headerIndex, column: spec.columns.length } };

  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${spec.fileName}.xlsx`);
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

// ---------------------------------------------------------------- HTML / PDF
export const PRINT_CSS = `
  .gp-doc { font-family: Inter, 'Segoe UI', Roboto, 'Noto Sans Thaana', sans-serif; color: #0f172a; font-size: 10.5px; line-height: 1.45; background: #fff; padding: 18px 20px; }
  .gp-doc[dir=rtl] { font-family: 'Noto Sans Thaana', 'MV Faseyha', Faruma, Inter, sans-serif; font-size: 11.5px; }
  .gp-doc h1 { font-size: 17px; margin: 0 0 2px; color: #145673; }
  .gp-doc h2 { font-size: 13px; margin: 14px 0 6px; color: #145673; }
  .gp-doc .gp-sub { color: #475569; margin-bottom: 8px; }
  .gp-doc .gp-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 2px 18px; margin: 8px 0 12px; color: #334155; }
  .gp-doc .gp-meta b { color: #0f172a; }
  .gp-doc table { width: 100%; border-collapse: collapse; }
  .gp-doc th { background: #145673; color: #fff; text-align: start; padding: 5px 6px; font-weight: 600; }
  .gp-doc td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; text-align: start; vertical-align: top; }
  .gp-doc td.num, .gp-doc th.num { text-align: end; white-space: nowrap; direction: ltr; unicode-bidi: isolate; }
  .gp-doc tr { page-break-inside: avoid; }
  .gp-doc tfoot td { font-weight: 700; border-top: 2px solid #145673; }
  .gp-doc .gp-foot { margin-top: 14px; color: #64748b; font-size: 9px; }
  .gp-page-break { page-break-after: always; break-after: page; }
`;

export function buildTableHtml(spec: ExportSpec): string {
  const cur = spec.currency ?? 'MVR';
  const dir = spec.lang === 'dv' ? 'rtl' : 'ltr';
  const isNum = (c: ExportColumn) => c.type === 'money' || c.type === 'number' || c.type === 'qty';
  const head = spec.columns.map((c) => `<th class="${isNum(c) ? 'num' : ''}">${escapeHtml(c.header)}</th>`).join('');
  const body = spec.rows.map((r) => `<tr>${spec.columns.map((c) =>
    `<td class="${isNum(c) ? 'num' : ''}">${escapeHtml(display(c, cellValue(c, r), cur, spec.lang))}</td>`).join('')}</tr>`).join('');
  const foot = spec.totals ? `<tfoot><tr>${spec.columns.map((c, i) => {
    const v = spec.totals![c.key];
    const txt = v === undefined ? (i === 0 ? '∑' : '') : typeof v === 'number' ? display(c, v, cur, spec.lang) : String(v);
    return `<td class="${isNum(c) ? 'num' : ''}">${escapeHtml(txt)}</td>`;
  }).join('')}</tr></tfoot>` : '';
  const meta = (spec.meta ?? []).map(([k, v]) => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(v)}</div>`).join('');
  return `<div class="gp-doc" dir="${dir}">
    <h1>${escapeHtml(spec.title)}</h1>
    ${spec.subtitle ? `<div class="gp-sub">${escapeHtml(spec.subtitle)}</div>` : ''}
    <div class="gp-meta">${meta}</div>
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>
    ${spec.footerHtml ?? ''}
    <div class="gp-foot">Galary · ${escapeHtml(new Date().toISOString().slice(0, 16).replace('T', ' '))}</div>
  </div>`;
}

async function fontsReady() {
  try { await (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready; } catch { /* ignore */ }
}

/** Render an HTML string to a downloadable PDF (A4). */
export async function htmlToPdf(html: string, fileName: string, landscape = false): Promise<void> {
  const html2pdf = (await import('html2pdf.js')).default;
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.insetInlineStart = '-10000px';
  host.style.top = '0';
  host.style.width = landscape ? '1120px' : '794px';
  host.innerHTML = `<style>${PRINT_CSS}</style>${html}`;
  document.body.appendChild(host);
  await fontsReady();
  try {
    await html2pdf().set({
      margin: [8, 8, 10, 8],
      filename: `${fileName}.pdf`,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: 'tr' },
    }).from(host).save();
  } finally {
    host.remove();
  }
}

export async function exportPdf(spec: ExportSpec): Promise<void> {
  await htmlToPdf(buildTableHtml(spec), spec.fileName, spec.landscape ?? spec.columns.length > 7);
}

/** Print through the browser (also lets people "Save as PDF"). */
export function printHtml(html: string, title = 'Galary') {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const fontLinks = Array.from(document.querySelectorAll('style, link[rel=stylesheet]')).map((n) => n.outerHTML).join('');
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>${fontLinks}<style>${PRINT_CSS} @page { size: A4; margin: 10mm; } body{margin:0}</style></head><body>${html}</body></html>`);
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 2000);
  }, 400);
}
