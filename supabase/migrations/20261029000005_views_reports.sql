-- =====================================================================
-- Galary — 0005 Read views, dashboard, reports and alerts.
-- All views use security_invoker so row-level security of the
-- underlying tables applies to the person querying.
-- =====================================================================

create or replace function public.person_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles
  where id = p_user and company_id = public.auth_company_id()
$$;

create or replace function public.doc_count(p_type text, p_id uuid)
returns int language sql stable security invoker as $$
  select count(*)::int from public.documents where entity_type = p_type and entity_id = p_id and is_current
$$;

-- ---------------------------------------------------------------------
create view public.v_boats with (security_invoker = true) as
select b.*,
       public.person_name(b.manager_id) as manager_name,
       (select count(*) from public.boat_assignments a where a.boat_id = b.id and a.end_date is null)::int as crew_count,
       (select storage_path from public.documents d where d.id = b.photo_document_id) as photo_path
from public.boats b;

create view public.v_crew with (security_invoker = true) as
select c.*,
       a.boat_id as current_boat_id, bo.name as current_boat_name, bo.name_dv as current_boat_name_dv,
       a.start_date as assignment_start, coalesce(a.job_role, c.job_role) as current_role,
       (select storage_path from public.documents d where d.id = c.photo_document_id) as photo_path,
       coalesce((select sum(ca.amount - public.advance_recovered(ca.id)) from public.cash_advances ca
                 where ca.crew_id = c.id and ca.status = 'approved'), 0) as advances_outstanding,
       coalesce((select sum(s.net_payable - public.crew_paid_for(s.payroll_id, s.crew_id)) from public.wage_slips s
                 where s.crew_id = c.id and s.status = 'issued'), 0) as wages_outstanding
from public.crew_members c
left join public.boat_assignments a on a.crew_id = c.id and a.end_date is null
left join public.boats bo on bo.id = a.boat_id;

create view public.v_boat_assignments with (security_invoker = true) as
select a.*, b.name as boat_name, b.name_dv as boat_name_dv, c.name_en as crew_name_en, c.name_dv as crew_name_dv,
       c.crew_code
from public.boat_assignments a
join public.boats b on b.id = a.boat_id
join public.crew_members c on c.id = a.crew_id;

create view public.v_trips with (security_invoker = true) as
select t.*, b.name as boat_name, b.name_dv as boat_name_dv,
       (select count(*) from public.trip_crew tc where tc.trip_id = t.id)::int as crew_count,
       coalesce((select sum(quantity) from public.catch_records cr where cr.trip_id = t.id and cr.unit = 'kg'), 0) as catch_kg,
       coalesce((select sum(total) from public.fish_sales s where s.trip_id = t.id and s.status = 'recorded'), 0) as sales_total,
       coalesce((select sum(amount) from public.transactions x where x.trip_id = t.id and x.status = 'approved' and x.kind = 'income'), 0) as other_income,
       coalesce((select sum(amount) from public.transactions x where x.trip_id = t.id and x.status = 'approved' and x.kind = 'expense'), 0) as expenses,
       coalesce((select sum(total) from public.fish_sales s where s.trip_id = t.id and s.status = 'recorded'), 0)
       + coalesce((select sum(amount) from public.transactions x where x.trip_id = t.id and x.status = 'approved' and x.kind = 'income'), 0)
       - coalesce((select sum(amount) from public.transactions x where x.trip_id = t.id and x.status = 'approved' and x.kind = 'expense'), 0) as trip_profit,
       (select p.status from public.payroll_periods p where p.trip_id = t.id and p.status <> 'reversed' limit 1) as payroll_status
from public.trips t
join public.boats b on b.id = t.boat_id;

create view public.v_trip_crew with (security_invoker = true) as
select tc.*, c.crew_code, c.name_en, c.name_dv, c.job_role as default_role
from public.trip_crew tc join public.crew_members c on c.id = tc.crew_id;

create view public.v_attendance with (security_invoker = true) as
select a.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name,
       t.trip_code, public.person_name(a.created_by) as created_by_name, public.person_name(a.updated_by) as updated_by_name
from public.attendance a
join public.crew_members c on c.id = a.crew_id
join public.boats b on b.id = a.boat_id
left join public.trips t on t.id = a.trip_id;

