# Corlington — BUILD_LOG

Memory between sessions, per dev plan §0. Newest entry last.

---

## 2026-07-30 — Session 1 · M0 Foundations

**Infrastructure**
- Supabase project `crlgtn` created — ref `cfnaxfvoshbxjnqbrfgu`, region `ap-southeast-1`, Postgres 17. Fully separate from every existing project.
- No dev branch yet, deliberately: branches bill separately and earn their keep once production carries real data. Revisit at M8, before the pilot corporate.
- GitHub repo wired (`hassanateeq-collab/crlgtn`), local repo initialized on `main`.
- Frontend: Vite + React 19 + TS + Tailwind 4 in `web/` (decision: build in-repo rather than Lovable; full code ownership).
- Email: Supabase built-in SMTP for M0 login testing only (~2–3 mails/hour cap). Must be replaced before M4. Decision pending on provider.
- WhatsApp: decision made — **new Meta WABA under the Corlington name** (confidentiality: the platform's own sender identity, not the parent's). Registration script/template patterns are reusable. Submission should start well before M4.

**Migrations applied** (also in `supabase/migrations/`)
1. `001_foundations` — all §5 enums (+ `corporate_status`, `actor_type`, see deviations) · private `app` schema for RLS helpers (not exposed via PostgREST) · `touch_updated_at` + `deny_mutation` trigger functions.
2. `002_tenancy_rls` — corridors, corporates, corporate_users, ops_users, vendors, vendor_users · RLS enabled everywhere, SELECT-only policies · JWT-claim helpers (`app.is_ops`, `app.current_corporate_id` as SECURITY DEFINER to break policy recursion).
3. `003_audit_log` — append-only via BEFORE UPDATE/DELETE trigger (fires even for service_role) · SELECT restricted to ops_admin.
4. `004_revoke_client_writes` — see "lesson" below.

**Edge Functions deployed**
- `ef_whoami` (template): the envelope (`_shared/handler.ts`) enforces JWT check → validate → write → audit → respond. Shared modules: cors (origin allowlist, no wildcard), errors (typed EdgeError), context (actor resolution; ops claim in `app_metadata.role` cross-checked against an *active* ops_users row), audit (non-throwing by design — a failed log line must not roll back a booking).

**Seed** (all fictional, delete before go-live)
- 5 Karachi corridors exactly per spec §2.
- 2 corporates: Northbridge (d30 terms, no approval) + Meridian (on_checkout, deposit-secured, approval ON) — the second exists to prove cross-tenant isolation.
- 4 hotels: 5★/b5 Clifton, 3★/b3 Shahrah-e-Faisal, 2★/b1 Airport, plus one left in `onboarding` to prove non-live supply stays hidden from corporates.
- 2 ops users; test auth users for bilal@northbridge.test, zeeshan@meridian.test, ops.admin@corlington.test (dev-only passwords, rotate before real data).

**Deviations from spec §5** (all additive)
- `corporate_status` enum: spec names the column but no enum; mirrors vendor_status.
- `ops_users` table: not in spec's list. The JWT claim (spec §4) remains the authorization gate; the table is the registry the console and audit log need. Actor resolution requires claim **and** active row.
- `actor_type` includes `system` for cron sweeps (ef_expire_sweep etc.) writing audit rows with no human actor.

**Lesson: RLS policy absence ≠ write denial** (migration 004)
The M0 gate "a direct client-side insert fails" surfaced a subtlety: with no write policies, INSERT fails loudly (42501) but UPDATE/DELETE match zero rows and *succeed silently*. No data was ever at risk — RLS filtered every row — but silent success is a bad contract and policy-absence is fragile (one stray FOR ALL policy reopens it). Fixed by revoking INSERT/UPDATE/DELETE/TRUNCATE from `authenticated`/`anon` at the privilege level, plus `ALTER DEFAULT PRIVILEGES` so **every future table is born client-read-only**. Verified: all seven attack probes now 42501; SELECT unaffected; service_role unaffected.

**M0 done-gate results — all pass**
- Corporate login sees exactly own corporate (1), live vendors only (3 of 4), zero vendor contacts, zero audit rows.
- Ops login sees 2 corporates, 4 vendors, 4 vendor contacts; only ops_admin reads audit_log (ops_agent: 0 rows).
- Client-side writes: blocked with 42501 (INSERT, UPDATE own row, DELETE, self-promote ×2, audit forge).
- audit_log immutable for service_role *and* superuser (trigger, not policy).
- `ef_whoami` writes audit rows for both actor types (verified: 3 + 3 rows).
- Security advisors: zero RLS findings. One WARN (leaked-password protection off) — moot once OTP-only, revisit at M8.
- Verified in-browser end to end as both bilal@ (booker) and ops.admin@ — screenshots in session log.

**Carried forward / next session (M1)**
- Ops console shell (role-gated) · `ef_onboard_vendor` · listings + `listing_rates` (base catalog) · packages P1–P3 seeded · amenity checklist with verification stamps · `ef_upsert_corporate` · agreements + Storage upload.
- Open: email provider decision (needed by M4 at the latest); Meta WABA registration start; corporate fee amount (spec §13.1); B1–B5 PKR boundaries (§13.3).

---

## 2026-07-30 — Session 2 · M1 Supply & ops core

