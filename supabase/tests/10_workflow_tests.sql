-- =====================================================================
-- Galary database tests (run on a local PostgreSQL with 00_supabase_stubs.sql)
--   psql -v ON_ERROR_STOP=1 -d galary_test -f supabase/tests/10_workflow_tests.sql
-- Each block impersonates a user the same way Supabase does (role
-- "authenticated" + JWT subject) and asserts the expected outcome.
-- =====================================================================
\set ON_ERROR_STOP 1
\pset pager off

create schema if not exists test;
grant usage on schema test to authenticated, service_role;

create or replace function test.expect_error(p_sql text, p_pattern text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm !~* p_pattern then
      raise exception 'Expected error matching "%" but got: %', p_pattern, sqlerrm;
    end if;
    raise notice 'ok (expected error): %', left(sqlerrm, 90);
    return;
  end;
  raise exception 'Expected an error matching "%" but the statement succeeded: %', p_pattern, p_sql;
end $$;

create or replace function test.eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'ok: % = %', p_label, p_actual;
end $$;
grant execute on all functions in schema test to authenticated, service_role;

create table test.ids (k text primary key, v uuid);
grant all on test.ids to authenticated, service_role;
create or replace function test.id(p text) returns uuid language sql stable as $$ select v from test.ids where k = p $$;
create or replace function test.put(p text, v uuid) returns uuid language sql as $$
  insert into test.ids values (p, v) on conflict (k) do update set v = excluded.v returning v $$;
grant execute on all functions in schema test to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.mv'),
  ('00000000-0000-0000-0000-000000000002', 'manager@test.mv'),
  ('00000000-0000-0000-0000-000000000003', 'payroll@test.mv'),
  ('00000000-0000-0000-0000-000000000004', 'accounts@test.mv'),
  ('00000000-0000-0000-0000-000000000005', 'viewer@test.mv'),
  ('00000000-0000-0000-0000-000000000009', 'other@other.mv');

-- Owner signs up and bootstraps a company
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select test.put('company', public.bootstrap_company('Test Fishing Pvt Ltd', 'Ahmed Owner', 'en'));
select test.eq((select count(*)::int from public.categories), 13, 'default categories seeded');
select test.expect_error($$select public.bootstrap_company('Again', 'x')$$, 'already belongs');

-- Another company (tenant isolation)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
select test.put('company2', public.bootstrap_company('Other Co', 'Other Owner', 'dv'));
reset role;

-- Staff profiles (created by the invite-user edge function in production)
insert into public.profiles(id, company_id, full_name, email, role) values
  ('00000000-0000-0000-0000-000000000002', test.id('company'), 'Moosa Manager', 'manager@test.mv', 'manager'),
  ('00000000-0000-0000-0000-000000000003', test.id('company'), 'Aisha Payroll', 'payroll@test.mv', 'payroll_officer'),
  ('00000000-0000-0000-0000-000000000004', test.id('company'), 'Ibrahim Accounts', 'accounts@test.mv', 'accountant'),
  ('00000000-0000-0000-0000-000000000005', test.id('company'), 'Viewer', 'viewer@test.mv', 'readonly');

-- ---------------------------------------------------------------------
-- Owner: boats, crew, access
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
with i as (insert into public.boats(name, registration_no) values ('Dhoani A', 'REG-A') returning id) select test.put('boatA', id) from i;
with i as (insert into public.boats(name, registration_no) values ('Dhoani B', 'REG-B') returning id) select test.put('boatB', id) from i;
select test.expect_error($$insert into public.boats(name, registration_no) values ('Dup', 'REG-A')$$, 'duplicate key');

with i as (insert into public.crew_members(name_en, name_dv, job_role) values ('Hassan Captain', 'ހަސަން', 'captain') returning id) select test.put('c1', id) from i;
with i as (insert into public.crew_members(name_en, job_role) values ('Ali Fisher', 'fisherman') returning id) select test.put('c2', id) from i;
with i as (insert into public.crew_members(name_dv, job_role) values ('މުހައްމަދު', 'fisherman') returning id) select test.put('c3', id) from i;
select test.expect_error($$insert into public.crew_members(job_role) values ('x')$$, 'check constraint');
select test.eq((select crew_code from public.crew_members where id = test.id('c1')), 'CRW-00001', 'crew code generated');

select public.assign_crew_to_boat(test.id('c1'), test.id('boatA'), '2026-01-01', 'captain');
select public.assign_crew_to_boat(test.id('c2'), test.id('boatA'), '2026-01-01', 'fisherman');
select public.assign_crew_to_boat(test.id('c3'), test.id('boatB'), '2026-01-01', 'fisherman');
-- moving crew keeps history
select public.assign_crew_to_boat(test.id('c3'), test.id('boatA'), '2026-02-01', 'fisherman');
select test.eq((select count(*)::int from public.boat_assignments where crew_id = test.id('c3')), 2, 'assignment history kept');
select test.eq((select current_boat_id from public.v_crew where id = test.id('c3')), test.id('boatA'), 'current boat updated');

-- Manager may only access boat A
insert into public.user_boats(user_id, boat_id) values ('00000000-0000-0000-0000-000000000002', test.id('boatA'));
insert into public.user_boats(user_id, boat_id) values ('00000000-0000-0000-0000-000000000003', test.id('boatA'));
update public.profiles set all_boats = true where id = '00000000-0000-0000-0000-000000000004';  -- accountant: whole fleet

-- ---------------------------------------------------------------------
-- Permission and tenant isolation
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select test.eq((select count(*)::int from public.boats), 1, 'manager sees only assigned boat');
select test.expect_error($$insert into public.boats(name, registration_no) values ('X', 'REG-X')$$, 'row-level security');
select test.expect_error($$update public.profiles set role = 'owner' where id = auth.uid()$$, 'permission_denied|Only an owner');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
select test.eq((select count(*)::int from public.boats), 0, 'other company sees no boats');
select test.eq((select count(*)::int from public.crew_members), 0, 'other company sees no crew');
select test.expect_error(format($$select public.assign_crew_to_boat(%L, null)$$, test.id('c1')), 'permission|not found');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select test.eq((select count(*)::int from public.boats), 0, 'read-only user without boat assignment sees no boats');

-- ---------------------------------------------------------------------
-- Trips, attendance, catch & sales
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
with i as (insert into public.trips(boat_id, start_date, return_date, status) values (test.id('boatA'), '2026-03-01', '2026-03-05', 'active') returning id) select test.put('trip', id) from i;
insert into public.trip_crew(trip_id, crew_id, job_role) values
  (test.id('trip'), test.id('c1'), 'captain'), (test.id('trip'), test.id('c2'), 'fisherman'), (test.id('trip'), test.id('c3'), 'fisherman');
select test.expect_error(format($$update public.trips set status = 'closed' where id = %L$$, test.id('trip')), 'status actions');

insert into public.attendance(boat_id, trip_id, crew_id, date, status)
select test.id('boatA'), test.id('trip'), c, d::date, case when c = test.id('c3') and d::date = '2026-03-05' then 'absent' else 'present' end::public.attendance_status
from unnest(array[test.id('c1'), test.id('c2'), test.id('c3')]) c, generate_series('2026-03-01'::date, '2026-03-05'::date, '1 day') d;
select test.expect_error(format($$insert into public.attendance(boat_id, crew_id, date, status) values (%L, %L, '2026-03-01', 'present')$$,
       test.id('boatA'), test.id('c1')), 'duplicate key');

with i as (insert into public.catch_records(trip_id, boat_id, date, fish_type_id, quantity, unit)
  select test.id('trip'), test.id('boatA'), '2026-03-04', id, 1200, 'kg' from public.fish_types where name_en = 'Skipjack tuna' returning id) select test.put('catch', id) from i;
select test.expect_error(format($$insert into public.catch_records(trip_id, boat_id, date, fish_type_id, quantity) select %L, %L, '2026-03-04', id, 5 from public.fish_types limit 1$$,
       test.id('trip'), test.id('boatB')), 'boat must match|row-level');

with i as (insert into public.customers(name) values ('MIFCO') returning id) select test.put('cust', id) from i;
with i as (insert into public.fish_sales(trip_id, boat_id, date, fish_type_id, quantity, unit, unit_price, customer_id)
  select test.id('trip'), test.id('boatA'), '2026-03-05', id, 1000, 'kg', 20, test.id('cust') from public.fish_types where name_en = 'Skipjack tuna' returning id) select test.put('sale', id) from i;
select test.eq((select total from public.fish_sales where id = test.id('sale')), 20000.00::numeric(14,2), 'sale total computed');
select test.put('rcpt_req', gen_random_uuid());
select public.record_customer_receipt(test.id('sale'), '2026-03-05', 15000, 'bank_transfer', 'TT-001', null, test.id('rcpt_req'));
select public.record_customer_receipt(test.id('sale'), '2026-03-05', 15000, 'bank_transfer', 'TT-001', null, test.id('rcpt_req')); -- retry: no duplicate
select test.eq((select outstanding from public.v_fish_sales where id = test.id('sale')), 5000.00::numeric, 'customer outstanding after receipt');
select test.expect_error(format($$select public.record_customer_receipt(%L, '2026-03-06', 6000, 'cash')$$, test.id('sale')), 'exceeds outstanding');
select test.eq((select remaining from public.v_trip_fish_stock where trip_id = test.id('trip')), 200.000::numeric, 'stock: caught - sold');

-- Manual expense by manager is pending until approved
with i as (insert into public.transactions(kind, date, category_id, amount, boat_id, trip_id, description, status)
  select 'expense', '2026-03-02', id, 1500, test.id('boatA'), test.id('trip'), 'Ice', 'approved' from public.categories where code = 'ice' returning id, status) select test.put('exp1', id) from i;
select test.eq((select status::text from public.transactions where id = test.id('exp1')), 'pending_approval', 'manager cannot self-approve');
select test.expect_error(format($$select public.set_transaction_status(%L, 'approve')$$, test.id('exp1')), 'permission_denied');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);  -- accountant
select public.set_transaction_status(test.id('exp1'), 'approve');
select test.expect_error(format($$update public.transactions set amount = 1 where id = %L$$, test.id('exp1')), 'cannot be edited');

