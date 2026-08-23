-- ============================================================================
-- Corlington · migration 019 · Onboarding setup (owner decisions 2026-08-18)
-- hotel credit tiers · corporate tiers + cash-flow ceiling · countersign ·
-- shot-list photo types · listing categories · onboarding progress views
-- ============================================================================

alter table public.vendors
  add column credit_tier text not null default 'HT4'
    check (credit_tier in ('HT1','HT2','HT3','HT4')),
  add column total_rooms smallint check (total_rooms is null or total_rooms > 0),
  add column airport_transfer_included boolean not null default false,
  add column courtesies text[] not null default '{}';

comment on column public.vendors.credit_tier is
  'HT1 open (A+B+C) · HT2 standard (A+B) · HT3 selective (A) · HT4 prepaid only. Set by the signed agreement.';

alter table public.listings add column category text;

alter table public.media
  add column shot_type text
    check (shot_type is null or shot_type in
      ('front_door','lobby','standard_room','bed','bathroom','wardrobe_desk',
       'breakfast','amenity','category','other'));

comment on column public.media.shot_type is
  'Property-level shot list (8 required for a hotel to go live): front_door, lobby, standard_room, bed, bathroom, wardrobe_desk, breakfast, amenity. category = room-type gallery photo (listing_id set).';

alter table public.corporates
  add column tier text not null default 'C' check (tier in ('A','B','C')),
  add column official_email text,
  add column countersign_required boolean not null default false,
  add column countersign_threshold_pkr bigint
    check (countersign_threshold_pkr is null or countersign_threshold_pkr >= 0);

comment on column public.corporates.official_email is
  'Address of record: countersign emails (F-001) and invoices go here — never the booker''s login email.';

-- the cash-flow rule, enforced: A ≤ d20 · B ≤ d15 · C ≤ d7 · d30 abolished
create or replace function app.check_corporate_ceiling()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allowed text[];
begin
  allowed := case new.tier
    when 'A' then array['on_checkout','d7','d15','d20']
    when 'B' then array['on_checkout','d7','d15']
    else          array['on_checkout','d7']
  end;
  if not (new.credit_terms::text = any (allowed)) then
    raise exception 'Credit terms % exceed the tier % ceiling (cash-flow rule: A<=d20, B<=d15, C<=d7)',
      new.credit_terms, new.tier
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function app.check_corporate_ceiling() from public;

create trigger corporates_ceiling
  before insert or update on public.corporates
  for each row execute function app.check_corporate_ceiling();

-- test-data alignment (TEST rows only)
update public.corporates set tier = 'A', credit_terms = 'd20'
  where name = 'Northbridge Textiles (TEST)';
update public.corporates set tier = 'B'
  where name in ('Meridian Logistics (TEST)', 'Karachi Freight Co (TEST)');
update public.vendors set credit_tier = 'HT1' where name = 'Harbourline Grand (TEST)';
update public.vendors set credit_tier = 'HT2' where name in ('Corniche Suites (TEST)','Faisal Court Executive (TEST)','Karachi Executive Cars (TEST)');
update public.vendors set credit_tier = 'HT3' where name = 'Saddar Heritage Inn (TEST)';
update public.vendors set credit_tier = 'HT4' where name = 'Airside Transit Lodge (TEST)';

-- onboarding progress views (security_invoker: callers' RLS applies)
create or replace view public.vendor_onboarding
with (security_invoker = true) as
select
  v.id            as vendor_id,
  v.name,
  v.vendor_type,
  v.status,
  v.credit_tier,
  v.corridor_id,
  v.stars_assigned,
  v.price_bracket,
  v.total_rooms,
  (v.description is not null and v.address is not null and v.corridor_id is not null) as profile_complete,
  exists (select 1 from public.vendor_users u
           where u.vendor_id = v.id and (u.whatsapp is not null or u.email is not null)) as has_front_office,
  exists (select 1 from public.agreements a
           where a.party_type = 'vendor' and a.party_id = v.id
             and (a.signed_digital_at is not null or a.signed_physical_at is not null)) as agreement_signed,
  (select count(*) from public.listings l where l.vendor_id = v.id and l.active) as listings_active,
  (select count(*) from public.listings l
     where l.vendor_id = v.id and l.active
       and exists (select 1 from public.listing_rates r
                    where r.listing_id = l.id and r.corporate_id is null and r.valid_to is null)) as listings_priced,
  (select count(*) from public.vendor_amenities va
     where va.vendor_id = v.id and va.verified_at is not null) as amenities_verified,
  (select count(distinct m.shot_type) from public.media m
     where m.vendor_id = v.id and m.listing_id is null
       and m.shot_type in ('front_door','lobby','standard_room','bed','bathroom','wardrobe_desk','breakfast','amenity')) as shots_done,
  (select array_agg(distinct m.shot_type) from public.media m
     where m.vendor_id = v.id and m.listing_id is null and m.shot_type is not null) as shot_types,
  (select count(*) from public.media m where m.vendor_id = v.id) as photos_total,
  (select count(*) from public.listings l
     where l.vendor_id = v.id and l.active
       and (select count(*) from public.media m where m.listing_id = l.id) >= 3) as listings_with_gallery,
  (select m.storage_path from public.media m
     where m.vendor_id = v.id and m.is_cover and m.listing_id is null limit 1) as cover_path,
  v.updated_at
from public.vendors v;

create or replace view public.corporate_onboarding
with (security_invoker = true) as
select
  c.id            as corporate_id,
  c.name,
  c.status,
  c.tier,
  c.credit_terms,
  c.credit_limit_pkr,
  c.official_email,
  c.countersign_required,
  c.countersign_threshold_pkr,
  c.security_type,
  c.security_amount_pkr,
  (c.official_email is not null) as has_official_email,
  (c.credit_limit_pkr > 0) as credit_set,
  (select count(*) from public.corporate_users u where u.corporate_id = c.id) as users_total,
  (select count(*) from public.corporate_users u
     where u.corporate_id = c.id and u.auth_user_id is not null) as users_linked,
  exists (select 1 from public.agreements a
           where a.party_type = 'corporate' and a.party_id = c.id
             and (a.signed_digital_at is not null or a.signed_physical_at is not null)) as agreement_signed,
  (select count(*) from public.booking_files f where f.corporate_id = c.id) as files_total,
  c.updated_at
from public.corporates c;

grant select on public.vendor_onboarding, public.corporate_onboarding to authenticated;
