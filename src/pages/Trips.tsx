import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { StatusBadge, Money } from '@/components/ui';
import { enumOptions, type FieldDef } from '@/components/Form';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { dname, date as fmtDate, isoDate } from '@/lib/format';

export const TRIP_STATUSES = enumOptions('status', ['planned', 'active', 'returned', 'under_review', 'closed']);

export const TRIP_FIELDS: FieldDef[] = [
  { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true },
  { name: 'status', label: 'common.status', type: 'select', options: TRIP_STATUSES.slice(0, 2), default: 'planned', required: true, readOnlyOnEdit: true },
  { name: 'start_date', label: 'trips.startDate', type: 'date', required: true, default: () => isoDate() },
  { name: 'return_date', label: 'trips.returnDate', type: 'date' },
  { name: 'location', label: 'trips.location', type: 'text', wide: true },
  { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
];

export default function Trips() {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const attention = params.get('attention') === '1';
  const config: ResourceConfig = {
    table: 'trips', view: 'v_trips', title: 'trips.title', newLabel: 'trips.new',
    viewPerm: 'trips.view', managePerm: 'trips.manage', invalidates: ['trips'],
    searchColumns: ['trip_code', 'boat_name', 'location'],
    defaultSort: { column: 'start_date', ascending: false },
    baseFilters: attention ? [['status', 'in', ['returned', 'under_review', 'active']]] : [],
    filters: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'status', label: 'common.status', type: 'select', options: TRIP_STATUSES },
      { name: 'start_date', label: 'common.date', type: 'daterange', column: 'start_date' },
    ],
    onRowClick: (r) => nav(`/trips/${r.id}`),
    afterSave: (row, isNew) => { if (isNew) nav(`/trips/${row.id}`); },
    columns: [
      { key: 'trip_code', label: t('common.code'), sortable: true, render: (r) => <span className="font-medium">{r.trip_code}</span> },
      { key: 'boat_name', label: t('common.boat'), render: (r) => dname(r.boat_name, r.boat_name_dv, lang) },
      { key: 'start_date', label: t('trips.startDate'), sortable: true, render: (r) => fmtDate(r.start_date, lang) },
      { key: 'return_date', label: t('trips.returnDate'), render: (r) => fmtDate(r.return_date, lang), hideSm: true },
      { key: 'crew_count', label: t('trips.crew'), align: 'end', hideSm: true },
      { key: 'sales_total', label: t('trips.sales'), align: 'end', render: (r) => <Money value={r.sales_total} currency={currency} /> },
      { key: 'expenses', label: t('trips.expenses'), align: 'end', hideSm: true, render: (r) => <Money value={r.expenses} currency={currency} /> },
      { key: 'trip_profit', label: t('trips.profit'), align: 'end', render: (r) => <Money value={r.trip_profit} currency={currency} /> },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    ],
    fields: TRIP_FIELDS,
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'trip_code' }, { header: xt('common.boat'), key: 'boat_name' },
      { header: xt('trips.startDate'), key: 'start_date', type: 'date' }, { header: xt('trips.returnDate'), key: 'return_date', type: 'date' },
      { header: xt('trips.location'), key: 'location' }, { header: xt('trips.crew'), key: 'crew_count', type: 'number' },
      { header: xt('trips.catch'), key: 'catch_kg', type: 'qty' }, { header: xt('trips.sales'), key: 'sales_total', type: 'money' },
      { header: xt('trips.income'), key: 'other_income', type: 'money' }, { header: xt('trips.expenses'), key: 'expenses', type: 'money' },
      { header: xt('trips.profit'), key: 'trip_profit', type: 'money' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
  };
  return <ResourcePage config={config} />;
}
