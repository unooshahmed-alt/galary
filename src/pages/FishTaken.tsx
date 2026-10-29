import { useState } from 'react';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Alert, Button, StatusBadge, Money } from '@/components/ui';
import { UNITS, enumOptions } from '@/components/Form';
import { RecordActions } from '@/components/Workflow';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { updateRow, errorText } from '@/lib/db';
import { dname, date as fmtDate, isoDate, qty, money } from '@/lib/format';
import { APPROVAL_STATUSES } from './Advances';

export default function FishTaken() {
  const { t, lang } = useI18n();
  const { currency, can } = useAuth();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const config: ResourceConfig = {
    table: 'fish_taken', view: 'v_fish_taken', title: 'fishTaken.title', newLabel: 'fishTaken.new',
    viewPerm: 'fish_taken.view', managePerm: 'fish_taken.manage', reloadKey: tick,
    searchColumns: ['fish_taken_code', 'crew_name_en', 'crew_name_dv', 'crew_code', 'trip_code'],
    defaultSort: { column: 'date', ascending: false },
    filters: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew' },
      { name: 'status', label: 'common.status', type: 'select', options: APPROVAL_STATUSES },
      { name: 'date', label: 'common.date', type: 'daterange', column: 'date' },
    ],
    intro: <Alert tone="info">{t('fishTaken.note')}</Alert>,
    canEdit: (r) => ['draft', 'pending_approval', 'rejected'].includes(r.status),
    columns: [
      { key: 'fish_taken_code', label: t('common.code') },
      { key: 'date', label: t('common.date'), sortable: true, render: (r) => fmtDate(r.date, lang) },
      { key: 'crew', label: t('common.crewMember'), render: (r) => <div>{dname(r.crew_name_en, r.crew_name_dv, lang)}<div className="text-xs text-slate-500">{r.boat_name}{r.trip_code ? ` · ${r.trip_code}` : ''}</div></div> },
      { key: 'fish', label: t('sales.fishType'), render: (r) => `${dname(r.fish_name_en, r.fish_name_dv, lang)} · ${qty(r.quantity)} ${t(`units.${r.unit}`)}` },
      { key: 'unit_price', label: t('fishTaken.agreedPrice'), align: 'end', hideSm: true, render: (r) => <Money value={r.unit_price} currency={currency} /> },
      { key: 'total', label: t('fishTaken.totalValue'), align: 'end', render: (r) => <Money value={r.total} currency={currency} /> },
      { key: 'deduct', label: t('fishTaken.deduct'), align: 'center', render: (r) => (r.deduct_from_wages ? '✓' : '—') },
      { key: 'payroll_code', label: t('fishTaken.deductedIn'), hideSm: true },
      { key: 'ack', label: t('fishTaken.acknowledged'), render: (r) => (r.acknowledged ? `✓ ${fmtDate(r.acknowledged_at, lang)}` : can('fish_taken.manage') && r.status !== 'voided'
        ? <Button size="sm" onClick={async (e) => { e.stopPropagation(); try { await updateRow('fish_taken', r.id, { acknowledged: true }); setTick((x) => x + 1); } catch (er) { toast.error(errorText(er, t)); } }}>{t('fishTaken.acknowledge')}</Button> : '—') },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
      { key: '_a', label: '', render: (r) => <RecordActions table="fish_taken" row={r} onDone={() => setTick((x) => x + 1)} /> },
    ],
    fields: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true, onSet: () => ({ crew_id: null, trip_id: null }) },
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew', refParams: (v) => ({ boatId: v.boat_id }), required: true },
      { name: 'trip_id', label: 'common.trip', type: 'ref', ref: 'trips', refParams: (v) => ({ boatId: v.boat_id }) },
      { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
      { name: 'fish_type_id', label: 'sales.fishType', type: 'ref', ref: 'fishTypes', required: true, onSet: (_v, _vals, ref) => (ref ? { unit: ref.default_unit } : {}) },
      { name: 'quantity', label: 'sales.weight', type: 'number', required: true, min: 0.001 },
      { name: 'unit', label: 'common.unit', type: 'select', options: UNITS, required: true, default: 'kg' },
      { name: 'unit_price', label: 'fishTaken.agreedPrice', type: 'money', required: true, min: 0 },
      { name: '_total', label: 'fishTaken.totalValue', type: 'text', render: (v) => (
        <div className="rounded-lg bg-ocean-50 px-3 py-2 text-sm">{t('fishTaken.totalValue')}: <b dir="ltr">{money(Number(v.quantity || 0) * Number(v.unit_price || 0), currency)}</b></div>) },
      { name: 'deduct_from_wages', label: 'fishTaken.deduct', type: 'checkbox', default: true },
      { name: 'acknowledged', label: 'fishTaken.acknowledged', type: 'checkbox', default: false },
      { name: 'status', label: 'common.status', type: 'select', required: true, readOnlyOnEdit: true,
        default: can('fish_taken.approve') ? 'approved' : 'pending_approval',
        options: enumOptions('status', can('fish_taken.approve') ? ['draft', 'pending_approval', 'approved'] : ['draft', 'pending_approval']) },
      { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
    ],
    beforeSave: (v, isNew) => { const { _total, ...out } = v; void _total; if (!isNew) delete out.status; return out; },
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'fish_taken_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('common.crewMember'), key: 'crew_name_en' }, { header: xt('common.nameDv'), key: 'crew_name_dv' }, { header: xt('common.boat'), key: 'boat_name' },
      { header: xt('common.trip'), key: 'trip_code' }, { header: xt('sales.fishType'), key: 'fish_name_en' }, { header: xt('common.quantity'), key: 'quantity', type: 'qty' },
      { header: xt('common.unit'), key: 'unit' }, { header: xt('fishTaken.agreedPrice'), key: 'unit_price', type: 'money' },
      { header: xt('fishTaken.totalValue'), key: 'total', type: 'money' }, { header: xt('fishTaken.deduct'), key: 'deduct_from_wages', value: (r) => (r.deduct_from_wages ? '✓' : '—') },
      { header: xt('fishTaken.deductedIn'), key: 'payroll_code' }, { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
    ],
    exportName: 'fish-taken',
  };
  return <ResourcePage config={config} />;
}
