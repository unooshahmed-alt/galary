-- =====================================================================
-- Galary — 0004 Wage rules, bonuses, advances, fish taken, adjustments,
--            payroll periods, wage slips and crew payments.
--
-- Money flow:
--   wage calculation (entitlement)  -> wage_calculations / wage_slips
--   wage payment (cash)             -> crew_payments (never edits slips)
--   advance recovery                -> advance_recoveries (once per payroll)
--   fish taken deduction            -> fish_taken.payroll_id (once)
--   adjustments                     -> payroll_adjustments.applied_payroll_id (once)
-- =====================================================================

create type public.payroll_status as enum (
  'draft', 'calculated', 'pending_approval', 'approved', 'finalized', 'reversed');

-- ---------------------------------------------------------------------
-- Wage rules with immutable approved versions
-- ---------------------------------------------------------------------
create table public.wage_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  boat_id     uuid not null references public.boats(id) on delete restrict,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index wage_rules_boat_idx on public.wage_rules(boat_id);

create table public.wage_rule_versions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  rule_id        uuid not null references public.wage_rules(id) on delete restrict,
  version        int not null,
  effective_from date not null,
  effective_to   date,
  config         jsonb not null,
  status         public.approval_status not null default 'draft',
  notes          text,
  created_by     uuid references auth.users(id),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (rule_id, version),
  check (effective_to is null or effective_to >= effective_from),
  check (config ? 'base' and config ? 'method')
);

create or replace function public.guard_wage_rule_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    select coalesce(max(version), 0) + 1 into new.version from public.wage_rule_versions where rule_id = new.rule_id;
    if new.status not in ('draft','pending_approval') and auth.uid() is not null then
      new.status := 'draft';
    end if;
    return new;
  end if;
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  if old.status in ('approved','voided','rejected') then
    raise exception 'Approved wage rule versions are locked. Create a new version instead.';
  end if;
  if new.status is distinct from old.status then
    raise exception 'Use the approval actions to change status';
  end if;
  return new;
end $$;
create trigger wage_rule_versions_guard before insert or update on public.wage_rule_versions
  for each row execute function public.guard_wage_rule_version();

create or replace function public.approve_wage_rule_version(p_version uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_cfg jsonb; v_sum numeric;
begin
  perform public.require_perm('wage_rules.approve');
  select v2.*, r.boat_id into v from public.wage_rule_versions v2 join public.wage_rules r on r.id = v2.rule_id
  where v2.id = p_version for update of v2;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'wage rule version not found'; end if;
  if v.status not in ('draft','pending_approval') then raise exception 'Version is not awaiting approval'; end if;
  v_cfg := v.config;
  if (v_cfg->>'base') not in ('gross_income','net_trip_profit','fixed_pool','custom_amount') then
    raise exception 'Invalid wage calculation base';
  end if;
  if (v_cfg->>'method') not in ('equal','percentage','role','fixed','attendance','combined') then
    raise exception 'Invalid wage method';
  end if;
  if coalesce((v_cfg->>'crewSharePercent')::numeric, 0) < 0 or coalesce((v_cfg->>'crewSharePercent')::numeric, 0) > 100 then
    raise exception 'Crew share percentage must be between 0 and 100';
  end if;
  if v_cfg->>'method' = 'percentage' then
    select coalesce(sum((value)::numeric), 0) into v_sum from jsonb_each_text(coalesce(v_cfg->'percentages','{}'::jsonb));
    if v_sum > 100 and not coalesce((v_cfg->>'allowExceedPool')::boolean, false) then
      raise exception 'Percentage allocations total %%%, which exceeds 100%% of the wage pool', v_sum;
    end if;
  end if;
  perform set_config('galary.trusted', 'on', true);
  -- close the previous open version
  update public.wage_rule_versions set effective_to = v.effective_from - 1
   where rule_id = v.rule_id and status = 'approved' and effective_to is null and effective_from < v.effective_from;
  if exists (select 1 from public.wage_rule_versions where rule_id = v.rule_id and status = 'approved'
             and effective_from >= v.effective_from) then
    raise exception 'An approved version already starts on or after %', v.effective_from;
  end if;
  update public.wage_rule_versions set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_version;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'wage_rule_version', p_version, 'approved', p_comment);
end $$;

-- ---------------------------------------------------------------------
-- Payroll periods
-- ---------------------------------------------------------------------
create table public.payroll_periods (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  payroll_code       text,
  boat_id            uuid not null references public.boats(id) on delete restrict,
  trip_id            uuid references public.trips(id) on delete restrict,
  period_start       date not null,
  period_end         date not null,
  rule_version_id    uuid references public.wage_rule_versions(id) on delete restrict,
  custom_base_amount numeric(14,2),
  status             public.payroll_status not null default 'draft',
  base_amount        numeric(14,2),
  crew_pool          numeric(14,2),
  owner_allocation   numeric(14,2),
  total_bonuses      numeric(14,2),
  owner_remaining    numeric(14,2),
  total_gross        numeric(14,2),
  total_deductions   numeric(14,2),
  total_net          numeric(14,2),
  warnings           jsonb not null default '[]'::jsonb,
  inputs_snapshot    jsonb,
  rule_snapshot      jsonb,
  result_snapshot    jsonb,
  inputs_hash        text,
  notes              text,
  created_by         uuid references auth.users(id),
  calculated_by      uuid references auth.users(id),
  calculated_at      timestamptz,
  submitted_by       uuid references auth.users(id),
  submitted_at       timestamptz,
  approved_by        uuid references auth.users(id),
  approved_at        timestamptz,
  finalized_by       uuid references auth.users(id),
  finalized_at       timestamptz,
  reversed_by        uuid references auth.users(id),
  reversed_at        timestamptz,
  reverse_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, payroll_code),
  check (period_end >= period_start)
);
create unique index payroll_one_per_trip on public.payroll_periods(trip_id)
  where trip_id is not null and status <> 'reversed';
create index payroll_boat_idx on public.payroll_periods(boat_id, period_start);

