import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, fetchOne, rpc, updateRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname } from '@/lib/format';
import { signedUrl, uploadDocument } from '@/lib/storage';
import { Button, Card, KV, PageHeader, Spinner, StatusBadge, Stat, Tabs, Alert } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { DocumentList } from '@/components/DocumentList';
import { Modal } from '@/components/Modal';
import { FormFields, initialValues, coerce, validate } from '@/components/Form';
import { FilePicker } from '@/components/FileUpload';
import { DateRangeFilter, defaultRange } from '@/components/DateRangeFilter';
import { useToast } from '@/components/Toast';
import { invalidateOptions } from '@/components/RefSelect';
import { BOAT_FIELDS } from './Boats';

type Tab = 'overview' | 'crew' | 'trips' | 'finance' | 'bills' | 'payroll' | 'documents';

export default function BoatDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can, currency, company } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState(defaultRange('year'));
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Row>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const m = (v: unknown) => money(v, currency);

  const boat = useAsync(() => fetchOne('v_boats', id!), [id]);
  const photoUrl = useAsync(async () => (boat.data?.photo_path ? signedUrl(boat.data.photo_path, { seconds: 3600 }) : null), [boat.data?.photo_path]);
  const fin = useAsync(() => rpc<Row>('financial_summary', { p_from: range.from, p_to: range.to, p_boat: id }), [id, range.from, range.to]);
  const crew = useAsync(() => fetchAll('v_boat_assignments', { filters: [['boat_id', 'eq', id]], sort: { column: 'start_date', ascending: false } }), [id]);
  const trips = useAsync(() => (tab === 'trips' ? fetchAll('v_trips', { filters: [['boat_id', 'eq', id]], sort: { column: 'start_date', ascending: false } }) : Promise.resolve([])), [id, tab]);
  const bills = useAsync(() => (tab === 'bills' ? fetchAll('v_bills', { filters: [['boat_id', 'eq', id]], sort: { column: 'bill_date', ascending: false } }) : Promise.resolve([])), [id, tab]);
  const payrolls = useAsync(() => (tab === 'payroll' ? fetchAll('v_payrolls', { filters: [['boat_id', 'eq', id]], sort: { column: 'period_start', ascending: false } }) : Promise.resolve([])), [id, tab]);
  const advances = useAsync(() => (tab === 'payroll' ? fetchAll('v_cash_advances', { filters: [['boat_id', 'eq', id], ['status', 'eq', 'approved']] }) : Promise.resolve([])), [id, tab]);
  const txns = useAsync(() => (tab === 'finance' ? fetchAll('v_transactions', { filters: [['boat_id', 'eq', id], ['date', 'gte', range.from], ['date', 'lte', range.to]], sort: { column: 'date', ascending: false } }) : Promise.resolve([])), [id, tab, range.from, range.to]);

  if (boat.loading) return <Spinner />;
  if (!boat.data) return <Alert tone="warn">{t('errors.notFound')}</Alert>;
  const b = boat.data;
  const f = fin.data ?? {};

  const save = async () => {
    const e = validate(BOAT_FIELDS!, values, t);
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await updateRow('boats', b.id, coerce(BOAT_FIELDS!, values));
      if (photo[0] && company) {
        const doc = await uploadDocument({ file: photo[0], companyId: company.id, entityType: 'boat', entityId: b.id, boatId: b.id, docKind: 'photo' });
        await updateRow('boats', b.id, { photo_document_id: doc.id });
      }
      invalidateOptions('boats');
      setEditing(false); setPhoto([]);
      toast.success(t('common.success'));
      await boat.reload();
    } catch (err) { toast.error(errorText(err, t)); } finally { setBusy(false); }
  };

  const current = (crew.data ?? []).filter((a) => !a.end_date);

  return (
    <div>
      <PageHeader back={() => nav('/boats')} title={dname(b.name, b.name_dv, lang)}
        subtitle={<span className="flex items-center gap-2">{b.registration_no} <StatusBadge status={b.status} /></span>}
        actions={<>
          {can('boats.manage') && <Button icon="edit" onClick={() => { setValues(initialValues(BOAT_FIELDS!, b)); setEditing(true); }}>{t('common.edit')}</Button>}
          {can('wage_rules.view') && <Button icon="scale" onClick={() => nav(`/wage-rules?boat=${b.id}`)}>{t('nav.wageRules')}</Button>}
        </>} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: t('boats.overview') }, { id: 'crew', label: t('boats.crewList'), count: current.length },
        { id: 'trips', label: t('nav.trips') }, { id: 'finance', label: t('boats.performance') },
        { id: 'bills', label: t('nav.bills') }, { id: 'payroll', label: t('nav.payroll') }, { id: 'documents', label: t('common.documents') },
      ]} />

      {tab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('common.details')}>
            <KV items={[
              [t('boats.registrationNo'), b.registration_no], [t('boats.licenseNo'), b.license_no], [t('boats.vesselType'), b.vessel_type],
              [t('boats.homeIsland'), b.home_island], [t('boats.length'), b.length_m], [t('boats.engine'), b.engine],
              [t('boats.capacity'), b.capacity], [t('boats.manager'), b.manager_name], [t('boats.details'), b.details],
            ]} />
          </Card>
          <Card title={t('boats.photo')}>
            {photoUrl.data ? <img src={photoUrl.data} alt={b.name} className="w-full rounded-lg object-cover" /> : <div className="text-sm text-slate-500">—</div>}
          </Card>
          <div className="lg:col-span-3">
            <div className="mb-2 flex justify-end"><DateRangeFilter value={range} onChange={setRange} /></div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t('dashboard.fishSales')} value={m(f.fishSales)} />
              <Stat label={t('dashboard.expenses')} value={m(f.expenses)} />
              <Stat label={t('dashboard.crewWages')} value={m(f.crewWages)} />
              <Stat label={t('dashboard.netProfit')} value={m(f.netProfit)} tone={Number(f.netProfit) < 0 ? 'bad' : 'good'} />
            </div>
          </div>
        </div>
      )}

      {tab === 'crew' && (
        <Card padded={false}>
          <DataTable rows={crew.data ?? []} loading={crew.loading} onRowClick={(r) => nav(`/crew/${r.crew_id}`)} columns={[
            { key: 'crew_code', label: t('crew.code') },
            { key: 'name', label: t('common.name'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
            { key: 'job_role', label: t('crew.jobRole'), render: (r) => (r.job_role ? t(`jobRoles.${r.job_role}`) : '—') },
            { key: 'start_date', label: t('crew.startDate'), render: (r) => fmtDate(r.start_date, lang) },
            { key: 'end_date', label: t('crew.endDate'), render: (r) => (r.end_date ? fmtDate(r.end_date, lang) : <StatusBadge status="active" />) },
          ]} />
        </Card>
      )}

      {tab === 'trips' && (
        <Card padded={false}>
          <DataTable rows={trips.data ?? []} loading={trips.loading} onRowClick={(r) => nav(`/trips/${r.id}`)} columns={[
            { key: 'trip_code', label: t('common.code') },
            { key: 'start_date', label: t('trips.startDate'), render: (r) => fmtDate(r.start_date, lang) },
            { key: 'return_date', label: t('trips.returnDate'), render: (r) => fmtDate(r.return_date, lang) },
            { key: 'sales_total', label: t('trips.sales'), align: 'end', render: (r) => m(r.sales_total) },
            { key: 'expenses', label: t('trips.expenses'), align: 'end', render: (r) => m(r.expenses) },
            { key: 'trip_profit', label: t('trips.profit'), align: 'end', render: (r) => m(r.trip_profit) },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}

      {tab === 'finance' && (
        <div className="space-y-4">
          <div className="flex justify-end"><DateRangeFilter value={range} onChange={setRange} /></div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label={t('dashboard.fishSales')} value={m(f.fishSales)} /><Stat label={t('dashboard.otherIncome')} value={m(f.otherIncome)} />
            <Stat label={t('dashboard.expenses')} value={m(f.expenses)} /><Stat label={t('dashboard.operatingProfit')} value={m(f.operatingProfit)} />
            <Stat label={t('dashboard.crewWages')} value={m(f.crewWages)} /><Stat label={t('dashboard.netProfit')} value={m(f.netProfit)} tone={Number(f.netProfit) < 0 ? 'bad' : 'good'} />
          </div>
          <Card padded={false} title={`${t('nav.income')} / ${t('nav.expenses')}`}>
            <DataTable rows={txns.data ?? []} loading={txns.loading} columns={[
              { key: 'txn_code', label: t('common.code') },
              { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
              { key: 'kind', label: t('common.type'), render: (r) => t(r.kind === 'income' ? 'nav.income' : 'nav.expenses') },
              { key: 'category', label: t('common.category'), render: (r) => dname(r.category_name_en, r.category_name_dv, lang) },
              { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount) },
              { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
        </div>
      )}

      {tab === 'bills' && (
        <Card padded={false}>
          <DataTable rows={bills.data ?? []} loading={bills.loading} onRowClick={(r) => nav(`/bills/${r.id}`)} columns={[
            { key: 'bill_code', label: t('common.code') }, { key: 'supplier_name', label: t('common.supplier') },
            { key: 'invoice_no', label: t('bills.invoiceNo') }, { key: 'bill_date', label: t('bills.billDate'), render: (r) => fmtDate(r.bill_date, lang) },
            { key: 'total', label: t('common.total'), align: 'end', render: (r) => m(r.total) },
            { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => m(r.outstanding) },
            { key: 'display_status', label: t('common.status'), render: (r) => <StatusBadge status={r.display_status} /> },
          ]} />
        </Card>
      )}

      {tab === 'payroll' && (
        <div className="space-y-4">
          <Card padded={false} title={t('nav.payroll')}>
            <DataTable rows={payrolls.data ?? []} loading={payrolls.loading} onRowClick={(r) => nav(`/payroll/${r.id}`)} columns={[
              { key: 'payroll_code', label: t('common.code') }, { key: 'trip_code', label: t('common.trip') },
              { key: 'period', label: t('common.period'), render: (r) => `${fmtDate(r.period_start, lang)} – ${fmtDate(r.period_end, lang)}` },
              { key: 'total_net', label: t('payroll.totalNet'), align: 'end', render: (r) => m(r.total_net) },
              { key: 'total_paid', label: t('common.paid'), align: 'end', render: (r) => m(r.total_paid) },
              { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
          <Card padded={false} title={t('advance.title')}>
            <DataTable rows={advances.data ?? []} loading={advances.loading} columns={[
              { key: 'advance_code', label: t('common.code') }, { key: 'crew', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
              { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
              { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount) },
              { key: 'outstanding', label: t('advance.outstanding'), align: 'end', render: (r) => m(r.outstanding) },
            ]} />
          </Card>
        </div>
      )}

      {tab === 'documents' && <Card><DocumentList entityType="boat" entityId={b.id} boatId={b.id} canUpload={can('boats.manage') || can('documents.manage')} /></Card>}

      <Modal open={editing} onClose={() => setEditing(false)} title={t('common.edit')} size="lg"
        footer={<><Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button></>}>
        <div className="space-y-4">
          <FormFields fields={BOAT_FIELDS!} values={values} onChange={setValues} errors={errs} isEdit />
          <div><div className="mb-1 text-xs font-medium text-slate-600">{t('boats.photo')}</div><FilePicker files={photo} onChange={setPhoto} multiple={false} compact /></div>
        </div>
      </Modal>
    </div>
  );
}

