-- =====================================================================
-- Galary — 0007 Private document storage
-- Bucket "documents" is private. Object paths: <company_id>/<entity>/<uuid>-<file>
-- A file can be downloaded only if the person can see its row in
-- public.documents (which applies boat + permission checks).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520, array[
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel', 'text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Upload: only into the person's own company folder, with an upload permission.
create policy documents_bucket_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_company_id()::text
    and (public.has_perm('documents.manage') or public.has_perm('bills.manage') or public.has_perm('bills.pay')
         or public.has_perm('crew.manage') or public.has_perm('boats.manage') or public.has_perm('expenses.manage')
         or public.has_perm('income.manage') or public.has_perm('sales.manage') or public.has_perm('advances.manage')
         or public.has_perm('crew_payments.manage') or public.has_perm('fish_taken.manage')
         or public.has_perm('adjustments.manage'))
  );

-- Read / signed URLs: only when the matching document row is visible under RLS.
-- The uploader may also read their own file before its documents row exists.
create or replace function public.document_registered(p_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.documents where storage_path = p_path)
$$;

create policy documents_bucket_select on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.auth_company_id()::text
    and (exists (select 1 from public.documents d where d.storage_path = storage.objects.name)
         or (owner_id = auth.uid()::text and not public.document_registered(storage.objects.name)))
  );

-- No update/delete policies: stored files are immutable; replacements are new versions.
