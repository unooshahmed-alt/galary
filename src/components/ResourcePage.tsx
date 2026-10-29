import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Card, Input, PageHeader, Select, Alert } from './ui';
import { DataTable, type Column } from './DataTable';
import { Modal } from './Modal';
import { FormFields, initialValues, validate, coerce, type FieldDef } from './Form';
import { RefSelect, invalidateOptions, type OptionKind } from './RefSelect';
import { ExportMenu } from './ExportMenu';
import { DateRangeFilter, type DateRange } from './DateRangeFilter';
import { useToast } from './Toast';
import { useI18n, exportT, type ExportLang, type TFn } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchList, fetchAll, fetchOne, insertRow, updateRow, errorText, type Filter, type Row } from '@/lib/db';
import type { ExportColumn } from '@/lib/exporters';
import { date as fmtDate } from '@/lib/format';

export interface FilterDef {
  name: string;
  label: string;
  type: 'select' | 'ref' | 'daterange' | 'number' | 'text';
  column?: string;
  options?: { value: string; label: string }[];
  ref?: OptionKind;
  op?: Filter[1];
}

export interface ResourceConfig {
  table: string;
  view?: string;
  title: string;
  subtitle?: ReactNode;
  newLabel?: string;
  viewPerm: string;
  managePerm?: string;
  columns: Column[];
  fields?: FieldDef[];
  searchColumns?: string[];
  defaultSort?: { column: string; ascending?: boolean };
  filters?: FilterDef[];
  baseFilters?: Filter[];
  intro?: ReactNode;
  onRowClick?: (r: Row) => void;
  canEdit?: (r: Row) => boolean;
  beforeSave?: (values: Row, isNew: boolean) => Row | Promise<Row>;
  afterSave?: (row: Row, isNew: boolean, values: Row) => Promise<void> | void;
  /** custom save (e.g. an RPC); returns the saved row */
  save?: (values: Row, existing: Row | null) => Promise<Row>;
  extraForm?: (values: Row, set: (p: Row) => void, existing: Row | null) => ReactNode;
  headerActions?: ReactNode;
  invalidates?: OptionKind[];
  exportColumns?: (t: TFn) => ExportColumn[];
  exportName?: string;
  modalSize?: 'sm' | 'md' | 'lg' | 'xl';
  pageSize?: number;
  reloadKey?: unknown;
  /** render inside another page (no page header) */
  embedded?: boolean;
  /** values pre-filled on "new" (e.g. the current trip) */
  newDefaults?: Row;
  onSaved?: () => void;
}

