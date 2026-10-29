import { useState } from 'react';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Alert, StatusBadge, Money } from '@/components/ui';
import { PAY_METHODS, enumOptions } from '@/components/Form';
import { RecordActions } from '@/components/Workflow';
import { FilePicker } from '@/components/FileUpload';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { uploadDocument } from '@/lib/storage';
import { updateRow } from '@/lib/db';
import { dname, date as fmtDate, isoDate } from '@/lib/format';

export const APPROVAL_STATUSES = enumOptions('status', ['draft', 'pending_approval', 'approved', 'rejected', 'voided']);

export default function Advances() {
  const { t, lang } = useI18n();
  const { currency, company, can } = useAuth();
  const [tick, setTick] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const config: ResourceConfig = {
    table: 'cash_advances', view: 'v_cash_advances', title: 'advance.title', newLabel: 'advance.new',
    viewPerm: 'advances.view', managePerm: 'advances.manage', reloadKey: tick,
    searchColumns: ['advance_code', 'crew_name_en', 'crew_name_dv', 'crew_code', 'reason'],
    defaultSort: { column: 'date', ascending: false },
    filters: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew' },
      { name: 'status', label: 'common.status', type: 'select', options: APPROVAL_STATUSES },
      { name: 'date', label: 'common.date', type: 'daterange', column: 'date' },
    ],
    intro: <Alert tone="info">{t('advance.note')}</Alert>,
    canEdit: (r) => ['draft', 'pending_approval', 'rejected'].includes(r.status),
    columns: [
      { key: 'advance_code', label: t('common.code') },
      { key: 'date', label: t('common.date'), sortable: true, render: (r) => fmtDate(r.date, lang) },
      { key: 'crew', label: t('common.crewMember'), render: (r) => <div>{dname(r.crew_name_en, r.crew_name_dv, lang)}<div className="text-xs text-slate-500">{r.crew_code} · {r.boat_name}</div></div> },
      { key: 'reason', label: t('common.reason'), hideSm: true },
      { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <Money value={r.amount} currency={currency} /> },
      { key: 'recovered', label: t('advance.recovered'), align: 'end', hideSm: true, render: (r) => <Money value={r.recovered} currency={currency} /> },
      { key: 'outstanding', label: t('advance.outstanding'), align: 'end', render: (r) => <Money value={r.outstanding} currency={currency} /> },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
      { key: '_a', label: '', render: (r) => <RecordActions table="cash_advances" row={r} onDone={() => setTick((x) => x + 1)} /> },
    ],
    fields: [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true, onSet: () => ({ crew_id: null }) },
      { name: 'crew_id', label: 'common.crewMember', type: 'ref', ref: 'crew', refParams: (v) => ({ boatId: v.boat_id }), required: true },
      { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
      { name: 'amount', label: 'common.amount', type: 'money', required: true, min: 0.01 },
      { name: 'method', label: 'common.method', type: 'select', options: PAY_METHODS, required: true, default: 'cash' },
      { name: 'reference', label: 'common.reference', type: 'text' },
      { name: 'reason', label: 'common.reason', type: 'text', required: true, wide: true },
      { name: 'recovery_plan', label: 'advance.recoveryPlan', type: 'text', wide: true },
      { name: 'max_recovery_per_period', label: 'advance.maxPerPeriod', type: 'money', min: 0.01 },
      { name: 'recover_from_date', label: 'advance.recoverFrom', type: 'date' },
      { name: 'status', label: 'common.status', type: 'select', required: true, readOnlyOnEdit: true,
        default: can('advances.approve') ? 'approved' : 'pending_approval',
        options: enumOptions('status', can('advances.approve') ? ['draft', 'pending_approval', 'approved'] : ['draft', 'pending_approval']) },
    ],
    beforeSave: (v, isNew) => { const out = { ...v }; if (!isNew) delete out.status; return out; },
    extraForm: () => <div><div className="mb-1 text-xs font-medium text-slate-600">{t('advance.evidence')}</div><FilePicker files={files} onChange={setFiles} multiple={false} compact /></div>,
    afterSave: async (row) => {
      if (files[0] && company) {
        const d = await uploadDocument({ file: files[0], companyId: company.id, entityType: 'cash_advance', entityId: row.id, boatId: row.boat_id, docKind: 'payment_receipt' });
        await updateRow('cash_advances', row.id, { document_id: d.id }).catch(() => undefined);
        setFiles([]);
      }
    },
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'advance_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('crew.code'), key: 'crew_code' }, { header: xt('common.crewMember'), key: 'crew_name_en' }, { header: xt('common.nameDv'), key: 'crew_name_dv' },
      { header: xt('common.boat'), key: 'boat_name' }, { header: xt('common.reason'), key: 'reason' }, { header: xt('common.method'), key: 'method' },
      { header: xt('common.amount'), key: 'amount', type: 'money' }, { header: xt('advance.recovered'), key: 'recovered', type: 'money' },
      { header: xt('advance.outstanding'), key: 'outstanding', type: 'money' }, { header: xt('advance.recoveryPlan'), key: 'recovery_plan' },
      { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
      { header: xt('common.recordedBy'), key: 'recorded_by_name' }, { header: xt('common.approvedBy'), key: 'approved_by_name' },
    ],
    exportName: 'cash-advances',
  };
  return <ResourcePage config={config} />;
}