create view public.v_catch with (security_invoker = true) as
select cr.*, ft.name_en as fish_name_en, ft.name_dv as fish_name_dv, b.name as boat_name, t.trip_code
from public.catch_records cr
join public.fish_types ft on ft.id = cr.fish_type_id
join public.boats b on b.id = cr.boat_id
join public.trips t on t.id = cr.trip_id;

create view public.v_fish_sales with (security_invoker = true) as
select s.*, ft.name_en as fish_name_en, ft.name_dv as fish_name_dv, b.name as boat_name, t.trip_code,
       cu.name as customer_name, cu.name_dv as customer_name_dv,
       public.sale_received(s.id) as amount_received,
       case when s.status = 'voided' then 0 else s.total - public.sale_received(s.id) end as outstanding,
       case when s.status = 'voided' then 'not_applicable'
            when public.sale_received(s.id) >= s.total then 'paid'
            when public.sale_received(s.id) > 0 then 'partially_paid' else 'unpaid' end as payment_status,
       public.doc_count('fish_sale', s.id) as document_count
from public.fish_sales s
join public.fish_types ft on ft.id = s.fish_type_id
join public.boats b on b.id = s.boat_id
left join public.trips t on t.id = s.trip_id
left join public.customers cu on cu.id = s.customer_id;

create view public.v_customer_receipts with (security_invoker = true) as
select r.*, s.sale_code, s.boat_id, b.name as boat_name, cu.name as customer_name, public.person_name(r.recorded_by) as recorded_by_name
from public.customer_receipts r
join public.fish_sales s on s.id = r.sale_id
join public.boats b on b.id = s.boat_id
left join public.customers cu on cu.id = s.customer_id;

create view public.v_trip_fish_stock with (security_invoker = true) as
with c as (select trip_id, fish_type_id, unit, sum(quantity) q from public.catch_records group by 1,2,3),
     s as (select trip_id, fish_type_id, unit, sum(quantity) q from public.fish_sales where status = 'recorded' and trip_id is not null group by 1,2,3),
     f as (select trip_id, fish_type_id, unit, sum(quantity) q from public.fish_taken where status in ('approved','pending_approval') and trip_id is not null group by 1,2,3),
     k as (select trip_id, fish_type_id, unit from c union select trip_id, fish_type_id, unit from s union select trip_id, fish_type_id, unit from f)
select k.trip_id, k.fish_type_id, ft.name_en as fish_name_en, ft.name_dv as fish_name_dv, k.unit,
       coalesce(c.q, 0) as caught, coalesce(s.q, 0) as sold, coalesce(f.q, 0) as taken_by_crew,
       coalesce(c.q, 0) - coalesce(s.q, 0) - coalesce(f.q, 0) as remaining
from k
join public.fish_types ft on ft.id = k.fish_type_id
left join c on c.trip_id = k.trip_id and c.fish_type_id = k.fish_type_id and c.unit = k.unit
left join s on s.trip_id = k.trip_id and s.fish_type_id = k.fish_type_id and s.unit = k.unit
left join f on f.trip_id = k.trip_id and f.fish_type_id = k.fish_type_id and f.unit = k.unit;

create view public.v_transactions with (security_invoker = true) as
select x.*, cat.code as category_code, cat.name_en as category_name_en, cat.name_dv as category_name_dv,
       b.name as boat_name, t.trip_code, su.name as supplier_name, cu.name as customer_name, bi.bill_code,
       public.person_name(x.created_by) as created_by_name, public.person_name(x.approved_by) as approved_by_name,
       (x.document_id is not null or public.doc_count('transaction', x.id) > 0
        or (x.bill_id is not null and public.doc_count('bill', x.bill_id) > 0)) as has_document
from public.transactions x
join public.categories cat on cat.id = x.category_id
left join public.boats b on b.id = x.boat_id
left join public.trips t on t.id = x.trip_id
left join public.suppliers su on su.id = x.supplier_id
left join public.customers cu on cu.id = x.customer_id
left join public.bills bi on bi.id = x.bill_id;

