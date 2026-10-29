import { useMemo, useState } from 'react';
import { useI18n, exportT, type ExportLang, type TFn } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, rpc, type Filter, type Row } from '@/lib/db';
import { money, num, qty, date as fmtDate, monthLabel } from '@/lib/format';
import type { ExportColumn, ExportSpec } from '@/lib/exporters';
import { Alert, Button, Card, Field, PageHeader, Spinner, cx } from '@/components/ui';
import { DateRangeFilter, defaultRange, type DateRange } from '@/components/DateRangeFilter';
import { RefSelect, useOptions } from '@/components/RefSelect';
import { ExportMenu } from '@/components/ExportMenu';
import { Icon } from '@/components/Icon';

interface Ctx { range: DateRange; boat: string | null }
interface ReportDef {
  key: string;
  group: 'finance' | 'bills' | 'crew' | 'operations';
  perm: string;
  load: (c: Ctx) => Promise<Row[]>;
  columns: (t: TFn) => ExportColumn[];
  boatFilter?: boolean;
  noDate?: boolean;
}

const inRange = (col: string, c: Ctx, boatCol: string | null = 'boat_id'): Filter[] => [
  ...(c.range.from ? [[col, 'gte', c.range.from] as Filter] : []),
  ...(c.range.to ? [[col, 'lte', c.range.to + (col.endsWith('_at') ? 'T23:59:59' : '')] as Filter] : []),
  ...(c.boat && boatCol ? [[boatCol, 'eq', c.boat] as Filter] : []),
];

function groupBy(rows: Row[], key: (r: Row) => string, label: (r: Row) => string): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = key(r) || '—';
    const g = m.get(k) ?? { group: label(r) || '—', count: 0, total: 0, paid: 0, outstanding: 0 };
    g.count += 1;
    g.total += Number(r.total ?? 0);
    g.paid += Number(r.amount_paid ?? 0);
    g.outstanding += Number(r.outstanding ?? 0);
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
const groupCols = (label: string) => (t: TFn): ExportColumn[] => [
  { header: t(label), key: 'group' }, { header: t('common.count'), key: 'count', type: 'number' },
  { header: t('common.total'), key: 'total', type: 'money' }, { header: t('common.paid'), key: 'paid', type: 'money' },
  { header: t('common.outstanding'), key: 'outstanding', type: 'money' },
];
const approvedBills = (c: Ctx) => fetchAll('v_bills', { filters: [...inRange('bill_date', c), ['status', 'in', ['approved', 'partially_paid', 'paid']]] });
const billCols = (t: TFn): ExportColumn[] => [
  { header: t('common.code'), key: 'bill_code' }, { header: t('common.supplier'), key: 'supplier_name' }, { header: t('bills.invoiceNo'), key: 'invoice_no' },
  { header: t('bills.billDate'), key: 'bill_date', type: 'date' }, { header: t('bills.dueDate'), key: 'due_date', type: 'date' },
  { header: t('common.category'), key: 'category_name_en' }, { header: t('common.boat'), key: 'boat_name' }, { header: t('common.trip'), key: 'trip_code' },
  { header: t('common.total'), key: 'total', type: 'money' }, { header: t('bills.amountPaid'), key: 'amount_paid', type: 'money' },
  { header: t('common.outstanding'), key: 'outstanding', type: 'money' }, { header: t('common.status'), key: 'display_status', value: (r) => t(`status.${r.display_status}`) },
  { header: t('common.documents'), key: 'document_count', type: 'number' }, { header: t('bills.enteredBy'), key: 'entered_by_name' },
];
const seriesCols = (fmt: (r: Row) => string) => (t: TFn): ExportColumn[] => [
  { header: t('common.period'), key: 'period', value: fmt }, { header: t('dashboard.income'), key: 'income', type: 'money' },
  { header: t('dashboard.expense'), key: 'expense', type: 'money' }, { header: t('dashboard.profit'), key: 'profit', type: 'money' },
];

