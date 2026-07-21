-- ============================================================================
--  Migration: archive clients.
--  Mirrors review archiving: archiving replaces delete as the everyday
--  "remove from view" action for clients. Archived clients disappear from
--  the Clients directory and the New-review client picker, but their reviews
--  keep their client link and stay visible wherever they already appear.
--  Restore or permanently delete from the "Archived clients" section.
--  Run once in Supabase -> SQL Editor. Safe to re-run.
-- ============================================================================

alter table public.clients add column if not exists archived_at timestamptz;
-- null = active · timestamp = when the client was archived

notify pgrst, 'reload schema';
