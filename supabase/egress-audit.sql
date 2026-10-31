-- Read-only diagnostics. Run as the project owner in Supabase SQL Editor.
-- Stored HTML size is a payload-risk estimate, not measured/billed egress.
-- Do not return deliverable HTML or bearer share tokens in diagnostic output.

select
  count(*) as review_count,
  pg_size_pretty(coalesce(sum(octet_length(page_html)), 0)::bigint) as total_html,
  pg_size_pretty(coalesce(max(octet_length(page_html)), 0)::bigint) as largest_html,
  count(*) filter (where page_html ~* 'data:(image|video|audio)/') as reviews_with_embedded_media,
  count(*) filter (where page_html ilike '%supabase.co/storage/%') as reviews_with_supabase_storage_links
from public.reviews;

select
  id, title, status,
  octet_length(coalesce(page_html, '')) as html_bytes,
  pg_size_pretty(octet_length(coalesce(page_html, ''))::bigint) as html_size,
  (select count(*) from public.comments c where c.review_id = r.id) as comment_count
from public.reviews r
order by html_bytes desc, id
limit 20;

-- Base64 media inside HTML is transferred again on every new page load.
-- Supabase Storage assets referenced by previews have separate download costs.
-- Check Dashboard > Usage > Egress to identify the service actually responsible.
