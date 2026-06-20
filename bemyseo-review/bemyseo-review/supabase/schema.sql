-- ============================================================================
--  BeMySEO Review — database schema
--  Run once: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
--  Tables
-- ----------------------------------------------------------------------------
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  client_name  text,
  page_html    text,                 -- the deliverable HTML (or null if using a URL)
  page_url     text,                 -- optional: review a live URL instead
  share_token  text unique not null default encode(gen_random_bytes(16), 'hex'),
  status       text not null default 'in_review',
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table if not exists public.review_sections (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  section_key text not null,         -- must match a <section id="..."> on the page
  name        text not null,
  blurb       text,
  sort_order  int  not null default 0,
  status      text not null default 'pending',   -- pending | approved | changes
  unique (review_id, section_key)
);

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  section_key text not null,
  author_name text,
  author_role text not null default 'client',    -- client | agency
  body        text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists idx_sections_review on public.review_sections(review_id);
create index if not exists idx_comments_review on public.comments(review_id);

-- ----------------------------------------------------------------------------
--  Row Level Security
--  Agency (signed in) manages only their own reviews. The public/anon role gets
--  NO direct table access — clients act only through the RPC functions below.
-- ----------------------------------------------------------------------------
alter table public.reviews         enable row level security;
alter table public.review_sections enable row level security;
alter table public.comments        enable row level security;

drop policy if exists "reviews_owner_all" on public.reviews;
create policy "reviews_owner_all" on public.reviews
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

drop policy if exists "sections_owner_all" on public.review_sections;
create policy "sections_owner_all" on public.review_sections
  for all to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.created_by = auth.uid()))
  with check (exists (select 1 from public.reviews r where r.id = review_id and r.created_by = auth.uid()));

drop policy if exists "comments_owner_read" on public.comments;
create policy "comments_owner_read" on public.comments
  for select to authenticated
  using (exists (select 1 from public.reviews r where r.id = review_id and r.created_by = auth.uid()));

-- ----------------------------------------------------------------------------
--  Client-facing RPC (token-based, no login). SECURITY DEFINER = bypasses RLS,
--  but each function validates the share token, so a link only ever exposes its
--  own review.
-- ----------------------------------------------------------------------------
create or replace function public.rpc_get_review(p_token text)
returns json language plpgsql security definer set search_path = public as $$
declare v public.reviews; result json;
begin
  select * into v from public.reviews where share_token = p_token;
  if not found then return null; end if;
  select json_build_object(
    'review', json_build_object(
      'id', v.id, 'title', v.title, 'client_name', v.client_name,
      'page_html', v.page_html, 'page_url', v.page_url, 'status', v.status),
    'sections', coalesce((
      select json_agg(s order by s.sort_order, s.name) from (
        select id, section_key, name, blurb, sort_order, status
        from public.review_sections where review_id = v.id) s), '[]'::json),
    'comments', coalesce((
      select json_agg(c order by c.created_at) from (
        select id, section_key, author_name, author_role, body, resolved, created_at
        from public.comments where review_id = v.id) c), '[]'::json)
  ) into result;
  return result;
end; $$;

create or replace function public.rpc_add_comment(
  p_token text, p_section_key text, p_author_name text, p_author_role text, p_body text)
returns json language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_role text; row public.comments;
begin
  select id into v_review_id from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if length(coalesce(p_body, '')) = 0 then raise exception 'empty comment'; end if;
  v_role := case when p_author_role = 'agency' then 'agency' else 'client' end;
  insert into public.comments(review_id, section_key, author_name, author_role, body)
    values (v_review_id, p_section_key, nullif(p_author_name, ''), v_role, p_body)
    returning * into row;
  return json_build_object('id', row.id, 'section_key', row.section_key,
    'author_name', row.author_name, 'author_role', row.author_role,
    'body', row.body, 'resolved', row.resolved, 'created_at', row.created_at);
end; $$;

create or replace function public.rpc_set_status(p_token text, p_section_key text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid;
begin
  select id into v_review_id from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if p_status not in ('pending', 'approved', 'changes') then raise exception 'bad status'; end if;
  update public.review_sections set status = p_status
    where review_id = v_review_id and section_key = p_section_key;
end; $$;

create or replace function public.rpc_toggle_resolve(p_token text, p_comment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid;
begin
  select id into v_review_id from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  update public.comments set resolved = not resolved
    where id = p_comment_id and review_id = v_review_id;
end; $$;

-- Let the client mark the whole review complete (or reopen it) regardless of
-- how many sections are still pending.
create or replace function public.rpc_set_review_status(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid;
begin
  select id into v_review_id from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if p_status not in ('in_review', 'completed') then raise exception 'bad status'; end if;
  update public.reviews set status = p_status where id = v_review_id;
end; $$;

-- Expose ONLY these functions to the public role.
revoke all on function public.rpc_get_review(text)                         from public;
revoke all on function public.rpc_add_comment(text,text,text,text,text)    from public;
revoke all on function public.rpc_set_status(text,text,text)               from public;
revoke all on function public.rpc_toggle_resolve(text,uuid)               from public;
revoke all on function public.rpc_set_review_status(text,text)            from public;

grant execute on function public.rpc_get_review(text)                      to anon, authenticated;
grant execute on function public.rpc_add_comment(text,text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_set_status(text,text,text)            to anon, authenticated;
grant execute on function public.rpc_toggle_resolve(text,uuid)            to anon, authenticated;
grant execute on function public.rpc_set_review_status(text,text)         to anon, authenticated;
