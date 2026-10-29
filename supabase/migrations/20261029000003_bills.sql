-- =====================================================================
-- Galary — 0003 Bills, supplier payments and balances
--   * A bill is recognised as ONE expense transaction when approved.
--   * Payments (installments) are recorded separately and only reduce
--     the outstanding balance; they never create additional expense.
-- =====================================================================

create type public.bill_status as enum (
  'draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'rejected', 'voided');

create table public.bills (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  bill_code        text,
  supplier_id      uuid not null references public.suppliers(id) on delete restrict,
  invoice_no       text,
  bill_date        date not null,
  due_date         date,
  category_id      uuid not null references public.categories(id) on delete restrict,
  description      text,
  boat_id          uuid references public.boats(id) on delete restrict,
  trip_id          uuid references public.trips(id) on delete restrict,
  subtotal         numeric(14,2) not null default 0 check (subtotal >= 0),
  tax_amount       numeric(14,2) not null default 0 check (tax_amount >= 0),
  total            numeric(14,2) generated always as (subtotal + tax_amount) stored,
  status           public.bill_status not null default 'draft',
  notes            text,
  ocr_data         jsonb,
  ocr_confirmed    boolean not null default false,
  ocr_confirmed_by uuid references auth.users(id),
  duplicate_override_reason text,
  duplicate_override_by     uuid references auth.users(id),
  return_comment   text,
  rejection_reason text,
  void_reason      text,
  created_by       uuid references auth.users(id),
  submitted_at     timestamptz,
  approved_by      uuid references auth.users(id),
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, bill_code),
  check (due_date is null or due_date >= bill_date)
);
create index bills_company_status_idx on public.bills(company_id, status);
create index bills_supplier_idx on public.bills(supplier_id, bill_date);
create index bills_boat_idx on public.bills(boat_id, bill_date);
create index bills_trip_idx on public.bills(trip_id);
create index bills_invoice_idx on public.bills(company_id, supplier_id, lower(invoice_no));

alter table public.transactions
  add constraint transactions_bill_fk foreign key (bill_id) references public.bills(id) on delete restrict;

create table public.bill_payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  payment_code     text,
  bill_id          uuid not null references public.bills(id) on delete restrict,
  supplier_id      uuid not null references public.suppliers(id) on delete restrict,
  date             date not null,
  amount           numeric(14,2) not null check (amount > 0),        -- cash paid
  applied_amount   numeric(14,2) not null check (applied_amount >= 0), -- applied to the bill
  overpaid_amount  numeric(14,2) not null default 0 check (overpaid_amount >= 0),
  overpayment_reason text,
  method           text not null check (method in ('cash','bank_transfer','cheque','card','mobile','other')),
  reference        text,
  receipt_document_id uuid references public.documents(id),
  notes            text,
  request_id       uuid unique,
  status           text not null default 'valid' check (status in ('valid','voided')),
  void_reason      text,
  recorded_by      uuid references auth.users(id) default auth.uid(),
  approved_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  unique (company_id, payment_code),
  check (applied_amount + overpaid_amount = amount),
  check (overpaid_amount = 0 or coalesce(trim(overpayment_reason), '') <> '')
);
create index bill_payments_bill_idx on public.bill_payments(bill_id);
-- Never record the same payment reference twice
create unique index bill_payments_ref_uniq on public.bill_payments(company_id, method, lower(reference))
  where reference is not null and status = 'valid' and method <> 'cash';

-- ---------------------------------------------------------------------
-- Balances
-- ---------------------------------------------------------------------
create or replace function public.bill_paid(p_bill uuid)
returns numeric language sql stable as $$
  select coalesce(sum(applied_amount), 0) from public.bill_payments where bill_id = p_bill and status = 'valid'
$$;

-- Possible duplicates: same supplier & invoice number, or same supplier, date and amount.
create or replace function public.find_bill_duplicates(
  p_supplier uuid, p_invoice text, p_date date, p_total numeric, p_exclude uuid default null)
