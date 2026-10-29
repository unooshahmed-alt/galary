import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Button, Money, StatusBadge, Spinner, Tabs } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { ExportMenu } from '@/components/ExportMenu';
import { DataTable } from '@/components/DataTable';
import { RECORD_STATUS } from '@/components/Form';
import { useI18n, exportT, type ExportLang } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, fetchOne, useAsync, type Row } from '@/lib/db';
import { dname, date as fmtDate } from '@/lib/format';
import { CUSTOMER_FIELDS } from './CatchSales';

export default function Suppliers() {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'suppliers' | 'customers'>('suppliers');
  const statementId = params.get('statement');

  const suppliers: ResourceConfig = {
    table: 'suppliers', view: 'v_supplier_balances', title: 'suppliers.title', newLabel: 'suppliers.new',
    viewPerm: 'suppliers.view', managePerm: 'suppliers.manage', invalidates: ['suppliers'],
    searchColumns: ['name', 'name_dv', 'phone', 'email'], defaultSort: { column: 'outstanding', ascending: false },
    filters: [{ name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS }],
    columns: [
      { key: 'name', label: t('common.name'), sortable: true, render: (r) => <span className="font-medium">{dname(r.name, r.name_dv, lang)}</span> },
      { key: 'phone', label: t('common.phone'), hideSm: true, render: (r) => <bdi dir="ltr">{r.phone ?? '—'}</bdi> },
      { key: 'total_billed', label: t('suppliers.totalBilled'), align: 'end', render: (r) => <Money value={r.total_billed} currency={currency} /> },
      { key: 'total_paid', label: t('suppliers.totalPaid'), align: 'end', hideSm: true, render: (r) => <Money value={r.total_paid} currency={currency} /> },
      { key: 'outstanding', label: t('common.outstanding'), align: 'end', sortable: true, render: (r) => <Money value={r.outstanding} currency={currency} /> },
      { key: 'overdue', label: t('suppliers.overdue'), align: 'end', render: (r) => <Money value={r.overdue} currency={currency} className={Number(r.overdue) > 0 ? 'text-coral-600' : ''} /> },
      { key: 'credit_to_reconcile', label: t('suppliers.credit'), align: 'end', hideSm: true, render: (r) => (Number(r.credit_to_reconcile) > 0 ? <Money value={r.credit_to_reconcile} currency={currency} /> : '—') },
      { key: '_s', label: '', render: (r) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setParams({ statement: r.id }); }}>{t('suppliers.statement')}</Button> },
    ],
    fields: SUPPLIER_FIELDS,
    exportColumns: (xt) => [
      { header: xt('common.name'), key: 'name' }, { header: xt('common.nameDv'), key: 'name_dv' }, { header: xt('common.phone'), key: 'phone' },
      { header: xt('suppliers.totalBilled'), key: 'total_billed', type: 'money' }, { header: xt('suppliers.totalPaid'), key: 'total_paid', type: 'money' },
      { header: xt('common.outstanding'), key: 'outstanding', type: 'money' }, { header: xt('suppliers.overdue'), key: 'overdue', type: 'money' },
      { header: xt('suppliers.openBills'), key: 'open_bills', type: 'number' }, { header: xt('suppliers.credit'), key: 'credit_to_reconcile', type: 'money' },
    ],
    exportName: 'supplier-balances',
  };

  const customers: ResourceConfig = {
    table: 'customers', view: 'v_customer_balances', title: 'suppliers.customers', newLabel: 'suppliers.newCustomer',
    viewPerm: 'suppliers.view', managePerm: 'suppliers.manage', invalidates: ['customers'],
    searchColumns: ['name', 'name_dv', 'phone'], defaultSort: { column: 'name', ascending: true },
    columns: [
      { key: 'name', label: t('common.name'), render: (r) => dname(r.name, r.name_dv, lang) },
      { key: 'phone', label: t('common.phone'), render: (r) => <bdi dir="ltr">{r.phone ?? '—'}</bdi> },
      { key: 'total_sales', label: t('suppliers.totalSales'), align: 'end', render: (r) => <Money value={r.total_sales} currency={currency} /> },
      { key: 'total_received', label: t('suppliers.received'), align: 'end', render: (r) => <Money value={r.total_received} currency={currency} /> },
      { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => <Money value={r.outstanding} currency={currency} /> },
    ],
    fields: CUSTOMER_FIELDS,
    exportColumns: (xt) => [
      { header: xt('common.name'), key: 'name' }, { header: xt('suppliers.totalSales'), key: 'total_sales', type: 'money' },
      { header: xt('suppliers.received'), key: 'total_received', type: 'money' }, { header: xt('common.outstanding'), key: 'outstanding', type: 'money' },
    ],
    exportName: 'customer-balances',
  };

  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'suppliers', label: t('suppliers.title') }, { id: 'customers', label: t('suppliers.customers') }]} />
      {tab === 'suppliers' ? <ResourcePage config={suppliers} /> : <ResourcePage config={customers} />}
      {statementId && <SupplierStatement supplierId={statementId} onClose={() => setParams({})} />}
    </div>
  );
}

