/**
 * Galary wage calculation engine.
 *
 * Pure, dependency-free TypeScript shared by the `payroll` edge function
 * (authoritative calculation) and the web app (previews / explanations).
 * All money is handled in laari (integer hundredths) to avoid float drift.
 *
 * Order of operations
 *  1. Base       = chosen basis (gross income, net trip profit, fixed pool or custom amount)
 *  2. Crew pool  = Base × crewSharePercent  (0 if base ≤ 0)
 *  3. Crew shares by method (equal / percentage / role / fixed / attendance / combined)
 *     with optional attendance adjustment and rounding
 *  4. Owner allocation = Base − crew shares distributed
 *  5. Owner-funded bonuses come out of the owner allocation (never out of crew wages)
 *  6. Gross = shares + bonus + approved earning adjustments
 *  7. Deductions (each record used once): carried-forward balances, other deductions,
 *     fish taken, then cash advances (oldest first, carried forward if not covered)
 *  8. Net = Gross − deductions (never below 0; any shortfall is a negative balance
 *     carried forward to the next payroll)
 */

export type WageBase = 'gross_income' | 'net_trip_profit' | 'fixed_pool' | 'custom_amount';
export type WageMethod = 'equal' | 'percentage' | 'role' | 'fixed' | 'attendance' | 'combined';
export type RoundingMode = 'none' | 'nearest' | 'down' | 'up';
export type PaidStatus = 'present' | 'sick_leave' | 'approved_leave';

export interface WageRuleConfig {
  base: WageBase;
  method: WageMethod;
  /** % of the base that forms the crew wage pool (default 100). */
  crewSharePercent?: number;
  /** Amount of the pool when base = fixed_pool. */
  fixedPoolAmount?: number;
  /** Expense category codes NOT deducted when base = net_trip_profit. */
  excludedExpenseCategories?: string[];
  /** Restrict to these crew ids (default: everyone on the trip / boat). */
  eligibleCrewIds?: string[];
  excludedCrewIds?: string[];
  /** method = percentage (or combined.shareBy = percentage): crewId → % of pool. */
  percentages?: Record<string, number>;
  /** method = role / combined: role → weight (default 1). */
  roleWeights?: Record<string, number>;
  /** Per-person weight overrides (crewId → weight). */
  crewWeights?: Record<string, number>;
  /** method = fixed / combined: crewId → fixed amount, or role → fixed amount. */
  fixedWages?: Record<string, number>;
  roleFixedWages?: Record<string, number>;
  attendance?: {
    enabled: boolean;
    /** proportional: share × paid days / eligible days. per_day: dailyRate × paid days. */
    mode?: 'proportional' | 'per_day';
    dailyRate?: number;
    roleDailyRates?: Record<string, number>;
    paidStatuses?: PaidStatus[];
    /** Where wages forfeited through absence go (proportional mode). */
    forfeitTo?: 'crew' | 'owner';
  };
  combined?: { shareBy?: 'equal' | 'role' | 'percentage' };
  rounding?: { mode: RoundingMode; increment?: number };
  /** Explicitly approved arrangement allowing allocations above the pool. */
  allowExceedPool?: boolean;
  advanceRecovery?: 'up_to_available' | 'full';
}

export interface CrewInput {
  id: string;
  code?: string | null;
  nameEn?: string | null;
  nameDv?: string | null;
  role?: string | null;
  daysPresent: number;
  daysSick?: number;
  daysLeave?: number;
  daysAbsent?: number;
  daysEligible: number;
}

export interface BonusInput { id: string; crewId: string; kind: 'percent' | 'fixed'; percent?: number | null; fixedAmount?: number | null }
export interface AdvanceInput { id: string; code?: string; crewId: string; date: string; amount: number; outstanding: number; maxPerPeriod?: number | null }
export interface FishTakenInput {
  id: string; code?: string; crewId: string; date: string; fishTypeEn?: string; fishTypeDv?: string;
  quantity: number; unit: string; unitPrice: number; total: number;
}
export interface AdjustmentInput { id: string; code?: string; crewId: string; kind: 'earning' | 'deduction' | 'carry_forward'; amount: number; reason: string; date?: string }

