import { describe, it, expect } from 'vitest';
import { calculatePayroll, splitByWeights, validateRule, type PayrollInputs, type WageRuleConfig } from '../supabase/functions/_shared/wageEngine';

const crew3 = [
  { id: 'c1', role: 'captain', daysPresent: 5, daysEligible: 5 },
  { id: 'c2', role: 'fisherman', daysPresent: 5, daysEligible: 5 },
  { id: 'c3', role: 'fisherman', daysPresent: 4, daysEligible: 5 },
];

function inputs(rule: WageRuleConfig, extra: Partial<PayrollInputs> = {}): PayrollInputs {
  return {
    payroll: { id: 'p1' },
    rule,
    financials: { fishSales: 20000, otherIncome: 0, grossIncome: 20000, expenses: 6900 },
    crew: crew3,
    ...extra,
  };
}
const byId = (r: ReturnType<typeof calculatePayroll>, id: string) => r.crew.find((c) => c.crewId === id)!;

describe('wage base and pool', () => {
  it('uses net trip profit and crew share percentage', () => {
    const r = calculatePayroll(inputs({ base: 'net_trip_profit', method: 'equal', crewSharePercent: 50 }));
    expect(r.summary.baseAmount).toBe(13100);
    expect(r.summary.crewPool).toBe(6550);
    expect(r.errors).toEqual([]);
  });

  it('uses gross income when chosen (never assumes net profit)', () => {
    const r = calculatePayroll(inputs({ base: 'gross_income', method: 'equal', crewSharePercent: 30 }));
    expect(r.summary.baseAmount).toBe(20000);
    expect(r.summary.crewPool).toBe(6000);
  });

  it('can exclude expense categories from the net profit base', () => {
    const r = calculatePayroll(inputs({ base: 'net_trip_profit', method: 'equal', excludedExpenseCategories: ['fuel'] },
      { financials: { fishSales: 20000, otherIncome: 0, grossIncome: 20000, expenses: 6900, expensesByCategory: { fuel: 5400, ice: 1500 } } }));
    expect(r.summary.baseAmount).toBe(18500);
  });

  it('gives a zero pool and a warning when the base is a loss', () => {
    const r = calculatePayroll(inputs({ base: 'net_trip_profit', method: 'equal', crewSharePercent: 50 },
      { financials: { fishSales: 1000, otherIncome: 0, grossIncome: 1000, expenses: 3000 } }));
    expect(r.summary.crewPool).toBe(0);
    expect(r.crew.every((c) => c.gross === 0)).toBe(true);
    expect(r.warnings.some((w) => w.code === 'non_positive_base')).toBe(true);
  });

  it('requires the agreed amount for a custom base', () => {
    const r = calculatePayroll(inputs({ base: 'custom_amount', method: 'equal' }));
    expect(r.errors.some((e) => e.code === 'missing_custom_base')).toBe(true);
    const ok = calculatePayroll(inputs({ base: 'custom_amount', method: 'equal' }, { payroll: { customBaseAmount: 9000 } }));
    expect(ok.summary.crewPool).toBe(9000);
    expect(ok.crew.map((c) => c.ordinaryWage)).toEqual([3000, 3000, 3000]);
  });
});

