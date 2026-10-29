-- =====================================================================
-- Galary — 0001 Foundation
-- Companies, user profiles, roles & permissions, helper functions,
-- document codes and the audit log.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'manager', 'payroll_officer', 'accountant', 'readonly');
create type public.app_language as enum ('en', 'dv');
create type public.record_status as enum ('active', 'inactive');
create type public.approval_status as enum ('draft', 'pending_approval', 'approved', 'rejected', 'voided');

-- ---------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------
create table public.companies (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) > 0),
  name_dv          text,
  address          text,
  phone            text,
  email            text,
  tin              text,
  default_language public.app_language not null default 'en',
  currency         text not null default 'MVR' check (currency ~ '^[A-Z]{3}$'),
  settings         jsonb not null default jsonb_build_object(
                     'bill_approval_required', true,
                     'payroll_approval_required', true,
                     'advance_approval_required', true,
                     'trip_close_requires_sales', true,
                     'bill_due_soon_days', 7,
                     'ocr_enabled', true,
                     'max_upload_mb', 10,
                     'stock_tracking', false
                   ),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- User profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete restrict,
  full_name   text not null default '',
  full_name_dv text,
  email       text,
  phone       text,
  role        public.app_role not null default 'readonly',
  language    public.app_language,
  all_boats   boolean not null default false,  -- access to every boat (non-owners)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index profiles_company_idx on public.profiles(company_id);

-- ---------------------------------------------------------------------
-- Permission catalogue + per-company role matrix
-- ---------------------------------------------------------------------
create table public.permissions (
  key         text primary key,
  module      text not null,
  description text not null
);

insert into public.permissions(key, module, description) values
  ('dashboard.view',        'dashboard',     'View the dashboard'),
  ('boats.view',            'boats',         'View boats'),
  ('boats.manage',          'boats',         'Create and edit boats'),
  ('crew.view',             'crew',          'View crew members'),
  ('crew.manage',           'crew',          'Create and edit crew members'),
  ('attendance.view',       'attendance',    'View attendance'),
  ('attendance.manage',     'attendance',    'Record attendance'),
  ('attendance.correct',    'attendance',    'Correct previously recorded attendance'),
  ('trips.view',            'trips',         'View fishing trips'),
  ('trips.manage',          'trips',         'Create and edit fishing trips'),
  ('trips.close',           'trips',         'Review and close trips'),
  ('sales.view',            'sales',         'View catch and sales'),
  ('sales.manage',          'sales',         'Record catch, sales and customer receipts'),
  ('income.view',           'income',        'View income'),
  ('income.manage',         'income',        'Record income'),
  ('expenses.view',         'expenses',      'View expenses'),
  ('expenses.manage',       'expenses',      'Record expenses'),
  ('transactions.approve',  'income',        'Approve income and expense transactions'),
  ('bills.view',            'bills',         'View bills and documents'),
  ('bills.manage',          'bills',         'Enter and upload bills'),
  ('bills.approve',         'bills',         'Approve, reject or void bills'),
  ('bills.pay',             'bills',         'Record supplier bill payments'),
  ('overpayment.approve',   'bills',         'Authorise supplier overpayments'),
  ('duplicates.override',   'bills',         'Override duplicate-bill warnings with a justification'),
  ('suppliers.view',        'suppliers',     'View suppliers and customers'),
  ('suppliers.manage',      'suppliers',     'Create and edit suppliers and customers'),
  ('wage_rules.view',       'wage_rules',    'View wage rules'),
  ('wage_rules.manage',     'wage_rules',    'Create and edit wage rules'),
  ('wage_rules.approve',    'wage_rules',    'Approve wage rule versions'),
  ('bonuses.view',          'bonuses',       'View bonuses'),
  ('bonuses.manage',        'bonuses',       'Allocate bonuses'),
  ('bonuses.approve',       'bonuses',       'Approve bonuses'),
  ('advances.view',         'advances',      'View cash advances'),
  ('advances.manage',       'advances',      'Record cash advances'),
  ('advances.approve',      'advances',      'Approve cash advances'),
  ('fish_taken.view',       'fish_taken',    'View fish taken by crew'),
  ('fish_taken.manage',     'fish_taken',    'Record fish taken by crew'),
  ('fish_taken.approve',    'fish_taken',    'Approve fish taken by crew'),
  ('adjustments.view',      'payroll',       'View payroll adjustments'),
  ('adjustments.manage',    'payroll',       'Enter payroll adjustments'),
  ('adjustments.approve',   'payroll',       'Approve payroll adjustments'),
  ('payroll.view',          'payroll',       'View payroll and wage slips'),
  ('payroll.prepare',       'payroll',       'Calculate payroll and generate wage slips'),
  ('payroll.approve',       'payroll',       'Approve payroll'),
  ('payroll.finalize',      'payroll',       'Finalise and reverse payroll'),
  ('crew_payments.view',    'crew_payments', 'View crew payments'),
  ('crew_payments.manage',  'crew_payments', 'Record crew payments'),
  ('crew_payments.approve', 'crew_payments', 'Approve crew payments'),
  ('reports.view',          'reports',       'View operational reports'),
  ('reports.financial',     'reports',       'View and export financial reports'),
  ('documents.view',        'bills',         'View and download uploaded documents'),
  ('documents.manage',      'bills',         'Upload and replace documents'),
  ('audit.view',            'audit',         'View audit history'),
  ('users.manage',          'users',         'Manage users and permissions'),
  ('settings.manage',       'settings',      'Manage company settings');