export interface PayrollInputs {
  payroll: { id?: string; code?: string; customBaseAmount?: number | null; periodStart?: string; periodEnd?: string };
  rule: WageRuleConfig;
  financials: { fishSales: number; otherIncome: number; grossIncome: number; expenses: number; expensesByCategory?: Record<string, number> };
  crew: CrewInput[];
  bonuses?: BonusInput[];
  advances?: AdvanceInput[];
  fishTaken?: FishTakenInput[];
  adjustments?: AdjustmentInput[];
}

export interface CrewResult {
  crewId: string;
  code?: string | null;
  nameEn?: string | null;
  nameDv?: string | null;
  role: string;
  daysPresent: number;
  daysEligible: number;
  shareWeight: number;
  ordinaryWage: number;
  percentageShare: number;
  fixedWage: number;
  attendanceAdjustment: number;
  bonus: number;
  otherEarnings: number;
  gross: number;
  advanceDeduction: number;
  fishDeduction: number;
  otherDeductions: number;
  carryForwardDeduction: number;
  totalDeductions: number;
  net: number;
  unrecoveredAdvance: number;
  negativeBalance: number;
  details: {
    formula: string[];
    advances: { id: string; code?: string; date: string; outstandingBefore: number; amount: number; outstandingAfter: number }[];
    fishTaken: { id: string; code?: string; date: string; fishTypeEn?: string; fishTypeDv?: string; quantity: number; unit: string; unitPrice: number; amount: number }[];
    adjustments: { id: string; code?: string; kind: string; amount: number; reason: string }[];
    bonus?: { id: string; kind: string; percent?: number | null; amount: number };
  };
}

export interface EngineMessage { code: string; message: string; crewId?: string; data?: Record<string, unknown> }

export interface EngineResult {
  summary: {
    baseAmount: number;
    baseFormula: string;
    crewSharePercent: number;
    crewPool: number;
    crewDistributed: number;
    ownerAllocation: number;
    totalBonuses: number;
    ownerRemaining: number;
    roundingDifference: number;
    totalGross: number;
    totalDeductions: number;
    totalNet: number;
    totalUnrecoveredAdvances: number;
    totalNegativeBalances: number;
  };
  crew: CrewResult[];
  bonuses: { id: string; crewId: string; amount: number }[];
  warnings: EngineMessage[];
  errors: EngineMessage[];
}

// ---------------------------------------------------------------------------
// Money helpers (laari = integer hundredths)
// ---------------------------------------------------------------------------
export const toL = (v: number | null | undefined): number => Math.round((Number(v) || 0) * 100);
export const fromL = (l: number): number => Math.round(l) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function roundTo(l: number, incL: number, mode: RoundingMode): number {
  if (mode === 'none' || incL <= 1) return Math.round(l);
  const q = l / incL;
  if (mode === 'down') return Math.floor(q + 1e-9) * incL;
  if (mode === 'up') return Math.ceil(q - 1e-9) * incL;
  return Math.round(q) * incL;
}

/**
 * Split `totalL` by `weights`, rounding each part to `incL`.
 * nearest → largest-remainder method (parts never exceed the total);
 * down → floor (residual stays with the owner); up → ceil (may exceed, reported).
 */
