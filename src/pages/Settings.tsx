import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { fetchAll, insertRow, updateRow, useAsync, errorText, unwrap, type Row } from '@/lib/db';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { UNITS } from '@/components/Form';
import { invalidateOptions } from '@/components/RefSelect';
import { useToast } from '@/components/Toast';
import { dname } from '@/lib/format';

type Tab = 'profile' | 'company' | 'workflow' | 'categories' | 'fish' | 'notifications' | 'system';

export default function Settings() {
  const { t } = useI18n();
  const { can } = useAuth();
  const admin = can('settings.manage');
  const [tab, setTab] = useState<Tab>('profile');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'profile', label: t('settings.myProfile') },
    ...(admin ? [
      { id: 'company' as Tab, label: t('settings.company') }, { id: 'workflow' as Tab, label: t('settings.workflow') },
      { id: 'categories' as Tab, label: t('settings.categories') }, { id: 'fish' as Tab, label: t('settings.fishTypes') },
      { id: 'notifications' as Tab, label: t('settings.notifications') }, { id: 'system' as Tab, label: t('settings.system') },
    ] : []),
  ];
  return (
    <div>
      <PageHeader title={t('settings.title')} />
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'profile' && <MyProfile />}
      {tab === 'company' && <CompanySettings />}
      {tab === 'workflow' && <WorkflowSettings />}
      {tab === 'categories' && <Categories />}
      {tab === 'fish' && <FishTypes />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'system' && <System />}
    </div>
  );
}

function MyProfile() {
  const { t, lang } = useI18n();
  const { profile, refresh, setLanguage } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Row>({ full_name: profile?.full_name ?? '', full_name_dv: profile?.full_name_dv ?? '', phone: profile?.phone ?? '' });
  const save = async () => {
    try { await updateRow('profiles', profile!.id, v); await refresh(); toast.success(t('common.success')); } catch (e) { toast.error(errorText(e, t)); }
  };
  return (
    <Card>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label={t('users.fullName')}><Input value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} /></Field>
        <Field label={t('common.nameDv')}><Input dir="rtl" className="font-thaana" value={v.full_name_dv} onChange={(e) => setV({ ...v, full_name_dv: e.target.value })} /></Field>
        <Field label={t('common.phone')}><Input type="tel" dir="ltr" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label={t('settings.preferredLanguage')}>
          <Select value={lang} onChange={(e) => void setLanguage(e.target.value as 'en' | 'dv')}><option value="en">English</option><option value="dv">ދިވެހި</option></Select>
        </Field>
        <Field label={t('common.email')}><Input value={profile?.email ?? ''} disabled dir="ltr" /></Field>
        <Field label={t('common.role')}><Input value={t(`roles.${profile?.role}`)} disabled /></Field>
      </div>
      <div className="mt-4"><Button variant="primary" onClick={save}>{t('common.save')}</Button></div>
    </Card>
  );
}

function CompanySettings() {
  const { t } = useI18n();
  const { company, refresh } = useAuth();
  const toast = useToast();
  const [v, setV] = useState<Row>({});
  useEffect(() => { if (company) setV({ name: company.name, name_dv: company.name_dv ?? '', address: company.address ?? '', phone: company.phone ?? '', email: company.email ?? '', tin: company.tin ?? '', default_language: company.default_language, currency: company.currency }); }, [company]);
  const save = async () => {
    try {
      if (!/^[A-Z]{3}$/.test(v.currency)) throw new Error(`${t('settings.currency')}: ISO code, e.g. MVR`);
      await updateRow('companies', company!.id, { ...v, name_dv: v.name_dv || null, address: v.address || null, phone: v.phone || null, email: v.email || null, tin: v.tin || null });
      await refresh(); toast.success(t('common.success'));
    } catch (e) { toast.error(errorText(e, t)); }
  };
  return (
    <Card>
      <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Field label={t('settings.companyName')} required><Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label={t('settings.companyNameDv')}><Input dir="rtl" className="font-thaana" value={v.name_dv ?? ''} onChange={(e) => setV({ ...v, name_dv: e.target.value })} /></Field>
        <Field label={t('common.address')}><Input value={v.address ?? ''} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label={t('common.phone')}><Input dir="ltr" value={v.phone ?? ''} onChange={(e) => setV({ ...v, phone: e.target.value })} /></Field>
        <Field label={t('common.email')}><Input dir="ltr" value={v.email ?? ''} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label={t('common.tin')}><Input value={v.tin ?? ''} onChange={(e) => setV({ ...v, tin: e.target.value })} /></Field>
        <Field label={t('settings.defaultLanguage')}>
          <Select value={v.default_language ?? 'en'} onChange={(e) => setV({ ...v, default_language: e.target.value })}><option value="en">English</option><option value="dv">ދިވެހި</option></Select>
        </Field>
        <Field label={t('settings.currency')} hint="MVR">
          <Input value={v.currency ?? 'MVR'} maxLength={3} dir="ltr" onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <div className="mt-4"><Button variant="primary" onClick={save}>{t('common.save')}</Button></div>
    </Card>
  );
}

