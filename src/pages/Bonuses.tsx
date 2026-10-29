import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, fetchOne, insertRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, dname, round2 } from '@/lib/format';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, StatusBadge, Money, Stat } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { RefSelect, useOptions } from '@/components/RefSelect';
import { Modal } from '@/components/Modal';
import { RecordActions } from '@/components/Workflow';
import { ResourcePage } from '@/components/ResourcePage';
import { useToast } from '@/components/Toast';

export default function Bonuses() {
  const { t, lang } = useI18n();
  const { can, currency } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const payrollId = params.get('payroll');
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState<Row | null>(null);
  const m = (v: unknown) => money(v, currency);

  const payroll = useAsync(() => (payrollId ? fetchOne('v_payrolls', payrollId) : Promise.resolve(null)), [payrollId, tick]);
  const bonuses = useAsync(() => (payrollId ? fetchAll('v_bonuses', { filters: [['payroll_id', 'eq', payrollId]], sort: { column: 'created_at', ascending: true } }) : Promise.resolve([])), [payrollId, tick]);
  const calcs = useAsync(() => (payrollId ? fetchAll('v_wage_calculations', { filters: [['payroll_id', 'eq', payrollId]] }) : Promise.resolve([])), [payrollId, tick]);
  const boatCrew = useOptions('crew', { boatId: payroll.data?.boat_id ?? null });

  const pr = payroll.data;
  const allocation = pr?.owner_allocation != null ? Number(pr.owner_allocation) : null;
  const active = (bonuses.data ?? []).filter((b) => !['rejected', 'voided'].includes(b.status));
  const resolved = (b: Row) => (b.kind === 'fixed' ? Number(b.fixed_amount) : allocation != null ? round2(Math.max(0, allocation) * Number(b.percent) / 100) : Number(b.amount ?? 0));
  const total = active.reduce((s, b) => s + resolved(b), 0);
  const remaining = allocation != null ? allocation - total : null;
  const exceeds = remaining != null && remaining < -0.004;
  const crewOptions = (calcs.data ?? []).length
    ? (calcs.data ?? []).map((c) => ({ value: c.crew_id, label: `${c.crew_code} · ${dname(c.crew_name_en, c.crew_name_dv, lang)}` }))
    : boatCrew.options.map((o) => ({ value: o.value, label: o.label }));
  const open = pr && ['draft', 'calculated'].includes(pr.status);

  const add = async () => {
    try {
      await insertRow('crew_bonuses', {
        payroll_id: payrollId, crew_id: adding!.crew_id, kind: adding!.kind,
        percent: adding!.kind === 'percent' ? Number(adding!.value) : null,
        fixed_amount: adding!.kind === 'fixed' ? Number(adding!.value) : null,
        notes: adding!.notes || null, status: can('bonuses.approve') ? 'approved' : 'pending_approval',
      });
      setAdding(null); setTick((x) => x + 1);
      toast.success(t('common.success'));
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const projected = adding ? (adding.kind === 'fixed' ? Number(adding.value || 0) : allocation != null ? Math.max(0, allocation) * Number(adding.value || 0) / 100 : 0) : 0;

  if (!payrollId) {
    return (
      <div>
        <PageHeader title={t('bonus.title')} subtitle={t('bonus.note')}
          actions={<div className="w-72"><RefSelect kind="openPayrolls" value={null} placeholder={t('bonus.selectPayroll')} onChange={(v) => v && setParams({ payroll: v })} /></div>} />
        <ResourcePage config={{
          table: 'crew_bonuses', view: 'v_bonuses', title: 'reports.bonuses', viewPerm: 'bonuses.view', embedded: true,
          defaultSort: { column: 'created_at', ascending: false }, searchColumns: ['bonus_code', 'payroll_code', 'crew_name_en', 'crew_name_dv'],
          filters: [{ name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' }],
          onRowClick: (r) => setParams({ payroll: r.payroll_id }),
          columns: [
            { key: 'bonus_code', label: t('common.code') }, { key: 'payroll_code', label: t('nav.payroll') }, { key: 'boat_name', label: t('common.boat') },
            { key: 'crew', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
            { key: 'kind', label: t('bonus.kind'), render: (r) => (r.kind === 'percent' ? `${Number(r.percent)}%` : t('bonus.fixed')) },
            { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <Money value={r.amount ?? r.fixed_amount} currency={currency} /> },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ],
          exportColumns: (xt) => [
            { header: xt('common.code'), key: 'bonus_code' }, { header: xt('nav.payroll'), key: 'payroll_code' }, { header: xt('common.boat'), key: 'boat_name' },
            { header: xt('common.crewMember'), key: 'crew_name_en' }, { header: xt('bonus.kind'), key: 'kind' }, { header: '%', key: 'percent', type: 'number' },
            { header: xt('common.amount'), key: 'amount', type: 'money' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
          ],
        }} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader back={() => setParams({})} title={`${t('bonus.title')} · ${pr?.payroll_code ?? ''}`} subtitle={t('bonus.note')}
        actions={<>
          {pr && <Button icon="calculator" onClick={() => nav(`/payroll/${pr.id}`)}>{t('nav.payroll')}</Button>}
          {open && can('bonuses.manage') && <Button variant="primary" icon="plus" onClick={() => setAdding({ crew_id: '', kind: 'percent', value: '', notes: '' })}>{t('bonus.new')}</Button>}
        </>} />
      {payroll.loading ? <Spinner /> : !pr ? <Alert tone="warn">{t('errors.notFound')}</Alert> : (
        <>
          {allocation == null && <div className="mb-4"><Alert tone="info">{t('bonus.calcNote')}</Alert></div>}
          {!open && <div className="mb-4"><Alert tone="info">{t('bonus.locked')}</Alert></div>}
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label={t('bonus.available')} value={allocation != null ? m(allocation) : '—'} />
            <Stat label={t('payroll.totalBonuses')} value={m(total)} tone={exceeds ? 'bad' : 'default'} />
            <Stat label={t('bonus.remaining')} value={remaining != null ? m(remaining) : '—'} tone={exceeds ? 'bad' : 'good'} />
          </div>
          {exceeds && <div className="mb-4"><Alert tone="error">{t('payroll.errors')}: {t('payroll.totalBonuses')} &gt; {t('bonus.available')}</Alert></div>}
          <Card padded={false}>
            <DataTable rows={bonuses.data ?? []} loading={bonuses.loading} columns={[
              { key: 'bonus_code', label: t('common.code') },
              { key: 'crew', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
              { key: 'kind', label: t('bonus.kind'), render: (r) => (r.kind === 'percent' ? `${Number(r.percent)}% ${t('bonus.percent').toLowerCase()}` : t('bonus.fixed')) },
              { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <Money value={resolved(r)} currency={currency} /> },
              { key: 'notes', label: t('common.notes'), hideSm: true },
              { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
              { key: 'approved_by_name', label: t('common.approvedBy'), hideSm: true },
              { key: '_a', label: '', render: (r) => (open ? <RecordActions table="crew_bonuses" row={r} onDone={() => setTick((x) => x + 1)} /> : null) },
            ]} />
          </Card>
        </>
      )}
      <Modal open={!!adding} onClose={() => setAdding(null)} title={t('bonus.new')}
        footer={<><Button onClick={() => setAdding(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!adding?.crew_id || !(Number(adding?.value) > 0) || (remaining != null && projected > remaining + 0.004)} onClick={add}>{t('common.save')}</Button></>}>
        {adding && <div className="space-y-3">
          <Field label={t('common.crewMember')} required>
            <Select value={adding.crew_id} onChange={(e) => setAdding({ ...adding, crew_id: e.target.value })}>
              <option value="">{t('common.select')}</option>
              {crewOptions.filter((o) => !active.some((b) => b.crew_id === o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={t('bonus.kind')}>
            <Select value={adding.kind} onChange={(e) => setAdding({ ...adding, kind: e.target.value })}>
              <option value="percent">{t('bonus.percent')}</option><option value="fixed">{t('bonus.fixed')}</option>
            </Select>
          </Field>
          <Field label={adding.kind === 'percent' ? '%' : t('common.amount')} required>
            <Input type="number" step="0.01" min="0" max={adding.kind === 'percent' ? 100 : undefined} value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
          </Field>
          <Field label={t('common.notes')}><Input value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} /></Field>
          {allocation != null && <Alert tone={remaining != null && projected > remaining + 0.004 ? 'error' : 'info'}>
            {t('common.amount')}: <b dir="ltr">{m(projected)}</b> · {t('bonus.remaining')}: <b dir="ltr">{m((remaining ?? 0) - projected)}</b>
          </Alert>}
        </div>}
      </Modal>
    </div>
  );
}
