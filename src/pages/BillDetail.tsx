import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchAll, fetchOne, insertRow, rpc, updateRow, deleteRow, useAsync, errorText, clean, type Row } from '@/lib/db';
import { money, date as fmtDate, dname, isoDate, uuid, round2 } from '@/lib/format';
import { uploadDocument, signedUrl } from '@/lib/storage';
import { runOcr, type OcrFields } from '@/lib/ocr';
import { Alert, Button, Card, Checkbox, Field, Input, KV, PageHeader, Select, Spinner, StatusBadge, Textarea, Money, Badge } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { DocumentList } from '@/components/DocumentList';
import { FilePicker } from '@/components/FileUpload';
import { Modal, useConfirm } from '@/components/Modal';
import { RefSelect, invalidateOptions } from '@/components/RefSelect';
import { ApprovalHistory } from '@/components/Workflow';
import { PAY_METHODS } from '@/components/Form';
import { useToast } from '@/components/Toast';

const EMPTY: Row = {
  supplier_id: null, invoice_no: '', bill_date: isoDate(), due_date: '', category_id: null, boat_id: null, trip_id: null,
  description: '', subtotal: '', tax_amount: '0', notes: '', ocr_data: null, ocr_confirmed: false,
};

export default function BillDetail() {
  const { id } = useParams();
  return id ? <BillView id={id} /> : <BillEditor />;
}

