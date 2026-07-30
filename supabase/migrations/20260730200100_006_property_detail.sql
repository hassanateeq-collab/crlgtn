-- ============================================================================
-- Corlington · migration 006 · OTA-grade property detail (M1.5)
--
-- Prompted by owner review: a listing needs to stand next to Booking.com /
-- Agoda — property profile, imagery, room detail — not just name + rate.
-- The launch checklist (spec §12) always required photography per hotel;
-- this migration finally gives those photos, and the words around them,
-- a home in the schema.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Vendor profile: the property page above the fold.
-- ----------------------------------------------------------------------------
alter table public.vendors
  add column description       text,
  -- Finer grain than vendor_type: a 'hotel' vendor may present as guesthouse,
  -- boutique, business hotel, serviced apartment…
  add column property_subtype  text,
  add column address           text,
  add column phone             text,
  add column checkin_time      time,
  add column checkout_time     time,
  -- Hotel-set, seasonal wording (spec §2). Free text by design: the platform
  -- standardizes *presentation*, and M5 snapshots these onto each booking.
  add column cancellation_policy text,
  add column noshow_policy       text;

-- ----------------------------------------------------------------------------
-- Room detail: what a booker actually compares.
-- ----------------------------------------------------------------------------
alter table public.listings
  add column description  text,
  add column bed_config   text,      -- '1 king', '2 twin + sofa bed'
  add column size_sqm     smallint check (size_sqm is null or size_sqm > 0);

-- ----------------------------------------------------------------------------
-- media — photos for the property (listing_id NULL) or a specific room type.
-- Files live in the private `media` bucket; rows carry order and cover flag.
-- ----------------------------------------------------------------------------
create table public.media (
  id            uuid primary key default gen_random_uuid(),
  vendor_id     uuid not null references public.vendors (id) on delete cascade,
  listing_id    uuid references public.listings (id) on delete cascade,
  storage_path  text not null unique,
  caption       text,
  sort          smallint not null default 0,
  is_cover      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index media_vendor_idx on public.media (vendor_id, sort);
create index media_listing_idx on public.media (listing_id, sort)
  where listing_id is not null;
-- One cover per property; partial unique keeps it honest.
create unique index media_vendor_cover_uniq on public.media (vendor_id)
  where is_cover and listing_id is null;

create trigger media_touch before update on public.media
  for each row execute function app.touch_updated_at();

alter table public.media enable row level security;

-- Ops see everything; corporates see imagery of live vendors only — the same
-- visibility contour as the rest of the catalog.
create policy media_select_scoped
  on public.media for select to authenticated
  using (
    app.is_ops()
    or (
      app.current_corporate_id() is not null
      and exists (
        select 1 from public.vendors v
        where v.id = vendor_id and v.status = 'live'
      )
    )
  );

-- ----------------------------------------------------------------------------
-- Storage: private media bucket. All signed-in users may read (signed URLs);
-- only ops write. Closed-access platform → no public bucket, no public URLs.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

create policy media_bucket_read_authenticated
  on storage.objects for select to authenticated
  using (bucket_id = 'media');

create policy media_bucket_ops_write
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and app.is_ops());

create policy media_bucket_ops_update
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and app.is_ops())
  with check (bucket_id = 'media' and app.is_ops());

create policy media_bucket_ops_delete
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and app.is_ops());
