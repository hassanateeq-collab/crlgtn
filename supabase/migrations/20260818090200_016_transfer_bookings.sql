-- Corlington · migration 016 · Transfer bookings (part 2)
-- Standalone airport pick-up/drop-off: fixed route price, instant book, no
-- RFQ window. booking_id links a transfer attached to a hotel stay (add-on
-- mode, UI later); NULL = standalone. Also seeds one fictional fleet operator
-- with vehicles (RFQ path) and two fixed routes (instant path).

create table public.transfer_bookings (
  id            uuid primary key default gen_random_uuid(),
  ref           text not null unique,
  corporate_id  uuid not null references public.corporates (id) on delete restrict,
  vendor_id     uuid not null references public.vendors (id) on delete restrict,
  listing_id    uuid not null references public.listings (id) on delete restrict,
  booking_id    uuid references public.bookings (id) on delete set null,
  direction     text not null default 'pickup' check (direction in ('pickup', 'dropoff')),
  travel_at     timestamptz not null,
  flight_no     text,
  passengers    smallint not null default 1 check (passengers between 1 and 12),
  pickup_point  text,
  dropoff_point text,
  price_pkr     bigint not null check (price_pkr > 0),
  status        text not null default 'confirmed'
    check (status in ('confirmed', 'completed', 'cancelled')),
  created_by    uuid references public.corporate_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index transfer_bookings_corp_idx
  on public.transfer_bookings (corporate_id, travel_at desc);
create index transfer_bookings_vendor_idx
  on public.transfer_bookings (vendor_id, travel_at);

create trigger transfer_bookings_touch before update on public.transfer_bookings
  for each row execute function app.touch_updated_at();

alter table public.transfer_bookings enable row level security;

create policy transfer_bookings_select_own_or_ops
  on public.transfer_bookings for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());

alter table public.invoices
  add column transfer_booking_id uuid references public.transfer_bookings (id) on delete restrict;
create unique index invoices_transfer_uniq on public.invoices (transfer_booking_id)
  where transfer_booking_id is not null;

-- Seed (fictional, purged at launch): Karachi Executive Cars (TEST) —
-- rent_a_car vendor; Corolla (V1 8000 / V2 11000 / V3 15000 per day),
-- Hiace 12-seat (V2 20000 / V3 26000); routes Airport↔Clifton 3500 and
-- Airport↔Shahrah-e-Faisal 3000 priced as V2 rows. Exact statements in the
-- applied migration of the same name.
