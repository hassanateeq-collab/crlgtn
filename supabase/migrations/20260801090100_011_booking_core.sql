-- ============================================================================
-- Corlington · migration 011 · Booking core (M5)
-- bookings · public.book_offer() transaction · app.expire_sweep() · warn flag
--
-- The core transaction lives IN the database, not in Edge Function JS, because
-- the double-book race is won with row locks and locks live here. Everything
-- that must be atomic — re-check, booking insert, sibling release, file
-- transition, audit, notifications — happens inside one function call.
-- ============================================================================

create table public.bookings (
  id                            uuid primary key default gen_random_uuid(),
  booking_file_id               uuid not null references public.booking_files (id) on delete restrict,
  rfq_offer_id                  uuid not null unique references public.rfq_offers (id) on delete restrict,
  vendor_id                     uuid not null references public.vendors (id) on delete restrict,
  status                        public.booking_status not null default 'confirmed',
  nights                        integer not null check (nights > 0),
  room_total_pkr                bigint not null check (room_total_pkr >= 0),
  addons                        jsonb not null default '[]'::jsonb,
  grand_total_pkr               bigint not null check (grand_total_pkr >= 0),
  -- The voucher and any dispute must reflect the policy AS SHOWN AT BOOKING
  -- TIME (spec §5) — hence snapshots, not references.
  cancellation_policy_snapshot  jsonb,
  noshow_policy_snapshot        jsonb,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

-- The invariant "at most one booked offer per file" in index form.
create unique index bookings_one_per_file on public.bookings (booking_file_id);
create index bookings_vendor_idx on public.bookings (vendor_id, created_at desc);

create trigger bookings_touch before update on public.bookings
  for each row execute function app.touch_updated_at();

alter table public.bookings enable row level security;

create policy bookings_select_own_or_ops
  on public.bookings for select to authenticated
  using (
    app.is_ops()
    or exists (
      select 1 from public.booking_files bf
      where bf.id = booking_file_id
        and bf.corporate_id = app.current_corporate_id()
    )
  );

-- "Window expiring (15 min left)" is warned exactly once per file.
alter table public.booking_files add column window_warned_at timestamptz;

-- ----------------------------------------------------------------------------
-- THE transaction. SECURITY DEFINER in public (PostgREST-callable) but locked
-- to service_role only — the same pattern as next_booking_ref. Called by
-- ef_book_offer (corporate click), ef_vendor_respond (auto-accept), and
-- ef_ops_override_accept (override on an auto-accept file).
-- ----------------------------------------------------------------------------
create or replace function public.book_offer(
  p_offer_id   uuid,
  p_actor_type public.actor_type,
  p_actor_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o  public.rfq_offers%rowtype;
  bf public.booking_files%rowtype;
  v  public.vendors%rowtype;
  target_listing uuid;
  book_rate bigint;
  n_nights integer;
  n_rooms integer;
  room_total bigint;
  new_booking_id uuid;
  loser record;
begin
  -- Lock the offer first, then its file. Every concurrent path locks in the
  -- same order, so two simultaneous books serialize instead of deadlocking.
  select * into o from public.rfq_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  select * into bf from public.booking_files where id = o.booking_file_id for update;

  -- Re-check everything AFTER acquiring locks: the second racer sees the
  -- first one's committed writes here and fails cleanly.
  if bf.status not in ('requested', 'responded') then
    raise exception 'file_not_bookable:%', bf.status using errcode = 'P0003';
  end if;
  if o.status not in ('hold', 'countered') then
    raise exception 'offer_not_bookable:%', o.status using errcode = 'P0003';
  end if;
  if bf.window_expires_at is null or bf.window_expires_at < now() then
    raise exception 'window_expired' using errcode = 'P0003';
  end if;

  -- Accepting a counter books the revised listing (spec §6) at that listing's
  -- own contracted rate, negotiated-over-base for this corporate.
  target_listing := o.listing_id;
  book_rate := o.rate_pkr;
  if o.status = 'countered'
     and o.counter is not null
     and (o.counter ->> 'listing_id') is not null then
    target_listing := (o.counter ->> 'listing_id')::uuid;
    select lr.rate_pkr into book_rate
      from public.listing_rates lr
      where lr.listing_id = target_listing
        and lr.package_code = o.package_code
        and lr.valid_to is null
        and (lr.corporate_id = bf.corporate_id or lr.corporate_id is null)
      order by lr.corporate_id nulls last
      limit 1;
    if book_rate is null then
      raise exception 'no_rate_for_counter_listing' using errcode = 'P0004';
    end if;
  end if;

  n_nights := bf.check_out - bf.check_in;
  n_rooms := greatest(coalesce(jsonb_array_length(bf.rooms), 1), 1);
  room_total := book_rate * n_nights * n_rooms;

  select * into v from public.vendors where id = o.vendor_id;

  insert into public.bookings (
    booking_file_id, rfq_offer_id, vendor_id, status,
    nights, room_total_pkr, addons, grand_total_pkr,
    cancellation_policy_snapshot, noshow_policy_snapshot
  ) values (
    bf.id, o.id, o.vendor_id, 'confirmed',
    n_nights, room_total, '[]'::jsonb, room_total,
    jsonb_build_object('text', v.cancellation_policy, 'captured_at', now(), 'vendor_id', v.id),
    jsonb_build_object('text', v.noshow_policy, 'captured_at', now(), 'vendor_id', v.id)
  )
  returning id into new_booking_id;

  update public.rfq_offers
     set status = 'booked', listing_id = target_listing, rate_pkr = book_rate
   where id = o.id;

  -- Booking one offer atomically releases every sibling (spec §6 invariant).
  for loser in
    select id, vendor_id from public.rfq_offers
     where booking_file_id = bf.id and id <> o.id
       and status in ('sent', 'viewed', 'hold', 'countered')
  loop
    update public.rfq_offers set status = 'released' where id = loser.id;
    insert into public.notifications
      (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
    select 'booked_released', 'vendor_user', vu.id, 'whatsapp', 'vendor_released',
           jsonb_build_object('ref', bf.ref, 'offer_id', loser.id),
           'released:' || loser.id
      from public.vendor_users vu where vu.vendor_id = loser.vendor_id limit 1;
  end loop;

  update public.booking_files set status = 'confirmed' where id = bf.id;

  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
  values (p_actor_type, p_actor_id, 'book_offer', 'bookings', new_booking_id,
          jsonb_build_object('after', jsonb_build_object(
            'offer_id', o.id, 'file_id', bf.id, 'ref', bf.ref,
            'listing_id', target_listing, 'rate_pkr', book_rate,
            'nights', n_nights, 'rooms', n_rooms, 'grand_total_pkr', room_total)));

  -- Winner + booker + the M6 voucher queue entry.
  insert into public.notifications
    (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
  select 'booked_winner', 'vendor_user', vu.id, 'whatsapp', 'vendor_booked',
         jsonb_build_object('ref', bf.ref, 'booking_id', new_booking_id),
         'booked_winner:' || o.id
    from public.vendor_users vu where vu.vendor_id = o.vendor_id limit 1;

  insert into public.notifications
    (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
  values
    ('file_booked', 'corporate_user', bf.created_by, 'portal', 'booker_file_booked',
     jsonb_build_object('ref', bf.ref, 'booking_id', new_booking_id),
     'file_booked:' || bf.id),
    ('issue_voucher', 'traveler', null, 'email', 'voucher',
     jsonb_build_object('booking_id', new_booking_id, 'ref', bf.ref),
     'voucher:' || new_booking_id);

  return jsonb_build_object(
    'booking_id', new_booking_id,
    'ref', bf.ref,
    'vendor_name', v.name,
    'listing_id', target_listing,
    'rate_pkr', book_rate,
    'nights', n_nights,
    'rooms', n_rooms,
    'grand_total_pkr', room_total
  );
end;
$$;

revoke execute on function public.book_offer(uuid, public.actor_type, uuid) from public;
revoke execute on function public.book_offer(uuid, public.actor_type, uuid) from anon, authenticated;
grant execute on function public.book_offer(uuid, public.actor_type, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- Expire sweep: the moment a window dies, everything under it lapses — offers
-- expired, holds released-by-expiry, file expired (spec §2 auto-release).
-- Plus the 15-minutes-left warning, once per file. Same in-database pattern
-- as app.sla_sweep, same reasons.
-- ----------------------------------------------------------------------------
create or replace function app.expire_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_files integer := 0;
  f record;
  op record;
begin
  -- Pass 1: warnings at T-15.
  for f in
    select id, ref, created_by from public.booking_files
     where status in ('requested', 'responded')
       and window_warned_at is null
       and window_expires_at between now() and now() + interval '15 minutes'
    for update skip locked
  loop
    update public.booking_files set window_warned_at = now() where id = f.id;
    insert into public.notifications
      (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
    values ('window_expiring', 'corporate_user', f.created_by, 'portal',
            'booker_window_warning', jsonb_build_object('ref', f.ref),
            'window_warn:' || f.id);
  end loop;

  -- Pass 2: lapse dead windows.
  for f in
    select id, ref, created_by from public.booking_files
     where status in ('requested', 'responded')
       and window_expires_at < now()
    for update skip locked
  loop
    for op in
      select id, vendor_id, status from public.rfq_offers
       where booking_file_id = f.id
         and status in ('sent', 'viewed', 'hold', 'countered')
    loop
      update public.rfq_offers set status = 'expired' where id = op.id;
      insert into public.notifications
        (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
      select 'request_lapsed', 'vendor_user', vu.id, 'whatsapp', 'vendor_lapsed',
             jsonb_build_object('ref', f.ref, 'offer_id', op.id, 'was', op.status),
             'lapsed:' || op.id
        from public.vendor_users vu where vu.vendor_id = op.vendor_id limit 1;
    end loop;

    update public.booking_files set status = 'expired' where id = f.id;

    insert into public.notifications
      (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
    values ('window_expired', 'corporate_user', f.created_by, 'portal',
            'booker_window_expired', jsonb_build_object('ref', f.ref),
            'window_dead:' || f.id);

    insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
    values ('system', null, 'expire_sweep', 'booking_files', f.id,
            jsonb_build_object('after', jsonb_build_object('status', 'expired')));

    expired_files := expired_files + 1;
  end loop;

  return expired_files;
end;
$$;

revoke execute on function app.expire_sweep() from public, anon, authenticated;

select cron.schedule('corlington_expire_sweep', '* * * * *', $$select app.expire_sweep()$$);
