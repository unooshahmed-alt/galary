-- =====================================================================
-- Galary — 0006 Row-level security, function privileges
-- Every policy checks: same company + module permission + boat access.
-- Financial records have no DELETE policy: they are voided, not deleted.
-- =====================================================================

-- Enable RLS everywhere
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
-- Note: RLS is not FORCEd. Workflow functions are SECURITY DEFINER (owned by
-- postgres) and perform their own permission, tenant and boat checks.

-- ---------------------------------------------------------------------
-- Tenancy & users
-- ---------------------------------------------------------------------
create policy companies_select on public.companies for select to authenticated
  using (id = public.auth_company_id());
create policy companies_update on public.companies for update to authenticated
  using (id = public.auth_company_id() and public.has_perm('settings.manage'))
  with check (id = public.auth_company_id());

create policy profiles_select on public.profiles for select to authenticated
  using (company_id = public.auth_company_id() or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (company_id = public.auth_company_id() and (id = auth.uid() or public.has_perm('users.manage')))
  with check (company_id = public.auth_company_id());

create policy permissions_select on public.permissions for select to authenticated using (true);

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (company_id = public.auth_company_id());
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('users.manage') and role <> 'owner');
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('users.manage') and role <> 'owner');

create policy user_boats_select on public.user_boats for select to authenticated
  using (company_id = public.auth_company_id());
create policy user_boats_insert on public.user_boats for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('users.manage'));
create policy user_boats_delete on public.user_boats for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('users.manage'));

create policy audit_select on public.audit_logs for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('audit.view'));
create policy approvals_select on public.approvals for select to authenticated
  using (company_id = public.auth_company_id());

create policy notification_settings_select on public.notification_settings for select to authenticated
  using (company_id = public.auth_company_id());
create policy notification_settings_write on public.notification_settings for all to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('settings.manage'))
  with check (company_id = public.auth_company_id() and public.has_perm('settings.manage'));

-- ---------------------------------------------------------------------
-- Boat-scoped tables: generated policies
--   (table, view permission, manage permission, boat expression)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('boats',             'boats.view',       'boats.manage',      'id'),
    ('boat_assignments',  'crew.view',        'crew.manage',       'boat_id'),
    ('trips',             'trips.view',       'trips.manage',      'boat_id'),
    ('attendance',        'attendance.view',  'attendance.manage', 'boat_id'),
    ('catch_records',     'sales.view',       'sales.manage',      'boat_id'),
    ('fish_sales',        'sales.view',       'sales.manage',      'boat_id'),
    ('bills',             'bills.view',       'bills.manage',      'boat_id'),
    ('wage_rules',        'wage_rules.view',  'wage_rules.manage', 'boat_id'),
    ('payroll_periods',   'payroll.view',     'payroll.prepare',   'boat_id'),
    ('cash_advances',     'advances.view',    'advances.manage',   'boat_id'),
    ('fish_taken',        'fish_taken.view',  'fish_taken.manage', 'boat_id'),
    ('payroll_adjustments','adjustments.view','adjustments.manage','boat_id'),
    ('wage_slips',        'payroll.view',     null,                'boat_id'),
    ('crew_payments',     'crew_payments.view', null,              'boat_id')
  ) as t(tbl, pview, pmanage, boatcol)
  loop
    execute format($f$create policy %I on public.%I for select to authenticated
      using (company_id = public.auth_company_id() and public.has_perm(%L) and public.can_access_boat(%I))$f$,
      r.tbl || '_select', r.tbl, r.pview, r.boatcol);
    if r.pmanage is not null then
      execute format($f$create policy %I on public.%I for insert to authenticated
        with check (company_id = public.auth_company_id() and public.has_perm(%L) and %s)$f$,
        r.tbl || '_insert', r.tbl, r.pmanage,
        case when r.tbl = 'boats' then 'true' else format('public.can_access_boat(%I)', r.boatcol) end);
      execute format($f$create policy %I on public.%I for update to authenticated
        using (company_id = public.auth_company_id() and public.has_perm(%L) and public.can_access_boat(%I))
        with check (company_id = public.auth_company_id() and public.can_access_boat(%I))$f$,
        r.tbl || '_update', r.tbl, r.pmanage, r.boatcol, r.boatcol);
    end if;
  end loop;
