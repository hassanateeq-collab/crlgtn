-- ============================================================================
-- Corlington · migration 021 · Marketing-site leads
--
-- The public site's two forms (corporate account request, vendor onboarding
-- request) previously opened the visitor's mail client. They now POST to
-- ef_lead, which lands the enquiry here.
--
-- This table is deliberately the seed of the future CRM: an enquiry is captured
-- once, then worked through a status. Nothing here is authoritative business
-- data — a lead is a stranger's claim about themselves until ops verifies it —
-- so it sits apart from corporates/vendors and never auto-provisions anything.
--
-- Writes arrive ONLY via ef_lead (service_role). Migration 004's default
-- privileges already make every new table client-read-only; the SELECT policy
-- below then narrows reading to ops.
-- ============================================================================

create type public.lead_kind   as enum ('corporate', 'vendor');
create type public.lead_status as enum ('new', 'contacted', 'qualified', 'converted', 'rejected');

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  kind         public.lead_kind   not null,
  status       public.lead_status not null default 'new',

  -- What the form collects. Lengths are capped in ef_lead as well; the checks
  -- here are the backstop that survives a future caller that forgets.
  org          text not null check (length(org)    between 1 and 200),
  person       text not null check (length(person) between 1 and 120),
  email        text not null check (length(email)  between 3 and 200),
  phone        text not null check (length(phone)  between 3 and 60),
  city         text          check (city   is null or length(city)   <= 200),
  volume       text          check (volume is null or length(volume) <= 200),
  notes        text          check (notes  is null or length(notes)  <= 2000),

  -- Provenance, for working out which page and campaign actually convert.
  source_page  text          check (source_page is null or length(source_page) <= 300),
  user_agent   text          check (user_agent  is null or length(user_agent)  <= 400),
  ip_hash      text,          -- sha-256 of IP + salt; for abuse triage, not identity

  -- Ops working fields.
  handled_by   uuid references public.ops_users (id) on delete set null,
  handled_at   timestamptz,
  ops_note     text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index leads_status_created_idx on public.leads (status, created_at desc);
create index leads_kind_idx           on public.leads (kind);
-- Not unique: the same company legitimately enquires twice. This exists so ops
-- can spot repeats rather than to prevent them.
create index leads_email_idx          on public.leads (lower(email));

create trigger leads_touch_updated_at
  before update on public.leads
  for each row execute function app.touch_updated_at();

alter table public.leads enable row level security;

-- Ops reads leads. Corporates and vendors must never see them: one lead reveals
-- another company's expansion plans.
create policy leads_select_ops
  on public.leads for select
  using (app.is_ops());
