-- =====================================================================
-- Galary — 0008 Only approved email addresses may create a company.
-- Everyone else joins an existing company by invitation from its owner.
-- =====================================================================

create table public.platform_owners (
  email      text primary key check (email = lower(trim(email))),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.platform_owners enable row level security;   -- no policies: not readable by app users
revoke all on public.platform_owners from anon, authenticated;

insert into public.platform_owners(email, note)
values ('unooshahmed@gmail.com', 'Company owner')
on conflict do nothing;

create or replace function public.can_create_company()
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.platform_owners)
      or exists (select 1 from public.platform_owners po
                 join auth.users u on lower(u.email) = po.email
                 where u.id = auth.uid())
$$;
revoke execute on function public.can_create_company() from anon;

create or replace function public.bootstrap_company(
  p_company_name text, p_full_name text, p_language public.app_language default 'en')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This user already belongs to a company';
  end if;
  if not public.can_create_company() then
    raise exception 'not_invited: this email cannot create a company. Ask the company owner for an invitation.'
      using errcode = '42501';
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
revoke execute on function public.bootstrap_company(text, text, public.app_language) from anon;
