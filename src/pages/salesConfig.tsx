import { useState } from 'react';
import type { ResourceConfig } from '@/components/ResourcePage';
import { PAY_METHODS, UNITS, type FieldDef } from '@/components/Form';
import { Button, Field, Input, Select, StatusBadge, Money, Alert } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useI18n, type Lang, type TFn } from '@/lib/i18n';
import { insertRow, updateRow, rpc, errorText, type Row } from '@/lib/db';
import { dname, date as fmtDate, isoDate, qty, uuid, money } from '@/lib/format';

export function catchFields(fixedTrip?: Row): FieldDef[] {
  return [
    { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true, readOnly: () => !!fixedTrip, default: fixedTrip?.boat_id },
    { name: 'trip_id', label: 'common.trip', type: 'ref', ref: 'trips', required: true, refParams: (v) => ({ boatId: v.boat_id }), readOnly: () => !!fixedTrip, default: fixedTrip?.id },
    { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
    { name: 'fish_type_id', label: 'sales.fishType', type: 'ref', ref: 'fishTypes', required: true, onSet: (_v, _vals, ref) => (ref ? { unit: ref.default_unit } : {}) },
    { name: 'quantity', label: 'sales.weight', type: 'number', required: true, min: 0.001 },
    { name: 'unit', label: 'common.unit', type: 'select', options: UNITS, required: true, default: 'kg' },
    { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
  ];
}

export function catchConfig(t: TFn, lang: Lang, fixedTrip?: Row): ResourceConfig {
  return {
    table: 'catch_records', view: 'v_catch', title: 'sales.catch', newLabel: 'sales.newCatch',
    viewPerm: 'sales.view', managePerm: 'sales.manage', embedded: !!fixedTrip,
    baseFilters: fixedTrip ? [['trip_id', 'eq', fixedTrip.id]] : [],
    defaultSort: { column: 'date', ascending: false },
    searchColumns: fixedTrip ? undefined : ['trip_code', 'fish_name_en', 'fish_name_dv', 'boat_name'],
    filters: fixedTrip ? [] : [{ name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' }, { name: 'date', label: 'common.date', type: 'daterange', column: 'date' }],
    columns: [
      { key: 'date', label: t('common.date'), sortable: true, render: (r) => fmtDate(r.date, lang) },
      ...(fixedTrip ? [] : [{ key: 'trip_code', label: t('common.trip') }, { key: 'boat_name', label: t('common.boat') }]),
      { key: 'fish', label: t('sales.fishType'), render: (r) => dname(r.fish_name_en, r.fish_name_dv, lang) },
      { key: 'quantity', label: t('common.quantity'), align: 'end', render: (r) => `${qty(r.quantity)} ${t(`units.${r.unit}`)}` },
      { key: 'notes', label: t('common.notes'), hideSm: true },
    ],
    fields: catchFields(fixedTrip),
    newDefaults: fixedTrip ? { boat_id: fixedTrip.boat_id, trip_id: fixedTrip.id } : undefined,
    canEdit: () => !fixedTrip || fixedTrip.status !== 'closed',
    exportColumns: (xt) => [
      { header: xt('common.date'), key: 'date', type: 'date' }, { header: xt('common.trip'), key: 'trip_code' }, { header: xt('common.boat'), key: 'boat_name' },
      { header: xt('sales.fishType'), key: 'fish_name_en' }, { header: xt('common.quantity'), key: 'quantity', type: 'qty' },
      { header: xt('common.unit'), key: 'unit' }, { header: xt('common.notes'), key: 'notes' },
    ],
    exportName: 'catch',
  };
}

export function saleFields(fixedTrip?: Row): FieldDef[] {
  return [
    { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats', required: true, readOnly: () => !!fixedTrip, default: fixedTrip?.boat_id },
    { name: 'trip_id', label: 'common.trip', type: 'ref', ref: 'trips', refParams: (v) => ({ boatId: v.boat_id }), readOnly: () => !!fixedTrip, default: fixedTrip?.id },
    { name: 'date', label: 'common.date', type: 'date', required: true, default: () => isoDate() },
    { name: 'customer_id', label: 'common.customer', type: 'ref', ref: 'customers' },
    { name: 'fish_type_id', label: 'sales.fishType', type: 'ref', ref: 'fishTypes', required: true, onSet: (_v, _vals, ref) => (ref ? { unit: ref.default_unit } : {}) },
    { name: 'quantity', label: 'sales.weight', type: 'number', required: true, min: 0.001 },
    { name: 'unit', label: 'common.unit', type: 'select', options: UNITS, required: true, default: 'kg' },
    { name: 'unit_price', label: 'common.unitPrice', type: 'money', required: true, min: 0 },
    { name: 'invoice_no', label: 'sales.invoiceNo', type: 'text' },
    { name: '_total', label: 'sales.totalValue', type: 'text', render: (v) => (
      <div className="rounded-lg bg-ocean-50 px-3 py-2 text-sm"><span className="text-slate-600">{'∑ '}</span>
        <b dir="ltr">{money(Number(v.quantity || 0) * Number(v.unit_price || 0))}</b></div>) },
    { name: '_received', label: 'sales.receivedNow', type: 'money', min: 0, showIf: (_v, isEdit) => !isEdit },
    { name: '_method', label: 'common.method', type: 'select', options: PAY_METHODS, default: 'cash', showIf: (v, isEdit) => !isEdit && Number(v._received) > 0 },
    { name: '_reference', label: 'common.reference', type: 'text', showIf: (v, isEdit) => !isEdit && Number(v._received) > 0 },
    { name: 'notes', label: 'common.notes', type: 'textarea', wide: true },
  ];
}

export function salesConfig(t: TFn, lang: Lang, currency: string, onReceive: (r: Row) => void, fixedTrip?: Row): ResourceConfig {
  return {
    table: 'fish_sales', view: 'v_fish_sales', title: 'sales.sales', newLabel: 'sales.newSale',
    viewPerm: 'sales.view', managePerm: 'sales.manage', embedded: !!fixedTrip,
    baseFilters: fixedTrip ? [['trip_id', 'eq', fixedTrip.id]] : [],
    defaultSort: { column: 'date', ascending: false },
    searchColumns: fixedTrip ? undefined : ['sale_code', 'trip_code', 'customer_name', 'invoice_no', 'fish_name_en'],
    filters: fixedTrip ? [] : [
      { name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' },
      { name: 'payment_status', label: 'ledger.paymentStatus', type: 'select', options: ['unpaid', 'partially_paid', 'paid'].map((s) => ({ value: s, label: `status.${s}` })) },
      { name: 'date', label: 'common.date', type: 'daterange', column: 'date' },
    ],
    columns: [
      { key: 'sale_code', label: t('common.code') },
      { key: 'date', label: t('common.date'), sortable: true, render: (r) => fmtDate(r.date, lang) },
      ...(fixedTrip ? [] : [{ key: 'boat_name', label: t('common.boat'), hideSm: true }]),
      { key: 'fish', label: t('sales.fishType'), render: (r) => `${dname(r.fish_name_en, r.fish_name_dv, lang)} · ${qty(r.quantity)} ${t(`units.${r.unit}`)}` },
      { key: 'customer_name', label: t('common.customer'), hideSm: true },
      { key: 'total', label: t('common.total'), align: 'end', render: (r) => <Money value={r.total} currency={currency} /> },
      { key: 'outstanding', label: t('common.outstanding'), align: 'end', render: (r) => <Money value={r.outstanding} currency={currency} /> },
      { key: 'payment_status', label: t('common.status'), render: (r) => (r.status === 'voided' ? <StatusBadge status="voided" /> : <StatusBadge status={r.payment_status} />) },
      { key: '_a', label: '', render: (r) => (r.status === 'recorded' && Number(r.outstanding) > 0
        ? <Button size="sm" onClick={(e) => { e.stopPropagation(); onReceive(r); }}>{t('sales.addReceipt')}</Button> : null) },
    ],
    fields: saleFields(fixedTrip),
    newDefaults: fixedTrip ? { boat_id: fixedTrip.boat_id, trip_id: fixedTrip.id } : undefined,
    canEdit: (r) => r.status === 'recorded',
    beforeSave: (v) => { const { _total, _received, _method, _reference, ...rest } = v; void _total; void _received; void _method; void _reference; return rest; },
    save: async (values, existing) => {
      return existing ? updateRow('fish_sales', existing.id, values) : insertRow('fish_sales', values);
    },
    afterSave: async (row, isNew, values) => {
      if (isNew && Number(values._received) > 0) {
        await rpc('record_customer_receipt', { p_sale: row.id, p_date: row.date, p_amount: Number(values._received),
          p_method: values._method || 'cash', p_reference: values._reference || null, p_request: uuid() });
      }
    },
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'sale_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('common.trip'), key: 'trip_code' }, { header: xt('common.boat'), key: 'boat_name' },
      { header: xt('sales.fishType'), key: 'fish_name_en' }, { header: xt('common.quantity'), key: 'quantity', type: 'qty' },
      { header: xt('common.unit'), key: 'unit' }, { header: xt('common.unitPrice'), key: 'unit_price', type: 'money' },
      { header: xt('common.total'), key: 'total', type: 'money' }, { header: xt('common.customer'), key: 'customer_name' },
      { header: xt('sales.received'), key: 'amount_received', type: 'money' }, { header: xt('common.outstanding'), key: 'outstanding', type: 'money' },
      { header: xt('ledger.paymentStatus'), key: 'payment_status', value: (r) => xt(`status.${r.payment_status}`) },
    ],
    exportName: 'fish-sales',
  };
}

/** Record cash received from a customer against a sale (separate from income recognition). */
export function ReceiptModal({ sale, onClose, onDone, currency }: { sale: Row | null; onClose: () => void; onDone: () => void; currency: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [v, setV] = useState<Row>({ date: isoDate(), amount: '', method: 'cash', reference: '' });
  const [req] = useState(uuid());
  const [busy, setBusy] = useState(false);
  if (!sale) return null;
  const submit = async () => {
    setBusy(true);
    try {
      await rpc('record_customer_receipt', { p_sale: sale.id, p_date: v.date, p_amount: Number(v.amount), p_method: v.method, p_reference: v.reference || null, p_request: req });
      toast.success(t('common.success'));
      onDone(); onClose();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${t('sales.addReceipt')} · ${sale.sale_code}`}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!(Number(v.amount) > 0)} onClick={submit}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        <Alert tone="info">{t('common.outstanding')}: <b dir="ltr">{money(sale.outstanding, currency)}</b></Alert>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.date')} required><Input type="date" value={v.date} max={isoDate()} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label={t('common.amount')} required><Input type="number" step="0.01" min="0" max={sale.outstanding} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label={t('common.method')}>
            <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{PAY_METHODS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</Select>
          </Field>
          <Field label={t('common.reference')} required={v.method !== 'cash'}><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}
