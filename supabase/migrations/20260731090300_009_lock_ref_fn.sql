-- ============================================================================
-- Corlington · migration 009 · Lock next_booking_ref completely
--
-- Postgres grants EXECUTE to PUBLIC on newly created functions by default.
-- Migration 008 revoked from anon/authenticated directly, but both roles still
-- inherited EXECUTE through PUBLIC — the security advisor caught it. This is
-- the same lesson as migration 004 in function form: deny at the broadest
-- grant, then allow the one principal that needs it.
-- ============================================================================

revoke execute on function public.next_booking_ref() from public;
revoke execute on function public.next_booking_ref() from anon, authenticated;
grant execute on function public.next_booking_ref() to service_role;
