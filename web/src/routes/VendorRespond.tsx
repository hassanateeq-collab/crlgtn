import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { vendorRespond, ApiError, type VendorOfferView } from '@/lib/api'
import { countdown, datePkt, pkrPlain } from '@/lib/format'
import { Button, Notice } from '@/components/ui'

/**
 * The vendor magic-link page (M4) — the only screen a hotel sees in MVP.
 * No login: the URL token is the credential. Three actions, one answer.
 */

export function VendorRespond() {
  const { token = '' } = useParams()
  const [offer, setOffer] = useState<VendorOfferView | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [showCounter, setShowCounter] = useState(false)
  const [counterListing, setCounterListing] = useState('')
  const [counterNote, setCounterNote] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    vendorRespond(token, 'view')
      .then(setOffer)
      .catch((e: unknown) =>
        setError(
          e instanceof ApiError
            ? { code: e.code, message: e.message }
            : { code: 'unknown', message: 'Something went wrong' },
        ),
      )
  }, [token])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const remaining = useMemo(
    () => (offer ? new Date(offer.window_expires_at).getTime() - now : 0),
    [offer, now],
  )
  const open = offer && ['sent', 'viewed'].includes(offer.status) && remaining > 0

  async function act(action: 'accept' | 'counter' | 'decline') {
    setBusy(true)
    setError(null)
    try {
      const next = await vendorRespond(
        token,
        action,
        action === 'counter'
          ? { listing_id: counterListing || undefined, note: counterNote || undefined }
          : undefined,
      )
      setOffer((o) => ({ ...o!, ...next }))
      setShowCounter(false)
    } catch (e: unknown) {
      if (e instanceof ApiError) setError({ code: e.code, message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-svh items-start justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2">
          <span aria-hidden className="size-1.5 rounded-full bg-brass" />
          <span className="font-display text-lg">Corlington</span>
          <span className="text-xs text-ink/50">hotel response</span>
        </div>
        {children}
      </div>
    </main>
  )

  if (error && !offer) {
    return shell(
      <Notice tone="error">
        {error.code === 'not_found'
          ? 'This link is not valid. If you received it recently, contact the Corlington desk.'
          : error.message}
      </Notice>,
    )
  }
  if (!offer) return shell(<p className="text-sm text-ink/50">Loading request…</p>)

  const answered = ['hold', 'countered', 'declined', 'booked'].includes(offer.status)

  return shell(
    <div className="space-y-5">
      <section className="rounded-lg border border-hairline bg-white">
        <header className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="tabular text-sm text-deep">{offer.ref}</span>
          {open && (
            <span className="tabular rounded-md bg-brass/15 px-2 py-1 text-sm text-brass">
              {countdown(remaining)} left
            </span>
          )}
        </header>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-sm">
          <div className="col-span-2">
            <dt className="text-xs text-ink/50">Requested room</dt>
            <dd className="font-medium">
              {offer.room}
              {offer.bed_config && <span className="text-ink/60"> · {offer.bed_config}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Stay</dt>
            <dd>
              {datePkt(offer.check_in)} → {datePkt(offer.check_out)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Rooms</dt>
            <dd>
              {offer.rooms.length} ({offer.rooms.map((r) => r.guests).join('+')} guests)
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Package</dt>
            <dd>{offer.package_code}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink/50">Contracted rate</dt>
            <dd className="tabular">PKR {pkrPlain(offer.rate_pkr)} / night</dd>
          </div>
        </dl>
      </section>

      {error && <Notice tone="error">{error.message}</Notice>}

      {answered ? (
        <Notice>
          {offer.status === 'booked' &&
            'Accepted and booked — this request had instant booking on. Guest details follow before check-in.'}
          {offer.status === 'hold' &&
            'Accepted. The rooms are on hold — we will confirm or release them when the corporate decides, before the window ends.'}
          {offer.status === 'countered' &&
            'Counter sent. The corporate can book your proposal directly; we will notify you either way.'}
          {offer.status === 'declined' && 'Declined. Thank you for the quick answer.'}
        </Notice>
      ) : !open ? (
        <Notice tone="error">
          The decision window has ended and this request has lapsed. Nothing further is
          needed from your side.
        </Notice>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Button disabled={busy} onClick={() => act('accept')}>
              Accept
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              aria-expanded={showCounter}
              onClick={() => setShowCounter((s) => !s)}
            >
              Counter
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => act('decline')}>
              Decline
            </Button>
          </div>
          <p className="text-xs text-ink/50">
            Accepting places a binding hold on the rooms until the corporate books or the
            window expires — whichever comes first.
          </p>

          {showCounter && (
            <div className="space-y-2 rounded-lg border border-hairline bg-white p-3">
              <label className="block text-xs text-ink/60">
                Offer a different room (optional)
                <select
                  className="mt-1 w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm"
                  value={counterListing}
                  onChange={(e) => setCounterListing(e.target.value)}
                >
                  <option value="">Same room type</option>
                  {(offer.alternates ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.bed_config ? ` · ${a.bed_config}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-ink/60">
                Note to the corporate
                <textarea
                  className="mt-1 min-h-16 w-full rounded-md border border-hairline bg-white px-2 py-1.5 text-sm"
                  placeholder="e.g. Twin sold out those dates; can offer Deluxe King at the same rate."
                  value={counterNote}
                  onChange={(e) => setCounterNote(e.target.value)}
                />
              </label>
              <Button
                disabled={busy || (!counterListing && !counterNote.trim())}
                onClick={() => act('counter')}
              >
                Send counter
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-ink/40">
        Questions? The Corlington desk is available 24/7.
      </p>
    </div>,
  )
}
