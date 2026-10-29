import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Alert, Button, Field, Input, Select, StatusBadge, Money, Tabs, Textarea, KV } from '@/components/ui';
import { Modal, useConfirm } from '@/components/Modal';
import { FilePicker } from '@/components/FileUpload';
import { SlipButtons } from '@/components/SlipButtons';
import { PAY_METHODS } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchOne, rpc, errorText, type Row } from '@/lib/db';
import { uploadDocument } from '@/lib/storage';
import { dname, date as fmtDate, isoDate, uuid, money, round2 } from '@/lib/format';

export default function CrewPayments() {
  const { t, lang } = useI18n();
  const { currency, can } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'unpaid' | 'history'>('unpaid');
  const [paySlip, setPaySlip] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = params.get('slip');
    if (id) fetchOne('v_wage_slips', id).then((s) => { if (s) setPaySlip(s); }).catch(() => undefined);
  }, [params]);

  const unpaid: ResourceConfig = {
    table: 'wage_slips', view: 'v_wage_slips', title: 'crewPay.unpaidSlips', viewPerm: 'crew_payments.view', reloadKey: tick,
    baseFilters: [['status', 'eq', 'issued'], ['remaining', 'gt', 0]], defaultSort: { column: 'generated_at', ascending: true },
    searchColumns: ['slip_no', 'crew_name_en', 'crew_name_dv', 'crew_code', 'payroll_code'],
    filters: [{ name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' }],
    intro: <Alert tone="info">{t('crewPay.exampleNote')}</Alert>,
    columns: [
      { key: 'slip_no', label: t('slip.slipNo'), render: (r) => `${r.slip_no} v${r.version}` },
      { key: 'crew', label: t('common.crewMember'), render: (r) => <div>{dname(r.crew_name_en, r.crew_name_dv, lang)}<div className="text-xs text-slate-500">{r.crew_code} · {r.boat_name}</div></div> },
      { key: 'payroll_code', label: t('nav.payroll'), render: (r) => `${r.payroll_code}${r.trip_code ? ` · ${r.trip_code}` : ''}` },
      { key: 'net_payable', label: t('crewPay.netPayable'), align: 'end', render: (r) => <Money value={r.net_payable} currency={currency} /> },
      { key: 'amount_paid', label: t('crewPay.alreadyPaid'), align: 'end', render: (r) => <Money value={r.amount_paid} currency={currency} /> },
      { key: 'remaining', label: t('crewPay.remaining'), align: 'end', render: (r) => <Money value={r.remaining} currency={currency} className="font-semibold" /> },
      { key: 'payment_status', label: t('common.status'), render: (r) => <StatusBadge status={r.payment_status} /> },
      { key: '_a', label: '', render: (r) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <SlipButtons slips={[r]} fileName={`${r.slip_no}-v${r.version}`} />
          {can('crew_payments.manage') && <Button size="sm" variant="primary" icon="banknote" onClick={() => setPaySlip(r)}>{t('common.recordPayment')}</Button>}
        </div>) },
    ],
    exportColumns: (xt) => [
      { header: xt('slip.slipNo'), key: 'slip_no' }, { header: xt('crew.code'), key: 'crew_code' }, { header: xt('common.crewMember'), key: 'crew_name_en' },
      { header: xt('common.boat'), key: 'boat_name' }, { header: xt('nav.payroll'), key: 'payroll_code' },
      { header: xt('crewPay.netPayable'), key: 'net_payable', type: 'money' }, { header: xt('crewPay.alreadyPaid'), key: 'amount_paid', type: 'money' },
      { header: xt('crewPay.remaining'), key: 'remaining', type: 'money' },
    ],
    exportName: 'wage-liabilities',
  };

  const voidPayment = async (r: Row) => {
    const reason = await confirm({ title: `${t('common.void')} · ${r.payment_code}`, reason: true, tone: 'danger' });
    if (reason === null) return;
    try { await rpc('void_crew_payment', { p_payment: r.id, p_reason: reason }); toast.success(t('common.success')); setTick((x) => x + 1); }
    catch (e) { toast.error(errorText(e, t)); }
  };
  const approvePayment = async (r: Row) => {
    try { await rpc('approve_crew_payment', { p_payment: r.id }); setTick((x) => x + 1); } catch (e) { toast.error(errorText(e, t)); }
  };

  const history: ResourceConfig = {
    table: 'crew_payments', view: 'v_crew_payments', title: 'crewPay.history', viewPerm: 'crew_payments.view', reloadKey: tick,
    defaultSort: { column: 'date', ascending: false }, searchColumns: ['payment_code', 'crew_name_en', 'crew_name_dv', 'slip_no', 'reference', 'payroll_code'],
    filters: [{ name: 'boat_id', label: 'common.boat', type: 'ref', ref: 'boats' }, { name: 'date', label: 'common.date', type: 'daterange', column: 'date' }],
    columns: [
      { key: 'payment_code', label: t('common.code') },
      { key: 'date', label: t('common.date'), render: (r) => fmtDate(r.date, lang) },
      { key: 'crew', label: t('common.crewMember'), render: (r) => dname(r.crew_name_en, r.crew_name_dv, lang) },
      { key: 'slip_no', label: t('crewPay.slip') },
      { key: 'method', label: t('common.method'), render: (r) => t(`payMethods.${r.method}`) },
      { key: 'reference', label: t('common.reference'), hideSm: true },
      { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <Money value={r.amount} currency={currency} /> },
      { key: 'approved_by_name', label: t('common.approvedBy'), hideSm: true, render: (r) => r.approved_by_name ?? (r.status === 'valid' && can('crew_payments.approve') ? <Button size="sm" onClick={() => approvePayment(r)}>{t('common.approve')}</Button> : '—') },
      { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
      { key: '_v', label: '', render: (r) => (r.status === 'valid' && can('crew_payments.approve') ? <Button size="sm" variant="ghost" onClick={() => voidPayment(r)}>{t('common.void')}</Button> : null) },
    ],
    exportColumns: (xt) => [
      { header: xt('common.code'), key: 'payment_code' }, { header: xt('common.date'), key: 'date', type: 'date' },
      { header: xt('common.crewMember'), key: 'crew_name_en' }, { header: xt('common.nameDv'), key: 'crew_name_dv' }, { header: xt('common.boat'), key: 'boat_name' },
      { header: xt('nav.payroll'), key: 'payroll_code' }, { header: xt('crewPay.slip'), key: 'slip_no' }, { header: xt('common.method'), key: 'method' },
      { header: xt('common.reference'), key: 'reference' }, { header: xt('common.amount'), key: 'amount', type: 'money' },
      { header: xt('common.status'), key: 'status', value: (r) => xt(`status.${r.status}`) }, { header: xt('common.recordedBy'), key: 'recorded_by_name' },
    ],
    exportName: 'crew-payments',
  };

  return (
    <div>
      {dialog}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'unpaid', label: t('crewPay.unpaidSlips') }, { id: 'history', label: t('crewPay.history') }]} />
      {tab === 'unpaid' ? <ResourcePage config={unpaid} /> : <ResourcePage config={history} />}
      {paySlip && <CrewPaymentModal slip={paySlip} onClose={() => { setPaySlip(null); if (params.get('slip')) setParams({}); }} onDone={() => setTick((x) => x + 1)} />}
    </div>
  );
}

