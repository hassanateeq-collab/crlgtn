-- ============================================================================
-- Corlington · migration 007 · Booking files (M2)
-- booking_files · travelers · the CF-{seq}-KHI reference sequence
--
-- A booking file is the corporate's unit of work (spec §5, §9): named, dated,
-- roomed, filtered by deal-breakers, optionally corridor-pinned, resumable as
-- a draft. The RFQ machinery (M4) and the decision window (M5) hang off it —
-- their columns exist now, empty until those milestones fill them.
-- ============================================================================

-- Refs look like CF-2608-KHI. Global sequence; starts where the spec's own
-- example lives so real refs are indistinguishable in format from the docs.
create sequence app.booking_file_ref_seq start with 2601;

create table public.booking_files (
  id                 uuid primary key default gen_random_uuid(),
  ref                text not null unique,
  corporate_id       uuid not null references public.corporates (id) on delete cascade,
  name               text not null,
  status             public.file_status not null default 'draft',
  check_in           date not null,
  check_out          date not null,
  -- [{"guests": 2}, {"guests": 1}] — one entry per room wanted.
  rooms              jsonb not null default '[]'::jsonb,
  -- Amenity codes the stay cannot do without; results filter on these (M3).
  dealbreakers       jsonb not null default '[]'::jsonb,
  corridor_id        uuid references public.corridors (id) on delete set null,
  -- First acceptance books instantly — the urgent path (spec §2).
  auto_accept        boolean not null default false,
  -- Set by ef_send_rfq (M4) from the window rule; the countdown everyone watches.
  window_minutes     integer check (window_minutes is null or window_minutes > 0),
  window_expires_at  timestamptz,
  created_by         uuid references public.corporate_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint booking_files_name_not_blank check (length(btrim(name)) > 0),
  constraint booking_files_dates_coherent check (check_out > check_in),
  constraint booking_files_rooms_shape check (jsonb_typeof(rooms) = 'array'),
  constraint booking_files_dealbreakers_shape check (jsonb_typeof(dealbreakers) = 'array')
);

create index booking_files_corporate_idx
  on public.booking_files (corporate_id, status, updated_at desc);
create index booking_files_window_idx
  on public.booking_files (window_expires_at)
  where window_expires_at is not null;

create table public.travelers (
  id               uuid primary key default gen_random_uuid(),
  booking_file_id  uuid not null references public.booking_files (id) on delete cascade,
  name             text not null,
  email            text,
  phone            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint travelers_name_not_blank check (length(btrim(name)) > 0)
);

create index travelers_file_idx on public.travelers (booking_file_id);

create trigger booking_files_touch before update on public.booking_files
  for each row execute function app.touch_updated_at();
create trigger travelers_touch before update on public.travelers
  for each row execute function app.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS — SELECT-only as everywhere (writes are Edge-Function-only and client
-- write privileges were revoked wholesale in migration 004).
-- The M2 done-gate test lives on these two policies: corporate A must never
-- fetch corporate B's files.
-- ----------------------------------------------------------------------------
alter table public.booking_files enable row level security;
alter table public.travelers     enable row level security;

create policy booking_files_select_own_or_ops
  on public.booking_files for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());

create policy travelers_select_own_or_ops
  on public.travelers for select to authenticated
  using (
    app.is_ops()
    or exists (
      select 1 from public.booking_files bf
      where bf.id = booking_file_id
        and bf.corporate_id = app.current_corporate_id()
    )
  );
