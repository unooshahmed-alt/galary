import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchAll, fetchOne, rpc, unwrap, updateRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname, qty } from '@/lib/format';
import { Alert, Button, Card, KV, PageHeader, Spinner, Stat, StatusBadge, Tabs, Select, Field } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { ResourcePage } from '@/components/ResourcePage';
import { DocumentList } from '@/components/DocumentList';
import { ApprovalHistory } from '@/components/Workflow';
import { Modal, useConfirm } from '@/components/Modal';
import { FormFields, initialValues, coerce, validate, JOB_ROLES } from '@/components/Form';
import { useOptions } from '@/components/RefSelect';
import { useToast } from '@/components/Toast';
import { catchConfig, salesConfig, ReceiptModal } from './salesConfig';
import { useLedger } from './Ledger';
import { TRIP_FIELDS } from './Trips';

type Tab = 'overview' | 'crew' | 'catch' | 'sales' | 'income' | 'expenses' | 'bills' | 'documents';

export default function TripDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can, currency, isOwner } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const m = (v: unknown) => money(v, currency);
  const [tab, setTab] = useState<Tab>('overview');
  const [tick, setTick] = useState(0);
  const [receive, setReceive] = useState<Row | null>(null);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Row>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [addCrew, setAddCrew] = useState<{ crew: string; role: string } | null>(null);

  const trip = useAsync(() => fetchOne('v_trips', id!), [id, tick]);
  const crew = useAsync(() => fetchAll('v_trip_crew', { filters: [['trip_id', 'eq', id]], sort: { column: 'crew_code', ascending: true } }), [id, tick]);
  const stock = useAsync(() => fetchAll('v_trip_fish_stock', { filters: [['trip_id', 'eq', id]] }), [id, tick]);
  const bills = useAsync(() => (tab === 'bills' ? fetchAll('v_bills', { filters: [['trip_id', 'eq', id]], sort: { column: 'bill_date', ascending: false } }) : Promise.resolve([])), [id, tab]);
  const tr = trip.data;
  const boatCrew = useOptions('crew', { boatId: tr?.boat_id ?? null });
  const income = useLedger('income', tr ?? undefined);
  const expense = useLedger('expense', tr ?? undefined);

  if (trip.loading && !tr) return <Spinner />;
  if (!tr) return <Alert tone="warn">{t('errors.notFound')}</Alert>;
  const closed = tr.status === 'closed';
  const reload = () => setTick((x) => x + 1);

  const setStatus = async (status: string, needReason = false) => {
    const r = await confirm({ title: t(`status.${status}`), message: status === 'closed' ? t('trips.closeChecks') : undefined, reason: needReason ? true : 'optional', tone: status === 'closed' ? 'success' : 'primary' });
    if (r === null) return;
    try {
      await rpc('set_trip_status', { p_trip: tr.id, p_status: status, p_comment: r || null });
      toast.success(t('common.success'));
      reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const saveTrip = async () => {
    const fields = TRIP_FIELDS.filter((f) => f.name !== 'status' && f.name !== 'boat_id');
    const e = validate(fields, values, t);
    setErrs(e);
    if (Object.keys(e).length) return;
    try {
      await updateRow('trips', tr.id, coerce(fields, values));
      setEditing(false);
      reload();
    } catch (err) { toast.error(errorText(err, t)); }
  };

  const doAddCrew = async () => {
    if (!addCrew?.crew) return;
    try {
      unwrap(await supabase.from('trip_crew').insert({ trip_id: tr.id, crew_id: addCrew.crew, job_role: addCrew.role || null, company_id: tr.company_id }));
      setAddCrew(null);
      reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };
  const removeCrew = async (crewId: string) => {
    const ok = await confirm({ title: t('common.delete'), tone: 'danger' });
    if (ok === null) return;
    try {
      unwrap(await supabase.from('trip_crew').delete().eq('trip_id', tr.id).eq('crew_id', crewId));
      reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };
  const addAllBoatCrew = async () => {
    const existing = new Set((crew.data ?? []).map((c) => c.crew_id));
    const rows = boatCrew.rows.filter((c) => !existing.has(c.id)).map((c) => ({ trip_id: tr.id, crew_id: c.id, job_role: c.current_role ?? c.job_role, company_id: tr.company_id }));
    if (!rows.length) return;
    try { unwrap(await supabase.from('trip_crew').insert(rows)); reload(); } catch (e) { toast.error(errorText(e, t)); }
  };

  const transitions: { status: string; label: string; perm: string; show: boolean; reason?: boolean }[] = [
    { status: 'active', label: 'trips.start', perm: 'trips.manage', show: tr.status === 'planned' },
    { status: 'returned', label: 'trips.markReturned', perm: 'trips.manage', show: tr.status === 'active' },
    { status: 'under_review', label: 'trips.sendReview', perm: 'trips.manage', show: tr.status === 'returned' },
    { status: 'closed', label: 'trips.close', perm: 'trips.close', show: tr.status === 'under_review' },
    { status: 'active', label: 'common.returnForCorrection', perm: 'trips.close', show: tr.status === 'under_review' },
    { status: 'under_review', label: 'trips.reopen', perm: 'trips.close', show: closed && isOwner, reason: true },
  ];

  return (
    <div>
      {dialog}{income.dialog}{expense.dialog}
      <PageHeader back={() => nav('/trips')} title={`${tr.trip_code} · ${dname(tr.boat_name, tr.boat_name_dv, lang)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{fmtDate(tr.start_date, lang)} – {fmtDate(tr.return_date, lang)} <StatusBadge status={tr.status} /></span>}
        actions={<>
          {transitions.filter((x) => x.show && can(x.perm)).map((x) => (
            <Button key={x.label} variant={x.status === 'closed' ? 'success' : 'secondary'} onClick={() => setStatus(x.status, x.reason)}>{t(x.label)}</Button>
          ))}
          {!closed && can('trips.manage') && <Button icon="edit" onClick={() => { setValues(initialValues(TRIP_FIELDS, tr)); setEditing(true); }}>{t('common.edit')}</Button>}
          {can('payroll.view') && <Button icon="calculator" onClick={() => nav(`/payroll?trip=${tr.id}&boat=${tr.boat_id}`)}>{t('trips.payroll')}</Button>}
        </>} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t('trips.catch')} value={`${qty(tr.catch_kg)} kg`} />
        <Stat label={t('trips.sales')} value={m(tr.sales_total)} />
        <Stat label={t('trips.income')} value={m(tr.other_income)} />
        <Stat label={t('trips.expenses')} value={m(tr.expenses)} />
        <Stat label={t('trips.profit')} value={m(tr.trip_profit)} tone={Number(tr.trip_profit) < 0 ? 'bad' : 'good'} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: t('boats.overview') }, { id: 'crew', label: t('trips.crew'), count: crew.data?.length },
        { id: 'catch', label: t('trips.catch') }, { id: 'sales', label: t('trips.sales') },
        { id: 'income', label: t('trips.income') }, { id: 'expenses', label: t('trips.expenses') },
        { id: 'bills', label: t('trips.bills') }, { id: 'documents', label: t('common.documents') },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('common.details')}>
            <KV items={[[t('common.boat'), dname(tr.boat_name, tr.boat_name_dv, lang)], [t('trips.location'), tr.location],
              [t('trips.startDate'), fmtDate(tr.start_date, lang)], [t('trips.returnDate'), fmtDate(tr.return_date, lang)],
              [t('trips.payroll'), tr.payroll_status ? <StatusBadge status={tr.payroll_status} /> : '—'], [t('common.notes'), tr.notes]]} />
            <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">{t('trips.stock')}</h3>
            <DataTable compact rows={stock.data ?? []} rowKey="fish_type_id" columns={[
              { key: 'fish', label: t('sales.fishType'), render: (r) => `${dname(r.fish_name_en, r.fish_name_dv, lang)} (${t(`units.${r.unit}`)})` },
              { key: 'caught', label: t('trips.caught'), align: 'end', render: (r) => qty(r.caught) },
              { key: 'sold', label: t('trips.sold'), align: 'end', render: (r) => qty(r.sold) },
              { key: 'taken_by_crew', label: t('trips.takenByCrew'), align: 'end', render: (r) => qty(r.taken_by_crew) },
              { key: 'remaining', label: t('trips.remaining'), align: 'end', render: (r) => <span className={Number(r.remaining) < 0 ? 'text-coral-600' : ''}>{qty(r.remaining)}</span> },
            ]} />
          </Card>
          <Card title={t('trips.history')}><ApprovalHistory entityType="trip" entityId={tr.id} reloadKey={tick} />
            {tr.status === 'under_review' && <div className="mt-3"><Alert tone="info">{t('trips.closeChecks')}</Alert></div>}
          </Card>
        </div>
      )}

      {tab === 'crew' && (
        <Card padded={false} title={t('trips.crew')} actions={!closed && can('trips.manage') && <>
          <Button size="sm" onClick={addAllBoatCrew}>+ {t('boats.crewList')}</Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAddCrew({ crew: '', role: '' })}>{t('trips.addCrew')}</Button>
        </>}>
          <DataTable rows={crew.data ?? []} rowKey="crew_id" columns={[
            { key: 'crew_code', label: t('crew.code') },
            { key: 'name', label: t('common.name'), render: (r) => dname(r.name_en, r.name_dv, lang) },
            { key: 'job_role', label: t('crew.jobRole'), render: (r) => t(`jobRoles.${r.job_role ?? r.default_role}`) },
            { key: '_x', label: '', render: (r) => (!closed && can('trips.manage') ? <Button size="sm" variant="ghost" icon="trash" onClick={() => removeCrew(r.crew_id)} aria-label={t('common.delete')} /> : null) },
          ]} />
        </Card>
      )}

      {tab === 'catch' && <ResourcePage config={{ ...catchConfig(t, lang, tr), onSaved: reload }} />}
      {tab === 'sales' && <ResourcePage config={{ ...salesConfig(t, lang, currency, setReceive, tr), onSaved: reload, reloadKey: tick }} />}
      {tab === 'income' && <ResourcePage config={{ ...income.config, onSaved: reload }} />}
      {tab === 'expenses' && <ResourcePage config={{ ...expense.config, onSaved: reload }} />}
      {tab === 'bills' && (
        <Card padded={false} title={t('trips.bills')} actions={!closed && can('bills.manage') && <Button size="sm" variant="primary" icon="plus" onClick={() => nav(`/bills/new?trip=${tr.id}&boat=${tr.boat_id}`)}>{t('bills.new')}</Button>}>
          <DataTable rows={bills.data ?? []} loading={bills.loading} onRowClick={(r) => nav(`/bills/${r.id}`)} columns={[
            { key: 'bill_code', label: t('common.code') }, { key: 'supplier_name', label: t('common.supplier') },
            { key: 'invoice_no', label: t('bills.invoiceNo') }, { key: 'total', label: t('common.total'), align: 'end', render: (r) => m(r.total) },
            { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => m(r.outstanding) },
            { key: 'display_status', label: t('common.status'), render: (r) => <StatusBadge status={r.display_status} /> },
          ]} />
        </Card>
      )}
      {tab === 'documents' && <Card><DocumentList entityType="trip" entityId={tr.id} boatId={tr.boat_id} canUpload={!closed} /></Card>}

      <ReceiptModal sale={receive} currency={currency} onClose={() => setReceive(null)} onDone={reload} />

      <Modal open={editing} onClose={() => setEditing(false)} title={t('common.edit')} size="lg"
        footer={<><Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button variant="primary" onClick={saveTrip}>{t('common.save')}</Button></>}>
        <FormFields fields={TRIP_FIELDS.filter((f) => f.name !== 'status' && f.name !== 'boat_id')} values={values} onChange={setValues} errors={errs} isEdit />
      </Modal>

      <Modal open={!!addCrew} onClose={() => setAddCrew(null)} title={t('trips.addCrew')}
        footer={<><Button onClick={() => setAddCrew(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!addCrew?.crew} onClick={doAddCrew}>{t('common.add')}</Button></>}>
        {addCrew && <div className="space-y-3">
          <Field label={t('common.crewMember')} required>
            <Select value={addCrew.crew} onChange={(e) => {
              const row = boatCrew.rows.find((r) => r.id === e.target.value);
              setAddCrew({ crew: e.target.value, role: row?.current_role ?? row?.job_role ?? '' });
            }}>
              <option value="">{t('common.select')}</option>
              {boatCrew.options.filter((o) => !(crew.data ?? []).some((c) => c.crew_id === o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label={t('crew.jobRole')}>
            <Select value={addCrew.role} onChange={(e) => setAddCrew({ ...addCrew, role: e.target.value })}>
              {JOB_ROLES.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
            </Select>
          </Field>
        </div>}
      </Modal>
    </div>
  );
}