-- ---------------------------------------------------------------------
-- Bills, approval, payments, duplicates
-- ---------------------------------------------------------------------
with i as (insert into public.suppliers(name) values ('Fuel Supplies Pvt Ltd') returning id) select test.put('sup', id) from i;
with i as (insert into public.bills(supplier_id, invoice_no, bill_date, due_date, category_id, boat_id, trip_id, subtotal, tax_amount, description)
  select test.id('sup'), 'INV-100', '2026-03-01', '2026-03-31', id, test.id('boatA'), test.id('trip'), 5000, 400, 'Diesel' from public.categories where code = 'fuel' returning id) select test.put('bill1', id) from i;
select test.eq((select total from public.bills where id = test.id('bill1')), 5400.00::numeric(14,2), 'bill total = subtotal + tax');
select test.expect_error(format($$select public.submit_bill(%L)$$, test.id('bill1')), 'original_document');
insert into public.documents(entity_type, entity_id, boat_id, doc_kind, storage_path, file_name, mime_type, size_bytes)
values ('bill', test.id('bill1'), test.id('boatA'), 'bill', test.id('company') || '/bills/inv100.pdf', 'inv100.pdf', 'application/pdf', 12345);
select test.expect_error(format($$insert into public.documents(entity_type, entity_id, storage_path, file_name, mime_type, size_bytes) values ('bill', %L, %L, 'x.exe', 'application/x-msdownload', 10)$$,
       test.id('bill1'), test.id('company') || '/bills/x.exe'), 'check constraint');
