-- ============================================================================
-- Corlington · seed data (M0)
--
-- Idempotent: fixed UUIDs + ON CONFLICT, safe to re-run.
-- All hotels and corporates here are FICTIONAL. Real launch supply is loaded at
-- M8 with signed agreements and countersigned rate cards.
--
-- Auth users are NOT seeded — see scripts/link-auth-user.md for wiring a real
-- OTP sign-in to a seeded corporate_users / ops_users row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Karachi demand corridors (spec §2, all five)
-- ----------------------------------------------------------------------------
insert into public.corridors (id, city, name, sort) values
  ('c0000000-0000-4000-8000-000000000001', 'Karachi', 'Airport',            1),
  ('c0000000-0000-4000-8000-000000000002', 'Karachi', 'Shahrah-e-Faisal',   2),
  ('c0000000-0000-4000-8000-000000000003', 'Karachi', 'Clifton/DHA',        3),
  ('c0000000-0000-4000-8000-000000000004', 'Karachi', 'Saddar',             4),
  ('c0000000-0000-4000-8000-000000000005', 'Karachi', 'SITE',               5)
on conflict (id) do update
  set city = excluded.city,
      name = excluded.name,
      sort = excluded.sort;

-- ----------------------------------------------------------------------------
-- Test corporate — approval workflow off, 30-day terms, no security.
-- ----------------------------------------------------------------------------
insert into public.corporates (
  id, name, status,
  credit_limit_pkr, credit_terms, security_type, security_amount_pkr,
  fee_waived_until, approval_required, notes
) values (
  'a0000000-0000-4000-8000-000000000001',
  'Northbridge Textiles (TEST)',
  'live',
  2500000,          -- PKR 2,500,000 — integer PKR, no decimals anywhere
  'd30',
  'none',
  0,
  '2027-01-31',     -- 6-month fee waiver from launch
  false,
  'Fictional seed corporate for development. Delete before go-live.'
)
on conflict (id) do update
  set name = excluded.name,
      status = excluded.status,
      credit_limit_pkr = excluded.credit_limit_pkr,
      credit_terms = excluded.credit_terms,
      approval_required = excluded.approval_required,
      notes = excluded.notes;

-- One user per role, so RLS and the approval toggle can both be exercised.
-- auth_user_id stays NULL until a real OTP sign-in is linked.
insert into public.corporate_users (id, corporate_id, role, name, email, phone) values
  ('a1000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001',
   'corp_admin',    'Nadia Rahim',   'nadia@northbridge.test',   '+923001234501'),
  ('a1000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001',
   'corp_booker',   'Bilal Shaikh',  'bilal@northbridge.test',   '+923001234502'),
  ('a1000000-0000-4000-8000-000000000003',
   'a0000000-0000-4000-8000-000000000001',
   'corp_approver', 'Sana Iqbal',    'sana@northbridge.test',    '+923001234503'),
  ('a1000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000001',
   'corp_finance',  'Omar Farooq',   'omar@northbridge.test',    '+923001234504')
on conflict (id) do update
  set role = excluded.role,
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone;

-- ----------------------------------------------------------------------------
-- Second corporate — exists solely to prove cross-tenant isolation. The M2
-- done-gate requires that a user of one corporate cannot fetch the other's
-- files, and you cannot test that with a single tenant.
-- ----------------------------------------------------------------------------
insert into public.corporates (
  id, name, status, credit_limit_pkr, credit_terms,
  security_type, security_amount_pkr, approval_required, notes
) values (
  'a0000000-0000-4000-8000-000000000002',
  'Meridian Logistics (TEST)',
  'live',
  800000,
  'on_checkout',
  'deposit',
  200000,
  true,             -- approval workflow ON, the contrasting configuration
  'Fictional seed corporate #2 — isolation and approval-flow testing.'
)
on conflict (id) do update
  set name = excluded.name,
      approval_required = excluded.approval_required,
      security_type = excluded.security_type,
      security_amount_pkr = excluded.security_amount_pkr;

