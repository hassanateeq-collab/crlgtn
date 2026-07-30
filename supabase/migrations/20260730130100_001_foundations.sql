-- ============================================================================
-- Corlington · migration 001 · Foundations
-- Enums (spec §5), the private `app` helper schema, and shared trigger functions.
--
-- Standing rules enforced from this migration onward (spec §4, dev plan §0):
--   · RLS is enabled on every table before it holds data.
--   · No table gets an INSERT/UPDATE/DELETE policy. Ever. All writes arrive
--     through Edge Functions using the service-role key, which bypasses RLS.
--     This makes "no client-side writes" a database guarantee, not a convention.
--   · Money is integer PKR (bigint). No floats, anywhere.
--   · Timestamps are timestamptz stored UTC; the UI renders Asia/Karachi.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Private helper schema
-- ----------------------------------------------------------------------------
-- Kept out of `public` so PostgREST never exposes these. RLS policies call them;
-- clients cannot. See config.toml [api].schemas.
create schema if not exists app;

comment on schema app is
  'Internal helpers for RLS policies and triggers. Deliberately not exposed via PostgREST.';

grant usage on schema app to authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- Supply / vertical enums — all five verticals exist from day one so the schema
-- reserves their space. Only `hotel` is activated in the UI until Phase 3.
-- ----------------------------------------------------------------------------
create type public.vendor_type as enum
  ('hotel', 'rent_a_car', 'property', 'tour', 'restaurant');

create type public.vendor_status as enum
  ('prospect', 'onboarding', 'live', 'suspended');

create type public.listing_type as enum
  ('room_type', 'vehicle', 'unit', 'tour_product', 'table_block');

create type public.price_bracket as enum ('b1', 'b2', 'b3', 'b4', 'b5');

-- ----------------------------------------------------------------------------
-- Corporate / credit enums
-- ----------------------------------------------------------------------------
-- DEVIATION FROM SPEC §5: `corporates.status` is named in the table definition
-- but no enum is given. Mirrors vendor_status. Recorded in BUILD_LOG.
create type public.corporate_status as enum
  ('prospect', 'onboarding', 'live', 'suspended');

create type public.credit_terms as enum ('on_checkout', 'd7', 'd15', 'd30');

create type public.security_type as enum ('none', 'deposit', 'bank_guarantee');

-- ----------------------------------------------------------------------------
-- Role enums (spec §3)
-- ----------------------------------------------------------------------------
create type public.corporate_role as enum
  ('corp_admin', 'corp_booker', 'corp_approver', 'corp_finance');

create type public.ops_role as enum ('ops_agent', 'ops_admin');

-- ----------------------------------------------------------------------------
-- Booking enums (spec §5, state machines in §6)
-- ----------------------------------------------------------------------------
create type public.file_status as enum
  ('draft', 'requested', 'responded', 'confirmed', 'completed', 'cancelled', 'expired');

create type public.offer_status as enum
  ('sent', 'viewed', 'hold', 'countered', 'declined', 'expired', 'released', 'booked');

create type public.booking_status as enum
  ('confirmed', 'checked_in', 'checked_out', 'no_show', 'cancelled');

-- ----------------------------------------------------------------------------
-- Money enums
-- ----------------------------------------------------------------------------
create type public.invoice_status as enum
  ('draft', 'sent', 'paid', 'overdue', 'disputed');

-- ----------------------------------------------------------------------------
-- Platform enums
-- ----------------------------------------------------------------------------
-- Who performed an audited action. `system` covers cron sweeps (ef_expire_sweep,
-- ef_sla_monitor) which act with no human actor.
create type public.actor_type as enum
  ('corporate_user', 'vendor_user', 'ops_user', 'system');

-- ----------------------------------------------------------------------------
-- Shared trigger functions
-- ----------------------------------------------------------------------------

-- Keeps updated_at honest regardless of what the caller sends.
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function app.touch_updated_at is
  'BEFORE UPDATE trigger: stamps updated_at = now(), ignoring any client-supplied value.';

-- Append-only enforcement. Triggers fire for every role, including service_role,
-- so this holds even against an Edge Function with the service key — which is
-- exactly the point for audit_log.
create or replace function app.deny_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Table %.% is append-only; % is not permitted',
    tg_table_schema, tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function app.deny_mutation is
  'BEFORE UPDATE OR DELETE trigger: unconditionally raises. Enforces append-only tables.';
