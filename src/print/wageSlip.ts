import { exportT, type ExportLang } from '@/lib/i18n';
import { money, date as fmtDate, qty } from '@/lib/format';
import { htmlToPdf, printHtml } from '@/lib/exporters';
import type { Row } from '@/lib/db';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function nameFor(en: unknown, dv: unknown, mode: ExportLang): string {
  const a = String(en ?? '').trim();
  const b = String(dv ?? '').trim();
  if (mode === 'bi') return [a, b].filter(Boolean).join(' / ') || '—';
  return (mode === 'dv' ? b || a : a || b) || '—';
}

const SLIP_CSS = `
  .ws { font-family: Inter, 'Segoe UI', 'Noto Sans Thaana', sans-serif; color: #0f172a; font-size: 10.5px; padding: 18px 22px; background:#fff; }
  .ws[dir=rtl] { font-family: 'Noto Sans Thaana', 'MV Faseyha', Faruma, Inter, sans-serif; font-size: 11.5px; line-height: 1.75; }
  .ws .hd { display:flex; justify-content:space-between; align-items:flex-start; border-bottom: 3px solid #145673; padding-bottom: 8px; margin-bottom: 10px; gap: 12px; }
  .ws h1 { font-size: 18px; color: #145673; margin: 0; }
  .ws .co { font-size: 13px; font-weight: 600; }
  .ws .muted { color: #64748b; }
  .ws .grid { display:grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 3px 18px; margin-bottom: 10px; }
  .ws .grid div b { display:inline-block; min-width: 40%; color:#475569; font-weight:500; }
  .ws h2 { font-size: 12px; margin: 12px 0 4px; color: #145673; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }
  .ws table { width: 100%; border-collapse: collapse; }
  .ws td, .ws th { padding: 3px 5px; text-align: start; border-bottom: 1px solid #eef2f7; vertical-align: top; }
  .ws th { color:#475569; font-weight:600; background:#f8fafc; }
  .ws .num { text-align: end; white-space: nowrap; direction: ltr; unicode-bidi: isolate; }
  .ws .tot td { font-weight: 700; border-top: 1.5px solid #145673; }
  .ws .sum { margin-top: 10px; border: 1.5px solid #145673; border-radius: 6px; padding: 6px 10px; }
  .ws .sum .big td { font-size: 13px; font-weight: 700; color: #145673; }
  .ws .formula { font-size: 9.5px; color: #475569; margin-top: 8px; direction: ltr; text-align: left; }
  .ws .sig { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 18px; margin-top: 28px; }
  .ws .sig div { border-top: 1px solid #94a3b8; padding-top: 4px; color:#475569; }
  .ws .badge { display:inline-block; padding: 1px 6px; border-radius: 9px; background:#e0f2fe; color:#075985; font-size: 9.5px; }
  .ws-break { page-break-after: always; break-after: page; }
`;

