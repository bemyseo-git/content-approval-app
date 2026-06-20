-- ============================================================================
--  Migration: true client entities.
--  Adds a clients table, links reviews to it, backfills from existing
--  client_name values, and adds a rename helper. Safe to re-run.
--  Run once in Supabase -> SQL Editor.
-- ============================================================================

-- 1. Clients table -----------------------------------------------------------
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (created_by, name)
);

alter table public.clients enable row level security;

drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_all" on public.clients
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

-- 2. Link reviews -> clients (client_name stays as a synced display cache) ----
alter table public.reviews add column if not exists client_id uuid
  references public.clients(id) on delete set null;
create index if not exists idx_reviews_client on public.reviews(client_id);

-- 3. Backfill: one client per distinct (owner, client_name), then link --------
insert into public.clients (name, created_by)
select name, created_by
from (
  select distinct trim(client_name) as name, created_by
  from public.reviews
  where coalesce(trim(client_name), '') <> ''
) s
on conflict (created_by, name) do nothing;

update public.reviews r
set client_id = c.id
from public.clients c
where r.client_id is null
  and coalesce(trim(r.client_name), '') <> ''
  and trim(r.client_name) = c.name
  and r.created_by is not distinct from c.created_by;

-- 4. Rename a client everywhere, atomically (agency only) ---------------------
create or replace function public.rpc_rename_client(p_client_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text := trim(p_name);
begin
  if length(coalesce(v_name, '')) = 0 then raise exception 'empty name'; end if;
  update public.clients set name = v_name
    where id = p_client_id and created_by = auth.uid();
  if not found then raise exception 'client not found'; end if;
  update public.reviews set client_name = v_name
    where client_id = p_client_id and created_by = auth.uid();
end; $$;

revoke all on function public.rpc_rename_client(uuid, text) from public, anon;
grant execute on function public.rpc_rename_client(uuid, text) to authenticated;