// ======================================================================= Editor (new / draft)
function BillEditor({ existing, onDone }: { existing?: Row; onDone?: () => void }) {
  const { t, lang } = useI18n();
  const { company, can, currency } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [v, setV] = useState<Row>(() => existing ? { ...EMPTY, ...existing, due_date: existing.due_date ?? '', subtotal: String(existing.subtotal), tax_amount: String(existing.tax_amount) }
    : { ...EMPTY, trip_id: params.get('trip'), boat_id: params.get('boat') });
  const [files, setFiles] = useState<File[]>([]);
  const [ocr, setOcr] = useState<{ running: boolean; progress: number; fields?: OcrFields; error?: string }>({ running: false, progress: 0 });
  const [dups, setDups] = useState<Row[]>([]);
  const [dupReason, setDupReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [newSupplier, setNewSupplier] = useState<Row | null>(null);
  const total = round2(Number(v.subtotal || 0) + Number(v.tax_amount || 0));
  const set = (p: Row) => setV((x) => ({ ...x, ...p }));
  const ocrEnabled = company?.settings?.ocr_enabled !== false;

  // Live duplicate detection
  useEffect(() => {
    if (!v.supplier_id || (!v.invoice_no && !total)) { setDups([]); return; }
    const h = setTimeout(async () => {
      try {
        const r = await rpc<Row[]>('find_bill_duplicates', { p_supplier: v.supplier_id, p_invoice: v.invoice_no || null, p_date: v.bill_date, p_total: total, p_exclude: existing?.id ?? null });
        setDups(r ?? []);
      } catch { setDups([]); }
    }, 400);
    return () => clearTimeout(h);
  }, [v.supplier_id, v.invoice_no, v.bill_date, total, existing?.id]);

  const doOcr = async () => {
    const img = files.find((f) => f.type.startsWith('image/'));
    if (!img) { setOcr({ running: false, progress: 0, error: 'OCR works on photos and scanned images (JPG, PNG, WEBP).' }); return; }
    setOcr({ running: true, progress: 0 });
    try {
      const r = await runOcr(img, (p) => setOcr((o) => ({ ...o, progress: p })));
      setOcr({ running: false, progress: 1, fields: r.fields });
      set({ ocr_data: { ...r.fields, raw: r.text.slice(0, 4000) }, ocr_confirmed: false });
    } catch (e) { setOcr({ running: false, progress: 0, error: (e as Error).message }); }
  };
  const applyOcr = (f: keyof OcrFields) => {
    const val = ocr.fields?.[f];
    if (val === undefined) return;
    if (f === 'invoiceNo') set({ invoice_no: val });
    if (f === 'billDate') set({ bill_date: val });
    if (f === 'dueDate') set({ due_date: val });
    if (f === 'subtotal') set({ subtotal: String(val) });
    if (f === 'tax') set({ tax_amount: String(val) });
  };

  const check = () => {
    const e: Record<string, string> = {};
    if (!v.supplier_id) e.supplier_id = t('errors.required');
    if (!v.invoice_no?.trim()) e.invoice_no = t('errors.required');
    if (!v.bill_date) e.bill_date = t('errors.required');
    if (!v.category_id) e.category_id = t('errors.required');
    if (!(Number(v.subtotal) >= 0) || v.subtotal === '') e.subtotal = t('errors.required');
    if (v.due_date && v.due_date < v.bill_date) e.due_date = '≥ ' + t('bills.billDate');
    if (total <= 0) e.subtotal = t('common.invalid');
    setErrs(e);
    return !Object.keys(e).length;
  };

  const save = async (submit: boolean) => {
    if (!check()) return;
    if (submit && dups.length && !dupReason.trim()) { toast.error(t('errors.duplicateBill')); return; }
    if (submit && v.ocr_data && !v.ocr_confirmed) { toast.error(t('bills.ocrNotTrusted')); return; }
    if (submit && !existing && !files.length && company?.settings?.bill_document_required !== false) { toast.error(`${t('bills.original')}: ${t('errors.required')}`); return; }
    setBusy(true);
    try {
      const payload = clean({
        supplier_id: v.supplier_id, invoice_no: v.invoice_no.trim(), bill_date: v.bill_date, due_date: v.due_date,
        category_id: v.category_id, boat_id: v.boat_id, trip_id: v.trip_id, description: v.description,
        subtotal: Number(v.subtotal), tax_amount: Number(v.tax_amount || 0), notes: v.notes,
        ocr_data: v.ocr_data, ocr_confirmed: !!v.ocr_confirmed,
      });
      const bill = existing ? await updateRow('bills', existing.id, payload) : await insertRow('bills', payload);
      for (const f of files) {
        await uploadDocument({ file: f, companyId: company!.id, entityType: 'bill', entityId: bill.id, boatId: bill.boat_id, docKind: 'bill',
          maxMb: Number(company?.settings?.max_upload_mb ?? 10) });
      }
      let submitted = true;
      if (submit) {
        // The draft is already saved; if submission is refused the person continues on the bill page.
        try { await rpc('submit_bill', { p_bill: bill.id, p_duplicate_reason: dupReason.trim() || null }); }
        catch (e) { submitted = false; toast.error(errorText(e, t)); }
      }
      if (submitted) toast.success(t('common.success'));
      if (onDone) onDone(); else nav(`/bills/${bill.id}`, { replace: true });
    } catch (e) {
      const m = (e as Error).message;
      toast.error(m === 'invalidFile' || m === 'fileTooLarge' ? t(`errors.${m}`) : errorText(e, t));
    } finally { setBusy(false); }
  };

  const addSupplier = async () => {
    try {
      const s = await insertRow('suppliers', clean({ name: newSupplier!.name, phone: newSupplier!.phone }));
      invalidateOptions('suppliers');
      set({ supplier_id: s.id });
      setNewSupplier(null);
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const ocrRow = (label: string, f: keyof OcrFields) => ocr.fields?.[f] !== undefined && (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-slate-600">{label}: <b dir="ltr">{String(ocr.fields[f])}</b></span>
      {f !== 'supplier' && <Button size="sm" onClick={() => applyOcr(f)}>{t('bills.ocrUse')}</Button>}
    </div>
  );

  return (
    <div>
      {!existing && <PageHeader back={() => nav('/bills')} title={t('bills.new')} subtitle={t('bills.notPaidOnUpload')} />}
      <div className="grid gap-5 lg:grid-cols-5">
        {!existing && (
          <Card className="lg:col-span-2" title={t('bills.upload')}>
            <FilePicker files={files} onChange={setFiles} />
            {ocrEnabled && files.some((f) => f.type.startsWith('image/')) && (
              <div className="mt-4 space-y-2">
                <Button icon="eye" loading={ocr.running} onClick={doOcr}>{ocr.running ? `${t('bills.ocrRunning')} ${Math.round(ocr.progress * 100)}%` : t('bills.ocr')}</Button>
                {ocr.error && <Alert tone="warn">{ocr.error}</Alert>}
                {ocr.fields && (
                  <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-medium text-amber-900">{t('bills.ocrResult')}</div>
                    {ocrRow(t('common.supplier'), 'supplier')}{ocrRow(t('bills.invoiceNo'), 'invoiceNo')}
                    {ocrRow(t('bills.billDate'), 'billDate')}{ocrRow(t('bills.dueDate'), 'dueDate')}
                    {ocrRow(t('common.subtotal'), 'subtotal')}{ocrRow(t('bills.tax'), 'tax')}{ocrRow(t('common.total'), 'total')}
                  </div>
                )}
              </div>
            )}
          </Card>
        )}
        <Card className={existing ? 'lg:col-span-5' : 'lg:col-span-3'} title={t('common.details')}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('common.supplier')} required error={errs.supplier_id}>
              <div className="flex gap-2">
                <RefSelect kind="suppliers" value={v.supplier_id} onChange={(x) => set({ supplier_id: x })} />
                {(can('suppliers.manage') || can('bills.manage')) && <Button icon="plus" onClick={() => setNewSupplier({ name: '', phone: '' })} aria-label={t('suppliers.new')} />}
              </div>
            </Field>
            <Field label={t('bills.invoiceNo')} required error={errs.invoice_no}><Input value={v.invoice_no} onChange={(e) => set({ invoice_no: e.target.value })} /></Field>
            <Field label={t('bills.billDate')} required error={errs.bill_date}><Input type="date" value={v.bill_date} onChange={(e) => set({ bill_date: e.target.value })} /></Field>
            <Field label={t('bills.dueDate')} error={errs.due_date}><Input type="date" value={v.due_date} min={v.bill_date} onChange={(e) => set({ due_date: e.target.value })} /></Field>
            <Field label={t('common.category')} required error={errs.category_id}><RefSelect kind="expenseCategories" value={v.category_id} onChange={(x) => set({ category_id: x })} /></Field>
            <Field label={t('common.boat')}><RefSelect kind="boats" value={v.boat_id} onChange={(x) => set({ boat_id: x, trip_id: null })} /></Field>
            <Field label={t('common.trip')}><RefSelect kind="trips" value={v.trip_id} params={{ boatId: v.boat_id }} disabled={!v.boat_id} onChange={(x) => set({ trip_id: x })} /></Field>
            <Field label={t('common.subtotal')} required error={errs.subtotal}><Input type="number" step="0.01" min="0" value={v.subtotal} onChange={(e) => set({ subtotal: e.target.value })} /></Field>
            <Field label={t('bills.tax')}><Input type="number" step="0.01" min="0" value={v.tax_amount} onChange={(e) => set({ tax_amount: e.target.value })} /></Field>
            <Field label={t('bills.totalBill')}><div className="rounded-lg bg-ocean-50 px-3 py-2 text-sm font-semibold" dir="ltr">{money(total, currency)}</div></Field>
            <Field label={t('common.description')} className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label={t('common.notes')} className="sm:col-span-2"><Textarea rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
          </div>

          {dups.length > 0 && (
            <div className="mt-4 space-y-2">
              <Alert tone="warn" title={t('bills.duplicateWarning')}>
                {t('bills.duplicateText')}
                <ul className="mt-1 list-disc ps-5">
                  {dups.map((d) => <li key={d.id}><a className="underline" href={`/bills/${d.id}`} target="_blank" rel="noreferrer">{d.bill_code}</a> · {d.invoice_no} · {fmtDate(d.bill_date, lang)} · <span dir="ltr">{money(d.total, currency)}</span> · {t(`status.${d.status}`)}</li>)}
                </ul>
              </Alert>
              {can('duplicates.override') ? (
                <Field label={t('bills.duplicateReason')}><Textarea value={dupReason} onChange={(e) => setDupReason(e.target.value)} /></Field>
              ) : <div className="text-xs text-slate-600">{t('errors.permission')}</div>}
            </div>
          )}

          {v.ocr_data && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Checkbox label={t('bills.ocrConfirm')} hint={t('bills.ocrNotTrusted')} checked={!!v.ocr_confirmed} onChange={(c) => set({ ocr_confirmed: c })} />
            </div>
          )}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {onDone && <Button onClick={onDone}>{t('common.cancel')}</Button>}
            <Button loading={busy} onClick={() => save(false)}>{t('common.save')} ({t('status.draft')})</Button>
            <Button variant="primary" loading={busy} onClick={() => save(true)}>{t('common.submitForApproval')}</Button>
          </div>
        </Card>
      </div>

      <Modal open={!!newSupplier} onClose={() => setNewSupplier(null)} title={t('suppliers.new')} size="sm"
        footer={<><Button onClick={() => setNewSupplier(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!newSupplier?.name?.trim()} onClick={addSupplier}>{t('common.save')}</Button></>}>
        {newSupplier && <div className="space-y-3">
          <Field label={t('common.name')} required><Input value={newSupplier.name} onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })} /></Field>
          <Field label={t('common.phone')}><Input type="tel" dir="ltr" value={newSupplier.phone} onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}

// ======================================================================= Detail view
function BillView({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can, currency, company } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);
  const bill = useAsync(() => fetchOne('v_bills', id), [id, tick]);
  const raw = useAsync(() => fetchOne('bills', id), [id, tick]);
  const payments = useAsync(() => fetchAll('v_bill_payments', { filters: [['bill_id', 'eq', id]], sort: { column: 'date', ascending: true } }), [id, tick]);
  const reload = () => setTick((x) => x + 1);
  const m = (v: unknown) => money(v, currency);

  if (bill.loading && !bill.data) return <Spinner />;
  const b = bill.data;
  if (!b) return <Alert tone="warn">{t('errors.notFound')}</Alert>;

  const act = async (fn: string, opts: { reason?: boolean | 'optional'; title: string; tone?: 'primary' | 'danger' | 'success'; message?: string; arg?: string }) => {
    let duplicateReason: string | null = null;
    const r = await confirm({ title: opts.title, reason: opts.reason, tone: opts.tone, message: opts.message });
    if (r === null) return;
    try {
      if (fn === 'submit_bill') {
        try { await rpc('submit_bill', { p_bill: id, p_duplicate_reason: null }); }
        catch (e) {
          if (!/possible_duplicate/.test((e as Error).message)) throw e;
          duplicateReason = await confirm({ title: t('bills.duplicateWarning'), message: t('bills.duplicateText'), reason: true, reasonLabel: t('bills.duplicateReason') });
          if (duplicateReason === null) return;
          await rpc('submit_bill', { p_bill: id, p_duplicate_reason: duplicateReason });
        }
      } else {
        await rpc(fn, { p_bill: id, [opts.arg ?? 'p_comment']: r || null });
      }
      toast.success(t('common.success'));
      reload();
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const discard = async () => {
    const r = await confirm({ title: t('bills.discardDraft'), tone: 'danger' });
    if (r === null) return;
    try { await deleteRow('bills', { id }); nav('/bills'); } catch (e) { toast.error(errorText(e, t)); }
  };

  const voidPayment = async (p: Row) => {
    const r = await confirm({ title: `${t('bills.voidPayment')} · ${p.payment_code}`, reason: true, tone: 'danger' });
    if (r === null) return;
    try { await rpc('void_bill_payment', { p_payment: p.id, p_reason: r }); toast.success(t('common.success')); reload(); }
    catch (e) { toast.error(errorText(e, t)); }
  };

  const s = b.status as string;
  return (
    <div>
      {dialog}
      <PageHeader back={() => nav('/bills')} title={`${b.bill_code} · ${dname(b.supplier_name, b.supplier_name_dv, lang)}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{t('bills.invoiceNo')}: {b.invoice_no} <StatusBadge status={b.display_status} />
          {b.duplicate_override_reason && <Badge tone="amber">{t('bills.duplicateOverride')}</Badge>}</span>}
        actions={<>
          {s === 'draft' && can('bills.manage') && <Button icon="edit" onClick={() => setEditing(true)}>{t('common.edit')}</Button>}
          {s === 'draft' && can('bills.manage') && <Button variant="primary" onClick={() => act('submit_bill', { title: t('common.submitForApproval') })}>{t('common.submitForApproval')}</Button>}
          {s === 'draft' && !b.submitted_at && can('bills.manage') && <Button variant="ghost" icon="trash" onClick={discard}>{t('bills.discardDraft')}</Button>}
          {s === 'pending_approval' && can('bills.approve') && <>
            <Button variant="success" icon="check" onClick={() => act('approve_bill', { title: t('common.approve'), reason: 'optional', tone: 'success' })}>{t('common.approve')}</Button>
            <Button onClick={() => act('return_bill', { title: t('common.returnForCorrection'), reason: true })}>{t('common.returnForCorrection')}</Button>
            <Button variant="danger" onClick={() => act('reject_bill', { title: t('common.reject'), reason: true, tone: 'danger', arg: 'p_reason' })}>{t('common.reject')}</Button>
          </>}
          {['approved', 'partially_paid'].includes(s) && can('bills.pay') && <Button variant="primary" icon="banknote" onClick={() => setPaying(true)}>{t('bills.addPayment')}</Button>}
          {!['voided', 'rejected'].includes(s) && s !== 'draft' && can('bills.approve') && <Button variant="ghost" onClick={() => act('void_bill', { title: t('common.void'), reason: true, tone: 'danger', arg: 'p_reason' })}>{t('common.void')}</Button>}
          {can('suppliers.view') && <Button variant="ghost" icon="truck" onClick={() => nav(`/suppliers?statement=${b.supplier_id}`)}>{t('bills.supplierStatement')}</Button>}
        </>} />

      {b.return_comment && s === 'draft' && <div className="mb-4"><Alert tone="warn" title={t('bills.returned')}>{b.return_comment}</Alert></div>}
      {b.rejection_reason && <div className="mb-4"><Alert tone="error" title={t('bills.rejected')}>{b.rejection_reason}</Alert></div>}
      {b.void_reason && <div className="mb-4"><Alert tone="error" title={t('bills.voided')}>{b.void_reason}</Alert></div>}
      {b.duplicate_override_reason && <div className="mb-4"><Alert tone="warn" title={t('bills.duplicateOverride')}>{b.duplicate_override_reason}</Alert></div>}

      {editing && raw.data ? <div className="mb-5"><BillEditor existing={raw.data} onDone={() => { setEditing(false); reload(); }} /></div> : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" title={t('common.details')}>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{t('bills.totalBill')}</div><div className="font-semibold"><Money value={b.total} currency={currency} /></div></div>
              <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs text-slate-500">{t('bills.amountPaid')}</div><div className="font-semibold"><Money value={b.amount_paid} currency={currency} /></div></div>
              <div className="rounded-lg bg-amber-50 p-3"><div className="text-xs text-slate-500">{t('bills.outstanding')}</div><div className="font-semibold"><Money value={b.outstanding} currency={currency} /></div></div>
            </div>
            <KV items={[
              [t('common.supplier'), <>{dname(b.supplier_name, b.supplier_name_dv, lang)}<div className="text-xs text-slate-500" dir="ltr">{[b.supplier_phone, b.supplier_email].filter(Boolean).join(' · ')}</div></>],
              [t('bills.invoiceNo'), b.invoice_no], [t('bills.billDate'), fmtDate(b.bill_date, lang)],
              [t('bills.dueDate'), <>{fmtDate(b.due_date, lang)}{Number(b.days_overdue) > 0 && <span className="ms-2 text-coral-600">({b.days_overdue} {t('common.days')})</span>}</>],
              [t('common.category'), dname(b.category_name_en, b.category_name_dv, lang)],
              [t('common.boat'), b.boat_name], [t('common.trip'), b.trip_code ? <a className="text-ocean-700 underline" href={`/trips/${b.trip_id}`}>{b.trip_code}</a> : '—'],
              [t('common.subtotal'), m(b.subtotal)], [t('bills.tax'), m(b.tax_amount)],
              [t('common.description'), b.description], [t('common.notes'), b.notes],
              [t('bills.enteredBy'), b.entered_by_name], [t('common.approvedBy'), b.approved_by_name ? `${b.approved_by_name} · ${fmtDate(b.approved_at, lang)}` : '—'],
              [t('bills.expenseLink'), b.expense_transaction_id ? <a className="text-ocean-700 underline" href="/expenses">{t('status.approved')}</a> : '—'],
              ...(raw.data?.ocr_data ? [[t('bills.ocr'), raw.data.ocr_confirmed ? `✓ ${t('bills.ocrConfirm')}` : t('bills.ocrNotTrusted')] as [string, string]] : []),
            ]} />
          </Card>
          <Card title={t('bills.workflow')}><ApprovalHistory entityType="bill" entityId={id} reloadKey={tick} /></Card>
          <Card className="lg:col-span-3" title={t('bills.original')}>
            <DocumentList entityType="bill" entityId={id} boatId={b.boat_id} docKind="bill" canUpload={!['voided'].includes(s)} onChange={reload} />
          </Card>
        </div>
      )}

      <Card className="mt-5" padded={false} title={t('bills.payments')}>
        <DataTable rows={payments.data ?? []} loading={payments.loading} empty={<div className="p-4 text-sm text-slate-500">{t('bills.notPaidOnUpload')}</div>} columns={[
          { key: 'payment_code', label: t('common.code') },
          { key: 'date', label: t('bills.paymentDate'), render: (r) => fmtDate(r.date, lang) },
          { key: 'method', label: t('common.method'), render: (r) => t(`payMethods.${r.method}`) },
          { key: 'reference', label: t('common.reference') },
          { key: 'amount', label: t('common.amount'), align: 'end', render: (r) => <><Money value={r.amount} currency={currency} />{Number(r.overpaid_amount) > 0 && <div className="text-xs text-amber-700">{t('bills.overpayment')}: {m(r.overpaid_amount)}</div>}</> },
          { key: 'receipt', label: t('crewPay.receipt'), render: (r) => (r.receipt_path ? <Button size="sm" variant="ghost" icon="eye" onClick={async () => window.open(await signedUrl(r.receipt_path), '_blank', 'noopener')} /> : <span className="text-xs text-amber-600">—</span>) },
          { key: 'recorded_by_name', label: t('common.recordedBy'), hideSm: true },
          { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
          { key: '_v', label: '', render: (r) => (r.status === 'valid' && can('bills.approve') ? <Button size="sm" variant="ghost" onClick={() => voidPayment(r)}>{t('common.void')}</Button> : r.void_reason ? <span className="text-xs text-slate-500">{r.void_reason}</span> : null) },
        ]} />
      </Card>

      {paying && <PaymentModal bill={b} companyId={company!.id} onClose={() => setPaying(false)} onDone={reload} />}
    </div>
  );
}

function PaymentModal({ bill, companyId, onClose, onDone }: { bill: Row; companyId: string; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { can, currency } = useAuth();
  const toast = useToast();
  const [requestId] = useState(uuid());
  const [v, setV] = useState<Row>({ date: isoDate(), amount: String(bill.outstanding), method: 'bank_transfer', reference: '', notes: '', over: '' });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const amount = Number(v.amount || 0);
  const isOver = amount > Number(bill.outstanding) + 0.0001;
  const valid = amount > 0 && (v.method === 'cash' || v.reference.trim()) && (!isOver || (v.over.trim() && can('overpayment.approve')));
  const remaining = useMemo(() => Math.max(0, round2(Number(bill.outstanding) - amount)), [bill.outstanding, amount]);

  const submit = async () => {
    setBusy(true);
    try {
      let docId: string | null = null;
      if (files[0]) {
        const d = await uploadDocument({ file: files[0], companyId, entityType: 'bill_payment', entityId: null, boatId: bill.boat_id, docKind: 'payment_receipt' });
        docId = d.id;
      }
      const pid = await rpc<string>('record_bill_payment', {
        p_bill: bill.id, p_date: v.date, p_amount: amount, p_method: v.method, p_reference: v.reference || null,
        p_receipt_document: docId, p_request: requestId, p_overpayment_reason: isOver ? v.over : null, p_notes: v.notes || null,
      });
      if (docId) await supabase.from('documents').update({ entity_id: pid }).eq('id', docId);
      toast.success(t('common.success'));
      onDone(); onClose();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`${t('bills.addPayment')} · ${bill.bill_code}`}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={submit}>{t('common.save')}</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-50 p-2.5">{t('bills.outstanding')}<div className="font-semibold"><Money value={bill.outstanding} currency={currency} /></div></div>
          <div className="rounded-lg bg-slate-50 p-2.5">{t('common.remaining')}<div className="font-semibold"><Money value={remaining} currency={currency} /></div></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('bills.paymentDate')} required><Input type="date" max={isoDate()} value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label={t('common.amount')} required><Input type="number" step="0.01" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label={t('common.method')} required>
            <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{PAY_METHODS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</Select>
          </Field>
          <Field label={t('common.reference')} required={v.method !== 'cash'}><Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} /></Field>
        </div>
        {isOver && (
          <div className="space-y-2">
            <Alert tone="warn" title={t('bills.overpayment')}>{t('bills.overpaymentText')}</Alert>
            {can('overpayment.approve') ? <Field label={t('common.reason')} required><Textarea value={v.over} onChange={(e) => setV({ ...v, over: e.target.value })} /></Field>
              : <Alert tone="error">{t('errors.permission')}</Alert>}
          </div>
        )}
        <Field label={t('crewPay.receipt')}><FilePicker files={files} onChange={setFiles} multiple={false} compact /></Field>
        <Field label={t('common.notes')}><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