export function splitByWeights(totalL: number, weights: number[], incL: number, mode: RoundingMode): number[] {
  const wsum = sum(weights);
  if (totalL <= 0 || wsum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (totalL * w) / wsum);
  const inc = Math.max(1, incL);
  if (mode === 'up') return exact.map((x) => Math.ceil(x / inc - 1e-9) * inc);
  if (mode === 'down') return exact.map((x) => Math.floor(x / inc + 1e-9) * inc);
  // nearest / none: largest remainder at the increment
  const floors = exact.map((x) => Math.floor(x / inc + 1e-9) * inc);
  let remaining = Math.floor((totalL - sum(floors)) / inc + 1e-9);
  const order = exact
    .map((x, i) => ({ i, r: x - floors[i], w: weights[i] }))
    .filter((o) => o.w > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < order.length && remaining > 0; k++, remaining--) floors[order[k].i] += inc;
  return floors;
}

function paidDays(c: CrewInput, statuses: PaidStatus[]): number {
  let d = 0;
  if (statuses.includes('present')) d += c.daysPresent || 0;
  if (statuses.includes('sick_leave')) d += c.daysSick || 0;
  if (statuses.includes('approved_leave')) d += c.daysLeave || 0;
  return d;
}

const roleOf = (c: CrewInput) => (c.role || 'fisherman').toLowerCase();

