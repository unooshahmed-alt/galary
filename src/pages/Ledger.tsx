import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Alert, Button, StatusBadge, Money, Badge } from '@/components/ui';
import { PAY_METHODS, enumOptions } from '@/components/Form';
import { FilePicker } from '@/components/FileUpload';
import { useConfirm } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { Icon } from '@/components/Icon';
import { useI18n, type Lang, type TFn } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc, errorText, type Row } from '@/lib/db';
import { uploadDocument } from '@/lib/storage';
import { dname, date as fmtDate, isoDate } from '@/lib/format';

type Kind = 'income' | 'expense';

export function ledgerConfig(kind: Kind, t: TFn, lang: Lang, currency: string, opts: {
  canApprove: boolean; companyId?: string; act: (r: Row, action: 'approve' | 'reject' | 'void' | 'submit') => void;
  files: File[]; setFiles: (f: File[]) => void; fixedTrip?: Row; onBill: (id: string) => void; reloadKey?: number;
}): ResourceConfig {
  const ft = opts.fixedTrip;
  const isInc = kind === 'income';
  return {
    table: 'transactions', view: 'v_transactions', embedded: !!ft, reloadKey: opts.reloadKey,
    title: isInc ? 'ledger.incomeTitle' : 'ledger.expenseTitle', newLabel: isInc ? 'ledger.newIncome' : 'ledger.newExpense',
    viewPerm: isInc ? 'income.view' : 'expenses.view', managePerm: isInc ? 'income.manage' : 'expenses.manage',
    baseFilters: [['kind', 'eq', kind], ...(ft ? [['trip_id', 'eq', ft.id] as [string, 'eq', string]] : [])],
    defaultSort: { column: 'date', ascending: false },
    searchColumns: ft ? undefined : ['txn_code', 'description', 'reference', 'supplier_name', 'customer_name', 'bill_code'],
    filters: ft ? [] : [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'category_id', label: 'common.category', type: 'ref', ref: isInc ? 'incomeCategories' : 'expenseCategories' },
      { name: 'status', label: 'common.status', type: 'select', options: enumOptions('status', ['draft', 'pending_approval', 'approved', 'rejected', 'voided']) },
      { name: 'date', label: 'common.date', type: 'daterange', column: 'date' },
    ],
    intro: !ft ? <Alert tone="info">{isInc ? t('ledger.approvalHint') : `${t('ledger.billHint')} ${t('ledger.approvalHint')}`}</Alert> : undefined,
    onRowClick: undefined,
    canEdit: (r) => r.source === 'manual' && ['draft', 'pending_approval', 'rejected'].includes(r.status),
    columns: [
      { key: 'txn_code', label: t('common.code'), render: (r) => <span className="font-medium">{r.txn_code}</span> },
      { key: 'date', label: t('common.date'), sortable: true, render: (r) => fmtDate(r.date, lang) },
      { key: 'category', label: t('common.category'), render: (r) => dname(r.category_name_en, r.category_name_dv, lang) },
      { key: 'description', label: t('common.description'), render: (r) => (
        <div className="max-w-[16rem] truncate">{r.description ?? '—'}{r.source === 'bill' && <> <Badge tone="blue">{r.bill_code}</Badge></>}</div>) },
      ...(ft ? [] : [{ key: 'boat_name', label: t('common.boat'), hideSm: true }]),
      { key: 'party', label: isInc ? t('common.customer') : t('common.supplier'), hideSm: true, render: (r: Row) => (isInc ? r.customer_name : r.supplier_name) ?? '—' },
      { key: 'amount', label: t('common.amount'), align: 'end', sortable: true, render: (r) => <Money value={r.amount} currency={currency} /> },
      { key: 'payment_status', label: t('ledger.paymentStatus'), hideSm: true, render: (r) => <StatusBadge status={r.payment_status} /> },
      { key: 'has_document', label: t('ledger.hasDocument'), align: 'center', render: (r) => (r.has_document ? <Icon name="file" size={16} className="mx-auto text-ocean-600" /> : <span className="text-amber-600">—</span>) },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
      { key: '_actions', label: '', render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {r.source === 'bill' && <Button size="sm" variant="ghost" icon="receipt" onClick={() => opts.onBill(r.bill_id)} aria-label="bill" />}
          {r.source === 'manual' && opts.canApprove && r.status === 'pending_approval' && <>
            <Button size="sm" variant="success" icon="check" onClick={() => opts.act(r, 'approve')}>{t('common.approve')}</Button>
            <Button size="sm" onClick={() => opts.act(r, 'reject')}>{t('common.reject')}</Button>
          </>}
          {r.source === 'manual' && ['draft', 'rejected'].includes(r.status) && <Button size="sm" onClick={() => opts.act(r, 'submit')}>{t('common.submit')}</Button>}
          {r.source === 'manual' && opts.canApprove && r.status === 'approved' && <Button size="sm" variant="ghost" onClick={() => opts.act(r, 'void')}>{t('common.void')}</Button>}
        </div>) },
    ],
    fields: [
      { name: 'kind', label: 'common.type', type: 'text', default: kind, showIf: () => false },
      { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
      { name: 'category_id', label: 'common.category', type: 'ref', ref: isInc ? 'incomeCategories' : 'expenseCategories', required: true },
      { name: 'amount', label: 'common.amount', type: 'money', required: true, min: 0.01 },
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', default: ft?.boat_id, readOnly: () => !!ft },
      { name: 'trip_id', label: 'common.trip', type: 'ref', ref: 'trips', refParams: (v) => ({ boatId: v.boat_id }), default: ft?.id, readOnly: () => !!ft },
      isInc ? { name: 'customer_id', label: 'common.customer', type: 'ref', ref: 'customers' }
            : { name: 'supplier_id', label: 'common.supplier', type: 'ref', ref: 'suppliers' },
      { name: 'payment_status', label: 'ledger.paymentStatus', type: 'select', required: true, default: 'paid',
        options: enumOptions('status', ['paid', 'unpaid', 'partially_paid']) },
      { name: 'payment_method', label: 'common.method', type: 'select', options: PAY_METHODS, showIf: (v) => v.payment_status !== 'unpaid' },
      { name: 'reference', label: 'common.reference', type: 'text' },
      { name: 'status', label: 'common.status', type: 'select', required: true, readOnlyOnEdit: true,
        default: opts.canApprove ? 'approved' : 'pending_approval',
        options: enumOptions('status', opts.canApprove ? ['draft', 'pending_approval', 'approved'] : ['draft', 'pending_approval']) },
      { name: 'description', label: 'common.description', type: 'textarea', wide: true },
    ],
    newDefaults: ft ? { boat_id: ft.boat_id, trip_id: ft.id, kind } : { kind },
    beforeSave: (v, isNew) => {
      const out: Row = { ...v, kind };
      if (!isNew) delete out.status;
      return out;
    },
    extraForm: (_v, _set, existing) => (
      <div>
        <div className="mb-1 text-xs font-medium text-slate-600">{t('common.attachments')}</div>
        <FilePicker files={opts.files} onChange={opts.setFiles} compact={!!existing} />
      </div>
    ),
    afterSave: async (row) => {
      if (opts.files.length && opts.companyId) {
        for (const f of opts.files) {
          await uploadDocument({ file: f, companyId: opts.companyId, entityType: 'transaction', entityId: row.id, boatId: row.boat_id, docKind: 'receipt' });
        }
        opts.setFiles([]);
      }
    },
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'txn_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('common.category'), key: 'category_name_en' }, { header: xt('common.description'), key: 'description' },
      { header: xt('common.boat'), key: 'boat_name' }, { header: xt('common.trip'), key: 'trip_code' },
      { header: isInc ? xt('common.customer') : xt('common.supplier'), key: isInc ? 'customer_name' : 'supplier_name' },
      { header: xt('bills.invoiceNo'), key: 'bill_code' }, { header: xt('common.amount'), key: 'amount', type: 'money' },
      { header: xt('ledger.paymentStatus'), key: 'payment_status', value: (r) => xt(`status.${r.payment_status}`) },
      { header: xt('common.method'), key: 'payment_method' }, { header: xt('common.reference'), key: 'reference' },
      { header: xt('ledger.hasDocument'), key: 'has_document', value: (r) => (r.has_document ? '✓' : '—') },
      { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) },
      { header: xt('common.createdBy'), key: 'created_by_name' }, { header: xt('common.approvedBy'), key: 'approved_by_name' },
    ],
    exportName: kind,
  };
}

