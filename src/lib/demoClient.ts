/**
 * Demo mode — an in-memory stand-in for Supabase.
 *
 * Used ONLY when no Supabase keys are configured (or VITE_DEMO=true), so the
 * app can be opened and clicked through with realistic sample data. Nothing is
 * saved and no network call is made. As soon as real keys are present, this
 * file is never used; see src/lib/supabase.ts.
 */
const C = 'c0000000-0000-0000-0000-000000000001';
const U = 'u0000000-0000-0000-0000-000000000001';
const B1 = 'b1', B2 = 'b2';
const crew = [
  { id: 'k1', crew_code: 'CRW-00001', name_en: 'Hassan Ali', name_dv: 'ހަސަން ޢަލީ', job_role: 'captain', current_role: 'captain', status: 'active', current_boat_id: B1, current_boat_name: 'Dhoani Hiyala', current_boat_name_dv: 'ހިޔަލަ ދޯނި', advances_outstanding: 1000, wages_outstanding: 0, phone: '+960 777 1234', company_id: C },
  { id: 'k2', crew_code: 'CRW-00002', name_en: 'Ibrahim Moosa', name_dv: 'އިބްރާހީމް މޫސާ', job_role: 'fisherman', current_role: 'fisherman', status: 'active', current_boat_id: B1, current_boat_name: 'Dhoani Hiyala', advances_outstanding: 0, wages_outstanding: 138, company_id: C },
  { id: 'k3', crew_code: 'CRW-00003', name_en: null, name_dv: 'މުހައްމަދު ނާޝިދު', job_role: 'fisherman', current_role: 'fisherman', status: 'active', current_boat_id: B1, current_boat_name: 'Dhoani Hiyala', advances_outstanding: 0, wages_outstanding: 0, company_id: C },
  { id: 'k4', crew_code: 'CRW-00004', name_en: 'Ahmed Shareef', name_dv: 'އަޙްމަދު ޝަރީފް', job_role: 'engineer', current_role: 'engineer', status: 'active', current_boat_id: B2, current_boat_name: 'Dhoani Raalhu', advances_outstanding: 0, wages_outstanding: 0, company_id: C },
];
const D: Record<string, any[]> = {
  boats: [{ id: B1, name: 'Dhoani Hiyala', name_dv: 'ހިޔަލަ ދޯނި', registration_no: 'MV-FB-1021', status: 'active', home_island: 'Naifaru' }, { id: B2, name: 'Dhoani Raalhu', name_dv: 'ރާޅު ދޯނި', registration_no: 'MV-FB-2044', status: 'active', home_island: 'Kulhudhuffushi' }],
  v_boats: [] as any[],
  v_crew: crew, crew_members: crew,
  v_trips: [
    { id: 't1', trip_code: 'TRP-00001', boat_id: B1, boat_name: 'Dhoani Hiyala', boat_name_dv: 'ހިޔަލަ ދޯނި', start_date: '2026-10-01', return_date: '2026-10-05', status: 'closed', crew_count: 3, catch_kg: 1200, sales_total: 20000, other_income: 0, expenses: 6900, trip_profit: 13100, payroll_status: 'finalized', company_id: C },
    { id: 't2', trip_code: 'TRP-00002', boat_id: B1, boat_name: 'Dhoani Hiyala', start_date: '2026-10-20', return_date: null, status: 'active', crew_count: 3, catch_kg: 300, sales_total: 4500, other_income: 0, expenses: 1800, trip_profit: 2700, company_id: C },
  ],
  v_bills: [
    { id: 'bl1', bill_code: 'BIL-00001', supplier_id: 's1', supplier_name: 'Fuel Supplies Pvt Ltd', invoice_no: 'INV-100', bill_date: '2026-10-01', due_date: '2026-10-20', category_name_en: 'Fuel and lubricants', category_name_dv: 'ތެލާއި ލުބްރިކެންޓް', boat_id: B1, boat_name: 'Dhoani Hiyala', trip_code: 'TRP-00001', subtotal: 5000, tax_amount: 400, total: 5400, amount_paid: 3400, outstanding: 2000, status: 'partially_paid', display_status: 'overdue', days_overdue: 9, document_count: 1, entered_by_name: 'Ibrahim Accounts', approved_by_name: 'Ahmed Owner' },
    { id: 'bl2', bill_code: 'BIL-00002', supplier_id: 's2', supplier_name: 'Ice Plant Naifaru', invoice_no: 'IP-55', bill_date: '2026-10-21', due_date: '2026-11-21', category_name_en: 'Ice and storage', boat_id: B1, boat_name: 'Dhoani Hiyala', subtotal: 1800, tax_amount: 0, total: 1800, amount_paid: 0, outstanding: 0, status: 'pending_approval', display_status: 'pending_approval', document_count: 0, entered_by_name: 'Moosa Manager' },
  ],
  v_transactions: [{ id: 'x1', txn_code: 'TXN-00001', kind: 'expense', date: '2026-10-02', category_name_en: 'Ice and storage', amount: 1500, boat_name: 'Dhoani Hiyala', status: 'approved', source: 'manual', payment_status: 'paid', has_document: false, description: 'Ice for trip' }],
  v_payrolls: [{ id: 'p1', payroll_code: 'PRL-00001', boat_id: B1, boat_name: 'Dhoani Hiyala', trip_code: 'TRP-00001', period_start: '2026-10-01', period_end: '2026-10-05', status: 'finalized', base_amount: 13100, crew_pool: 6550, owner_allocation: 6550, total_bonuses: 655, owner_remaining: 5895, total_gross: 7205, total_deductions: 1250, total_net: 5955, total_paid: 5817, rule_name: 'Standard share', rule_version: 1, warnings: [], crew_count: 3 }],
  v_wage_calculations: [
    { id: 'w1', payroll_id: 'p1', crew_id: 'k1', crew_code: 'CRW-00001', crew_name_en: 'Hassan Ali', crew_name_dv: 'ހަސަން ޢަލީ', job_role: 'captain', days_present: 5, days_eligible: 5, ordinary_wage: 3275, percentage_share: 0, fixed_wage: 0, attendance_adjustment: 0, bonus: 655, other_earnings: 0, gross: 3930, advance_deduction: 0, fish_deduction: 0, other_deductions: 0, carry_forward_deduction: 0, total_deductions: 0, net: 3930, details: { formula: ['Role share: 6550 × 2 / 4 = 3275', 'Owner-funded bonus: owner allocation 6550 × 10% = 655', 'Gross earnings: 3930'] } },
    { id: 'w2', payroll_id: 'p1', crew_id: 'k2', crew_code: 'CRW-00002', crew_name_en: 'Ibrahim Moosa', crew_name_dv: 'އިބްރާހީމް މޫސާ', job_role: 'fisherman', days_present: 5, days_eligible: 5, ordinary_wage: 1638, percentage_share: 0, fixed_wage: 0, attendance_adjustment: 0, bonus: 0, other_earnings: 0, gross: 1638, advance_deduction: 1000, fish_deduction: 0, other_deductions: 0, carry_forward_deduction: 0, total_deductions: 1000, net: 638, details: { formula: [] } },
  ],
  v_wage_slips: [{ id: 'sl2', slip_no: 'SLP-00002', version: 1, payroll_id: 'p1', crew_id: 'k2', crew_code: 'CRW-00002', crew_name_en: 'Ibrahim Moosa', crew_name_dv: 'އިބްރާހީމް މޫސާ', boat_id: B1, boat_name: 'Dhoani Hiyala', payroll_code: 'PRL-00001', period_start: '2026-10-01', period_end: '2026-10-05', trip_code: 'TRP-00001', status: 'issued', net_payable: 638, amount_paid: 500, remaining: 138, payment_status: 'partially_paid', generated_at: '2026-10-07T09:00:00Z',
    payments: [{ code: 'CPY-00001', date: '2026-10-08', amount: 500, method: 'cash' }],
    data: { company: { name: 'Hiyala Fisheries Pvt Ltd', nameDv: 'ހިޔަލަ ފިޝަރީޒް', currency: 'MVR' }, boat: { name: 'Dhoani Hiyala', nameDv: 'ހިޔަލަ ދޯނި', registrationNo: 'MV-FB-1021' }, crew: { code: 'CRW-00002', nameEn: 'Ibrahim Moosa', nameDv: 'އިބްރާހީމް މޫސާ', role: 'fisherman' }, payroll: { code: 'PRL-00001', periodStart: '2026-10-01', periodEnd: '2026-10-05', tripCode: 'TRP-00001' }, attendance: { daysPresent: 5, daysEligible: 5 }, earnings: { ordinaryWage: 1638, percentageShare: 0, fixedWage: 0, attendanceAdjustment: 0, bonus: 0, otherEarnings: 0, gross: 1638 }, deductions: { advances: 1000, fishTaken: 0, other: 0, carryForward: 0, total: 1000 }, lines: { advances: [{ code: 'ADV-00001', date: '2026-09-20', outstandingBefore: 1000, amount: 1000, outstandingAfter: 0 }], fishTaken: [], adjustments: [], formula: ['Role share: 6550 × 1 / 4 = 1637.5 → 1638'] }, net: 638, preparedBy: 'Aisha Payroll', approvedBy: 'Ahmed Owner' } }],
  v_cash_advances: [{ id: 'a1', advance_code: 'ADV-00001', crew_id: 'k2', crew_code: 'CRW-00002', crew_name_en: 'Ibrahim Moosa', crew_name_dv: 'އިބްރާހީމް މޫސާ', boat_id: B1, boat_name: 'Dhoani Hiyala', date: '2026-09-20', amount: 1000, recovered: 1000, outstanding: 0, reason: 'Family need', status: 'approved' }, { id: 'a2', advance_code: 'ADV-00002', crew_id: 'k1', crew_code: 'CRW-00001', crew_name_en: 'Hassan Ali', boat_name: 'Dhoani Hiyala', date: '2026-10-22', amount: 1000, recovered: 0, outstanding: 1000, reason: 'Medical', status: 'pending_approval' }],
  v_supplier_balances: [{ id: 's1', name: 'Fuel Supplies Pvt Ltd', total_billed: 5400, total_paid: 3400, outstanding: 2000, overdue: 2000, open_bills: 1, credit_to_reconcile: 0 }, { id: 's2', name: 'Ice Plant Naifaru', total_billed: 0, total_paid: 0, outstanding: 0, overdue: 0, open_bills: 0, credit_to_reconcile: 0 }],
  suppliers: [{ id: 's1', name: 'Fuel Supplies Pvt Ltd', status: 'active' }, { id: 's2', name: 'Ice Plant Naifaru', status: 'active' }],
  categories: [{ id: 'cat1', kind: 'expense', code: 'fuel', name_en: 'Fuel and lubricants', name_dv: 'ތެލާއި ލުބްރިކެންޓް', active: true, sort_order: 10 }, { id: 'cat2', kind: 'expense', code: 'ice', name_en: 'Ice and storage', name_dv: 'ގަނޑުފެނާއި ރައްކާކުރުން', active: true, sort_order: 40 }, { id: 'cat3', kind: 'income', code: 'fish_sales', name_en: 'Fish sales', name_dv: 'މަސް ވިއްކުން', is_system: true, active: true, sort_order: 10 }],
  fish_types: [{ id: 'f1', name_en: 'Skipjack tuna', name_dv: 'ކަޅުބިލަމަސް', default_unit: 'kg', active: true }],
  v_fish_sales: [{ id: 'fs1', sale_code: 'SAL-00001', date: '2026-10-05', trip_code: 'TRP-00001', boat_name: 'Dhoani Hiyala', fish_name_en: 'Skipjack tuna', fish_name_dv: 'ކަޅުބިލަމަސް', quantity: 1000, unit: 'kg', unit_price: 20, total: 20000, customer_name: 'MIFCO', amount_received: 15000, outstanding: 5000, payment_status: 'partially_paid', status: 'recorded' }],
  v_boat_assignments: crew.filter((c) => c.current_boat_id === B1).map((c) => ({ id: 'as' + c.id, crew_id: c.id, crew_code: c.crew_code, crew_name_en: c.name_en, crew_name_dv: c.name_dv, boat_id: B1, boat_name: 'Dhoani Hiyala', job_role: c.job_role, start_date: '2026-01-01', end_date: null })),
  v_attendance: [], v_profiles: [{ id: U, full_name: 'Ahmed Owner', email: 'owner@hiyala.mv', role: 'owner', active: true, boat_ids: [], language: 'en' }],
  permissions: [{ key: 'boats.view', module: 'boats', description: 'View boats' }], role_permissions: [],
  v_audit_logs: [{ id: 1, created_at: '2026-10-28T10:00:00Z', user_name: 'Ahmed Owner', table_name: 'bills', action: 'update', changed_fields: ['status'], new_data: { bill_code: 'BIL-00001' } }],
};
D.v_boats = D.boats.map((b) => ({ ...b, crew_count: 3, manager_name: 'Moosa Manager' }));
const RPC: Record<string, any> = {
  my_context: { profile: { id: U, company_id: C, full_name: 'Ahmed Owner', email: 'owner@hiyala.mv', role: 'owner', active: true, language: null, all_boats: true },
    company: { id: C, name: 'Hiyala Fisheries Pvt Ltd', name_dv: 'ހިޔަލަ ފިޝަރީޒް', currency: 'MVR', default_language: 'en', settings: { ocr_enabled: true, max_upload_mb: 10 } }, permissions: [] },
  get_alerts: [{ key: 'bills_overdue', severity: 'danger', count: 1, link: '/bills?status=overdue' }, { key: 'bills_pending_approval', severity: 'info', count: 1, link: '/bills?status=pending_approval' }, { key: 'unpaid_wages', severity: 'warning', count: 1, link: '/crew-payments' }],
  dashboard_summary: { boatsTotal: 2, boatsActive: 2, tripsActive: 1, tripsCompleted: 1, crewActive: 4, attendanceToday: { present: 3, absent: 1, sick: 0, leave: 0 }, fishSales: 24500, otherIncome: 0, revenue: 24500, expenses: 8700, operatingProfit: 15800, crewWages: 7205, fishTakenRecovered: 250, netProfit: 8845, wageLiabilities: 138, wagesAwaitingPayment: 1, bonusesAllocated: 655, advancesOutstanding: 1000, supplierOutstanding: 2000, billsUnpaid: 0, billsPartiallyPaid: 1, billsOverdue: 1, receivables: 5000, payrollPendingApproval: 0, cashIn: 15000, cashOut: 9017 },
  finance_series: Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, '0')}-01`, income: [0, 0, 18000, 22000, 9000, 15000, 30000, 26000, 21000, 24500, 0, 0][i], expense: [0, 0, 7000, 8000, 6500, 7100, 9400, 9800, 8000, 8700, 0, 0][i], profit: 0 })),
  boat_performance: [{ boat_id: B1, boat_name: 'Dhoani Hiyala', boat_name_dv: 'ހިޔަލަ ދޯނި', revenue: 24500, expenses: 8700, crew_wages: 7205, net_profit: 8845 }, { boat_id: B2, boat_name: 'Dhoani Raalhu', boat_name_dv: 'ރާޅު ދޯނި', revenue: 0, expenses: 1200, crew_wages: 0, net_profit: -1200 }],
  recent_activity: [{ kind: 'fish_sale', id: 'fs1', code: 'SAL-00001', date: '2026-10-05', description: 'Skipjack tuna 1000 kg', amount: 20000, direction: 'in', created_at: '2026-10-05' }, { kind: 'bill_payment', id: 'bp1', code: 'PAY-00001', date: '2026-10-10', description: 'Fuel Supplies Pvt Ltd · BIL-00001', amount: 3400, direction: 'out', created_at: '2026-10-10' }],
  financial_summary: { fishSales: 24500, otherIncome: 0, revenue: 24500, expenses: 8700, operatingProfit: 15800, crewWages: 7205, bonuses: 655, fishTakenRecovered: 250, netProfit: 8845, ownerAllocation: 6550, ownerRemaining: 5895 },
  find_bill_duplicates: [],
};
const WRITE_RPCS = ['record_', 'approve_', 'submit_', 'reject_', 'return_', 'void_', 'set_', 'finalize_',
  'reverse_', 'reissue_', 'acknowledge_', 'assign_', 'bootstrap_', 'apply_'];

function builder(table: string) {
  let rows = [...(D[table] ?? [])];
  let single = false, maybe = false;
  // q.__write marks a mutation, which demo mode refuses
  const q: any = {
    select: () => q, order: () => q, limit: () => q, or: () => q, not: () => q,
    eq: (c: string, v: any) => { rows = rows.filter((r) => r[c] === undefined || r[c] === v); return q; },
    in: (c: string, v: any[]) => { rows = rows.filter((r) => r[c] === undefined || v.includes(r[c])); return q; },
    gte: () => q, lte: () => q, gt: () => q, lt: () => q, is: () => q, ilike: () => q, neq: () => q,
    range: () => q, single: () => { single = true; return q; }, maybeSingle: () => { maybe = true; return q; },
    insert: () => { q.__write = true; return q; },
    update: () => { q.__write = true; return q; },
    delete: () => { q.__write = true; return q; },
    upsert: () => { q.__write = true; return q; },
    then: (res: any) => res(
      q.__write ? { data: null, error: { message: 'demo_readonly' } }
      : single || maybe ? { data: rows[0] ?? null, error: null }
      : { data: rows, error: null, count: rows.length }),
  };
  return q;
}
export function createDemoClient() {
  const session = { user: { id: U, email: 'owner@hiyala.mv' }, access_token: 'x' };
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}), signInWithPassword: async () => ({}), signUp: async () => ({ data: {} }),
      resetPasswordForEmail: async () => ({}), updateUser: async () => ({}),
    },
    from: (t: string) => builder(t),
    rpc: async (name: string) => (WRITE_RPCS.some((w) => name.startsWith(w))
      ? { data: null, error: { message: 'demo_readonly' } }
      : { data: RPC[name] ?? null, error: null }),
    storage: { from: () => ({ upload: async () => ({}), createSignedUrl: async () => ({ data: { signedUrl: 'about:blank' } }) }) },
    functions: { invoke: async () => ({ data: {}, error: null }) },
  };
}