select public.submit_bill(test.id('bill1'));
select test.expect_error(format($$update public.bills set subtotal = 1 where id = %L$$, test.id('bill1')), 'Only draft bills');
select test.expect_error(format($$select public.approve_bill(%L)$$, test.id('bill1')), 'permission_denied');  -- accountant cannot approve
select test.expect_error(format($$select public.record_bill_payment(%L, '2026-03-10', 100, 'cash')$$, test.id('bill1')), 'approved, unpaid');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);  -- owner approves
select public.approve_bill(test.id('bill1'), 'ok');
select test.eq((select count(*)::int from public.transactions where bill_id = test.id('bill1')), 1, 'one expense created on approval');
select test.eq((select amount from public.transactions where bill_id = test.id('bill1')), 5400.00::numeric(14,2), 'expense amount = bill total');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);  -- accountant pays
select test.put('pay_req', gen_random_uuid());
select test.put('pay1', public.record_bill_payment(test.id('bill1'), '2026-03-10', 2000, 'bank_transfer', 'BML-555', null, test.id('pay_req')));
select test.eq(public.record_bill_payment(test.id('bill1'), '2026-03-10', 2000, 'bank_transfer', 'BML-555', null, test.id('pay_req')), test.id('pay1'), 'retried payment is idempotent');
select test.eq((select status::text from public.bills where id = test.id('bill1')), 'partially_paid', 'bill partially paid');
select test.eq((select outstanding from public.v_bills where id = test.id('bill1')), 3400.00::numeric, 'outstanding = total - payments');
select test.expect_error(format($$select public.record_bill_payment(%L, '2026-03-11', 100, 'bank_transfer', 'bml-555')$$, test.id('bill1')), 'duplicate key');
select test.expect_error(format($$select public.record_bill_payment(%L, '2026-03-11', 5000, 'cash')$$, test.id('bill1')), 'overpayment');
select test.expect_error(format($$select public.record_bill_payment(%L, '2026-03-11', 5000, 'cash', null, null, null, 'Prepay next bill')$$, test.id('bill1')), 'permission_denied');
select public.record_bill_payment(test.id('bill1'), '2026-03-12', 3400, 'cash');
select test.eq((select status::text from public.bills where id = test.id('bill1')), 'paid', 'bill fully paid');
select test.eq((select payment_status::text from public.transactions where bill_id = test.id('bill1')), 'paid', 'expense payment status synced');
select test.eq((select count(*)::int from public.transactions where bill_id = test.id('bill1')), 1, 'installments did not add expenses');
select test.expect_error($$insert into public.bill_payments(company_id, bill_id, supplier_id, date, amount, applied_amount, method) values (public.auth_company_id(), test.id('bill1'), test.id('sup'), current_date, 1, 1, 'cash')$$, 'row-level|payment actions');