/** Hook bundling the state needed by ledgerConfig (approvals + attachments). */
export function useLedger(kind: Kind, fixedTrip?: Row) {
  const { t, lang } = useI18n();
  const { can, currency, company } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { confirm, dialog } = useConfirm();
  const [files, setFiles] = useState<File[]>([]);
  const [tick, setTick] = useState(0);
  const act = async (r: Row, action: 'approve' | 'reject' | 'void' | 'submit') => {
    const needs = action === 'reject' || action === 'void';
    const reason = await confirm({ title: `${t(`common.${action === 'submit' ? 'submitForApproval' : action}`)} · ${r.txn_code}`, reason: needs ? true : 'optional', tone: needs ? 'danger' : 'success' });
    if (reason === null) return;
    try {
      await rpc('set_transaction_status', { p_id: r.id, p_action: action, p_comment: reason || null });
      toast.success(t('common.success'));
      setTick((x) => x + 1);
    } catch (e) { toast.error(errorText(e, t)); }
  };
  const config = ledgerConfig(kind, t, lang, currency, {
    canApprove: can('transactions.approve'), companyId: company?.id, act, files, setFiles, fixedTrip,
    onBill: (id) => nav(`/bills/${id}`), reloadKey: tick,
  });
  return { config, dialog };
}

export default function Ledger({ kind }: { kind: Kind }) {
  const { config, dialog } = useLedger(kind);
  return <>{dialog}<ResourcePage key={kind} config={config} /></>;
}
