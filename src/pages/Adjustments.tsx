import { useState } from 'react';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Alert, StatusBadge, Money } from '@/components/ui';
import { enumOptions } from '@/components/Form';
import { RecordActions } from '@/components/Workflow';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { dname, date as fmtDate, isoDate } from '@/lib/format';
import { APPROVAL_STATUSES } from './Advances';

export default function Adjustments() {
  const { t, lang } = useI18n();
  const { currency, can } = useAuth();
  const [tick, setTick] = useState(0);
  const config: ResourceConfig = {
    table: 'payroll_adjustments', view: 'v_payroll_adjustments', title: 'adjustment.title', newLabel: 'adjustment.new',
    viewPerm: 'adjustments.view', managePerm: 'adjustments.manage', reloadKey: tick,
    searchColumns: ['adjustment_code', 'crew_name_en', 'crew_name_dv', 'reason'],
    defaultSort: { column: 'date', ascending: false },
    filters: [
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew' },
      { name: 'kind', label: 'common.type', type: 'select', options: enumOptions('adjustment', ['earning', 'deduction', 'carry_forward']) },
      { name: 'status', label: 'common.status', type: 'select', options: APPROVAL_STATUSES },
    ],
    intro: <Alert tone="info">{t('adjustment.note')}</Alert>,
    canEdit: (r) => ['draft', 'pending_approval', 'rejected'].includes(r.status) && r.kind !== 'carry_forward',
    columns: [
      { key: 'adjustment_code', label: t('common.code') },
      { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
      { key: 'crew', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
      { key: 'kind', label: t('common.type'), render: (r) => t(`adjustment.${r.kind}`) },
      { key: 'reason', label: t('common.reason') },
      { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <Money value={r.kind === 'earning' ? r.amount : -r.amount} currency={currency} /> },
      { key: 'target', label: t('adjustment.targetPayroll'), hideSm: true, render: (r) => r.target_payroll_code ?? r.source_payroll_code ?? '—' },
      { key: 'applied_payroll_code', label: t('adjustment.appliedIn'), render: (r) => r.applied_payroll_code ?? '—' },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
      { key: '_a', label: '', render: (r) => <RecordActions table="payroll_adjustments" row={r} onDone={() => setTick((x) => x + 1)} /> },
    ],
    fields: [
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew', required: true },
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'kind', label: 'common.type', type: 'select', required: true, default: 'deduction', options: enumOptions('adjustment', ['earning', 'deduction']) },
      { name: 'amount', label: 'common.amount', type: 'money', required: true, min: 0.01 },
      { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
      { name: 'payroll_id', label: 'adjustment.targetPayroll', type: 'ref', ref: 'openPayrolls', refParams: (v) => ({ boatId: v.boat_id }) },
      { name: 'reason', label: 'common.reason', type: 'text', required: true, wide: true },
      { name: 'status', label: 'common.status', type: 'select', required: true, readOnlyOnEdit: true,
        default: can('adjustments.approve') ? 'approved' : 'pending_approval',
        options: enumOptions('status', can('adjustments.approve') ? ['draft', 'pending_approval', 'approved'] : ['draft', 'pending_approval']) },
    ],
    beforeSave: (v, isNew) => { const out = { ...v }; if (!isNew) delete out.status; return out; },
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'adjustment_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('common.crewMember'), key: 'crew_name_en' }, { header: xt('common.type'), key: 'kind', value: (r) => xt(`adjustment.${r.kind}`) },
      { header: xt('common.reason'), key: 'reason' }, { header: xt('common.amount'), key: 'amount', type: 'money' },
      { header: xt('adjustment.appliedIn'), key: 'applied_payroll_code' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
    exportName: 'payroll-adjustments',
  };
  return <ResourcePage config={config} />;
}