create table public.wage_calculations (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete restrict,
  payroll_id            uuid not null references public.payroll_periods(id) on delete cascade,
  crew_id               uuid not null references public.crew_members(id) on delete restrict,
  job_role              text,
  days_present          numeric(8,2) not null default 0,
  days_eligible         numeric(8,2) not null default 0,
  share_weight          numeric(14,6) not null default 0,
  ordinary_wage         numeric(14,2) not null default 0,
  percentage_share      numeric(14,2) not null default 0,
  fixed_wage            numeric(14,2) not null default 0,
  attendance_adjustment numeric(14,2) not null default 0,
  bonus                 numeric(14,2) not null default 0,
  other_earnings        numeric(14,2) not null default 0,
  gross                 numeric(14,2) not null default 0,
  advance_deduction     numeric(14,2) not null default 0,
  fish_deduction        numeric(14,2) not null default 0,
  other_deductions      numeric(14,2) not null default 0,
  carry_forward_deduction numeric(14,2) not null default 0,
  total_deductions      numeric(14,2) not null default 0,
  net                   numeric(14,2) not null default 0,
  unrecovered_advance   numeric(14,2) not null default 0,
  negative_balance      numeric(14,2) not null default 0,
  details               jsonb not null default '{}'::jsonb,
  unique (payroll_id, crew_id),
  check (net >= 0),
  check (gross = ordinary_wage + percentage_share + fixed_wage + attendance_adjustment + bonus + other_earnings),
  check (total_deductions = advance_deduction + fish_deduction + other_deductions + carry_forward_deduction)
);

-- ---------------------------------------------------------------------
-- Approvable payroll inputs
-- ---------------------------------------------------------------------
create table public.crew_bonuses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  bonus_code  text,
  payroll_id  uuid not null references public.payroll_periods(id) on delete restrict,
  crew_id     uuid not null references public.crew_members(id) on delete restrict,
  kind        text not null check (kind in ('percent','fixed')),
  percent     numeric(7,4) check (percent is null or (percent > 0 and percent <= 100)),
  fixed_amount numeric(14,2) check (fixed_amount is null or fixed_amount > 0),
  amount      numeric(14,2),           -- resolved amount at calculation time
  notes       text,
  status      public.approval_status not null default 'pending_approval',
  void_reason text,
  created_by  uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, bonus_code),
  check ((kind = 'percent' and percent is not null) or (kind = 'fixed' and fixed_amount is not null))
);
create unique index crew_bonuses_one_active on public.crew_bonuses(payroll_id, crew_id)
  where status not in ('rejected','voided');

create table public.cash_advances (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  advance_code   text,
  crew_id        uuid not null references public.crew_members(id) on delete restrict,
  boat_id        uuid not null references public.boats(id) on delete restrict,
  date           date not null,
  amount         numeric(14,2) not null check (amount > 0),
  reason         text not null check (length(trim(reason)) > 0),
  method         text not null check (method in ('cash','bank_transfer','cheque','card','mobile','other')),
  reference      text,
  document_id    uuid references public.documents(id),
  recovery_plan  text,
  max_recovery_per_period numeric(14,2) check (max_recovery_per_period is null or max_recovery_per_period > 0),
  recover_from_date date,
  status         public.approval_status not null default 'pending_approval',
  void_reason    text,
  created_by     uuid references auth.users(id),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, advance_code)
);
create index cash_advances_crew_idx on public.cash_advances(crew_id, date);

create table public.advance_recoveries (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  advance_id  uuid not null references public.cash_advances(id) on delete restrict,
  payroll_id  uuid not null references public.payroll_periods(id) on delete restrict,
  crew_id     uuid not null references public.crew_members(id) on delete restrict,
  amount      numeric(14,2) not null check (amount > 0),
  status      text not null default 'valid' check (status in ('valid','reversed')),
  created_at  timestamptz not null default now()
);
create unique index advance_recoveries_once on public.advance_recoveries(advance_id, payroll_id) where status = 'valid';

create table public.fish_taken (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  fish_taken_code text,
  crew_id       uuid not null references public.crew_members(id) on delete restrict,
  boat_id       uuid not null references public.boats(id) on delete restrict,
  trip_id       uuid references public.trips(id) on delete restrict,
  date          date not null,
  fish_type_id  uuid not null references public.fish_types(id) on delete restrict,
  quantity      numeric(14,3) not null check (quantity > 0),
  unit          text not null default 'kg' check (unit in ('kg','pcs','ton','lb')),
  unit_price    numeric(14,2) not null check (unit_price >= 0),
  total         numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  deduct_from_wages boolean not null default true,
  acknowledged  boolean not null default false,
  acknowledged_at timestamptz,
  acknowledgement_note text,
  payroll_id    uuid references public.payroll_periods(id) on delete restrict,  -- deducted in
  document_id   uuid references public.documents(id),
  notes         text,
  status        public.approval_status not null default 'pending_approval',
  void_reason   text,
  created_by    uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, fish_taken_code)
);
create index fish_taken_crew_idx on public.fish_taken(crew_id, date);
create trigger fish_taken_closed_trip before insert on public.fish_taken
  for each row execute function public.guard_closed_trip();

create table public.payroll_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete restrict,
  adjustment_code    text,
  crew_id            uuid not null references public.crew_members(id) on delete restrict,
  boat_id            uuid references public.boats(id) on delete restrict,
  payroll_id         uuid references public.payroll_periods(id) on delete restrict,   -- intended period (optional)
  applied_payroll_id uuid references public.payroll_periods(id) on delete restrict,   -- where it was applied
  source_payroll_id  uuid references public.payroll_periods(id) on delete restrict,   -- carry-forward origin
  date               date not null default current_date,
  kind               text not null check (kind in ('earning','deduction','carry_forward')),
  amount             numeric(14,2) not null check (amount > 0),
  reason             text not null check (length(trim(reason)) > 0),
  document_id        uuid references public.documents(id),
  reverses_id        uuid references public.payroll_adjustments(id),
  status             public.approval_status not null default 'pending_approval',
  void_reason        text,
  created_by         uuid references auth.users(id),
  approved_by        uuid references auth.users(id),
  approved_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, adjustment_code)
);
create index payroll_adjustments_crew_idx on public.payroll_adjustments(crew_id);

-- ---------------------------------------------------------------------
-- Wage slips (versioned) and crew payments
-- ---------------------------------------------------------------------
create table public.wage_slips (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  slip_no          text not null,
  payroll_id       uuid not null references public.payroll_periods(id) on delete restrict,
  crew_id          uuid not null references public.crew_members(id) on delete restrict,
  boat_id          uuid not null references public.boats(id) on delete restrict,
  version          int not null default 1,
  status           text not null default 'issued' check (status in ('issued','superseded','voided')),
  data             jsonb not null,
  gross            numeric(14,2) not null,
  total_deductions numeric(14,2) not null,
  net_payable      numeric(14,2) not null check (net_payable >= 0),
  generated_by     uuid references auth.users(id),
  generated_at     timestamptz not null default now(),
  approved_by      uuid references auth.users(id),
  superseded_reason text,
  acknowledged     boolean not null default false,
  acknowledged_at  timestamptz,
  acknowledgement_note text,
  unique (payroll_id, crew_id, version),
  unique (company_id, slip_no, version)
);
create unique index wage_slips_one_issued on public.wage_slips(payroll_id, crew_id) where status = 'issued';

