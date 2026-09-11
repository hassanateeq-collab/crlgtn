-- ============================================================================
-- Corlington · migration 026 · room-type (listing) deletion
--
-- Ops can now delete a room type from the vendor editor (ef_delete_listing).
-- A listing with no history is hard-deleted (rates, allotments and media
-- cascade). A listing that offers or transfer bookings still point at
-- (both FKs are ON DELETE RESTRICT — history must keep resolving) is archived
-- instead: active = false, deleted_at = now(). Archived rows never appear in
-- the editor, the property page or search; they exist only so past bookings
-- keep their room name.
-- ============================================================================

alter table public.listings
  add column deleted_at timestamptz;

comment on column public.listings.deleted_at is
  'Archived by ef_delete_listing because bookings/offers still reference it. '
  'Always paired with active = false. Hidden everywhere except through history joins.';

create index listings_vendor_live_idx
  on public.listings (vendor_id)
  where deleted_at is null;
