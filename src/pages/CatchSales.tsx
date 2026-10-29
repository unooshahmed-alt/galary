import { useState } from 'react';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Tabs, Alert } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import type { Row } from '@/lib/db';
import { catchConfig, salesConfig, ReceiptModal } from './salesConfig';
import { RECORD_STATUS } from '@/components/Form';

export default function CatchSales() {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const [tab, setTab] = useState<'sales' | 'catch' | 'receipts' | 'customers'>('sales');
  const [receive, setReceive] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);

  const receipts: ResourceConfig = {
    table: 'customer_receipts', view: 'v_customer_receipts', title: 'sales.receipts', viewPerm: 'sales.view',
    defaultSort: { column: 'date', ascending: false }, searchColumns: ['receipt_code', 'sale_code', 'customer_name', 'reference'],
    filters: [{ name: 'date', label: 'common.date', type: 'daterange', column: 'date' }], reloadKey: tick,
    columns: [
      { key: 'receipt_code', label: t('common.code') }, { key: 'date', label: t('common.date') },
      { key: 'sale_code', label: t('sales.sales') }, { key: 'customer_name', label: t('common.customer') },
      { key: 'method', label: t('common.method'), render: (r) => t(`payMethods.${r.method}`) }, { key: 'reference', label: t('common.reference') },
      { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <bdi dir="ltr">{currency} {Number(r.amount).toFixed(2)}</bdi> },
      { key: 'status', label: t('common.status'), render: (r) => t(`status.${r.status}`) },
    ],
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'receipt_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('sales.sales'), key: 'sale_code' }, { header: xt('common.customer'), key: 'customer_name' },
      { header: xt('common.method'), key: 'method' }, { header: xt('common.reference'), key: 'reference' },
      { header: xt('common.amount'), key: 'amount', type: 'money' },
    ],
  };

  const customers: ResourceConfig = {
    table: 'customers', view: 'v_customer_balances', title: 'sales.customers', newLabel: 'suppliers.newCustomer',
    viewPerm: 'sales.view', managePerm: 'sales.manage', invalidates: ['customers'], searchColumns: ['name', 'name_dv', 'phone'],
    defaultSort: { column: 'name', ascending: true },
    columns: [
      { key: 'name', label: t('common.name'), render: (r) => (lang === 'dv' ? r.name_dv || r.name : r.name) },
      { key: 'phone', label: t('common.phone') },
      { key: 'total_sales', label: t('suppliers.totalSales'), align: 'end', render: (r) => <bdi dir="ltr">{currency} {Number(r.total_sales).toFixed(2)}</bdi> },
      { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => <bdi dir="ltr">{currency} {Number(r.outstanding).toFixed(2)}</bdi> },
    ],
    fields: CUSTOMER_FIELDS,
  };

  return (
    <div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'sales', label: t('sales.sales') }, { id: 'catch', label: t('sales.catch') },
        { id: 'receipts', label: t('sales.receipts') }, { id: 'customers', label: t('sales.customers') },
      ]} />
      <div className="mb-4"><Alert tone="info">{t('sales.noDoubleCount')}</Alert></div>
      {tab === 'sales' && <ResourcePage config={{ ...salesConfig(t, lang, currency, setReceive), reloadKey: tick }} />}
      {tab === 'catch' && <ResourcePage config={catchConfig(t, lang)} />}
      {tab === 'receipts' && <ResourcePage config={receipts} />}
      {tab === 'customers' && <ResourcePage config={customers} />}
      <ReceiptModal sale={receive} currency={currency} onClose={() => setReceive(null)} onDone={() => setTick((x) => x + 1)} />
    </div>
  );
}

export const CUSTOMER_FIELDS: ResourceConfig['fields'] = [
  { name: 'name', label: 'common.name', type: 'text', required: true },
  { name: 'name_dv', label: 'common.nameDv', type: 'text', rtl: true },
  { name: 'contact_person', label: 'common.contactPerson', type: 'text' },
  { name: 'phone', label: 'common.phone', type: 'tel' },
  { name: 'email', label: 'common.email', type: 'email' },
  { name: 'tin', label: 'common.tin', type: 'text' },
  { name: 'address', label: 'common.address', type: 'text', wide: true },
  { name: 'status', label: 'common.status', type: 'select', options: RECORD_STATUS, default: 'active', required: true },
  { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
];
