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