returns table (id uuid, bill_code text, invoice_no text, bill_date date, total numeric, status public.bill_status, match_reason text)
language sql stable security invoker set search_path = public as $$
  select b.id, b.bill_code, b.invoice_no, b.bill_date, b.total, b.status,
         case when p_invoice is not null and lower(trim(b.invoice_no)) = lower(trim(p_invoice)) then 'invoice_no'
              else 'date_amount' end
  from public.bills b
  where b.company_id = public.auth_company_id()
    and b.supplier_id = p_supplier
    and b.status not in ('voided','rejected')
    and (p_exclude is null or b.id <> p_exclude)
    and ((p_invoice is not null and trim(p_invoice) <> '' and lower(trim(b.invoice_no)) = lower(trim(p_invoice)))
         or (b.bill_date = p_date and b.total = p_total))
$$;

-- ---------------------------------------------------------------------
-- Guards: bills are editable only while in draft
-- ---------------------------------------------------------------------
create or replace function public.guard_bill()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cat record;
begin
  select * into v_cat from public.categories where id = new.category_id;
  if v_cat.kind <> 'expense' or v_cat.company_id <> new.company_id then
    raise exception 'Bills must use an expense category';
  end if;
  if new.trip_id is not null and new.boat_id is null then
    select boat_id into new.boat_id from public.trips where id = new.trip_id;
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.status <> 'draft' then
      raise exception 'New bills start as drafts';
    end if;
    return new;
  end if;
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  if new.status is distinct from old.status then
    raise exception 'Use the bill workflow actions to change status';
  end if;
  if old.status <> 'draft' then
    if new.supplier_id <> old.supplier_id or new.invoice_no is distinct from old.invoice_no
       or new.bill_date <> old.bill_date or new.due_date is distinct from old.due_date
       or new.category_id <> old.category_id or new.boat_id is distinct from old.boat_id
       or new.trip_id is distinct from old.trip_id or new.subtotal <> old.subtotal
       or new.tax_amount <> old.tax_amount or new.description is distinct from old.description
       or new.ocr_data is distinct from old.ocr_data then
      raise exception 'Only draft bills can be edited. Return the bill for correction or void it.';
    end if;
  end if;
  if new.ocr_confirmed and not old.ocr_confirmed then
    new.ocr_confirmed_by := auth.uid();
  end if;
  return new;
end $$;
create trigger bills_guard before insert or update on public.bills
  for each row execute function public.guard_bill();
create trigger bills_closed_trip before insert or update on public.bills
  for each row execute function public.guard_closed_trip();

create or replace function public.guard_bill_payment()
returns trigger language plpgsql as $$
begin
  if current_setting('galary.trusted', true) = 'on' then return new; end if;
  raise exception 'Bill payments are recorded and voided only through the payment actions';
end $$;
create trigger bill_payments_guard before insert or update on public.bill_payments
  for each row execute function public.guard_bill_payment();

