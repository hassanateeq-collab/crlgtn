-- ============================================================================
-- Corlington · migration 010 · RFQ engine (M4)
-- rfq_offers · notifications · SLA flag · pg_cron for the sweeps
--
-- Vendors never hold Supabase accounts in MVP: each offer carries its own
-- hashed, expiring token, and ef_vendor_respond authenticates by token alone.
-- The raw token exists only inside the magic link; the database stores sha-256.
-- ============================================================================

create table public.rfq_offers (
  id                uuid primary key default gen_random_uuid(),
  booking_file_id   uuid not null references public.booking_files (id) on delete cascade,
  vendor_id         uuid not null references public.vendors (id) on delete restrict,
  listing_id        uuid not null references public.listings (id) on delete restrict,
  package_code      text not null references public.packages (code),
  -- Server-resolved at send time (negotiated-over-base); never client-supplied.
  rate_pkr          bigint not null check (rate_pkr > 0),
  priority          smallint not null check (priority between 1 and 3),
  status            public.offer_status not null default 'sent',
  sent_at           timestamptz not null default now(),
  viewed_at         timestamptz,
  responded_at      timestamptz,
  response_channel  text,
  -- {listing_id?, note?} — a counter is not a hold (spec §2).
  counter           jsonb,
  ops_override      boolean not null default false,
  -- {wa_msg_id, email_msg_id, agent} — required by ef_ops_override_accept (M5).
  ops_evidence      jsonb,
  -- Magic-link auth. Token expires with the decision window.
  token_hash        text not null unique,
  token_expires_at  timestamptz not null,
  -- Set once by the SLA sweep so ops is pinged exactly once per quiet offer.
  sla_flagged_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One offer per hotel per file; the ≤3 cap is enforced in ef_send_rfq.
  unique (booking_file_id, vendor_id),
  unique (booking_file_id, priority)
);

create index rfq_offers_file_idx on public.rfq_offers (booking_file_id, priority);
-- The SLA sweep's exact scan: quiet, unflagged, still-open offers.
create index rfq_offers_sla_idx on public.rfq_offers (sent_at)
  where status in ('sent', 'viewed') and sla_flagged_at is null;

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  event           text not null,
  recipient_type  text not null,   -- vendor_user | corporate_user | ops | traveler
  recipient_id    uuid,
  channel         text not null,   -- email | whatsapp | sms | portal | slack
  template        text not null,
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'queued',  -- queued | sent | failed | skipped
  sent_at         timestamptz,
  provider_id     text,
  -- Idempotency: one row per (event, entity, channel, recipient) intent.
  dedupe_key      text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index notifications_status_idx on public.notifications (status, created_at);
create index notifications_recipient_idx on public.notifications (recipient_type, recipient_id);

create trigger rfq_offers_touch before update on public.rfq_offers
  for each row execute function app.touch_updated_at();
create trigger notifications_touch before update on public.notifications
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS. Corporates see their own file's offers — but never the token hash or
-- ops evidence; columns are hidden by revoking column-level SELECT (cheaper
-- than a view and enforced in the same place as everything else).
-- ----------------------------------------------------------------------------
alter table public.rfq_offers    enable row level security;
alter table public.notifications enable row level security;

create policy rfq_offers_select_own_or_ops
  on public.rfq_offers for select to authenticated
  using (
    app.is_ops()
    or exists (
      select 1 from public.booking_files bf
      where bf.id = booking_file_id
        and bf.corporate_id = app.current_corporate_id()
    )
  );

-- Token hashes are secrets even in hashed form; evidence is ops-internal.
revoke select (token_hash, ops_evidence) on public.rfq_offers from authenticated;

-- Notifications are operational plumbing: ops only. The magic-link payloads
-- live here, which is exactly why corporates must not read them.
create policy notifications_select_ops
  on public.notifications for select to authenticated
  using (app.is_ops());

-- ----------------------------------------------------------------------------
-- SLA sweep — in-database rather than an HTTP-invoked Edge Function, so the
-- cron carries no service key and cannot miss for network reasons. DEVIATION
-- from spec §7's ef_sla_monitor naming; behaviour is identical and logged in
-- BUILD_LOG. Runs every minute; flags offers quiet for 10+ minutes, once.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

create or replace function app.sla_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  flagged integer := 0;
  r record;
begin
  for r in
    select o.id, o.booking_file_id, o.vendor_id, o.sent_at, bf.ref
    from public.rfq_offers o
    join public.booking_files bf on bf.id = o.booking_file_id
    where o.status in ('sent', 'viewed')
      and o.sla_flagged_at is null
      and o.sent_at <= now() - interval '10 minutes'
      and bf.window_expires_at > now()
    for update of o skip locked
  loop
    update public.rfq_offers set sla_flagged_at = now() where id = r.id;

    insert into public.notifications
      (event, recipient_type, channel, template, payload, dedupe_key)
    values
      ('offer_unanswered_10m', 'ops', 'portal', 'ops_sla_alert',
       jsonb_build_object(
         'offer_id', r.id, 'booking_file_id', r.booking_file_id,
         'vendor_id', r.vendor_id, 'ref', r.ref, 'sent_at', r.sent_at),
       'sla:' || r.id::text);

    insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
    values ('system', null, 'sla_sweep', 'rfq_offers', r.id,
            jsonb_build_object('after', jsonb_build_object('sla_flagged', true)));

    flagged := flagged + 1;
  end loop;
  return flagged;
end;
$$;

revoke execute on function app.sla_sweep() from public, anon, authenticated;

select cron.schedule('corlington_sla_sweep', '* * * * *', $$select app.sla_sweep()$$);