create table public.crew_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  payment_code  text,
  crew_id       uuid not null references public.crew_members(id) on delete restrict,
  boat_id       uuid not null references public.boats(id) on delete restrict,
  payroll_id    uuid not null references public.payroll_periods(id) on delete restrict,
  wage_slip_id  uuid not null references public.wage_slips(id) on delete restrict,
  date          date not null,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null check (method in ('cash','bank_transfer','cheque','card','mobile','other')),
  reference     text,
  document_id   uuid references public.documents(id),
  notes         text,
  request_id    uuid unique,
  status        text not null default 'valid' check (status in ('valid','voided')),
  void_reason   text,
  recorded_by   uuid references auth.users(id) default auth.uid(),
  approved_by   uuid references auth.users(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (company_id, payment_code)
);
create index crew_payments_slip_idx on public.crew_payments(payroll_id, crew_id);
create unique index crew_payments_ref_uniq on public.crew_payments(company_id, method, lower(reference))
  where reference is not null and status = 'valid' and method <> 'cash';

-- ---------------------------------------------------------------------
-- Balance helpers
-- ---------------------------------------------------------------------
create or replace function public.advance_recovered(p_advance uuid)
returns numeric language sql stable as $$
  select coalesce(sum(amount), 0) from public.advance_recoveries where advance_id = p_advance and status = 'valid'
$$;

create or replace function public.crew_paid_for(p_payroll uuid, p_crew uuid)
returns numeric language sql stable as $$
  select coalesce(sum(amount), 0) from public.crew_payments
  where payroll_id = p_payroll and crew_id = p_crew and status = 'valid'
$$;

-- ---------------------------------------------------------------------
-- Generic guard for approvable inputs (bonuses, advances, fish taken,
-- adjustments). TG_ARGV[0] = approve permission.
-- ---------------------------------------------------------------------
create or replace function public.guard_approvable()
returns trigger language plpgsql security definer set search_path = public as $$
declare j_new jsonb := to_jsonb(new); j_old jsonb; k text; v_locked boolean := false;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null or current_setting('galary.trusted', true) = 'on' then return new; end if;
    if new.status = 'approved' then
      if public.has_perm(tg_argv[0]) then
        new.approved_by := auth.uid(); new.approved_at := now();
      else
        new.status := 'pending_approval';
      end if;
    elsif new.status not in ('draft','pending_approval') then
      new.status := 'pending_approval';
    end if;
    return new;
  end if;
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  j_old := to_jsonb(old);
  if new.status is distinct from old.status then
    raise exception 'Use the approval actions to change status';
  end if;
  if old.status in ('approved','voided','rejected') then
    -- only acknowledgement / note fields may change once approved
    for k in select jsonb_object_keys(j_new) loop
      if k not in ('acknowledged','acknowledged_at','acknowledgement_note','notes','updated_at','document_id')
         and (j_new->k) is distinct from (j_old->k) then
        v_locked := true;
      end if;
    end loop;
    if v_locked then
      raise exception 'Approved records are locked. Void it and enter a correction.';
    end if;
  end if;
  if tg_table_name = 'fish_taken' and new.acknowledged and not old.acknowledged then
    new.acknowledged_at := now();
  end if;
  return new;
end $$;

create trigger crew_bonuses_guard before insert or update on public.crew_bonuses
  for each row execute function public.guard_approvable('bonuses.approve');
create trigger cash_advances_guard before insert or update on public.cash_advances
  for each row execute function public.guard_approvable('advances.approve');
create trigger fish_taken_guard before insert or update on public.fish_taken
  for each row execute function public.guard_approvable('fish_taken.approve');
create trigger payroll_adjustments_guard before insert or update on public.payroll_adjustments
  for each row execute function public.guard_approvable('adjustments.approve');

-- Bonuses can only be changed while their payroll is still open
create or replace function public.guard_bonus_payroll()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status public.payroll_status; v_boat uuid;
begin
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  select status, boat_id into v_status, v_boat from public.payroll_periods where id = new.payroll_id;
  if v_status in ('finalized','reversed') then
    raise exception 'Bonuses cannot be changed for a finalised or reversed payroll';
  end if;
  return new;
end $$;
create trigger crew_bonuses_payroll_guard before insert or update on public.crew_bonuses
  for each row execute function public.guard_bonus_payroll();