// ---------------------------------------------------------------------------
// Validation of a rule (used by the rule editor and the engine)
// ---------------------------------------------------------------------------
export function validateRule(rule: WageRuleConfig): EngineMessage[] {
  const errors: EngineMessage[] = [];
  const bases: WageBase[] = ['gross_income', 'net_trip_profit', 'fixed_pool', 'custom_amount'];
  const methods: WageMethod[] = ['equal', 'percentage', 'role', 'fixed', 'attendance', 'combined'];
  if (!bases.includes(rule.base)) errors.push({ code: 'invalid_base', message: 'Choose how the wage base is calculated' });
  if (!methods.includes(rule.method)) errors.push({ code: 'invalid_method', message: 'Choose a wage method' });
  const pct = rule.crewSharePercent ?? 100;
  if (pct < 0 || pct > 100) errors.push({ code: 'invalid_share', message: 'Crew share must be between 0 and 100%' });
  if (rule.base === 'fixed_pool' && !(Number(rule.fixedPoolAmount) > 0))
    errors.push({ code: 'missing_pool', message: 'Enter the fixed wage pool amount' });
  const usesPct = rule.method === 'percentage' || (rule.method === 'combined' && rule.combined?.shareBy === 'percentage');
  if (usesPct) {
    const total = sum(Object.values(rule.percentages || {}).map(Number));
    if (Object.values(rule.percentages || {}).some((v) => Number(v) < 0))
      errors.push({ code: 'negative_percent', message: 'Percentages cannot be negative' });
    if (total > 100 + 1e-9 && !rule.allowExceedPool)
      errors.push({ code: 'percent_exceeds_pool', message: `Percentage allocations total ${total}% which exceeds 100% of the pool`, data: { total } });
  }
  if (rule.method === 'attendance' && rule.attendance?.mode === 'per_day' && !(Number(rule.attendance?.dailyRate) > 0) &&
      !Object.keys(rule.attendance?.roleDailyRates || {}).length)
    errors.push({ code: 'missing_daily_rate', message: 'Enter a daily rate for per-day attendance wages' });
  if (rule.rounding && rule.rounding.mode !== 'none' && !(Number(rule.rounding.increment ?? 1) > 0))
    errors.push({ code: 'invalid_rounding', message: 'Rounding increment must be positive' });
  return errors;
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------
export function calculatePayroll(input: PayrollInputs): EngineResult {
  const rule = input.rule;
  const warnings: EngineMessage[] = [];
  const errors: EngineMessage[] = [...validateRule(rule)];
  const rounding = rule.rounding ?? { mode: 'nearest' as RoundingMode, increment: 0.01 };
  const incL = Math.max(1, toL(rounding.increment ?? 0.01));
  const mode: RoundingMode = rounding.mode ?? 'nearest';
  const fin = input.financials;

  // 1. Base -----------------------------------------------------------------
  let baseL = 0;
  let baseFormula = '';
  const grossL = toL(fin.fishSales) + toL(fin.otherIncome);
  if (rule.base === 'gross_income') {
    baseL = grossL;
    baseFormula = `Gross income ${fromL(grossL)} (fish sales ${fin.fishSales} + other income ${fin.otherIncome})`;
  } else if (rule.base === 'net_trip_profit') {
    const excluded = sum((rule.excludedExpenseCategories || []).map((c) => toL(fin.expensesByCategory?.[c] ?? 0)));
    const expL = toL(fin.expenses) - excluded;
    baseL = grossL - expL;
    baseFormula = `Net profit ${fromL(baseL)} = gross income ${fromL(grossL)} − expenses ${fromL(expL)}` +
      (excluded ? ` (excluding ${fromL(excluded)} in ${rule.excludedExpenseCategories!.join(', ')})` : '');
  } else if (rule.base === 'fixed_pool') {
    baseL = toL(rule.fixedPoolAmount);
    baseFormula = `Fixed wage pool ${fromL(baseL)}`;
  } else if (rule.base === 'custom_amount') {
    if (input.payroll.customBaseAmount == null) {
      errors.push({ code: 'missing_custom_base', message: 'Enter the agreed base amount on the payroll' });
    }
    baseL = toL(input.payroll.customBaseAmount ?? 0);
    baseFormula = `Agreed base amount ${fromL(baseL)}`;
  }

  // 2. Pool -------------------------------------------------------------------
  const sharePct = rule.crewSharePercent ?? 100;
  let poolL = baseL > 0 ? Math.round((baseL * sharePct) / 100) : 0;
  if (baseL <= 0) warnings.push({ code: 'non_positive_base', message: `The wage base is ${fromL(baseL)}; the crew share pool is 0`, data: { base: fromL(baseL) } });

  // Eligible crew -----------------------------------------------------------
  let crew = [...input.crew];
  if (rule.eligibleCrewIds?.length) crew = crew.filter((c) => rule.eligibleCrewIds!.includes(c.id));
  if (rule.excludedCrewIds?.length) crew = crew.filter((c) => !rule.excludedCrewIds!.includes(c.id));
  if (!crew.length) errors.push({ code: 'no_crew', message: 'No eligible crew members for this payroll' });

  const att = rule.attendance;
  const attEnabled = !!att?.enabled || rule.method === 'attendance';
  const paid = att?.paidStatuses?.length ? att.paidStatuses : (['present'] as PaidStatus[]);
  const ratio = (c: CrewInput) => {
    if (!attEnabled) return 1;
    if (!(c.daysEligible > 0)) return 0;
    return Math.min(1, paidDays(c, paid) / c.daysEligible);
  };
  for (const c of crew) {
    if (attEnabled && c.daysEligible > 0 && paidDays(c, paid) === 0)
      warnings.push({ code: 'no_attendance', message: 'No paid attendance recorded for this crew member', crewId: c.id });
  }

  const weightOf = (c: CrewInput, by: 'equal' | 'role'): number => {
    if (rule.crewWeights && rule.crewWeights[c.id] != null) return Number(rule.crewWeights[c.id]);
    if (by === 'role') return Number(rule.roleWeights?.[roleOf(c)] ?? rule.roleWeights?.[c.role || ''] ?? 1);
    return 1;
  };

  // 3. Shares -----------------------------------------------------------------
  const n = crew.length;
  const ordinary = new Array(n).fill(0);
  const pctShare = new Array(n).fill(0);
  const fixed = new Array(n).fill(0);
  const attAdj = new Array(n).fill(0);
  const weights = new Array(n).fill(0);
  const formula: string[][] = crew.map(() => []);

  const fixedFor = (c: CrewInput) =>
    toL(rule.fixedWages?.[c.id] ?? rule.roleFixedWages?.[roleOf(c)] ?? rule.roleFixedWages?.[c.role || ''] ?? 0);

  /** Split a pool by base weights with optional proportional attendance. Returns final + unadjusted. */
  const shareSplit = (amountL: number, baseWeights: number[], target: number[], label: string) => {
    const unadjusted = splitByWeights(amountL, baseWeights, incL, mode);
    if (!attEnabled || att?.mode === 'per_day') {
      unadjusted.forEach((v, i) => { target[i] += v; });
      crew.forEach((_, i) => {
        weights[i] = baseWeights[i];
        formula[i].push(`${label}: ${fromL(amountL)} × ${baseWeights[i]} / ${sum(baseWeights)} = ${fromL(unadjusted[i])}`);
      });
      return;
    }
    const ratios = crew.map(ratio);
    let finalL: number[];
    if ((att?.forfeitTo ?? 'owner') === 'crew') {
      finalL = splitByWeights(amountL, baseWeights.map((w, i) => w * ratios[i]), incL, mode);
    } else {
      finalL = unadjusted.map((u, i) => roundTo(u * ratios[i], incL, mode === 'up' ? 'up' : 'down'));
    }
    crew.forEach((c, i) => {
      target[i] += unadjusted[i];
      attAdj[i] += finalL[i] - unadjusted[i];
      weights[i] = baseWeights[i] * ratios[i];
      formula[i].push(`${label}: ${fromL(amountL)} × ${baseWeights[i]} / ${sum(baseWeights)} = ${fromL(unadjusted[i])}`);
      if (finalL[i] !== unadjusted[i])
        formula[i].push(`Attendance: ${paidDays(c, paid)} of ${c.daysEligible} days → ${fromL(finalL[i] - unadjusted[i])}`);
    });
  };

  const pctSplit = (amountL: number, target: number[]) => {
    const total = sum(Object.values(rule.percentages || {}).map(Number));
    crew.forEach((c, i) => {
      const p = Number(rule.percentages?.[c.id] ?? 0);
      const exact = (amountL * p) / 100;
      const r = roundTo(exact, incL, mode === 'nearest' || mode === 'none' ? 'down' : mode);
      const rat = ratio(c);
      const adj = attEnabled && att?.mode !== 'per_day' ? roundTo(r * rat, incL, 'down') - r : 0;
      target[i] += r;
      attAdj[i] += adj;
      weights[i] = p * rat;
      formula[i].push(`Percentage share: ${fromL(amountL)} × ${p}% = ${fromL(r)}`);
      if (adj) formula[i].push(`Attendance: ${paidDays(c, paid)} of ${c.daysEligible} days → ${fromL(adj)}`);
    });
    if (total < 100) warnings.push({ code: 'percent_unallocated', message: `${(100 - total).toFixed(2)}% of the pool is not allocated and stays with the owner`, data: { unallocated: 100 - total } });
  };

  if (n > 0) {
    switch (rule.method) {
      case 'equal':
        shareSplit(poolL, crew.map((c) => weightOf(c, 'equal')), ordinary, 'Equal share');
        break;
      case 'role':
        shareSplit(poolL, crew.map((c) => weightOf(c, 'role')), ordinary, 'Role share');
        break;
      case 'percentage':
        pctSplit(poolL, pctShare);
        break;
      case 'fixed':
        crew.forEach((c, i) => {
          fixed[i] = fixedFor(c);
          weights[i] = 1;
          formula[i].push(`Fixed wage: ${fromL(fixed[i])}`);
        });
        if (attEnabled && att?.mode !== 'per_day') {
          crew.forEach((c, i) => {
            const adj = roundTo(fixed[i] * ratio(c), incL, 'down') - fixed[i];
            attAdj[i] += adj;
            if (adj) formula[i].push(`Attendance: ${paidDays(c, paid)} of ${c.daysEligible} days → ${fromL(adj)}`);
          });
        }
        break;
      case 'attendance':
        if (att?.mode === 'per_day') {
          crew.forEach((c, i) => {
            const rateL = toL(att.roleDailyRates?.[roleOf(c)] ?? att.dailyRate ?? 0);
            const d = paidDays(c, paid);
            ordinary[i] = roundTo(rateL * d, incL, mode);
            weights[i] = d;
            formula[i].push(`Daily rate ${fromL(rateL)} × ${d} paid days = ${fromL(ordinary[i])}`);
          });
        } else {
          // pool split in proportion to (role weight ×) paid days
          const w = crew.map((c) => weightOf(c, rule.roleWeights ? 'role' : 'equal') * paidDays(c, paid));
          const parts = splitByWeights(poolL, w, incL, mode);
          crew.forEach((c, i) => {
            ordinary[i] = parts[i];
            weights[i] = w[i];
            formula[i].push(`Attendance share: ${fromL(poolL)} × ${w[i]} / ${sum(w)} weighted days = ${fromL(parts[i])}`);
          });
        }
        break;
      case 'combined': {
        crew.forEach((c, i) => {
          fixed[i] = fixedFor(c);
          if (fixed[i]) formula[i].push(`Fixed wage: ${fromL(fixed[i])}`);
        });
        const remaining = Math.max(0, poolL - sum(fixed));
        const by = rule.combined?.shareBy ?? 'role';
        if (by === 'percentage') pctSplit(remaining, pctShare);
        else shareSplit(remaining, crew.map((c) => weightOf(c, by)), ordinary, `Share of remaining pool (${by})`);
        if (sum(fixed) > poolL)
          warnings.push({ code: 'fixed_exceeds_pool_combined', message: 'Fixed wages use the whole pool; nothing remains to share' });
        break;
      }
    }
  }

  const crewDistributedL = sum(ordinary) + sum(pctShare) + sum(fixed) + sum(attAdj);
  if (crewDistributedL > poolL) {
    const msg = { code: 'allocation_exceeds_pool', message: `Crew wages ${fromL(crewDistributedL)} exceed the wage pool ${fromL(poolL)}`,
      data: { pool: fromL(poolL), allocated: fromL(crewDistributedL) } };
    const onlyRoundingUp = mode === 'up' && crewDistributedL - poolL <= n * incL;
    // fixed / per-day wages are not bounded by the pool: they need an explicitly approved arrangement
    if (rule.allowExceedPool || onlyRoundingUp) warnings.push(msg);
    else errors.push(msg);
  }

  // 4. Owner allocation ------------------------------------------------------
  const ownerAllocL = baseL - crewDistributedL;
  // Pool left undistributed purely because of rounding (stays with the owner allocation)
  let roundingDiffL = 0;
  if (n > 0 && poolL > 0 && rule.method !== 'fixed' && !(rule.method === 'attendance' && att?.mode === 'per_day')) {
    const usesPct = rule.method === 'percentage' || (rule.method === 'combined' && rule.combined?.shareBy === 'percentage');
    const fixedTotal = sum(fixed);
    const shareable = rule.method === 'combined' ? Math.max(0, poolL - fixedTotal) : poolL;
    const allocatedPct = usesPct ? Math.min(100, sum(crew.map((c) => Number(rule.percentages?.[c.id] ?? 0)))) : 100;
    const expected = (shareable * allocatedPct) / 100;
    roundingDiffL = Math.round(expected - (sum(ordinary) + sum(pctShare)));
  }

  // 5. Bonuses ----------------------------------------------------------------
  const bonusL = new Array(n).fill(0);
  const bonusOut: { id: string; crewId: string; amount: number }[] = [];
  const bonusDetail: Record<string, { id: string; kind: string; percent?: number | null; amount: number }> = {};
  for (const b of input.bonuses || []) {
    const i = crew.findIndex((c) => c.id === b.crewId);
    let amt = 0;
    if (b.kind === 'percent') amt = roundTo((Math.max(0, ownerAllocL) * Number(b.percent || 0)) / 100, incL, 'down');
    else amt = toL(b.fixedAmount);
    if (i < 0) {
      errors.push({ code: 'bonus_not_eligible', message: 'Bonus allocated to a crew member who is not in this payroll', crewId: b.crewId });
      continue;
    }
    bonusL[i] += amt;
    bonusOut.push({ id: b.id, crewId: b.crewId, amount: fromL(amt) });
    bonusDetail[b.crewId] = { id: b.id, kind: b.kind, percent: b.percent, amount: fromL(amt) };
    formula[i].push(b.kind === 'percent'
      ? `Owner-funded bonus: owner allocation ${fromL(ownerAllocL)} × ${b.percent}% = ${fromL(amt)}`
      : `Owner-funded bonus (fixed): ${fromL(amt)}`);
  }
  const totalBonusL = sum(bonusL);
  if (totalBonusL > 0 && totalBonusL > Math.max(0, ownerAllocL)) {
    errors.push({ code: 'bonus_exceeds_owner_allocation',
      message: `Bonuses ${fromL(totalBonusL)} exceed the owner's available allocation ${fromL(Math.max(0, ownerAllocL))}`,
      data: { bonuses: fromL(totalBonusL), available: fromL(Math.max(0, ownerAllocL)) } });
  }

  // 6–8. Earnings, deductions, net per crew ---------------------------------
  const results: CrewResult[] = crew.map((c, i) => {
    const adjustments = (input.adjustments || []).filter((a) => a.crewId === c.id);
    const earningsL = sum(adjustments.filter((a) => a.kind === 'earning').map((a) => toL(a.amount)));
    const grossLc = ordinary[i] + pctShare[i] + fixed[i] + attAdj[i] + bonusL[i] + earningsL;
    let available = grossLc;
    const f = formula[i];
    if (earningsL) f.push(`Other approved earnings: ${fromL(earningsL)}`);
    f.push(`Gross earnings: ${fromL(grossLc)}`);

    const carryL = sum(adjustments.filter((a) => a.kind === 'carry_forward').map((a) => toL(a.amount)));
    available -= carryL;
    const otherDedL = sum(adjustments.filter((a) => a.kind === 'deduction').map((a) => toL(a.amount)));
    available -= otherDedL;

    const fish = (input.fishTaken || []).filter((x) => x.crewId === c.id);
    const fishL = sum(fish.map((x) => toL(x.total)));
    available -= fishL;

    const adv = (input.advances || []).filter((a) => a.crewId === c.id).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const advLines: CrewResult['details']['advances'] = [];
    let advL = 0;
    let unrecoveredL = 0;
    for (const a of adv) {
      const outL = toL(a.outstanding);
      let take = outL;
      if (a.maxPerPeriod != null) take = Math.min(take, toL(a.maxPerPeriod));
      if ((rule.advanceRecovery ?? 'up_to_available') === 'up_to_available') take = Math.max(0, Math.min(take, available));
      available -= take;
      advL += take;
      unrecoveredL += outL - take;
      advLines.push({ id: a.id, code: a.code, date: a.date, outstandingBefore: fromL(outL), amount: fromL(take), outstandingAfter: fromL(outL - take) });
    }

    const totalDedL = carryL + otherDedL + fishL + advL;
    const netRaw = grossLc - totalDedL;
    const netL = Math.max(0, netRaw);
    const negativeL = netRaw < 0 ? -netRaw : 0;
    if (carryL) f.push(`Previous balance carried forward: −${fromL(carryL)}`);
    if (otherDedL) f.push(`Other approved deductions: −${fromL(otherDedL)}`);
    if (fishL) f.push(`Fish taken: −${fromL(fishL)}`);
    if (advL) f.push(`Cash advances recovered: −${fromL(advL)}`);
    f.push(`Net wage entitlement: ${fromL(grossLc)} − ${fromL(totalDedL)} = ${fromL(netRaw)}${negativeL ? ` (shown as 0; ${fromL(negativeL)} carried forward)` : ''}`);
    if (unrecoveredL > 0) warnings.push({ code: 'advance_carried_forward', message: `Advance balance ${fromL(unrecoveredL)} carried forward`, crewId: c.id });
    if (negativeL > 0) warnings.push({ code: 'negative_balance', message: `Deductions exceed earnings by ${fromL(negativeL)}; carried forward`, crewId: c.id });

    return {
      crewId: c.id, code: c.code, nameEn: c.nameEn, nameDv: c.nameDv, role: roleOf(c),
      daysPresent: paidDays(c, paid), daysEligible: c.daysEligible, shareWeight: Number(weights[i].toFixed(6)),
      ordinaryWage: fromL(ordinary[i]), percentageShare: fromL(pctShare[i]), fixedWage: fromL(fixed[i]),
      attendanceAdjustment: fromL(attAdj[i]), bonus: fromL(bonusL[i]), otherEarnings: fromL(earningsL),
      gross: fromL(grossLc), advanceDeduction: fromL(advL), fishDeduction: fromL(fishL), otherDeductions: fromL(otherDedL),
      carryForwardDeduction: fromL(carryL), totalDeductions: fromL(totalDedL), net: fromL(netL),
      unrecoveredAdvance: fromL(unrecoveredL), negativeBalance: fromL(negativeL),
      details: {
        formula: f,
        advances: advLines,
        fishTaken: fish.map((x) => ({ id: x.id, code: x.code, date: x.date, fishTypeEn: x.fishTypeEn, fishTypeDv: x.fishTypeDv,
          quantity: x.quantity, unit: x.unit, unitPrice: x.unitPrice, amount: x.total })),
        adjustments: adjustments.map((a) => ({ id: a.id, code: a.code, kind: a.kind, amount: a.amount, reason: a.reason })),
        bonus: bonusDetail[c.id],
      },
    };
  });

  // Inputs for crew who are not eligible would silently be skipped: flag them.
  const ids = new Set(crew.map((c) => c.id));
  for (const a of input.advances || []) if (!ids.has(a.crewId)) warnings.push({ code: 'advance_not_in_payroll', message: 'Outstanding advance for a crew member not in this payroll', crewId: a.crewId });
  for (const x of input.fishTaken || []) if (!ids.has(x.crewId)) warnings.push({ code: 'fish_not_in_payroll', message: 'Fish taken by a crew member not in this payroll', crewId: x.crewId });
  for (const a of input.adjustments || []) if (!ids.has(a.crewId)) warnings.push({ code: 'adjustment_not_in_payroll', message: 'Adjustment for a crew member not in this payroll', crewId: a.crewId });

  const totalGrossL = sum(results.map((r) => toL(r.gross)));
  const totalDedL = sum(results.map((r) => toL(r.totalDeductions)));
  const totalNetL = sum(results.map((r) => toL(r.net)));
  return {
    summary: {
      baseAmount: fromL(baseL),
      baseFormula,
      crewSharePercent: sharePct,
      crewPool: fromL(poolL),
      crewDistributed: fromL(crewDistributedL),
      ownerAllocation: fromL(ownerAllocL),
      totalBonuses: fromL(totalBonusL),
      ownerRemaining: fromL(ownerAllocL - totalBonusL),
      roundingDifference: fromL(roundingDiffL),
      totalGross: fromL(totalGrossL),
      totalDeductions: fromL(totalDedL),
      totalNet: fromL(totalNetL),
      totalUnrecoveredAdvances: fromL(sum(results.map((r) => toL(r.unrecoveredAdvance)))),
      totalNegativeBalances: fromL(sum(results.map((r) => toL(r.negativeBalance)))),
    },
    crew: results,
    bonuses: bonusOut,
    warnings,
    errors,
  };
}
