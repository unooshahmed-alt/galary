import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { calculatePayroll, validateRule, type WageRuleConfig } from '@engine';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { fetchAll, insertRow, rpc, updateRow, useAsync, errorText, type Row } from '@/lib/db';
import { money, date as fmtDate, dname, isoDate } from '@/lib/format';
import { Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, PageHeader, Select, Spinner, StatusBadge } from '@/components/ui';
import { RefSelect, useOptions } from '@/components/RefSelect';
import { Modal, useConfirm } from '@/components/Modal';
import { DataTable } from '@/components/DataTable';
import { useToast } from '@/components/Toast';

const BASES = ['gross_income', 'net_trip_profit', 'fixed_pool', 'custom_amount'] as const;
const METHODS = ['equal', 'percentage', 'role', 'fixed', 'attendance', 'combined'] as const;
const ROLES = ['captain', 'engineer', 'fisherman', 'cook', 'deckhand', 'other'];

export const DEFAULT_RULE: WageRuleConfig = {
  base: 'net_trip_profit', method: 'role', crewSharePercent: 50,
  roleWeights: { captain: 2, engineer: 1.5, fisherman: 1, cook: 1, deckhand: 1, other: 1 },
  rounding: { mode: 'nearest', increment: 1 }, advanceRecovery: 'up_to_available',
  attendance: { enabled: false, mode: 'proportional', paidStatuses: ['present'], forfeitTo: 'owner' },
};

