-- ============================================================================
-- Corlington · migration 008 · booking ref generator
--
-- CF-{seq}-KHI. SECURITY DEFINER because the sequence lives in the unexposed
-- app schema; EXECUTE is revoked from clients so only Edge Functions (service
-- role) can draw a ref. A ref is assigned exactly once at file creation and
-- never reused — gaps from abandoned drafts are fine, collisions are not.
-- ============================================================================

create or replace function public.next_booking_ref()
returns text
language sql
security definer
set search_path = ''
as $$
  select 'CF-' || nextval('app.booking_file_ref_seq')::text || '-KHI';
$$;

revoke execute on function public.next_booking_ref() from anon, authenticated;