-- Duplicate detection
with i as (insert into public.bills(supplier_id, invoice_no, bill_date, category_id, boat_id, subtotal)
  select test.id('sup'), 'inv-100 ', '2026-03-03', id, test.id('boatA'), 999 from public.categories where code = 'fuel' returning id) select test.put('bill2', id) from i;
insert into public.documents(entity_type, entity_id, boat_id, doc_kind, storage_path, file_name, mime_type, size_bytes)
values ('bill', test.id('bill2'), test.id('boatA'), 'bill', test.id('company') || '/bills/dup.jpg', 'dup.jpg', 'image/jpeg', 2222);
select test.eq((select count(*)::int from public.find_bill_duplicates(test.id('sup'), 'INV-100', '2026-03-03', 999, test.id('bill2'))), 1, 'duplicate found by invoice no');
select test.expect_error(format($$select public.submit_bill(%L)$$, test.id('bill2')), 'possible_duplicate');
select test.expect_error(format($$select public.submit_bill(%L, 'Supplier reused number')$$, test.id('bill2')), 'permission_denied');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.submit_bill(test.id('bill2'), 'Supplier confirmed this is a separate delivery');
select test.eq((select duplicate_override_by from public.bills where id = test.id('bill2')), '00000000-0000-0000-0000-000000000001'::uuid, 'override recorded');
select public.reject_bill(test.id('bill2'), 'Actually a duplicate');
select test.expect_error(format($$select public.void_bill(%L, 'x')$$, test.id('bill1')), 'Void the payments');

-- Payment void restores balance
select public.void_bill_payment(test.id('pay1'), 'Bank reversed transfer');
select test.eq((select status::text from public.bills where id = test.id('bill1')), 'partially_paid', 'status after void');
select test.eq((select outstanding from public.v_bills where id = test.id('bill1')), 2000.00::numeric, 'outstanding after void');

-- ---------------------------------------------------------------------
-- Advances, fish taken, adjustments, bonus
-- ---------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);  -- payroll officer
with i as (insert into public.cash_advances(crew_id, boat_id, date, amount, reason, method) values (test.id('c2'), test.id('boatA'), '2026-02-20', 1000, 'Family need', 'cash') returning id) select test.put('adv', id) from i;
with i as (insert into public.fish_taken(crew_id, boat_id, trip_id, date, fish_type_id, quantity, unit, unit_price)
  select test.id('c3'), test.id('boatA'), test.id('trip'), '2026-03-05', id, 10, 'kg', 25 from public.fish_types where name_en = 'Skipjack tuna' returning id) select test.put('ftk', id) from i;
