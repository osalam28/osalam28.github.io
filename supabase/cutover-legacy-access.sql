-- Run at the coordinated launch, after ownership mappings and backups are verified.
-- This stops the old profile picker from reading or writing encrypted rows.
-- New accounts use the owner-bound RPC for one-time migration; no rows are deleted.
begin;
revoke all on public.peptide_calendar_sync from public, anon, authenticated;
commit;
