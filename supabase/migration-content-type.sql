-- ============================================================================
--  Migration: content type for reviews (blog | landing page).
--  Adds a content_type column (defaults existing rows to 'landing_page') and
--  updates rpc_get_review to expose it to the client review page.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Column ------------------------------------------------------------------
alter table public.reviews
  add column if not exists content_type text not null default 'landing_page';
-- Values used by the app: 'blog' | 'landing_page'.

-- 2. Expose content_type through the client-facing RPC -----------------------
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

revoke all on function public.rpc_get_review(text) from public;
grant execute on function public.rpc_get_review(text) to anon, authenticated;

-- 3. Refresh PostgREST's schema cache so the new column is visible immediately.
notify pgrst, 'reload schema';
