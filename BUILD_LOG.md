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
