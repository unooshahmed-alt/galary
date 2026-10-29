import { useMemo, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { callFunction, fetchAll, updateRow, useAsync, errorText, unwrap, type Row } from '@/lib/db';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, Spinner, StatusBadge, Tabs } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { Modal } from '@/components/Modal';
import { useOptions } from '@/components/RefSelect';
import { useToast } from '@/components/Toast';

const ROLES = ['owner', 'manager', 'payroll_officer', 'accountant', 'readonly'] as const;

export default function Users() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'users' | 'matrix'>('users');
  return (
    <div>
      <PageHeader title={t('users.title')} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'users', label: t('users.title') }, { id: 'matrix', label: t('users.matrix') }]} />
      {tab === 'users' ? <UserList /> : <PermissionMatrix />}
    </div>
  );
}

function UserList() {
  const { t, lang } = useI18n();
  const { profile: me, isOwner } = useAuth();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const [edit, setEdit] = useState<Row | null>(null);
  const [invite, setInvite] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const users = useAsync(() => fetchAll('v_profiles', { sort: { column: 'full_name', ascending: true } }), [tick]);
  const boats = useOptions('boats', { includeInactive: true });
  const boatName = (id: string) => boats.options.find((o) => o.value === id)?.label ?? '';
  const roleOptions = ROLES.filter((r) => r !== 'owner' || isOwner);

  const save = async () => {
    setBusy(true);
    try {
      await updateRow('profiles', edit!.id, { full_name: edit!.full_name, role: edit!.role, all_boats: edit!.all_boats, active: edit!.active, language: edit!.language || null });
      const current = new Set<string>(users.data?.find((u) => u.id === edit!.id)?.boat_ids ?? []);
      const wanted = new Set<string>(edit!.boat_ids ?? []);
      const add = [...wanted].filter((b) => !current.has(b));
      const remove = [...current].filter((b) => !wanted.has(b));
      if (add.length) unwrap(await supabase.from('user_boats').insert(add.map((b) => ({ user_id: edit!.id, boat_id: b, company_id: edit!.company_id }))));
      for (const b of remove) unwrap(await supabase.from('user_boats').delete().eq('user_id', edit!.id).eq('boat_id', b));
      setEdit(null); setTick((x) => x + 1);
      toast.success(t('common.success'));
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };

  const sendInvite = async () => {
    setBusy(true);
    try {
      await callFunction('invite-user', { email: invite!.email, fullName: invite!.full_name, role: invite!.role, language: invite!.language, allBoats: invite!.all_boats, boatIds: invite!.boat_ids });
      setInvite(null); setTick((x) => x + 1);
      toast.success(t('users.inviteSent'));
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };

  const boatPicker = (v: Row, set: (r: Row) => void) => (
    <div className="space-y-2">
      <Checkbox label={t('users.allBoats')} checked={!!v.all_boats || v.role === 'owner'} disabled={v.role === 'owner'} onChange={(c) => set({ ...v, all_boats: c })} />
      {!v.all_boats && v.role !== 'owner' && (
        <div className="grid grid-cols-1 gap-1 rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
          {boats.options.map((b) => (
            <Checkbox key={b.value} label={b.label} checked={(v.boat_ids ?? []).includes(b.value)}
              onChange={(c) => set({ ...v, boat_ids: c ? [...(v.boat_ids ?? []), b.value] : (v.boat_ids ?? []).filter((x: string) => x !== b.value) })} />
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card padded={false} title={t('users.title')} actions={<Button variant="primary" icon="plus" onClick={() => setInvite({ email: '', full_name: '', role: 'manager', language: lang, all_boats: false, boat_ids: [] })}>{t('users.invite')}</Button>}>
      {users.loading ? <div className="p-4"><Spinner /></div> : (
        <DataTable rows={users.data ?? []} onRowClick={(r) => setEdit({ ...r, boat_ids: [...(r.boat_ids ?? [])] })} columns={[
          { key: 'full_name', label: t('users.fullName'), render: (r) => <div><div className="font-medium">{r.full_name || '—'} {r.id === me?.id && <Badge>{t('users.you')}</Badge>}</div><div className="text-xs text-slate-500" dir="ltr">{r.email}</div></div> },
          { key: 'role', label: t('common.role'), render: (r) => t(`roles.${r.role}`) },
          { key: 'boats', label: t('users.boats'), render: (r) => (r.role === 'owner' || r.all_boats ? t('users.allBoats') : (r.boat_ids ?? []).map(boatName).join(', ') || '—') },
          { key: 'language', label: t('common.language'), render: (r) => (r.language === 'dv' ? 'ދިވެހި' : r.language === 'en' ? 'English' : '—') },
          { key: 'active', label: t('common.status'), render: (r) => <StatusBadge status={r.active ? 'active' : 'inactive'} /> },
        ]} />
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.email ?? ''}
        footer={<><Button onClick={() => setEdit(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={save}>{t('common.save')}</Button></>}>
        {edit && <div className="space-y-3">
          <Field label={t('users.fullName')}><Input value={edit.full_name ?? ''} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
          <Field label={t('common.role')}>
            <Select value={edit.role} disabled={edit.role === 'owner' && !isOwner} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
              {(edit.role === 'owner' ? ROLES : roleOptions).map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('common.language')}>
            <Select value={edit.language ?? ''} onChange={(e) => setEdit({ ...edit, language: e.target.value })}>
              <option value="">—</option><option value="en">English</option><option value="dv">ދިވެހި</option>
            </Select>
          </Field>
          <Field label={t('users.boats')}>{boatPicker(edit, setEdit)}</Field>
          {edit.id !== me?.id && <Checkbox label={t('common.active')} checked={!!edit.active} onChange={(c) => setEdit({ ...edit, active: c })} />}
        </div>}
      </Modal>

      <Modal open={!!invite} onClose={() => setInvite(null)} title={t('users.invite')}
        footer={<><Button onClick={() => setInvite(null)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} disabled={!invite?.email} onClick={sendInvite}>{t('users.invite')}</Button></>}>
        {invite && <div className="space-y-3">
          <Field label={t('common.email')} required><Input type="email" dir="ltr" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          <Field label={t('users.fullName')}><Input value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} /></Field>
          <Field label={t('common.role')}>
            <Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
              {roleOptions.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('common.language')}>
            <Select value={invite.language} onChange={(e) => setInvite({ ...invite, language: e.target.value })}><option value="en">English</option><option value="dv">ދިވެހި</option></Select>
          </Field>
          <Field label={t('users.boats')}>{boatPicker(invite, setInvite)}</Field>
        </div>}
      </Modal>
    </Card>
  );
}

function PermissionMatrix() {
  const { t } = useI18n();
  const { company } = useAuth();
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const perms = useAsync(() => fetchAll('permissions', { sort: { column: 'module', ascending: true } }), []);
  const granted = useAsync(() => fetchAll('role_permissions'), [tick]);
  const has = useMemo(() => new Set((granted.data ?? []).map((g) => `${g.role}|${g.permission}`)), [granted.data]);
  const roles = ROLES.filter((r) => r !== 'owner');

  const toggle = async (role: string, perm: string, on: boolean) => {
    try {
      if (on) unwrap(await supabase.from('role_permissions').insert({ company_id: company!.id, role, permission: perm }));
      else unwrap(await supabase.from('role_permissions').delete().eq('role', role).eq('permission', perm));
      setTick((x) => x + 1);
    } catch (e) { toast.error(errorText(e, t)); }
  };

  if (perms.loading) return <Spinner />;
  return (
    <Card padded={false} title={t('users.permissions')}>
      <div className="p-3"><Alert tone="info">{t('users.ownerAll')}</Alert></div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr><th className="px-3 py-2 text-start">Permission</th>{roles.map((r) => <th key={r} className="px-2 py-2 text-center">{t(`roles.${r}`)}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(perms.data ?? []).map((p) => (
              <tr key={p.key}>
                <td className="px-3 py-1.5"><div className="font-medium text-slate-800">{p.description}</div><code className="text-[11px] text-slate-500">{p.key}</code></td>
                {roles.map((r) => (
                  <td key={r} className="px-2 py-1.5 text-center">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-ocean-700" aria-label={`${r} ${p.key}`}
                      checked={has.has(`${r}|${p.key}`)} onChange={(e) => toggle(r, p.key, e.target.checked)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
