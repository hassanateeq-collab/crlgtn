-- ============================================================================
-- Corlington · migration 012 · Vouchers (M6)
--
-- One voucher per booking, regenerable (re-issue overwrites the PDF and bumps
-- updated_at; the row is stable). PDFs live in the private `vouchers` bucket —
-- they carry guest PII, so corporates read only their own via a path-scoped
-- storage policy, and travelers/vendors receive expiring signed URLs.
-- ============================================================================

create table public.vouchers (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null unique references public.bookings (id) on delete cascade,
  ref               text not null unique,
  pdf_url           text not null,   -- storage object path, not a public URL
  sent_traveler_at  timestamptz,
  sent_vendor_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger vouchers_touch before update on public.vouchers
  for each row execute function app.touch_updated_at();

alter table public.vouchers enable row level security;

create policy vouchers_select_own_or_ops
  on public.vouchers for select to authenticated
  using (
    app.is_ops()
    or exists (
      select 1
      from public.bookings b
      join public.booking_files bf on bf.id = b.booking_file_id
      where b.id = booking_id
        and bf.corporate_id = app.current_corporate_id()
    )
  );

insert into storage.buckets (id, name, public)
values ('vouchers', 'vouchers', false)
on conflict (id) do nothing;

-- Objects are stored at vouchers/{booking_id}.pdf; the path itself carries the
-- ownership scope for the corporate-side read policy.
create policy vouchers_bucket_read_scoped
  on storage.objects for select to authenticated
  using (
    bucket_id = 'vouchers'
    and (
      app.is_ops()
      or exists (
        select 1
        from public.bookings b
        join public.booking_files bf on bf.id = b.booking_file_id
        where bf.corporate_id = app.current_corporate_id()
          and name = b.id::text || '.pdf'
      )
    )
  );
-- No client-side write policies: only the service role writes voucher PDFs.