-- Generic approve / reject / submit / void for those tables
create or replace function public.set_record_status(p_table text, p_id uuid, p_action text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_manage text; v_approve text; v_row jsonb; v_status text; v_used boolean := false;
begin
  case p_table
    when 'crew_bonuses'        then v_manage := 'bonuses.manage';     v_approve := 'bonuses.approve';
    when 'cash_advances'       then v_manage := 'advances.manage';    v_approve := 'advances.approve';
    when 'fish_taken'          then v_manage := 'fish_taken.manage';  v_approve := 'fish_taken.approve';
    when 'payroll_adjustments' then v_manage := 'adjustments.manage'; v_approve := 'adjustments.approve';
    else raise exception 'unsupported table %', p_table;
  end case;
  execute format('select to_jsonb(t) from public.%I t where id = $1 for update', p_table) into v_row using p_id;
  if v_row is null or (v_row->>'company_id')::uuid <> public.auth_company_id() then
    raise exception 'record not found';
  end if;
  if (v_row->>'boat_id') is not null and not public.can_access_boat((v_row->>'boat_id')::uuid) then
    raise exception 'record not found';
  end if;
  v_status := v_row->>'status';

  if p_action = 'submit' then
    perform public.require_perm(v_manage);
    if v_status not in ('draft','rejected') then raise exception 'Only drafts can be submitted'; end if;
    v_status := 'pending_approval';
  elsif p_action = 'approve' then
    perform public.require_perm(v_approve);
    if v_status not in ('draft','pending_approval') then raise exception 'Not awaiting approval'; end if;
    v_status := 'approved';
  elsif p_action = 'reject' then
    perform public.require_perm(v_approve);
    if v_status <> 'pending_approval' then raise exception 'Not awaiting approval'; end if;
    if coalesce(trim(p_comment),'') = '' then raise exception 'A reason is required'; end if;
    v_status := 'rejected';
  elsif p_action = 'void' then
    perform public.require_perm(v_approve);
    if v_status = 'voided' then raise exception 'Already voided'; end if;
    if coalesce(trim(p_comment),'') = '' then raise exception 'A reason is required'; end if;
    if p_table = 'cash_advances' then
      v_used := public.advance_recovered(p_id) > 0;
    elsif p_table = 'fish_taken' then
      v_used := (v_row->>'payroll_id') is not null;
    elsif p_table = 'payroll_adjustments' then
      v_used := (v_row->>'applied_payroll_id') is not null;
    elsif p_table = 'crew_bonuses' then
      v_used := exists (select 1 from public.payroll_periods where id = (v_row->>'payroll_id')::uuid
                        and status = 'finalized');
    end if;
    if v_used then
      raise exception 'This record has already been applied in a finalised payroll. Reverse the payroll or enter an adjustment.';
    end if;
    v_status := 'voided';
  else
    raise exception 'unknown action %', p_action;
  end if;

  perform set_config('galary.trusted', 'on', true);
  execute format(
    'update public.%I set status = $1::public.approval_status,
        approved_by = case when $1 = ''approved'' then auth.uid() else approved_by end,
        approved_at = case when $1 = ''approved'' then now() else approved_at end,
        void_reason = case when $1 = ''voided'' then $2 else void_reason end
     where id = $3', p_table) using v_status, p_comment, p_id;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval((v_row->>'company_id')::uuid, p_table, p_id, p_action, p_comment);
end $$;

-- ---------------------------------------------------------------------
-- Payroll inputs (consumed by the wage engine in the edge function)
-- ---------------------------------------------------------------------
create or replace function public.payroll_inputs_internal(p_payroll uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p record; v_rule jsonb; v_ver record; v_start date; v_end date;
  v_fish numeric; v_other numeric; v_exp numeric; v_days int; v_result jsonb;
begin
  select * into p from public.payroll_periods where id = p_payroll;
  if not found then raise exception 'payroll not found'; end if;
  v_start := p.period_start; v_end := p.period_end;

  select * into v_ver from public.wage_rule_versions where id = p.rule_version_id;
  if not found then raise exception 'Select an approved wage rule version for this payroll'; end if;
  if v_ver.status <> 'approved' then raise exception 'The selected wage rule version is not approved'; end if;

  -- Financial base: recognised income & expense (not cash) for the trip or period
  select coalesce(sum(total), 0) into v_fish from public.fish_sales
   where status = 'recorded' and boat_id = p.boat_id
     and (case when p.trip_id is not null then trip_id = p.trip_id else date between v_start and v_end end);
  select coalesce(sum(amount) filter (where kind = 'income'), 0), coalesce(sum(amount) filter (where kind = 'expense'), 0)
    into v_other, v_exp
    from public.transactions
   where status = 'approved' and boat_id = p.boat_id
     and (case when p.trip_id is not null then trip_id = p.trip_id else date between v_start and v_end end);

  select count(distinct date) into v_days from public.attendance
   where boat_id = p.boat_id and date between v_start and v_end
     and (p.trip_id is null or trip_id = p.trip_id or trip_id is null);
  if v_days = 0 then v_days := (v_end - v_start) + 1; end if;

  with crew as (
    select c.id, c.crew_code, c.name_en, c.name_dv,
           coalesce(tc.job_role, a.job_role, c.job_role) as job_role
    from public.crew_members c
    left join public.trip_crew tc on tc.crew_id = c.id and tc.trip_id = p.trip_id
    left join lateral (
      select job_role from public.boat_assignments ba
      where ba.crew_id = c.id and ba.boat_id = p.boat_id
        and ba.start_date <= v_end and (ba.end_date is null or ba.end_date >= v_start)
      order by ba.start_date desc limit 1) a on true
    where c.company_id = p.company_id
      and (case when p.trip_id is not null
                then tc.crew_id is not null
                else exists (select 1 from public.boat_assignments ba
                             where ba.crew_id = c.id and ba.boat_id = p.boat_id
                               and ba.start_date <= v_end and (ba.end_date is null or ba.end_date >= v_start)) end)
  ),
  att as (
    select crew_id,
           count(*) filter (where status = 'present') as present,
           count(*) filter (where status = 'sick_leave') as sick,
           count(*) filter (where status = 'approved_leave') as leave,
           count(*) filter (where status = 'absent') as absent
    from public.attendance
    where boat_id = p.boat_id and date between v_start and v_end
      and (p.trip_id is null or trip_id = p.trip_id or trip_id is null)
    group by crew_id
  )
  select jsonb_build_object(
    'payroll', jsonb_build_object('id', p.id, 'code', p.payroll_code, 'boatId', p.boat_id, 'tripId', p.trip_id,
                 'periodStart', v_start, 'periodEnd', v_end, 'customBaseAmount', p.custom_base_amount),
    'ruleVersion', jsonb_build_object('id', v_ver.id, 'ruleId', v_ver.rule_id, 'version', v_ver.version,
                 'effectiveFrom', v_ver.effective_from),
    'rule', v_ver.config,
    'financials', jsonb_build_object('fishSales', v_fish, 'otherIncome', v_other,
                 'grossIncome', v_fish + v_other, 'expenses', v_exp,
                 'expensesByCategory', coalesce((
                    select jsonb_object_agg(code, amt) from (
                      select cat.code, sum(t.amount) amt from public.transactions t
                      join public.categories cat on cat.id = t.category_id
                      where t.status = 'approved' and t.kind = 'expense' and t.boat_id = p.boat_id
                        and (case when p.trip_id is not null then t.trip_id = p.trip_id
                                  else t.date between v_start and v_end end)
                      group by cat.code order by cat.code) x), '{}'::jsonb)),
    'operatingDays', v_days,
    'crew', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'code', c.crew_code, 'nameEn', c.name_en, 'nameDv', c.name_dv, 'role', c.job_role,
                 'daysPresent', coalesce(att.present, 0), 'daysSick', coalesce(att.sick, 0),
                 'daysLeave', coalesce(att.leave, 0), 'daysAbsent', coalesce(att.absent, 0),
                 'daysEligible', v_days) order by c.crew_code, c.id)
               from crew c left join att on att.crew_id = c.id), '[]'::jsonb),
    'bonuses', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'crewId', b.crew_id, 'kind', b.kind,
                 'percent', b.percent, 'fixedAmount', b.fixed_amount) order by b.id)
               from public.crew_bonuses b where b.payroll_id = p.id and b.status = 'approved'), '[]'::jsonb),
    'advances', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.advance_code, 'crewId', a.crew_id,
                 'date', a.date, 'amount', a.amount, 'outstanding', a.amount - public.advance_recovered(a.id),
                 'maxPerPeriod', a.max_recovery_per_period) order by a.date, a.id)
               from public.cash_advances a
               where a.status = 'approved' and a.company_id = p.company_id
                 and a.boat_id = p.boat_id and a.date <= v_end
                 and (a.recover_from_date is null or a.recover_from_date <= v_end)
                 and a.amount - public.advance_recovered(a.id) > 0), '[]'::jsonb),
    'fishTaken', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'code', f.fish_taken_code,
                 'crewId', f.crew_id, 'date', f.date, 'fishTypeEn', ft.name_en, 'fishTypeDv', ft.name_dv,
                 'quantity', f.quantity, 'unit', f.unit, 'unitPrice', f.unit_price, 'total', f.total) order by f.date, f.id)
               from public.fish_taken f join public.fish_types ft on ft.id = f.fish_type_id
               where f.status = 'approved' and f.deduct_from_wages and f.payroll_id is null
                 and f.boat_id = p.boat_id and f.date <= v_end
                 and (p.trip_id is null or f.trip_id is null or f.trip_id = p.trip_id)), '[]'::jsonb),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.adjustment_code,
                 'crewId', a.crew_id, 'kind', a.kind, 'amount', a.amount, 'reason', a.reason, 'date', a.date)
                 order by a.date, a.id)
               from public.payroll_adjustments a
               where a.status = 'approved' and a.applied_payroll_id is null and a.company_id = p.company_id
                 and (a.payroll_id = p.id or (a.payroll_id is null and a.date <= v_end
                      and (a.boat_id is null or a.boat_id = p.boat_id)))), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.payroll_inputs_internal(uuid) from public;