end $$;

-- Crew can also be seen by payroll / payments staff
create policy wage_slips_select_payments on public.wage_slips for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('crew_payments.view') and public.can_access_boat(boat_id));

-- Catch records may be corrected/removed by sales managers while the trip is open
create policy catch_records_delete on public.catch_records for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('sales.manage') and public.can_access_boat(boat_id)
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'closed'));

-- Draft bills that were never submitted can be discarded
create policy bills_delete_draft on public.bills for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('bills.manage') and public.can_access_boat(boat_id)
         and status = 'draft' and submitted_at is null);

-- Draft payrolls can be discarded
create policy payroll_delete_draft on public.payroll_periods for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('payroll.prepare') and public.can_access_boat(boat_id)
         and status in ('draft','calculated'));

-- Crew members
create policy crew_select on public.crew_members for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('crew.view') and public.crew_accessible(id));
create policy crew_select_payroll on public.crew_members for select to authenticated
  using (company_id = public.auth_company_id()
         and (public.has_perm('payroll.view') or public.has_perm('attendance.view')) and public.crew_accessible(id));
create policy crew_insert on public.crew_members for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('crew.manage'));
create policy crew_update on public.crew_members for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('crew.manage') and public.crew_accessible(id))
  with check (company_id = public.auth_company_id());

-- Trip crew (via the trip's boat)
create policy trip_crew_select on public.trip_crew for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('trips.view')
         and exists (select 1 from public.trips t where t.id = trip_id and public.can_access_boat(t.boat_id)));
create policy trip_crew_insert on public.trip_crew for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('trips.manage')
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'closed' and public.can_access_boat(t.boat_id)));
create policy trip_crew_update on public.trip_crew for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('trips.manage')
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'closed' and public.can_access_boat(t.boat_id)));
create policy trip_crew_delete on public.trip_crew for delete to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('trips.manage')
         and exists (select 1 from public.trips t where t.id = trip_id and t.status <> 'closed' and public.can_access_boat(t.boat_id))
         and not exists (select 1 from public.payroll_periods p where p.trip_id = trip_crew.trip_id and p.status <> 'reversed'));

-- Reference data
create policy fish_types_select on public.fish_types for select to authenticated
  using (company_id = public.auth_company_id());
create policy fish_types_write on public.fish_types for insert to authenticated
  with check (company_id = public.auth_company_id() and (public.has_perm('settings.manage') or public.has_perm('sales.manage')));
create policy fish_types_update on public.fish_types for update to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('settings.manage') or public.has_perm('sales.manage')));

create policy categories_select on public.categories for select to authenticated
  using (company_id = public.auth_company_id());
create policy categories_insert on public.categories for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('settings.manage'));
create policy categories_update on public.categories for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('settings.manage') and not is_system);

create policy suppliers_select on public.suppliers for select to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('suppliers.view') or public.has_perm('bills.view') or public.has_perm('expenses.view')));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (company_id = public.auth_company_id() and (public.has_perm('suppliers.manage') or public.has_perm('bills.manage')));
create policy suppliers_update on public.suppliers for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('suppliers.manage'));

create policy customers_select on public.customers for select to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('suppliers.view') or public.has_perm('sales.view') or public.has_perm('income.view')));
create policy customers_insert on public.customers for insert to authenticated
  with check (company_id = public.auth_company_id() and (public.has_perm('suppliers.manage') or public.has_perm('sales.manage')));
create policy customers_update on public.customers for update to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('suppliers.manage') or public.has_perm('sales.manage')));

-- Customer receipts / bill payments: read-only (written by functions)
create policy customer_receipts_select on public.customer_receipts for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('sales.view')
         and exists (select 1 from public.fish_sales s where s.id = sale_id and public.can_access_boat(s.boat_id)));
create policy bill_payments_select on public.bill_payments for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('bills.view')
         and exists (select 1 from public.bills b where b.id = bill_id and public.can_access_boat(b.boat_id)));

-- Transactions: permission depends on kind
create policy transactions_select on public.transactions for select to authenticated
  using (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and public.has_perm(case kind when 'income' then 'income.view' else 'expenses.view' end));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and public.has_perm(case kind when 'income' then 'income.manage' else 'expenses.manage' end));
