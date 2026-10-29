import { useNavigate } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { StatusBadge, Money } from '@/components/ui';
import { JOB_ROLES, RECORD_STATUS, type FieldDef } from '@/components/Form';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc } from '@/lib/db';
import { dname, isoDate } from '@/lib/format';

export const CREW_FIELDS: FieldDef[] = [
  { name: 'name_en', label: 'common.nameEn', type: 'text' },
  { name: 'name_dv', label: 'common.nameDv', type: 'text', rtl: true },
  { name: 'id_card_no', label: 'crew.idCard', type: 'text' },
  { name: 'job_role', label: 'crew.jobRole', type: 'select', options: JOB_ROLES, required: true, default: 'fisherman' },
  { name: 'phone', label: 'common.phone', type: 'tel' },
  { name: 'email', label: 'common.email', type: 'email' },
  { name: 'island', label: 'common.island', type: 'text' },
  { name: 'address', label: 'common.address', type: 'text' },
  { name: 'emergency_name', label: 'crew.emergencyName', type: 'text' },
  { name: 'emergency_phone', label: 'crew.emergencyPhone', type: 'tel' },
  { name: 'emergency_relation', label: 'crew.relation', type: 'text' },
  { name: 'joining_date', label: 'crew.joiningDate', type: 'date', default: () => isoDate() },
  { name: 'wage_method', label: 'crew.wageMethod', type: 'select', options: [
    { value: 'equal', label: 'wage.methods.equal' }, { value: 'percentage', label: 'wage.methods.percentage' },
    { value: 'role', label: 'wage.methods.role' }, { value: 'fixed', label: 'wage.methods.fixed' },
    { value: 'attendance', label: 'wage.methods.attendance' }, { value: 'combined', label: 'wage.methods.combined' }] },
  { name: 'bank_name', label: 'crew.bank', type: 'text' },
  { name: 'bank_account', label: 'crew.bankAccount', type: 'text' },
  { name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS, default: 'active', required: true },
  { name: 'leaving_date', label: 'crew.leavingDate', type: 'date', showIf: (v) => v.status === 'inactive' },
  { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
];

export default function Crew() {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const nav = useNavigate();
  const config: ResourceConfig = {
    table: 'crew_members', view: 'v_crew', title: 'crew.title', newLabel: 'crew.new',
    viewPerm: 'crew.view', managePerm: 'crew.manage', invalidates: ['crew'],
    searchColumns: ['crew_code', 'name_en', 'name_dv', 'phone', 'id_card_no'],
    defaultSort: { column: 'crew_code', ascending: true },
    filters: [
      { name: 'current_boat_id', label: 'crew.currentBoat', type: 'ref', ref: 'boats' },
      { name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS },
      { name: 'job_role', label: 'crew.jobRole', type: 'select', options: JOB_ROLES },
    ],
    onRowClick: (r) => nav(`/crew/${r.id}`),
    columns: [
      { key: 'crew_code', label: t('crew.code'), sortable: true },
      { key: 'name', label: t('common.name'), render: (r) => <div><div className="font-medium">{dname(r.name_en, r.name_dv, lang)}</div>
        {r.name_en && r.name_dv && <div className="text-xs text-slate-500" dir="auto">{lang === 'dv' ? r.name_en : r.name_dv}</div>}</div> },
      { key: 'current_role', label: t('crew.jobRole'), render: (r) => t(`jobRoles.${r.current_role ?? r.job_role}`) },
      { key: 'current_boat_name', label: t('crew.currentBoat'), render: (r) => dname(r.current_boat_name, r.current_boat_name_dv, lang) },
      { key: 'phone', label: t('common.phone'), hideSm: true, render: (r) => <bdi dir="ltr">{r.phone ?? '—'}</bdi> },
      { key: 'advances_outstanding', label: t('crew.outstandingAdvances'), align: 'end', hideSm: true, render: (r) => <Money value={r.advances_outstanding} currency={currency} /> },
      { key: 'wages_outstanding', label: t('crew.wagesOutstanding'), align: 'end', hideSm: true, render: (r) => <Money value={r.wages_outstanding} currency={currency} /> },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    ],
    fields: [
      ...CREW_FIELDS,
      { name: '_boat', label: 'crew.assign', type: 'ref', ref: 'boats', showIf: () => true },
      { name: '_start', label: 'crew.startDate', type: 'date', default: () => isoDate(), showIf: (v) => !!v._boat },
    ],
    beforeSave: (v) => {
      const { _boat, _start, ...rest } = v; void _boat; void _start;
      if (!rest.name_en && !rest.name_dv) throw new Error(`${t('common.nameEn')} / ${t('common.nameDv')}: ${t('errors.required')}`);
      return rest;
    },
    afterSave: async (row, isNew, values) => {
      if (isNew && values._boat) {
        await rpc('assign_crew_to_boat', { p_crew: row.id, p_boat: values._boat, p_start: values._start || isoDate(), p_role: values.job_role || null });
      }
    },
    exportColumns: (xt) => [
      { header: xt('crew.code'), key: 'crew_code' }, { header: xt('common.nameEn'), key: 'name_en' }, { header: xt('common.nameDv'), key: 'name_dv' },
      { header: xt('crew.jobRole'), key: 'job_role', value: (r) => xt(`jobRoles.${r.job_role}`) }, { header: xt('crew.currentBoat'), key: 'current_boat_name' },
      { header: xt('common.phone'), key: 'phone' }, { header: xt('crew.joiningDate'), key: 'joining_date', type: 'date' },
      { header: xt('crew.outstandingAdvances'), key: 'advances_outstanding', type: 'money' },
      { header: xt('crew.wagesOutstanding'), key: 'wages_outstanding', type: 'money' },
      { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
  };
  return <ResourcePage config={config} />;
}