create table public.role_permissions (
  company_id uuid not null references public.companies(id) on delete cascade,
  role       public.app_role not null,
  permission text not null references public.permissions(key) on delete cascade,
  primary key (company_id, role, permission)
);

-- Default permission matrix applied when a company is created.
create or replace function public.default_role_permissions(p_role public.app_role)
returns setof text language sql immutable as $$
  select unnest(case p_role
    when 'owner' then (select array_agg(key) from public.permissions)
    when 'manager' then array[
      'dashboard.view','boats.view','crew.view','crew.manage','attendance.view','attendance.manage',
      'attendance.correct','trips.view','trips.manage','sales.view','sales.manage','income.view',
      'income.manage','expenses.view','expenses.manage','bills.view','bills.manage','suppliers.view',
      'suppliers.manage','advances.view','advances.manage','fish_taken.view','fish_taken.manage',
      'payroll.view','crew_payments.view','reports.view','documents.view','documents.manage',
      'wage_rules.view','bonuses.view','adjustments.view']
    when 'payroll_officer' then array[
      'dashboard.view','boats.view','crew.view','attendance.view','trips.view','sales.view',
      'wage_rules.view','bonuses.view','advances.view','advances.manage','fish_taken.view',
      'fish_taken.manage','adjustments.view','adjustments.manage','payroll.view','payroll.prepare',
      'crew_payments.view','crew_payments.manage','reports.view','documents.view','documents.manage']
    when 'accountant' then array[
      'dashboard.view','boats.view','crew.view','trips.view','sales.view','sales.manage','income.view',
      'income.manage','expenses.view','expenses.manage','transactions.approve','bills.view',
      'bills.manage','bills.pay','suppliers.view','suppliers.manage','payroll.view',
      'crew_payments.view','advances.view','fish_taken.view','reports.view','reports.financial',
      'documents.view','documents.manage','audit.view','adjustments.view']
    when 'readonly' then array[
      'dashboard.view','boats.view','crew.view','attendance.view','trips.view','sales.view',
      'reports.view']
  end)
$$;

-- ---------------------------------------------------------------------
-- Helper functions used by RLS policies.
-- SECURITY DEFINER so they can read profiles without recursive RLS.
-- ---------------------------------------------------------------------
create or replace function public.auth_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid() and active
$$;

create or replace function public.auth_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid() and active), false)
$$;

create or replace function public.has_perm(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.role = 'owner' or exists (
      select 1 from public.role_permissions rp
      where rp.company_id = p.company_id and rp.role = p.role and rp.permission = p_permission)
    from public.profiles p
    where p.id = auth.uid() and p.active
  ), false)
$$;

-- Raise a uniform error when a permission is missing (used by RPCs).
create or replace function public.require_perm(p_permission text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_permission) then
    raise exception 'permission_denied: %', p_permission using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Generic timestamps trigger
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Prevent users from escalating their own role/company through a profile update.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- service role / migrations
  end if;
  if new.company_id <> old.company_id then
    raise exception 'company cannot be changed';
  end if;
  if (new.role <> old.role or new.active <> old.active or new.all_boats <> old.all_boats)
     and not public.has_perm('users.manage') then
    raise exception 'permission_denied: users.manage' using errcode = '42501';
  end if;
  if old.role = 'owner' and new.role <> 'owner' and not exists (
       select 1 from public.profiles
       where company_id = old.company_id and role = 'owner' and active and id <> old.id) then
    raise exception 'A company must keep at least one active owner';
  end if;
  if old.role = 'owner' and new.active = false and not exists (
       select 1 from public.profiles
       where company_id = old.company_id and role = 'owner' and active and id <> old.id) then
    raise exception 'A company must keep at least one active owner';
  end if;
  if new.role = 'owner' and old.role <> 'owner' and not public.is_owner() then
    raise exception 'Only an owner can grant the owner role' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------
-- Human-readable document numbers per company (BILL-00001, etc.)
-- ---------------------------------------------------------------------
create table public.company_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  prefix     text not null,
  value      bigint not null default 0,
  primary key (company_id, prefix)
);

