import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, fetchOne, rpc, updateRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname, isoDate, qty } from '@/lib/format';
import { signedUrl, uploadDocument } from '@/lib/storage';
import { Button, Card, Field, Input, KV, PageHeader, Spinner, StatusBadge, Tabs, Alert, Stat, Select } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { FormFields, initialValues, coerce, validate, JOB_ROLES } from '@/components/Form';
import { RefSelect, invalidateOptions } from '@/components/RefSelect';
import { FilePicker } from '@/components/FileUpload';
import { DocumentList } from '@/components/DocumentList';
import { SlipButtons } from '@/components/SlipButtons';
import { useToast } from '@/components/Toast';
import { CREW_FIELDS } from './Crew';

type Tab = 'profile' | 'attendance' | 'advances' | 'fish' | 'bonuses' | 'slips' | 'payments' | 'documents';

export default function CrewDetail() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { can, currency, company } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const m = (v: unknown) => money(v, currency);
  const [tab, setTab] = useState<Tab>('profile');
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Row>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<File[]>([]);
  const [moving, setMoving] = useState(false);
  const [move, setMove] = useState<Row>({ boat: null, start: isoDate(), role: '' });
  const [busy, setBusy] = useState(false);

  const crew = useAsync(() => fetchOne('v_crew', id!), [id]);
  const photoUrl = useAsync(async () => (crew.data?.photo_path ? signedUrl(crew.data.photo_path, { seconds: 3600 }) : null), [crew.data?.photo_path]);
  const assignments = useAsync(() => fetchAll('v_boat_assignments', { filters: [['crew_id', 'eq', id]], sort: { column: 'start_date', ascending: false } }), [id]);
  const byCrew = (source: string, sort = 'date') => fetchAll(source, { filters: [['crew_id', 'eq', id]], sort: { column: sort, ascending: false } });
  const attendance = useAsync(() => (tab === 'attendance' ? byCrew('v_attendance') : Promise.resolve([])), [id, tab]);
  const advances = useAsync(() => (tab === 'advances' ? byCrew('v_cash_advances') : Promise.resolve([])), [id, tab]);
  const fish = useAsync(() => (tab === 'fish' ? byCrew('v_fish_taken') : Promise.resolve([])), [id, tab]);
  const bonuses = useAsync(() => (tab === 'bonuses' ? Promise.all([byCrew('v_bonuses', 'created_at'), byCrew('v_payroll_adjustments')]) : Promise.resolve([[], []] as Row[][])), [id, tab]);
  const slips = useAsync(() => (tab === 'slips' || tab === 'profile' ? byCrew('v_wage_slips', 'generated_at') : Promise.resolve([])), [id, tab]);
  const payments = useAsync(() => (tab === 'payments' ? byCrew('v_crew_payments') : Promise.resolve([])), [id, tab]);

  if (crew.loading) return <Spinner />;
  if (!crew.data) return <Alert tone="warn">{t('errors.notFound')}</Alert>;
  const c = crew.data;

  const save = async () => {
    const e = validate(CREW_FIELDS, values, t);
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await updateRow('crew_members', c.id, coerce(CREW_FIELDS, values));
      if (photo[0] && company) {
        const doc = await uploadDocument({ file: photo[0], companyId: company.id, entityType: 'crew', entityId: c.id, boatId: c.current_boat_id, docKind: 'photo' });
        await updateRow('crew_members', c.id, { photo_document_id: doc.id });
      }
      invalidateOptions('crew');
      setEditing(false); setPhoto([]);
      toast.success(t('common.success'));
      await crew.reload();
    } catch (err) { toast.error(errorText(err, t)); } finally { setBusy(false); }
  };

  const doMove = async () => {
    setBusy(true);
    try {
      await rpc('assign_crew_to_boat', { p_crew: c.id, p_boat: move.boat, p_start: move.start, p_role: move.role || c.job_role });
      invalidateOptions('crew');
      setMoving(false);
      toast.success(t('common.success'));
      await Promise.all([crew.reload(), assignments.reload()]);
    } catch (err) { toast.error(errorText(err, t)); } finally { setBusy(false); }
  };

  const attSummary = (attendance.data ?? []).reduce((acc: Record<string, number>, a) => { acc[a.status] = (acc[a.status] ?? 0) + 1; return acc; }, {});

  return (
    <div>
      <PageHeader back={() => nav('/crew')} title={dname(c.name_en, c.name_dv, lang)}
        subtitle={<span className="flex flex-wrap items-center gap-2">{c.crew_code} · {t(`jobRoles.${c.current_role ?? c.job_role}`)} <StatusBadge status={c.status} /></span>}
        actions={can('crew.manage') && <>
          <Button icon="boat" onClick={() => { setMove({ boat: null, start: isoDate(), role: c.current_role ?? c.job_role }); setMoving(true); }}>{t('crew.assign')}</Button>
          <Button icon="edit" onClick={() => { setValues(initialValues(CREW_FIELDS, c)); setEditing(true); }}>{t('common.edit')}</Button>
        </>} />

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'profile', label: t('crew.profile') }, { id: 'attendance', label: t('nav.attendance') },
        { id: 'advances', label: t('nav.advances') }, { id: 'fish', label: t('nav.fishTaken') },
        { id: 'bonuses', label: `${t('nav.bonuses')} / ${t('nav.adjustments')}` }, { id: 'slips', label: t('crew.wageSlips') },
        { id: 'payments', label: t('common.payments') }, { id: 'documents', label: t('common.documents') },
      ]} />

      {tab === 'profile' && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('common.details')}>
            <KV items={[
              [t('common.nameEn'), c.name_en], [t('common.nameDv'), <span dir="rtl" className="font-thaana">{c.name_dv ?? '—'}</span>],
              [t('crew.idCard'), c.id_card_no], [t('common.phone'), <bdi dir="ltr">{c.phone ?? '—'}</bdi>],
              [t('common.island'), c.island], [t('common.address'), c.address],
              [t('crew.currentBoat'), dname(c.current_boat_name, c.current_boat_name_dv, lang)], [t('crew.joiningDate'), fmtDate(c.joining_date, lang)],
              [t('crew.emergency'), [c.emergency_name, c.emergency_relation, c.emergency_phone].filter(Boolean).join(' · ') || '—'],
              [t('crew.wageMethod'), c.wage_method ? t(`wage.methods.${c.wage_method}`) : '—'],
              [t('crew.bankAccount'), [c.bank_name, c.bank_account].filter(Boolean).join(' · ') || '—'],
              [t('crew.leavingDate'), c.leaving_date ? fmtDate(c.leaving_date, lang) : '—'], [t('common.notes'), c.notes],
            ]} />
          </Card>
          <div className="space-y-4">
            <Card title={t('boats.photo')}>
              {photoUrl.data ? <img src={photoUrl.data} alt="" className="mx-auto max-h-64 rounded-lg object-cover" /> : <div className="text-sm text-slate-500">—</div>}
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('crew.outstandingAdvances')} value={m(c.advances_outstanding)} />
              <Stat label={t('crew.wagesOutstanding')} value={m(c.wages_outstanding)} tone={Number(c.wages_outstanding) > 0 ? 'warn' : 'default'} />
            </div>
          </div>
          <Card className="lg:col-span-3" title={t('crew.assignmentHistory')} padded={false}>
            <DataTable rows={assignments.data ?? []} loading={assignments.loading} columns={[
              { key: 'boat_name', label: t('common.boat'), render: (r) => dname(r.boat_name, r.boat_name_dv, lang) },
              { key: 'job_role', label: t('crew.jobRole'), render: (r) => (r.job_role ? t(`jobRoles.${r.job_role}`) : '—') },
              { key: 'start_date', label: t('crew.startDate'), render: (r) => fmtDate(r.start_date, lang) },
              { key: 'end_date', label: t('crew.endDate'), render: (r) => (r.end_date ? fmtDate(r.end_date, lang) : <StatusBadge status="active" />) },
            ]} />
          </Card>
        </div>
      )}

      {tab === 'attendance' && (
        <Card padded={false} title={Object.entries(attSummary).map(([k, v]) => `${t(`attendanceStatus.${k}`)}: ${v}`).join(' · ') || t('nav.attendance')}>
          <DataTable rows={attendance.data ?? []} loading={attendance.loading} columns={[
            { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
            { key: 'boat_name', label: t('common.boat') }, { key: 'trip_code', label: t('common.trip') },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            { key: 'notes', label: t('common.notes') }, { key: 'created_by_name', label: t('attendance.enteredBy'), hideSm: true },
          ]} />
        </Card>
      )}

      {tab === 'advances' && (
        <Card padded={false}>
          <DataTable rows={advances.data ?? []} loading={advances.loading} columns={[
            { key: 'advance_code', label: t('common.code') }, { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
            { key: 'reason', label: t('common.reason') }, { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount) },
            { key: 'recovered', label: t('advance.recovered'), align: 'end', render: (r) => m(r.recovered) },
            { key: 'outstanding', label: t('advance.outstanding'), align: 'end', render: (r) => m(r.outstanding) },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}

      {tab === 'fish' && (
        <Card padded={false}>
          <DataTable rows={fish.data ?? []} loading={fish.loading} columns={[
            { key: 'fish_taken_code', label: t('common.code') }, { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
            { key: 'fish', label: t('sales.fishType'), render: (r) => dname(r.fish_name_en, r.fish_name_dv, lang) },
            { key: 'quantity', label: t('common.quantity'), align: 'end', render: (r) => `${qty(r.quantity)} ${t(`units.${r.unit}`)}` },
            { key: 'total', label: t('fishTaken.totalValue'), align: 'end', render: (r) => m(r.total) },
            { key: 'payroll_code', label: t('fishTaken.deductedIn') },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}

      {tab === 'bonuses' && (
        <div className="space-y-4">
          <Card padded={false} title={t('nav.bonuses')}>
            <DataTable rows={bonuses.data?.[0] ?? []} loading={bonuses.loading} columns={[
              { key: 'bonus_code', label: t('common.code') }, { key: 'payroll_code', label: t('nav.payroll') },
              { key: 'kind', label: t('bonus.kind'), render: (r) => (r.kind === 'percent' ? `${r.percent}%` : t('bonus.fixed')) },
              { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount ?? r.fixed_amount) },
              { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
          <Card padded={false} title={t('nav.adjustments')}>
            <DataTable rows={bonuses.data?.[1] ?? []} loading={bonuses.loading} columns={[
              { key: 'adjustment_code', label: t('common.code') }, { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
              { key: 'kind', label: t('common.type'), render: (r) => t(`adjustment.${r.kind}`) }, { key: 'reason', label: t('common.reason') },
              { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount) },
              { key: 'applied_payroll_code', label: t('adjustment.appliedIn') },
              { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
            ]} />
          </Card>
        </div>
      )}

      {tab === 'slips' && (
        <Card padded={false}>
          <DataTable rows={slips.data ?? []} loading={slips.loading} columns={[
            { key: 'slip_no', label: t('slip.slipNo'), render: (r) => `${r.slip_no} v${r.version}` },
            { key: 'payroll_code', label: t('nav.payroll') },
            { key: 'period', label: t('common.period'), render: (r) => `${fmtDate(r.period_start, lang)} – ${fmtDate(r.period_end, lang)}` },
            { key: 'net_payable', label: t('crewPay.netPayable'), align: 'end', render: (r) => m(r.net_payable) },
            { key: 'remaining', label: t('crewPay.remaining'), align: 'end', render: (r) => m(r.remaining) },
            { key: 'payment_status', label: t('common.status'), render: (r) => <StatusBadge status={r.payment_status} /> },
            { key: 'pdf', label: '', render: (r) => <SlipButtons slips={[r]} fileName={`${r.slip_no}-v${r.version}`} /> },
          ]} />
        </Card>
      )}

      {tab === 'payments' && (
        <Card padded={false}>
          <DataTable rows={payments.data ?? []} loading={payments.loading} columns={[
            { key: 'payment_code', label: t('common.code') }, { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
            { key: 'slip_no', label: t('crewPay.slip') }, { key: 'method', label: t('common.method'), render: (r) => t(`payMethods.${r.method}`) },
            { key: 'reference', label: t('common.reference') }, { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => m(r.amount) },
            { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </Card>
      )}

      {tab === 'documents' && <Card><DocumentList entityType="crew" entityId={c.id} boatId={c.current_boat_id} docKind="id_document" canUpload={can('crew.manage')} /></Card>}

      <Modal open={editing} onClose={() => setEditing(false)} title={t('common.edit')} size="lg"
        footer={<><Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button></>}>
        <div className="space-y-4">
          <FormFields fields={CREW_FIELDS} values={values} onChange={setValues} errors={errs} isEdit />
          <div><div className="mb-1 text-xs font-medium text-slate-600">{t('boats.photo')}</div><FilePicker files={photo} onChange={setPhoto} multiple={false} compact /></div>
        </div>
      </Modal>

      <Modal open={moving} onClose={() => setMoving(false)} title={t('crew.assign')}
        footer={<><Button onClick={() => setMoving(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={doMove}>{t('common.save')}</Button></>}>
        <div className="space-y-3">
          <Alert tone="info">{t('crew.moveNote')}</Alert>
          <Field label={t('common.boat')}><RefSelect kind="boats" value={move.boat} onChange={(v) => setMove({ ...move, boat: v })} placeholder={`— ${t('common.none')} —`} /></Field>
          <Field label={t('crew.startDate')}><Input type="date" value={move.start} onChange={(e) => setMove({ ...move, start: e.target.value })} /></Field>
          <Field label={t('crew.jobRole')}>
            <Select value={move.role ?? ''} onChange={(e) => setMove({ ...move, role: e.target.value })}>
              {JOB_ROLES.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
