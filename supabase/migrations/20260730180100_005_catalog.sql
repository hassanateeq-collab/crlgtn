-- ============================================================================
-- Corlington · migration 005 · Catalog & agreements (M1)
-- listings · packages · listing_rates · amenities · vendor_amenities ·
-- inclusions · addons · allotments · agreements
--
-- Inherits migration 004's default privileges: every table here is born
-- client-read-only. Policies below are SELECT-only, as always.
-- ============================================================================

create type public.party_type as enum ('vendor', 'corporate');

-- ----------------------------------------------------------------------------
-- packages — P1 room only · P2 room + breakfast · P3 half board. P4 reserved
-- (spec allows P1–P4; "extendable"). Code is the natural key the whole spec
-- speaks in, so it is the primary key.
-- ----------------------------------------------------------------------------
create table public.packages (
  code        text primary key check (code ~ '^P[1-9]$'),
  name        text not null,
  board_basis text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- listings — room types now; vehicles, units, tour products, table blocks later.
-- ----------------------------------------------------------------------------
create table public.listings (
  id             uuid primary key default gen_random_uuid(),
  vendor_id      uuid not null references public.vendors (id) on delete cascade,
  listing_type   public.listing_type not null default 'room_type',
  name           text not null,
  max_occupancy  smallint not null default 2 check (max_occupancy between 1 and 20),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint listings_name_not_blank check (length(btrim(name)) > 0),
  unique (vendor_id, name)
);

create index listings_vendor_idx on public.listings (vendor_id) where active;

-- ----------------------------------------------------------------------------
-- listing_rates — the two-layer rate model in one table (spec §2):
-- corporate_id NULL = base catalog · set = that corporate's negotiated deal.
-- Resolution rule (M3 search): prefer the negotiated row, fall back to base.
-- ----------------------------------------------------------------------------
create table public.listing_rates (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings (id) on delete cascade,
  package_code  text not null references public.packages (code),
  corporate_id  uuid references public.corporates (id) on delete cascade,
  rate_pkr      bigint not null check (rate_pkr > 0),
  valid_from    date not null default current_date,
  valid_to      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint listing_rates_window_coherent
    check (valid_to is null or valid_to >= valid_from)
);

-- One open-ended rate per (listing, package, corporate-or-base). Partial unique
-- indexes because NULL corporate_id rows must also be unique among themselves.
create unique index listing_rates_base_uniq
  on public.listing_rates (listing_id, package_code)
  where corporate_id is null and valid_to is null;
create unique index listing_rates_negotiated_uniq
  on public.listing_rates (listing_id, package_code, corporate_id)
  where corporate_id is not null and valid_to is null;
create index listing_rates_listing_idx on public.listing_rates (listing_id);
create index listing_rates_corporate_idx on public.listing_rates (corporate_id)
  where corporate_id is not null;

-- ----------------------------------------------------------------------------
-- amenities — the master list (ops-curated). dealbreaker_eligible marks the
-- ones a booking file may filter on as hard requirements.
-- ----------------------------------------------------------------------------
create table public.amenities (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  label                 text not null,
  vertical              public.vendor_type not null default 'hotel',
  dealbreaker_eligible  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- vendor_amenities — verified claims only count (spec §2: "verified amenities";
-- the onboarding visit verifies the checklist). verified_at NULL = claimed but
-- not yet audited; the M3 search must treat that as absent.
-- ----------------------------------------------------------------------------
create table public.vendor_amenities (
  id           uuid primary key default gen_random_uuid(),
  vendor_id    uuid not null references public.vendors (id) on delete cascade,
  amenity_id   uuid not null references public.amenities (id) on delete cascade,
  verified_at  timestamptz,
  verified_by  uuid references public.ops_users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (vendor_id, amenity_id)
);

create index vendor_amenities_vendor_idx on public.vendor_amenities (vendor_id);

-- ----------------------------------------------------------------------------
-- inclusions — hotel-baked complimentary extras, shown on the listing card.
-- addons — paid extras picked at checkout. Two layers, per spec §2.
-- ----------------------------------------------------------------------------
create table public.inclusions (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  label       text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint inclusions_label_not_blank check (length(btrim(label)) > 0),
  unique (vendor_id, label)
);

create table public.addons (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  label       text not null,
  price_pkr   bigint not null check (price_pkr >= 0),
  unit        text not null default 'per_stay',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint addons_label_not_blank check (length(btrim(label)) > 0),
  unique (vendor_id, label)
);

-- ----------------------------------------------------------------------------
-- allotments — reserved space (spec §5); populated in Phase 2's extranet work.
-- ----------------------------------------------------------------------------
create table public.allotments (
  id          uuid primary key default gen_random_uuid(),
  vendor_id   uuid not null references public.vendors (id) on delete cascade,
  listing_id  uuid not null references public.listings (id) on delete cascade,
  date        date not null,
  blocked     smallint not null default 0 check (blocked >= 0),
  used        smallint not null default 0 check (used >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (listing_id, date)
);

-- ----------------------------------------------------------------------------
-- agreements — the contractual framework on both sides. Files live in the
-- private `agreements` Storage bucket; doc_url stores the object path.
-- ----------------------------------------------------------------------------
create table public.agreements (
  id                  uuid primary key default gen_random_uuid(),
  party_type          public.party_type not null,
  party_id            uuid not null,
  tier                text,
  version             text not null default 'v1',
  doc_url             text,
  signed_digital_at   timestamptz,
  signed_physical_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index agreements_party_idx on public.agreements (party_type, party_id);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
create trigger packages_touch before update on public.packages
  for each row execute function app.touch_updated_at();
create trigger listings_touch before update on public.listings
  for each row execute function app.touch_updated_at();
create trigger listing_rates_touch before update on public.listing_rates
  for each row execute function app.touch_updated_at();
create trigger amenities_touch before update on public.amenities
  for each row execute function app.touch_updated_at();
create trigger vendor_amenities_touch before update on public.vendor_amenities
  for each row execute function app.touch_updated_at();
create trigger inclusions_touch before update on public.inclusions
  for each row execute function app.touch_updated_at();
create trigger addons_touch before update on public.addons
  for each row execute function app.touch_updated_at();
create trigger allotments_touch before update on public.allotments
  for each row execute function app.touch_updated_at();
create trigger agreements_touch before update on public.agreements
  for each row execute function app.touch_updated_at();

-- ============================================================================
-- RLS — SELECT-only, as everywhere. The corporate-facing rules mirror what the
-- M3 results page is allowed to show; anything invisible here can never leak
-- into search.
-- ============================================================================

alter table public.packages          enable row level security;
alter table public.listings          enable row level security;
alter table public.listing_rates     enable row level security;
alter table public.amenities         enable row level security;
alter table public.vendor_amenities  enable row level security;
alter table public.inclusions        enable row level security;
alter table public.addons            enable row level security;
alter table public.allotments        enable row level security;
alter table public.agreements        enable row level security;

-- Reference data: any signed-in user.
create policy packages_select_authenticated
  on public.packages for select to authenticated using (true);
create policy amenities_select_authenticated
  on public.amenities for select to authenticated using (true);

-- A live vendor's catalog is corporate-visible; everything else is ops-only.
create policy listings_select_live_or_ops
  on public.listings for select to authenticated
  using (
    app.is_ops()
    or (
      active
      and app.current_corporate_id() is not null
      and exists (
        select 1 from public.vendors v
        where v.id = vendor_id and v.status = 'live'
      )
    )
  );

-- Rates: ops see all; a corporate sees base rows plus its own negotiated rows —
-- never another corporate's deal. This is the negotiated-rate confidentiality
-- boundary, enforced at the row level.
create policy listing_rates_select_scoped
  on public.listing_rates for select to authenticated
  using (
    app.is_ops()
    or (
      (corporate_id is null or corporate_id = app.current_corporate_id())
      and exists (
        select 1
        from public.listings l
        join public.vendors v on v.id = l.vendor_id
        where l.id = listing_id and l.active and v.status = 'live'
      )
    )
  );

-- Verified amenities only, for live vendors; ops see claims too.
create policy vendor_amenities_select_scoped
  on public.vendor_amenities for select to authenticated
  using (
    app.is_ops()
    or (
      verified_at is not null
      and app.current_corporate_id() is not null
      and exists (
        select 1 from public.vendors v
        where v.id = vendor_id and v.status = 'live'
      )
    )
  );

create policy inclusions_select_scoped
  on public.inclusions for select to authenticated
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

create policy addons_select_scoped
  on public.addons for select to authenticated
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

-- Allotments and agreements are operational internals.
create policy allotments_select_ops
  on public.allotments for select to authenticated using (app.is_ops());
create policy agreements_select_ops
  on public.agreements for select to authenticated using (app.is_ops());

-- ============================================================================
-- Storage: private bucket for signed agreement documents. Ops upload/read;
-- corporates and vendors get nothing (the countersigned copy is shared through
-- ops channels, not self-service, in MVP).
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('agreements', 'agreements', false)
on conflict (id) do nothing;

create policy agreements_bucket_ops_read
  on storage.objects for select to authenticated
  using (bucket_id = 'agreements' and app.is_ops());

create policy agreements_bucket_ops_write
  on storage.objects for insert to authenticated
  with check (bucket_id = 'agreements' and app.is_ops());

create policy agreements_bucket_ops_update
  on storage.objects for update to authenticated
  using (bucket_id = 'agreements' and app.is_ops())
  with check (bucket_id = 'agreements' and app.is_ops());