select test.expect_error(format($$select public.set_record_status('cash_advances', %L, 'approve')$$, test.id('adv')), 'permission_denied');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select public.set_record_status('cash_advances', test.id('adv'), 'approve');
select public.set_record_status('fish_taken', test.id('ftk'), 'approve');
select test.expect_error(format($$update public.cash_advances set amount = 5 where id = %L$$, test.id('adv')), 'locked');

-- Wage rule: net trip profit, 50% to crew, role weights
with i as (insert into public.wage_rules(boat_id, name) values (test.id('boatA'), 'Standard share') returning id) select test.put('rule', id) from i;
with i as (insert into public.wage_rule_versions(rule_id, effective_from, config) values (test.id('rule'), '2026-01-01',
  '{"base":"net_trip_profit","method":"role","crewSharePercent":50,"roleWeights":{"captain":2,"fisherman":1},"rounding":{"mode":"nearest","increment":1}}') returning id) select test.put('rv', id) from i;
select public.approve_wage_rule_version(test.id('rv'));
select test.expect_error(format($$update public.wage_rule_versions set config = '{"base":"gross_income","method":"equal"}' where id = %L$$, test.id('rv')), 'locked');

with i as (insert into public.payroll_periods(boat_id, trip_id, period_start, period_end, rule_version_id) values (test.id('boatA'), test.id('trip'), '2000-01-01', '2000-01-01', test.id('rv')) returning id) select test.put('pr', id) from i;
select test.eq((select period_start from public.payroll_periods where id = test.id('pr')), '2026-03-01'::date, 'trip payroll uses trip dates');
with i as (insert into public.crew_bonuses(payroll_id, crew_id, kind, percent, status) values (test.id('pr'), test.id('c1'), 'percent', 10, 'approved') returning id) select test.put('bonus', id) from i;
select test.expect_error(format($$insert into public.payroll_periods(boat_id, trip_id, period_start, period_end) values (%L, %L, '2026-03-01', '2026-03-05')$$,
       test.id('boatA'), test.id('trip')), 'duplicate key');

-- Inputs as the engine sees them
select test.eq(((public.payroll_inputs(test.id('pr')))->'inputs'->'financials'->>'grossIncome')::numeric, 20000::numeric, 'payroll gross income');
select test.eq(((public.payroll_inputs(test.id('pr')))->'inputs'->'financials'->>'expenses')::numeric, 6900::numeric, 'payroll expenses (bill + ice)');
select test.eq(jsonb_array_length((public.payroll_inputs(test.id('pr')))->'inputs'->'crew'), 3, 'payroll crew');
select test.eq(jsonb_array_length((public.payroll_inputs(test.id('pr')))->'inputs'->'advances'), 1, 'advance included');
select test.eq(jsonb_array_length((public.payroll_inputs(test.id('pr')))->'inputs'->'fishTaken'), 1, 'fish taken included');
select test.put('hash_holder', null);
create temp table tmp_inputs as select public.payroll_inputs(test.id('pr')) as j;
grant select on tmp_inputs to service_role;
reset role;

