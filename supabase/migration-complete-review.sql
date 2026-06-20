-- ============================================================================
--  Migration: let the client mark a review complete (or reopen it).
--  Run once in Supabase -> SQL Editor. Safe to re-run (create or replace).
-- ============================================================================

create or replace function public.rpc_set_review_status(p_token text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_review_id uuid;
begin
  select id into v_review_id from public.reviews where share_token = p_token;
  if v_review_id is null then raise exception 'invalid token'; end if;
  if p_status not in ('in_review', 'completed') then raise exception 'bad status'; end if;
  update public.reviews set status = p_status where id = v_review_id;
end; $$;

revoke all on function public.rpc_set_review_status(text,text) from public;
grant execute on function public.rpc_set_review_status(text,text) to anon, authenticated;
