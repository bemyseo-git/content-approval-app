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
