-- =====================================================================
-- Galary — 0002 Fleet, crew, trips, attendance, catch & sales, ledger
-- =====================================================================

create type public.trip_status as enum ('planned', 'active', 'returned', 'under_review', 'closed');
create type public.attendance_status as enum ('present', 'absent', 'sick_leave', 'approved_leave');
create type public.txn_kind as enum ('income', 'expense');
create type public.payment_status as enum ('unpaid', 'partially_paid', 'paid', 'not_applicable');

-- ---------------------------------------------------------------------
-- Boats
-- ---------------------------------------------------------------------
create table public.boats (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  name            text not null check (length(trim(name)) > 0),
  name_dv         text,
  registration_no text not null check (length(trim(registration_no)) > 0),
  vessel_type     text,
  length_m        numeric(8,2) check (length_m is null or length_m > 0),
  engine          text,
  capacity        text,
  license_no      text,
  home_island     text,
  details         text,
  photo_document_id uuid,
  manager_id      uuid references public.profiles(id) on delete set null,
  status          public.record_status not null default 'active',
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, registration_no)
);
create index boats_company_idx on public.boats(company_id);

-- Which boats a non-owner user may access.
create table public.user_boats (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  boat_id    uuid not null references public.boats(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  primary key (user_id, boat_id)
);

create or replace function public.can_access_boat(p_boat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_boat is null then public.auth_company_id() is not null
    else coalesce((
      select (p.role = 'owner' or p.all_boats or exists (
                select 1 from public.user_boats ub where ub.user_id = p.id and ub.boat_id = p_boat)
              or exists (select 1 from public.boats b where b.id = p_boat and b.manager_id = p.id))
             -- never a boat of another company (a just-inserted boat is not yet visible here)
             and not exists (select 1 from public.boats b where b.id = p_boat and b.company_id <> p.company_id)
      from public.profiles p where p.id = auth.uid() and p.active), false)
  end
$$;

-- ---------------------------------------------------------------------
-- Crew members & boat assignments (history preserved)
-- ---------------------------------------------------------------------
create table public.crew_members (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete restrict,
  crew_code       text,
  name_en         text,
  name_dv         text,
  id_card_no      text,
  phone           text,
  email           text,
  address         text,
  island          text,
  emergency_name  text,
  emergency_phone text,
  emergency_relation text,
  job_role        text not null default 'fisherman',
  joining_date    date,
  leaving_date    date,
  status          public.record_status not null default 'active',
  wage_method     text,
  bank_name       text,
  bank_account    text,
  photo_document_id uuid,
  notes           text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (coalesce(trim(name_en), '') <> '' or coalesce(trim(name_dv), '') <> ''),
  check (leaving_date is null or joining_date is null or leaving_date >= joining_date),
  unique (company_id, crew_code)
);
create index crew_company_idx on public.crew_members(company_id);

create table public.boat_assignments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  crew_id     uuid not null references public.crew_members(id) on delete restrict,
  boat_id     uuid not null references public.boats(id) on delete restrict,
  job_role    text,
  start_date  date not null default current_date,
  end_date    date,
  notes       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create unique index boat_assignments_one_open on public.boat_assignments(crew_id) where end_date is null;
create index boat_assignments_boat_idx on public.boat_assignments(boat_id, start_date);

create or replace function public.crew_accessible(p_crew uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- Company isolation is enforced by the calling policy (row company_id).
  select public.is_owner()
      or coalesce((select all_boats from public.profiles where id = auth.uid() and active), false)
      or not exists (select 1 from public.boat_assignments a where a.crew_id = p_crew)
      or exists (select 1 from public.boat_assignments a
                 where a.crew_id = p_crew and public.can_access_boat(a.boat_id))
$$;

-- Move a crew member to a boat: closes the open assignment and opens a new one.
create or replace function public.assign_crew_to_boat(
  p_crew uuid, p_boat uuid, p_start date default current_date, p_role text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_company uuid; v_open record;
begin
  perform public.require_perm('crew.manage');
  select company_id into v_company from public.crew_members where id = p_crew;
  if v_company is distinct from public.auth_company_id() then raise exception 'crew not found'; end if;
  if p_boat is not null and not public.can_access_boat(p_boat) then raise exception 'boat not accessible'; end if;
  select * into v_open from public.boat_assignments where crew_id = p_crew and end_date is null for update;
  if found then
    if v_open.boat_id = p_boat then return v_open.id; end if;
    if p_start <= v_open.start_date then
      raise exception 'New assignment must start after % (current assignment start)', v_open.start_date;
    end if;
    update public.boat_assignments set end_date = p_start - 1 where id = v_open.id;
  end if;
  if p_boat is null then return null; end if;
  insert into public.boat_assignments(company_id, crew_id, boat_id, job_role, start_date, notes, created_by)
  values (v_company, p_crew, p_boat, p_role, p_start, p_notes, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Trips
-- ---------------------------------------------------------------------
create table public.trips (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  trip_code    text,
  boat_id      uuid not null references public.boats(id) on delete restrict,
  start_date   date not null,
  return_date  date,
  status       public.trip_status not null default 'planned',
  location     text,
  notes        text,
  closed_by    uuid references auth.users(id),
  closed_at    timestamptz,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (return_date is null or return_date >= start_date),
  unique (company_id, trip_code)
);
create index trips_boat_idx on public.trips(boat_id, start_date desc);

create table public.trip_crew (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  crew_id    uuid not null references public.crew_members(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  job_role   text,
  primary key (trip_id, crew_id)
);

-- ---------------------------------------------------------------------
-- Attendance
-- ---------------------------------------------------------------------
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  boat_id     uuid not null references public.boats(id) on delete restrict,
  trip_id     uuid references public.trips(id) on delete restrict,
  crew_id     uuid not null references public.crew_members(id) on delete restrict,
  date        date not null,
  status      public.attendance_status not null,
  notes       text,
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (crew_id, date)    -- duplicate-entry prevention: one record per person per day
);
create index attendance_boat_date_idx on public.attendance(boat_id, date);

create or replace function public.guard_attendance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.has_perm('attendance.correct')
       and not (old.created_by = auth.uid() and old.created_at::date = current_date) then
      raise exception 'permission_denied: attendance.correct' using errcode = '42501';
    end if;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  if new.date > current_date + 1 then
    raise exception 'Attendance cannot be recorded for future dates';
  end if;
  return new;
end $$;
create trigger attendance_guard before insert or update on public.attendance
  for each row execute function public.guard_attendance();

-- ---------------------------------------------------------------------
-- Fish types, customers, suppliers, categories
-- ---------------------------------------------------------------------
create table public.fish_types (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name_en      text not null,
  name_dv      text,
  default_unit text not null default 'kg' check (default_unit in ('kg','pcs','ton','lb')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (company_id, name_en)
);

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  name        text not null check (length(trim(name)) > 0),
  name_dv     text,
  contact_person text,
  phone       text,
  email       text,
  address     text,
  tin         text,
  notes       text,
  status      public.record_status not null default 'active',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index customers_company_idx on public.customers(company_id);

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete restrict,
  name        text not null check (length(trim(name)) > 0),
  name_dv     text,
  contact_person text,
  phone       text,
  email       text,
  address     text,
  tin         text,
  bank_details text,
  notes       text,
  status      public.record_status not null default 'active',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index suppliers_company_idx on public.suppliers(company_id);
create index suppliers_name_idx on public.suppliers(company_id, lower(name));

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  kind        public.txn_kind not null,
  code        text not null,
  name_en     text not null,
  name_dv     text,
  is_system   boolean not null default false,
  active      boolean not null default true,
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  unique (company_id, kind, code)
);

-- ---------------------------------------------------------------------
-- Documents (bills, receipts, photos…) with version history.
-- Files live in the private "documents" storage bucket.
-- ---------------------------------------------------------------------
create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  entity_type   text not null check (entity_type in (
                  'bill','bill_payment','transaction','fish_sale','customer_receipt','trip','boat',
                  'crew','cash_advance','fish_taken','adjustment','crew_payment','wage_slip','other')),
  entity_id     uuid,
  boat_id       uuid references public.boats(id) on delete restrict,
  doc_kind      text not null default 'supporting' check (doc_kind in (
                  'bill','invoice','receipt','payment_receipt','photo','id_document','spreadsheet','supporting','other')),
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null check (mime_type in (
                  'application/pdf','image/jpeg','image/png','image/webp','image/heic',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/vnd.ms-excel','text/csv')),
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 20 * 1024 * 1024),
  version       int not null default 1,
  original_id   uuid references public.documents(id),
  replaces_id   uuid references public.documents(id),
  replaced_reason text,
  is_current    boolean not null default true,
  description   text,
  uploaded_by   uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create index documents_entity_idx on public.documents(entity_type, entity_id);
create unique index documents_one_successor on public.documents(replaces_id) where replaces_id is not null;

create or replace function public.guard_documents()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev record;
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
    if new.storage_path not like (new.company_id::text || '/%') then
      raise exception 'storage path must start with the company id';
    end if;
    if new.replaces_id is not null then
      select * into v_prev from public.documents where id = new.replaces_id for update;
      if not found or v_prev.company_id <> new.company_id then raise exception 'document to replace not found'; end if;
      if not v_prev.is_current then raise exception 'Only the current version of a document can be replaced'; end if;
      if coalesce(trim(new.replaced_reason), '') = '' then
        raise exception 'A reason is required when replacing a document';
      end if;
      new.version := v_prev.version + 1;
      new.original_id := coalesce(v_prev.original_id, v_prev.id);
      new.entity_type := v_prev.entity_type;
      new.entity_id := v_prev.entity_id;
      new.boat_id := coalesce(new.boat_id, v_prev.boat_id);
      update public.documents set is_current = false where id = v_prev.id;
    else
      new.version := 1;
      new.original_id := null;
    end if;
    return new;
  end if;
  -- UPDATE: only description, entity link (when not yet linked) and the is_current flag may change
  if new.storage_path <> old.storage_path or new.mime_type <> old.mime_type
     or new.size_bytes <> old.size_bytes or new.version <> old.version
     or new.file_name <> old.file_name then
    raise exception 'Documents are immutable; upload a replacement version instead';
  end if;
  if old.entity_id is not null and new.entity_id is distinct from old.entity_id then
    raise exception 'A document cannot be moved to another record';
  end if;
  return new;
end $$;
create trigger documents_guard before insert or update on public.documents
  for each row execute function public.guard_documents();

-- ---------------------------------------------------------------------
-- Catch records (fish caught) and fish sales (commercial income)
-- ---------------------------------------------------------------------
create table public.catch_records (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  trip_id      uuid not null references public.trips(id) on delete restrict,
  boat_id      uuid not null references public.boats(id) on delete restrict,
  date         date not null,
  fish_type_id uuid not null references public.fish_types(id) on delete restrict,
  quantity     numeric(14,3) not null check (quantity > 0),
  unit         text not null default 'kg' check (unit in ('kg','pcs','ton','lb')),
  notes        text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index catch_trip_idx on public.catch_records(trip_id);

create table public.fish_sales (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  sale_code      text,
  trip_id        uuid references public.trips(id) on delete restrict,
  boat_id        uuid not null references public.boats(id) on delete restrict,
  date           date not null,
  fish_type_id   uuid not null references public.fish_types(id) on delete restrict,
  quantity       numeric(14,3) not null check (quantity > 0),
  unit           text not null default 'kg' check (unit in ('kg','pcs','ton','lb')),
  unit_price     numeric(14,2) not null check (unit_price >= 0),
  total          numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored,
  customer_id    uuid references public.customers(id) on delete restrict,
  invoice_no     text,
  notes          text,
  status         text not null default 'recorded' check (status in ('recorded','voided')),
  void_reason    text,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, sale_code)
);
create index fish_sales_boat_date_idx on public.fish_sales(boat_id, date);
create index fish_sales_trip_idx on public.fish_sales(trip_id);

-- Cash actually received from customers (separate from income recognition).
create table public.customer_receipts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  receipt_code  text,
  sale_id       uuid not null references public.fish_sales(id) on delete restrict,
  date          date not null,
  amount        numeric(14,2) not null check (amount > 0),
  method        text not null check (method in ('cash','bank_transfer','cheque','card','mobile','other')),
  reference     text,
  document_id   uuid references public.documents(id),
  request_id    uuid unique,
  status        text not null default 'valid' check (status in ('valid','voided')),
  void_reason   text,
  recorded_by   uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (company_id, receipt_code)
);
create index customer_receipts_sale_idx on public.customer_receipts(sale_id);
create unique index customer_receipts_ref_uniq on public.customer_receipts(company_id, method, lower(reference))
  where reference is not null and status = 'valid' and method <> 'cash';

-- ---------------------------------------------------------------------
-- Income & expense ledger (recognition). Bills create one expense row
-- on approval; payments are recorded separately and never add expense.
-- ---------------------------------------------------------------------
create table public.transactions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete restrict,
  txn_code       text,
  kind           public.txn_kind not null,
  date           date not null,
  category_id    uuid not null references public.categories(id) on delete restrict,
  amount         numeric(14,2) not null check (amount > 0),
  boat_id        uuid references public.boats(id) on delete restrict,
  trip_id        uuid references public.trips(id) on delete restrict,
  supplier_id    uuid references public.suppliers(id) on delete restrict,
  customer_id    uuid references public.customers(id) on delete restrict,
  description    text,
  payment_status public.payment_status not null default 'paid',
  payment_method text check (payment_method is null or payment_method in ('cash','bank_transfer','cheque','card','mobile','other')),
  reference      text,
  document_id    uuid references public.documents(id),
  source         text not null default 'manual' check (source in ('manual','bill')),
  bill_id        uuid unique,
  status         public.approval_status not null default 'pending_approval',
  void_reason    text,
  created_by     uuid references auth.users(id),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, txn_code),
  check (kind = 'expense' or supplier_id is null),
  check (source = 'manual' or bill_id is not null)
);
create index transactions_company_date_idx on public.transactions(company_id, date);
create index transactions_boat_idx on public.transactions(boat_id, date);
create index transactions_trip_idx on public.transactions(trip_id);

create or replace function public.guard_transaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat record;
begin
  select * into v_cat from public.categories where id = new.category_id;
  if v_cat.kind <> new.kind or v_cat.company_id <> new.company_id then
    raise exception 'Category does not match the transaction type';
  end if;
  if auth.uid() is null then return new; end if;      -- trusted backend / bill functions
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.source <> 'manual' then raise exception 'Bill expenses are created by approving a bill'; end if;
    if new.status not in ('draft','pending_approval','approved') then
      raise exception 'Invalid initial status';
    end if;
    if new.status = 'approved' then
      if not public.has_perm('transactions.approve') then new.status := 'pending_approval';
      else new.approved_by := auth.uid(); new.approved_at := now(); end if;
    end if;
    return new;
  end if;
  -- UPDATE
  if old.source = 'bill' then
    raise exception 'This expense is controlled by its bill. Edit, void or pay the bill instead.';
  end if;
  if old.status in ('approved','voided','rejected') then
    if new.amount <> old.amount or new.date <> old.date or new.kind <> old.kind
       or new.category_id <> old.category_id or new.boat_id is distinct from old.boat_id
       or new.trip_id is distinct from old.trip_id then
      raise exception 'Approved transactions cannot be edited. Void it and record a correction.';
    end if;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Use the approve / reject / void actions to change status';
  end if;
  return new;
end $$;
create trigger transactions_guard before insert or update on public.transactions
  for each row execute function public.guard_transaction();

-- Status actions for manual transactions
create or replace function public.set_transaction_status(p_id uuid, p_action text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_perm text;
begin
  select * into v from public.transactions where id = p_id for update;
  if not found or v.company_id <> public.auth_company_id() or not public.can_access_boat(v.boat_id) then
    raise exception 'transaction not found';
  end if;
  if v.source = 'bill' then raise exception 'Bill expenses follow their bill'; end if;
  perform set_config('galary.trusted', 'on', true);
  if p_action = 'submit' then
    perform public.require_perm(case v.kind when 'income' then 'income.manage' else 'expenses.manage' end);
    if v.status not in ('draft','rejected') then raise exception 'Only drafts can be submitted'; end if;
    update public.transactions set status = 'pending_approval' where id = p_id;
  elsif p_action = 'approve' then
    perform public.require_perm('transactions.approve');
    if v.status not in ('pending_approval','draft') then raise exception 'Not awaiting approval'; end if;
    update public.transactions set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  elsif p_action = 'reject' then
    perform public.require_perm('transactions.approve');
    if v.status <> 'pending_approval' then raise exception 'Not awaiting approval'; end if;
    if coalesce(trim(p_comment),'') = '' then raise exception 'A reason is required'; end if;
    update public.transactions set status = 'rejected' where id = p_id;
  elsif p_action = 'void' then
    perform public.require_perm('transactions.approve');
    if v.status = 'voided' then raise exception 'Already voided'; end if;
    if coalesce(trim(p_comment),'') = '' then raise exception 'A reason is required to void'; end if;
    update public.transactions set status = 'voided', void_reason = p_comment where id = p_id;
  else
    raise exception 'unknown action %', p_action;
  end if;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'transaction', p_id, p_action, p_comment);
end $$;

-- ---------------------------------------------------------------------
-- Fish sale + optional initial receipt (atomic)
-- ---------------------------------------------------------------------
create or replace function public.sale_received(p_sale uuid)
returns numeric language sql stable as $$
  select coalesce(sum(amount), 0) from public.customer_receipts where sale_id = p_sale and status = 'valid'
$$;

create or replace function public.record_customer_receipt(
  p_sale uuid, p_date date, p_amount numeric, p_method text, p_reference text default null,
  p_document uuid default null, p_request uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sale record; v_id uuid; v_out numeric;
begin
  perform public.require_perm('sales.manage');
  if p_request is not null then
    select id into v_id from public.customer_receipts where request_id = p_request;
    if found then return v_id; end if;   -- idempotent retry, no double recording
  end if;
  select * into v_sale from public.fish_sales where id = p_sale for update;
  if not found or v_sale.company_id <> public.auth_company_id() or not public.can_access_boat(v_sale.boat_id) then
    raise exception 'sale not found';
  end if;
  if v_sale.status = 'voided' then raise exception 'Cannot receive payment for a voided sale'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  v_out := v_sale.total - public.sale_received(p_sale);
  if p_amount > v_out then
    raise exception 'Receipt (%) exceeds outstanding balance (%)', p_amount, v_out;
  end if;
  insert into public.customer_receipts(company_id, receipt_code, sale_id, date, amount, method, reference, document_id, request_id)
  values (v_sale.company_id, public.next_code(v_sale.company_id, 'RCP'), p_sale, p_date, p_amount, p_method,
          nullif(trim(p_reference),''), p_document, p_request)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.void_customer_receipt(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_perm('transactions.approve');
  select r.*, s.boat_id into v from public.customer_receipts r join public.fish_sales s on s.id = r.sale_id
  where r.id = p_id for update of r;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'receipt not found'; end if;
  if v.status = 'voided' then raise exception 'Already voided'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  update public.customer_receipts set status = 'voided', void_reason = p_reason where id = p_id;
  perform public.log_approval(v.company_id, 'customer_receipt', p_id, 'voided', p_reason);
end $$;

create or replace function public.void_fish_sale(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_perm('transactions.approve');
  select * into v from public.fish_sales where id = p_id for update;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'sale not found'; end if;
  if v.status = 'voided' then raise exception 'Already voided'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  if public.sale_received(p_id) > 0 then raise exception 'Void the customer receipts for this sale first'; end if;
  update public.fish_sales set status = 'voided', void_reason = p_reason where id = p_id;
  perform public.log_approval(v.company_id, 'fish_sale', p_id, 'voided', p_reason);
end $$;

create or replace function public.guard_fish_sale()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.status = 'recorded' and new.status = 'recorded'
     and (new.quantity <> old.quantity or new.unit_price <> old.unit_price)
     and public.sale_received(old.id) > new.quantity * new.unit_price then
    raise exception 'New total would be less than the amount already received';
  end if;
  if tg_op = 'UPDATE' and old.status = 'voided' then
    raise exception 'Voided sales cannot be edited';
  end if;
  return new;
end $$;
create trigger fish_sales_guard before update on public.fish_sales
  for each row execute function public.guard_fish_sale();

-- ---------------------------------------------------------------------
-- Closed-trip protection: nothing new may be attached to a closed trip
-- ---------------------------------------------------------------------
create or replace function public.guard_closed_trip()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status public.trip_status; v_boat uuid; j jsonb := to_jsonb(new);
begin
  if (j->>'trip_id') is null then return new; end if;
  select status, boat_id into v_status, v_boat from public.trips where id = (j->>'trip_id')::uuid;
  if v_status = 'closed' and current_setting('galary.trusted', true) is distinct from 'on' then
    raise exception 'Trip is closed; records can no longer be added or changed';
  end if;
  if (j->>'boat_id') is not null and (j->>'boat_id')::uuid is distinct from v_boat then
    raise exception 'Record boat must match the trip boat';
  end if;
  return new;
end $$;

create trigger catch_closed_trip before insert or update on public.catch_records
  for each row execute function public.guard_closed_trip();
create trigger sales_closed_trip before insert or update on public.fish_sales
  for each row execute function public.guard_closed_trip();
create trigger txn_closed_trip before insert or update on public.transactions
  for each row execute function public.guard_closed_trip();
create trigger attendance_closed_trip before insert or update on public.attendance
  for each row execute function public.guard_closed_trip();

-- Trip status transitions with checks before closing
create or replace function public.set_trip_status(p_trip uuid, p_status public.trip_status, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_settings jsonb; v_missing text[] := '{}';
begin
  select * into v from public.trips where id = p_trip for update;
  if not found or v.company_id <> public.auth_company_id() or not public.can_access_boat(v.boat_id) then
    raise exception 'trip not found';
  end if;
  select settings into v_settings from public.companies where id = v.company_id;
  perform set_config('galary.trip_status_fn', 'on', true);
  if p_status = 'closed' then
    perform public.require_perm('trips.close');
    if v.status <> 'under_review' then raise exception 'Trip must be under review before it can be closed'; end if;
    if v.return_date is null then v_missing := v_missing || 'return_date'; end if;
    if coalesce((v_settings->>'trip_close_requires_sales')::boolean, true)
       and not exists (select 1 from public.fish_sales where trip_id = p_trip and status = 'recorded')
       and not exists (select 1 from public.catch_records where trip_id = p_trip) then
      v_missing := v_missing || 'catch_or_sales';
    end if;
    if exists (select 1 from public.transactions where trip_id = p_trip and status in ('draft','pending_approval')) then
      v_missing := v_missing || 'transactions_pending_approval';
    end if;
    if exists (select 1 from public.trip_crew where trip_id = p_trip) is false then
      v_missing := v_missing || 'crew';
    end if;
    if array_length(v_missing, 1) > 0 then
      raise exception 'Trip cannot be closed. Missing: %', array_to_string(v_missing, ', ');
    end if;
    update public.trips set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_trip;
  elsif v.status = 'closed' then
    perform public.require_perm('trips.close');
    if not public.is_owner() then raise exception 'Only an owner can reopen a closed trip'; end if;
    if coalesce(trim(p_comment),'') = '' then raise exception 'A reason is required to reopen a trip'; end if;
    update public.trips set status = p_status, closed_by = null, closed_at = null where id = p_trip;
  else
    perform public.require_perm('trips.manage');
    if p_status = 'returned' and v.return_date is null then
      update public.trips set status = p_status, return_date = greatest(current_date, v.start_date) where id = p_trip;
    else
      update public.trips set status = p_status where id = p_trip;
    end if;
  end if;
  perform set_config('galary.trip_status_fn', 'off', true);
  perform public.log_approval(v.company_id, 'trip', p_trip, 'status:' || p_status::text, p_comment);
end $$;

create or replace function public.guard_trip_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status
     and current_setting('galary.trip_status_fn', true) is distinct from 'on' then
    raise exception 'Use the trip status actions to change status';
  end if;
  if old.status = 'closed' and new.status = 'closed' and auth.uid() is not null then
    raise exception 'Closed trips cannot be edited';
  end if;
  if new.boat_id <> old.boat_id and (
       exists (select 1 from public.fish_sales where trip_id = old.id)
    or exists (select 1 from public.transactions where trip_id = old.id)
    or exists (select 1 from public.catch_records where trip_id = old.id)) then
    raise exception 'Boat cannot change once records are attached to the trip';
  end if;
  return new;
end $$;
create trigger trips_guard before update on public.trips
  for each row execute function public.guard_trip_update();

-- ---------------------------------------------------------------------
-- Default data for new companies
-- ---------------------------------------------------------------------
create or replace function public.seed_company_defaults(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.categories(company_id, kind, code, name_en, name_dv, is_system, sort_order) values
    (p_company, 'income',  'fish_sales',       'Fish sales',                  'މަސް ވިއްކުން',                 true, 10),
    (p_company, 'income',  'other_fishing',    'Other fishing income',        'މަސްވެރިކަމުގެ އެހެނިހެން އާމްދަނީ', false, 20),
    (p_company, 'income',  'other_income',     'Other income',                'އެހެނިހެން އާމްދަނީ',            false, 30),
    (p_company, 'expense', 'fuel',             'Fuel and lubricants',         'ތެލާއި ލުބްރިކެންޓް',             false, 10),
    (p_company, 'expense', 'fishing_supplies', 'Fishing equipment and supplies','މަސްވެރިކަމުގެ ސާމާނު',      false, 20),
    (p_company, 'expense', 'food',             'Food and provisions',         'ކާނާއާއި ރާޝަން',               false, 30),
    (p_company, 'expense', 'ice',              'Ice and storage',             'ގަނޑުފެނާއި ރައްކާކުރުން',      false, 40),
    (p_company, 'expense', 'repairs',          'Repairs and maintenance',     'މަރާމާތު',                       false, 50),
    (p_company, 'expense', 'spare_parts',      'Spare parts',                 'ސްޕެއާ ޕާޓްސް',                  false, 60),
    (p_company, 'expense', 'transport',        'Transport',                   'ދަތުރުފަތުރު',                   false, 70),
    (p_company, 'expense', 'crew_related',     'Crew-related expenses',       'ބަހަރުވެރިންނާ ގުޅޭ ޚަރަދު',     false, 80),
    (p_company, 'expense', 'utilities',        'Utilities and services',      'ޔޫޓިލިޓީޒް އަދި ޚިދުމަތް',       false, 90),
    (p_company, 'expense', 'other',            'Other expenses',              'އެހެނިހެން ޚަރަދު',              false, 100)
  on conflict do nothing;

  insert into public.fish_types(company_id, name_en, name_dv, default_unit) values
    (p_company, 'Skipjack tuna',  'ކަޅުބިލަމަސް', 'kg'),
    (p_company, 'Yellowfin tuna', 'ކަންނެލި',     'kg'),
    (p_company, 'Frigate tuna',   'ރާގޮނޑި',      'kg'),
    (p_company, 'Reef fish',      'ފަރުމަސް',     'kg'),
    (p_company, 'Other fish',     'އެހެނިހެން މަސް', 'kg')
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------
-- Fill defaults, codes, tenant guard and audit for every table above
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('boats', null, null), ('crew_members', 'CRW', 'crew_code'), ('boat_assignments', null, null),
    ('trips', 'TRP', 'trip_code'), ('trip_crew', null, null), ('attendance', null, null),
    ('fish_types', null, null), ('customers', null, null), ('suppliers', null, null),
    ('categories', null, null), ('documents', null, null), ('catch_records', null, null),
    ('fish_sales', 'SAL', 'sale_code'), ('customer_receipts', 'RCP', 'receipt_code'),
    ('transactions', 'TXN', 'txn_code'), ('user_boats', null, null)
  ) as t(tbl, prefix, col)
  loop
    if r.prefix is null then
      execute format('create trigger %I before insert on public.%I for each row execute function public.fill_defaults()',
                     r.tbl || '_defaults', r.tbl);
    else
      execute format('create trigger %I before insert on public.%I for each row execute function public.fill_defaults(%L, %L)',
                     r.tbl || '_defaults', r.tbl, r.prefix, r.col);
    end if;
    execute format('create trigger %I before update on public.%I for each row execute function public.guard_company_change()',
                   r.tbl || '_tenant', r.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()',
                   r.tbl || '_audit', r.tbl);
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name=r.tbl and column_name='updated_at') then
      execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
                     r.tbl || '_touch', r.tbl);
    end if;
  end loop;
end $$;