describe('methods', () => {
  it('role-based sharing with rounding to whole rufiyaa keeps the pool total', () => {
    const r = calculatePayroll(inputs({ base: 'net_trip_profit', method: 'role', crewSharePercent: 50,
      roleWeights: { captain: 2, fisherman: 1 }, rounding: { mode: 'nearest', increment: 1 } }));
    expect(r.crew.map((c) => c.ordinaryWage)).toEqual([3275, 1638, 1637]);
    expect(r.summary.crewDistributed).toBe(6550);
    expect(r.summary.ownerAllocation).toBe(6550);
  });

  it('equal sharing splits remainders fairly', () => {
    expect(splitByWeights(100000, [1, 1, 1], 100, 'nearest')).toEqual([33400, 33300, 33300]);
    expect(splitByWeights(100000, [1, 1, 1], 100, 'down')).toEqual([33300, 33300, 33300]);
    expect(splitByWeights(100000, [1, 1, 1], 100, 'up')).toEqual([33400, 33400, 33400]);
  });

  it('percentage sharing reports unallocated percentage', () => {
    const r = calculatePayroll(inputs({ base: 'gross_income', method: 'percentage', crewSharePercent: 50,
      percentages: { c1: 40, c2: 30, c3: 20 } }));
    expect(r.crew.map((c) => c.percentageShare)).toEqual([4000, 3000, 2000]);
    expect(r.summary.ownerAllocation).toBe(11000);
    expect(r.warnings.some((w) => w.code === 'percent_unallocated')).toBe(true);
  });

  it('blocks percentages above 100% unless explicitly allowed', () => {
    const rule: WageRuleConfig = { base: 'gross_income', method: 'percentage', percentages: { c1: 60, c2: 50 } };
    expect(validateRule(rule).some((e) => e.code === 'percent_exceeds_pool')).toBe(true);
    const r = calculatePayroll(inputs(rule));
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('fixed wages cannot exceed the pool without an approved arrangement', () => {
    const rule: WageRuleConfig = { base: 'gross_income', method: 'fixed', crewSharePercent: 20,
      fixedWages: { c1: 3000, c2: 2000 }, roleFixedWages: { fisherman: 500 } };
    const r = calculatePayroll(inputs(rule));
    expect(r.crew.map((c) => c.fixedWage)).toEqual([3000, 2000, 500]);
    expect(r.errors.some((e) => e.code === 'allocation_exceeds_pool')).toBe(true);
    const ok = calculatePayroll(inputs({ ...rule, allowExceedPool: true }));
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.some((w) => w.code === 'allocation_exceeds_pool')).toBe(true);
    expect(ok.summary.ownerAllocation).toBe(20000 - 5500);
  });

  it('attendance per-day wages', () => {
    const r = calculatePayroll(inputs({ base: 'gross_income', method: 'attendance',
      attendance: { enabled: true, mode: 'per_day', dailyRate: 300, roleDailyRates: { captain: 500 } } }));
    expect(r.crew.map((c) => c.ordinaryWage)).toEqual([2500, 1500, 1200]);
  });

  it('attendance-proportional sharing of the pool by days worked', () => {
    const r = calculatePayroll(inputs({ base: 'gross_income', method: 'attendance', crewSharePercent: 14, attendance: { enabled: true } }));
    // pool 2800 split 5:5:4
    expect(r.crew.map((c) => c.ordinaryWage)).toEqual([1000, 1000, 800]);
  });

  it('attendance adjustment on equal shares — forfeited wages to owner', () => {
    const r = calculatePayroll(inputs({ base: 'custom_amount', method: 'equal', attendance: { enabled: true, forfeitTo: 'owner' } },
      { payroll: { customBaseAmount: 3000 } }));
    expect(r.crew.map((c) => c.ordinaryWage)).toEqual([1000, 1000, 1000]);
    expect(r.crew.map((c) => c.attendanceAdjustment)).toEqual([0, 0, -200]);
    expect(r.crew.map((c) => c.gross)).toEqual([1000, 1000, 800]);
    expect(r.summary.ownerAllocation).toBe(200);
  });

  it('attendance adjustment — forfeited wages redistributed to crew', () => {
    const r = calculatePayroll(inputs({ base: 'custom_amount', method: 'equal', attendance: { enabled: true, forfeitTo: 'crew' } },
      { payroll: { customBaseAmount: 3000 } }));
    expect(r.crew.map((c) => c.gross)).toEqual([1071.43, 1071.43, 857.14]);
    expect(r.summary.crewDistributed).toBe(3000);
    expect(r.summary.ownerAllocation).toBe(0);
  });

  it('attendance counts approved leave only when configured', () => {
    const crew = [{ id: 'a', daysPresent: 3, daysLeave: 2, daysEligible: 5 }, { id: 'b', daysPresent: 5, daysEligible: 5 }];
    const base = { base: 'custom_amount' as const, method: 'equal' as const };
    const strict = calculatePayroll({ ...inputs({ ...base, attendance: { enabled: true } }, { payroll: { customBaseAmount: 1000 } }), crew });
    const paidLeave = calculatePayroll({ ...inputs({ ...base, attendance: { enabled: true, paidStatuses: ['present', 'approved_leave'] } },
      { payroll: { customBaseAmount: 1000 } }), crew });
    expect(strict.crew[0].gross).toBe(300);
    expect(paidLeave.crew[0].gross).toBe(500);
  });

  it('combined: fixed wage first, remainder shared by role', () => {
    const r = calculatePayroll(inputs({ base: 'custom_amount', method: 'combined', fixedWages: { c1: 1000 },
      roleWeights: { captain: 1, fisherman: 1 }, combined: { shareBy: 'role' } }, { payroll: { customBaseAmount: 4000 } }));
    expect(r.crew.map((c) => [c.fixedWage, c.ordinaryWage])).toEqual([[1000, 1000], [0, 1000], [0, 1000]]);
    expect(r.summary.crewDistributed).toBe(4000);
  });

  it('respects eligible crew selection', () => {
    const r = calculatePayroll(inputs({ base: 'custom_amount', method: 'equal', eligibleCrewIds: ['c1', 'c2'] }, { payroll: { customBaseAmount: 1000 } }));
    expect(r.crew.map((c) => c.crewId)).toEqual(['c1', 'c2']);
    expect(r.crew.map((c) => c.gross)).toEqual([500, 500]);
  });
});

describe('owner-funded bonuses', () => {
  const rule: WageRuleConfig = { base: 'net_trip_profit', method: 'role', crewSharePercent: 50,
    roleWeights: { captain: 2, fisherman: 1 }, rounding: { mode: 'nearest', increment: 1 } };

  it('come out of the owner allocation, not crew wages', () => {
    const r = calculatePayroll(inputs(rule, { bonuses: [{ id: 'b1', crewId: 'c1', kind: 'percent', percent: 10 }, { id: 'b2', crewId: 'c2', kind: 'fixed', fixedAmount: 100 }] }));
    expect(byId(r, 'c1').ordinaryWage).toBe(3275);
    expect(byId(r, 'c1').bonus).toBe(655);
    expect(byId(r, 'c2').bonus).toBe(100);
    expect(byId(r, 'c3').gross).toBe(1637);           // untouched
    expect(r.summary.totalBonuses).toBe(755);
    expect(r.summary.ownerAllocation).toBe(6550);
    expect(r.summary.ownerRemaining).toBe(5795);
    expect(r.bonuses).toEqual([{ id: 'b1', crewId: 'c1', amount: 655 }, { id: 'b2', crewId: 'c2', amount: 100 }]);
  });

  it('are blocked when they exceed the owner allocation', () => {
    const r = calculatePayroll(inputs(rule, { bonuses: [{ id: 'b1', crewId: 'c1', kind: 'fixed', fixedAmount: 7000 }] }));
    expect(r.errors.some((e) => e.code === 'bonus_exceeds_owner_allocation')).toBe(true);
  });
});

describe('deductions', () => {
  const rule: WageRuleConfig = { base: 'custom_amount', method: 'equal' };

  it('recovers advances once, oldest first, carrying forward the rest', () => {
    const r = calculatePayroll(inputs(rule, {
      payroll: { customBaseAmount: 1500 },
      advances: [
        { id: 'a2', crewId: 'c1', date: '2026-02-10', amount: 400, outstanding: 400 },
        { id: 'a1', crewId: 'c1', date: '2026-01-10', amount: 800, outstanding: 800 },
      ],
    }));
    const c1 = byId(r, 'c1');
    expect(c1.gross).toBe(500);
    expect(c1.details.advances.map((a) => [a.id, a.amount, a.outstandingAfter])).toEqual([['a1', 500, 300], ['a2', 0, 400]]);
    expect(c1.advanceDeduction).toBe(500);
    expect(c1.unrecoveredAdvance).toBe(700);
    expect(c1.net).toBe(0);
    expect(c1.negativeBalance).toBe(0);
  });

  it('honours a maximum recovery per period', () => {
    const r = calculatePayroll(inputs(rule, { payroll: { customBaseAmount: 3000 },
      advances: [{ id: 'a1', crewId: 'c1', date: '2026-01-10', amount: 900, outstanding: 900, maxPerPeriod: 250 }] }));
    expect(byId(r, 'c1').advanceDeduction).toBe(250);
    expect(byId(r, 'c1').net).toBe(750);
  });

  it('deducts fish taken at the agreed value and carries any shortfall forward', () => {
    const r = calculatePayroll(inputs(rule, { payroll: { customBaseAmount: 1500 },
      fishTaken: [{ id: 'f1', crewId: 'c3', date: '2026-03-05', quantity: 28, unit: 'kg', unitPrice: 25, total: 700 }] }));
    const c3 = byId(r, 'c3');
    expect(c3.fishDeduction).toBe(700);
    expect(c3.net).toBe(0);
    expect(c3.negativeBalance).toBe(200);
    expect(c3.details.fishTaken[0]).toMatchObject({ id: 'f1', quantity: 28, unitPrice: 25, amount: 700 });
  });

  it('applies approved earnings, deductions and previous balances separately', () => {
    const r = calculatePayroll(inputs(rule, { payroll: { customBaseAmount: 3000 }, adjustments: [
      { id: 'j1', crewId: 'c2', kind: 'earning', amount: 150, reason: 'Night watch' },
      { id: 'j2', crewId: 'c2', kind: 'deduction', amount: 50, reason: 'Lost gear' },
      { id: 'j3', crewId: 'c2', kind: 'carry_forward', amount: 75, reason: 'From PRL-00001' },
    ] }));
    const c2 = byId(r, 'c2');
    expect(c2.otherEarnings).toBe(150);
    expect(c2.gross).toBe(1150);
    expect(c2.otherDeductions).toBe(50);
    expect(c2.carryForwardDeduction).toBe(75);
    expect(c2.totalDeductions).toBe(125);
    expect(c2.net).toBe(1025);
  });

  it('every crew row reconciles: gross − deductions = net (+ negative balance)', () => {
    const r = calculatePayroll(inputs({ base: 'net_trip_profit', method: 'role', crewSharePercent: 50, roleWeights: { captain: 2 } }, {
      advances: [{ id: 'a', crewId: 'c2', date: '2026-01-01', amount: 1000, outstanding: 1000 }],
      fishTaken: [{ id: 'f', crewId: 'c3', date: '2026-03-01', quantity: 10, unit: 'kg', unitPrice: 25, total: 250 }],
      bonuses: [{ id: 'b', crewId: 'c1', kind: 'percent', percent: 10 }],
    }));
    for (const c of r.crew) {
      const g = c.ordinaryWage + c.percentageShare + c.fixedWage + c.attendanceAdjustment + c.bonus + c.otherEarnings;
      expect(Math.round(g * 100)).toBe(Math.round(c.gross * 100));
      const d = c.advanceDeduction + c.fishDeduction + c.otherDeductions + c.carryForwardDeduction;
      expect(Math.round(d * 100)).toBe(Math.round(c.totalDeductions * 100));
      expect(Math.round((c.gross - c.totalDeductions + c.negativeBalance) * 100)).toBe(Math.round(c.net * 100));
    }
    expect(Math.round((r.summary.crewDistributed + r.summary.ownerAllocation) * 100)).toBe(Math.round(r.summary.baseAmount * 100));
  });
});

describe('historical stability', () => {
  it('is deterministic for the same snapshot of inputs', () => {
    const i = inputs({ base: 'net_trip_profit', method: 'role', crewSharePercent: 45, roleWeights: { captain: 1.5 } });
    expect(JSON.stringify(calculatePayroll(i))).toBe(JSON.stringify(calculatePayroll(JSON.parse(JSON.stringify(i)))));
  });
});
