import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity'
import { PageHead, ACard, Chip, Stat, Notice } from '@/components/atlas'
import { PKG_LABEL } from '@/lib/onboarding'
import { pkr, datePkt, countdown } from '@/lib/format'

/**
 * Vendor overview — read-only by design. Answering a request happens through
 * the magic link sent to the whole front office (first answer counts); this
 * page shows the same clock so the desk can see what's waiting.
 *
 * Every query below runs under the vendor-scoped RLS from migrations 022–023:
 * offers/bookings for this vendor only, booking files only where engaged,
 * traveler names only where booked. The corporate behind a file is never
 * resolvable — files carry a ref, dates and rooms, nothing else.
 */

interface OfferRow {
  id: string
  booking_file_id: string
  listing_id: string
  package_code: string
  rate_pkr: number
  status: string
  sent_at: string
  token_expires_at: string | null
}
interface FileRow {
  id: string
  ref: string
  check_in: string
  check_out: string
  rooms: { guests: number }[]
  status: string
}
interface BookingRow {
  id: string
  booking_file_id: string
  rfq_offer_id: string
  status: string
  nights: number
  room_total_pkr: number
  grand_total_pkr: number
}

const OPEN_STATUSES = ['sent', 'viewed', 'countered']

export function VendorOverview() {
  const { identity } = useIdentity()
  const [offers, setOffers] = useState<OfferRow[]>([])
  const [files, setFiles] = useState<Map<string, FileRow>>(new Map())
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [listingNames, setListingNames] = useState<Map<string, string>>(new Map())
  const [guests, setGuests] = useState<Map<string, string[]>>(new Map())
  const [vouchers, setVouchers] = useState<Map<string, string>>(new Map())
  const [settlementStatus, setSettlementStatus] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      // token_hash / ops_evidence are column-revoked for signed-in users, so
      // the select list must stay explicit — `*` would fail the whole query.
      const [{ data: offerRows }, { data: bookingRows }, { data: listings }] = await Promise.all([
        supabase
          .from('rfq_offers')
          .select('id, booking_file_id, listing_id, package_code, rate_pkr, status, sent_at, token_expires_at')
          .order('sent_at', { ascending: false })
          .limit(120),
        supabase
          .from('bookings')
          .select('id, booking_file_id, rfq_offer_id, status, nights, room_total_pkr, grand_total_pkr')
          .order('created_at', { ascending: false })
          .limit(120),
        supabase.from('listings').select('id, name'),
        supabase.from('settlements').select('period, status').then(({ data }) => {
          if (!cancelled) setSettlementStatus(new Map((data ?? []).map((s) => [s.period, s.status as string])))
        }),
      ])
      if (cancelled) return

      const fileIds = [
        ...new Set([
          ...(offerRows ?? []).map((o) => o.booking_file_id),
          ...(bookingRows ?? []).map((b) => b.booking_file_id),
        ]),
      ]
      const bookedFileIds = (bookingRows ?? []).map((b) => b.booking_file_id)
      const bookingIds = (bookingRows ?? []).map((b) => b.id)

      const [{ data: fileRows }, { data: travelerRows }, { data: voucherRows }] = await Promise.all([
        fileIds.length
          ? supabase.from('booking_files').select('id, ref, check_in, check_out, rooms, status').in('id', fileIds)
          : Promise.resolve({ data: [] as FileRow[] }),
        bookedFileIds.length
          ? supabase.from('travelers').select('booking_file_id, name').in('booking_file_id', bookedFileIds)
          : Promise.resolve({ data: [] as { booking_file_id: string; name: string }[] }),
        bookingIds.length
          ? supabase.from('vouchers').select('booking_id, ref').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as { booking_id: string; ref: string }[] }),
      ])
      if (cancelled) return

      setOffers((offerRows ?? []) as OfferRow[])
      setBookings((bookingRows ?? []) as BookingRow[])
      setListingNames(new Map((listings ?? []).map((l) => [l.id, l.name])))
      setFiles(new Map(((fileRows ?? []) as FileRow[]).map((f) => [f.id, f])))
      const g = new Map<string, string[]>()
      for (const t of travelerRows ?? []) {
        g.set(t.booking_file_id, [...(g.get(t.booking_file_id) ?? []), t.name])
      }
      setGuests(g)
      setVouchers(new Map((voucherRows ?? []).map((v) => [v.booking_id, v.ref])))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const todayIso = new Date(now).toISOString().slice(0, 10)

  const open = useMemo(
    () =>
      offers.filter(
        (o) =>
          OPEN_STATUSES.includes(o.status) &&
          (!o.token_expires_at || new Date(o.token_expires_at).getTime() > now),
      ),
    [offers, now],
  )

  const confirmed = useMemo(
    () => bookings.filter((b) => ['confirmed', 'checked_in', 'checked_out'].includes(b.status)),
    [bookings],
  )
  const upcoming = useMemo(
    () =>
      confirmed
        .filter((b) => (files.get(b.booking_file_id)?.check_out ?? '') >= todayIso)
        .sort((a, b) =>
          (files.get(a.booking_file_id)?.check_in ?? '').localeCompare(
            files.get(b.booking_file_id)?.check_in ?? '',
          ),
        ),
    [confirmed, files, todayIso],
  )
  const past = useMemo(
    () => confirmed.filter((b) => (files.get(b.booking_file_id)?.check_out ?? '') < todayIso),
    [confirmed, files, todayIso],
  )

  const weekAhead = new Date(now + 7 * 86400_000).toISOString().slice(0, 10)
  const arrivalsThisWeek = upcoming.filter((b) => {
    const ci = files.get(b.booking_file_id)?.check_in ?? ''
    return ci >= todayIso && ci <= weekAhead
  }).length

  if (loading) {
    return <p className="py-16 text-center text-sm text-ink/50">Loading your desk…</p>
  }

  return (
    <>
      <PageHead
        eyebrow={identity?.vendor?.name ?? 'Vendor'}
        title="Front-office overview"
        sub="Requests are answered from the link sent to your team — the first answer counts. This page is your standing view."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Needs an answer" value={open.length} tone={open.length ? 'hot' : 'ink'} hint="live request windows" />
        <Stat label="Arrivals this week" value={arrivalsThisWeek} hint="next 7 days" />
        <Stat label="Upcoming stays" value={upcoming.length} hint="confirmed, not yet checked out" />
        <Stat label="Completed stays" value={past.length} hint="all time" />
      </div>

      {open.length > 0 && (
        <ACard
          title="Needs an answer"
          sub="Open the link from your WhatsApp or email to accept, offer another room, or decline."
          className="mb-6"
        >
          <ul className="divide-y divide-hairline">
            {open.map((o) => {
              const f = files.get(o.booking_file_id)
              const msLeft = o.token_expires_at ? new Date(o.token_expires_at).getTime() - now : 0
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold">
                      {f?.ref ?? 'Request'} · {listingNames.get(o.listing_id) ?? 'Room'}
                    </div>
                    <div className="text-[12.5px] text-ink/55">
                      {f ? `${datePkt(f.check_in)} → ${datePkt(f.check_out)} · ${f.rooms.length} room(s)` : ''}
                      {' · '}
                      {PKG_LABEL[o.package_code] ?? o.package_code} · {pkr(o.rate_pkr)}/night
                    </div>
                  </div>
                  <Chip tone={o.status === 'countered' ? 'wait' : 'hot'}>
                    {o.status === 'countered' ? 'alternate offered' : `answer in ${countdown(msLeft)}`}
                  </Chip>
                </li>
              )
            })}
          </ul>
        </ACard>
      )}

      <ACard
        title="Upcoming arrivals"
        sub="Guest names appear once a stay is confirmed. Bill the stay to Corlington — never to the guest."
        className="mb-6"
      >
        {upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">No confirmed stays ahead. New requests arrive by WhatsApp and email.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {upcoming.map((b) => {
              const f = files.get(b.booking_file_id)
              const names = guests.get(b.booking_file_id) ?? []
              const offer = offers.find((o) => o.id === b.rfq_offer_id)
              const arrivesToday = f?.check_in === todayIso
              return (
                <li key={b.id} className="py-3.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                        {f?.ref ?? 'Stay'}
                        {vouchers.get(b.id) && (
                          <span className="font-mono text-[11.5px] font-normal text-ink/45">voucher {vouchers.get(b.id)}</span>
                        )}
                        {arrivesToday && <Chip tone="hot">arrives today</Chip>}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-ink/55">
                        {f ? `${datePkt(f.check_in)} → ${datePkt(f.check_out)}` : ''} · {b.nights} night(s) ·{' '}
                        {f?.rooms.length ?? 1} room(s)
                        {offer && ` · ${listingNames.get(offer.listing_id) ?? ''}`}
                      </div>
                      {names.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {names.map((n) => (
                            <span key={n} className="rounded-full bg-sage px-2.5 py-0.5 text-[11.5px] font-semibold text-deep">
                              {n}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-display text-[16px] font-semibold text-deep">{pkr(b.grand_total_pkr)}</div>
                      <div className="text-[11px] text-ink/45">whole stay</div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </ACard>

      <ACard title="Recent stays" sub="Completed stays roll into your monthly settlement." className="mb-6">
        {past.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">Nothing completed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink/50">
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Dates</th>
                  <th className="py-2 pr-4">Nights</th>
                  <th className="py-2 pr-4">Payment</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {past.slice(0, 10).map((b) => {
                  const f = files.get(b.booking_file_id)
                  // Completed stays also carry their money state, from the
                  // statement of the check-out month.
                  const stmt = f ? settlementStatus.get(f.check_out.slice(0, 7)) : undefined
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 pr-4 font-semibold">{f?.ref ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-ink/60">
                        {f ? `${datePkt(f.check_in)} → ${datePkt(f.check_out)}` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-ink/60">{b.nights}</td>
                      <td className="py-2.5 pr-4">
                        {stmt === 'paid' ? (
                          <Chip tone="ok">paid</Chip>
                        ) : stmt === 'approved' ? (
                          <Chip tone="hot">payment on the way</Chip>
                        ) : stmt === 'draft' ? (
                          <Chip tone="wait">statement in preparation</Chip>
                        ) : (
                          <span className="text-[12px] text-ink/40">next statement</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-deep">{pkr(b.grand_total_pkr)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ACard>

      <Notice tone="info">
        Guests booked through Corlington are billed to Corlington — the stay, the taxes, the agreed
        inclusions. Anything the guest orders personally is settled by the guest at checkout.
      </Notice>
    </>
  )
}