-- Public wrapper: permission & tenant checked; returns inputs + hash.
create or replace function public.payroll_inputs(p_payroll uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v record; v_inputs jsonb;
begin
  perform public.require_perm('payroll.prepare');
  select * into v from public.payroll_periods where id = p_payroll;
  if not found or v.company_id <> public.auth_company_id() or not public.can_access_boat(v.boat_id) then
    raise exception 'payroll not found';
  end if;
  v_inputs := public.payroll_inputs_internal(p_payroll);
  return jsonb_build_object('inputs', v_inputs, 'hash', md5(v_inputs::text), 'status', v.status);
end $$;

-- Writes the engine result. Callable ONLY by the trusted backend (service role).
create or replace function public.apply_payroll_calculation(p_payroll uuid, p_hash text, p_result jsonb, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_inputs jsonb; c jsonb;
begin
  select * into v from public.payroll_periods where id = p_payroll for update;
  if not found then raise exception 'payroll not found'; end if;
  if v.status not in ('draft','calculated') then
    raise exception 'Payroll can only be recalculated while in draft or calculated status (current: %)', v.status;
  end if;
  v_inputs := public.payroll_inputs_internal(p_payroll);
  if md5(v_inputs::text) <> p_hash then
    raise exception 'Payroll inputs changed during calculation. Please recalculate.';
  end if;
  if coalesce(jsonb_array_length(p_result->'errors'), 0) > 0 then
    raise exception 'Calculation has errors: %', p_result->'errors';
  end if;

  perform set_config('galary.trusted', 'on', true);
  delete from public.wage_calculations where payroll_id = p_payroll;
  for c in select * from jsonb_array_elements(p_result->'crew') loop
    insert into public.wage_calculations(company_id, payroll_id, crew_id, job_role, days_present, days_eligible,
      share_weight, ordinary_wage, percentage_share, fixed_wage, attendance_adjustment, bonus, other_earnings, gross,
      advance_deduction, fish_deduction, other_deductions, carry_forward_deduction, total_deductions, net,
      unrecovered_advance, negative_balance, details)
    values (v.company_id, p_payroll, (c->>'crewId')::uuid, c->>'role',
      (c->>'daysPresent')::numeric, (c->>'daysEligible')::numeric, (c->>'shareWeight')::numeric,
      (c->>'ordinaryWage')::numeric, (c->>'percentageShare')::numeric, (c->>'fixedWage')::numeric,
      (c->>'attendanceAdjustment')::numeric, (c->>'bonus')::numeric, (c->>'otherEarnings')::numeric,
      (c->>'gross')::numeric, (c->>'advanceDeduction')::numeric, (c->>'fishDeduction')::numeric,
      (c->>'otherDeductions')::numeric, (c->>'carryForwardDeduction')::numeric, (c->>'totalDeductions')::numeric,
      (c->>'net')::numeric, (c->>'unrecoveredAdvance')::numeric, (c->>'negativeBalance')::numeric,
      coalesce(c->'details', '{}'::jsonb));
  end loop;

  update public.crew_bonuses b set amount = (x->>'amount')::numeric
    from jsonb_array_elements(coalesce(p_result->'bonuses','[]'::jsonb)) x
   where b.id = (x->>'id')::uuid and b.payroll_id = p_payroll;
  update public.payroll_periods set
    status = 'calculated',
    base_amount = (p_result->'summary'->>'baseAmount')::numeric,
    crew_pool = (p_result->'summary'->>'crewPool')::numeric,
    owner_allocation = (p_result->'summary'->>'ownerAllocation')::numeric,
    total_bonuses = (p_result->'summary'->>'totalBonuses')::numeric,
    owner_remaining = (p_result->'summary'->>'ownerRemaining')::numeric,
    total_gross = (p_result->'summary'->>'totalGross')::numeric,
    total_deductions = (p_result->'summary'->>'totalDeductions')::numeric,
    total_net = (p_result->'summary'->>'totalNet')::numeric,
    warnings = coalesce(p_result->'warnings', '[]'::jsonb),
    inputs_snapshot = v_inputs,
    rule_snapshot = v_inputs->'rule',
    result_snapshot = p_result,
    inputs_hash = p_hash,
    calculated_by = p_user,
    calculated_at = now()
  where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  insert into public.approvals(company_id, entity_type, entity_id, action, acted_by)
  values (v.company_id, 'payroll', p_payroll, 'calculated', p_user);
end $$;
revoke all on function public.apply_payroll_calculation(uuid, text, jsonb, uuid) from public;

-- ---------------------------------------------------------------------
-- Payroll workflow
-- ---------------------------------------------------------------------
create or replace function public.load_payroll_for_update(p_payroll uuid)
returns public.payroll_periods language plpgsql security definer set search_path = public as $$
declare v public.payroll_periods;
begin
  select * into v from public.payroll_periods where id = p_payroll for update;
  if not found or v.company_id is distinct from public.auth_company_id() or not public.can_access_boat(v.boat_id) then
    raise exception 'payroll not found';
  end if;
  return v;
end $$;

create or replace function public.guard_payroll()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_overlap int;
begin
  if tg_op = 'INSERT' then
    if new.trip_id is not null then
      select boat_id, start_date, coalesce(return_date, start_date)
        into new.boat_id, new.period_start, new.period_end
        from public.trips where id = new.trip_id;
    end if;
    new.status := 'draft';
  elsif current_setting('galary.trusted', true) is distinct from 'on' then
    if new.status is distinct from old.status or new.base_amount is distinct from old.base_amount
       or new.total_net is distinct from old.total_net or new.inputs_hash is distinct from old.inputs_hash then
      raise exception 'Payroll results and status are changed only by the payroll actions';
    end if;
    if old.status not in ('draft','calculated') and (
         new.period_start <> old.period_start or new.period_end <> old.period_end
         or new.rule_version_id is distinct from old.rule_version_id
         or new.custom_base_amount is distinct from old.custom_base_amount
         or new.boat_id <> old.boat_id or new.trip_id is distinct from old.trip_id) then
      raise exception 'Payroll settings are locked once submitted';
    end if;
    if old.status = 'calculated' and (
         new.period_start <> old.period_start or new.period_end <> old.period_end
         or new.rule_version_id is distinct from old.rule_version_id
         or new.custom_base_amount is distinct from old.custom_base_amount) then
      new.status := 'draft';  -- settings changed: needs recalculation
    end if;
  end if;
  -- Period payrolls for the same boat may not overlap (trip payrolls are tied to their trip)
  if new.trip_id is null and new.status <> 'reversed' then
    select count(*) into v_overlap from public.payroll_periods
     where boat_id = new.boat_id and id <> new.id and trip_id is null and status <> 'reversed'
       and daterange(period_start, period_end, '[]') && daterange(new.period_start, new.period_end, '[]');
    if v_overlap > 0 then
      raise exception 'Another payroll for this boat already covers part of this period';
    end if;
  end if;
  return new;
end $$;
create trigger payroll_guard before insert or update on public.payroll_periods
  for each row execute function public.guard_payroll();

create or replace function public.submit_payroll(p_payroll uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payroll_periods; v_settings jsonb;
begin
  perform public.require_perm('payroll.prepare');
  v := public.load_payroll_for_update(p_payroll);
  if v.status <> 'calculated' then raise exception 'Calculate the payroll before submitting it'; end if;
  if md5(public.payroll_inputs_internal(p_payroll)::text) <> v.inputs_hash then
    raise exception 'Payroll inputs changed after calculation. Recalculate before submitting.';
  end if;
  perform set_config('galary.trusted', 'on', true);
  update public.payroll_periods set status = 'pending_approval', submitted_by = auth.uid(), submitted_at = now()
   where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'payroll', p_payroll, 'submitted', p_comment);
  select settings into v_settings from public.companies where id = v.company_id;
  if not coalesce((v_settings->>'payroll_approval_required')::boolean, true) and public.has_perm('payroll.approve') then
    perform public.approve_payroll(p_payroll, 'Auto-approved (approval not required)');
  end if;
end $$;

create or replace function public.approve_payroll(p_payroll uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payroll_periods;
begin
  perform public.require_perm('payroll.approve');
  v := public.load_payroll_for_update(p_payroll);
  if v.status <> 'pending_approval' then raise exception 'Payroll is not awaiting approval'; end if;
  if md5(public.payroll_inputs_internal(p_payroll)::text) <> v.inputs_hash then
    raise exception 'Payroll inputs changed after calculation. Return it for recalculation.';
  end if;
  perform set_config('galary.trusted', 'on', true);
  update public.payroll_periods set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'payroll', p_payroll, 'approved', p_comment);
end $$;

create or replace function public.return_payroll(p_payroll uuid, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payroll_periods;
begin
  perform public.require_perm('payroll.approve');
  v := public.load_payroll_for_update(p_payroll);
  if v.status not in ('pending_approval','approved') then raise exception 'Payroll cannot be returned from status %', v.status; end if;
  if coalesce(trim(p_comment),'') = '' then raise exception 'Explain what needs to change'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.payroll_periods set status = 'calculated', approved_by = null, approved_at = null where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'payroll', p_payroll, 'returned', p_comment);
end $$;

-- Builds the immutable wage slip document for one calculation row.
create or replace function public.build_slip_data(p_calc public.wage_calculations)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', co.name, 'nameDv', co.name_dv, 'currency', co.currency,
                                  'address', co.address, 'phone', co.phone),
    'boat', jsonb_build_object('id', b.id, 'name', b.name, 'nameDv', b.name_dv, 'registrationNo', b.registration_no),
    'crew', jsonb_build_object('id', c.id, 'code', c.crew_code, 'nameEn', c.name_en, 'nameDv', c.name_dv,
                               'role', p_calc.job_role, 'idCardNo', c.id_card_no),
    'payroll', jsonb_build_object('id', p.id, 'code', p.payroll_code, 'periodStart', p.period_start,
                                  'periodEnd', p.period_end, 'tripCode', t.trip_code,
                                  'approvedAt', p.approved_at, 'calculatedAt', p.calculated_at),
    'preparedBy', (select coalesce(nullif(full_name,''), email) from public.profiles where id = p.calculated_by),
    'approvedBy', (select coalesce(nullif(full_name,''), email) from public.profiles where id = p.approved_by),
    'rule', jsonb_build_object('base', p.rule_snapshot->>'base', 'method', p.rule_snapshot->>'method',
                               'crewSharePercent', p.rule_snapshot->'crewSharePercent'),
    'summary', jsonb_build_object('baseAmount', p.base_amount, 'crewPool', p.crew_pool),
    'attendance', jsonb_build_object('daysPresent', p_calc.days_present, 'daysEligible', p_calc.days_eligible),
    'earnings', jsonb_build_object(
        'ordinaryWage', p_calc.ordinary_wage, 'percentageShare', p_calc.percentage_share,
        'fixedWage', p_calc.fixed_wage, 'attendanceAdjustment', p_calc.attendance_adjustment,
        'bonus', p_calc.bonus, 'otherEarnings', p_calc.other_earnings, 'gross', p_calc.gross),
    'deductions', jsonb_build_object(
        'advances', p_calc.advance_deduction, 'fishTaken', p_calc.fish_deduction,
        'other', p_calc.other_deductions, 'carryForward', p_calc.carry_forward_deduction,
        'total', p_calc.total_deductions),
    'lines', p_calc.details,
    'net', p_calc.net,
    'unrecoveredAdvance', p_calc.unrecovered_advance,
    'negativeBalance', p_calc.negative_balance
  )
  from public.payroll_periods p
  join public.companies co on co.id = p.company_id
  join public.boats b on b.id = p.boat_id
  join public.crew_members c on c.id = p_calc.crew_id
  left join public.trips t on t.id = p.trip_id
  where p.id = p_calc.payroll_id
