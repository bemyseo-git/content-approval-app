-- ============================================================================
--  Migration: archive reviews.
--  Archiving replaces delete as the everyday "remove from view" action:
--  archived reviews disappear from the dashboard, clients view, and table,
--  and live in the Archived screen where they can be restored or permanently
--  deleted. Client share links keep working while archived.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.reviews add column if not exists archived_at timestamptz;
-- null = active · timestamp = when the review was archived

notify pgrst, 'reload schema';
