-- ASguIDE - ordre personnel des categories / sous-categories synchronise par utilisateur
-- A executer dans l'editeur SQL Supabase.

create table if not exists public.user_category_orders (
  user_id uuid not null references public.profiles (id) on delete cascade,
  scope_key text not null,
  category_type text not null,
  parent_id uuid null references public.categories (id) on delete cascade,
  ordered_category_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, scope_key)
);

alter table public.user_category_orders enable row level security;

drop policy if exists "user_category_orders_select_own" on public.user_category_orders;
create policy "user_category_orders_select_own"
on public.user_category_orders
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_category_orders_insert_own" on public.user_category_orders;
create policy "user_category_orders_insert_own"
on public.user_category_orders
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_category_orders_update_own" on public.user_category_orders;
create policy "user_category_orders_update_own"
on public.user_category_orders
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "user_category_orders_delete_own" on public.user_category_orders;
create policy "user_category_orders_delete_own"
on public.user_category_orders
for delete
to authenticated
using (auth.uid() = user_id);

create index if not exists user_category_orders_user_idx
  on public.user_category_orders (user_id);