create or replace function public.next_code(p_company uuid, p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into public.company_counters(company_id, prefix, value) values (p_company, p_prefix, 1)
  on conflict (company_id, prefix) do update set value = public.company_counters.value + 1
  returning value into v;
  return p_prefix || '-' || lpad(v::text, 5, '0');
end $$;

-- Trigger: fill company_id / created_by defaults and a code column.
-- TG_ARGV[0] = prefix, TG_ARGV[1] = code column name (optional)
create or replace function public.fill_defaults()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  v_company uuid;
begin
  v_company := coalesce((j->>'company_id')::uuid, public.auth_company_id());
  if v_company is null then
    raise exception 'company_id is required';
  end if;
  if j ? 'company_id' then j := jsonb_set(j, '{company_id}', to_jsonb(v_company)); end if;
  if j ? 'created_by' and (j->>'created_by') is null and auth.uid() is not null then
    j := jsonb_set(j, '{created_by}', to_jsonb(auth.uid()));
  end if;
  if tg_nargs >= 2 and (j->>tg_argv[1]) is null then
    j := jsonb_set(j, array[tg_argv[1]], to_jsonb(public.next_code(v_company, tg_argv[0])));
  end if;
  new := jsonb_populate_record(new, j);
  return new;
end $$;

-- Block changing company_id on any row (tenant isolation).
create or replace function public.guard_company_change()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new)->>'company_id') is distinct from (to_jsonb(old)->>'company_id') then
    raise exception 'company_id cannot be changed';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  company_id  uuid,
  table_name  text not null,
  record_id   text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb,
  changed_fields text[],
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs(company_id, created_at desc);
create index audit_logs_record_idx on public.audit_logs(table_name, record_id);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_changed text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_changed
    from jsonb_object_keys(v_new) k
    where k not in ('updated_at') and (v_new->k) is distinct from (v_old->k);
    if v_changed is null then return new; end if;
  end if;
  insert into public.audit_logs(company_id, table_name, record_id, action, old_data, new_data, changed_fields, user_id)
  values (
    coalesce((v_row->>'company_id')::uuid, case when tg_table_name = 'companies' then (v_row->>'id')::uuid end),
    tg_table_name, coalesce(v_row->>'id', v_row->>'key'), lower(tg_op), v_old, v_new, v_changed, auth.uid());
  return coalesce(new, old);
end $$;

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function public.audit_trigger();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
create trigger role_permissions_audit after insert or update or delete on public.role_permissions
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------
-- Approvals history (generic, for every approve/reject/void action)
-- ---------------------------------------------------------------------
create table public.approvals (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,  -- submitted, approved, rejected, returned, voided, finalized, reversed, closed...
  comment     text,
  acted_by    uuid references auth.users(id),
  acted_at    timestamptz not null default now()
);
create index approvals_entity_idx on public.approvals(entity_type, entity_id);

create or replace function public.log_approval(p_company uuid, p_type text, p_id uuid, p_action text, p_comment text)
returns void language sql security definer set search_path = public as $$
  insert into public.approvals(company_id, entity_type, entity_id, action, comment, acted_by)
  values (p_company, p_type, p_id, p_action, nullif(trim(coalesce(p_comment,'')), ''), auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Onboarding: first sign-up creates a company and makes the user owner.
-- ---------------------------------------------------------------------
create or replace function public.bootstrap_company(
  p_company_name text, p_full_name text, p_language public.app_language default 'en')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This user already belongs to a company';
  end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.companies(name, default_language) values (p_company_name, p_language)
  returning id into v_company;
  insert into public.profiles(id, company_id, full_name, email, role, language, all_boats)
  values (auth.uid(), v_company, coalesce(p_full_name,''), v_email, 'owner', p_language, true);
  insert into public.role_permissions(company_id, role, permission)
  select v_company, r.role, p
  from unnest(enum_range(null::public.app_role)) as r(role)
  cross join lateral public.default_role_permissions(r.role) as p
  where r.role <> 'owner';
  perform public.seed_company_defaults(v_company);
  return v_company;
end $$;

-- Placeholder: replaced in 0002 once categories/fish types exist.
create or replace function public.seed_company_defaults(p_company uuid)
returns void language plpgsql as $$ begin null; end $$;

-- Returns the current user's profile + permission list in one call.
create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', to_jsonb(p),
    'company', to_jsonb(c),
    'permissions', case when p.role = 'owner'
        then (select jsonb_agg(key) from public.permissions)
        else coalesce((select jsonb_agg(permission) from public.role_permissions rp
                       where rp.company_id = p.company_id and rp.role = p.role), '[]'::jsonb) end
  )
  from public.profiles p join public.companies c on c.id = p.company_id
  where p.id = auth.uid()
$$;
