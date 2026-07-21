-- ============================================================================
--  Migration: client completion decision.
--  When the client finishes a review they now choose one of two outcomes:
--    'approved'            -> happy with the content (comments are notes)
--    'revision_requested'  -> wants a new version incorporating their changes
--  The decision is stored on the review and cleared if the review reopens.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Decision column ----------------------------------------------------------
alter table public.reviews add column if not exists client_decision text;
-- null until the client completes · 'approved' | 'revision_requested'

-- 2. Complete with a decision (client-facing) ---------------------------------
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

-- 3. Reopening clears the decision --------------------------------------------
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

-- 4. Expose the decision through rpc_get_review -------------------------------
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
      'accepted_at', v.accepted_at, 'client_decision', v.client_decision),
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

-- 5. Exposure ------------------------------------------------------------------
revoke all on function public.rpc_complete_review(text,text)   from public;
revoke all on function public.rpc_set_review_status(text,text) from public;
revoke all on function public.rpc_get_review(text)             from public;
grant execute on function public.rpc_complete_review(text,text)   to anon, authenticated;
grant execute on function public.rpc_set_review_status(text,text) to anon, authenticated;
grant execute on function public.rpc_get_review(text)             to anon, authenticated;

-- 6. Refresh PostgREST's schema cache.
notify pgrst, 'reload schema';