create view public.v_bills with (security_invoker = true) as
select bl.*, su.name as supplier_name, su.name_dv as supplier_name_dv, su.phone as supplier_phone,
       su.email as supplier_email, cat.code as category_code, cat.name_en as category_name_en,
       cat.name_dv as category_name_dv, b.name as boat_name, t.trip_code,
       public.bill_paid(bl.id) as amount_paid,
       case when bl.status in ('approved','partially_paid','paid') then greatest(bl.total - public.bill_paid(bl.id), 0)
            else 0 end as outstanding,
       case when bl.status in ('approved','partially_paid') and bl.due_date < current_date
                 and bl.total - public.bill_paid(bl.id) > 0 then 'overdue'
            else bl.status::text end as display_status,
       case when bl.status in ('approved','partially_paid') and bl.due_date < current_date
            then current_date - bl.due_date else 0 end as days_overdue,
       public.doc_count('bill', bl.id) as document_count,
       (select max(date) from public.bill_payments bp where bp.bill_id = bl.id and bp.status = 'valid') as last_payment_date,
       (select string_agg(distinct method, ', ') from public.bill_payments bp where bp.bill_id = bl.id and bp.status = 'valid') as payment_methods,
       public.person_name(bl.created_by) as entered_by_name, public.person_name(bl.approved_by) as approved_by_name,
       (select x.id from public.transactions x where x.bill_id = bl.id) as expense_transaction_id
from public.bills bl
join public.suppliers su on su.id = bl.supplier_id
join public.categories cat on cat.id = bl.category_id
left join public.boats b on b.id = bl.boat_id
left join public.trips t on t.id = bl.trip_id;

create view public.v_bill_payments with (security_invoker = true) as
select bp.*, bl.bill_code, bl.invoice_no, bl.boat_id, b.name as boat_name, su.name as supplier_name,
       public.person_name(bp.recorded_by) as recorded_by_name, public.person_name(bp.approved_by) as approved_by_name,
       (select storage_path from public.documents d where d.id = bp.receipt_document_id) as receipt_path
from public.bill_payments bp
join public.bills bl on bl.id = bp.bill_id
join public.suppliers su on su.id = bp.supplier_id
left join public.boats b on b.id = bl.boat_id;

create view public.v_supplier_balances with (security_invoker = true) as
select su.id, su.company_id, su.name, su.name_dv, su.phone, su.email, su.status,
       coalesce(sum(bl.total) filter (where bl.status in ('approved','partially_paid','paid')), 0) as total_billed,
       coalesce(sum(public.bill_paid(bl.id)) filter (where bl.status in ('approved','partially_paid','paid')), 0) as total_paid,
       coalesce(sum(greatest(bl.total - public.bill_paid(bl.id), 0)) filter (where bl.status in ('approved','partially_paid')), 0) as outstanding,
       coalesce(sum(greatest(bl.total - public.bill_paid(bl.id), 0)) filter (where bl.status in ('approved','partially_paid') and bl.due_date < current_date), 0) as overdue,
       count(bl.id) filter (where bl.status in ('approved','partially_paid')) as open_bills,
       coalesce((select sum(overpaid_amount) from public.bill_payments bp where bp.supplier_id = su.id and bp.status = 'valid'), 0) as credit_to_reconcile
from public.suppliers su
left join public.bills bl on bl.supplier_id = su.id
group by su.id;

create view public.v_customer_balances with (security_invoker = true) as
select cu.id, cu.company_id, cu.name, cu.name_dv, cu.phone, cu.status,
       coalesce(sum(s.total) filter (where s.status = 'recorded'), 0) as total_sales,
       coalesce(sum(public.sale_received(s.id)) filter (where s.status = 'recorded'), 0) as total_received,
       coalesce(sum(s.total - public.sale_received(s.id)) filter (where s.status = 'recorded'), 0) as outstanding
from public.customers cu
left join public.fish_sales s on s.customer_id = cu.id
group by cu.id;

create view public.v_cash_advances with (security_invoker = true) as
select a.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name,
       public.advance_recovered(a.id) as recovered,
       case when a.status = 'approved' then a.amount - public.advance_recovered(a.id) else 0 end as outstanding,
       public.person_name(a.created_by) as recorded_by_name, public.person_name(a.approved_by) as approved_by_name,
       (select jsonb_agg(jsonb_build_object('payroll', p.payroll_code, 'amount', r.amount, 'status', r.status, 'date', r.created_at) order by r.created_at)
          from public.advance_recoveries r join public.payroll_periods p on p.id = r.payroll_id where r.advance_id = a.id) as recoveries
from public.cash_advances a
join public.crew_members c on c.id = a.crew_id
join public.boats b on b.id = a.boat_id;

