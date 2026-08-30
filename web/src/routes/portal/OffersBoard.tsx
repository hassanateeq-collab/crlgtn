import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { bookOffer, ApiError } from '@/lib/api'
import { useIdentity } from '@/lib/identity'
import { pkrPlain, dateTimePkt } from '@/lib/format'
import { PKG_LABEL } from '@/lib/onboarding'
import { ABtn, Chip, Notice } from '@/components/atlas'

/**
 * The offers board (Atlas): live offer statuses for a sent file, polling every
 * 5 seconds while the window is open. Booking goes through ef_book_offer —
 * one atomic transaction that books, releases siblings, and raises the invoice.
 *
 * NOTE the explicit column list: token_hash and ops_evidence are revoked at
 * the column level for corporate roles, so a `select *` here would 403.
 */

interface BoardOffer {
  id: string
  package_code: string
  rate_pkr: number
  priority: number
  status: string
  sent_at: string
  viewed_at: string | null
  responded_at: string | null
  counter: { listing_id: string | null; note: string | null } | null
  vendors: { name: string } | null
  listings: { name: string } | null
}

const tone: Record<string, 'ok' | 'hot' | 'wait' | 'bad' | 'ink'> = {
  sent: 'wait',
  viewed: 'wait',
  hold: 'hot',
  countered: 'hot',
  declined: 'wait',
  expired: 'wait',
  released: 'wait',
  booked: 'ok',
}

const statusLine: Record<string, string> = {
  sent: 'Waiting for the hotel to open the request',
  viewed: 'Seen by the hotel — awaiting answer',
  hold: 'Rooms held for you until the window ends',
  countered: 'The hotel proposed an alternative',
  declined: 'Hotel declined this request',
  expired: 'Window ended before an answer',
  released: 'Released after another hotel was booked',
  booked: 'Booked — voucher issued',
}

export function OffersBoard({
  fileId,
  windowOpen,
  nights,
  roomsCount,
  onBooked,
}: {
  fileId: string
  windowOpen: boolean
  nights: number | null
  roomsCount: number
  onBooked?: () => void
}) {
  const [offers, setOffers] = useState<BoardOffer[]>([])
  const { identity } = useIdentity()
  const [bookingId, setBookingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canBook =
    identity?.corporateRole === 'corp_booker' || identity?.corporateRole === 'corp_admin'

  async function book(offerId: string) {
    setBookingId(offerId)
    setError(null)
    try {
      await bookOffer(offerId)
      onBooked?.()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Booking failed')
    } finally {
      setBookingId(null)
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      const { data } = await supabase
        .from('rfq_offers')
        .select(
          'id, package_code, rate_pkr, priority, status, sent_at, viewed_at, responded_at, counter, vendors(name), listings(name)',
        )
        .eq('booking_file_id', fileId)
        .order('priority')
      if (active && data) setOffers(data as unknown as BoardOffer[])
    }
    load()
    const timer = windowOpen ? setInterval(load, 5000) : null
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [fileId, windowOpen])

  if (offers.length === 0) return null

  const actionable = (s: string) => windowOpen && ['hold', 'countered'].includes(s)

  return (
    <section>
      <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink/55">Offers</div>
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <div className="space-y-3">
        {offers.map((o) => {
          const stayTotal = nights ? o.rate_pkr * nights * roomsCount : null
          const best = actionable(o.status)
          return (
            <article
              key={o.id}
              className={`rounded-[20px] bg-white p-4 shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)] ${
                o.status === 'booked' ? 'ring-2 ring-pine' : ''
              }`}
            >
              <div className="flex flex-wrap items-start gap-4">
                <span className="tabular grid size-7 flex-none place-items-center rounded-full bg-paper text-xs font-semibold text-ink/60">
                  {o.priority}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[16px] font-semibold">{o.vendors?.name}</span>
                    <Chip tone={tone[o.status] ?? 'wait'}>
                      {o.status === 'hold' ? 'accepted — on hold' : o.status}
                    </Chip>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-ink/55">
                    {o.listings?.name} · {PKG_LABEL[o.package_code] ?? o.package_code}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink/55">
                    {statusLine[o.status] ?? o.status}
                    {o.responded_at && ` · ${dateTimePkt(o.responded_at)}`}
                  </p>
                  {o.status === 'countered' && o.counter?.note && (
                    <p className="mt-2 rounded-xl bg-[#FBF3E2] px-3 py-2 text-[12.5px] text-ink">
                      “{o.counter.note}”
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="font-display text-[20px] font-semibold leading-tight text-deep">
                      PKR {pkrPlain(o.rate_pkr)}
                    </div>
                    <div className="text-[11px] text-ink/50">
                      per night
                      {stayTotal ? ` · ≈ PKR ${pkrPlain(stayTotal)} whole stay` : ''}
                    </div>
                  </div>
                  {canBook && best && (
                    <ABtn disabled={bookingId !== null} onClick={() => book(o.id)}>
                      {bookingId === o.id
                        ? 'Booking…'
                        : o.status === 'countered'
                          ? 'Accept counter & book'
                          : `Book ${o.vendors?.name?.split(' ')[0] ?? ''}`}
                    </ABtn>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>
      {windowOpen && (
        <p className="mt-3 text-[12.5px] text-ink/55">
          Book one and the other holds release automatically — no call needed.
        </p>
      )}
    </section>
  )
}