-- The trusted backend writes the engine result (values from the TS engine for these inputs):
-- base 20000-6900 = 13100; pool 6550 split 2:1:1 = 3275 / 1637.50 / 1637.50 -> rounded 3275/1638/1637
-- owner allocation 6550 (+ rounding), bonus 10% of owner allocation to captain
set role service_role;
select set_config('request.jwt.claim.sub', '', false);   -- service role requests carry no user
select test.expect_error(format($$select public.apply_payroll_calculation(%L, 'bad-hash', '{}'::jsonb, '00000000-0000-0000-0000-000000000003')$$, test.id('pr')), 'inputs changed');
select public.apply_payroll_calculation(test.id('pr'), (select j->>'hash' from tmp_inputs), jsonb_build_object(
  'summary', jsonb_build_object('baseAmount', 13100, 'crewPool', 6550, 'ownerAllocation', 6550, 'totalBonuses', 655,
     'ownerRemaining', 5895, 'totalGross', 7205, 'totalDeductions', 1250, 'totalNet', 5955),
  'warnings', '[]'::jsonb, 'errors', '[]'::jsonb,
  'bonuses', jsonb_build_array(jsonb_build_object('id', test.id('bonus'), 'amount', 655)),
  'crew', jsonb_build_array(
    jsonb_build_object('crewId', test.id('c1'), 'role', 'captain', 'daysPresent', 5, 'daysEligible', 5, 'shareWeight', 2,
      'ordinaryWage', 3275, 'percentageShare', 0, 'fixedWage', 0, 'attendanceAdjustment', 0, 'bonus', 655, 'otherEarnings', 0,
      'gross', 3930, 'advanceDeduction', 0, 'fishDeduction', 0, 'otherDeductions', 0, 'carryForwardDeduction', 0,
      'totalDeductions', 0, 'net', 3930, 'unrecoveredAdvance', 0, 'negativeBalance', 0, 'details', '{}'::jsonb),
    jsonb_build_object('crewId', test.id('c2'), 'role', 'fisherman', 'daysPresent', 5, 'daysEligible', 5, 'shareWeight', 1,
      'ordinaryWage', 1638, 'percentageShare', 0, 'fixedWage', 0, 'attendanceAdjustment', 0, 'bonus', 0, 'otherEarnings', 0,
      'gross', 1638, 'advanceDeduction', 1000, 'fishDeduction', 0, 'otherDeductions', 0, 'carryForwardDeduction', 0,
      'totalDeductions', 1000, 'net', 638, 'unrecoveredAdvance', 0, 'negativeBalance', 0,
      'details', jsonb_build_object('advances', jsonb_build_array(jsonb_build_object('id', test.id('adv'), 'code', 'ADV-00001', 'amount', 1000)))),
    jsonb_build_object('crewId', test.id('c3'), 'role', 'fisherman', 'daysPresent', 4, 'daysEligible', 5, 'shareWeight', 1,
      'ordinaryWage', 1637, 'percentageShare', 0, 'fixedWage', 0, 'attendanceAdjustment', 0, 'bonus', 0, 'otherEarnings', 0,
      'gross', 1637, 'advanceDeduction', 0, 'fishDeduction', 250, 'otherDeductions', 0, 'carryForwardDeduction', 0,
      'totalDeductions', 250, 'net', 1387, 'unrecoveredAdvance', 0, 'negativeBalance', 0,
      'details', jsonb_build_object('fishTaken', jsonb_build_array(jsonb_build_object('id', test.id('ftk'), 'code', 'FTK-00001', 'amount', 250)))))
), '00000000-0000-0000-0000-000000000003');
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
select test.expect_error($$select public.apply_payroll_calculation(test.id('pr'), 'x', '{}'::jsonb, auth.uid())$$, 'permission denied');
select test.expect_error(format($$update public.payroll_periods set total_net = 1 where id = %L$$, test.id('pr')), 'payroll actions');
select public.submit_payroll(test.id('pr'));
select test.expect_error(format($$select public.approve_payroll(%L)$$, test.id('pr')), 'permission_denied');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
select test.expect_error(format($$update public.crew_bonuses set percent = 50 where id = %L$$, test.id('bonus')), 'locked');
select public.approve_payroll(test.id('pr'), 'Looks right');
select test.eq(public.finalize_payroll(test.id('pr')), 3, 'slips generated');
select test.eq((select outstanding from public.v_cash_advances where id = test.id('adv')), 0::numeric, 'advance recovered once');
select test.eq((select payroll_id from public.fish_taken where id = test.id('ftk')), test.id('pr'), 'fish taken marked deducted');
select test.expect_error(format($$select public.finalize_payroll(%L)$$, test.id('pr')), 'Only approved');
select test.expect_error(format($$update public.attendance set status = 'absent' where crew_id = %L and date = '2026-03-02'$$, test.id('c1')), 'finalised payroll');
select test.expect_error(format($$select public.set_record_status('cash_advances', %L, 'void', 'oops')$$, test.id('adv')), 'already been applied');

