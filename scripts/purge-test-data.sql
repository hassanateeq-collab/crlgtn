-- ============================================================================
-- Corlington · PRE-LAUNCH TEST-DATA PURGE
--
-- Removes every fictional entity created during M0–M8 development. Run ONCE,
-- immediately before loading real launch supply, from the SQL editor as the
-- service role. NOT idempotent-safe against real data: verify the SELECT
-- preview at the bottom BEFORE running the deletes.
--
-- audit_log is append-only by trigger and is deliberately NOT purged — the
-- development history remains on record, which is what an audit trail is for.
--
-- Storage objects (media/, vouchers/, agreements/) must be cleared from the
-- dashboard or via the storage API; SQL deletes below only remove the rows.
-- ============================================================================

begin;

-- Money (leaf tables first)
delete from public.payments;
delete from public.invoices;
delete from public.settlements;
delete from public.deposits;

-- Vouchers & bookings
delete from public.vouchers;
delete from public.bookings;

-- RFQ & files
delete from public.rfq_offers;
delete from public.travelers;
delete from public.booking_files;

-- Notifications (operational history of test runs)
delete from public.notifications;

-- Catalog
delete from public.media;
delete from public.allotments;
delete from public.listing_rates;
delete from public.listings;
delete from public.vendor_amenities;
delete from public.inclusions;
delete from public.addons;
delete from public.agreements;

-- Tenancy (test entities are all suffixed '(TEST)' / .test emails)
delete from public.vendor_users;
delete from public.vendors where name like '%(TEST)%';
delete from public.corporate_users where email like '%.test';
delete from public.corporates where name like '%(TEST)%';
delete from public.ops_users where email like '%.test';

-- Auth: test accounts only. KEEP the real owner account.
delete from auth.identities where user_id in (
  select id from auth.users where email like '%.test');
delete from auth.users where email like '%.test';

-- Reset reference sequences so launch refs start clean.
-- (CF refs continue — gaps are documented as acceptable — but if a clean
-- restart is wanted, uncomment:)
-- alter sequence app.booking_file_ref_seq restart with 2601;
-- alter sequence app.invoice_number_seq restart with 1001;

commit;

-- ---- Post-purge verification: every count must be 0 except corridors (5),
-- packages (3), amenities (5+), ops_users (real staff), audit_log (history).
select
  (select count(*) from public.vendors)        as vendors,
  (select count(*) from public.corporates)     as corporates,
  (select count(*) from public.booking_files)  as files,
  (select count(*) from public.bookings)       as bookings,
  (select count(*) from public.invoices)       as invoices,
  (select count(*) from public.corridors)      as corridors_keep,
  (select count(*) from public.packages)       as packages_keep,
  (select count(*) from public.amenities)      as amenities_keep,
  (select count(*) from public.audit_log)      as audit_history_kept;
