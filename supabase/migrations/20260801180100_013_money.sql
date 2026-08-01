-- ============================================================================
-- Corlington · migration 013 · Money (M7)
-- invoices · payments · deposits · settlements · invoice-at-booking ·
-- finance sweep · settlement run
--
-- All money is integer PKR (bigint). Corlington is merchant of record
-- (spec §2): it invoices corporates and settles vendors at gross − commission.
-- Tax stays a jsonb placeholder until the tax advisor signs off (§13.2).
-- ============================================================================

create sequence app.invoice_number_seq start with 1001;

create table public.invoices (
  id            uuid primary key default gen_random_uuid(),
  corporate_id  uuid not null references public.corporates (id) on delete restrict,
  -- NULL booking_id is reserved for fees / consolidated statements (Phase 2).
  booking_id    uuid references public.bookings (id) on delete restrict,
  number        text not null unique,
  amount_pkr    bigint not null check (amount_pkr >= 0),
  tax           jsonb not null default '{}'::jsonb,
  due_date      date not null,
  status        public.invoice_status not null default 'sent',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index invoices_booking_uniq on public.invoices (booking_id)
  where booking_id is not null;
create index invoices_corp_status_idx on public.invoices (corporate_id, status, due_date);

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  corporate_id  uuid not null references public.corporates (id) on delete restrict,
  invoice_id    uuid not null references public.invoices (id) on delete restrict,
  amount_pkr    bigint not null check (amount_pkr > 0),
  method        text not null check (method in ('bank_transfer', 'deposit_drawdown')),
  reference     text,
  received_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index payments_invoice_idx on public.payments (invoice_id);

create table public.deposits (
  id            uuid primary key default gen_random_uuid(),
  corporate_id  uuid not null unique references public.corporates (id) on delete restrict,
  -- Lifetime deposited vs what remains drawable.
  amount_pkr    bigint not null default 0 check (amount_pkr >= 0),
  balance_pkr   bigint not null default 0 check (balance_pkr >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.settlements (
  id              uuid primary key default gen_random_uuid(),
  vendor_id       uuid not null references public.vendors (id) on delete restrict,
  period          text not null check (period ~ '^\d{4}-\d{2}$'),
  gross_pkr       bigint not null default 0,
  commission_pkr  bigint not null default 0,
  adjustments     jsonb not null default '[]'::jsonb,
  net_pkr         bigint not null default 0,
  status          text not null default 'draft'
    check (status in ('draft', 'approved', 'paid')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (vendor_id, period)
);

create trigger invoices_touch before update on public.invoices
  for each row execute function app.touch_updated_at();
create trigger payments_touch before update on public.payments
  for each row execute function app.touch_updated_at();
create trigger deposits_touch before update on public.deposits
  for each row execute function app.touch_updated_at();
create trigger settlements_touch before update on public.settlements
  for each row execute function app.touch_updated_at();

alter table public.invoices    enable row level security;
alter table public.payments    enable row level security;
alter table public.deposits    enable row level security;
alter table public.settlements enable row level security;

-- Corporate finance sees its own money; ops sees all. Settlements are the
-- vendor-side ledger — ops only (vendors get theirs via the ops desk in MVP).
create policy invoices_select_own_or_ops
  on public.invoices for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());
create policy payments_select_own_or_ops
  on public.payments for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());
create policy deposits_select_own_or_ops
  on public.deposits for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());
create policy settlements_select_ops
  on public.settlements for select to authenticated
  using (app.is_ops());

-- ----------------------------------------------------------------------------
-- Invoice generation. Idempotent per booking (unique index); due date honors
-- the corporate's credit terms dated FROM CHECKOUT; a standing deposit with
-- sufficient balance auto-draws down and settles the invoice on the spot.
-- ----------------------------------------------------------------------------
create or replace function public.generate_invoice_for_booking(
  p_booking_id uuid,
  p_actor_type public.actor_type default 'system',
  p_actor_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b   public.bookings%rowtype;
  bf  public.booking_files%rowtype;
  c   public.corporates%rowtype;
  dep public.deposits%rowtype;
  v_due date;
  v_number text;
  v_invoice_id uuid;
  v_paid boolean := false;
begin
  select * into b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  -- Idempotency: one invoice per booking, first writer wins.
  select id into v_invoice_id from public.invoices where booking_id = p_booking_id;
  if found then
    return (select jsonb_build_object(
      'invoice_id', i.id, 'number', i.number, 'amount_pkr', i.amount_pkr,
      'due_date', i.due_date, 'status', i.status, 'existing', true)
      from public.invoices i where i.id = v_invoice_id);
  end if;

  select * into bf from public.booking_files where id = b.booking_file_id;
  select * into c from public.corporates where id = bf.corporate_id for update;

  v_due := case c.credit_terms
    when 'on_checkout' then bf.check_out
    when 'd7'  then bf.check_out + 7
    when 'd15' then bf.check_out + 15
    when 'd30' then bf.check_out + 30
  end;

  v_number := 'CI-' || nextval('app.invoice_number_seq')::text;

  insert into public.invoices (corporate_id, booking_id, number, amount_pkr, due_date, status)
  values (c.id, b.id, v_number, b.grand_total_pkr, v_due, 'sent')
  returning id into v_invoice_id;

  -- Standing deposit: draw down when the balance covers the whole invoice.
  select * into dep from public.deposits where corporate_id = c.id for update;
  if found and dep.balance_pkr >= b.grand_total_pkr and b.grand_total_pkr > 0 then
    update public.deposits
       set balance_pkr = balance_pkr - b.grand_total_pkr
     where id = dep.id;
    insert into public.payments (corporate_id, invoice_id, amount_pkr, method, reference)
    values (c.id, v_invoice_id, b.grand_total_pkr, 'deposit_drawdown',
            'auto drawdown against ' || v_number);
    update public.invoices set status = 'paid' where id = v_invoice_id;
    v_paid := true;
  end if;

  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
  values (p_actor_type, p_actor_id, 'generate_invoice', 'invoices', v_invoice_id,
          jsonb_build_object('after', jsonb_build_object(
            'number', v_number, 'amount_pkr', b.grand_total_pkr,
            'due_date', v_due, 'terms', c.credit_terms, 'deposit_drawdown', v_paid)));

  insert into public.notifications
    (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
  select 'invoice_issued', 'corporate_user', cu.id, 'portal', 'finance_invoice_issued',
         jsonb_build_object('invoice_id', v_invoice_id, 'number', v_number,
                            'amount_pkr', b.grand_total_pkr, 'due_date', v_due,
                            'paid_by_deposit', v_paid),
         'inv_issued:' || v_invoice_id
    from public.corporate_users cu
   where cu.corporate_id = c.id and cu.role in ('corp_finance', 'corp_admin')
   limit 1;

  return jsonb_build_object(
    'invoice_id', v_invoice_id, 'number', v_number,
    'amount_pkr', b.grand_total_pkr, 'due_date', v_due,
    'status', case when v_paid then 'paid' else 'sent' end, 'existing', false);
end;
$$;

revoke execute on function public.generate_invoice_for_booking(uuid, public.actor_type, uuid) from public;
revoke execute on function public.generate_invoice_for_booking(uuid, public.actor_type, uuid) from anon, authenticated;
grant execute on function public.generate_invoice_for_booking(uuid, public.actor_type, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- book_offer now invoices in the same transaction as the booking.
-- (Full body reproduced; only the generate_invoice call is new.)
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
  select * into o from public.rfq_offers where id = p_offer_id for update;
  if not found then
    raise exception 'offer_not_found' using errcode = 'P0002';
  end if;

  select * into bf from public.booking_files where id = o.booking_file_id for update;

  if bf.status not in ('requested', 'responded') then
    raise exception 'file_not_bookable:%', bf.status using errcode = 'P0003';
  end if;
  if o.status not in ('hold', 'countered') then
    raise exception 'offer_not_bookable:%', o.status using errcode = 'P0003';
  end if;
  if bf.window_expires_at is null or bf.window_expires_at < now() then
    raise exception 'window_expired' using errcode = 'P0003';
  end if;

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

  -- M7: the invoice is born with the booking, same transaction, same terms.
  perform public.generate_invoice_for_booking(new_booking_id, p_actor_type, p_actor_id);

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

-- ----------------------------------------------------------------------------
-- Daily finance sweep: due-in-3-days reminder (once) and sent → overdue.
-- 03:00 UTC = 08:00 PKT, before the finance day starts.
-- ----------------------------------------------------------------------------
create or replace function app.finance_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  flipped integer := 0;
  r record;
begin
  for r in
    select i.id, i.number, i.due_date, i.corporate_id from public.invoices i
     where i.status = 'sent' and i.due_date = current_date + 3
  loop
    insert into public.notifications
      (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
    select 'invoice_due_soon', 'corporate_user', cu.id, 'portal', 'finance_due_soon',
           jsonb_build_object('invoice_id', r.id, 'number', r.number, 'due_date', r.due_date),
           'inv_due3:' || r.id
      from public.corporate_users cu
     where cu.corporate_id = r.corporate_id and cu.role in ('corp_finance', 'corp_admin')
     limit 1
    on conflict (dedupe_key) do nothing;
  end loop;

  for r in
    select i.id, i.number, i.due_date, i.corporate_id from public.invoices i
     where i.status = 'sent' and i.due_date < current_date
    for update skip locked
  loop
    update public.invoices set status = 'overdue' where id = r.id;
    insert into public.notifications
      (event, recipient_type, recipient_id, channel, template, payload, dedupe_key)
    select 'invoice_overdue', 'corporate_user', cu.id, 'portal', 'finance_overdue',
           jsonb_build_object('invoice_id', r.id, 'number', r.number, 'due_date', r.due_date),
           'inv_overdue:' || r.id
      from public.corporate_users cu
     where cu.corporate_id = r.corporate_id and cu.role in ('corp_finance', 'corp_admin')
     limit 1
    on conflict (dedupe_key) do nothing;
    insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
    values ('system', null, 'finance_sweep', 'invoices', r.id,
            jsonb_build_object('after', jsonb_build_object('status', 'overdue')));
    flipped := flipped + 1;
  end loop;

  return flipped;
end;
$$;

revoke execute on function app.finance_sweep() from public, anon, authenticated;
select cron.schedule('corlington_finance_sweep', '0 3 * * *', $$select app.finance_sweep()$$);

-- ----------------------------------------------------------------------------
-- Settlement run: per vendor, stays CHECKED OUT within the period.
-- gross = sum of grand totals · commission = round(gross × pct) · net = rest.
-- Re-running a draft period recomputes it; approved/paid rows are immutable.
-- ----------------------------------------------------------------------------
create or replace function public.run_settlement(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  results jsonb := '[]'::jsonb;
begin
  if p_period !~ '^\d{4}-\d{2}$' then
    raise exception 'bad_period' using errcode = 'P0005';
  end if;

  for r in
    select v.id as vendor_id, v.name, coalesce(v.commission_pct, 0) as pct,
           sum(b.grand_total_pkr)::bigint as gross
      from public.bookings b
      join public.booking_files bf on bf.id = b.booking_file_id
      join public.vendors v on v.id = b.vendor_id
     where b.status in ('confirmed', 'checked_in', 'checked_out')
       and to_char(bf.check_out, 'YYYY-MM') = p_period
     group by v.id, v.name, v.commission_pct
  loop
    insert into public.settlements (vendor_id, period, gross_pkr, commission_pkr, net_pkr)
    values (
      r.vendor_id, p_period, r.gross,
      round(r.gross * r.pct / 100.0)::bigint,
      r.gross - round(r.gross * r.pct / 100.0)::bigint
    )
    on conflict (vendor_id, period) do update
      set gross_pkr = excluded.gross_pkr,
          commission_pkr = excluded.commission_pkr,
          net_pkr = excluded.net_pkr
      where public.settlements.status = 'draft';

    results := results || jsonb_build_object(
      'vendor', r.name, 'gross_pkr', r.gross,
      'commission_pkr', round(r.gross * r.pct / 100.0)::bigint,
      'net_pkr', r.gross - round(r.gross * r.pct / 100.0)::bigint);
  end loop;

  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, diff)
  values ('system', null, 'run_settlement', 'settlements', null,
          jsonb_build_object('after', jsonb_build_object('period', p_period, 'rows', results)));

  return results;
end;
$$;

revoke execute on function public.run_settlement(text) from public;
revoke execute on function public.run_settlement(text) from anon, authenticated;
grant execute on function public.run_settlement(text) to service_role;

-- 1st of each month, 04:00 UTC: settle the month that just ended.
select cron.schedule('corlington_settlement_run', '0 4 1 * *',
  $$select public.run_settlement(to_char(now() - interval '1 month', 'YYYY-MM'))$$);
