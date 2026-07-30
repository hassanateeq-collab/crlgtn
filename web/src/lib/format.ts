/**
 * Formatting rules from the dev plan §0, in one place so no screen invents its
 * own: money is integer PKR, timestamps are stored UTC and rendered Asia/Karachi.
 */

const PKT = 'Asia/Karachi'

/**
 * Rupees, never paisa. The database stores integer PKR, so a fractional value
 * here means something upstream used a float — which the plan forbids.
 */
export function pkr(amount: number): string {
  if (!Number.isInteger(amount)) {
    console.warn('pkr() received a non-integer; money must be integer PKR', amount)
  }
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** Bare grouped digits, for table cells where the column header carries "PKR". */
export function pkrPlain(amount: number): string {
  return new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(amount)
}

/** e.g. "30 Jul 2026, 6:12 pm" — always Karachi time, whatever the browser. */
export function dateTimePkt(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PKT,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

/** e.g. "30 Jul 2026" — for check-in/check-out, which are dates not instants. */
export function datePkt(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PKT,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

/**
 * Countdown for the decision window (spec §2). Returns "1:23:45" or "12:04".
 * Clamps at zero rather than going negative: an expired window reads "0:00",
 * and the server's expire sweep — not the browser clock — decides what expiry
 * actually means.
 */
export function countdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}