$$;

create or replace function public.finalize_payroll(p_payroll uuid, p_comment text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v public.payroll_periods; c public.wage_calculations; a jsonb; v_out numeric; n int := 0; v_slip text;
begin
  perform public.require_perm('payroll.finalize');
  v := public.load_payroll_for_update(p_payroll);
  if v.status <> 'approved' then raise exception 'Only approved payrolls can be finalised'; end if;
  if md5(public.payroll_inputs_internal(p_payroll)::text) <> v.inputs_hash then
    raise exception 'Payroll inputs changed after approval. Return it for recalculation.';
  end if;
  perform set_config('galary.trusted', 'on', true);

  for c in select * from public.wage_calculations where payroll_id = p_payroll order by crew_id loop
    -- 1. advance recoveries (each advance once per payroll; never more than outstanding)
    for a in select * from jsonb_array_elements(coalesce(c.details->'advances', '[]'::jsonb)) loop
      if coalesce((a->>'amount')::numeric, 0) > 0 then
        perform 1 from public.cash_advances where id = (a->>'id')::uuid for update;
        v_out := (select amount from public.cash_advances where id = (a->>'id')::uuid)
                 - public.advance_recovered((a->>'id')::uuid);
        if (a->>'amount')::numeric > v_out then
          raise exception 'Advance % has only % outstanding', a->>'code', v_out;
        end if;
        insert into public.advance_recoveries(company_id, advance_id, payroll_id, crew_id, amount)
        values (v.company_id, (a->>'id')::uuid, p_payroll, c.crew_id, (a->>'amount')::numeric);
      end if;
    end loop;
    -- 2. fish taken (deducted once)
    for a in select * from jsonb_array_elements(coalesce(c.details->'fishTaken', '[]'::jsonb)) loop
      update public.fish_taken set payroll_id = p_payroll
       where id = (a->>'id')::uuid and payroll_id is null and crew_id = c.crew_id;
      if not found then raise exception 'Fish-taken record % was already deducted', a->>'code'; end if;
    end loop;
    -- 3. adjustments (applied once)
    for a in select * from jsonb_array_elements(coalesce(c.details->'adjustments', '[]'::jsonb)) loop
      update public.payroll_adjustments set applied_payroll_id = p_payroll
       where id = (a->>'id')::uuid and applied_payroll_id is null and crew_id = c.crew_id;
      if not found then raise exception 'Adjustment % was already applied', a->>'code'; end if;
    end loop;
    -- 4. negative balance carried forward as an approved deduction for the next payroll
    if c.negative_balance > 0 then
      insert into public.payroll_adjustments(company_id, adjustment_code, crew_id, boat_id, source_payroll_id, date,
          kind, amount, reason, status, created_by, approved_by, approved_at)
      values (v.company_id, public.next_code(v.company_id, 'ADJ'), c.crew_id, v.boat_id, p_payroll, v.period_end,
          'carry_forward', c.negative_balance, 'Balance carried forward from payroll ' || v.payroll_code,
          'approved', auth.uid(), auth.uid(), now());
    end if;
    -- 5. wage slip v1
    v_slip := public.next_code(v.company_id, 'SLP');
    insert into public.wage_slips(company_id, slip_no, payroll_id, crew_id, boat_id, version, data, gross,
        total_deductions, net_payable, generated_by, approved_by)
    values (v.company_id, v_slip, p_payroll, c.crew_id, v.boat_id, 1, public.build_slip_data(c), c.gross,
        c.total_deductions, c.net, auth.uid(), v.approved_by);
    n := n + 1;
  end loop;

  update public.payroll_periods set status = 'finalized', finalized_by = auth.uid(), finalized_at = now()
   where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'payroll', p_payroll, 'finalized', p_comment);
  return n;