const REPORTS: ReportDef[] = [
  { key: 'summary', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: async (c) => {
      const s = await rpc<Row>('financial_summary', { p_from: c.range.from, p_to: c.range.to, p_boat: c.boat });
      const d = await rpc<Row>('dashboard_summary', { p_from: c.range.from, p_to: c.range.to, p_boat: c.boat });
      return [
        ['dashboard.fishSales', s.fishSales], ['dashboard.otherIncome', s.otherIncome], ['dashboard.expenses', -s.expenses],
        ['dashboard.operatingProfit', s.operatingProfit], ['dashboard.crewWages', -s.crewWages], ['fishTaken.title', s.fishTakenRecovered],
        ['dashboard.netProfit', s.netProfit], ['payroll.ownerAllocation', s.ownerAllocation], ['payroll.totalBonuses', s.bonuses],
        ['payroll.ownerRemaining', s.ownerRemaining], ['dashboard.cashIn', d.cashIn], ['dashboard.cashOut', d.cashOut],
        ['dashboard.receivables', d.receivables], ['dashboard.supplierOutstanding', d.supplierOutstanding],
        ['dashboard.wageLiabilities', d.wageLiabilities], ['dashboard.advances', d.advancesOutstanding],
      ].map(([k, v]) => ({ line: k, amount: Number(v ?? 0) }));
    },
    columns: (t) => [{ header: t('common.description'), key: 'line', value: (r) => t(String(r.line)) }, { header: t('common.amount'), key: 'amount', type: 'money' }] },
  { key: 'daily', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => rpc<Row[]>('finance_series', { p_from: c.range.from, p_to: c.range.to, p_grain: 'day', p_boat: c.boat }),
    columns: seriesCols((r) => fmtDate(r.period)) },
  { key: 'monthly', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => rpc<Row[]>('finance_series', { p_from: c.range.from, p_to: c.range.to, p_grain: 'month', p_boat: c.boat }),
    columns: seriesCols((r) => monthLabel(r.period)) },
  { key: 'annual', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => rpc<Row[]>('finance_series', { p_from: c.range.from, p_to: c.range.to, p_grain: 'year', p_boat: c.boat }),
    columns: seriesCols((r) => String(r.period).slice(0, 4)) },
  { key: 'tripPnl', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => fetchAll('v_trips', { filters: inRange('start_date', c), sort: { column: 'start_date', ascending: true } }),
    columns: (t) => [
      { header: t('common.code'), key: 'trip_code' }, { header: t('common.boat'), key: 'boat_name' }, { header: t('trips.startDate'), key: 'start_date', type: 'date' },
      { header: t('trips.returnDate'), key: 'return_date', type: 'date' }, { header: t('trips.catch'), key: 'catch_kg', type: 'qty' },
      { header: t('trips.sales'), key: 'sales_total', type: 'money' }, { header: t('trips.income'), key: 'other_income', type: 'money' },
      { header: t('trips.expenses'), key: 'expenses', type: 'money' }, { header: t('trips.profit'), key: 'trip_profit', type: 'money' },
      { header: t('common.status'), key: 'status', value: (r) => t(`status.${r.status}`) },
    ] },
  { key: 'boatPerformance', group: 'finance', perm: 'reports.financial',
    load: (c) => rpc<Row[]>('boat_performance', { p_from: c.range.from, p_to: c.range.to }),
    columns: (t) => [
      { header: t('common.boat'), key: 'boat_name' }, { header: t('nav.trips'), key: 'trips', type: 'number' }, { header: t('trips.catch'), key: 'catch_kg', type: 'qty' },
      { header: t('dashboard.income'), key: 'revenue', type: 'money' }, { header: t('dashboard.expenses'), key: 'expenses', type: 'money' },
      { header: t('dashboard.operatingProfit'), key: 'operating_profit', type: 'money' }, { header: t('dashboard.crewWages'), key: 'crew_wages', type: 'money' },
      { header: t('dashboard.netProfit'), key: 'net_profit', type: 'money' },
    ] },
  { key: 'salesCatch', group: 'finance', perm: 'reports.view', boatFilter: true,
    load: (c) => fetchAll('v_fish_sales', { filters: [...inRange('date', c), ['status', 'eq', 'recorded']], sort: { column: 'date', ascending: true } }),
    columns: (t) => [
      { header: t('common.code'), key: 'sale_code' }, { header: t('common.date'), key: 'date', type: 'date' }, { header: t('common.trip'), key: 'trip_code' },
      { header: t('common.boat'), key: 'boat_name' }, { header: t('sales.fishType'), key: 'fish_name_en' }, { header: t('common.quantity'), key: 'quantity', type: 'qty' },
      { header: t('common.unit'), key: 'unit' }, { header: t('common.unitPrice'), key: 'unit_price', type: 'money' }, { header: t('common.total'), key: 'total', type: 'money' },
      { header: t('common.customer'), key: 'customer_name' }, { header: t('sales.received'), key: 'amount_received', type: 'money' },
      { header: t('common.outstanding'), key: 'outstanding', type: 'money' },
    ] },
  { key: 'expenseBills', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => fetchAll('v_transactions', { filters: [...inRange('date', c), ['kind', 'eq', 'expense'], ['status', 'eq', 'approved']], sort: { column: 'date', ascending: true } }),
    columns: (t) => [
      { header: t('common.code'), key: 'txn_code' }, { header: t('common.date'), key: 'date', type: 'date' }, { header: t('common.category'), key: 'category_name_en' },
      { header: t('common.description'), key: 'description' }, { header: t('common.supplier'), key: 'supplier_name' }, { header: t('common.boat'), key: 'boat_name' },
      { header: t('common.trip'), key: 'trip_code' }, { header: 'Bill ref.', key: 'bill_code' }, { header: t('bills.invoiceNo'), key: 'reference' },
      { header: t('common.amount'), key: 'amount', type: 'money' }, { header: t('ledger.paymentStatus'), key: 'payment_status', value: (r) => t(`status.${r.payment_status}`) },
      { header: t('ledger.hasDocument'), key: 'has_document', value: (r) => (r.has_document ? '✓' : '—') },
    ] },
  { key: 'customerBalances', group: 'finance', perm: 'reports.financial', noDate: true,
    load: () => fetchAll('v_customer_balances', { sort: { column: 'outstanding', ascending: false } }),
    columns: (t) => [{ header: t('common.customer'), key: 'name' }, { header: t('suppliers.totalSales'), key: 'total_sales', type: 'money' },
      { header: t('suppliers.received'), key: 'total_received', type: 'money' }, { header: t('common.outstanding'), key: 'outstanding', type: 'money' }] },
  { key: 'ownerAllocation', group: 'finance', perm: 'reports.financial', boatFilter: true,
    load: (c) => fetchAll('v_payrolls', { filters: [...inRange('period_end', c), ['status', 'eq', 'finalized']], sort: { column: 'period_end', ascending: true } }),
    columns: (t) => [
      { header: t('common.code'), key: 'payroll_code' }, { header: t('common.boat'), key: 'boat_name' }, { header: t('common.trip'), key: 'trip_code' },
      { header: t('common.to'), key: 'period_end', type: 'date' }, { header: t('payroll.base'), key: 'base_amount', type: 'money' },
      { header: t('payroll.pool'), key: 'crew_pool', type: 'money' }, { header: t('payroll.ownerAllocation'), key: 'owner_allocation', type: 'money' },
      { header: t('payroll.totalBonuses'), key: 'total_bonuses', type: 'money' }, { header: t('payroll.ownerRemaining'), key: 'owner_remaining', type: 'money' },
    ] },
  // Bills
  { key: 'billsRegister', group: 'bills', perm: 'bills.view', boatFilter: true, load: (c) => fetchAll('v_bills', { filters: inRange('bill_date', c), sort: { column: 'bill_date', ascending: true } }), columns: billCols },
  { key: 'paidBills', group: 'bills', perm: 'bills.view', boatFilter: true, load: (c) => fetchAll('v_bills', { filters: [...inRange('bill_date', c), ['status', 'eq', 'paid']] }), columns: billCols },
  { key: 'unpaidBills', group: 'bills', perm: 'bills.view', boatFilter: true, load: (c) => fetchAll('v_bills', { filters: [...inRange('bill_date', c), ['status', 'in', ['approved', 'partially_paid']]] }), columns: billCols },
  { key: 'overdueBills', group: 'bills', perm: 'bills.view', boatFilter: true, noDate: true, load: (c) => fetchAll('v_bills', { filters: [['display_status', 'eq', 'overdue'], ...(c.boat ? [['boat_id', 'eq', c.boat] as Filter] : [])], sort: { column: 'due_date', ascending: true } }),
    columns: (t) => [...billCols(t), { header: t('bills.daysOverdue'), key: 'days_overdue', type: 'number' }] },
  { key: 'billsBySupplier', group: 'bills', perm: 'bills.view', boatFilter: true, load: async (c) => groupBy(await approvedBills(c), (r) => r.supplier_id, (r) => r.supplier_name), columns: groupCols('common.supplier') },
  { key: 'billsByBoat', group: 'bills', perm: 'bills.view', load: async (c) => groupBy(await approvedBills(c), (r) => `${r.boat_id}|${r.trip_id}`, (r) => `${r.boat_name ?? '—'}${r.trip_code ? ` · ${r.trip_code}` : ''}`), columns: groupCols('common.boat') },
  { key: 'billsByCategory', group: 'bills', perm: 'bills.view', boatFilter: true, load: async (c) => groupBy(await approvedBills(c), (r) => r.category_id, (r) => r.category_name_en), columns: groupCols('common.category') },
  { key: 'billsByUser', group: 'bills', perm: 'bills.view', boatFilter: true, load: async (c) => groupBy(await fetchAll('v_bills', { filters: inRange('bill_date', c) }), (r) => r.created_by, (r) => r.entered_by_name), columns: groupCols('bills.uploadedBy') },
  { key: 'supplierBalances', group: 'bills', perm: 'bills.view', noDate: true, load: () => fetchAll('v_supplier_balances', { sort: { column: 'outstanding', ascending: false } }),
    columns: (t) => [{ header: t('common.supplier'), key: 'name' }, { header: t('suppliers.totalBilled'), key: 'total_billed', type: 'money' },
      { header: t('suppliers.totalPaid'), key: 'total_paid', type: 'money' }, { header: t('common.outstanding'), key: 'outstanding', type: 'money' },
      { header: t('suppliers.overdue'), key: 'overdue', type: 'money' }, { header: t('suppliers.openBills'), key: 'open_bills', type: 'number' },
      { header: t('suppliers.credit'), key: 'credit_to_reconcile', type: 'money' }] },
  // Crew & payroll
  { key: 'attendance', group: 'crew', perm: 'attendance.view', boatFilter: true,
    load: async (c) => {
      const rows = await fetchAll('v_attendance', { filters: inRange('date', c) });
      const m = new Map<string, Row>();
      for (const r of rows) {
        const g = m.get(r.crew_id) ?? { crew_code: r.crew_code, name_en: r.crew_name_en, name_dv: r.crew_name_dv, boat_name: r.boat_name, present: 0, absent: 0, sick_leave: 0, approved_leave: 0, total: 0 };
        g[r.status] += 1; g.total += 1; m.set(r.crew_id, g);
      }
      return [...m.values()].sort((a, b) => String(a.crew_code).localeCompare(String(b.crew_code)));
    },
    columns: (t) => [{ header: t('crew.code'), key: 'crew_code' }, { header: t('common.nameEn'), key: 'name_en' }, { header: t('common.nameDv'), key: 'name_dv' },
      { header: t('common.boat'), key: 'boat_name' }, ...(['present', 'absent', 'sick_leave', 'approved_leave'] as const).map((s) => ({ header: t(`attendanceStatus.${s}`), key: s, type: 'number' as const })),
      { header: t('common.total'), key: 'total', type: 'number' }] },
  { key: 'wages', group: 'crew', perm: 'payroll.view', boatFilter: true,
    load: async (c) => {
      const prs = await fetchAll('v_payrolls', { filters: [...inRange('period_end', c), ['status', 'eq', 'finalized']] });
      if (!prs.length) return [];
      const by = new Map(prs.map((p) => [p.id, p]));
      const calcs = await fetchAll('v_wage_calculations', { filters: [['payroll_id', 'in', prs.map((p) => p.id)]] });
      return calcs.map((w) => ({ ...w, payroll_code: by.get(w.payroll_id)?.payroll_code, boat_name: by.get(w.payroll_id)?.boat_name, period_end: by.get(w.payroll_id)?.period_end,
        share: Number(w.ordinary_wage) + Number(w.percentage_share) + Number(w.fixed_wage) + Number(w.attendance_adjustment) }));
    },
    columns: (t) => [{ header: t('nav.payroll'), key: 'payroll_code' }, { header: t('common.boat'), key: 'boat_name' }, { header: t('common.to'), key: 'period_end', type: 'date' },
      { header: t('crew.code'), key: 'crew_code' }, { header: t('common.crewMember'), key: 'crew_name_en' }, { header: t('payroll.daysWorked'), key: 'days_present', type: 'number' },
      { header: t('payroll.share'), key: 'share', type: 'money' }, { header: t('slip.bonus'), key: 'bonus', type: 'money' }, { header: t('slip.otherEarnings'), key: 'other_earnings', type: 'money' },
      { header: t('slip.gross'), key: 'gross', type: 'money' }, { header: t('slip.advances'), key: 'advance_deduction', type: 'money' }, { header: t('slip.fishTaken'), key: 'fish_deduction', type: 'money' },
      { header: t('slip.otherDeductions'), key: 'other_deductions', type: 'money' }, { header: t('slip.totalDeductions'), key: 'total_deductions', type: 'money' }, { header: t('slip.net'), key: 'net', type: 'money' }] },
  { key: 'bonuses', group: 'crew', perm: 'bonuses.view', boatFilter: true, load: (c) => fetchAll('v_bonuses', { filters: inRange('created_at', c) }),
    columns: (t) => [{ header: t('common.code'), key: 'bonus_code' }, { header: t('nav.payroll'), key: 'payroll_code' }, { header: t('common.boat'), key: 'boat_name' },
      { header: t('common.crewMember'), key: 'crew_name_en' }, { header: t('bonus.kind'), key: 'kind' }, { header: '%', key: 'percent', type: 'number' },
      { header: t('common.amount'), key: 'amount', type: 'money' }, { header: t('common.status'), key: 'status', value: (r) => t(`status.${r.status}`) }] },
  { key: 'advances', group: 'crew', perm: 'advances.view', boatFilter: true, load: (c) => fetchAll('v_cash_advances', { filters: inRange('date', c) }),
    columns: (t) => [{ header: t('common.code'), key: 'advance_code' }, { header: t('common.date'), key: 'date', type: 'date' }, { header: t('common.crewMember'), key: 'crew_name_en' },
      { header: t('common.boat'), key: 'boat_name' }, { header: t('common.reason'), key: 'reason' }, { header: t('common.amount'), key: 'amount', type: 'money' },
      { header: t('advance.recovered'), key: 'recovered', type: 'money' }, { header: t('advance.outstanding'), key: 'outstanding', type: 'money' },
      { header: t('common.status'), key: 'status', value: (r) => t(`status.${r.status}`) }] },
  { key: 'fishTaken', group: 'crew', perm: 'fish_taken.view', boatFilter: true, load: (c) => fetchAll('v_fish_taken', { filters: inRange('date', c) }),
    columns: (t) => [{ header: t('common.code'), key: 'fish_taken_code' }, { header: t('common.date'), key: 'date', type: 'date' }, { header: t('common.crewMember'), key: 'crew_name_en' },
      { header: t('sales.fishType'), key: 'fish_name_en' }, { header: t('common.quantity'), key: 'quantity', type: 'qty' }, { header: t('common.unit'), key: 'unit' },
      { header: t('fishTaken.agreedPrice'), key: 'unit_price', type: 'money' }, { header: t('fishTaken.totalValue'), key: 'total', type: 'money' },
      { header: t('fishTaken.deductedIn'), key: 'payroll_code' }, { header: t('common.status'), key: 'status', value: (r) => t(`status.${r.status}`) }] },
  { key: 'crewPayments', group: 'crew', perm: 'crew_payments.view', boatFilter: true, load: (c) => fetchAll('v_crew_payments', { filters: [...inRange('date', c), ['status', 'eq', 'valid']] }),
    columns: (t) => [{ header: t('common.code'), key: 'payment_code' }, { header: t('common.date'), key: 'date', type: 'date' }, { header: t('common.crewMember'), key: 'crew_name_en' },
      { header: t('common.boat'), key: 'boat_name' }, { header: t('crewPay.slip'), key: 'slip_no' }, { header: t('common.method'), key: 'method' },
      { header: t('common.reference'), key: 'reference' }, { header: t('common.amount'), key: 'amount', type: 'money' }] },
  { key: 'wageLiabilities', group: 'crew', perm: 'payroll.view', boatFilter: true, noDate: true,
    load: (c) => fetchAll('v_wage_slips', { filters: [['status', 'eq', 'issued'], ['remaining', 'gt', 0], ...(c.boat ? [['boat_id', 'eq', c.boat] as Filter] : [])] }),
    columns: (t) => [{ header: t('slip.slipNo'), key: 'slip_no' }, { header: t('common.crewMember'), key: 'crew_name_en' }, { header: t('common.boat'), key: 'boat_name' },
      { header: t('nav.payroll'), key: 'payroll_code' }, { header: t('crewPay.netPayable'), key: 'net_payable', type: 'money' },
      { header: t('crewPay.alreadyPaid'), key: 'amount_paid', type: 'money' }, { header: t('crewPay.remaining'), key: 'remaining', type: 'money' }] },
  // Operations
  { key: 'audit', group: 'operations', perm: 'audit.view',
    load: (c) => fetchAll('v_audit_logs', { filters: inRange('created_at', c, null), sort: { column: 'created_at', ascending: false } }, 5000),
    columns: (t) => [{ header: t('audit.when'), key: 'created_at', type: 'datetime' }, { header: t('audit.user'), key: 'user_name' },
      { header: t('audit.table'), key: 'table_name' }, { header: t('audit.action'), key: 'action', value: (r) => t(`audit.${r.action}`) },
      { header: 'ID', key: 'record_id' }, { header: t('audit.changed'), key: 'changed_fields', value: (r) => ((r.changed_fields as string[] | null) ?? []).join(', ') }] },
];

