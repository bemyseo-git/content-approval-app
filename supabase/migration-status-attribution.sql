-- ============================================================================
--  Migration: section status attribution — "who approved what".
--  Records the reviewer name + timestamp whenever a section is approved or
--  gets a change request (cleared when reset to pending), and exposes both
--  through rpc_get_review. rpc_set_status gains an author-name parameter, so
--  the old 3-arg signature is dropped to avoid overload ambiguity.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Columns --------------------------------------------------------------------
alter table public.review_sections add column if not exists status_by text;
alter table public.review_sections add column if not exists status_at timestamptz;

-- 2. rpc_set_status with attribution ---------------------------------------------
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

-- 3. rpc_get_review exposes attribution -------------------------------------------
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

-- 4. Exposure ----------------------------------------------------------------------
revoke all on function public.rpc_set_status(text,text,text,text) from public;
revoke all on function public.rpc_get_review(text)                from public;
grant execute on function public.rpc_set_status(text,text,text,text) to anon, authenticated;
grant execute on function public.rpc_get_review(text)                to anon, authenticated;

notify pgrst, 'reload schema';