export const SUPPLIER_FIELDS: ResourceConfig['fields'] = [
  { name: 'name', label: 'common.name', type: 'text', required: true },
  { name: 'name_dv', label: 'common.nameDv', type: 'text', rtl: true },
  { name: 'contact_person', label: 'common.contactPerson', type: 'text' },
  { name: 'phone', label: 'common.phone', type: 'tel' },
  { name: 'email', label: 'common.email', type: 'email' },
  { name: 'tin', label: 'common.tin', type: 'text' },
  { name: 'address', label: 'common.address', type: 'text', wide: true },
  { name: 'bank_details', label: 'suppliers.bankDetails', type: 'text', wide: true },
  { name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS, default: 'active', required: true },
  { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
];

/** Chronological statement: approved bills (debit) and payments (credit) with running balance. */
function SupplierStatement({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const data = useAsync(async () => {
    const [sup, bills, pays] = await Promise.all([
      fetchOne('suppliers', supplierId),
      fetchAll('v_bills', { filters: [['supplier_id', 'eq', supplierId], ['status', 'in', ['approved', 'partially_paid', 'paid']]] }),
      fetchAll('v_bill_payments', { filters: [['supplier_id', 'eq', supplierId], ['status', 'eq', 'valid']] }),
    ]);
    return { sup, bills, pays };
  }, [supplierId]);

  const lines = useMemo(() => {
    const items: Row[] = [
      ...(data.data?.bills ?? []).map((b) => ({ id: b.id, date: b.bill_date, ref: `${b.bill_code} · ${b.invoice_no ?? ''}`, desc: b.description ?? '', debit: Number(b.total), credit: 0, status: b.display_status })),
      ...(data.data?.pays ?? []).map((p) => ({ id: p.id, date: p.date, ref: `${p.payment_code} · ${p.bill_code}`, desc: `${p.method}${p.reference ? ` · ${p.reference}` : ''}`, debit: 0, credit: Number(p.applied_amount), status: 'paid' })),
    ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || b.debit - a.debit);
    let bal = 0;
    return items.map((i): Row => { bal += i.debit - i.credit; return { ...i, balance: bal }; });
  }, [data.data]);

  const build = (xl: ExportLang) => {
    const xt = exportT(xl);
    return {
      fileName: `supplier-statement-${data.data?.sup?.name ?? ''}`, title: `${xt('bills.supplierStatement')} · ${data.data?.sup?.name ?? ''}`, lang: xl, currency,
      meta: [[xt('common.generatedOn'), new Date().toLocaleString('en-GB')], [xt('common.currency'), currency]] as [string, string][],
      columns: [
        { header: xt('common.date'), key: 'date', type: 'date' as const }, { header: xt('common.reference'), key: 'ref' },
        { header: xt('common.description'), key: 'desc' }, { header: xt('suppliers.totalBilled'), key: 'debit', type: 'money' as const },
        { header: xt('common.paid'), key: 'credit', type: 'money' as const }, { header: xt('common.balance'), key: 'balance', type: 'money' as const },
      ],
      rows: lines, totals: { debit: lines.reduce((s, l) => s + l.debit, 0), credit: lines.reduce((s, l) => s + l.credit, 0) },
    };
  };

  return (
    <Modal open onClose={onClose} size="xl" title={`${t('bills.supplierStatement')} · ${data.data?.sup?.name ?? ''}`}
      footer={<ExportMenu build={build} disabled={!lines.length} />}>
      {data.loading ? <Spinner /> : (
        <DataTable compact rows={lines} columns={[
          { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
          { key: 'ref', label: t('common.reference') },
          { key: 'desc', label: t('common.description') },
          { key: 'debit', label: t('suppliers.totalBilled'), align: 'end', render: (r) => (r.debit ? <Money value={r.debit} currency={currency} /> : '') },
          { key: 'credit', label: t('common.paid'), align: 'end', render: (r) => (r.credit ? <Money value={r.credit} currency={currency} /> : '') },
          { key: 'balance', label: t('common.balance'), align: 'end', render: (r) => <Money value={r.balance} currency={currency} /> },
          { key: 'status', label: '', render: (r) => <StatusBadge status={r.status} /> },
        ]} />
      )}
    </Modal>
  );
}