-- ---------------------------------------------------------------------
-- Payment status recalculation
-- ---------------------------------------------------------------------
create or replace function public.refresh_bill_payment_status(p_bill uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_paid numeric; v_new public.bill_status; v_pay public.payment_status;
begin
  select * into v from public.bills where id = p_bill;
  if v.status not in ('approved','partially_paid','paid') then return; end if;
  v_paid := public.bill_paid(p_bill);
  v_new := case when v_paid >= v.total then 'paid' when v_paid > 0 then 'partially_paid' else 'approved' end;
  v_pay := case when v_paid >= v.total then 'paid' when v_paid > 0 then 'partially_paid' else 'unpaid' end;
  perform set_config('galary.trusted', 'on', true);
  update public.bills set status = v_new where id = p_bill and status is distinct from v_new;
  update public.transactions set payment_status = v_pay where bill_id = p_bill;
  perform set_config('galary.trusted', 'off', true);
end $$;

-- ---------------------------------------------------------------------
-- Workflow
-- ---------------------------------------------------------------------
create or replace function public.load_bill_for_update(p_bill uuid)
returns public.bills language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  select * into v from public.bills where id = p_bill for update;
  if not found or v.company_id is distinct from public.auth_company_id() or not public.can_access_boat(v.boat_id) then
    raise exception 'bill not found';
  end if;
  return v;
end $$;

create or replace function public.submit_bill(p_bill uuid, p_duplicate_reason text default null)
returns public.bill_status language plpgsql security definer set search_path = public as $$
declare v public.bills; v_settings jsonb; v_dups int; v_missing text[] := '{}'; v_status public.bill_status;
begin
  perform public.require_perm('bills.manage');
  v := public.load_bill_for_update(p_bill);
  if v.status <> 'draft' then raise exception 'Only draft bills can be submitted'; end if;
  select settings into v_settings from public.companies where id = v.company_id;

  if v.total <= 0 then v_missing := v_missing || 'total'; end if;
  if v.invoice_no is null or trim(v.invoice_no) = '' then v_missing := v_missing || 'invoice_no'; end if;
  if coalesce((v_settings->>'bill_document_required')::boolean, true) and not exists (
      select 1 from public.documents d where d.entity_type = 'bill' and d.entity_id = v.id and d.is_current) then
    v_missing := v_missing || 'original_document';
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'Bill is incomplete. Missing: %', array_to_string(v_missing, ', ');
  end if;
  if v.ocr_data is not null and not v.ocr_confirmed then
    raise exception 'Review and confirm the OCR-extracted values before submitting';
  end if;

  select count(*) into v_dups from public.find_bill_duplicates(v.supplier_id, v.invoice_no, v.bill_date, v.total, v.id);
  if v_dups > 0 then
    if coalesce(trim(p_duplicate_reason), '') = '' then
      raise exception 'possible_duplicate: % similar bill(s) found for this supplier', v_dups using errcode = 'P0001';
    end if;
    perform public.require_perm('duplicates.override');
  end if;

  perform set_config('galary.trusted', 'on', true);
  update public.bills set
    status = 'pending_approval', submitted_at = now(), return_comment = null,
    duplicate_override_reason = case when v_dups > 0 then p_duplicate_reason end,
    duplicate_override_by = case when v_dups > 0 then auth.uid() end
  where id = p_bill;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'bill', p_bill, 'submitted',
          case when v_dups > 0 then 'Duplicate warning overridden: ' || p_duplicate_reason end);

  v_status := 'pending_approval';
  if not coalesce((v_settings->>'bill_approval_required')::boolean, true) and public.has_perm('bills.approve') then
    perform public.approve_bill(p_bill, 'Auto-approved (approval not required)');
    v_status := 'approved';
  end if;
  return v_status;
end $$;

create or replace function public.approve_bill(p_bill uuid, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  perform public.require_perm('bills.approve');
  v := public.load_bill_for_update(p_bill);
  if v.status <> 'pending_approval' then raise exception 'Bill is not awaiting approval'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.bills set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_bill;
  -- Expense recognition: exactly one ledger row per bill (unique bill_id)
  insert into public.transactions(company_id, kind, date, category_id, amount, boat_id, trip_id, supplier_id,
      description, payment_status, source, bill_id, status, created_by, approved_by, approved_at, reference)
  values (v.company_id, 'expense', v.bill_date, v.category_id, v.total, v.boat_id, v.trip_id, v.supplier_id,
      coalesce(v.description, 'Bill ' || v.bill_code), 'unpaid', 'bill', v.id, 'approved', v.created_by,
      auth.uid(), now(), v.invoice_no);
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'bill', p_bill, 'approved', p_comment);
end $$;

create or replace function public.return_bill(p_bill uuid, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  perform public.require_perm('bills.approve');
  v := public.load_bill_for_update(p_bill);
  if v.status <> 'pending_approval' then raise exception 'Bill is not awaiting approval'; end if;
  if coalesce(trim(p_comment),'') = '' then raise exception 'Explain what needs correcting'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.bills set status = 'draft', return_comment = p_comment where id = p_bill;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'bill', p_bill, 'returned', p_comment);
end $$;

