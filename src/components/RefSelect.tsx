import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useI18n, type Lang } from '@/lib/i18n';
import { dname, date as fmtDate } from '@/lib/format';
import type { Row } from '@/lib/db';
import { Select } from './ui';

export type OptionKind =
  | 'boats' | 'crew' | 'suppliers' | 'customers' | 'expenseCategories' | 'incomeCategories' | 'fishTypes'
  | 'trips' | 'profiles' | 'payrolls' | 'openPayrolls' | 'slips' | 'ruleVersions';

export interface Option { value: string; label: string; row: Row }
interface Params { boatId?: string | null; includeInactive?: boolean; tripId?: string | null }

const cache = new Map<string, Promise<Row[]>>();
const listeners = new Set<() => void>();

export function invalidateOptions(kind?: OptionKind) {
  for (const k of [...cache.keys()]) if (!kind || k.startsWith(`${kind}|`)) cache.delete(k);
  listeners.forEach((l) => l());
}

async function load(kind: OptionKind, p: Params): Promise<Row[]> {
  const active = !p.includeInactive;
  let q;
  switch (kind) {
    case 'boats':
      q = supabase.from('boats').select('id,name,name_dv,status,registration_no').order('name');
      if (active) q = q.eq('status', 'active');
      break;
    case 'crew':
      q = supabase.from('v_crew').select('id,crew_code,name_en,name_dv,status,current_boat_id,current_role,job_role').order('crew_code');
      if (active) q = q.eq('status', 'active');
      if (p.boatId) q = q.eq('current_boat_id', p.boatId);
      break;
    case 'suppliers':
      q = supabase.from('suppliers').select('id,name,name_dv,status,phone,email').order('name');
      if (active) q = q.eq('status', 'active');
      break;
    case 'customers':
      q = supabase.from('customers').select('id,name,name_dv,status').order('name');
      if (active) q = q.eq('status', 'active');
      break;
    case 'expenseCategories':
    case 'incomeCategories':
      q = supabase.from('categories').select('id,code,name_en,name_dv,active,is_system,kind')
        .eq('kind', kind === 'expenseCategories' ? 'expense' : 'income').order('sort_order');
      if (active) q = q.eq('active', true);
      break;
    case 'fishTypes':
      q = supabase.from('fish_types').select('id,name_en,name_dv,default_unit,active').order('name_en');
      if (active) q = q.eq('active', true);
      break;
    case 'trips':
      q = supabase.from('trips').select('id,trip_code,boat_id,start_date,return_date,status').order('start_date', { ascending: false }).limit(300);
      if (p.boatId) q = q.eq('boat_id', p.boatId);
      break;
    case 'profiles':
      q = supabase.from('profiles').select('id,full_name,email,role,active').order('full_name');
      break;
    case 'payrolls':
    case 'openPayrolls':
      q = supabase.from('v_payrolls').select('id,payroll_code,boat_id,boat_name,trip_code,period_start,period_end,status,owner_allocation')
        .order('period_start', { ascending: false }).limit(300);
      if (kind === 'openPayrolls') q = q.in('status', ['draft', 'calculated']);
      if (p.boatId) q = q.eq('boat_id', p.boatId);
      break;
    case 'slips':
      q = supabase.from('v_wage_slips').select('id,slip_no,version,crew_id,crew_code,crew_name_en,crew_name_dv,boat_id,payroll_code,net_payable,remaining,status')
        .eq('status', 'issued').gt('remaining', 0).order('generated_at', { ascending: false }).limit(500);
      if (p.boatId) q = q.eq('boat_id', p.boatId);
      break;
    case 'ruleVersions':
      q = supabase.from('v_wage_rule_versions').select('id,rule_name,version,boat_id,boat_name,effective_from,effective_to,status')
        .eq('status', 'approved').order('effective_from', { ascending: false });
      if (p.boatId) q = q.eq('boat_id', p.boatId);
      break;
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Row[];
}

export function optionLabel(kind: OptionKind, r: Row, lang: Lang): string {
  switch (kind) {
    case 'boats': return dname(r.name, r.name_dv, lang);
    case 'crew': return `${r.crew_code ?? ''} · ${dname(r.name_en, r.name_dv, lang)}`;
    case 'suppliers': case 'customers': return dname(r.name, r.name_dv, lang);
    case 'expenseCategories': case 'incomeCategories': case 'fishTypes': return dname(r.name_en, r.name_dv, lang);
    case 'trips': return `${r.trip_code} · ${fmtDate(r.start_date, lang)}`;
    case 'profiles': return r.full_name || r.email;
    case 'payrolls': case 'openPayrolls': return `${r.payroll_code} · ${r.boat_name}${r.trip_code ? ` · ${r.trip_code}` : ''}`;
    case 'slips': return `${r.slip_no} v${r.version} · ${dname(r.crew_name_en, r.crew_name_dv, lang)} · ${r.payroll_code}`;
    case 'ruleVersions': return `${r.rule_name} v${r.version} (${fmtDate(r.effective_from, lang)})`;
  }
}

export function useOptions(kind: OptionKind, params: Params = {}) {
  const { lang } = useI18n();
  const key = `${kind}|${JSON.stringify(params)}`;
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((x) => x + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => {
    let alive = true;
    if (!cache.has(key)) cache.set(key, load(kind, params).catch((e) => { cache.delete(key); throw e; }));
    setLoading(true);
    cache.get(key)!.then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);
  const options: Option[] = rows.map((r) => ({ value: r.id, label: optionLabel(kind, r, lang), row: r }));
  return { options, rows, loading };
}

export function RefSelect({ kind, value, onChange, params, placeholder, disabled, required, allowEmpty = true, className, id }: {
  kind: OptionKind; value: string | null | undefined; onChange: (v: string | null, row?: Row) => void; params?: Params;
  placeholder?: string; disabled?: boolean; required?: boolean; allowEmpty?: boolean; className?: string; id?: string;
}) {
  const { t } = useI18n();
  const { options, loading } = useOptions(kind, params);
  return (
    <Select id={id} value={value ?? ''} disabled={disabled || loading} required={required} className={className}
      onChange={(e) => { const v = e.target.value || null; onChange(v, options.find((o) => o.value === v)?.row); }}>
      {allowEmpty && <option value="">{placeholder ?? t('common.select')}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
