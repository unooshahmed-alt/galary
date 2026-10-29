import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc, useAsync, type Row } from '@/lib/db';
import { money, monthLabel, date as fmtDate, dname, isoDate } from '@/lib/format';
import { Card, PageHeader, Stat, Spinner, Alert, Money, Badge, Tabs } from '@/components/ui';
import { DateRangeFilter, defaultRange } from '@/components/DateRangeFilter';
import { RefSelect } from '@/components/RefSelect';
import { GroupedBarChart, HBarChart } from '@/components/Charts';
import { Icon } from '@/components/Icon';

export default function Dashboard() {
  const { t, lang } = useI18n();
  const { currency, can } = useAuth();
  const nav = useNavigate();
  const [range, setRange] = useState(defaultRange('month'));
  const [boat, setBoat] = useState<string | null>(null);
  const [grain, setGrain] = useState<'month' | 'year'>('month');
  const m = (v: unknown) => money(v, currency);

  const summary = useAsync(() => rpc<Row>('dashboard_summary', { p_from: range.from, p_to: range.to, p_boat: boat }), [range.from, range.to, boat]);
  const alerts = useAsync(() => rpc<Row[]>('get_alerts'), []);
  const recent = useAsync(() => rpc<Row[]>('recent_activity', { p_limit: 10, p_boat: boat }), [boat]);

  // Chart window: last 12 months (monthly) or last 5 years (yearly), independent of the KPI filter
  const chartRange = useMemo(() => {
    const now = new Date();
    if (grain === 'year') return { from: `${now.getFullYear() - 4}-01-01`, to: `${now.getFullYear()}-12-31` };
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from: isoDate(start), to: isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  }, [grain]);
  const series = useAsync(() => rpc<Row[]>('finance_series', { p_from: chartRange.from, p_to: chartRange.to, p_grain: grain, p_boat: boat }), [chartRange, grain, boat]);
  const perf = useAsync(() => (boat ? Promise.resolve([] as Row[]) : rpc<Row[]>('boat_performance', { p_from: range.from, p_to: range.to })), [range.from, range.to, boat]);

  const s = summary.data ?? {};
  const att = s.attendanceToday ?? {};
  const fin = can('income.view') || can('expenses.view') || can('reports.financial');

  return (
    <div>
      <PageHeader title={t('dashboard.title')}
        actions={<div className="flex flex-wrap items-center gap-2">
          <div className="w-44"><RefSelect kind="boats" value={boat} onChange={setBoat} placeholder={t('dashboard.allBoats')} /></div>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>} />

      {alerts.data && alerts.data.length > 0 && (
        <Card title={t('dashboard.alerts')} className="mb-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {alerts.data.map((a) => (
              <button key={a.key} onClick={() => nav(a.link)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-start text-sm hover:border-ocean-300 hover:bg-ocean-50/40">
                <Icon name="alert" size={16} className={a.severity === 'danger' ? 'text-coral-600' : a.severity === 'warning' ? 'text-amber-600' : 'text-ocean-600'} />
                <span className="flex-1">{t(`alerts.${a.key}`, { count: a.count })}</span>
                <Icon name="chevronRight" size={16} className="text-slate-400 rtl:rotate-180" />
              </button>
            ))}
          </div>
        </Card>
      )}

      {summary.loading && !summary.data ? <div className="py-10 text-center"><Spinner /></div> : summary.error ? <Alert tone="error">{String((summary.error as Error).message)}</Alert> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat icon="boat" label={t('dashboard.boats')} value={`${s.boatsActive ?? 0} / ${s.boatsTotal ?? 0}`} hint={t('common.active')} onClick={() => nav('/boats')} />
            <Stat icon="anchor" label={t('dashboard.activeTrips')} value={s.tripsActive ?? 0} hint={`${t('dashboard.completedTrips')}: ${s.tripsCompleted ?? 0}`} onClick={() => nav('/trips')} />
            <Stat icon="users" label={t('dashboard.activeCrew')} value={s.crewActive ?? 0} onClick={() => nav('/crew')} />
            <Stat icon="calendar" label={t('dashboard.attendanceToday')} value={`${att.present ?? 0} ✓`}
              hint={`${t('attendanceStatus.absent')} ${att.absent ?? 0} · ${t('attendanceStatus.sick_leave')} ${att.sick ?? 0} · ${t('attendanceStatus.approved_leave')} ${att.leave ?? 0}`}
              onClick={() => nav('/attendance')} />
          </div>

          {fin && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">{fmtDate(range.from, lang)} – {fmtDate(range.to, lang)}</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Stat label={t('dashboard.fishSales')} value={m(s.fishSales)} icon="fish" />
                <Stat label={t('dashboard.otherIncome')} value={m(s.otherIncome)} icon="up" />
                <Stat label={t('dashboard.expenses')} value={m(s.expenses)} icon="down" />
                <Stat label={t('dashboard.operatingProfit')} value={m(s.operatingProfit)} tone={Number(s.operatingProfit) < 0 ? 'bad' : 'default'} />
                <Stat label={t('dashboard.crewWages')} value={m(s.crewWages)} icon="calculator" />
                <Stat label={t('dashboard.netProfit')} value={m(s.netProfit)} tone={Number(s.netProfit) < 0 ? 'bad' : 'good'} />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">{t('dashboard.formulaNote')}</p>
            </>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {can('payroll.view') && <Stat label={t('dashboard.wageLiabilities')} value={m(s.wageLiabilities)} hint={`${s.wagesAwaitingPayment ?? 0} · ${t('dashboard.wagesAwaiting')}`} tone="warn" onClick={() => nav('/crew-payments')} />}
            {can('bonuses.view') && <Stat label={t('dashboard.bonuses')} value={m(s.bonusesAllocated)} icon="gift" />}
            {can('advances.view') && <Stat label={t('dashboard.advances')} value={m(s.advancesOutstanding)} icon="wallet" onClick={() => nav('/advances')} />}
            {can('bills.view') && <Stat label={t('dashboard.supplierOutstanding')} value={m(s.supplierOutstanding)} tone={Number(s.billsOverdue) > 0 ? 'bad' : 'default'}
              hint={`${t('dashboard.unpaidBills')} ${s.billsUnpaid ?? 0} · ${t('dashboard.partialBills')} ${s.billsPartiallyPaid ?? 0} · ${t('status.overdue')} ${s.billsOverdue ?? 0}`} onClick={() => nav('/bills')} />}
            {can('sales.view') && <Stat label={t('dashboard.receivables')} value={m(s.receivables)} onClick={() => nav('/sales')} />}
            {fin && <Stat label={t('dashboard.cashIn')} value={m(s.cashIn)} tone="good" />}
            {fin && <Stat label={t('dashboard.cashOut')} value={m(s.cashOut)} />}
            {can('payroll.view') && <Stat label={t('alerts.payroll_pending_approval', { count: s.payrollPendingApproval ?? 0 })} value={s.payrollPendingApproval ?? 0} onClick={() => nav('/payroll')} />}
          </div>
        </>
      )}

      {fin && (
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('dashboard.incomeVsExpense')}
            actions={<Tabs tabs={[{ id: 'month', label: t('dashboard.monthly') }, { id: 'year', label: t('dashboard.yearly') }]} value={grain} onChange={setGrain} />}>
            {series.loading ? <Spinner /> : (
              <GroupedBarChart
                categories={(series.data ?? []).map((r) => (grain === 'month' ? monthLabel(r.period, lang) : String(r.period).slice(0, 4)))}
                series={[
                  { name: t('dashboard.income'), values: (series.data ?? []).map((r) => Number(r.income)) },
                  { name: t('dashboard.expense'), values: (series.data ?? []).map((r) => Number(r.expense)) },
                ]}
                format={m} />
            )}
          </Card>
          <Card title={t('dashboard.boatPerformance')}>
            {boat ? <div className="text-sm text-slate-500">{t('dashboard.allBoats')}…</div> : perf.loading ? <Spinner /> : (perf.data ?? []).length === 0 ? (
              <div className="text-sm text-slate-500">{t('common.noRecords')}</div>
            ) : (
              <HBarChart format={m} items={(perf.data ?? []).map((b) => ({
                label: dname(b.boat_name, b.boat_name_dv, lang), value: Number(b.net_profit),
                sub: `${t('dashboard.income')} ${m(b.revenue)} · ${t('dashboard.expense')} ${m(b.expenses)} · ${t('dashboard.crewWages')} ${m(b.crew_wages)}`,
              }))} />
            )}
          </Card>
        </div>
      )}

      <Card title={t('dashboard.recent')} className="mt-6" padded={false}>
        {recent.loading ? <div className="p-4"><Spinner /></div> : (recent.data ?? []).length === 0 ? (
          <div className="p-4 text-sm text-slate-500">{t('common.noRecords')}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(recent.data ?? []).map((r) => (
              <li key={`${r.kind}-${r.id}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`rounded-full p-1.5 ${r.direction === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-orange-50 text-orange-700'}`}>
                  <Icon name={r.direction === 'in' ? 'up' : 'down'} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-slate-800">{r.description}</div>
                  <div className="text-xs text-slate-500">{r.code} · {fmtDate(r.date, lang)} <Badge>{kindLabel(r.kind, t)}</Badge></div>
                </div>
                <Money value={r.direction === 'in' ? r.amount : -r.amount} currency={currency} className="font-medium" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function kindLabel(kind: string, t: (k: string) => string) {
  return ({ fish_sale: t('sales.sales'), income: t('nav.income'), expense: t('nav.expenses'), bill_payment: t('bills.payments'), crew_payment: t('nav.crewPayments') } as Record<string, string>)[kind] ?? kind;
}