create policy transactions_update on public.transactions for update to authenticated
  using (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and public.has_perm(case kind when 'income' then 'income.manage' else 'expenses.manage' end))
  with check (company_id = public.auth_company_id() and public.can_access_boat(boat_id));

-- Wage rules versions / payroll children (via parent boat)
create policy wage_rule_versions_select on public.wage_rule_versions for select to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('wage_rules.view') or public.has_perm('payroll.view'))
         and exists (select 1 from public.wage_rules r where r.id = rule_id and public.can_access_boat(r.boat_id)));
create policy wage_rule_versions_insert on public.wage_rule_versions for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('wage_rules.manage')
         and exists (select 1 from public.wage_rules r where r.id = rule_id and public.can_access_boat(r.boat_id)));
create policy wage_rule_versions_update on public.wage_rule_versions for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('wage_rules.manage')
         and exists (select 1 from public.wage_rules r where r.id = rule_id and public.can_access_boat(r.boat_id)));
create policy wage_rules_select_payroll on public.wage_rules for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('payroll.view') and public.can_access_boat(boat_id));

create policy wage_calculations_select on public.wage_calculations for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('payroll.view')
         and exists (select 1 from public.payroll_periods p where p.id = payroll_id and public.can_access_boat(p.boat_id)));

create policy crew_bonuses_select on public.crew_bonuses for select to authenticated
  using (company_id = public.auth_company_id() and (public.has_perm('bonuses.view') or public.has_perm('payroll.view'))
         and exists (select 1 from public.payroll_periods p where p.id = payroll_id and public.can_access_boat(p.boat_id)));
create policy crew_bonuses_insert on public.crew_bonuses for insert to authenticated
  with check (company_id = public.auth_company_id() and public.has_perm('bonuses.manage')
         and exists (select 1 from public.payroll_periods p where p.id = payroll_id and public.can_access_boat(p.boat_id)));
create policy crew_bonuses_update on public.crew_bonuses for update to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('bonuses.manage')
         and exists (select 1 from public.payroll_periods p where p.id = payroll_id and public.can_access_boat(p.boat_id)));

create policy advance_recoveries_select on public.advance_recoveries for select to authenticated
  using (company_id = public.auth_company_id() and public.has_perm('advances.view')
         and exists (select 1 from public.cash_advances a where a.id = advance_id and public.can_access_boat(a.boat_id)));

-- Documents (metadata). File bytes are protected by storage policies that
-- require a visible documents row (see 0007).
create policy documents_select on public.documents for select to authenticated
  using (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and (public.has_perm('documents.view')
              or (doc_kind = 'photo' and (public.has_perm('crew.view') or public.has_perm('boats.view')))));
create policy documents_insert on public.documents for insert to authenticated
  with check (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and (public.has_perm('documents.manage') or public.has_perm('bills.manage') or public.has_perm('bills.pay')
              or public.has_perm('crew.manage') or public.has_perm('boats.manage') or public.has_perm('expenses.manage')
              or public.has_perm('income.manage') or public.has_perm('sales.manage') or public.has_perm('advances.manage')
              or public.has_perm('crew_payments.manage') or public.has_perm('fish_taken.manage')
              or public.has_perm('adjustments.manage')));
create policy documents_update on public.documents for update to authenticated
  using (company_id = public.auth_company_id() and public.can_access_boat(boat_id)
         and (public.has_perm('documents.manage') or uploaded_by = auth.uid()));

-- ---------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE to anon/authenticated by
-- default, so internal helpers are explicitly revoked.
-- ---------------------------------------------------------------------
revoke execute on function public.apply_payroll_calculation(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.payroll_inputs_internal(uuid) from public, anon, authenticated;
revoke execute on function public.build_slip_data(public.wage_calculations) from public, anon, authenticated;
revoke execute on function public.log_approval(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.next_code(uuid, text) from public, anon, authenticated;
revoke execute on function public.refresh_bill_payment_status(uuid) from public, anon, authenticated;
revoke execute on function public.seed_company_defaults(uuid) from public, anon, authenticated;
grant execute on function public.apply_payroll_calculation(uuid, text, jsonb, uuid) to service_role;
grant execute on function public.payroll_inputs_internal(uuid) to service_role;

-- Nothing is available to anonymous visitors
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' loop
    execute format('revoke execute on function %s from anon', f.sig);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