function WorkflowSettings() {
  const { t } = useI18n();
  const { company, refresh } = useAuth();
  const toast = useToast();
  const [s, setS] = useState<Row>(company?.settings ?? {});
  const flag = (k: string, label: string, def = true) => <Checkbox label={t(label)} checked={s[k] ?? def} onChange={(c) => setS({ ...s, [k]: c })} />;
  const save = async () => {
    try { await updateRow('companies', company!.id, { settings: s }); await refresh(); toast.success(t('common.success')); } catch (e) { toast.error(errorText(e, t)); }
  };
  return (
    <Card>
      <div className="max-w-xl space-y-3">
        {flag('bill_approval_required', 'settings.billApproval')}
        {flag('bill_document_required', 'settings.billDocRequired')}
        {flag('payroll_approval_required', 'settings.payrollApproval')}
        {flag('trip_close_requires_sales', 'settings.tripSales')}
        {flag('ocr_enabled', 'settings.ocr')}
        {flag('stock_tracking', 'settings.stockTracking', false)}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('settings.dueSoonDays')}><Input type="number" min={1} value={s.bill_due_soon_days ?? 7} onChange={(e) => setS({ ...s, bill_due_soon_days: Number(e.target.value) })} /></Field>
          <Field label={t('settings.maxUpload')} hint="≤ 20"><Input type="number" min={1} max={20} value={s.max_upload_mb ?? 10} onChange={(e) => setS({ ...s, max_upload_mb: Math.min(20, Number(e.target.value)) })} /></Field>
        </div>
      </div>
      <div className="mt-4"><Button variant="primary" onClick={save}>{t('common.save')}</Button></div>
    </Card>
  );
}

function Categories() {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<Row | null>(null);
  const cats = useAsync(() => fetchAll('categories', { sort: { column: 'sort_order', ascending: true } }), [tick]);
  const save = async () => {
    try {
      const v = { name_en: edit!.name_en, name_dv: edit!.name_dv || null, active: edit!.active, sort_order: Number(edit!.sort_order || 100) };
      if (edit!.id) await updateRow('categories', edit!.id, v);
      else await insertRow('categories', { ...v, kind: edit!.kind, code: (edit!.code || edit!.name_en).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) });
      invalidateOptions('expenseCategories'); invalidateOptions('incomeCategories');
      setEdit(null); setTick((x) => x + 1);
    } catch (e) { toast.error(errorText(e, t)); }
  };
  const table = (kind: 'income' | 'expense') => (
    <Card padded={false} title={t(kind === 'income' ? 'settings.incomeCategories' : 'settings.expenseCategories')}
      actions={<Button size="sm" icon="plus" onClick={() => setEdit({ kind, name_en: '', name_dv: '', code: '', active: true, sort_order: 200 })}>{t('settings.addCategory')}</Button>}>
      <DataTable rows={(cats.data ?? []).filter((c) => c.kind === kind)} onRowClick={(r) => !r.is_system && setEdit({ ...r })} columns={[
        { key: 'name', label: t('common.name'), render: (r) => <>{dname(r.name_en, r.name_dv, lang)} {r.is_system && <Badge>{t('settings.system')}</Badge>}</> },
        { key: 'code', label: t('common.code'), render: (r) => <code className="text-xs">{r.code}</code> },
        { key: 'active', label: t('common.status'), render: (r) => (r.active ? t('common.active') : t('common.inactive')) },
      ]} />
    </Card>
  );
  if (cats.loading) return <Spinner />;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {table('expense')}{table('income')}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('common.category')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!edit?.name_en?.trim()} onClick={save}>{t('common.save')}</Button></>}>
        {edit && <div className="space-y-3">
          <Field label={t('common.nameEn')} required><Input value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
          <Field label={t('common.nameDv')}><Input dir="rtl" className="font-thaana" value={edit.name_dv ?? ''} onChange={(e) => setEdit({ ...edit, name_dv: e.target.value })} /></Field>
          <Checkbox label={t('common.active')} checked={!!edit.active} onChange={(c) => setEdit({ ...edit, active: c })} />
        </div>}
      </Modal>
    </div>
  );
}

