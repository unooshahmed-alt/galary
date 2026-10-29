import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, rpc, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname } from '@/lib/format';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { RecordActions } from '@/components/Workflow';
import { useConfirm } from '@/components/Modal';
import { useToast } from '@/components/Toast';

export default function Approvals() {
  const { t, lang } = useI18n();
  const { can, currency } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [tick, setTick] = useState(0);
  const pending = (src: string, perm: string) => (can(perm) ? fetchAll(src, { filters: [['status', 'eq', 'pending_approval']], sort: { column: 'created_at', ascending: true } }) : Promise.resolve([]));
  const data = useAsync(async () => {
    const [bills, txns, adv, fish, bonus, adj, payrolls, rules] = await Promise.all([
      pending('v_bills', 'bills.approve'), pending('v_transactions', 'transactions.approve'), pending('v_cash_advances', 'advances.approve'),
      pending('v_fish_taken', 'fish_taken.approve'), pending('v_bonuses', 'bonuses.approve'), pending('v_payroll_adjustments', 'adjustments.approve'),
      pending('v_payrolls', 'payroll.approve'), pending('v_wage_rule_versions', 'wage_rules.approve'),
    ]);
    return { bills, txns, adv, fish, bonus, adj, payrolls, rules };
  }, [tick]);
  const reload = () => setTick((x) => x + 1);
  const m = (v: unknown) => money(v, currency);

  const txnAct = async (r: Row, action: 'approve' | 'reject') => {
    const reason = await confirm({ title: `${t(`common.${action}`)} · ${r.txn_code}`, reason: action === 'reject' ? true : 'optional', tone: action === 'approve' ? 'success' : 'danger' });
    if (reason === null) return;
    try { await rpc('set_transaction_status', { p_id: r.id, p_action: action, p_comment: reason || null }); reload(); } catch (e) { toast.error(errorText(e, t)); }
  };

  if (data.loading && !data.data) return <Spinner />;
  const d = data.data!;
  const total = Object.values(d).reduce((s, l) => s + l.length, 0);

  const Section = ({ title, rows, render }: { title: string; rows: Row[]; render: (r: Row) => ReactNode }) => rows.length ? (
    <Card title={`${title} (${rows.length})`} padded={false}>
      <ul className="divide-y divide-slate-100">{rows.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">{render(r)}</li>)}</ul>
    </Card>
  ) : null;

  return (
    <div>
      {dialog}
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.pending')} />
      {total === 0 ? <Card><EmptyState icon="check" title={t('approvals.empty')} /></Card> : (
        <div className="space-y-4">
          <Section title={t('nav.bills')} rows={d.bills} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.bill_code}</b> · {r.supplier_name} · {r.invoice_no} · {fmtDate(r.bill_date, lang)}</div>
            <b dir="ltr">{m(r.total)}</b><Button size="sm" variant="primary" onClick={() => nav(`/bills/${r.id}`)}>{t('common.open')}</Button></>} />
          <Section title={`${t('nav.income')} / ${t('nav.expenses')}`} rows={d.txns} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.txn_code}</b> · {t(r.kind === 'income' ? 'nav.income' : 'nav.expenses')} · {dname(r.category_name_en, r.category_name_dv, lang)} · {r.description ?? ''} · {r.created_by_name}</div>
            <b dir="ltr">{m(r.amount)}</b>
            <Button size="sm" variant="success" onClick={() => txnAct(r, 'approve')}>{t('common.approve')}</Button>
            <Button size="sm" onClick={() => txnAct(r, 'reject')}>{t('common.reject')}</Button></>} />
          <Section title={t('nav.payroll')} rows={d.payrolls} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.payroll_code}</b> · {r.boat_name} {r.trip_code ?? ''}</div>
            <b dir="ltr">{m(r.total_net)}</b><Button size="sm" variant="primary" onClick={() => nav(`/payroll/${r.id}`)}>{t('common.open')}</Button></>} />
          <Section title={t('nav.wageRules')} rows={d.rules} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.rule_name} v{r.version}</b> · {r.boat_name} · {fmtDate(r.effective_from, lang)}</div>
            <Button size="sm" variant="primary" onClick={() => nav(`/wage-rules?boat=${r.boat_id}`)}>{t('common.open')}</Button></>} />
          <Section title={t('nav.advances')} rows={d.adv} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.advance_code}</b> · {dname(r.crew_name_en, r.crew_name_dv, lang)} · {r.reason}</div>
            <b dir="ltr">{m(r.amount)}</b><RecordActions table="cash_advances" row={r} onDone={reload} /></>} />
          <Section title={t('nav.fishTaken')} rows={d.fish} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.fish_taken_code}</b> · {dname(r.crew_name_en, r.crew_name_dv, lang)} · {dname(r.fish_name_en, r.fish_name_dv, lang)}</div>
            <b dir="ltr">{m(r.total)}</b><RecordActions table="fish_taken" row={r} onDone={reload} /></>} />
          <Section title={t('nav.bonuses')} rows={d.bonus} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.bonus_code}</b> · {dname(r.crew_name_en, r.crew_name_dv, lang)} · {r.payroll_code} · {r.kind === 'percent' ? `${r.percent}%` : m(r.fixed_amount)}</div>
            <RecordActions table="crew_bonuses" row={r} onDone={reload} /></>} />
          <Section title={t('nav.adjustments')} rows={d.adj} render={(r) => <>
            <div className="min-w-0 flex-1"><b>{r.adjustment_code}</b> · {dname(r.crew_name_en, r.crew_name_dv, lang)} · {t(`adjustment.${r.kind}`)} · {r.reason}</div>
            <b dir="ltr">{m(r.amount)}</b><RecordActions table="payroll_adjustments" row={r} onDone={reload} /></>} />
        </div>
      )}
    </div>
  );
}
