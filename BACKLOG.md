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

## F-003 · Apartments & long-stay vertical (Airbnb-style / serviced)

**Decided:** 2026-08-18 (owner) · **Status:** parked (front-end segment already
live in portal-home prototype) · **Build when:** wiring the verticals batch —
after hotels/cars wire cleanly; schema questions below need owner answers first.

Fourth service: apartments for guests needing long commitments — monthly and
multi-month stays. Booker-facing entry exists (segment on the new booking file:
Move-in/Move-out, area chips, type Studio/1-Bed/2-Bed/Serviced, ≈months in
spine, 24-hour window assumption). To design at build time:
- `service` enum gains 'apartment'; A-packages? (e.g. A1 bare / A2 serviced /
  A3 serviced+utilities) mirroring P/V codes — package regex already widened
  once, widen to `^[PVA][1-9]$`.
- **Rate units:** nightly under 30 nights, monthly at/over? Pro-rating rule for
  6-week stays; deposits & notice period for early exit ("move-out — or
  earliest exit" wording already hints commitment vs exit).
- Vendor side: hosts/operators are NOT front desks — same magic-link respond
  page but 24-hour reply window (vs 15-min hotel promise); counter ceiling
  rule (F-002) applies identically via their contracted card.
- Credit matrix: do apartment operators join hotel tiers HT1–HT4 or default to
  prepaid/deposit? Long stays are big tickets — likely deposit-led (owner).
- Vouchers, invoices (monthly recurring?), settlement cadence for multi-month
  stays — one invoice per month per the cash-flow rule, never front the float.

## F-004 · Vendor anonymity until confirmation (anti-bypass)

**Proposed:** 2026-08-18 (Claude, from owner's disintermediation question) ·
**Status:** proposed — needs owner confirmation · **Build when:** wiring the
vendor respond page + voucher PDFs (vendor batch).

Vendors must never learn the corporate's identity before a confirmed booking:
RFQ/magic-link shows only "Corporate client via Corlington · tier X" (the
prototype already words it this way — make it a hard rule server-side, the
corporate name must not travel in any vendor-facing payload). On confirmation
the voucher carries guest names for check-in but NEVER booker/procurement
contacts — Corlington's own WhatsApp/phone is the only contact on every
vendor-facing artifact. Blocks the easy path to direct outreach.

## F-005 · Leakage analytics — pair-velocity alerts (anti-bypass)

**Proposed:** 2026-08-18 (Claude, from owner's disintermediation question) ·
**Status:** proposed — needs owner confirmation · **Build when:** ops console
wiring, after core money/board views.

Detect probable bypass from booking patterns: for each corporate × vendor pair,
alert ops when booking velocity drops sharply while the corporate's overall
volume holds (e.g. 5 bookings at Hotel X in 2 months, then zero for 6 weeks,
other corridors unchanged). Simple SQL over bookings; surfaces on the ops
dashboard as a "relationship check" flag for the account manager. Pairs with
the non-circumvention + rate-parity clauses in the hotel agreement (commercial
track, not code).

---

## Done / absorbed

*(empty — entries move here when built, with the commit/migration that absorbed them)*