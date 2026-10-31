-- ============================================================================
--  BeMySEO Review — database schema
--  Run once: Supabase dashboard -> SQL Editor -> paste this whole file -> Run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
--  Tables
-- ----------------------------------------------------------------------------
create table if not exists public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (created_by, name)
);

create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  content_type text not null default 'landing_page',  -- 'blog' | 'landing_page'
  client_id    uuid references public.clients(id) on delete set null,
  client_name  text,                 -- synced display cache of the client's name
  page_html    text,                 -- the deliverable HTML (or null if using a URL)
  page_url     text,                 -- optional: review a live URL instead
  share_token  text unique not null default encode(gen_random_bytes(16), 'hex'),
  status          text not null default 'in_review',  -- in_review | completed | accepted
  client_decision text,              -- set on completion: 'approved' | 'revision_requested'
  accepted_at     timestamptz,       -- set when the agency accepts the final content
  archived_at     timestamptz,       -- set when the agency archives the review
  due_date        date,              -- optional "please review by" date shown to the client
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_reviews_client on public.reviews(client_id);
-- Backfill for databases created before these columns existed.
alter table public.reviews
  add column if not exists content_type text not null default 'landing_page';
alter table public.reviews
  add column if not exists accepted_at timestamptz;
alter table public.reviews
  add column if not exists client_decision text;
alter table public.reviews
  add column if not exists archived_at timestamptz;
alter table public.reviews
  add column if not exists due_date date;

create table if not exists public.review_sections (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  section_key text not null,         -- must match a <section id="..."> on the page
  name        text not null,
  blurb       text,
  sort_order  int  not null default 0,
  status      text not null default 'pending',   -- pending | approved | changes
  status_by   text,                 -- who set the status (reviewer/agency name)
  status_at   timestamptz,          -- when the status was set
  unique (review_id, section_key)
);
alter table public.review_sections add column if not exists status_by text;
alter table public.review_sections add column if not exists status_at timestamptz;

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
alter table public.clients         enable row level security;
alter table public.reviews         enable row level security;
alter table public.review_sections enable row level security;
alter table public.comments        enable row level security;