create view public.v_fish_taken with (security_invoker = true) as
select f.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name, t.trip_code,
       ft.name_en as fish_name_en, ft.name_dv as fish_name_dv, p.payroll_code,
       public.person_name(f.created_by) as recorded_by_name, public.person_name(f.approved_by) as approved_by_name
from public.fish_taken f
join public.crew_members c on c.id = f.crew_id
join public.boats b on b.id = f.boat_id
join public.fish_types ft on ft.id = f.fish_type_id
left join public.trips t on t.id = f.trip_id
left join public.payroll_periods p on p.id = f.payroll_id;

create view public.v_payroll_adjustments with (security_invoker = true) as
select a.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name,
       p.payroll_code as target_payroll_code, ap.payroll_code as applied_payroll_code, sp.payroll_code as source_payroll_code,
       public.person_name(a.created_by) as created_by_name, public.person_name(a.approved_by) as approved_by_name
from public.payroll_adjustments a
join public.crew_members c on c.id = a.crew_id
left join public.boats b on b.id = a.boat_id
left join public.payroll_periods p on p.id = a.payroll_id
left join public.payroll_periods ap on ap.id = a.applied_payroll_id
left join public.payroll_periods sp on sp.id = a.source_payroll_id;

create view public.v_wage_rule_versions with (security_invoker = true) as
select v.*, r.name as rule_name, r.boat_id, b.name as boat_name, r.active as rule_active,
       public.person_name(v.approved_by) as approved_by_name
from public.wage_rule_versions v
join public.wage_rules r on r.id = v.rule_id
join public.boats b on b.id = r.boat_id;

create view public.v_payrolls with (security_invoker = true) as
select p.*, b.name as boat_name, b.name_dv as boat_name_dv, t.trip_code, r.name as rule_name, v.version as rule_version,
       public.person_name(p.calculated_by) as calculated_by_name, public.person_name(p.approved_by) as approved_by_name,
       public.person_name(p.finalized_by) as finalized_by_name,
       (select count(*) from public.wage_calculations w where w.payroll_id = p.id)::int as crew_count,
       coalesce((select sum(amount) from public.crew_payments cp where cp.payroll_id = p.id and cp.status = 'valid'), 0) as total_paid
from public.payroll_periods p
join public.boats b on b.id = p.boat_id
left join public.trips t on t.id = p.trip_id
left join public.wage_rule_versions v on v.id = p.rule_version_id
left join public.wage_rules r on r.id = v.rule_id;

create view public.v_wage_calculations with (security_invoker = true) as
select w.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv
from public.wage_calculations w join public.crew_members c on c.id = w.crew_id;

create view public.v_bonuses with (security_invoker = true) as
select bo.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, p.payroll_code, p.boat_id,
       b.name as boat_name, p.status as payroll_status, p.owner_allocation,
       public.person_name(bo.approved_by) as approved_by_name
from public.crew_bonuses bo
join public.crew_members c on c.id = bo.crew_id
join public.payroll_periods p on p.id = bo.payroll_id
join public.boats b on b.id = p.boat_id;

create view public.v_wage_slips with (security_invoker = true) as
select s.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name,
       p.payroll_code, p.period_start, p.period_end, t.trip_code,
       public.crew_paid_for(s.payroll_id, s.crew_id) as amount_paid,
       case when s.status = 'issued' then s.net_payable - public.crew_paid_for(s.payroll_id, s.crew_id) else 0 end as remaining,
       case when s.status <> 'issued' then s.status
            when public.crew_paid_for(s.payroll_id, s.crew_id) >= s.net_payable then 'paid'
            when public.crew_paid_for(s.payroll_id, s.crew_id) > 0 then 'partially_paid' else 'unpaid' end as payment_status,
       (select jsonb_agg(jsonb_build_object('code', cp.payment_code, 'date', cp.date, 'amount', cp.amount,
                 'method', cp.method, 'reference', cp.reference) order by cp.date)
          from public.crew_payments cp where cp.payroll_id = s.payroll_id and cp.crew_id = s.crew_id and cp.status = 'valid') as payments,
       public.person_name(s.generated_by) as generated_by_name
from public.wage_slips s
join public.crew_members c on c.id = s.crew_id
join public.boats b on b.id = s.boat_id
join public.payroll_periods p on p.id = s.payroll_id
left join public.trips t on t.id = p.trip_id;