function FishTypes() {
  const { t } = useI18n();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<Row | null>(null);
  const list = useAsync(() => fetchAll('fish_types', { sort: { column: 'name_en', ascending: true } }), [tick]);
  const save = async () => {
    try {
      const v = { name_en: edit!.name_en, name_dv: edit!.name_dv || null, default_unit: edit!.default_unit, active: edit!.active };
      if (edit!.id) await updateRow('fish_types', edit!.id, v); else await insertRow('fish_types', v);
      invalidateOptions('fishTypes'); setEdit(null); setTick((x) => x + 1);
    } catch (e) { toast.error(errorText(e, t)); }
  };
  return (
    <Card padded={false} title={t('settings.fishTypes')} actions={<Button size="sm" icon="plus" onClick={() => setEdit({ name_en: '', name_dv: '', default_unit: 'kg', active: true })}>{t('settings.addFishType')}</Button>}>
      <DataTable rows={list.data ?? []} loading={list.loading} onRowClick={(r) => setEdit({ ...r })} columns={[
        { key: 'name_en', label: t('common.nameEn') }, { key: 'name_dv', label: t('common.nameDv'), render: (r) => <span dir="rtl" className="font-thaana">{r.name_dv ?? '—'}</span> },
        { key: 'default_unit', label: t('common.unit'), render: (r) => t(`units.${r.default_unit}`) },
        { key: 'active', label: t('common.status'), render: (r) => (r.active ? t('common.active') : t('common.inactive')) },
      ]} />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={t('sales.fishType')}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!edit?.name_en?.trim()} onClick={save}>{t('common.save')}</Button></>}>
        {edit && <div className="space-y-3">
          <Field label={t('common.nameEn')} required><Input value={edit.name_en} onChange={(e) => setEdit({ ...edit, name_en: e.target.value })} /></Field>
          <Field label={t('common.nameDv')}><Input dir="rtl" className="font-thaana" value={edit.name_dv ?? ''} onChange={(e) => setEdit({ ...edit, name_dv: e.target.value })} /></Field>
          <Field label={t('common.unit')}><Select value={edit.default_unit} onChange={(e) => setEdit({ ...edit, default_unit: e.target.value })}>{UNITS.map((u) => <option key={u.value} value={u.value}>{t(u.label)}</option>)}</Select></Field>
          <Checkbox label={t('common.active')} checked={!!edit.active} onChange={(c) => setEdit({ ...edit, active: c })} />
        </div>}
      </Modal>
    </Card>
  );
}

const ALERT_KEYS = ['bills_pending_approval', 'bills_due_soon', 'bills_overdue', 'bills_partially_paid', 'missing_documents', 'possible_duplicates',
  'trips_missing_records', 'payroll_pending_approval', 'allocation_warnings', 'unpaid_wages', 'advances_outstanding', 'records_pending_approval'];
const ROLES = ['owner', 'manager', 'payroll_officer', 'accountant', 'readonly'];

function Notifications() {
  const { t } = useI18n();
  const { company } = useAuth();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const rows = useAsync(() => fetchAll('notification_settings'), [tick]);
  const get = (k: string) => rows.data?.find((r) => r.alert_key === k) ?? { alert_key: k, roles: ROLES, enabled: true };
  const update = async (k: string, patch: Row) => {
    const cur = get(k);
    try {
      unwrap(await supabase.from('notification_settings').upsert({ company_id: company!.id, alert_key: k, roles: cur.roles, enabled: cur.enabled, ...patch }));
      setTick((x) => x + 1);
    } catch (e) { toast.error(errorText(e, t)); }
  };
  if (rows.loading) return <Spinner />;
  return (
    <Card padded={false} title={t('settings.notifications')}>
      <div className="p-3"><Alert tone="info">{t('settings.alertRoles')}: {t('dashboard.alerts')}</Alert></div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-start">{t('dashboard.alerts')}</th><th className="px-2 py-2">{t('common.active')}</th>{ROLES.map((r) => <th key={r} className="px-2 py-2">{t(`roles.${r}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {ALERT_KEYS.map((k) => {
              const s = get(k);
              return (
                <tr key={k}>
                  <td className="px-3 py-1.5">{t(`alerts.${k}`, { count: 'N' })}</td>
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={!!s.enabled} onChange={(e) => update(k, { enabled: e.target.checked })} /></td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={(s.roles ?? []).includes(r)} disabled={!s.enabled}
                        onChange={(e) => update(k, { roles: e.target.checked ? [...(s.roles ?? []), r] : (s.roles ?? []).filter((x: string) => x !== r) })} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function System() {
  const { t } = useI18n();
  return (
    <Card title={t('settings.backup')}>
      <div className="space-y-3 text-sm text-slate-700">
        <p>{t('settings.backupText')}</p>
        <ul className="list-disc space-y-1 ps-5">
          <li>Database: Supabase daily backups + Point-in-Time Recovery (Pro plan) and the <code>scripts/backup.sh</code> pg_dump script.</li>
          <li>Documents: private bucket <code>documents</code>; <code>scripts/backup.sh</code> also mirrors it with the Supabase CLI.</li>
          <li>Restore drill: <code>docs/BACKUP.md</code> → “Quarterly restore test”.</li>
        </ul>
      </div>
    </Card>
  );
}