**Owner access fixed**
- hassanateeq@gmail.com provisioned as `ops_admin` (auth user + ops_users row + claim). Root cause of "no email code": (1) closed-access means unknown emails silently get nothing — by design; (2) the default Supabase email template sends a magic *link*, but our sign-in expects the 6-digit `{{ .Token }}` code. Template must be edited in Dashboard → Auth → Email Templates → Magic Link (CLI unauthenticated, couldn't do it programmatically). Until then, built-in SMTP also caps at ~2 mails/hour.
- Second GoTrue lesson recorded: manually inserted auth.users rows must have all token columns as `''`, not NULL, or the token grant 500s.

**Migration 005 — catalog & agreements**
- `packages` (P1–P3 seeded; P4 space reserved) · `listings` · `listing_rates` with the two-layer model (corporate_id NULL = base, set = negotiated; partial unique indexes per layer) · `amenities` (5 seeded from spec §13.7) · `vendor_amenities` (verified_at/verified_by — unverified claims invisible to corporates via RLS) · `inclusions` · `addons` · `allotments` (reserved, ops-only) · `agreements` (+ private `agreements` Storage bucket, ops-only policies).
- Key RLS decisions: rates visible to a corporate only for live vendors' active listings AND (base OR own corporate_id) — negotiated-deal confidentiality is row-level; amenity claims without verified_at are ops-only.

**Edge Functions**
- `ef_onboard_vendor`: whole onboarding in one call (vendor → listings by name → base rates replace-open-row → amenity checklist with verification stamps → inclusions/addons replace-when-present → agreement append-only). Ops-gated in-function.
- `ef_upsert_corporate`: corporate + credit profile + users upsert-by-email; user deletion deliberately out of scope of the edit form.

**Ops console (web/)**
- `IdentityProvider` (ef_whoami once per session) routes ops → /ops, corporates → portal placeholder.
- /ops: Vendors list + full onboarding editor (listings with P1–P3 rate grid, amenity checklist, inclusions, add-ons, agreement w/ PDF upload to Storage) · Corporates list + credit-profile editor with users grid · Diagnostics (the M0 checks, kept).

**M1 done-gate results — all pass**
- Corniche Suites (TEST) onboarded complete via ef_onboard_vendor: 2 listings, 5 base rates, 4 amenity records (3 verified), 2 inclusions, 1 addon, 1 agreement. Editor form verified rendering + hydrating in browser.
- Negotiated override: Northbridge P1 deal 22,000 resolves over base 24,000; Meridian still resolves 24,000 and cannot see Northbridge's row (RLS-verified from all three perspectives); ops sees both.
- Unverified amenity (pool) hidden from corporates, visible to ops.
- ef_upsert_corporate round-trip verified (Karachi Freight Co TEST + 1 user).
- Advisors: zero RLS findings on all 9 new tables (only pre-existing leaked-password WARN, moot for OTP-only, revisit M8).

**Carried forward / next session (M2)**
- Corporate portal shell: layout + spine, booking files list, `ef_upsert_booking_file` (name, dates, rooms jsonb, deal-breakers, corridor, auto_accept), ref generation CF-{seq}-KHI, resume-from-draft.
- Reminder: M2 gate requires explicit cross-tenant file isolation test.
- Still open: email provider (M4 deadline), WABA registration, fee amount, B1–B5 boundaries.

---

## 2026-07-30 — Session 2b · M1.5 OTA-grade listings + dashboard scaffold

Owner review: listings too thin ("should stand next to Booking.com/Agoda") and no
central place to see everything. Both addressed; plan amended.

**Plan amendments (owner-driven)**
- New standing requirement: property pages at OTA grade — profile, imagery, room
  detail — for ops preview now and the corporate results/detail pages at M3.
- **M5 scope now explicitly includes the central Reservations view**: all bookings
  across all vendors, filterable by hotel/corporate/status/stay dates, today's
  check-ins/outs on top. (The spec's live request board was always in M4; the
  consolidated reservations dashboard is now named alongside it.)

**Migration 006 — property detail**
- vendors: description, property_subtype, address, phone, checkin/checkout_time,
  cancellation_policy, noshow_policy (free text; M5 snapshots them per booking).
- listings: description, bed_config, size_sqm.
- `media` table (vendor- or listing-scoped, sort, caption, one cover per property)
  + private `media` storage bucket: all authenticated read via signed URLs, ops-only
  write. No public bucket — closed-access platform.

**Function + console**
- ef_onboard_vendor v2: accepts profile fields, room detail, and a media[] registry
  (replace-when-present; files uploaded by console first, rows registered on save).
- VendorEditor: property-profile card, photo manager (multi-upload, captions,
  room assignment, cover picker), room detail fields.
- New **PropertyPage** (/ops/vendors/:id/page): OTA-style — gallery, header with
  stars/type/corridor/bracket, description, verified-amenity chips (unverified
  marked ops-only), inclusions, Good-to-know sidebar (address, times, policies,
  BTC line verbatim), room cards with bed/size/rates, add-ons. Built to be reused
  by the corporate portal at M3, where RLS trims it automatically.
- New **Dashboard** (/ops): supply & demand counts live now; Live request board
  (M4) and Reservations (M5) sections scaffolded in place.

**Verified in browser**
- Corniche Suites enriched: full profile + 5 placeholder photos (canvas-generated;
  real photography stays a §12 launch item) → property page renders gallery, room
  photos, policies, BTC block; dashboard shows 4 live hotels / 2 bookable rooms /
  3 corporates / 7 users. Responsive at narrow width.

---

## 2026-07-31 — Session 3 · M2 Corporate portal shell

**Migrations 007–008**
- `booking_files`: ref (unique), corporate_id, name, status (draft default),
  check_in/out (CHECK out > in), rooms jsonb, dealbreakers jsonb, corridor_id,
  auto_accept, window_minutes/window_expires_at (empty until M4/M5), created_by.
- `travelers` (name required, email/phone optional).
- RLS: files scoped by corporate_id-or-ops; travelers via file join. SELECT-only.
- `next_booking_ref()` SECURITY DEFINER → 'CF-' || app.booking_file_ref_seq ||
  '-KHI', seq starts 2601; EXECUTE revoked from clients — only Edge Functions
  draw refs.

**ef_upsert_booking_file**
- corp_booker/corp_admin only (ops refused; approver/finance read-only via RLS).
- Validates dates, 1–9 rooms of 1–6 guests, dealbreakers ⊆ dealbreaker-eligible
  amenity codes; travelers replace-when-present.
- Drafts only: non-draft edits → 409; cross-tenant id probes → 404
  (indistinguishable from missing — no existence leak).
- Ref assigned once at creation, never client-supplied.

**Portal UI**
- PortalLayout (topbar: Corlington + company name); corporate users now land at
  /files (Foundations screen retired from home; still at /ops/diagnostics).
- Files list: drafts float to top, Resume/Open per status.
- FileEditor with the §10 spine: mono ref, status, stay + computed nights,
  rooms/guests summary, decision-window slot (brass countdown arrives M5),
  Save draft. Form: name, dates, corridor, rooms steppers, deal-breaker chips
  (from amenities where dealbreaker_eligible), auto-accept, optional travelers.
  Sent files render read-only (fieldset disabled + notice).

**M2 done-gate results — all pass**
- CF-2601-KHI created by Bilal (Northbridge) with 2 rooms + 1 traveler; resumed:
  same ref, 3 rooms, dates extended, auto_accept on; full page reload → list
  shows draft, editor rehydrates spine + all fields.
- Cross-tenant (Zeeshan/Meridian): list 0 rows · direct id fetch 0 rows ·
  function update blocked not_found · travelers 0 rows.
- Advisor caught migration 008's revoke as incomplete (EXECUTE still inherited
  via PUBLIC's default grant on new functions). Migration 009 revokes from
  PUBLIC and grants service_role only — probe confirms anon/authenticated 42501,
  service_role ok. Lesson: functions need `revoke ... from public`, same shape
  as migration 004 for tables. Advisors clean again after fix.

**Dev notes**
- bilal@ / zeeshan@ .test users got dev passwords for gate testing — replace or
  remove all .test auth users before launch (M8 checklist).

**Carried forward / next session (M3 — Search & results)**
- Results query: active live vendors ∩ corridor ∩ verified deal-breakers →
  property cards (stars, corridor, bracket, verified amenities, inclusions,
  P1–P3 rates resolved per corporate — negotiated over base) · package pick per
  hotel · select ≤3 with priority order, blocking message at 3.
- Reuse PropertyPage under a corporate route for the detail view.
- Still open: email provider (M4 deadline), WABA registration, fee amount,
  B1–B5 boundaries.

---

## 2026-07-31 — Session 3b · M3 Search & results

**Supply enrichment (test data, via ef_onboard_vendor as ops)**
- Harbourline Grand: 2 rooms w/ rates, verified wifi+pool+meeting+power, profile.
- Faisal Court: 1 room, verified wifi+power. Airside: 1 room, verified power only.
- Verified-amenity matrix now discriminates: pool → Harbourline only (Corniche's
  claim stays unverified on purpose); indoor_parking → Corniche only.

**Results page (/files/:id/results)**
- Client-side query under RLS (live vendors, verified amenities, own+base rates
  are all RLS-enforced; page filtering is business logic, not security).
- Matching: corridor (if set) ∩ all dealbreakers verified ∩ has a listing that
  fits the largest room's guests AND has ≥1 open rate. Sorted stars desc.
- Cards: signed cover photo, stars/subtype/corridor/bracket, description,
  verified chips, inclusions, room + package selects (packages without rates
  hidden), resolved nightly rate with "your corporate rate" tag on negotiated.
- Selection: ≤3 in click order with priority badges; 4th click → explanatory
  cap message (spec's exact rationale); fixed tray shows picks + disabled
  "Send request — offers in 15 minutes" awaiting M4's ef_send_rfq.
- FileEditor spine gained "Find hotels" (draft files only).
- PropertyPage now dual-context: /property/:id inside the portal (back-to-results
  nav, no ops annotations) vs /ops preview unchanged.

**M3 done-gate results — all pass (browser-verified)**
- Deal-breaker exactness: [] → 4 matches · ['pool'] → Harbourline only (unverified
  Corniche claim excluded) · ['fast_wifi','indoor_parking'] → Corniche only.
- Rate resolution: Bilal (Northbridge) sees Corniche Deluxe King P1 at 22,000
  with corporate-rate tag; Zeeshan (Meridian) sees 24,000 untagged.
- Cap: three selected with #1/#2/#3 badges; fourth click blocked with message;
  tray reads 3/3.
- Airside card offers only P1/P2 (no P3 rate exists) — package filter correct.

**Carried forward / next session (M4 — RFQ engine)**
- ef_send_rfq (≤3 offers, window rule: 180 min std / 60 min when check-in ≤48h,
  notifications) · ef_notify dispatcher (email first, WhatsApp behind) · vendor
  magic-link page + ef_vendor_respond (hashed single-use expiring tokens) ·
  offer timeline on corporate board · ef_sla_monitor cron (10-min alert).
- Results selection feeds ef_send_rfq: {vendor_id, listing_id, package_code,
  rate_pkr, priority}[] — shape already assembled in Results tray state.
- BLOCKER TO RESOLVE: real email provider (built-in SMTP is 2/hr and
  team-only) — decide before M4 notifications can be tested end-to-end.

---

## 2026-07-31 — Session 4 · M4 RFQ engine

**Migration 010**
- `rfq_offers`: file/vendor/listing/package/rate/priority + status machine,
  token_hash (sha-256, unique) + token_expires_at (= window end), counter jsonb,
  ops_override/ops_evidence (M5), sla_flagged_at. Unique (file, vendor) and
  (file, priority). Column-level revoke: corporates cannot SELECT token_hash or
  ops_evidence even on their own offers (⇒ board queries must list columns
  explicitly; `select *` 403s for corporate roles — by design).
- `notifications`: event/recipient/channel/template/payload/status/provider_id +
  dedupe_key unique (idempotency, the M8 double-send defence built in early).
- **DEVIATION:** spec §7's ef_sla_monitor implemented as in-database
  `app.sla_sweep()` on pg_cron (`corlington_sla_sweep`, every minute) — no HTTP
  hop, no service key in cron. Flags quiet (≥10 min) open offers once, writes
  ops notification + audit row. M5's expire sweep will follow the same pattern.

**ef_send_rfq**
- Booker/admin only; file must be own + draft; guarded transition (`eq status
  draft`) kills double-send races. ≤3 selections, distinct vendors, distinct
  priorities 1-3. Rates re-resolved server-side (negotiated-over-base) — the
  client's displayed rate is advisory only.
- Window rule: 180 min standard / 60 min when check-in ≤48h (env-overridable
  WINDOW_STANDARD_MIN/WINDOW_URGENT_MIN). PKT midnight math done in +05:00.
- Tokens generated per offer; raw token exists only in the magic link, which is
  stored in the vendor notification payload (ops can read + forward manually via
  WhatsApp until WABA lands — that IS the MVP ops flow).

**ef_vendor_respond** (verify_jwt = false — the sole exception, token-auth)
- view (sent→viewed) · accept (→hold, binding) · counter (alt listing and/or
  note; validated against vendor's own active listings) · decline. Guarded
  update (.in status [sent,viewed]) = single-use + race-safe. Lazy expiry on
  click after window end. Invalid and expired tokens both read as generic 404.
  File requested→responded on first response. Corporate booker notified
  (portal channel) on hold/counter. Audit attributed to vendor_users contact.
- Fix during verification: response body echoed the pre-update status (stale
  in-memory row) — vendor confirmation screen would have shown the old state.
  DB was always correct; v2 syncs the row before rendering.

**Frontend**
- /respond/:token — public vendor page (bypasses the auth gate; the token is
  the credential): request card, brass countdown, Accept/Counter/Decline,
  counter form with alternate-room select, confirmation + expired states.
- Results "Send request — offers in 15 minutes" wired to ef_send_rfq.
- FileEditor: OffersBoard (5s polling while window open; explicit column list
  per the RLS note) + live brass countdown in the spine.

**M4 done-gate results — all pass**
- Send: 4-hotel attempt → 422 with the spec's cap message; 3-hotel send →
  file requested, window 180, offers p1/p2/p3 with server-resolved rates
  (Corniche = Northbridge's 22,000 negotiated); resend → 409.
- Magic links: 3 produced (in notification payloads, email rows queued
  awaiting provider key). Vendor page renders with countdown; accept →
  hold (browser click); re-accept → 409 already_responded; counter with note
  → countered, then decline attempt → 409; decline → declined; garbage token
  → 404. File → responded.
- Board (Bilal): #1 on hold · #2 countered with the hotel's note rendered ·
  #3 declined · spine countdown live at 2:53:52. 5s polling ⇒ "within seconds".
- Window rule: far check-in → 180; check-in tomorrow (CF-2604) → 60.
- SLA: backdated offer flagged on sweep, ops alert + audit row written,
  second run flags 0 (idempotent), cron job active (* * * * *).
- Advisors clean (pre-existing OTP-moot WARN only).

**Carried forward / next session (M5 — Window, holds & booking)**
- ef_book_offer as single transaction with row locking: re-check hold/countered
  → booking + policy snapshots → release siblings → queue voucher → notify
  winner/losers. Double-book race test is the gate.
- app.expire_sweep() on pg_cron (lapse windows → offers expired, holds
  released, file expired).
- Auto-accept: first hold triggers book server-side (ef_vendor_respond hook).
- ef_ops_override_accept requiring ops_evidence (wa_msg_id + email_msg_id).
- Still open: email provider key (queue drains automatically once
  RESEND_API_KEY + MAIL_FROM secrets are set), WABA registration, fee amount,
  B1–B5 boundaries.

---

## 2026-08-01 — Session 5 · M5 Window, holds & booking

**Migration 011**
- `bookings` with policy SNAPSHOTS (cancellation/no-show text captured at
  booking time — voucher/dispute truth), nights, integer-PKR totals, unique
  (booking_file_id) = "at most one booked offer per file" as an index.
- `public.book_offer(offer, actor_type, actor_id)` — THE transaction, in
  Postgres where the locks live: lock offer→file (fixed order, no deadlocks),
  re-check status/window under lock, resolve counter's revised listing + its
  own rate, insert booking, offer→booked, siblings→released (with per-loser
  notifications), file→confirmed, audit, winner/booker/voucher-queue
  notifications. SECURITY DEFINER, EXECUTE service_role-only (migration-009
  pattern). Called from three places: corporate click, auto-accept, override.
- `app.expire_sweep()` on pg_cron (every minute): T-15 warning once per file
  (window_warned_at), then lapse — open offers→expired + vendor notices,
  file→expired + booker notice + audit.
- booking totals: rate × nights × room-count. Rooms means jsonb array length.

**Functions**
- ef_book_offer: authz + ownership check, then rpc; DB errcodes mapped to
  404/409/422. Race loser gets a clean 409.
- ef_ops_override_accept: refuses without BOTH wa_msg_id and email_msg_id
  (non-blank); hold with ops_override + evidence {ids, agent}; books
  immediately when the file is auto-accept.
- ef_vendor_respond v3: first hold on an auto_accept file calls book_offer as
  system actor — vendor's confirmation shows "booked instantly".

**UI**
- OffersBoard: Book / Accept-counter-&-book buttons (booker/admin, window
  open); FileEditor shows the booked summary with BTC line.
- Ops Dashboard: Live request board is REAL now (open files, countdowns, SLA
  chase chips, inline override-accept with the two evidence fields) and the
  central Reservations view the owner asked for in M1.5 (all bookings across
  all vendors: ref, corporate, hotel, stay, total, booked-at).

**M5 done-gate results — all pass**
- Double-book race: Promise.allSettled on hold+countered → exactly one
  fulfilled (Harbourline, 76,000 = 38,000×2n×1r), loser 409; offers end
  booked/released/released; file confirmed; exactly 1 bookings row.
- Window kill: the sweep's first cron tick organically expired all three
  dead-window M4 files — holds/counters→expired, files→expired, 3 booker
  notices + 3 vendor lapse notices + 3 audit rows.
- Auto-accept: vendor accept on CF-2606 returned status=booked, zero
  corporate clicks; totals 28,000 (14,000×2n).
- Override: missing/blank evidence → 422; with both ids → hold carrying
  ops_override+evidence; corporate then booked it (CF-2607, 16,000).
- Dashboard verified in browser: reservations table shows all 3 bookings with
  correct totals; live board empty (all settled) with override UI in place.
- Advisors: clean (pre-existing OTP-moot WARN only).

**Deviations / notes**
- ef_expire_sweep implemented as app.expire_sweep() in-database (same
  rationale as the SLA sweep; recorded once more for the M8 checklist).
- Approval workflow (corp_approver routing) still deliberately unbuilt —
  per-corporate toggle exists; enforcement is a later milestone (spec allows).
- The five golden paths for M8 UAT now have 4/5 machine-verified precedents
  (normal book, counter accepted, auto-accept, window expiry, ops override —
  counter-accepted-and-booked exercised in the race test's losing branch and
  the earlier M4 counter; will re-run all five cleanly at M8 on prod data).

**Carried forward / next (M6 — Voucher & handover)**
- ef_issue_voucher worker: drain 'issue_voucher' queue → PDF (ref, guest,
  hotel, dates, rooms, package, inclusions/exclusions, BTC block verbatim,
  policies FROM SNAPSHOTS) → Storage → traveler email when details exist →
  vendor handover. Gate: voucher shows snapshot policy even after ops edits
  the hotel's current policy.
- Still open: RESEND_API_KEY + MAIL_FROM (now blocking voucher emails too),
  WABA, fee amount, B1–B5 boundaries.

---

## 2026-08-01 — Session 5b · M6 Voucher & handover

**Migration 012** — `vouchers` (one per booking, regenerable) + private
`vouchers` bucket; corporate read scoped BY PATH ({booking_id}.pdf) through a
storage policy joining bookings→booking_files; writes service-role only.

**PDF without dependencies** — `_shared/pdf.ts` hand-writes PDF 1.4
(Helvetica/Bold, uncompressed streams, correct xref, Latin-1 with a
sanitizer). ~3 KB per voucher. Uncompressed streams were a deliberate choice:
the snapshot gate is verifiable by grepping bytes.

**_shared/voucher.ts** — compose (GUESTS/HOTEL/STAY/INCLUDED/NOT INCLUDED/
PAYMENT/CANCELLATION/NO-SHOW; BTC block verbatim; policies FROM SNAPSHOTS) →
upload → vouchers row upsert → 7-day signed link → traveler email only when
details exist → vendor handover email+WhatsApp → retire the M5 queue marker.
Never throws into its caller.

**Wiring** — auto-issue hooks in ef_book_offer v2 and ef_vendor_respond v4
(auto-accept path); ef_issue_voucher endpoint for manual/re-issue (ops any,
booker/admin own).

**M6 done-gate results — all pass**
- Three M5 bookings issued: PDFs in storage, vouchers rows, handovers queued.
- SNAPSHOT GATE: set Airside's live cancellation_policy to "strictly
  non-refundable", re-issued CF-2607-KHI/V, grepped the regenerated PDF:
  contains "Free cancellation until 6pm on arrival day" (snapshot), does NOT
  contain the new text. Rendered PDF visually verified + sent to owner.
- Golden path (CF-2608-KHI — coincidentally the spec §5 example ref): file
  with traveler → auto-accept → booked → voucher AUTO-issued by the hook →
  pdf_in_storage=1, traveler_email_rows=1 (queued; sends when Resend key
  lands), handover_rows=2, both sent-flags stamped.
- Emails remain queued pending RESEND_API_KEY/MAIL_FROM — "email in the
  traveler's inbox" is satisfied to the provider boundary; flip the secrets
  and the queue drains. Recorded as an M8 verification item.

**Carried forward / next (M7 — Money)**
- ef_generate_invoice honoring credit_terms (on_checkout at checkout;
  d7/15/30 dated from checkout) · deposits ledger + drawdown ·
  ef_record_payment + invoice transitions · overdue reminders cron ·
  monthly vendor settlement (gross − commission_pct), exportable.
- Gate: one booking per credit-terms value → correctly dated invoices;
  deposit corporate draws down; test-month settlement reconciles to the rupee.

---

## 2026-08-01 — Session 5c · M7 Money

**Migration 013**
- invoices (unique per booking; number CI-{seq} from app.invoice_number_seq;
  tax jsonb placeholder pending §13.2 sign-off) · payments (bank_transfer |
  deposit_drawdown) · deposits (amount vs balance, balance_pkr >= 0 CHECK) ·
  settlements (unique vendor+period; draft→approved→paid; draft recomputable).
- `generate_invoice_for_booking()`: due = checkout / +7 / +15 / +30 by the
  corporate's terms; standing deposit with covering balance auto-draws down
  and marks the invoice paid, atomically (corporate + deposit rows locked).
- **book_offer() now invoices inside the booking transaction** — booking,
  voucher queue, sibling release AND invoice are one atomic unit.
- app.finance_sweep() daily 08:00 PKT: due-in-3 reminder (dedupe-once),
  sent→overdue flip + notice + audit.
- run_settlement(period): per vendor, stays checked out in period; commission
  = round(gross × pct); cron on the 1st for the prior month; draft rows
  recompute on re-run, approved/paid are immutable.

**ef_finance** — DEVIATION from spec §7: ef_generate_invoice + ef_record_payment
+ ef_settlement_run consolidated behind one ops-only endpoint with an action
discriminator (identical scaffolding; split later if needed). record_payment
supports partial payments (paid only when cumulative ≥ amount) and manual
drawdowns that respect the ledger.

**UI** — Ops "Money" tab: invoices w/ inline record-payment, deposit balances,
settlements (period run + CSV export). Portal "Invoices" page: open total,
deposit balance, read-only list with BTC payment note.

**M7 done-gate results — all pass**
- Dating: d7→Sep 3, d15→Sep 11, d30→Sep 26 (all from Aug 27 checkout),
  d30/Sept→Oct 3. on_checkout→due = checkout exactly (CI-1005).
- Deposit: Meridian booking CF-2609 (one vendor tap: booking + voucher +
  invoice + drawdown) → CI-1005 paid by auto-drawdown, balance 200,000→184,000.
- Payments: partial 50k leaves overdue; +26k flips paid; pay-again → 409.
- Overdue: backdated CI-1001 flipped once with notice + audit; second sweep 0.
- Settlement 2026-08 reconciled BY HAND to the rupee: Harbourline 76,000/9,120/
  66,880 (12%) · Faisal 28,000/2,800/25,200 (10%) · Airside 32,000/2,560/29,440
  (8%, two stays) · Sept checkout correctly excluded.
- Money tab + portal invoices verified rendering in browser.

**Carried forward / next (M8 — Hardening & launch)**
- RLS pass on every table (advisors clean) · JWT audit of all deployed
  functions · magic-link rate-limit review · notification idempotency spot
  check · UAT: five golden paths on clean data · purge .test data + seed
  users · real launch supply · Meta templates · Resend secrets · tax sign-off.

---

## 2026-08-01 — Session 5d · M8 Hardening & launch prep

**Security audit — all clean**
- RLS: 27/27 public tables rowsecurity ON, exactly one SELECT policy each,
  ZERO write policies (writes are privilege-revoked, migration 004).
- Functions: 10 deployed, 9 verify_jwt=true; sole exception ef_vendor_respond
  (token-auth by design). The PMS lesson, checked function by function.
- Advisors: security + performance both clean except the leaked-password WARN
  (moot for OTP; dashboard toggle listed in LAUNCH.md cutover).

**Magic-link rate limiting (migration 014 + vendor_respond v5)**
- Fixed-window per-IP counter (app.rl_hits + public.check_rate_limit,
  service-role-only), 30/min on the sole unauthenticated surface, counted
  BEFORE token lookup; hourly GC cron. Live test: exactly 30×404 then 5×429.

**Idempotency** — 81 notifications, 81 distinct dedupe keys, zero duplicates
across the entire dev history (RFQ sends, holds, bookings, releases, vouchers,
handovers, invoices, sweeps).

**Golden path #2 completed (counter-accepted)** — CF-2610: Northbridge sent
Corniche Deluxe King @22,000 negotiated → hotel countered Executive Twin →
booker accepted → booked the REVISED room at its own rate (21,000 base; the
original 22,000 correctly NOT carried over), total 42,000, invoice CI-1006 due
+30d from checkout (Sep 29 ✓), voucher PDF issued. All five golden paths now
machine-verified at least once in development.

**Launch artifacts**
- LAUNCH.md: cutover steps (Resend secrets, SMTP, auth template, APP_BASE_URL,
  ALLOWED_ORIGINS, WABA parallel track), supply-loading procedure, the 5-path
  production UAT table, and the owner's non-software gate.
- scripts/purge-test-data.sql: ordered purge of all (TEST)/.test entities;
  audit_log deliberately retained (append-only history).

**SOFTWARE COMPLETE M0–M8.** Remaining to go-live is operational: Resend
secrets, hosting, WABA, real supply + agreements, production UAT re-run,
pilot booking. All enumerated in LAUNCH.md.

---

## 2026-08-18 — Session 6 · Atlas redesign round 1 + verticals

**Page-by-page restart (owner unhappy with visual depth).** Process agreed:
design-first, 3 directions mocked (Ledger/Atlas/Terminal, kept under
web/public/mockups) → owner picked **B "Atlas"** (imagery-led, OTA-grade).
Results page rebuilt in Atlas: hero-image cards, floating ink rate chip with
brass YOUR RATE on negotiated, sage amenity pills, room panel with live-priced
package segments, 15-minute promise under every Select. Logic untouched.
Property page + remaining screens continue next rounds (tasks #1–#4).

**Verticals activated (owner decisions 2026-08-18):**
- **Rent-a-car = RFQ**, same machinery as hotels (owner corrected my
  instant-book suggestion). Migration 015: booking_files.service
  ('hotel'|'car'), package codes widened to [PV] with V1 self-drive /
  V2 with driver / V3 driver+fuel. Results/FileEditor service-aware
  (Vehicles/passengers/seats/per-day). E2E VERIFIED: CF-2612-KHI — Corolla V2
  11,000×2 days = 22,000 booked via send→accept→book, invoice CI-1007.
- **Transfers = both standalone + add-on.** Migrations 016/017:
  transfer_bookings (TF-{seq}-KHI), invoices.transfer_booking_id,
  public.book_transfer() atomic (rate resolve → booking → invoice dated from
  TRAVEL date → deposit drawdown → handover notification → audit), 
  ef_book_transfer endpoint, portal Transfers page (route cards at fixed
  prices, pickup/dropoff toggle, flight no, address). E2E VERIFIED:
  TF-501-KHI Airport↔Clifton 3,500, PK-301, invoice CI-1008.
- Seed: Karachi Executive Cars (TEST) — Corolla/Hiace with V-rates + 2 routes.
- Bug caught in verify: Results' usable-listing filter still hardcoded
  P-codes → 0 car matches; fixed to PKG_ORDER.

**Deferred (tracked in tasks):** transfer-as-add-on UI on hotel bookings ·
vehicle wording in voucher PDF (currently prints room-style labels for car
bookings) · ef_onboard_vendor still validates P-codes only (ops can't onboard
V rates via console yet; seeds/SQL meanwhile) · ops Money/Reservations don't
yet list transfer bookings.

**PROCESS & PRODUCT DECISIONS (owner, 2026-08-18)** — the working agreement:
- **Front-end first, wire in batches.** Every page is prototyped on mock data
  (clickable HTML under web/public/mockups/, also served on production at
  crlgtn.vercel.app/mockups/…), owner approves or redlines, then that batch is
  wired to the EXISTING backend (M0–M8 engine stays; nothing rebuilt).
- **Page inventory: 13 pages.** Corporate (8): sign-in · files home · new file
  · hotel listing ✅approved · car listing · property detail · file view/board
  · transfers+invoices. Vendor (1): magic-link respond. Ops (4): dashboard ·
  vendor onboarding · corporates/credit · money. Build order = the booker's
  journey first, vendor page next, ops last.
- **Listing card shows the FULL P1–P3 rate ladder** (owner decision after
  for/against argument): every package with per-night AND trip total on every
  card — the contracted-transparency OTAs can't offer — while one selected row
  drives a single big anchor price to keep 10-hotel scanning fast. Brass dot
  marks negotiated rows.
- **Prototype realism:** real Karachi hotel names across true corridors
  (PC/Mövenpick/Avari=Saddar, Carlton/Beach Luxury=Clifton-DHA,
  Regent/Mehran/Faran=SEF, Ramada/Airport Inn=Airport, SITE honestly empty);
  photos are licensed stock SAMPLES — real photography comes from the §12
  shot list at onboarding; these names must not appear client-facing before
  those hotels sign.
- Prototypes so far: corporate-listing.html (approved, incl. ladder + Karachi
  set) · credit-matrix.html (approved incl. cash-flow rule) · direction
  mockups a/b/c (Atlas "B" chosen as product-wide language).

**CREDIT DESIGN LOCKED (owner decisions 2026-08-18)** — prototype
/mockups/credit-matrix.html; wiring = task #7, after front-end sign-off:
- Corlington remains merchant of record. The matrix governs WHERE its credit
  applies (default-split clause shares risk with each hotel).
- Corporate tiers: A / B / C (three, deliberately). Tier = summary label;
  the fine credit profile stays per-corporate.
- Hotel tiers on the signed agreement: HT1 open (A+B+C) · HT2 standard (A+B)
  · HT3 selective (A) · HT4 prepaid-only. Independent of stars and B1-B5.
- Pair overrides (vendor × corporate, allow/deny) beat tier defaults;
  exceptions never become new tiers. Prepaid ≠ hidden: hotel stays in
  results with a prepay badge.
- THE CASH-FLOW RULE: hotels settled within 30 days of month-end; corporate
  ceilings BELOW it — A ≤ d20, B ≤ d15, C = on_checkout/d7, dated from
  checkout. Worst case = 10-day buffer. Corlington never finances the float.
  d30 corporate terms abolished (enum keeps d30 for legacy/test rows only;
  ceiling validation will refuse it; d20 to be added to credit_terms enum
  at wiring). New corporates start C, graduate on payment history.

## 2026-08-18 — Portal home + new booking file prototype (redesign task #2)

- Prototype `web/public/mockups/portal-home.html` shipped: portal HOME
  (greeting, 3 stat tiles, needs-your-decision row with live countdown,
  drafts, upcoming trips unified across hotel/rent-a-car/transfer with
  service tags + voucher links, past & closed with re-send) + NEW BOOKING
  FILE (3-service segmented entry — transfers jump out to instant flow;
  trip fields with car-aware labels; guest/passenger steppers; auto-accept
  toggle with plain-language warning; sticky dark spine live-summarizing
  the draft incl. 1-hour-urgent window rule; "Save & find …" continues to
  the approved listing prototype).
- **Owner redlines (2026-08-18): must-have amenity filters REMOVED from the
  new-file form for now** (chips existed on the earlier draft; amenity
  filtering stays available on the listing page sidebar, which is already
  approved). **Rent-a-car is NOT area-bound:** car mode hides the corridor
  chips and instead asks for a car CATEGORY — Sedan / SUV / Premium (class
  examples: Corolla-Civic / Fortuner-Prado / Mercedes-Audi). Spine shows
  the category; CTA flips to "Save & find cars". Wiring note for later:
  booking_files needs a car_category field (or reuse must_haves JSON) and
  car listings/V-packages should carry a category tag.

## 2026-08-18 — Parked-features register created (BACKLOG.md)

- Owner will keep dropping feature decisions mid-build that are NOT for
  immediate construction. New standing structure: **BACKLOG.md** is the parked
  -features queue — every such idea gets an F-### entry with a "Build when"
  trigger the moment it is spoken; sessions must check BACKLOG.md when they
  reach a trigger point. BUILD_LOG.md stays the decisions-of-record register.
- **F-001 recorded: booking countersign by official company email.** Before a
  booking is final, a confirmation email goes to the corporate's OFFICIAL
  address of record (set at onboarding, not the booker's login); the confirmer
  clicks and types their name + designation to countersign. Purpose: leaked
  booker credentials alone cannot commit the company (fraud guard). Built as a
  per-corporate toggle when the booking flow is wired; details in BACKLOG.md.

## 2026-08-18 — Vendor counter rule: card is the ceiling (owner decision)

- **Vendors can never counter with a HIGHER price.** The contracted rate card
  is a hard ceiling; counters may only (a) decrease a rate below the card, or
  (b) offer an ALTERNATE room category — which carries that category's own
  contracted card rate (a better room may cost more, but it is the pre-agreed
  price for a different product, clearly labeled — never an invented number).
  Rationale: protects the product promise ("the rate your company already
  negotiated") and, with first-to-accept-wins, price competition can only
  favor the client. Prototype sign-in.html vendor view enforces it: category
  chips from the card, decrease-only inputs that snap back to the ceiling,
  struck-through card rate when discounted.
- Server-side enforcement queued as **F-002 in BACKLOG.md** (ef_vendor_respond
  currently accepts arbitrary counter rates — must validate at wiring).

## 2026-08-18 — Fourth service: apartments & long stays (owner decision)

- Corlington will also offer **apartments (Airbnb-style / serviced) for longer
  commitments** — a fourth service line beside hotels, rent-a-car, transfers.
  Bookers see it as its own segment on the new-file screen (prototype updated
  same day): Move-in / Move-out labels, area chips apply (apartments ARE
  area-bound), type chips Studio / 1-Bed / 2-Bed / Serviced, spine shows
  ≈months for 30+ nights, decision window 24 hours (hosts confirm slower than
  front desks — prototype assumption, owner to confirm). RFQ flow like hotels.
- Backend/schema/rates design parked as **F-003 in BACKLOG.md** (monthly rate
  units, deposits, exit terms, host onboarding, voucher wording).

## 2026-08-18 — Redline: service segments carry no subtitles

- Owner: the new-file service buttons must not expose process mechanics or
  positioning — no "request up to 3 / offers in 15 min", no "monthly & long
  stays" (apartments serve 5–7 day bookings too), no "same request flow".
  Segments are now four plain labels: Hotels · Apartments · Rent-a-car ·
  Airport transfer. Apartment copy softened everywhere on the form:
  "Move-out" (no "earliest exit"), hint keeps serviced/verified only, monthly
  -rates mention dropped. The ≈months figure still appears in the spine, but
  only when the chosen dates are themselves 30+ nights.