create or replace function public.reject_bill(p_bill uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  perform public.require_perm('bills.approve');
  v := public.load_bill_for_update(p_bill);
  if v.status <> 'pending_approval' then raise exception 'Bill is not awaiting approval'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A rejection reason is required'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.bills set status = 'rejected', rejection_reason = p_reason where id = p_bill;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'bill', p_bill, 'rejected', p_reason);
end $$;

create or replace function public.void_bill(p_bill uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.bills;
begin
  perform public.require_perm('bills.approve');
  v := public.load_bill_for_update(p_bill);
  if v.status = 'voided' then raise exception 'Bill is already voided'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required to void a bill'; end if;
  if exists (select 1 from public.bill_payments where bill_id = p_bill and status = 'valid') then
    raise exception 'Void the payments recorded against this bill first';
  end if;
  perform set_config('galary.trusted', 'on', true);
  update public.bills set status = 'voided', void_reason = p_reason where id = p_bill;
  update public.transactions set status = 'voided', void_reason = 'Bill voided: ' || p_reason where bill_id = p_bill;
  perform set_config('galary.trusted', 'off', true);
  perform public.log_approval(v.company_id, 'bill', p_bill, 'voided', p_reason);
end $$;

create or replace function public.record_bill_payment(
  p_bill uuid, p_date date, p_amount numeric, p_method text, p_reference text default null,
  p_receipt_document uuid default null, p_request uuid default null,
  p_overpayment_reason text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.bills; v_out numeric; v_applied numeric; v_over numeric; v_id uuid;
begin
  perform public.require_perm('bills.pay');
  if p_request is not null then
    select id into v_id from public.bill_payments where request_id = p_request;
    if found then return v_id; end if;           -- same submission retried: no duplicate
  end if;
  v := public.load_bill_for_update(p_bill);
  if v.status not in ('approved','partially_paid') then
    raise exception 'Payments can only be recorded against approved, unpaid bills (status: %)', v.status;
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if p_date is null or p_date > current_date then raise exception 'Payment date cannot be in the future'; end if;
  if p_method <> 'cash' and coalesce(trim(p_reference),'') = '' then
    raise exception 'A reference number is required for non-cash payments';
  end if;
  v_out := v.total - public.bill_paid(p_bill);
  v_applied := least(p_amount, v_out);
  v_over := p_amount - v_applied;
  if v_over > 0 then
    if coalesce(trim(p_overpayment_reason),'') = '' then
      raise exception 'overpayment: payment exceeds the outstanding balance of %', v_out using errcode = 'P0001';
    end if;
    perform public.require_perm('overpayment.approve');
  end if;
  perform set_config('galary.trusted', 'on', true);
  insert into public.bill_payments(company_id, payment_code, bill_id, supplier_id, date, amount, applied_amount,
      overpaid_amount, overpayment_reason, method, reference, receipt_document_id, notes, request_id, approved_by)
  values (v.company_id, public.next_code(v.company_id, 'PAY'), p_bill, v.supplier_id, p_date, p_amount, v_applied,
      v_over, case when v_over > 0 then p_overpayment_reason end, p_method, nullif(trim(p_reference),''),
      p_receipt_document, p_notes, p_request, case when v_over > 0 then auth.uid() end)
  returning id into v_id;
  perform set_config('galary.trusted', 'off', true);
  perform public.refresh_bill_payment_status(p_bill);
  return v_id;
end $$;

create or replace function public.void_bill_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  perform public.require_perm('bills.approve');
  select * into v from public.bill_payments where id = p_payment for update;
  if not found or v.company_id <> public.auth_company_id() then raise exception 'payment not found'; end if;
  perform public.load_bill_for_update(v.bill_id);
  if v.status = 'voided' then raise exception 'Payment already voided'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'A reason is required'; end if;
  perform set_config('galary.trusted', 'on', true);
  update public.bill_payments set status = 'voided', void_reason = p_reason where id = p_payment;
  perform set_config('galary.trusted', 'off', true);
  perform public.refresh_bill_payment_status(v.bill_id);
  perform public.log_approval(v.company_id, 'bill_payment', p_payment, 'voided', p_reason);
end $$;

-- ---------------------------------------------------------------------
-- Defaults / tenant guard / audit
-- ---------------------------------------------------------------------
create trigger bills_defaults before insert on public.bills
  for each row execute function public.fill_defaults('BIL', 'bill_code');
create trigger bills_tenant before update on public.bills
  for each row execute function public.guard_company_change();
create trigger bills_touch before update on public.bills
  for each row execute function public.touch_updated_at();
create trigger bills_audit after insert or update or delete on public.bills
  for each row execute function public.audit_trigger();
create trigger bill_payments_tenant before update on public.bill_payments
  for each row execute function public.guard_company_change();
create trigger bill_payments_audit after insert or update or delete on public.bill_payments
  for each row execute function public.audit_trigger();