export default function Reports() {
  const { t, lang } = useI18n();
  const { can, currency, company } = useAuth();
  const visible = REPORTS.filter((r) => can(r.perm));
  const [sel, setSel] = useState<ReportDef | null>(visible[0] ?? null);
  const [range, setRange] = useState<DateRange>(defaultRange('month'));
  const [boat, setBoat] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boatsOpt = useOptions('boats', { includeInactive: true });

  const run = async (def = sel) => {
    if (!def) return;
    setLoading(true); setError(null);
    try { setRows(await def.load({ range, boat: def.boatFilter ? boat : null })); }
    catch (e) { setError((e as Error).message); setRows(null); }
    finally { setLoading(false); }
  };

  const cols = useMemo(() => (sel ? sel.columns(t) : []), [sel, t]);
  const totals = useMemo(() => {
    if (!rows || !sel || sel.key === 'summary') return undefined;
    const tt: Record<string, number> = {};
    for (const c of cols) if (c.type === 'money') tt[c.key] = rows.reduce((s, r) => s + Number((c.value ? c.value(r) : r[c.key]) ?? 0), 0);
    return Object.keys(tt).length ? tt : undefined;
  }, [rows, cols, sel]);

  const build = (xl: ExportLang): ExportSpec => {
    const xt = exportT(xl);
    const meta: [string, string][] = [
      [xt('settings.company'), company?.name ?? ''],
      [xt('reports.reportingPeriod'), sel?.noDate ? '—' : `${fmtDate(range.from)} – ${fmtDate(range.to)}`],
      [xt('common.currency'), currency],
      [xt('common.filters'), boat && sel?.boatFilter ? `${xt('common.boat')}: ${boatsOpt.options.find((o) => o.value === boat)?.label ?? ''}` : xt('common.all')],
      [xt('common.generatedOn'), new Date().toLocaleString('en-GB')],
    ];
    return { fileName: `${sel!.key}-${range.from}-${range.to}`, title: xt(`reports.${sel!.key}`), meta, columns: sel!.columns(xt), rows: rows ?? [], totals, lang: xl, currency };
  };

  const fmt = (c: ExportColumn, r: Row) => {
    const v = c.value ? c.value(r) : r[c.key];
    if (v === null || v === undefined || v === '') return '—';
    switch (c.type) {
      case 'money': return <bdi dir="ltr" className={Number(v) < 0 ? 'text-coral-600' : ''}>{money(v, currency)}</bdi>;
      case 'number': return num(v).replace(/\.00$/, '');
      case 'qty': return qty(v);
      case 'date': return fmtDate(v, lang);
      case 'datetime': return String(v).replace('T', ' ').slice(0, 16);
      default: return String(v);
    }
  };

  return (
    <div>
      <PageHeader title={t('reports.title')} />
      <div className="grid gap-5 lg:grid-cols-4">
        <Card padded={false} className="lg:col-span-1">
          <nav className="max-h-[70vh] overflow-y-auto p-2">
            {(['finance', 'bills', 'crew', 'operations'] as const).map((g) => {
              const list = visible.filter((r) => r.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="mb-2">
                  <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t(`reports.groups.${g}`)}</div>
                  {list.map((r) => (
                    <button key={r.key} onClick={() => { setSel(r); setRows(null); }}
                      className={cx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm', sel?.key === r.key ? 'bg-ocean-50 font-medium text-ocean-800' : 'text-slate-700 hover:bg-slate-50')}>
                      <Icon name="chart" size={14} className="text-ocean-500" />{t(`reports.${r.key}`)}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </Card>
        <div className="space-y-4 lg:col-span-3">
          {!sel ? <Alert tone="warn">{t('common.noAccess')}</Alert> : (
            <Card title={t(`reports.${sel.key}`)} actions={rows && <ExportMenu build={build} disabled={!rows.length} />}>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                {!sel.noDate && <DateRangeFilter value={range} onChange={setRange} />}
                {sel.boatFilter && <div className="w-48"><Field label={t('common.boat')}><RefSelect kind="boats" value={boat} onChange={setBoat} placeholder={t('dashboard.allBoats')} params={{ includeInactive: true }} /></Field></div>}
                <Button variant="primary" icon="refresh" loading={loading} onClick={() => run()}>{t('reports.run')}</Button>
              </div>
              {error && <Alert tone="error">{error}</Alert>}
              {loading ? <Spinner /> : rows && (
                rows.length === 0 ? <div className="py-8 text-center text-sm text-slate-500">{t('common.noResults')}</div> : (
                  <div className="overflow-x-auto">
                    <div className="mb-2 text-xs text-slate-500">
                      {t('reports.reportingPeriod')}: {sel.noDate ? '—' : `${fmtDate(range.from, lang)} – ${fmtDate(range.to, lang)}`} · {t('common.currency')}: {currency} · {t('common.generatedOn')}: {new Date().toLocaleString('en-GB')} · {rows.length} {t('common.rows')}
                    </div>
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50"><tr>{cols.map((c) => <th key={c.key} className={cx('whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-500', c.type === 'money' || c.type === 'number' || c.type === 'qty' ? 'text-end' : 'text-start')}>{c.header}</th>)}</tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.slice(0, 1000).map((r, i) => (
                          <tr key={i} className={sel.key === 'summary' && ['dashboard.netProfit', 'dashboard.operatingProfit'].includes(r.line) ? 'bg-ocean-50 font-semibold' : ''}>
                            {cols.map((c) => <td key={c.key} className={cx('whitespace-nowrap px-3 py-1.5', c.type === 'money' || c.type === 'number' || c.type === 'qty' ? 'text-end' : 'text-start')}>{fmt(c, r)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                      {totals && <tfoot className="bg-slate-50 font-semibold"><tr>{cols.map((c, i) => <td key={c.key} className={cx('px-3 py-2', c.type === 'money' ? 'text-end' : '')}>{totals[c.key] !== undefined ? <bdi dir="ltr">{money(totals[c.key], currency)}</bdi> : i === 0 ? t('common.total') : ''}</td>)}</tr></tfoot>}
                    </table>
                    {rows.length > 1000 && <div className="mt-2 text-xs text-slate-500">1000 / {rows.length} — {t('common.export')}</div>}
                  </div>
                ))}
              {!rows && !loading && <div className="py-8 text-center text-sm text-slate-500">{t('reports.run')} ↑</div>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
