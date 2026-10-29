import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { TFn } from './i18n';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

export class AppError extends Error {
  code?: string;
  details?: string;
  constructor(message: string, code?: string, details?: string) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

interface PgResult<T> { data: T | null; error: { message: string; code?: string; details?: string } | null; count?: number | null }

export function unwrap<T>(res: PgResult<T>): T {
  if (res.error) throw new AppError(res.error.message, res.error.code, res.error.details);
  return res.data as T;
}

export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  return unwrap<T>(await supabase.rpc(fn, args) as PgResult<T>);
}

/** Calls an edge function with the signed-in user's token. */
export async function callFunction<T = unknown>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    let payload: Row | undefined;
    // FunctionsHttpError carries the response body
    const ctx = (error as unknown as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { payload = await ctx.json(); message = payload?.error ?? message; } catch { /* not json */ }
    }
    const e = new AppError(message);
    (e as AppError & { payload?: Row }).payload = payload;
    throw e;
  }
  return data as T;
}

/** Map database / network errors to friendly, translated messages. */
export function errorText(err: unknown, t: TFn): string {
  const e = err as AppError & { status?: number };
  const msg = String(e?.message ?? err ?? '');
  if (!msg) return t('errors.generic');
  if (/permission_denied|row-level security|42501|not allowed/i.test(msg) || e?.code === '42501') return t('errors.permission');
  if (/possible_duplicate/i.test(msg)) return t('errors.duplicateBill');
  if (/^overpayment/i.test(msg)) return t('errors.overpayment');
  if (/bill_payments_ref_uniq|crew_payments_ref_uniq|customer_receipts_ref_uniq/i.test(msg)) return t('errors.duplicateReference');
  if (/duplicate key|23505/i.test(msg) || e?.code === '23505') return t('errors.duplicateEntry');
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return t('errors.network');
  // Database messages written for people (raised by workflow functions) are shown as-is.
  return msg.replace(/^ERROR:\s*/, '');
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fn();
      if (id === seq.current) setData(r);
    } catch (e) {
      if (id === seq.current) setError(e);
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export type FilterOp = 'eq' | 'neq' | 'gte' | 'lte' | 'gt' | 'lt' | 'ilike' | 'in' | 'is' | 'not_is';
export type Filter = [column: string, op: FilterOp, value: unknown];

export interface ListOptions {
  select?: string;
  filters?: Filter[];
  search?: string;
  searchColumns?: string[];
  sort?: { column: string; ascending?: boolean };
  page?: number;
  pageSize?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyFilters(q: any, filters: Filter[] = []) {
  for (const [col, op, val] of filters) {
    if (val === undefined || val === '' || val === null && op !== 'is' && op !== 'not_is') continue;
    if (op === 'in') q = q.in(col, val as unknown[]);
    else if (op === 'is') q = q.is(col, val);
    else if (op === 'not_is') q = q.not(col, 'is', val);
    else if (op === 'ilike') q = q.ilike(col, `%${val}%`);
    else q = q[op](col, val);
  }
  return q;
}

function searchExpr(term: string, cols: string[]): string {
  const safe = term.replace(/[,()*%]/g, ' ').trim();
  return cols.map((c) => `${c}.ilike.*${safe}*`).join(',');
}

export async function fetchList(source: string, o: ListOptions = {}): Promise<{ rows: Row[]; count: number }> {
  const pageSize = o.pageSize ?? 25;
  const page = o.page ?? 0;
  let q = supabase.from(source).select(o.select ?? '*', { count: 'exact' });
  q = applyFilters(q, o.filters);
  if (o.search && o.search.trim() && o.searchColumns?.length) q = q.or(searchExpr(o.search, o.searchColumns));
  if (o.sort) q = q.order(o.sort.column, { ascending: o.sort.ascending ?? false, nullsFirst: false });
  q = q.range(page * pageSize, page * pageSize + pageSize - 1);
  const res = await q;
  const rows = unwrap<Row[]>(res as PgResult<Row[]>);
  return { rows: rows ?? [], count: res.count ?? rows?.length ?? 0 };
}

/** Fetch every row (in pages of 1000) — used by reports and exports. */
export async function fetchAll(source: string, o: Omit<ListOptions, 'page' | 'pageSize'> = {}, max = 20000): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < max; from += 1000) {
    let q = supabase.from(source).select(o.select ?? '*');
    q = applyFilters(q, o.filters);
    if (o.search && o.search.trim() && o.searchColumns?.length) q = q.or(searchExpr(o.search, o.searchColumns));
    if (o.sort) q = q.order(o.sort.column, { ascending: o.sort.ascending ?? false, nullsFirst: false });
    const rows = unwrap<Row[]>(await q.range(from, from + 999) as PgResult<Row[]>) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function fetchOne(source: string, id: string, column = 'id'): Promise<Row | null> {
  return unwrap<Row | null>(await supabase.from(source).select('*').eq(column, id).maybeSingle() as PgResult<Row | null>);
}

export async function insertRow(table: string, values: Row): Promise<Row> {
  return unwrap<Row>(await supabase.from(table).insert(values).select().single() as PgResult<Row>);
}

export async function updateRow(table: string, id: string, values: Row): Promise<Row> {
  const res = await supabase.from(table).update(values).eq('id', id).select().maybeSingle();
  const row = unwrap<Row | null>(res as PgResult<Row | null>);
  if (!row) throw new AppError('permission_denied: the record could not be updated');
  return row;
}

export async function deleteRow(table: string, match: Row): Promise<void> {
  let q = supabase.from(table).delete();
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  unwrap(await q as PgResult<unknown>);
}

/** Strip empty strings so optional columns are stored as NULL. */
export function clean(values: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) out[k] = v === '' ? null : v;
  return out;
}
