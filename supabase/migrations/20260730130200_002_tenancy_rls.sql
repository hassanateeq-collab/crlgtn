-- ============================================================================
-- Corlington · migration 002 · Tenancy tables + RLS
-- corridors · corporates · corporate_users · ops_users · vendors · vendor_users
--
-- Read model (spec §4): corporate rows scoped by corporate_id, vendor rows by
-- vendor_id, ops by JWT role claim. Reads happen client-side under RLS.
-- Write model: no write policies exist. Writes are Edge-Function-only.
--
-- ORDER MATTERS. A `language sql` function body is parsed and validated at
-- CREATE time, so app.current_corporate_id() cannot be declared before
-- corporate_users exists. Tables first, then helpers, then triggers, then RLS.
-- ============================================================================

-- ============================================================================
-- Tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- corridors — demand corridors per city (spec §2). Karachi seeded in seed.sql.
-- ----------------------------------------------------------------------------
create table public.corridors (
  id          uuid primary key default gen_random_uuid(),
  city        text not null,
  name        text not null,
  sort        smallint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (city, name)
);

create index corridors_city_sort_idx on public.corridors (city, sort);

-- ----------------------------------------------------------------------------
-- corporates — the demand side, one row per vetted company.
-- ----------------------------------------------------------------------------
create table public.corporates (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  status               public.corporate_status not null default 'prospect',
  -- Credit profile (spec §2): limit, terms and security set by ops judgment.
  credit_limit_pkr     bigint not null default 0 check (credit_limit_pkr >= 0),
  credit_terms         public.credit_terms not null default 'on_checkout',
  security_type        public.security_type not null default 'none',
  security_amount_pkr  bigint not null default 0 check (security_amount_pkr >= 0),
  -- Corporate fee is published from day one but waived for the first 6-12 months.
  fee_waived_until     date,
  -- "Who books varies by corporate" — routes bookers through corp_approver.
  approval_required    boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint corporates_name_not_blank check (length(btrim(name)) > 0),
  -- A security amount without a security type is a data-entry error.
  constraint corporates_security_coherent
    check (security_type <> 'none' or security_amount_pkr = 0)
);

create index corporates_status_idx on public.corporates (status);

-- ----------------------------------------------------------------------------
-- corporate_users — auth_user_id is nullable because ops creates the person
-- before they ever sign in; it is linked on first successful OTP.
-- ----------------------------------------------------------------------------
create table public.corporate_users (
  id            uuid primary key default gen_random_uuid(),
  corporate_id  uuid not null references public.corporates (id) on delete cascade,
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  role          public.corporate_role not null default 'corp_booker',
  name          text not null,
  email         text not null,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (corporate_id, email)
);

create index corporate_users_corporate_idx on public.corporate_users (corporate_id);
create index corporate_users_auth_idx on public.corporate_users (auth_user_id);

-- ----------------------------------------------------------------------------
-- ops_users — Corlington's own staff.
--
-- DEVIATION FROM SPEC §5: not in the table list. Spec §4 puts ops identity in a
-- JWT claim, which the policies below honour as the authority. But an ops
-- console cannot list its own agents, and audit_log cannot resolve an actor
-- name, from a claim alone. This is a registry; the claim remains the gate.
-- Recorded in BUILD_LOG.
-- ----------------------------------------------------------------------------
create table public.ops_users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  role          public.ops_role not null default 'ops_agent',
  name          text not null,
  email         text not null unique,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- vendors — the supply side. Multi-vertical by design; hotels at launch.
-- ----------------------------------------------------------------------------
create table public.vendors (
  id              uuid primary key default gen_random_uuid(),
  vendor_type     public.vendor_type not null default 'hotel',
  name            text not null,
  status          public.vendor_status not null default 'prospect',
  corridor_id     uuid references public.corridors (id) on delete set null,
  -- Corlington-assigned stars (checklist + judgment), not the vendor's claim.
  stars_assigned  smallint check (stars_assigned between 1 and 5),
  price_bracket   public.price_bracket,
  -- The supply pitch: 8-12% versus the 15-25% OTAs charge.
  commission_pct  numeric(5, 2) check (commission_pct >= 0 and commission_pct <= 100),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint vendors_name_not_blank check (length(btrim(name)) > 0)
);

create index vendors_status_type_idx on public.vendors (status, vendor_type);
create index vendors_corridor_idx on public.vendors (corridor_id);