end $$;

create or replace function public.reverse_payroll(p_payroll uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.payroll_periods;
begin
  perform public.require_perm('payroll.finalize');
  if not public.is_owner() then raise exception 'Only an owner can reverse a finalised payroll' using errcode = '42501'; end if;
  v := public.load_payroll_for_update(p_payroll);
  if v.status <> 'finalized' then raise exception 'Only finalised payrolls can be reversed'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if exists (select 1 from public.crew_payments where payroll_id = p_payroll and status = 'valid') then
    raise exception 'Void the crew payments for this payroll before reversing it';
  end if;
  if exists (select 1 from public.payroll_adjustments where source_payroll_id = p_payroll
             and applied_payroll_id is not null and status = 'approved') then
    raise exception 'A balance carried forward from this payroll has already been applied in a later payroll';
  end if;
  perform set_config('galary.trusted', 'on', true);
  update public.advance_recoveries set status = 'reversed' where payroll_id = p_payroll and status = 'valid';
  update public.fish_taken set payroll_id = null where payroll_id = p_payroll;
  update public.payroll_adjustments set applied_payroll_id = null where applied_payroll_id = p_payroll;
  update public.payroll_adjustments set status = 'voided', void_reason = 'Source payroll reversed: ' || p_reason
   where source_payroll_id = p_payroll and status = 'approved';
  update public.wage_slips set status = 'voided', superseded_reason = 'Payroll reversed: ' || p_reason
   where payroll_id = p_payroll and status = 'issued';
  update public.payroll_periods set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(),
         reverse_reason = p_reason where id = p_payroll;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'payroll', p_payroll, 'reversed', p_reason);
end $$;