export default function WageRules() {
  const { t, lang } = useI18n();
  const { can } = useAuth();
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [params, setParams] = useSearchParams();
  const boat = params.get('boat');
  const [tick, setTick] = useState(0);
  const [newRule, setNewRule] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ ruleId: string; version?: Row; base?: WageRuleConfig } | null>(null);

  const rules = useAsync(() => (boat ? fetchAll('wage_rules', { filters: [['boat_id', 'eq', boat]], sort: { column: 'created_at', ascending: true } }) : Promise.resolve([])), [boat, tick]);
  const versions = useAsync(() => (boat ? fetchAll('v_wage_rule_versions', { filters: [['boat_id', 'eq', boat]], sort: { column: 'version', ascending: false } }) : Promise.resolve([])), [boat, tick]);

  const createRule = async () => {
    if (!newRule?.trim() || !boat) return;
    try {
      const r = await insertRow('wage_rules', { boat_id: boat, name: newRule.trim() });
      setNewRule(null);
      setTick((x) => x + 1);
      setEditor({ ruleId: r.id, base: DEFAULT_RULE });
    } catch (e) { toast.error(errorText(e, t)); }
  };

  const approve = async (v: Row) => {
    const r = await confirm({ title: `${t('wage.approveVersion')} v${v.version}`, message: t('wage.lockedNote'), reason: 'optional', tone: 'success' });
    if (r === null) return;
    try { await rpc('approve_wage_rule_version', { p_version: v.id, p_comment: r || null }); toast.success(t('common.success')); setTick((x) => x + 1); }
    catch (e) { toast.error(errorText(e, t)); }
  };

  return (
    <div>
      {dialog}
      <PageHeader title={t('wage.rulesTitle')} subtitle={t('wage.lockedNote')}
        actions={<div className="flex items-center gap-2">
          <div className="w-56"><RefSelect kind="boats" value={boat} onChange={(v) => setParams(v ? { boat: v } : {})} /></div>
          {boat && can('wage_rules.manage') && <Button variant="primary" icon="plus" onClick={() => setNewRule('')}>{t('wage.newRule')}</Button>}
        </div>} />
      {!boat ? <Alert tone="info">{t('attendance.selectBoat')}</Alert> : rules.loading ? <Spinner /> : (rules.data ?? []).length === 0 ? (
        <Card><EmptyState icon="scale" title={t('common.noRecords')} text={t('payroll.noRule')}
          action={can('wage_rules.manage') && <Button variant="primary" icon="plus" onClick={() => setNewRule('')}>{t('wage.newRule')}</Button>} /></Card>
      ) : (
        <div className="space-y-5">
          {(rules.data ?? []).map((rule) => {
            const vs = (versions.data ?? []).filter((v) => v.rule_id === rule.id);
            const latest = vs[0];
            return (
              <Card key={rule.id} title={<span className="flex items-center gap-2">{rule.name}{!rule.active && <Badge>{t('common.inactive')}</Badge>}</span>}
                actions={can('wage_rules.manage') && <>
                  <Button size="sm" icon="plus" onClick={() => setEditor({ ruleId: rule.id, base: latest?.config ?? DEFAULT_RULE })}>{t('wage.newVersion')}</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { await updateRow('wage_rules', rule.id, { active: !rule.active }); setTick((x) => x + 1); }}>
                    {rule.active ? t('users.deactivate') : t('users.activate')}</Button>
                </>} padded={false}>
                <DataTable rows={vs} columns={[
                  { key: 'version', label: t('common.version'), render: (r) => `v${r.version}` },
                  { key: 'effective_from', label: t('wage.effectiveFrom'), render: (r) => fmtDate(r.effective_from, lang) },
                  { key: 'effective_to', label: t('wage.effectiveTo'), render: (r) => fmtDate(r.effective_to, lang) },
                  { key: 'summary', label: t('wage.config'), render: (r) => <RuleSummary cfg={r.config} /> },
                  { key: 'status', label: t('common.status'), render: (r) => <StatusBadge status={r.status} /> },
                  { key: 'approved_by_name', label: t('common.approvedBy'), hideSm: true },
                  { key: '_a', label: '', render: (r) => (
                    <div className="flex gap-1">
                      {r.status !== 'approved' && can('wage_rules.manage') && <Button size="sm" icon="edit" onClick={() => setEditor({ ruleId: rule.id, version: r, base: r.config })}>{t('common.edit')}</Button>}
                      {r.status !== 'approved' && can('wage_rules.approve') && <Button size="sm" variant="success" icon="check" onClick={() => approve(r)}>{t('common.approve')}</Button>}
                      {r.status === 'approved' && <Button size="sm" variant="ghost" icon="eye" onClick={() => setEditor({ ruleId: rule.id, version: r, base: r.config })}>{t('common.view')}</Button>}
                    </div>) },
                ]} />
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={newRule !== null} onClose={() => setNewRule(null)} title={t('wage.newRule')} size="sm"
        footer={<><Button onClick={() => setNewRule(null)}>{t('common.cancel')}</Button><Button variant="primary" disabled={!newRule?.trim()} onClick={createRule}>{t('common.create')}</Button></>}>
        <Field label={t('wage.ruleName')} required><Input value={newRule ?? ''} onChange={(e) => setNewRule(e.target.value)} placeholder="e.g. Standard share 2026" /></Field>
      </Modal>

      {editor && boat && <RuleEditor boatId={boat} {...editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setTick((x) => x + 1); }} />}
    </div>
  );
}

export function RuleSummary({ cfg }: { cfg: WageRuleConfig }) {
  const { t } = useI18n();
  if (!cfg) return null;
  return (
    <div className="text-xs text-slate-600">
      <div>{t(`wage.bases.${cfg.base}`)} · {cfg.crewSharePercent ?? 100}%</div>
      <div>{t(`wage.methods.${cfg.method}`)}{cfg.attendance?.enabled ? ` · ${t('wage.attendance')}` : ''}</div>
    </div>
  );
}

function RuleEditor({ boatId, ruleId, version, base, onClose, onSaved }: {
  boatId: string; ruleId: string; version?: Row; base?: WageRuleConfig; onClose: () => void; onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const { currency } = useAuth();
  const toast = useToast();
  const readOnly = version?.status === 'approved';
  const [cfg, setCfg] = useState<WageRuleConfig>(() => JSON.parse(JSON.stringify(base ?? DEFAULT_RULE)));
  const [from, setFrom] = useState<string>(version?.effective_from ?? isoDate());
  const [sample, setSample] = useState({ income: 20000, expenses: 6000 });
  const [busy, setBusy] = useState(false);
  const crew = useOptions('crew', { boatId });
  const cats = useOptions('expenseCategories');
  const set = (p: Partial<WageRuleConfig>) => setCfg((c) => ({ ...c, ...p }));
  const errors = validateRule(cfg);
  const usesPct = cfg.method === 'percentage' || (cfg.method === 'combined' && cfg.combined?.shareBy === 'percentage');
  const usesRoles = cfg.method === 'role' || cfg.method === 'attendance' || (cfg.method === 'combined' && (cfg.combined?.shareBy ?? 'role') === 'role');
  const usesFixed = cfg.method === 'fixed' || cfg.method === 'combined';
  const pctTotal = Object.values(cfg.percentages ?? {}).reduce((s, v) => s + Number(v || 0), 0);

  const preview = useMemo(() => {
    if (!crew.rows.length || errors.length) return null;
    return calculatePayroll({
      payroll: { customBaseAmount: sample.income },
      rule: cfg,
      financials: { fishSales: sample.income, otherIncome: 0, grossIncome: sample.income, expenses: sample.expenses },
      crew: crew.rows.map((c) => ({ id: c.id, code: c.crew_code, nameEn: c.name_en, nameDv: c.name_dv, role: c.current_role ?? c.job_role, daysPresent: 10, daysEligible: 10 })),
    });
  }, [cfg, crew.rows, sample, errors.length]);

  const save = async (submit: boolean) => {
    if (errors.length) return;
    setBusy(true);
    try {
      const payload = { rule_id: ruleId, effective_from: from, config: cfg, status: submit ? 'pending_approval' : 'draft' };
      if (version) await updateRow('wage_rule_versions', version.id, { effective_from: from, config: cfg });
      else await insertRow('wage_rule_versions', payload);
      toast.success(t('common.success'));
      onSaved();
    } catch (e) { toast.error(errorText(e, t)); } finally { setBusy(false); }
  };

  const numIn = (value: unknown, onChange: (n: number | undefined) => void, step = '0.01') => (
    <Input type="number" step={step} value={value === undefined || value === null ? '' : String(value)} disabled={readOnly}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  );

  return (
    <Modal open onClose={onClose} size="xl" title={`${t('wage.config')}${version ? ` · v${version.version}` : ` · ${t('wage.newVersion')}`}`}
      footer={!readOnly ? <>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={busy} disabled={!!errors.length} onClick={() => save(false)}>{t('common.save')} ({t('status.draft')})</Button>
        {!version && <Button variant="primary" loading={busy} disabled={!!errors.length} onClick={() => save(true)}>{t('common.submitForApproval')}</Button>}
      </> : <Button onClick={onClose}>{t('common.close')}</Button>}>
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {readOnly && <Alert tone="info">{t('wage.lockedNote')}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('wage.effectiveFrom')} required><Input type="date" value={from} disabled={readOnly} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={t('wage.base')} required>
              <Select value={cfg.base} disabled={readOnly} onChange={(e) => set({ base: e.target.value as WageRuleConfig['base'] })}>
                {BASES.map((b) => <option key={b} value={b}>{t(`wage.bases.${b}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('wage.crewShare')}>{numIn(cfg.crewSharePercent, (n) => set({ crewSharePercent: n }))}</Field>
            {cfg.base === 'fixed_pool' && <Field label={t('wage.fixedPool')} required>{numIn(cfg.fixedPoolAmount, (n) => set({ fixedPoolAmount: n }))}</Field>}
            <Field label={t('wage.method')} required>
              <Select value={cfg.method} disabled={readOnly} onChange={(e) => set({ method: e.target.value as WageRuleConfig['method'] })}>
                {METHODS.map((m) => <option key={m} value={m}>{t(`wage.methods.${m}`)}</option>)}
              </Select>
            </Field>
            {cfg.method === 'combined' && (
              <Field label={t('wage.combinedShareBy')}>
                <Select value={cfg.combined?.shareBy ?? 'role'} disabled={readOnly} onChange={(e) => set({ combined: { shareBy: e.target.value as 'equal' | 'role' | 'percentage' } })}>
                  <option value="equal">{t('wage.methods.equal')}</option><option value="role">{t('wage.methods.role')}</option><option value="percentage">{t('wage.methods.percentage')}</option>
                </Select>
              </Field>
            )}
          </div>

          {cfg.base === 'net_trip_profit' && (
            <Field label={t('wage.excludedCategories')}>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {cats.rows.map((c) => (
                  <Checkbox key={c.id} label={dname(c.name_en, c.name_dv, lang)} disabled={readOnly}
                    checked={(cfg.excludedExpenseCategories ?? []).includes(c.code)}
                    onChange={(on) => set({ excludedExpenseCategories: on ? [...(cfg.excludedExpenseCategories ?? []), c.code] : (cfg.excludedExpenseCategories ?? []).filter((x) => x !== c.code) })} />
                ))}
              </div>
            </Field>
          )}

          <Field label={t('wage.eligibleCrew')}>
            <div className="grid max-h-40 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
              {crew.rows.map((c) => (
                <Checkbox key={c.id} label={`${c.crew_code} · ${dname(c.name_en, c.name_dv, lang)}`} disabled={readOnly}
                  checked={(cfg.eligibleCrewIds ?? []).includes(c.id)}
                  onChange={(on) => set({ eligibleCrewIds: on ? [...(cfg.eligibleCrewIds ?? []), c.id] : (cfg.eligibleCrewIds ?? []).filter((x) => x !== c.id) })} />
              ))}
            </div>
          </Field>

          {(usesPct || usesFixed) && (
            <div className="rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2 text-start">{t('common.crewMember')}</th>
                  {usesPct && <th className="px-3 py-2 text-end">{t('wage.percentages')}</th>}{usesFixed && <th className="px-3 py-2 text-end">{t('wage.fixedWages')}</th>}</tr></thead>
                <tbody>
                  {crew.rows.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100">
                      <td className="px-3 py-1.5">{c.crew_code} · {dname(c.name_en, c.name_dv, lang)}</td>
                      {usesPct && <td className="w-32 px-3 py-1.5">{numIn(cfg.percentages?.[c.id], (n) => set({ percentages: { ...(cfg.percentages ?? {}), [c.id]: n ?? 0 } }))}</td>}
                      {usesFixed && <td className="w-36 px-3 py-1.5">{numIn(cfg.fixedWages?.[c.id], (n) => { const fw = { ...(cfg.fixedWages ?? {}) }; if (n === undefined) delete fw[c.id]; else fw[c.id] = n; set({ fixedWages: fw }); })}</td>}
                    </tr>
                  ))}
                </tbody>
                {usesPct && <tfoot><tr className="border-t"><td className="px-3 py-1.5 font-medium">{t('common.total')}</td><td className={`px-3 py-1.5 text-end font-semibold ${pctTotal > 100 ? 'text-coral-600' : ''}`}>{pctTotal.toFixed(2)}%</td>{usesFixed && <td />}</tr></tfoot>}
              </table>
            </div>
          )}

          {(usesRoles || usesFixed) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {usesRoles && (
                <Field label={t('wage.roleWeights')}>
                  <div className="space-y-1.5">
                    {ROLES.map((r) => <div key={r} className="flex items-center gap-2"><span className="w-32 text-sm">{t(`jobRoles.${r}`)}</span>{numIn(cfg.roleWeights?.[r], (n) => set({ roleWeights: { ...(cfg.roleWeights ?? {}), [r]: n ?? 1 } }), '0.25')}</div>)}
                  </div>
                </Field>
              )}
              {usesFixed && (
                <Field label={t('wage.roleFixedWages')}>
                  <div className="space-y-1.5">
                    {ROLES.map((r) => <div key={r} className="flex items-center gap-2"><span className="w-32 text-sm">{t(`jobRoles.${r}`)}</span>{numIn(cfg.roleFixedWages?.[r], (n) => { const rf = { ...(cfg.roleFixedWages ?? {}) }; if (n === undefined) delete rf[r]; else rf[r] = n; set({ roleFixedWages: rf }); })}</div>)}
                  </div>
                </Field>
              )}
            </div>
          )}

          <div className="space-y-3 rounded-lg border border-slate-200 p-3">
            <Checkbox label={t('wage.attendanceEnabled')} disabled={readOnly || cfg.method === 'attendance'} checked={!!cfg.attendance?.enabled || cfg.method === 'attendance'}
              onChange={(on) => set({ attendance: { ...(cfg.attendance ?? {}), enabled: on } })} />
            {(cfg.attendance?.enabled || cfg.method === 'attendance') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('wage.attendanceMode')}>
                  <Select value={cfg.attendance?.mode ?? 'proportional'} disabled={readOnly} onChange={(e) => set({ attendance: { ...(cfg.attendance ?? { enabled: true }), mode: e.target.value as 'proportional' | 'per_day' } })}>
                    <option value="proportional">{t('wage.proportional')}</option>
                    {cfg.method === 'attendance' && <option value="per_day">{t('wage.perDay')}</option>}
                  </Select>
                </Field>
                {cfg.attendance?.mode === 'per_day' && cfg.method === 'attendance' && <Field label={t('wage.dailyRate')}>{numIn(cfg.attendance?.dailyRate, (n) => set({ attendance: { ...(cfg.attendance ?? { enabled: true }), dailyRate: n } }))}</Field>}
                {cfg.method !== 'attendance' && (
                  <Field label={t('wage.forfeitTo')}>
                    <Select value={cfg.attendance?.forfeitTo ?? 'owner'} disabled={readOnly} onChange={(e) => set({ attendance: { ...(cfg.attendance ?? { enabled: true }), forfeitTo: e.target.value as 'owner' | 'crew' } })}>
                      <option value="owner">{t('wage.forfeitOwner')}</option><option value="crew">{t('wage.forfeitCrew')}</option>
                    </Select>
                  </Field>
                )}
                <Field label={t('wage.paidStatuses')} className="sm:col-span-2">
                  <div className="flex flex-wrap gap-4">
                    {(['present', 'sick_leave', 'approved_leave'] as const).map((s) => (
                      <Checkbox key={s} label={t(`attendanceStatus.${s}`)} disabled={readOnly || s === 'present'}
                        checked={(cfg.attendance?.paidStatuses ?? ['present']).includes(s)}
                        onChange={(on) => {
                          const cur = cfg.attendance?.paidStatuses ?? ['present'];
                          set({ attendance: { ...(cfg.attendance ?? { enabled: true }), paidStatuses: on ? [...cur, s] : cur.filter((x) => x !== s) } });
                        }} />
                    ))}
                  </div>
                </Field>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('wage.roundingMode')}>
              <Select value={cfg.rounding?.mode ?? 'nearest'} disabled={readOnly} onChange={(e) => set({ rounding: { ...(cfg.rounding ?? {}), mode: e.target.value as 'none' } })}>
                {(['none', 'nearest', 'down', 'up'] as const).map((m) => <option key={m} value={m}>{t(`wage.roundingModes.${m}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('wage.increment')}>
              <Select value={String(cfg.rounding?.increment ?? 1)} disabled={readOnly || cfg.rounding?.mode === 'none'} onChange={(e) => set({ rounding: { mode: cfg.rounding?.mode ?? 'nearest', increment: Number(e.target.value) } })}>
                {[0.01, 1, 5, 10, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label={t('wage.advanceRecovery')}>
              <Select value={cfg.advanceRecovery ?? 'up_to_available'} disabled={readOnly} onChange={(e) => set({ advanceRecovery: e.target.value as 'full' })}>
                <option value="up_to_available">{t('wage.upToAvailable')}</option><option value="full">{t('wage.full')}</option>
              </Select>
            </Field>
          </div>
          <Checkbox label={t('wage.allowExceed')} disabled={readOnly} checked={!!cfg.allowExceedPool} onChange={(on) => set({ allowExceedPool: on })} />
          {errors.length > 0 && <Alert tone="error" title={t('wage.validation')}>{errors.map((e) => <div key={e.code}>{e.message}</div>)}</Alert>}
        </div>

        <div className="lg:col-span-2">
          <div className="sticky top-0 space-y-3 rounded-xl bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-700">{t('wage.preview')}</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('dashboard.income')}><Input type="number" value={sample.income} onChange={(e) => setSample({ ...sample, income: Number(e.target.value) })} /></Field>
              <Field label={t('dashboard.expense')}><Input type="number" value={sample.expenses} onChange={(e) => setSample({ ...sample, expenses: Number(e.target.value) })} /></Field>
            </div>
            {!preview ? <div className="text-xs text-slate-500">{crew.loading ? '…' : t('common.noRecords')}</div> : (
              <div className="space-y-2 text-sm">
                <div className="text-xs text-slate-600">{preview.summary.baseFormula}</div>
                <div className="flex justify-between"><span>{t('payroll.pool')}</span><b dir="ltr">{money(preview.summary.crewPool, currency)}</b></div>
                <div className="flex justify-between"><span>{t('payroll.ownerAllocation')}</span><b dir="ltr">{money(preview.summary.ownerAllocation, currency)}</b></div>
                <ul className="divide-y divide-slate-200 rounded-lg bg-white">
                  {preview.crew.map((c) => (
                    <li key={c.crewId} className="flex justify-between px-3 py-1.5 text-xs">
                      <span>{dname(c.nameEn, c.nameDv, lang)} <span className="text-slate-400">({t(`jobRoles.${c.role}`)})</span></span>
                      <b dir="ltr">{money(c.gross, currency)}</b>
                    </li>
                  ))}
                </ul>
                {preview.errors.map((e) => <Alert key={e.code} tone="error">{e.message}</Alert>)}
                {preview.warnings.filter((w) => !w.crewId).map((w) => <Alert key={w.code} tone="warn">{w.message}</Alert>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
