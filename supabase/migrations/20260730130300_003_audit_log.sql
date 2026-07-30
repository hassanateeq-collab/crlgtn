-- ============================================================================
-- Corlington · migration 003 · audit_log
--
-- Append-only. Written by every mutating Edge Function (spec §4). Because the
-- functions hold the service-role key and service_role bypasses RLS, policies
-- alone cannot make this immutable — so immutability is a trigger, which fires
-- for every role including service_role.
-- ============================================================================

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_type public.actor_type not null,
  -- auth.uid() for humans, NULL for `system` (cron sweeps). Intentionally not a
  -- foreign key: audit history must survive the deletion of the actor.
  actor_id   uuid,
  -- Verb, matching the Edge Function that wrote it, e.g. 'ef_book_offer'.
  action     text not null,
  -- Table name the action touched, e.g. 'bookings'.
  entity     text not null,
  entity_id  uuid,
  -- Before/after shape: {"before": {...}, "after": {...}} — writer's choice, but
  -- keep it consistent per function.
  diff       jsonb,
  at         timestamptz not null default now(),
  constraint audit_log_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_log_entity_not_blank check (length(btrim(entity)) > 0),
  -- A human actor without an id is an incomplete audit record.
  constraint audit_log_actor_coherent
    check (actor_type = 'system' or actor_id is not null)
);

-- Reconstructing the history of one record is the common query.
create index audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
-- The ops console's recent-activity feed.
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

comment on table public.audit_log is
  'Append-only audit trail. UPDATE and DELETE raise, for every role including service_role.';

-- ----------------------------------------------------------------------------
-- Immutability
-- ----------------------------------------------------------------------------
-- Statement-level: rejects the whole statement, and still fires for an UPDATE or
-- DELETE that happens to match zero rows.
create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each statement execute function app.deny_mutation();

-- Belt and braces alongside the trigger, so the intent is legible in \dp too.
revoke update, delete, truncate on public.audit_log from authenticated, anon, service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.audit_log enable row level security;

-- Spec §4 admits no exceptions "including exports and logs". Reading the audit
-- trail is an ops_admin privilege: ops_agents act, admins review.
create policy audit_log_select_ops_admin
  on public.audit_log for select to authenticated
  using (app.is_ops_admin());
