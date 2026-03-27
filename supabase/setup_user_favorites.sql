-- ASguIDE - favoris synchronises par utilisateur
-- A executer dans l'editeur SQL Supabase.

create table if not exists public.user_favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  resource_id bigint not null references public.resources (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, resource_id)
);

alter table public.user_favorites enable row level security;

drop policy if exists "user_favorites_select_own" on public.user_favorites;
create policy "user_favorites_select_own"
on public.user_favorites
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_favorites_insert_own" on public.user_favorites;
create policy "user_favorites_insert_own"
on public.user_favorites
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_favorites_delete_own" on public.user_favorites;
create policy "user_favorites_delete_own"
on public.user_favorites
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists user_favorites_resource_idx
  on public.user_favorites (resource_id);