/** Builds the printable wage slip (English, Dhivehi or bilingual) from the stored slip snapshot. */
export function wageSlipHtml(slip: Row, mode: ExportLang): string {
  const t = exportT(mode);
  const d: Row = slip.data ?? {};
  const cur = d.company?.currency ?? 'MVR';
  const m = (v: unknown) => money(v, cur);
  const dl = mode === 'dv' ? 'dv' : 'en';
  const dir = mode === 'dv' ? 'rtl' : 'ltr';
  const e: Row = d.earnings ?? {};
  const ded: Row = d.deductions ?? {};
  const lines: Row = d.lines ?? {};
  const payments: Row[] = slip.payments ?? [];
  const paid = Number(slip.amount_paid ?? payments.reduce((s: number, p: Row) => s + Number(p.amount), 0));
  const net = Number(slip.net_payable ?? d.net ?? 0);
  const remaining = Math.max(0, net - paid);

  const row = (label: string, v: unknown, always = false) =>
    (Number(v) !== 0 || always) ? `<tr><td>${esc(label)}</td><td class="num">${esc(m(v))}</td></tr>` : '';

  const advRows = (lines.advances ?? []).filter((a: Row) => Number(a.amount) > 0).map((a: Row) =>
    `<tr><td>${esc(a.code ?? '')} · ${esc(fmtDate(a.date, dl))}</td><td class="num">${esc(m(a.outstandingBefore))}</td><td class="num">${esc(m(a.amount))}</td><td class="num">${esc(m(a.outstandingAfter))}</td></tr>`).join('');
  const fishRows = (lines.fishTaken ?? []).map((f: Row) =>
    `<tr><td>${esc(fmtDate(f.date, dl))}</td><td>${esc(nameFor(f.fishTypeEn, f.fishTypeDv, mode))}</td><td class="num">${esc(qty(f.quantity))} ${esc(t(`units.${f.unit}`))}</td><td class="num">${esc(m(f.unitPrice))}</td><td class="num">${esc(m(f.amount))}</td></tr>`).join('');
  const adjRows = (lines.adjustments ?? []).map((a: Row) =>
    `<tr><td>${esc(a.code ?? '')}</td><td>${esc(t(`adjustment.${a.kind}`))}</td><td>${esc(a.reason)}</td><td class="num">${esc((a.kind === 'earning' ? '+' : '−') + m(a.amount))}</td></tr>`).join('');
  const payRows = payments.map((p: Row) =>
    `<tr><td>${esc(fmtDate(p.date, dl))}</td><td>${esc(p.code ?? '')}</td><td>${esc(t(`payMethods.${p.method}`))}</td><td>${esc(p.reference ?? '')}</td><td class="num">${esc(m(p.amount))}</td></tr>`).join('');
  const period = `${fmtDate(d.payroll?.periodStart, dl)} – ${fmtDate(d.payroll?.periodEnd, dl)}${d.payroll?.tripCode ? ` · ${d.payroll.tripCode}` : ''}`;
  const status = remaining <= 0 ? 'paid' : paid > 0 ? 'partially_paid' : 'unpaid';

  return `<div class="ws" dir="${dir}">
  <div class="hd">
    <div>
      <div class="co">${esc(nameFor(d.company?.name, d.company?.nameDv, mode))}</div>
      <div class="muted">${esc(d.company?.address ?? '')} ${esc(d.company?.phone ?? '')}</div>
    </div>
    <div style="text-align:end">
      <h1>${esc(t('slip.title'))}</h1>
      <div>${esc(t('slip.slipNo'))}: <b>${esc(slip.slip_no)}</b> · ${esc(t('slip.version'))} ${esc(slip.version)}</div>
      <div class="muted">${esc(t('slip.generated'))}: ${esc(fmtDate(slip.generated_at, dl))}</div>
    </div>
  </div>
  <div class="grid">
    <div><b>${esc(t('slip.fisherman'))}</b> ${esc(nameFor(d.crew?.nameEn, d.crew?.nameDv, mode))}</div>
    <div><b>${esc(t('slip.crewId'))}</b> ${esc(d.crew?.code ?? '')}</div>
    <div><b>${esc(t('common.boat'))}</b> ${esc(nameFor(d.boat?.name, d.boat?.nameDv, mode))} (${esc(d.boat?.registrationNo ?? '')})</div>
    <div><b>${esc(t('crew.jobRole'))}</b> ${esc(d.crew?.role ? t(`jobRoles.${d.crew.role}`) : '')}</div>
    <div><b>${esc(t('slip.period'))}</b> ${esc(period)}</div>
    <div><b>${esc(t('nav.payroll'))}</b> ${esc(d.payroll?.code ?? '')}</div>
    <div><b>${esc(t('slip.approval'))}</b> <span class="badge">${esc(t(slip.status === 'issued' ? 'status.approved' : `status.${slip.status}`))}</span></div>
    <div><b>${esc(t('slip.daysWorked'))}</b> ${esc(d.attendance?.daysPresent ?? '')} / ${esc(d.attendance?.daysEligible ?? '')}</div>
  </div>

  <h2>${esc(t('slip.earnings'))}</h2>
  <table>
    ${row(t('slip.ordinary'), e.ordinaryWage, true)}${row(t('slip.percentageShare'), e.percentageShare)}${row(t('slip.fixed'), e.fixedWage)}
    ${row(t('slip.attendanceAdj'), e.attendanceAdjustment)}${row(t('slip.bonus'), e.bonus)}${row(t('slip.otherEarnings'), e.otherEarnings)}
    <tr class="tot"><td>${esc(t('slip.gross'))}</td><td class="num">${esc(m(e.gross))}</td></tr>
  </table>

  <h2>${esc(t('slip.deductions'))}</h2>
  <table>
    ${row(t('slip.advances'), ded.advances)}${row(t('slip.fishTaken'), ded.fishTaken)}${row(t('slip.otherDeductions'), ded.other)}${row(t('slip.previousBalance'), ded.carryForward)}
    <tr class="tot"><td>${esc(t('slip.totalDeductions'))}</td><td class="num">${esc(m(ded.total))}</td></tr>
  </table>
  ${advRows ? `<table style="margin-top:6px"><tr><th>${esc(t('slip.advances'))}</th><th class="num">${esc(t('common.outstanding'))}</th><th class="num">${esc(t('advance.recovered'))}</th><th class="num">${esc(t('common.remaining'))}</th></tr>${advRows}</table>` : ''}
  ${fishRows ? `<table style="margin-top:6px"><tr><th>${esc(t('common.date'))}</th><th>${esc(t('sales.fishType'))}</th><th class="num">${esc(t('common.quantity'))}</th><th class="num">${esc(t('common.unitPrice'))}</th><th class="num">${esc(t('common.total'))}</th></tr>${fishRows}</table>` : ''}
  ${adjRows ? `<table style="margin-top:6px"><tr><th>${esc(t('common.code'))}</th><th>${esc(t('common.type'))}</th><th>${esc(t('common.reason'))}</th><th class="num">${esc(t('common.amount'))}</th></tr>${adjRows}</table>` : ''}

  <div class="sum">
    <table>
      <tr><td>${esc(t('slip.gross'))}</td><td class="num">${esc(m(e.gross))}</td></tr>
      <tr><td>${esc(t('slip.totalDeductions'))}</td><td class="num">− ${esc(m(ded.total))}</td></tr>
      <tr class="big"><td>${esc(t('slip.net'))}</td><td class="num">${esc(m(net))}</td></tr>
      <tr><td>${esc(t('slip.paidSoFar'))}</td><td class="num">${esc(m(paid))}</td></tr>
      <tr class="big"><td>${esc(t('slip.remaining'))}</td><td class="num">${esc(m(remaining))}</td></tr>
      ${Number(d.negativeBalance) > 0 ? `<tr><td>${esc(t('slip.reconcile'))}</td><td class="num">${esc(m(d.negativeBalance))}</td></tr>` : ''}
      ${Number(d.unrecoveredAdvance) > 0 ? `<tr><td>${esc(t('payroll.unrecoveredAdvance'))}</td><td class="num">${esc(m(d.unrecoveredAdvance))}</td></tr>` : ''}
      <tr><td>${esc(t('slip.paymentStatus'))}</td><td class="num">${esc(t(`status.${status}`))}</td></tr>
    </table>
  </div>
  ${payRows ? `<h2>${esc(t('slip.paymentDates'))}</h2><table><tr><th>${esc(t('common.date'))}</th><th>${esc(t('common.code'))}</th><th>${esc(t('common.method'))}</th><th>${esc(t('common.reference'))}</th><th class="num">${esc(t('common.amount'))}</th></tr>${payRows}</table>` : ''}
  ${(lines.formula ?? []).length ? `<h2>${esc(t('slip.formula'))}</h2><div class="formula">${(lines.formula as string[]).map(esc).join('<br/>')}</div>` : ''}
  <div class="sig">
    <div>${esc(t('slip.preparedBy'))}: ${esc(d.preparedBy ?? '')}</div>
    <div>${esc(t('slip.approvedBy'))}: ${esc(d.approvedBy ?? '')}</div>
    <div>${esc(t('slip.acknowledgement'))}${slip.acknowledged ? ` ✓ ${esc(fmtDate(slip.acknowledged_at, dl))}` : ''}<br/><br/>${esc(t('slip.signature'))}: ____________</div>
  </div>
</div>`;
}

export function slipsDocument(slips: Row[], mode: ExportLang): string {
  return `<style>${SLIP_CSS}</style>` + slips.map((s, i) => wageSlipHtml(s, mode) + (i < slips.length - 1 ? '<div class="ws-break"></div>' : '')).join('');
}

export async function downloadSlips(slips: Row[], mode: ExportLang, fileName: string) {
  await htmlToPdf(slipsDocument(slips, mode), fileName);
}

export function printSlips(slips: Row[], mode: ExportLang) {
  printHtml(slipsDocument(slips, mode), 'Wage slips');
}