export function ResourcePage({ config: c }: { config: ResourceConfig }) {
  const { t } = useI18n();
  const { can, currency } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(c.defaultSort ?? { column: 'created_at', ascending: false });
  const [fv, setFv] = useState<Row>({});
  const [range, setRange] = useState<DateRange>({ preset: 'custom', from: '', to: '' });
  const [rows, setRows] = useState<Row[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null | undefined>(undefined); // undefined = closed, null = new
  const [values, setValues] = useState<Row>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const pageSize = c.pageSize ?? 25;
  const source = c.view ?? c.table;
  const canManage = c.managePerm ? can(c.managePerm) : false;

  const filters = useMemo<Filter[]>(() => {
    const f: Filter[] = [...(c.baseFilters ?? [])];
    for (const d of c.filters ?? []) {
      if (d.type === 'daterange') {
        if (range.from) f.push([d.column ?? 'date', 'gte', range.from]);
        if (range.to) f.push([d.column ?? 'date', 'lte', range.to]);
      } else if (fv[d.name]) f.push([d.column ?? d.name, d.op ?? (d.type === 'text' ? 'ilike' : 'eq'), d.type === 'number' ? Number(fv[d.name]) : fv[d.name]]);
    }
    return f;
  }, [c.baseFilters, c.filters, fv, range]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchList(source, { filters, search, searchColumns: c.searchColumns, sort, page, pageSize });
      setRows(r.rows); setCount(r.count);
    } catch (e) { setError(errorText(e, t)); } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [source, filters, search, sort, page, c.reloadKey]);
  useEffect(() => { setPage(0); }, [filters, search]);

  const openEditor = async (viewRow: Row | null) => {
    setErrs({});
    let row = viewRow;
    // Lists often come from a read view; edit the real table row so no column is lost.
    if (viewRow && c.view && c.view !== c.table) {
      try { row = (await fetchOne(c.table, viewRow.id)) ?? viewRow; } catch { row = viewRow; }
    }
    setValues(row ? initialValues(c.fields ?? [], row) : { ...initialValues(c.fields ?? [], null), ...(c.newDefaults ?? {}) });
    setEditing(row);
  };

  const submit = async () => {
    const fields = c.fields ?? [];
    const e = validate(fields, values, t);
    setErrs(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const isNew = editing === null;
      let payload = coerce(fields, values);
      if (c.beforeSave) payload = await c.beforeSave(payload, isNew);
      const saved = c.save ? await c.save(payload, editing ?? null)
        : isNew ? await insertRow(c.table, payload) : await updateRow(c.table, editing!.id, payload);
      if (c.afterSave) await c.afterSave(saved, isNew, values);
      c.invalidates?.forEach((k) => invalidateOptions(k));
      toast.success(t('common.success'));
      setEditing(undefined);
      c.onSaved?.();
      await load();
    } catch (err) {
      toast.error(errorText(err, t));
    } finally { setSaving(false); }
  };

  const buildExport = async (xl: ExportLang) => {
    const xt = exportT(xl);
    const all = await fetchAll(source, { filters, search, searchColumns: c.searchColumns, sort });
    const cols = c.exportColumns!(xt);
    const meta: [string, string][] = [
      [xt('common.generatedOn'), new Date().toLocaleString('en-GB')],
      [xt('common.currency'), currency],
    ];
    if (range.from || range.to) meta.push([xt('common.period'), `${fmtDate(range.from)} – ${fmtDate(range.to)}`]);
    if (search) meta.push([xt('common.search'), search]);
    const totals: Record<string, number> = {};
    for (const col of cols) if (col.type === 'money') totals[col.key] = all.reduce((s, r) => s + Number((col.value ? col.value(r) : r[col.key]) ?? 0), 0);
    return {
      fileName: `${c.exportName ?? c.table}-${new Date().toISOString().slice(0, 10)}`,
      title: xt(c.title), meta, columns: cols, rows: all, totals, lang: xl, currency,
    };
  };

  if (!can(c.viewPerm)) return <Alert tone="warn">{t('common.noAccess')}</Alert>;

  return (
    <div>
      {(() => {
        const actions = <>
          {c.headerActions}
          {c.exportColumns && <ExportMenu build={buildExport} />}
          {canManage && c.fields && <Button variant="primary" icon="plus" size={c.embedded ? 'sm' : 'md'} onClick={() => void openEditor(null)}>{t(c.newLabel ?? 'common.new')}</Button>}
        </>;
        return c.embedded
          ? <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-slate-700">{t(c.title)}</h3><div className="flex flex-wrap gap-2">{actions}</div></div>
          : <PageHeader title={t(c.title)} subtitle={c.subtitle} actions={actions} />;
      })()}
      {c.intro && <div className="mb-4">{c.intro}</div>}
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          {c.searchColumns && (
            <div className="min-w-[200px] flex-1">
              <Input type="search" placeholder={t('common.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
          {(c.filters ?? []).map((d) => d.type === 'daterange' ? (
            <DateRangeFilter key={d.name} value={range} onChange={setRange} />
          ) : d.type === 'number' || d.type === 'text' ? (
            <div key={d.name} className="w-full sm:w-36">
              <Input type={d.type === 'number' ? 'number' : 'text'} step="0.01" placeholder={t(d.label)} aria-label={t(d.label)}
                value={fv[d.name] ?? ''} onChange={(e) => setFv({ ...fv, [d.name]: e.target.value })} />
            </div>
          ) : d.type === 'ref' ? (
            <div key={d.name} className="w-full sm:w-48">
              <RefSelect kind={d.ref!} value={fv[d.name]} params={{ includeInactive: true }} placeholder={`${t(d.label)}: ${t('common.all')}`}
                onChange={(v) => setFv({ ...fv, [d.name]: v })} />
            </div>
          ) : (
            <div key={d.name} className="w-full sm:w-44">
              <Select value={fv[d.name] ?? ''} onChange={(e) => setFv({ ...fv, [d.name]: e.target.value })} aria-label={t(d.label)}>
                <option value="">{t(d.label)}: {t('common.all')}</option>
                {d.options?.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
              </Select>
            </div>
          ))}
          <Button size="sm" variant="ghost" icon="refresh" onClick={() => void load()} aria-label={t('common.refresh')} />
        </div>
        {error && <div className="p-3"><Alert tone="error">{error}</Alert></div>}
        <DataTable columns={c.columns} rows={rows} loading={loading} sort={sort}
          onSort={(s) => setSort(s)} page={page} pageSize={pageSize} count={count} onPage={setPage}
          onRowClick={c.onRowClick ?? (canManage && c.fields ? (r) => { if (!c.canEdit || c.canEdit(r)) void openEditor(r); } : undefined)} />
      </Card>

      {c.fields && (
        <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} size={c.modalSize ?? 'lg'}
          title={editing ? `${t('common.edit')} · ${t(c.title)}` : t(c.newLabel ?? 'common.new')}
          footer={<>
            <Button onClick={() => setEditing(undefined)}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={submit}>{t('common.save')}</Button>
          </>}>
          <div className="space-y-4">
            <FormFields fields={c.fields} values={values} onChange={setValues} errors={errs} isEdit={!!editing} />
            {c.extraForm?.(values, (p) => setValues((v) => ({ ...v, ...p })), editing ?? null)}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Small helper for consistent date/money/status cells in column configs. */
export const cell = {
  date: (k: string, lang: 'en' | 'dv') => (r: Row) => fmtDate(r[k], lang),
};
