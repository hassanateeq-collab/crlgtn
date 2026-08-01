# Corlington — Launch Runbook

*Produced at M8. The software is done and verified on development data; this
file is what stands between that and a live pilot booking.*

## A. Software cutover (ops_admin + Supabase dashboard, ~1 hour)

1. **Email provider (blocks all outbound mail)**
   - Create a Resend account; verify the Corlington sending domain.
   - Supabase → Edge Functions → Secrets: set `RESEND_API_KEY`, `MAIL_FROM`
     (e.g. `Corlington <desk@corlington.pk>`).
   - Auth → SMTP: point auth email at the same provider (kills the 2/hr cap).
   - Auth → Email Templates → Magic Link: body must contain `{{ .Token }}`
     (six-digit code), not just the link.
   - Queued notifications drain automatically on the next send attempt; for
     the backlog, re-trigger via ef_issue_voucher / re-runs as needed.
2. **Frontend hosting**
   - Deploy `web/` (Vercel or equivalent). Set env `VITE_SUPABASE_URL`,
     `VITE_SUPABASE_PUBLISHABLE_KEY`.
   - Edge Function secrets: `APP_BASE_URL=https://<portal-domain>` (magic
     links are built from it) and `ALLOWED_ORIGINS=https://<portal-domain>`.
3. **WhatsApp (parallel track — do not block launch)**
   - Register the NEW Corlington WABA (own number, own display name — the
     Hamsun sender must never appear, spec §1). Submit templates for:
     vendor_rfq_wa, vendor_booked, vendor_released, vendor_lapsed,
     vendor_handover_wa. Until approval, ops forwards magic links manually
     from the notifications payloads (Money/board consoles show them).
4. **Purge test data**: run `scripts/purge-test-data.sql` (read its header),
   clear media/vouchers/agreements buckets from the dashboard.
5. **Auth hygiene**: dashboard → enable leaked-password protection (moot for
   OTP but silences the advisor); confirm signups remain DISABLED.
6. **Real accounts**: create ops staff via dashboard invite + set
   `app_metadata.role`; register their rows in ops_users. Onboard the pilot
   corporate through the console (credit profile per signed terms).

## B. Supply loading (ops console, per hotel ~15 min once materials exist)

Per launch hotel: profile + photos (fixed shot list) → rooms with P1–P3 rates
from the countersigned rate card → amenity checklist ticked ONLY as verified
at the onboarding visit → signed agreement PDF (digital + physical dates) →
status `live`. Negotiated per-corporate rates: insert via ops SQL for now
(Phase 2 tooling); base catalog covers launch.

## C. UAT — the five golden paths (run on production before the pilot)

All five passed on development data at M5–M8; re-run each on production with
two corporates and three real hotels. Every path must end with: correct board
state, voucher PDF with snapshot policies, invoice dated per terms, audit rows.

| # | Path | Steps | Pass condition |
|---|------|-------|----------------|
| 1 | Normal book | file → send 3 → hotel accepts → booker clicks Book | one booking; siblings released; voucher + invoice |
| 2 | Counter accepted | hotel counters alt room → booker books counter | booked at the ALT room's own rate |
| 3 | Auto-accept | file with auto-accept → first hotel accepts | booked with zero corporate clicks |
| 4 | Window expiry | send → nobody books → window lapses | offers expired, file `expired`, notices out |
| 5 | Ops override | hotel confirms verbally → ops override with BOTH msg ids | hold with evidence; without ids → refused |

Plus: cross-tenant probe (corporate B sees zero of A's rows), magic-link
rate-limit (31st request in a minute → 429), duplicate-send check (dedupe
keys unique).

## D. Non-software gate (owner)

- [ ] Vendor agreements signed — digital + physical — per launch hotel
- [ ] Photography + amenity audits completed per hotel
- [ ] Rate cards countersigned
- [ ] Pilot corporate credit profile approved and signed
- [ ] 24/7 ops rota staffed
- [ ] Meta template approvals confirmed (or manual-forward fallback accepted)
- [ ] Tax advisor sign-off on MOR/WHT (invoices carry a tax jsonb placeholder)
- [ ] B1–B5 price-bracket boundaries published internally
- [ ] Corporate fee amount published (waivers configured per corporate)

**Launch = all of C passing on production + a friendly pilot corporate
booking a real stay.**
