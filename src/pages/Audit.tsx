import { useState } from 'react';
import { ResourcePage, type ResourceConfig } from '@/components/ResourcePage';
import { Modal } from '@/components/Modal';
import { Badge } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { dateTime } from '@/lib/format';
import type { Row } from '@/lib/db';

const TABLES = ['bills', 'bill_payments', 'transactions', 'fish_sales', 'customer_receipts', 'payroll_periods', 'wage_slips', 'crew_payments',
  'cash_advances', 'fish_taken', 'crew_bonuses', 'payroll_adjustments', 'attendance', 'trips', 'crew_members', 'boats', 'documents',
  'wage_rule_versions', 'profiles', 'role_permissions', 'companies'];

export default function Audit() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState<Row | null>(null);
  const config: ResourceConfig = {
    table: 'audit_logs', view: 'v_audit_logs', title: 'audit.title', viewPerm: 'audit.view', pageSize: 50,
    defaultSort: { column: 'created_at', ascending: false }, searchColumns: ['record_id', 'user_name', 'table_name'],
    filters: [
      { name: 'table_name', label: 'audit.table', type: 'select', options: TABLES.map((x) => ({ value: x, label: x })) },
      { name: 'action', label: 'audit.action', type: 'select', options: ['insert', 'update', 'delete'].map((x) => ({ value: x, label: `audit.${x}` })) },
      { name: 'user_id', label: 'audit.user', type: 'ref', ref: 'profiles' },
      { name: 'created_at', label: 'audit.when', type: 'daterange', column: 'created_at' },
    ],
    onRowClick: (r) => setOpen(r),
    columns: [
      { key: 'created_at', label: t('audit.when'), render: (r) => dateTime(r.created_at, lang) },
      { key: 'user_name', label: t('audit.user'), render: (r) => r.user_name ?? 'system' },
      { key: 'table_name', label: t('audit.table'), render: (r) => <code className="text-xs">{r.table_name}</code> },
      { key: 'action', label: t('audit.action'), render: (r) => <Badge tone={r.action === 'insert' ? 'green' : r.action === 'delete' ? 'red' : 'blue'}>{t(`audit.${r.action}`)}</Badge> },
      { key: 'code', label: t('common.code'), render: (r) => {
        const d = r.new_data ?? r.old_data ?? {};
        return d.bill_code ?? d.txn_code ?? d.payment_code ?? d.payroll_code ?? d.slip_no ?? d.trip_code ?? d.crew_code ?? d.advance_code ?? d.sale_code ?? d.name ?? '—';
      } },
      { key: 'changed_fields', label: t('audit.changed'), render: (r) => <span className="text-xs text-slate-600">{(r.changed_fields ?? []).join(', ')}</span> },
    ],
    exportColumns: (xt) => [
      { header: xt('audit.when'), key: 'created_at', type: 'datetime' }, { header: xt('audit.user'), key: 'user_name' }, { header: xt('audit.table'), key: 'table_name' },
      { header: xt('audit.action'), key: 'action' }, { header: 'Record', key: 'record_id' },
      { header: xt('audit.changed'), key: 'changed_fields', value: (r) => ((r.changed_fields as string[] | null) ?? []).join(', ') },
    ],
    exportName: 'audit-log',
  };
  return (
    <>
      <ResourcePage config={config} />
      <Modal open={!!open} onClose={() => setOpen(null)} size="xl" title={`${open?.table_name ?? ''} · ${open ? t(`audit.${open.action}`) : ''}`}>
        {open && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50"><tr><th className="px-2 py-1 text-start">Field</th><th className="px-2 py-1 text-start">Before</th><th className="px-2 py-1 text-start">After</th></tr></thead>
              <tbody>
                {[...new Set([...Object.keys(open.old_data ?? {}), ...Object.keys(open.new_data ?? {})])].map((k) => {
                  const a = JSON.stringify(open.old_data?.[k] ?? null);
                  const b = JSON.stringify(open.new_data?.[k] ?? null);
                  return (
                    <tr key={k} className={a !== b ? 'bg-amber-50' : ''}>
                      <td className="px-2 py-1 font-mono">{k}</td>
                      <td className="max-w-xs break-all px-2 py-1 font-mono text-slate-600" dir="ltr">{a}</td>
                      <td className="max-w-xs break-all px-2 py-1 font-mono" dir="ltr">{b}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
