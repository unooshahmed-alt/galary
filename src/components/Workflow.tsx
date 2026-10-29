import { Button } from './ui';
import { useConfirm } from './Modal';
import { useToast } from './Toast';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { rpc, errorText, fetchAll, useAsync, type Row } from '@/lib/db';
import { dateTime } from '@/lib/format';
import { Spinner } from './ui';

type ApprovableTable = 'crew_bonuses' | 'cash_advances' | 'fish_taken' | 'payroll_adjustments';
const APPROVE_PERM: Record<ApprovableTable, string> = {
  crew_bonuses: 'bonuses.approve', cash_advances: 'advances.approve', fish_taken: 'fish_taken.approve', payroll_adjustments: 'adjustments.approve',
};
const MANAGE_PERM: Record<ApprovableTable, string> = {
  crew_bonuses: 'bonuses.manage', cash_advances: 'advances.manage', fish_taken: 'fish_taken.manage', payroll_adjustments: 'adjustments.manage',
};

/** Submit / approve / reject / void buttons for approvable payroll inputs. */
export function RecordActions({ table, row, onDone, size = 'sm' }: { table: ApprovableTable; row: Row; onDone: () => void; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const act = async (action: 'submit' | 'approve' | 'reject' | 'void') => {
    const needsReason = action === 'reject' || action === 'void';
    const r = await confirm({
      title: t(`common.${action === 'submit' ? 'submitForApproval' : action}`),
      reason: needsReason ? true : 'optional',
      tone: action === 'approve' ? 'success' : needsReason ? 'danger' : 'primary',
    });
    if (r === null) return;
    try {
      await rpc('set_record_status', { p_table: table, p_id: row.id, p_action: action, p_comment: r || null });
      toast.success(t('common.success'));
      onDone();
    } catch (e) { toast.error(errorText(e, t)); }
  };
  const s = row.status;
  return (
    <div className="flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
      {dialog}
      {(s === 'draft' || s === 'rejected') && can(MANAGE_PERM[table]) && <Button size={size} onClick={() => act('submit')}>{t('common.submit')}</Button>}
      {(s === 'draft' || s === 'pending_approval') && can(APPROVE_PERM[table]) && <Button size={size} variant="success" icon="check" onClick={() => act('approve')}>{t('common.approve')}</Button>}
      {s === 'pending_approval' && can(APPROVE_PERM[table]) && <Button size={size} onClick={() => act('reject')}>{t('common.reject')}</Button>}
      {s === 'approved' && can(APPROVE_PERM[table]) && <Button size={size} variant="ghost" onClick={() => act('void')}>{t('common.void')}</Button>}
    </div>
  );
}

/** Timeline of approvals / workflow actions for one record. */
export function ApprovalHistory({ entityType, entityId, reloadKey }: { entityType: string; entityId: string; reloadKey?: unknown }) {
  const { t, lang } = useI18n();
  const h = useAsync(() => fetchAll('v_approvals', { filters: [['entity_type', 'eq', entityType], ['entity_id', 'eq', entityId]], sort: { column: 'acted_at', ascending: true } }), [entityType, entityId, reloadKey]);
  if (h.loading) return <Spinner />;
  if (!h.data?.length) return <div className="text-sm text-slate-500">{t('common.noRecords')}</div>;
  return (
    <ol className="relative space-y-3 border-s border-slate-200 ps-4">
      {h.data.map((a) => (
        <li key={a.id} className="text-sm">
          <span className="absolute -start-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white bg-ocean-500" />
          <div className="font-medium text-slate-800">{actionLabel(a.action, t)}</div>
          <div className="text-xs text-slate-500">{dateTime(a.acted_at, lang)} · {a.acted_by_name ?? ''}</div>
          {a.comment && <div className="mt-0.5 text-slate-600">{a.comment}</div>}
        </li>
      ))}
    </ol>
  );
}

function actionLabel(action: string, t: (k: string) => string): string {
  if (action.startsWith('status:')) return t(`status.${action.slice(7)}`);
  const map: Record<string, string> = {
    submitted: 'common.submitForApproval', approved: 'status.approved', rejected: 'status.rejected', returned: 'bills.returned',
    voided: 'status.voided', finalized: 'status.finalized', reversed: 'status.reversed', calculated: 'status.calculated',
    submit: 'common.submitForApproval', approve: 'status.approved', reject: 'status.rejected', void: 'status.voided', reissued: 'slip.reissue',
  };
  return map[action] ? t(map[action]) : action;
}
