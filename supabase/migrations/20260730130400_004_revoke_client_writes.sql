-- ============================================================================
-- Corlington · migration 004 · Revoke client write privileges
--
-- WHY THIS EXISTS
-- Migration 002 relied on the absence of INSERT/UPDATE/DELETE policies to stop
-- client writes. That is only half true, and the M0 done-gate caught it:
--
--   · INSERT with no WITH CHECK policy   -> raises 42501. Good.
--   · UPDATE/DELETE with no USING policy -> matches ZERO rows and SUCCEEDS.
--
-- No data was ever exposed — RLS filtered every row, and the probe confirmed
-- nothing mutated — but a silent success is a bad contract, and resting the
-- platform's core rule ("every write goes through an Edge Function", spec §4) on
-- policy absence is fragile: one stray FOR ALL policy would open it back up.
--
-- So the rule becomes a privilege, not a policy. authenticated and anon lose
-- table-level write grants entirely. Attempts now fail loudly with 42501
-- whatever the policies say. service_role is untouched, so Edge Functions keep
-- working exactly as before.
--
-- Verified after applying: INSERT / UPDATE / UPDATE-own-row / DELETE /
-- self-promote-to-ops / self-promote-to-corp_admin / INSERT audit_log all
-- return 42501; SELECT still returns 1 own corporate and 3 live vendors;
-- service_role write+delete still succeeds.
-- ============================================================================

revoke insert, update, delete, truncate
  on all tables in schema public
  from authenticated, anon;

-- Future tables inherit this automatically. Every migration from here on creates
-- read-only-for-clients tables without having to remember to revoke — which is
-- the point, because remembering is what fails at 2am in milestone 7.
alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate on tables
  from authenticated, anon;

-- Sequences: no client-side write path means no client-side nextval either.
revoke usage, update on all sequences in schema public from authenticated, anon;

alter default privileges for role postgres in schema public
  revoke usage, update on sequences from authenticated, anon;
