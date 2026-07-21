-- ============================================================================
--  Migration: client-experience pack.
--  1. due_date on reviews (optional "review by" date set at creation)
--  2. rpc_delete_comment — clients can delete their own comments
--  3. rpc_get_review exposes due_date
--  General feedback needs no schema change: it reuses the comments table with
--  the reserved section_key '__general__'.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Due date ------------------------------------------------------------------
alter table public.reviews add column if not exists due_date date;

-- 2. Delete own comment (client-facing, token-validated) ------------------------
--    Only client-authored comments whose author_name matches the requester's
--    saved name can be deleted, and never once the review is accepted.
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

-- 3. rpc_get_review with due_date ----------------------------------------------
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
        select id, section_key, name, blurb, sort_order, status
        from public.review_sections where review_id = v.id) s), '[]'::json),
    'comments', coalesce((
      select json_agg(c order by c.created_at) from (
        select id, section_key, author_name, author_role, body, resolved, created_at
        from public.comments where review_id = v.id) c), '[]'::json)
  ) into result;
  return result;
end; $$;

-- 4. Exposure --------------------------------------------------------------------
revoke all on function public.rpc_delete_comment(text,uuid,text) from public;
revoke all on function public.rpc_get_review(text)               from public;
grant execute on function public.rpc_delete_comment(text,uuid,text) to anon, authenticated;
grant execute on function public.rpc_get_review(text)               to anon, authenticated;

notify pgrst, 'reload schema';
