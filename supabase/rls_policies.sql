-- ASguIDE - policies recommandees pour verrouiller l'acces au contenu.
-- A executer dans l'editeur SQL Supabase.

-- ------------------------------------------------------------
-- Fonctions utilitaires
-- ------------------------------------------------------------

create or replace function public.is_approved_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved = true
      and status = 'approved'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and approved = true
      and role = 'admin'
  );
$$;

revoke all on function public.is_approved_user() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- Profiles
-- ------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_insert_own_pending" on public.profiles;
create policy "profiles_insert_own_pending"
on public.profiles
for insert
to authenticated
with check (
  auth.uid() = id
  and approved = false
  and status in ('pending', 'rejected')
  and role = 'user'
);

drop policy if exists "profiles_update_own_safe" on public.profiles;
create policy "profiles_update_own_safe"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (
  auth.uid() = id
  and approved = false
  and status in ('pending', 'rejected')
  and role = 'user'
);

drop policy if exists "profiles_admin_manage" on public.profiles;
create policy "profiles_admin_manage"
on public.profiles
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ------------------------------------------------------------
-- Contenu protege
-- Lecture: profils approuves
-- Ecriture: admins approuves
-- ------------------------------------------------------------

alter table public.categories enable row level security;
alter table public.resources enable row level security;
alter table public.cards enable row level security;
alter table public.directory_entries enable row level security;

drop policy if exists "categories_select_approved" on public.categories;
create policy "categories_select_approved"
on public.categories
for select
to authenticated
using (public.is_approved_user());

drop policy if exists "categories_admin_manage" on public.categories;
create policy "categories_admin_manage"
on public.categories
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "resources_select_approved" on public.resources;
create policy "resources_select_approved"
on public.resources
for select
to authenticated
using (public.is_approved_user());

drop policy if exists "resources_admin_manage" on public.resources;
create policy "resources_admin_manage"
on public.resources
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "cards_select_approved" on public.cards;
create policy "cards_select_approved"
on public.cards
for select
to authenticated
using (public.is_approved_user());

drop policy if exists "cards_admin_manage" on public.cards;
create policy "cards_admin_manage"
on public.cards
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "directory_entries_select_approved" on public.directory_entries;
create policy "directory_entries_select_approved"
on public.directory_entries
for select
to authenticated
using (public.is_approved_user());

drop policy if exists "directory_entries_admin_manage" on public.directory_entries;
create policy "directory_entries_admin_manage"
on public.directory_entries
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ------------------------------------------------------------
-- Storage bucket "documents"
-- Lecture: profils approuves
-- Upload / suppression: admins approuves
-- ------------------------------------------------------------

drop policy if exists "documents_select_approved" on storage.objects;
create policy "documents_select_approved"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'documents'
  and public.is_approved_user()
);

drop policy if exists "documents_insert_admin" on storage.objects;
create policy "documents_insert_admin"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'documents'
  and public.is_admin()
);

drop policy if exists "documents_update_admin" on storage.objects;
create policy "documents_update_admin"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'documents'
  and public.is_admin()
)
with check (
  bucket_id = 'documents'
  and public.is_admin()
);

drop policy if exists "documents_delete_admin" on storage.objects;
create policy "documents_delete_admin"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'documents'
  and public.is_admin()
);