function CrewPaymentModal({ slip, onClose, onDone }: { slip: Row; onClose: () => void; onDone: () => void }) {
  const { t, lang } = useI18n();
  const { currency, company } = useAuth();
  const toast = useToast();
  const [requestId] = useState(uuid());
  const [v, setV] = useState<Row>({ date: isoDate(), amount: String(slip.remaining), method: 'cash', reference: '', notes: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const amount = Number(v.amount || 0);
  const after = round2(Number(slip.remaining) - amount);
  const valid = amount > 0 && after >= 0 && (v.method === 'cash' || v.reference.trim());
  const submit = async () => {
    setBusy(true);
    try {
      let docId: string | null = null;
      if (files[0] && company) docId = (await uploadDocument({ file: files[0], companyId: company.id, entityType: 'crew_payment', boatId: slip.boat_id, docKind: 'payment_receipt' })).id;
      const pid = await rpc<string>('record_crew_payment', { p_slip: slip.id, p_date: v.date, p_amount: amount, p_method: v.method,
        p_reference: v.reference || null, p_document: docId, p_request: requestId, p_notes: v.notes || null });
      if (docId) await supabase.from('documents').update({ entity_id: pid }).eq('id', docId);
      toast.success(t('common.success'));
      onDone(); onClose();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${t('crewPay.new')} · ${slip.slip_no}`}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={submit}>{t('common.save')}</Button></>}>
      <div className="space-y-4">
        <KV cols={3} items={[
          [t('common.crewMember'), dname(slip.crew_name_en, slip.crew_name_dv, lang)],
          [t('crewPay.netPayable'), <Money value={slip.net_payable} currency={currency} />],
          [t('crewPay.alreadyPaid'), <Money value={slip.amount_paid} currency={currency} />],
        ]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.date')} required><Input type="date" max={isoDate()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label={t('common.amount')} required error={after < 0 ? t('errors.overpayment') : null}>
            <Input type="number" step="0.01" min="0" max={slip.remaining} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
          </Field>
          <Field label={t('common.method')} required>
            <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{PAY_METHODS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</Select>
          </Field>
          <Field label={t('common.reference')} required={v.method !== 'cash'}><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        </div>
        <Alert tone={after < 0 ? 'error' : 'info'}>{t('crewPay.remaining')}: <b dir="ltr">{money(Math.max(after, 0), currency)}</b></Alert>
        <Field label={t('crewPay.receipt')}><FilePicker files={files} onChange={setFiles} multiple={false} compact /></Field>
        <Field label={t('common.notes')}><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
