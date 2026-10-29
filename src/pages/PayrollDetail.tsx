import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { EngineResult, CrewResult } from '@engine';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { callFunction, fetchAll, fetchOne, rpc, updateRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname } from '@/lib/format';
import { Alert, Button, Card, Field, Input, KV, PageHeader, Spinner, Stat, StatusBadge, Tabs, Money, Textarea } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { Modal, useConfirm } from '@/components/Modal';
import { RefSelect } from '@/components/RefSelect';
import { ApprovalHistory } from '@/components/Workflow';
import { SlipButtons } from '@/components/SlipButtons';
import { useToast } from '@/components/Toast';
import { RuleSummary } from './WageRules';

type Tab = 'calculation' | 'slips' | 'history';

export default function PayrollDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can, currency, isOwner } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const m = (v: unknown) => money(v, currency);
  const [tab, setTab] = useState<Tab>('calculation');
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<EngineResult | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [settings, setSettings] = useState<Row | null>(null);
  const reload = () => setTick((x) => x + 1);

  const p = useAsync(() => fetchOne('v_payrolls', id!), [id, tick]);
  const calcs = useAsync(() => fetchAll('v_wage_calculations', { filters: [['payroll_id', 'eq', id]], sort: { column: 'crew_code', ascending: true } }), [id, tick]);
  const slips = useAsync(() => fetchAll('v_wage_slips', { filters: [['payroll_id', 'eq', id]], sort: { column: 'crew_code', ascending: true } }), [id, tick]);
  const rule = useAsync(async () => (p.data?.rule_version_id ? fetchOne('wage_rule_versions', p.data.rule_version_id) : null), [p.data?.rule_version_id]);

  if (p.loading && !p.data) return <Spinner />;
  const pr = p.data;
  if (!pr) return <Alert tone="warn">{t('errors.notFound')}</Alert>;
  const st = pr.status as string;
  const editable = st === 'draft' || st === 'calculated';

  const runEngine = async (action: 'preview' | 'calculate') => {
    setBusy(action);
    try {
      const r = await callFunction<{ result: EngineResult }>('payroll', { action, payrollId: pr.id });
      if (action === 'preview') setPreview(r.result);
      else { setPreview(null); toast.success(t('common.success')); reload(); }
    } catch (e) {
      const payload = (e as { payload?: { result?: EngineResult } }).payload;
      if (payload?.result) setPreview(payload.result);
      toast.error(errorText(e, t));
    } finally { setBusy(null); }
  };

  const workflow = async (fn: string, opts: { title: string; message?: string; reason?: boolean | 'optional'; tone?: 'primary' | 'success' | 'danger'; arg?: string }) => {
    const r = await confirm({ title: opts.title, message: opts.message, reason: opts.reason, tone: opts.tone });
    if (r === null) return;
    setBusy(fn);
    try {
      await rpc(fn, { p_payroll: pr.id, [opts.arg ?? 'p_comment']: r || null });
      toast.success(t('common.success'));
      if (fn === 'finalize_payroll') setTab('slips');
      reload();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(null); }
  };

  const slipAction = async (s: Row, fn: 'reissue_wage_slip' | 'acknowledge_wage_slip') => {
    const r = await confirm({ title: fn === 'reissue_wage_slip' ? t('slip.reissue') : t('slip.acknowledge'), reason: fn === 'reissue_wage_slip' ? true : 'optional' });
    if (r === null) return;
    try {
      await rpc(fn, fn === 'reissue_wage_slip' ? { p_slip: s.id, p_reason: r } : { p_slip: s.id, p_note: r || null });
      toast.success(t('common.success')); reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const saveSettings = async () => {
    try {
      await updateRow('payroll_periods', pr.id, {
        rule_version_id: settings!.rule_version_id, custom_base_amount: settings!.custom_base_amount === '' ? null : Number(settings!.custom_base_amount),
        notes: settings!.notes || null, ...(pr.trip_id ? {} : { period_start: settings!.period_start, period_end: settings!.period_end }),
      });
      setSettings(null); reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };

  // What to show in the crew table: the saved calculation, or a preview
  const rows: Row[] = preview
    ? preview.crew.map((c: CrewResult) => ({ ...c, crew_id: c.crewId, crew_code: c.code, crew_name_en: c.nameEn, crew_name_dv: c.nameDv,
        ordinary_wage: c.ordinaryWage, percentage_share: c.percentageShare, fixed_wage: c.fixedWage, attendance_adjustment: c.attendanceAdjustment,
        other_earnings: c.otherEarnings, advance_deduction: c.advanceDeduction, fish_deduction: c.fishDeduction, other_deductions: c.otherDeductions,
        carry_forward_deduction: c.carryForwardDeduction, total_deductions: c.totalDeductions, days_present: c.daysPresent, days_eligible: c.daysEligible,
        unrecovered_advance: c.unrecoveredAdvance, negative_balance: c.negativeBalance }))
    : (calcs.data ?? []);
  const summary = preview ? preview.summary : {
    baseAmount: pr.base_amount, crewPool: pr.crew_pool, ownerAllocation: pr.owner_allocation, totalBonuses: pr.total_bonuses,
    ownerRemaining: pr.owner_remaining, totalGross: pr.total_gross, totalDeductions: pr.total_deductions, totalNet: pr.total_net,
    baseFormula: (pr.result_snapshot as Row | null)?.summary?.baseFormula,
  };
  const warnings: Row[] = preview ? preview.warnings : (pr.warnings ?? []);
  const errors: Row[] = preview ? preview.errors : [];
  const crewName = (cid?: string) => { const r = rows.find((x) => x.crew_id === cid); return r ? dname(r.crew_name_en, r.crew_name_dv, lang) : ''; };

  return (
    <div>
      {dialog}
      <PageHeader back={() => nav('/payroll')} title={`${pr.payroll_code} · ${dname(pr.boat_name, pr.boat_name_dv, lang)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{pr.trip_code && `${pr.trip_code} · `}{fmtDate(pr.period_start, lang)} – {fmtDate(pr.period_end, lang)} <StatusBadge status={st} /></span>}
        actions={<>
          {editable && can('payroll.prepare') && <>
            <Button icon="edit" onClick={() => setSettings({ rule_version_id: pr.rule_version_id, custom_base_amount: pr.custom_base_amount ?? '', notes: pr.notes ?? '', period_start: pr.period_start, period_end: pr.period_end })}>{t('common.edit')}</Button>
            <Button icon="eye" loading={busy === 'preview'} onClick={() => runEngine('preview')}>{t('payroll.preview')}</Button>
            <Button variant="primary" icon="calculator" loading={busy === 'calculate'} onClick={() => runEngine('calculate')}>{st === 'calculated' ? t('payroll.recalculate') : t('payroll.calculate')}</Button>
          </>}
          {st === 'calculated' && can('payroll.prepare') && <Button variant="primary" onClick={() => workflow('submit_payroll', { title: t('payroll.submit'), reason: 'optional' })}>{t('payroll.submit')}</Button>}
          {st === 'pending_approval' && can('payroll.approve') && <Button variant="success" icon="check" onClick={() => workflow('approve_payroll', { title: t('payroll.approve'), reason: 'optional', tone: 'success' })}>{t('payroll.approve')}</Button>}
          {(st === 'pending_approval' || st === 'approved') && can('payroll.approve') && <Button onClick={() => workflow('return_payroll', { title: t('payroll.returnIt'), reason: true })}>{t('payroll.returnIt')}</Button>}
          {st === 'approved' && can('payroll.finalize') && <Button variant="success" onClick={() => workflow('finalize_payroll', { title: t('payroll.finalize'), message: t('payroll.finalizeConfirm'), reason: 'optional', tone: 'success' })}>{t('payroll.finalize')}</Button>}
          {st === 'finalized' && isOwner && <Button variant="danger" onClick={() => workflow('reverse_payroll', { title: t('payroll.reverse'), message: t('payroll.reverseConfirm'), reason: true, tone: 'danger', arg: 'p_reason' })}>{t('payroll.reverse')}</Button>}
          {editable && can('bonuses.manage') && <Button icon="gift" onClick={() => nav(`/bonuses?payroll=${pr.id}`)}>{t('nav.bonuses')}</Button>}
        </>} />

      {preview && <div className="mb-4"><Alert tone="info" title={t('payroll.preview')}>{t('payroll.previewNote')} <button className="underline" onClick={() => setPreview(null)}>{t('common.clear')}</button></Alert></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('payroll.base')} value={m(summary.baseAmount)} hint={summary.baseFormula} />
        <Stat label={t('payroll.pool')} value={m(summary.crewPool)} hint={rule.data ? <RuleSummary cfg={rule.data.config} /> : undefined} />
        <Stat label={t('payroll.ownerAllocation')} value={m(summary.ownerAllocation)} />
        <Stat label={t('payroll.totalBonuses')} value={m(summary.totalBonuses)} hint={`${t('payroll.ownerRemaining')}: ${m(summary.ownerRemaining)}`} />
        <Stat label={t('payroll.totalGross')} value={m(summary.totalGross)} />
        <Stat label={t('payroll.totalDeductions')} value={m(summary.totalDeductions)} />
        <Stat label={t('payroll.totalNet')} value={m(summary.totalNet)} tone="good" />
        <Stat label={t('common.paid')} value={m(pr.total_paid)} hint={`${t('common.remaining')}: ${m(Number(pr.total_net ?? 0) - Number(pr.total_paid ?? 0))}`} />
      </div>

      {errors.length > 0 && <div className="mb-4"><Alert tone="error" title={t('payroll.errors')}>{errors.map((e, i) => <div key={i}>{e.message}{e.crewId ? ` — ${crewName(e.crewId)}` : ''}</div>)}</Alert></div>}
      {warnings.length > 0 && <div className="mb-4"><Alert tone="warn" title={t('payroll.warnings')}>{warnings.map((w, i) => <div key={i}>{w.message}{w.crewId ? ` — ${crewName(w.crewId)}` : ''}</div>)}</Alert></div>}

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'calculation', label: t('payroll.crew') }, { id: 'slips', label: t('payroll.slips'), count: slips.data?.filter((s) => s.status === 'issued').length },
        { id: 'history', label: t('common.history') },
      ]} />

      {tab === 'calculation' && (
        <Card padded={false}>
          <DataTable rows={rows} loading={calcs.loading} rowKey="crew_id" onRowClick={(r) => setOpen(open === r.crew_id ? null : r.crew_id)}
            empty={<div className="p-6 text-center text-sm text-slate-500">{editable ? t('payroll.calculate') : t('common.noRecords')}</div>}
            columns={[
              { key: 'name', label: t('common.crewMember'), render: (r) => (
                <div>
                  <div className="font-medium">{dname(r.crew_name_en, r.crew_name_dv, lang)}</div>
                  <div className="text-xs text-slate-500">{r.crew_code} · {t(`jobRoles.${r.job_role ?? r.role}`)}</div>
                  {open === r.crew_id && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700" dir="ltr" style={{ textAlign: 'left' }}>
                      {((r.details ?? {}).formula ?? []).map((f: string, i: number) => <div key={i}>{f}</div>)}
                    </div>
                  )}
                </div>) },
              { key: 'days', label: t('payroll.daysWorked'), align: 'end', hideSm: true, render: (r) => `${Number(r.days_present)}/${Number(r.days_eligible)}` },
              { key: 'share', label: t('payroll.share'), align: 'end', render: (r) => <Money value={Number(r.ordinary_wage) + Number(r.percentage_share) + Number(r.fixed_wage) + Number(r.attendance_adjustment)} currency={currency} /> },
              { key: 'bonus', label: t('slip.bonus'), align: 'end', hideSm: true, render: (r) => <Money value={r.bonus} currency={currency} /> },
              { key: 'gross', label: t('slip.gross'), align: 'end', render: (r) => <Money value={r.gross} currency={currency} /> },
              { key: 'advance_deduction', label: t('slip.advances'), align: 'end', hideSm: true, render: (r) => <Money value={r.advance_deduction} currency={currency} /> },
              { key: 'fish_deduction', label: t('slip.fishTaken'), align: 'end', hideSm: true, render: (r) => <Money value={r.fish_deduction} currency={currency} /> },
              { key: 'other', label: t('slip.otherDeductions'), align: 'end', hideSm: true, render: (r) => <Money value={Number(r.other_deductions) + Number(r.carry_forward_deduction)} currency={currency} /> },
              { key: 'net', label: t('payroll.net'), align: 'end', render: (r) => (
                <div><Money value={r.net} currency={currency} className="font-semibold" />
                  {Number(r.negative_balance) > 0 && <div className="text-xs text-coral-600">{t('payroll.negativeBalance')}: {m(r.negative_balance)}</div>}
                  {Number(r.unrecovered_advance) > 0 && <div className="text-xs text-amber-700">{t('payroll.unrecoveredAdvance')}: {m(r.unrecovered_advance)}</div>}
                </div>) },
            ]} />
          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">{t('payroll.formula')}: ↕</div>
        </Card>
      )}

      {tab === 'slips' && (
        <Card padded={false} title={t('payroll.slips')}
          actions={(slips.data ?? []).some((s) => s.status === 'issued') && <SlipButtons slips={(slips.data ?? []).filter((s) => s.status === 'issued')} fileName={`${pr.payroll_code}-wage-slips`} label={t('payroll.generateAll')} />}>
          <DataTable rows={slips.data ?? []} loading={slips.loading} columns={[
            { key: 'slip_no', label: t('slip.slipNo'), render: (r) => `${r.slip_no} v${r.version}` },
            { key: 'name', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
            { key: 'net_payable', label: t('crewPay.netPayable'), align: 'end', render: (r) => <Money value={r.net_payable} currency={currency} /> },
            { key: 'amount_paid', label: t('crewPay.alreadyPaid'), align: 'end', render: (r) => <Money value={r.amount_paid} currency={currency} /> },
            { key: 'remaining', label: t('crewPay.remaining'), align: 'end', render: (r) => <Money value={r.remaining} currency={currency} /> },
            { key: 'payment_status', label: t('common.status'), render: (r) => <StatusBadge status={r.payment_status} /> },
            { key: 'ack', label: t('slip.acknowledgement'), render: (r) => (r.acknowledged ? `✓ ${fmtDate(r.acknowledged_at, lang)}` : r.status === 'issued' && can('crew_payments.manage') ? <Button size="sm" onClick={() => slipAction(r, 'acknowledge_wage_slip')}>{t('slip.acknowledge')}</Button> : '—') },
            { key: '_a', label: '', render: (r) => (
              <div className="flex flex-wrap gap-1">
                <SlipButtons slips={[r]} fileName={`${r.slip_no}-v${r.version}`} />
                {r.status === 'issued' && can('payroll.prepare') && <Button size="sm" variant="ghost" onClick={() => slipAction(r, 'reissue_wage_slip')}>{t('slip.reissue')}</Button>}
                {r.status === 'issued' && Number(r.remaining) > 0 && can('crew_payments.manage') && <Button size="sm" variant="primary" onClick={() => nav(`/crew-payments?slip=${r.id}`)}>{t('common.recordPayment')}</Button>}
              </div>) },
          ]} />
        </Card>
      )}

      {tab === 'history' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title={t('common.history')}><ApprovalHistory entityType="payroll" entityId={pr.id} reloadKey={tick} /></Card>
          <Card title={t('common.details')}>
            <KV cols={1} items={[
              [t('payroll.ruleVersion'), pr.rule_name ? `${pr.rule_name} v${pr.rule_version}` : '—'],
              [t('payroll.customBase'), pr.custom_base_amount != null ? m(pr.custom_base_amount) : '—'],
              [t('payroll.snapshot'), pr.inputs_hash ? <code className="text-xs">{String(pr.inputs_hash).slice(0, 12)}…</code> : '—'],
              [t('common.createdBy'), pr.calculated_by_name], [t('common.approvedBy'), pr.approved_by_name],
              [t('status.finalized'), pr.finalized_by_name], [t('common.reason'), pr.reverse_reason], [t('common.notes'), pr.notes],
            ]} />
          </Card>
        </div>
      )}

      <Modal open={!!settings} onClose={() => setSettings(null)} title={t('common.edit')}
        footer={<><Button onClick={() => setSettings(null)}>{t('common.cancel')}</Button><Button variant="primary" onClick={saveSettings}>{t('common.save')}</Button></>}>
        {settings && <div className="space-y-3">
          <Field label={t('payroll.ruleVersion')} required><RefSelect kind="ruleVersions" params={{ boatId: pr.boat_id }} value={settings.rule_version_id} onChange={(v) => setSettings({ ...settings, rule_version_id: v })} /></Field>
          {!pr.trip_id && <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.from')}><Input type="date" value={settings.period_start} onChange={(e) => setSettings({ ...settings, period_start: e.target.value })} /></Field>
            <Field label={t('common.to')}><Input type="date" value={settings.period_end} onChange={(e) => setSettings({ ...settings, period_end: e.target.value })} /></Field>
          </div>}
          <Field label={t('payroll.customBase')}><Input type="number" step="0.01" value={settings.custom_base_amount} onChange={(e) => setSettings({ ...settings, custom_base_amount: e.target.value })} /></Field>
          <Field label={t('common.notes')}><Textarea value={settings.notes} onChange={(e) => setSettings({ ...settings, notes: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
