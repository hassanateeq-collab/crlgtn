-- Corlington · migration 015 · Verticals core (rent-a-car + transfers, part 1)
-- Owner decisions 2026-08-18: cars run the SAME RFQ machinery as hotels;
-- transfers are fixed-price instant bookings, standalone AND (later) add-on.
-- Enum additions must commit before first use → tables/seeds live in 016.

alter type public.listing_type add value if not exists 'transfer_route';

alter table public.booking_files
  add column service text not null default 'hotel'
  check (service in ('hotel', 'car'));

-- Vehicle "packages": V1 self-drive · V2 with driver · V3 driver + fuel.
-- Reusing the package dimension keeps listing_rates, rfq_offers, book_offer
-- and invoicing completely unchanged for cars.
alter table public.packages drop constraint packages_code_check;
alter table public.packages
  add constraint packages_code_check check (code ~ '^[PV][1-9]$');

insert into public.packages (code, name, board_basis) values
  ('V1', 'Self-drive',    'per_day'),
  ('V2', 'With driver',   'per_day'),
  ('V3', 'Driver + fuel', 'per_day')
on conflict (code) do update set name = excluded.name, board_basis = excluded.board_basis;

create sequence app.transfer_ref_seq start with 501;

create or replace function public.next_transfer_ref()
returns text language sql security definer set search_path = ''
as $$ select 'TF-' || nextval('app.transfer_ref_seq')::text || '-KHI'; $$;

revoke execute on function public.next_transfer_ref() from public;
revoke execute on function public.next_transfer_ref() from anon, authenticated;
grant execute on function public.next_transfer_ref() to service_role;
