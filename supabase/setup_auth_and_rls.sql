-- ASguIDE - setup complet Auth + Profiles + RLS + Storage
-- A executer dans l'editeur SQL Supabase.

-- ------------------------------------------------------------
-- 1. Structure de public.profiles
-- ------------------------------------------------------------

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists approved boolean default false,
  add column if not exists role text default 'user',
  add column if not exists status text default 'pending';

update public.profiles
set
  approved = coalesce(approved, status = 'approved'),
  role = coalesce(role, 'user'),
  status = coalesce(
    status,
    case
      when coalesce(approved, false) then 'approved'
      else 'pending'
    end
  );

alter table public.profiles
  alter column approved set default false,
  alter column approved set not null,
  alter column role set default 'user',
  alter column role set not null,
  alter column status set default 'pending',
  alter column status set not null;

alter table public.profiles
  drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('user', 'admin'));

alter table public.profiles
  drop constraint if exists profiles_status_check;

alter table public.profiles
  add constraint profiles_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- ------------------------------------------------------------
-- 2. Trigger de creation / synchronisation du profil au signup
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    approved,
    role,
    status
  )
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')), ''),
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'last_name', '')), ''),
    false,
    'user',
    'pending'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute procedure public.handle_new_user();

-- ------------------------------------------------------------
-- 3. Fonctions utilitaires de securite
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

revoke all on function public.handle_new_user() from public;
revoke all on function public.is_approved_user() from public;
revoke all on function public.is_admin() from public;

grant execute on function public.is_approved_user() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------------------
-- 4. RLS sur public.profiles
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
-- 5. RLS sur le contenu protege
-- Lecture: utilisateurs approuves
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
-- 6. Policies storage pour le bucket documents
-- Lecture: utilisateurs approuves
-- Upload / update / delete: admins approuves
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