create view public.v_crew_payments with (security_invoker = true) as
select cp.*, c.crew_code, c.name_en as crew_name_en, c.name_dv as crew_name_dv, b.name as boat_name,
       p.payroll_code, s.slip_no, public.person_name(cp.recorded_by) as recorded_by_name,
       public.person_name(cp.approved_by) as approved_by_name
from public.crew_payments cp
join public.crew_members c on c.id = cp.crew_id
join public.boats b on b.id = cp.boat_id
join public.payroll_periods p on p.id = cp.payroll_id
join public.wage_slips s on s.id = cp.wage_slip_id;

create view public.v_documents with (security_invoker = true) as
select d.*, public.person_name(d.uploaded_by) as uploaded_by_name
from public.documents d;

create view public.v_audit_logs with (security_invoker = true) as
select l.*, public.person_name(l.user_id) as user_name from public.audit_logs l;

create view public.v_approvals with (security_invoker = true) as
select a.*, public.person_name(a.acted_by) as acted_by_name from public.approvals a;

create view public.v_profiles with (security_invoker = true) as
select p.*, coalesce((select array_agg(ub.boat_id) from public.user_boats ub where ub.user_id = p.id), '{}') as boat_ids
from public.profiles p;

-- ---------------------------------------------------------------------
-- Accounting basis (documented in docs/ACCOUNTING.md):
--   Revenue            = recorded fish sales + approved other income
--   Operating expenses = approved expense transactions (incl. approved bills)
--   Operating profit   = Revenue − Operating expenses
--   Crew wages         = gross wages of finalised payrolls (period end in range)
--   Fish taken recovered = fish-taken values deducted in those payrolls
--   Net profit         = Operating profit − Crew wages + Fish taken recovered
-- Cash payments, receipts and advances are balance movements, not P&L.
-- ---------------------------------------------------------------------
create or replace function public.financial_summary(p_from date, p_to date, p_boat uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with s as (
    select coalesce(sum(total), 0) v from public.fish_sales
    where status = 'recorded' and date between p_from and p_to and (p_boat is null or boat_id = p_boat)),
  inc as (
    select coalesce(sum(amount), 0) v from public.transactions
    where status = 'approved' and kind = 'income' and date between p_from and p_to and (p_boat is null or boat_id = p_boat)),
  exp as (
    select coalesce(sum(amount), 0) v from public.transactions
    where status = 'approved' and kind = 'expense' and date between p_from and p_to and (p_boat is null or boat_id = p_boat)),
  pr as (
    select coalesce(sum(total_gross), 0) gross, coalesce(sum(total_bonuses), 0) bonuses,
           coalesce(sum(owner_allocation), 0) owner_alloc, coalesce(sum(owner_remaining), 0) owner_rem
    from public.payroll_periods
    where status = 'finalized' and period_end between p_from and p_to and (p_boat is null or boat_id = p_boat)),
  ftk as (
    select coalesce(sum(f.total), 0) v from public.fish_taken f join public.payroll_periods p on p.id = f.payroll_id
    where p.status = 'finalized' and p.period_end between p_from and p_to and (p_boat is null or p.boat_id = p_boat))
  select jsonb_build_object(
    'fishSales', s.v, 'otherIncome', inc.v, 'revenue', s.v + inc.v, 'expenses', exp.v,
    'operatingProfit', s.v + inc.v - exp.v, 'crewWages', pr.gross, 'bonuses', pr.bonuses,
    'fishTakenRecovered', ftk.v, 'netProfit', s.v + inc.v - exp.v - pr.gross + ftk.v,
    'ownerAllocation', pr.owner_alloc, 'ownerRemaining', pr.owner_rem)
  from s, inc, exp, pr, ftk
$$;

create or replace function public.dashboard_summary(p_from date, p_to date, p_boat uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  select public.financial_summary(p_from, p_to, p_boat) || jsonb_build_object(
    'boatsTotal', (select count(*) from public.boats where p_boat is null or id = p_boat),
    'boatsActive', (select count(*) from public.boats where status = 'active' and (p_boat is null or id = p_boat)),
    'tripsActive', (select count(*) from public.trips where status = 'active' and (p_boat is null or boat_id = p_boat)),
    'tripsCompleted', (select count(*) from public.trips where status in ('returned','under_review','closed')
                         and coalesce(return_date, start_date) between p_from and p_to and (p_boat is null or boat_id = p_boat)),
    'crewActive', (select count(*) from public.v_crew where status = 'active' and (p_boat is null or current_boat_id = p_boat)),
    'attendanceToday', (select jsonb_build_object(
          'present', count(*) filter (where status = 'present'), 'absent', count(*) filter (where status = 'absent'),
          'sick', count(*) filter (where status = 'sick_leave'), 'leave', count(*) filter (where status = 'approved_leave'))
        from public.attendance where date = current_date and (p_boat is null or boat_id = p_boat)),
    'wageLiabilities', (select coalesce(sum(remaining), 0) from public.v_wage_slips where status = 'issued' and (p_boat is null or boat_id = p_boat)),
    'wagesAwaitingPayment', (select count(*) from public.v_wage_slips where status = 'issued' and remaining > 0 and (p_boat is null or boat_id = p_boat)),
    'bonusesAllocated', (select coalesce(sum(b.amount), 0) from public.crew_bonuses b join public.payroll_periods p on p.id = b.payroll_id
                          where b.status = 'approved' and p.status = 'finalized' and p.period_end between p_from and p_to
                            and (p_boat is null or p.boat_id = p_boat)),
    'advancesOutstanding', (select coalesce(sum(outstanding), 0) from public.v_cash_advances where status = 'approved' and (p_boat is null or boat_id = p_boat)),
    'supplierOutstanding', (select coalesce(sum(outstanding), 0) from public.v_bills where (p_boat is null or boat_id = p_boat)),
    'billsUnpaid', (select count(*) from public.bills where status = 'approved' and (p_boat is null or boat_id = p_boat)),
    'billsPartiallyPaid', (select count(*) from public.bills where status = 'partially_paid' and (p_boat is null or boat_id = p_boat)),
    'billsOverdue', (select count(*) from public.v_bills where display_status = 'overdue' and (p_boat is null or boat_id = p_boat)),
    'receivables', (select coalesce(sum(outstanding), 0) from public.v_fish_sales where status = 'recorded' and (p_boat is null or boat_id = p_boat)),
    'payrollPendingApproval', (select count(*) from public.payroll_periods where status = 'pending_approval' and (p_boat is null or boat_id = p_boat)),
    'cashIn', (select coalesce(sum(r.amount), 0) from public.customer_receipts r join public.fish_sales s on s.id = r.sale_id
                where r.status = 'valid' and r.date between p_from and p_to and (p_boat is null or s.boat_id = p_boat))
              + (select coalesce(sum(amount), 0) from public.transactions where kind = 'income' and status = 'approved'
                 and payment_status = 'paid' and date between p_from and p_to and (p_boat is null or boat_id = p_boat)),
    'cashOut', (select coalesce(sum(bp.amount), 0) from public.bill_payments bp join public.bills b on b.id = bp.bill_id
                 where bp.status = 'valid' and bp.date between p_from and p_to and (p_boat is null or b.boat_id = p_boat))
              + (select coalesce(sum(amount), 0) from public.transactions where kind = 'expense' and status = 'approved'
                 and source = 'manual' and payment_status = 'paid' and date between p_from and p_to and (p_boat is null or boat_id = p_boat))
              + (select coalesce(sum(amount), 0) from public.crew_payments where status = 'valid' and date between p_from and p_to
                 and (p_boat is null or boat_id = p_boat))
              + (select coalesce(sum(amount), 0) from public.cash_advances where status = 'approved' and date between p_from and p_to
                 and (p_boat is null or boat_id = p_boat))
  )
$$;

-- Income vs expense series. p_grain: 'day' | 'month' | 'year'
create or replace function public.finance_series(p_from date, p_to date, p_grain text default 'month', p_boat uuid default null)
returns table (period date, income numeric, expense numeric, profit numeric)
language sql stable security invoker set search_path = public as $$
  with buckets as (
    select generate_series(date_trunc(p_grain, p_from)::date, date_trunc(p_grain, p_to)::date,
                           ('1 ' || p_grain)::interval)::date as period),
  inc as (
    select date_trunc(p_grain, date)::date period, sum(total) v from public.fish_sales
    where status = 'recorded' and date between p_from and p_to and (p_boat is null or boat_id = p_boat) group by 1
    union all
    select date_trunc(p_grain, date)::date, sum(amount) from public.transactions
    where status = 'approved' and kind = 'income' and date between p_from and p_to and (p_boat is null or boat_id = p_boat) group by 1),
  exp as (
    select date_trunc(p_grain, date)::date period, sum(amount) v from public.transactions
    where status = 'approved' and kind = 'expense' and date between p_from and p_to and (p_boat is null or boat_id = p_boat) group by 1)
  select b.period,
         coalesce((select sum(v) from inc where inc.period = b.period), 0),
         coalesce((select sum(v) from exp where exp.period = b.period), 0),
         coalesce((select sum(v) from inc where inc.period = b.period), 0) - coalesce((select sum(v) from exp where exp.period = b.period), 0)
  from buckets b order by b.period
$$;

create or replace function public.boat_performance(p_from date, p_to date)
returns table (boat_id uuid, boat_name text, boat_name_dv text, trips bigint, catch_kg numeric, revenue numeric,
               expenses numeric, operating_profit numeric, crew_wages numeric, net_profit numeric)
language sql stable security invoker set search_path = public as $$
  select b.id, b.name, b.name_dv,
    (select count(*) from public.trips t where t.boat_id = b.id and t.start_date between p_from and p_to),
    (select coalesce(sum(quantity), 0) from public.catch_records c where c.boat_id = b.id and c.unit = 'kg' and c.date between p_from and p_to),
    (fs->>'revenue')::numeric, (fs->>'expenses')::numeric, (fs->>'operatingProfit')::numeric,
    (fs->>'crewWages')::numeric, (fs->>'netProfit')::numeric
  from public.boats b, lateral (select public.financial_summary(p_from, p_to, b.id) fs) x
  order by (fs->>'netProfit')::numeric desc
$$;

create or replace function public.recent_activity(p_limit int default 12, p_boat uuid default null)
returns table (kind text, id uuid, code text, date date, description text, amount numeric, direction text, created_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select * from (
    select 'fish_sale', s.id, s.sale_code, s.date, s.fish_name_en || ' ' || s.quantity || ' ' || s.unit, s.total, 'in', s.created_at
      from public.v_fish_sales s where s.status = 'recorded' and (p_boat is null or s.boat_id = p_boat)
    union all
    select x.kind::text, x.id, x.txn_code, x.date, coalesce(x.description, x.category_name_en), x.amount,
           case when x.kind = 'income' then 'in' else 'out' end, x.created_at
      from public.v_transactions x where x.status = 'approved' and (p_boat is null or x.boat_id = p_boat)
    union all
    select 'bill_payment', bp.id, bp.payment_code, bp.date, bp.supplier_name || ' · ' || bp.bill_code, bp.amount, 'out', bp.created_at
      from public.v_bill_payments bp where bp.status = 'valid' and (p_boat is null or bp.boat_id = p_boat)
    union all
    select 'crew_payment', cp.id, cp.payment_code, cp.date, coalesce(cp.crew_name_en, cp.crew_name_dv) || ' · ' || cp.slip_no, cp.amount, 'out', cp.created_at
      from public.v_crew_payments cp where cp.status = 'valid' and (p_boat is null or cp.boat_id = p_boat)
  ) a order by created_at desc limit p_limit
$$;

-- ---------------------------------------------------------------------
-- Notifications: which roles receive which alert
-- ---------------------------------------------------------------------
create table public.notification_settings (
  company_id uuid not null references public.companies(id) on delete cascade,
  alert_key  text not null,
  roles      public.app_role[] not null,
  enabled    boolean not null default true,
  primary key (company_id, alert_key)
);

create or replace function public.alert_enabled(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select ns.enabled and (public.auth_role() = any(ns.roles))
    from public.notification_settings ns
    where ns.company_id = public.auth_company_id() and ns.alert_key = p_key), true)
$$;

create or replace function public.get_alerts()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v jsonb := '[]'::jsonb; n int; v_days int;
begin
  select coalesce((settings->>'bill_due_soon_days')::int, 7) into v_days from public.companies where id = public.auth_company_id();
  if public.has_perm('bills.view') then
    if public.alert_enabled('bills_pending_approval') then
      select count(*) into n from public.bills where status = 'pending_approval';
      if n > 0 then v := v || jsonb_build_object('key','bills_pending_approval','severity','info','count',n,'link','/bills?status=pending_approval'); end if;
    end if;
    if public.alert_enabled('bills_due_soon') then
      select count(*) into n from public.v_bills where status in ('approved','partially_paid') and outstanding > 0
        and due_date between current_date and current_date + v_days;
      if n > 0 then v := v || jsonb_build_object('key','bills_due_soon','severity','warning','count',n,'link','/bills?status=due_soon'); end if;
    end if;
    if public.alert_enabled('bills_overdue') then
      select count(*) into n from public.v_bills where display_status = 'overdue';
      if n > 0 then v := v || jsonb_build_object('key','bills_overdue','severity','danger','count',n,'link','/bills?status=overdue'); end if;
    end if;
    if public.alert_enabled('bills_partially_paid') then
      select count(*) into n from public.bills where status = 'partially_paid';
      if n > 0 then v := v || jsonb_build_object('key','bills_partially_paid','severity','info','count',n,'link','/bills?status=partially_paid'); end if;
    end if;
    if public.alert_enabled('missing_documents') then
      select (select count(*) from public.v_bills where status not in ('voided','rejected') and document_count = 0)
           + (select count(*) from public.v_transactions where status = 'approved' and source = 'manual' and kind = 'expense' and not has_document)
           + (select count(*) from public.bill_payments where status = 'valid' and method <> 'cash' and receipt_document_id is null)
        into n;
      if n > 0 then v := v || jsonb_build_object('key','missing_documents','severity','warning','count',n,'link','/bills?missing=1'); end if;
    end if;
    if public.alert_enabled('possible_duplicates') then
      select count(*) into n from public.bills b where b.status = 'draft' and exists (
        select 1 from public.find_bill_duplicates(b.supplier_id, b.invoice_no, b.bill_date, b.total, b.id));
      if n > 0 then v := v || jsonb_build_object('key','possible_duplicates','severity','warning','count',n,'link','/bills?status=draft'); end if;
    end if;
  end if;
  if public.has_perm('trips.view') and public.alert_enabled('trips_missing_records') then
    select count(*) into n from public.trips t
     where (t.status in ('returned','under_review') and not exists (select 1 from public.fish_sales s where s.trip_id = t.id and s.status = 'recorded')
                                                      and not exists (select 1 from public.catch_records c where c.trip_id = t.id))
        or (t.status = 'active' and t.return_date is not null and t.return_date < current_date);
    if n > 0 then v := v || jsonb_build_object('key','trips_missing_records','severity','warning','count',n,'link','/trips?attention=1'); end if;
  end if;
  if public.has_perm('payroll.view') then
    if public.alert_enabled('payroll_pending_approval') then
      select count(*) into n from public.payroll_periods where status = 'pending_approval';
      if n > 0 then v := v || jsonb_build_object('key','payroll_pending_approval','severity','info','count',n,'link','/payroll?status=pending_approval'); end if;
    end if;
    if public.alert_enabled('allocation_warnings') then
      select count(*) into n from public.payroll_periods where status in ('calculated','pending_approval','approved')
        and jsonb_array_length(warnings) > 0;
      if n > 0 then v := v || jsonb_build_object('key','allocation_warnings','severity','danger','count',n,'link','/payroll'); end if;
    end if;
  end if;
  if public.has_perm('crew_payments.view') and public.alert_enabled('unpaid_wages') then
    select count(*) into n from public.v_wage_slips where status = 'issued' and remaining > 0;
    if n > 0 then v := v || jsonb_build_object('key','unpaid_wages','severity','warning','count',n,'link','/crew-payments'); end if;
  end if;
  if public.has_perm('advances.view') and public.alert_enabled('advances_outstanding') then
    select count(*) into n from public.v_cash_advances where status = 'approved' and outstanding > 0;
    if n > 0 then v := v || jsonb_build_object('key','advances_outstanding','severity','info','count',n,'link','/advances'); end if;
  end if;
  if public.has_perm('advances.approve') or public.has_perm('fish_taken.approve') or public.has_perm('bonuses.approve') or public.has_perm('adjustments.approve') then
    if public.alert_enabled('records_pending_approval') then
      select (select count(*) from public.cash_advances where status = 'pending_approval')
           + (select count(*) from public.fish_taken where status = 'pending_approval')
           + (select count(*) from public.crew_bonuses where status = 'pending_approval')
           + (select count(*) from public.payroll_adjustments where status = 'pending_approval')
           + (select count(*) from public.transactions where status = 'pending_approval')
        into n;
      if n > 0 then v := v || jsonb_build_object('key','records_pending_approval','severity','info','count',n,'link','/approvals'); end if;
    end if;
  end if;
  return v;
end $$;
