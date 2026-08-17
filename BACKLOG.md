# Corlington — Parked features register

Owner-decided features that are **not** scheduled for the current build, recorded
here so nothing is lost. Rules of this file:

- Every entry gets an ID (`F-###`), the decision date, and — most importantly —
  **"Build when"**: the exact moment in the roadmap where this must be picked up.
- When a session reaches a "Build when" trigger, check this file FIRST, build the
  feature (or consciously defer it with a note here), and move the entry to the
  "Done / absorbed" section at the bottom.
- Decisions of record still live in BUILD_LOG.md; this file is the working queue.
  BUILD_LOG links here; new owner ideas dropped mid-session get appended here in
  the same session they are spoken.

---

## F-001 · Booking countersign by official company email (anti-fraud)

**Decided:** 2026-08-18 (owner) · **Status:** parked · **Build when:** wiring the
booking flow to the backend (portal batch), as a per-corporate toggle.

Before a corporate booking is final, a confirmation email is sent to the
**official company email address** submitted at onboarding (a corporate-level
address of record — NOT the booker's own login email). The email carries a
confirm link; the landing page requires the confirmer to **type their name and
designation** to countersign the booking. Only then is the booking confirmed on
the corporate's side.

**Why:** a leaked booker ID/password alone must not be enough to commit the
company to spend. The countersign proves someone at the official address —
outside the possibly-compromised session — approved it, and the typed
name + designation creates an accountability record.

**Implementation notes (for when it's built):**
- Reuses the existing magic-link machinery (32-byte token, sha-256 at rest,
  single-use guarded transitions, rate limiting) — same pattern as ef_vendor_respond.
- `corporates` needs an `official_email` (address of record, set at onboarding,
  changeable only by ops). Per-corporate enable flag — "we will use it whenever
  we need it" — so default off, switched on per client, possibly with an
  amount threshold later.
- Booking gains a countersign state (e.g. `awaiting_countersign` before
  `confirmed`), plus `countersigned_by_name`, `countersigned_designation`,
  timestamp; all captured in the audit log and snapshotted on the voucher.
- Voucher issue / vendor notification waits for the countersign when the flag
  is on; SLA/expiry sweep needs a matching timeout rule (what happens if no
  one countersigns — owner to decide at build time).

---

## Done / absorbed

*(empty — entries move here when built, with the commit/migration that absorbed them)*

## F-002 · Enforce the counter ceiling in ef_vendor_respond

**Decided:** 2026-08-18 (owner) · **Status:** parked · **Build when:** wiring the
vendor respond page (vendor batch) — MUST land before any real vendor pilot.

The UI rule (see BUILD_LOG 2026-08-18) needs its server-side twin, because the
magic-link endpoint can be called directly. `ef_vendor_respond` must validate
counters: (a) each countered nightly rate ≤ the contracted card rate for the
offered category/package (from listing_rates), reject above-card with a clear
error; (b) an alternate category is only valid if it exists on that vendor's
contracted catalog, and it arrives priced at ≤ its own card rate; (c) audit-log
the card rate alongside the countered rate so discounts are measurable.
Currently the function accepts arbitrary counter amounts — do not pilot vendors
before this lands.
