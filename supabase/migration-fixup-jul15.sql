-- ============================================================================
--  FIX-UP: repairs two issues from Jul 15.
--  1. A mangled paste created a misnamed function (rpc_set_atus) and dropped
--     the real rpc_set_status -> section approve/changes may be broken.
--  2. The archive migration was never run -> archived_at column missing,
--     so the Archive button errors.
--  This script is idempotent and safe to run regardless of which parts of the
--  earlier scripts actually committed. Run the WHOLE file once.
-- ============================================================================

-- 1. Remove the typo'd function if the mangled run committed ------------------
drop function if exists public.rpc_set_atus(text, text, text, text);

-- 2. Archive support (from migration-archive.sql) ------------------------------
alter table public.reviews add column if not exists archived_at timestamptz;

-- 3. Attribution columns (harmless if already there) ----------------------------
alter table public.review_sections add column if not exists status_by text;
alter table public.review_sections add column if not exists status_at timestamptz;

-- 4. Correct rpc_set_status, 4-arg with attribution -----------------------------
drop function if exists public.rpc_set_status(text, text, text);
drop function if exists public.rpc_set_status(text, text, text, text);
create function public.rpc_set_status(
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

-- 5. rpc_get_review with attribution + due_date ---------------------------------
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

-- 6. Exposure --------------------------------------------------------------------
revoke all on function public.rpc_set_status(text,text,text,text) from public;
revoke all on function public.rpc_get_review(text)                from public;
grant execute on function public.rpc_set_status(text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_get_review(text)                to anon, authenticated;

-- 7. Refresh PostgREST's schema cache so archived_at is visible immediately.
notify pgrst, 'reload schema';
