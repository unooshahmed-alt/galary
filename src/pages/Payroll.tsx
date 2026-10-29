import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { StatusBadge, Money } from '@/components/ui';
import { enumOptions } from '@/components/Form';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchOne } from '@/lib/db';
import { dname, date as fmtDate } from '@/lib/format';

export const PAYROLL_STATUSES = enumOptions('status', ['draft', 'calculated', 'pending_approval', 'approved', 'finalized', 'reversed']);

export default function Payroll() {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const status = params.get('status');
  const tripParam = params.get('trip');
  const boatParam = params.get('boat');

  const config: ResourceConfig = {
    table: 'payroll_periods', view: 'v_payrolls', title: 'payroll.title', newLabel: 'payroll.new',
    viewPerm: 'payroll.view', managePerm: 'payroll.prepare', invalidates: ['payrolls', 'openPayrolls'],
    searchColumns: ['payroll_code', 'boat_name', 'trip_code'], defaultSort: { column: 'period_start', ascending: false },
    baseFilters: [...(status ? [['status', 'eq', status] as ['status', 'eq', string]] : []), ...(tripParam ? [['trip_id', 'eq', tripParam] as ['trip_id', 'eq', string]] : [])],
    filters: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      ...(status ? [] : [{ name: 'status', label: 'common.status', type: 'select' as const, options: PAYROLL_STATUSES }]),
      { name: 'period_end', label: 'common.period', type: 'daterange', column: 'period_end' },
    ],
    onRowClick: (r) => nav(`/payroll/${r.id}`),
    newDefaults: { boat_id: boatParam, trip_id: tripParam, _mode: tripParam ? 'trip' : 'period' },
    columns: [
      { key: 'payroll_code', label: t('common.code'), render: (r) => <span className="font-medium">{r.payroll_code}</span> },
      { key: 'boat_name', label: t('common.boat'), render: (r) => dname(r.boat_name, r.boat_name_dv, lang) },
      { key: 'trip_code', label: t('common.trip') },
      { key: 'period', label: t('common.period'), render: (r) => `${fmtDate(r.period_start, lang)} – ${fmtDate(r.period_end, lang)}` },
      { key: 'rule', label: t('payroll.ruleVersion'), hideSm: true, render: (r) => (r.rule_name ? `${r.rule_name} v${r.rule_version}` : '—') },
      { key: 'crew_count', label: t('nav.crew'), align: 'end', hideSm: true },
      { key: 'total_net', label: t('payroll.totalNet'), align: 'end', render: (r) => <Money value={r.total_net} currency={currency} /> },
      { key: 'total_paid', label: t('common.paid'), align: 'end', hideSm: true, render: (r) => <Money value={r.total_paid} currency={currency} /> },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
    ],
    fields: [
      { name: '_mode', label: 'common.type', type: 'select', required: true, default: 'trip',
        options: [{ value: 'trip', label: 'payroll.forTrip' }, { value: 'period', label: 'payroll.forPeriod' }] },
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true, onSet: () => ({ trip_id: null, rule_version_id: null }) },
      { name: 'trip_id', label: 'common.trip', type: 'ref', ref: 'trips', refParams: (v) => ({ boatId: v.boat_id }), required: true, showIf: (v) => v._mode === 'trip',
        onSet: (_v, _vals, row) => (row ? { period_start: row.start_date, period_end: row.return_date ?? row.start_date } : {}) },
      { name: 'period_start', label: 'common.from', type: 'date', required: true, readOnly: (v) => v._mode === 'trip' },
      { name: 'period_end', label: 'common.to', type: 'date', required: true, readOnly: (v) => v._mode === 'trip' },
      { name: 'rule_version_id', label: 'payroll.ruleVersion', type: 'ref', ref: 'ruleVersions', refParams: (v) => ({ boatId: v.boat_id }), required: true, hint: 'payroll.noRule' },
      { name: 'custom_base_amount', label: 'payroll.customBase', type: 'money', min: 0 },
      { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
    ],
    beforeSave: async (v) => {
      const { _mode, ...rest } = v;
      if (_mode !== 'trip') rest.trip_id = null;
      if (_mode === 'trip' && rest.trip_id && (!rest.period_start || !rest.period_end)) {
        const tr = await fetchOne('trips', rest.trip_id);
        rest.period_start = tr?.start_date; rest.period_end = tr?.return_date ?? tr?.start_date;
      }
      return rest;
    },
    afterSave: (row, isNew) => { if (isNew) nav(`/payroll/${row.id}`); },
    canEdit: () => false,
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'payroll_code' }, { header: xt('common.boat'), key: 'boat_name' }, { header: xt('common.trip'), key: 'trip_code' },
      { header: xt('common.from'), key: 'period_start', type: 'date' }, { header: xt('common.to'), key: 'period_end', type: 'date' },
      { header: xt('payroll.base'), key: 'base_amount', type: 'money' }, { header: xt('payroll.pool'), key: 'crew_pool', type: 'money' },
      { header: xt('payroll.ownerAllocation'), key: 'owner_allocation', type: 'money' }, { header: xt('payroll.totalBonuses'), key: 'total_bonuses', type: 'money' },
      { header: xt('payroll.ownerRemaining'), key: 'owner_remaining', type: 'money' }, { header: xt('payroll.totalGross'), key: 'total_gross', type: 'money' },
      { header: xt('payroll.totalDeductions'), key: 'total_deductions', type: 'money' }, { header: xt('payroll.totalNet'), key: 'total_net', type: 'money' },
      { header: xt('common.paid'), key: 'total_paid', type: 'money' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
    exportName: 'payroll',
  };
  return <ResourcePage config={config} />;
}