drop policy if exists "clients_owner_all" on public.clients;
create policy "clients_owner_all" on public.clients
  for all to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());

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
      'content_type', v.content_type,
      'page_html', v.page_html, 'page_url', v.page_url, 'status', v.status,
      'accepted_at', v.accepted_at, 'client_decision', v.client_decision,
      'due_date', v.due_date),
    'sections', coalesce((
      select json_agg(s order by s.sort_order, s.name) from (
        select id, section_key, name, blurb, sort_order, status, status_by, status_at
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
declare v_review_id uuid; v_status text; v_role text; row public.comments;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  if length(coalesce(p_body, '')) = 0 then raise exception 'empty comment'; end if;
  v_role := case when p_author_role = 'agency' then 'agency' else 'client' end;
  insert into public.comments(review_id, section_key, author_name, author_role, body)
    values (v_review_id, p_section_key, nullif(p_author_name, ''), v_role, p_body)
    returning * into row;
  return json_build_object('id', row.id, 'section_key', row.section_key,
    'author_name', row.author_name, 'author_role', row.author_role,
    'body', row.body, 'resolved', row.resolved, 'created_at', row.created_at);
end; $$;

drop function if exists public.rpc_set_status(text, text, text);
create or replace function public.rpc_set_status(
  p_token text, p_section_key text, p_status text, p_author_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_status text;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  if p_status not in ('pending', 'approved', 'changes') then raise exception 'bad status'; end if;
  update public.review_sections set
      status = p_status,
      status_by = case when p_status = 'pending' then null
                       else nullif(trim(coalesce(p_author_name, '')), '') end,
      status_at = case when p_status = 'pending' then null else now() end
    where review_id = v_review_id and section_key = p_section_key;
end; $$;

-- Clients may delete their own comments (matched by role + saved name) while
-- the review is still open.
create or replace function public.rpc_delete_comment(p_token text, p_comment_id uuid, p_author_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_status text;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  delete from public.comments
    where id = p_comment_id and review_id = v_review_id
      and author_role = 'client'
      and coalesce(author_name, '') = coalesce(p_author_name, '');
end; $$;

create or replace function public.rpc_toggle_resolve(p_token text, p_comment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_status text;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  update public.comments set resolved = not resolved
    where id = p_comment_id and review_id = v_review_id;
end; $$;

-- Rename a client everywhere at once (agency only). Updates the clients row and
-- syncs the denormalized client_name cache on every linked review.
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

-- Let the client mark the whole review complete (or reopen it) regardless of
-- how many sections are still pending.
create or replace function public.rpc_set_review_status(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_status text;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  if p_status not in ('in_review', 'completed') then raise exception 'bad status'; end if;
  update public.reviews set status = p_status,
    client_decision = case when p_status = 'in_review' then null else client_decision end
    where id = v_review_id;
end; $$;

-- Complete the review with an explicit outcome: the client either approves the
-- content as-is (comments become production notes) or asks for a new version.
create or replace function public.rpc_complete_review(p_token text, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid; v_status text;
begin
  select id, status into v_review_id, v_status from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if v_status = 'accepted' then raise exception 'review is finalized'; end if;
  if p_decision not in ('approved', 'revision_requested') then raise exception 'bad decision'; end if;
  update public.reviews set status = 'completed', client_decision = p_decision
    where id = v_review_id;
end; $$;

-- Expose ONLY these functions to the public role.
revoke all on function public.rpc_get_review(text)                         from public;
revoke all on function public.rpc_add_comment(text,text,text,text,text)    from public;
revoke all on function public.rpc_set_status(text,text,text,text)               from public;
revoke all on function public.rpc_toggle_resolve(text,uuid)               from public;
revoke all on function public.rpc_delete_comment(text,uuid,text)          from public;
revoke all on function public.rpc_set_review_status(text,text)            from public;
revoke all on function public.rpc_complete_review(text,text)              from public;
revoke all on function public.rpc_rename_client(uuid,text)                from public, anon;

grant execute on function public.rpc_rename_client(uuid,text)              to authenticated;
grant execute on function public.rpc_get_review(text)                      to anon, authenticated;
grant execute on function public.rpc_add_comment(text,text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_set_status(text,text,text,text)            to anon, authenticated;
grant execute on function public.rpc_toggle_resolve(text,uuid)            to anon, authenticated;
grant execute on function public.rpc_delete_comment(text,uuid,text)       to anon, authenticated;
grant execute on function public.rpc_set_review_status(text,text)         to anon, authenticated;
grant execute on function public.rpc_complete_review(text,text)           to anon, authenticated;

-- Run in Supabase SQL Editor BEFORE deploying the optimized app. Safe to re-run.
begin;

alter table public.reviews add column if not exists feedback_version bigint not null default 1;
alter table public.reviews add column if not exists page_version bigint not null default 1;

create or replace function public.bump_review_version()
returns trigger language plpgsql set search_path = public as $$
begin
  new.feedback_version := old.feedback_version + 1;
  if new.page_html is distinct from old.page_html or new.page_url is distinct from old.page_url then
    new.page_version := old.page_version + 1;
  else
    new.page_version := old.page_version;
  end if;
  return new;
end; $$;

drop trigger if exists review_version on public.reviews;
create trigger review_version before update on public.reviews
for each row execute function public.bump_review_version();

create or replace function public.bump_review_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP <> 'INSERT' then
    update public.reviews set feedback_version = feedback_version + 1 where id = old.review_id;
  end if;
  if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and new.review_id is distinct from old.review_id) then
    update public.reviews set feedback_version = feedback_version + 1 where id = new.review_id;
  end if;
  return null;
end; $$;

drop trigger if exists section_feedback_version on public.review_sections;
create trigger section_feedback_version after insert or update or delete on public.review_sections
for each row execute function public.bump_review_feedback();
drop trigger if exists comment_feedback_version on public.comments;
create trigger comment_feedback_version after insert or update or delete on public.comments
for each row execute function public.bump_review_feedback();

-- STABLE keeps the version and its feedback in the same database snapshot.
-- Versions travel as text so JavaScript never rounds a bigint cursor.
create or replace function public.rpc_sync_review(
  p_token text, p_version text default null,
  p_page_version text default null, p_include_page boolean default true)
returns json language plpgsql stable security definer set search_path = public as $$
declare v record; result jsonb;
begin
  select id, title, client_name, status, content_type, accepted_at, client_decision, due_date, feedback_version, page_version into v
  from public.reviews where share_token = p_token;
  if not found then return null; end if;
  if p_version = v.feedback_version::text and
     (not p_include_page or p_page_version = v.page_version::text) then
    return json_build_object('unchanged', true);
  end if;
  result := jsonb_build_object(
    'version', v.feedback_version::text, 'page_version', v.page_version::text,
    'review', jsonb_build_object('id', v.id, 'title', v.title,
      'client_name', v.client_name, 'status', v.status,
      'content_type', v.content_type, 'accepted_at', v.accepted_at,
      'client_decision', v.client_decision, 'due_date', v.due_date),
    'sections', coalesce((select jsonb_agg(s order by s.sort_order, s.name) from (
      select id, section_key, name, blurb, sort_order, status, status_by, status_at
      from public.review_sections where review_id = v.id) s), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(c order by c.created_at, c.id) from (
      select id, section_key, author_name, author_role, body, resolved, created_at
      from public.comments where review_id = v.id) c), '[]'::jsonb));
  if p_include_page and p_page_version is distinct from v.page_version::text then
    result := jsonb_set(result, '{review}', result->'review' || (
      select jsonb_build_object('page_html', page_html, 'page_url', page_url)
      from public.reviews where id = v.id));
  end if;
  return result::json;
end; $$;

-- Agency exports fetch the deliverable only when the user requests it.
create or replace function public.rpc_get_review_page(p_token text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('page_html', page_html, 'page_url', page_url)
  from public.reviews where share_token = p_token;
$$;

revoke all on function public.bump_review_version() from public;
revoke all on function public.bump_review_feedback() from public;
revoke all on function public.rpc_sync_review(text,text,text,boolean) from public;
revoke all on function public.rpc_get_review_page(text) from public;
grant execute on function public.rpc_sync_review(text,text,text,boolean) to anon, authenticated;
grant execute on function public.rpc_get_review_page(text) to anon, authenticated;

commit;
