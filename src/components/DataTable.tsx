import type { ReactNode } from 'react';
import { Spinner, EmptyState, Button, cx } from './ui';
import { useI18n } from '@/lib/i18n';
import type { Row } from '@/lib/db';

export interface Column {
  key: string;
  label: ReactNode;
  render?: (row: Row) => ReactNode;
  align?: 'start' | 'end' | 'center';
  sortable?: boolean;
  className?: string;
  /** hide on small screens */
  hideSm?: boolean;
}

export function DataTable({
  columns, rows, loading, onRowClick, sort, onSort, page, pageSize, count, onPage, empty, rowKey = 'id', footer, compact,
}: {
  columns: Column[];
  rows: Row[];
  loading?: boolean;
  onRowClick?: (r: Row) => void;
  sort?: { column: string; ascending?: boolean };
  onSort?: (s: { column: string; ascending: boolean }) => void;
  page?: number;
  pageSize?: number;
  count?: number;
  onPage?: (p: number) => void;
  empty?: ReactNode;
  rowKey?: string;
  footer?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const pages = count !== undefined && pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  const alignCls = (a?: string) => (a === 'end' ? 'text-end' : a === 'center' ? 'text-center' : 'text-start');
  return (
    <div className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col"
                  className={cx('whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500', alignCls(c.align), c.hideSm && 'hidden md:table-cell', c.sortable && onSort && 'cursor-pointer select-none hover:text-slate-800')}
                  onClick={() => c.sortable && onSort?.({ column: c.key, ascending: sort?.column === c.key ? !sort.ascending : false })}>
                  {c.label}{sort?.column === c.key && <span className="ms-1">{sort.ascending ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="py-10 text-center text-slate-500"><Spinner className="mx-auto" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length}>{empty ?? <EmptyState title={t('common.noRecords')} />}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={String(r[rowKey] ?? i)} onClick={onRowClick ? () => onRowClick(r) : undefined}
                className={cx(onRowClick && 'cursor-pointer hover:bg-ocean-50/50', loading && 'opacity-60')}>
                {columns.map((c) => (
                  <td key={c.key} className={cx('px-3 text-slate-800', compact ? 'py-1.5' : 'py-2.5', alignCls(c.align), c.hideSm && 'hidden md:table-cell', c.className)}>
                    {c.render ? c.render(r) : (r[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="bg-slate-50 font-semibold">{footer}</tfoot>}
        </table>
      </div>
      {onPage && count !== undefined && count > (pageSize ?? 25) && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-xs text-slate-600">
          <span>{t('common.showing')} {(page ?? 0) * (pageSize ?? 25) + 1}–{Math.min(count, ((page ?? 0) + 1) * (pageSize ?? 25))} {t('common.of')} {count}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={(page ?? 0) <= 0} onClick={() => onPage((page ?? 0) - 1)}>{t('common.previous')}</Button>
            <span>{t('common.page')} {(page ?? 0) + 1} / {pages}</span>
            <Button size="sm" disabled={(page ?? 0) + 1 >= pages} onClick={() => onPage((page ?? 0) + 1)}>{t('common.next')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
