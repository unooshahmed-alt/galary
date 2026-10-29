import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Button, StatusBadge, Money, Alert } from '@/components/ui';
import { enumOptions } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import type { Filter } from '@/lib/db';
import { dname, date as fmtDate, isoDate } from '@/lib/format';

export const BILL_STATUS_OPTIONS = enumOptions('status', ['draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'overdue', 'rejected', 'voided']);

export default function Bills() {
  const { t, lang } = useI18n();
  const { currency, can, company } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const missing = params.get('missing') === '1';

  const baseFilters = useMemo<Filter[]>(() => {
    const f: Filter[] = [];
    if (status === 'due_soon') {
      const days = Number(company?.settings?.bill_due_soon_days ?? 7);
      const until = new Date(); until.setDate(until.getDate() + days);
      f.push(['status', 'in', ['approved', 'partially_paid']], ['due_date', 'gte', isoDate()], ['due_date', 'lte', isoDate(until)], ['outstanding', 'gt', 0]);
    } else if (status) f.push(['display_status', 'eq', status]);
    if (missing) f.push(['document_count', 'eq', 0], ['status', 'in', ['draft', 'pending_approval', 'approved', 'partially_paid', 'paid']]);
    return f;
  }, [status, missing, company]);

  const config: ResourceConfig = {
    table: 'bills', view: 'v_bills', title: 'bills.title', viewPerm: 'bills.view',
    subtitle: t('bills.notPaidOnUpload'),
    searchColumns: ['bill_code', 'supplier_name', 'invoice_no', 'description', 'trip_code', 'entered_by_name'],
    defaultSort: { column: 'bill_date', ascending: false },
    baseFilters,
    filters: [
      ...(status ? [] : [{ name: 'display_status', label: 'common.status', type: 'select' as const, options: BILL_STATUS_OPTIONS }]),
      { name: 'supplier_id', label: 'common.supplier', type: 'ref', ref: 'suppliers' },
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'category_id', label: 'common.category', type: 'ref', ref: 'expenseCategories' },
      { name: 'created_by', label: 'bills.uploadedBy', type: 'ref', ref: 'profiles' },
      { name: 'total', label: 'common.amount', type: 'number' },
      { name: 'bill_date', label: 'bills.billDate', type: 'daterange', column: 'bill_date' },
    ],
    intro: (status || missing) ? (
      <Alert tone="info">
        <span className="flex flex-wrap items-center gap-2">
          {status && <StatusBadge status={status} />}{missing && t('bills.missingDoc')}
          <button className="text-ocean-700 underline" onClick={() => setParams({})}>{t('common.clear')}</button>
        </span>
      </Alert>
    ) : undefined,
    headerActions: can('bills.manage') ? <Button variant="primary" icon="plus" onClick={() => nav('/bills/new')}>{t('bills.new')}</Button> : undefined,
    onRowClick: (r) => nav(`/bills/${r.id}`),
    columns: [
      { key: 'bill_code', label: t('common.code'), sortable: true, render: (r) => <span className="font-medium">{r.bill_code}</span> },
      { key: 'supplier_name', label: t('common.supplier'), sortable: true, render: (r) => dname(r.supplier_name, r.supplier_name_dv, lang) },
      { key: 'invoice_no', label: t('bills.invoiceNo') },
      { key: 'bill_date', label: t('bills.billDate'), sortable: true, render: (r) => fmtDate(r.bill_date, lang) },
      { key: 'due_date', label: t('bills.dueDate'), sortable: true, hideSm: true, render: (r) => fmtDate(r.due_date, lang) },
      { key: 'category', label: t('common.category'), hideSm: true, render: (r) => dname(r.category_name_en, r.category_name_dv, lang) },
      { key: 'boat_name', label: t('common.boat'), hideSm: true, render: (r) => r.boat_name ?? '—' },
      { key: 'total', label: t('common.total'), align: 'end', sortable: true, render: (r) => <Money value={r.total} currency={currency} /> },
      { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => <Money value={r.outstanding} currency={currency} /> },
      { key: 'document_count', label: <Icon name="file" size={14} />, align: 'center', render: (r) => (Number(r.document_count) > 0 ? <Icon name="check" size={15} className="mx-auto text-emerald-600" /> : <Icon name="alert" size={15} className="mx-auto text-amber-500" />) },
      { key: 'display_status', label: t('common.status'), render: (r) => <StatusBadge status={r.display_status} /> },
    ],
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'bill_code' }, { header: xt('common.supplier'), key: 'supplier_name' },
      { header: xt('bills.invoiceNo'), key: 'invoice_no' }, { header: xt('bills.billDate'), key: 'bill_date', type: 'date' },
      { header: xt('bills.dueDate'), key: 'due_date', type: 'date' }, { header: xt('common.category'), key: 'category_name_en' },
      { header: xt('common.boat'), key: 'boat_name' }, { header: xt('common.trip'), key: 'trip_code' },
      { header: xt('common.description'), key: 'description' }, { header: xt('common.subtotal'), key: 'subtotal', type: 'money' },
      { header: xt('bills.tax'), key: 'tax_amount', type: 'money' }, { header: xt('common.total'), key: 'total', type: 'money' },
      { header: xt('bills.amountPaid'), key: 'amount_paid', type: 'money' }, { header: xt('common.outstanding'), key: 'outstanding', type: 'money' },
      { header: xt('common.status'), key: 'display_status', value: (r) => xt(`status.${r.display_status}`) },
      { header: xt('bills.daysOverdue'), key: 'days_overdue', type: 'number' },
      { header: xt('common.documents'), key: 'document_count', type: 'number' },
      { header: xt('bills.enteredBy'), key: 'entered_by_name' }, { header: xt('common.approvedBy'), key: 'approved_by_name' },
      { header: 'Document reference', key: 'ref', value: (r) => `Galary ${r.bill_code} / ${r.id}` },
    ],
    exportName: 'bills-register',
  };
  return <ResourcePage config={config} />;
}