-- Reissue a wage slip as a new version (e.g. corrected names/details). Amounts never change.
create or replace function public.reissue_wage_slip(p_slip uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; c public.wage_calculations; v_id uuid;
begin
  perform public.require_perm('payroll.prepare');
  select * into s from public.wage_slips where id = p_slip for update;
  if not found or s.company_id <> public.auth_company_id() or not public.can_access_boat(s.boat_id) then
    raise exception 'wage slip not found';
  end if;
  if s.status <> 'issued' then raise exception 'Only the current issued slip can be reissued'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  select * into c from public.wage_calculations where payroll_id = s.payroll_id and crew_id = s.crew_id;
  perform set_config('galary.trusted', 'on', true);
  update public.wage_slips set status = 'superseded', superseded_reason = p_reason where id = p_slip;
  insert into public.wage_slips(company_id, slip_no, payroll_id, crew_id, boat_id, version, data, gross,
      total_deductions, net_payable, generated_by, approved_by)
  values (s.company_id, s.slip_no, s.payroll_id, s.crew_id, s.boat_id, s.version + 1, public.build_slip_data(c),
      s.gross, s.total_deductions, s.net_payable, auth.uid(), s.approved_by)
  returning id into v_id;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(s.company_id, 'wage_slip', v_id, 'reissued', p_reason);
  return v_id;
end $$;

create or replace function public.acknowledge_wage_slip(p_slip uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  perform public.require_perm('crew_payments.manage');
  select * into s from public.wage_slips where id = p_slip for update;
  if not found or s.company_id <> public.auth_company_id() then raise exception 'wage slip not found'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.wage_slips set acknowledged = true, acknowledged_at = now(), acknowledgement_note = p_note where id = p_slip;
  perform set_config('galary.trusted', 'off', true);
end $$;

create or replace function public.guard_trusted_only()
returns trigger language plpgsql as $$
begin
  if current_setting('galary.trusted', true) = 'on' or auth.uid() is null then
    return coalesce(new, old);
  end if;
  raise exception '% records are changed only through their workflow actions', tg_table_name;
end $$;
create trigger wage_slips_guard before insert or update or delete on public.wage_slips
  for each row execute function public.guard_trusted_only();
create trigger wage_calculations_guard before insert or update or delete on public.wage_calculations
  for each row execute function public.guard_trusted_only();
create trigger advance_recoveries_guard before insert or update or delete on public.advance_recoveries
  for each row execute function public.guard_trusted_only();
create trigger crew_payments_guard before insert or update or delete on public.crew_payments
  for each row execute function public.guard_trusted_only();

-- ---------------------------------------------------------------------
-- Crew payments against wage slips
-- ---------------------------------------------------------------------
create or replace function public.record_crew_payment(
  p_slip uuid, p_date date, p_amount numeric, p_method text, p_reference text default null,
  p_document uuid default null, p_request uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; v_remaining numeric; v_id uuid;
begin
  perform public.require_perm('crew_payments.manage');
  if p_request is not null then
    select id into v_id from public.crew_payments where request_id = p_request;
    if found then return v_id; end if;
  end if;
  select * into s from public.wage_slips where id = p_slip for update;
  if not found or s.company_id <> public.auth_company_id() or not public.can_access_boat(s.boat_id) then
    raise exception 'wage slip not found';
  end if;
  if s.status <> 'issued' then raise exception 'Payments can only be recorded against the current issued wage slip'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_date is null or p_date > current_date then raise exception 'Payment date cannot be in the future'; end if;
  if p_method <> 'cash' and coalesce(trim(p_reference),'') = '' then
    raise exception 'A reference number is required for non-cash payments';
  end if;
  v_remaining := s.net_payable - public.crew_paid_for(s.payroll_id, s.crew_id);
  if p_amount > v_remaining then
    raise exception 'Payment (%) exceeds the remaining amount payable (%)', p_amount, v_remaining;
  end if;
  perform set_config('galary.trusted', 'on', true);
  insert into public.crew_payments(company_id, payment_code, crew_id, boat_id, payroll_id, wage_slip_id, date, amount,
      method, reference, document_id, notes, request_id, approved_by, approved_at)
  values (s.company_id, public.next_code(s.company_id, 'CPY'), s.crew_id, s.boat_id, s.payroll_id, s.id, p_date,
      p_amount, p_method, nullif(trim(p_reference),''), p_document, p_notes, p_request,
      case when public.has_perm('crew_payments.approve') then auth.uid() end,
      case when public.has_perm('crew_payments.approve') then now() end)
  returning id into v_id;
  perform set_config('galary.trusted', 'off', true);
  return v_id;
end $$;

create or replace function public.approve_crew_payment(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_perm('crew_payments.approve');
  select * into v from public.crew_payments where id = p_payment for update;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'payment not found'; end if;
  if v.approved_by is not null then return; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.crew_payments set approved_by = auth.uid(), approved_at = now() where id = p_payment;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'crew_payment', p_payment, 'approved', null);
end $$;

create or replace function public.void_crew_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_perm('crew_payments.approve');
  select * into v from public.crew_payments where id = p_payment for update;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'payment not found'; end if;
  if v.status = 'voided' then raise exception 'Already voided'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.crew_payments set status = 'voided', void_reason = p_reason where id = p_payment;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'crew_payment', p_payment, 'voided', p_reason);
end $$;

-- Attendance inside a finalised payroll period is locked
create or replace function public.guard_attendance_payroll()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select distinct x.boat_id, x.date from (
      select new.boat_id, new.date where tg_op <> 'DELETE'
      union all select old.boat_id, old.date where tg_op <> 'INSERT') x loop
    if exists (select 1 from public.payroll_periods p where p.boat_id = r.boat_id and p.status = 'finalized'
               and r.date between p.period_start and p.period_end) then
      raise exception 'Attendance on % is part of a finalised payroll and cannot be changed', r.date;
    end if;
  end loop;
  return coalesce(new, old);
end $$;
create trigger attendance_payroll_lock before insert or update or delete on public.attendance
  for each row execute function public.guard_attendance_payroll();

-- ---------------------------------------------------------------------
-- Defaults / codes / tenant guards / audit
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('wage_rules', null, null), ('wage_rule_versions', null, null),
    ('payroll_periods', 'PRL', 'payroll_code'), ('crew_bonuses', 'BON', 'bonus_code'),
    ('cash_advances', 'ADV', 'advance_code'), ('fish_taken', 'FTK', 'fish_taken_code'),
    ('payroll_adjustments', 'ADJ', 'adjustment_code')
  ) as t(tbl, prefix, col)
  loop
    if r.prefix is null then
      execute format('create trigger %I before insert on public.%I for each row execute function public.fill_defaults()',
                     r.tbl || '_defaults', r.tbl);
    else
      execute format('create trigger %I before insert on public.%I for each row execute function public.fill_defaults(%L, %L)',
                     r.tbl || '_defaults', r.tbl, r.prefix, r.col);
    end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
                     r.tbl || '_touch', r.tbl);
    end if;
  end loop;
  for r in select unnest(array['wage_rules','wage_rule_versions','payroll_periods','wage_calculations','crew_bonuses',
                               'cash_advances','advance_recoveries','fish_taken','payroll_adjustments','wage_slips',
                               'crew_payments']) as tbl loop
    execute format('create trigger %I before update on public.%I for each row execute function public.guard_company_change()',
                   r.tbl || '_tenant', r.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
                   r.tbl || '_audit', r.tbl);
  end loop;
end $$;