-- Crew payments
select test.put('slip2', (select id from public.wage_slips where crew_id = test.id('c2') and payroll_id = test.id('pr')));
select test.eq((select net_payable from public.wage_slips where id = test.id('slip2')), 638.00::numeric(14,2), 'slip net payable');
select test.put('cp1', public.record_crew_payment(test.id('slip2'), '2026-03-20', 500, 'cash'));
select test.eq((select remaining from public.v_wage_slips where id = test.id('slip2')), 138.00::numeric, 'remaining after partial payment');
select test.expect_error(format($$select public.record_crew_payment(%L, '2026-03-21', 139, 'cash')$$, test.id('slip2')), 'exceeds the remaining');
select test.eq((select net_payable from public.wage_slips where id = test.id('slip2')), 638.00::numeric(14,2), 'payment did not change slip');
update public.wage_slips set net_payable = 1 where id = test.id('slip2');   -- no update policy: affects 0 rows
select test.eq((select net_payable from public.wage_slips where id = test.id('slip2')), 638.00::numeric(14,2), 'slip cannot be edited directly');

-- Reissue keeps amounts and payment link
select test.put('slip2b', public.reissue_wage_slip(test.id('slip2'), 'Corrected Dhivehi name'));
select test.eq((select remaining from public.v_wage_slips where id = test.id('slip2b')), 138.00::numeric, 'remaining carried to new version');
select test.eq((select version from public.wage_slips where id = test.id('slip2b')), 2, 'slip version 2');

-- Reversal is blocked while payments exist
select test.expect_error(format($$select public.reverse_payroll(%L, 'Wrong rule')$$, test.id('pr')), 'Void the crew payments');
select public.void_crew_payment(test.id('cp1'), 'Recorded in error');
select public.reverse_payroll(test.id('pr'), 'Wrong rule');
select test.eq((select outstanding from public.v_cash_advances where id = test.id('adv')), 1000::numeric, 'advance outstanding restored after reversal');
select test.eq((select payroll_id from public.fish_taken where id = test.id('ftk')), null::uuid, 'fish taken released after reversal');

-- ---------------------------------------------------------------------
-- Trip closing checks and reports
-- ---------------------------------------------------------------------
select public.set_trip_status(test.id('trip'), 'returned');
select public.set_trip_status(test.id('trip'), 'under_review');
select public.set_trip_status(test.id('trip'), 'closed', 'All records complete');
select test.expect_error(format($$insert into public.catch_records(trip_id, boat_id, date, fish_type_id, quantity) select %L, %L, '2026-03-04', id, 5 from public.fish_types limit 1$$,
       test.id('trip'), test.id('boatA')), 'Trip is closed');

select test.eq((public.financial_summary('2026-01-01', '2026-12-31')->>'revenue')::numeric, 20000::numeric, 'report revenue');
select test.eq((public.financial_summary('2026-01-01', '2026-12-31')->>'expenses')::numeric, 6900::numeric, 'report expenses');
select test.eq((public.dashboard_summary('2026-01-01', '2026-12-31')->>'supplierOutstanding')::numeric, 2000::numeric, 'dashboard supplier outstanding');
select test.eq((public.dashboard_summary('2026-01-01', '2026-12-31')->>'receivables')::numeric, 5000::numeric, 'dashboard receivables');
select test.eq((select count(*)::int from public.finance_series('2026-01-01', '2026-12-31', 'month')), 12, 'monthly series has 12 buckets');
select test.eq(jsonb_typeof(public.get_alerts()), 'array', 'alerts returned');
select test.eq((select count(*)::int from public.audit_logs where table_name = 'bills') > 0, true, 'audit log populated');

-- Read-only user: no financial rows
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
select test.eq((select count(*)::int from public.transactions), 0, 'read-only sees no transactions');
select test.eq((select count(*)::int from public.audit_logs), 0, 'read-only sees no audit');
select test.expect_error($$select public.void_bill(test.id('bill1'), 'x')$$, 'permission_denied');

-- Storage: object visible only if the documents row is visible
reset role;
insert into storage.objects(bucket_id, name, owner_id) values ('documents', test.id('company') || '/bills/inv100.pdf', '00000000-0000-0000-0000-000000000004');
insert into storage.objects(bucket_id, name, owner_id) values ('documents', test.id('company') || '/bills/orphan.pdf', '00000000-0000-0000-0000-000000000004');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
select test.eq((select count(*)::int from storage.objects where name like '%inv100.pdf'), 1, 'manager can read bill file of own boat');
select test.eq((select count(*)::int from storage.objects where name like '%orphan.pdf'), 0, 'manager cannot read others unregistered upload');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', false);
select test.eq((select count(*)::int from storage.objects), 0, 'other company cannot read files');
reset role;

\echo 'ALL DATABASE TESTS PASSED'