insert into public.corporate_users (id, corporate_id, role, name, email, phone) values
  ('a1000000-0000-4000-8000-000000000011',
   'a0000000-0000-4000-8000-000000000002',
   'corp_admin',  'Hina Aslam',   'hina@meridian.test',  '+923001234511'),
  ('a1000000-0000-4000-8000-000000000012',
   'a0000000-0000-4000-8000-000000000002',
   'corp_booker', 'Zeeshan Ali',  'zeeshan@meridian.test', '+923001234512')
on conflict (id) do update
  set role = excluded.role,
      name = excluded.name,
      email = excluded.email;

-- ----------------------------------------------------------------------------
-- Ops staff
-- ----------------------------------------------------------------------------
insert into public.ops_users (id, role, name, email, active) values
  ('0b000000-0000-4000-8000-000000000001',
   'ops_admin', 'Corlington Ops Admin', 'ops.admin@corlington.test', true),
  ('0b000000-0000-4000-8000-000000000002',
   'ops_agent', 'Corlington Desk Agent', 'ops.agent@corlington.test', true)
on conflict (id) do update
  set role = excluded.role,
      name = excluded.name,
      email = excluded.email,
      active = excluded.active;

-- ----------------------------------------------------------------------------
-- Three fictional hotels, spanning the tier range the spec describes
-- (guesthouse to 5-star), each in a different corridor and price bracket,
-- with commission inside the 8-12% band.
-- ----------------------------------------------------------------------------
insert into public.vendors (
  id, vendor_type, name, status, corridor_id,
  stars_assigned, price_bracket, commission_pct, notes
) values
  ('d0000000-0000-4000-8000-000000000001', 'hotel',
   'Harbourline Grand (TEST)', 'live',
   'c0000000-0000-4000-8000-000000000003',   -- Clifton/DHA
   5, 'b5', 12.00, 'Fictional 5-star seed vendor.'),

  ('d0000000-0000-4000-8000-000000000002', 'hotel',
   'Faisal Court Executive (TEST)', 'live',
   'c0000000-0000-4000-8000-000000000002',   -- Shahrah-e-Faisal
   3, 'b3', 10.00, 'Fictional business-hotel seed vendor.'),

  ('d0000000-0000-4000-8000-000000000003', 'hotel',
   'Airside Transit Lodge (TEST)', 'live',
   'c0000000-0000-4000-8000-000000000001',   -- Airport
   2, 'b1', 8.00, 'Fictional guesthouse-tier seed vendor.'),

  -- Not live: proves the vendors RLS policy hides non-live supply from
  -- corporates while ops can still see it.
  ('d0000000-0000-4000-8000-000000000004', 'hotel',
   'Saddar Heritage Inn (TEST)', 'onboarding',
   'c0000000-0000-4000-8000-000000000004',   -- Saddar
   3, 'b2', 9.00, 'Fictional vendor left in onboarding to test RLS visibility.')
on conflict (id) do update
  set name = excluded.name,
      status = excluded.status,
      corridor_id = excluded.corridor_id,
      stars_assigned = excluded.stars_assigned,
      price_bracket = excluded.price_bracket,
      commission_pct = excluded.commission_pct,
      notes = excluded.notes;

insert into public.vendor_users (id, vendor_id, name, whatsapp, email) values
  ('d1000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'Harbourline Reservations', '+923009876501', 'res@harbourline.test'),
  ('d1000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000002',
   'Faisal Court Front Desk',  '+923009876502', 'res@faisalcourt.test'),
  ('d1000000-0000-4000-8000-000000000003',
   'd0000000-0000-4000-8000-000000000003',
   'Airside Duty Manager',     '+923009876503', 'res@airside.test'),
  ('d1000000-0000-4000-8000-000000000004',
   'd0000000-0000-4000-8000-000000000004',
   'Saddar Heritage Owner',    '+923009876504', 'owner@saddarheritage.test')
on conflict (id) do update
  set name = excluded.name,
      whatsapp = excluded.whatsapp,
      email = excluded.email;