-- ----------------------------------------------------------------------------
-- vendor_users — hotel-side contacts. In MVP they never hold a Supabase auth
-- account; they authenticate per-offer by hashed magic-link token.
-- ----------------------------------------------------------------------------
create table public.vendor_users (
  id                     uuid primary key default gen_random_uuid(),
  vendor_id              uuid not null references public.vendors (id) on delete cascade,
  name                   text not null,
  whatsapp               text,
  email                  text,
  -- Per spec §5. M4 additionally issues single-use, expiring per-offer tokens on
  -- rfq_offers; this column is the vendor-level fallback.
  magic_link_token_hash  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- A contact we cannot reach is not a contact.
  constraint vendor_users_reachable check (whatsapp is not null or email is not null)
);

create index vendor_users_vendor_idx on public.vendor_users (vendor_id);

-- ============================================================================
-- RLS helper functions
-- ============================================================================

-- Ops identity lives in the JWT, per spec §4 ("ops via role claim"). Set on the
-- auth user as app_metadata.role — app_metadata is not user-writable, unlike
-- user_metadata, so a corporate user cannot self-promote to ops.
create or replace function app.jwt_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '');
$$;

create or replace function app.is_ops()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.jwt_role() in ('ops_agent', 'ops_admin');
$$;

create or replace function app.is_ops_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select app.jwt_role() = 'ops_admin';
$$;

-- SECURITY DEFINER is required, not stylistic: a policy on corporate_users that
-- queried corporate_users through RLS would recurse infinitely. A definer
-- function bypasses RLS and breaks the cycle.
create or replace function app.current_corporate_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cu.corporate_id
  from public.corporate_users cu
  where cu.auth_user_id = auth.uid()
  limit 1;
$$;

comment on function app.current_corporate_id is
  'The caller''s corporate_id, or NULL for ops/vendor/anon. SECURITY DEFINER to avoid RLS recursion.';

create or replace function app.current_corporate_role()
returns public.corporate_role
language sql
stable
security definer
set search_path = ''
as $$
  select cu.role
  from public.corporate_users cu
  where cu.auth_user_id = auth.uid()
  limit 1;
$$;

-- Helpers must not be callable by anonymous clients even though the schema is
-- unexposed — belt and braces.
revoke all on function app.jwt_role() from anon;
revoke all on function app.is_ops() from anon;
revoke all on function app.is_ops_admin() from anon;
revoke all on function app.current_corporate_id() from anon;
revoke all on function app.current_corporate_role() from anon;

-- ============================================================================
-- updated_at triggers
-- ============================================================================
create trigger corridors_touch before update on public.corridors
  for each row execute function app.touch_updated_at();
create trigger corporates_touch before update on public.corporates
  for each row execute function app.touch_updated_at();
create trigger corporate_users_touch before update on public.corporate_users
  for each row execute function app.touch_updated_at();
create trigger ops_users_touch before update on public.ops_users
  for each row execute function app.touch_updated_at();
create trigger vendors_touch before update on public.vendors
  for each row execute function app.touch_updated_at();
create trigger vendor_users_touch before update on public.vendor_users
  for each row execute function app.touch_updated_at();

-- ============================================================================
-- Row Level Security
--
-- Every table below carries SELECT policies only. The deliberate absence of
-- INSERT/UPDATE/DELETE policies is what makes a client-side write fail — the
-- M0 done-gate.
-- ============================================================================

alter table public.corridors        enable row level security;
alter table public.corporates       enable row level security;
alter table public.corporate_users  enable row level security;
alter table public.ops_users        enable row level security;
alter table public.vendors          enable row level security;
alter table public.vendor_users     enable row level security;

-- corridors: reference data. Any signed-in user may read; needed for search
-- filters and the ops console alike.
create policy corridors_select_authenticated
  on public.corridors for select to authenticated
  using (true);

-- corporates: your own company, or anything if you are ops.
create policy corporates_select_own_or_ops
  on public.corporates for select to authenticated
  using (id = app.current_corporate_id() or app.is_ops());

-- corporate_users: colleagues within your own company, or anything if ops.
create policy corporate_users_select_own_or_ops
  on public.corporate_users for select to authenticated
  using (corporate_id = app.current_corporate_id() or app.is_ops());

-- ops_users: ops only. Corporates have no business enumerating Corlington staff.
create policy ops_users_select_ops
  on public.ops_users for select to authenticated
  using (app.is_ops());

-- vendors: ops see every vendor at any status. Corporates see only live ones —
-- prospects and suspended hotels must not leak into search results.
create policy vendors_select_live_or_ops
  on public.vendors for select to authenticated
  using (
    app.is_ops()
    or (status = 'live' and app.current_corporate_id() is not null)
  );

-- vendor_users: ops only, and this one is commercial rather than merely private.
-- Corlington's value is holding the contractual framework on both sides; handing
-- corporates the hotel's direct WhatsApp invites disintermediation.
create policy vendor_users_select_ops
  on public.vendor_users for select to authenticated
  using (app.is_ops());
