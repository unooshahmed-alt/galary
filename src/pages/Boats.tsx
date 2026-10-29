import { useNavigate } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { StatusBadge } from '@/components/ui';
import { RECORD_STATUS } from '@/components/Form';
import { useI18n } from '@/lib/i18n';
import { dname } from '@/lib/format';

export default function Boats() {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const config: ResourceConfig = {
    table: 'boats', view: 'v_boats', title: 'boats.title', newLabel: 'boats.new',
    viewPerm: 'boats.view', managePerm: 'boats.manage', invalidates: ['boats'],
    searchColumns: ['name', 'name_dv', 'registration_no', 'home_island'],
    defaultSort: { column: 'name', ascending: true },
    filters: [{ name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS }],
    onRowClick: (r) => nav(`/boats/${r.id}`),
    columns: [
      { key: 'name', label: t('boats.name'), sortable: true, render: (r) => <span className="font-medium">{dname(r.name, r.name_dv, lang)}</span> },
      { key: 'registration_no', label: t('boats.registrationNo'), sortable: true },
      { key: 'home_island', label: t('boats.homeIsland'), hideSm: true },
      { key: 'manager_name', label: t('boats.manager'), hideSm: true },
      { key: 'crew_count', label: t('boats.crewCount'), align: 'end' },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    ],
    fields: BOAT_FIELDS,
    exportColumns: (xt) => [
      { header: xt('boats.name'), key: 'name' }, { header: xt('common.nameDv'), key: 'name_dv' },
      { header: xt('boats.registrationNo'), key: 'registration_no' }, { header: xt('boats.vesselType'), key: 'vessel_type' },
      { header: xt('boats.homeIsland'), key: 'home_island' }, { header: xt('boats.manager'), key: 'manager_name' },
      { header: xt('boats.crewCount'), key: 'crew_count', type: 'number' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
  };
  return <ResourcePage config={config} />;
}

export const BOAT_FIELDS: ResourceConfig['fields'] = [
  { name: 'name', label: 'boats.name', type: 'text', required: true },
  { name: 'name_dv', label: 'common.nameDv', type: 'text', rtl: true },
  { name: 'registration_no', label: 'boats.registrationNo', type: 'text', required: true },
  { name: 'license_no', label: 'boats.licenseNo', type: 'text' },
  { name: 'vessel_type', label: 'boats.vesselType', type: 'text' },
  { name: 'home_island', label: 'boats.homeIsland', type: 'text' },
  { name: 'length_m', label: 'boats.length', type: 'number', min: 0 },
  { name: 'engine', label: 'boats.engine', type: 'text' },
  { name: 'capacity', label: 'boats.capacity', type: 'text' },
  { name: 'manager_id', label: 'boats.manager', type: 'ref', ref: 'profiles' },
  { name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS, default: 'active', required: true },
  { name: 'details', label: 'boats.details', type: 'textarea', wide: true },
];
