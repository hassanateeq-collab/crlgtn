import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { pkrPlain, dateTimePkt } from '@/lib/format'
import { Card } from '@/components/ui'

/**
 * The response board (M4): live offer statuses for a sent file. Polls every
 * 5 seconds while the window is open — "reflects status within seconds"
 * without realtime plumbing. Booking actions attach at M5.
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

const statusTone: Record<string, string> = {
  sent: 'bg-paper text-ink/60 border border-hairline',
  viewed: 'bg-sage/70 text-deep',
  hold: 'bg-brass/15 text-brass',
  countered: 'bg-brass/15 text-brass',
  declined: 'bg-ink/10 text-ink/60',
  expired: 'bg-ink/10 text-ink/60',
  released: 'bg-ink/10 text-ink/60',
  booked: 'bg-pine text-paper',
}

const statusLine: Record<string, string> = {
  sent: 'Waiting for the hotel to open the request',
  viewed: 'Seen by the hotel — awaiting answer',
  hold: 'Room held for you until the window ends',
  countered: 'Hotel proposed an alternative',
  declined: 'Hotel declined this request',
  expired: 'Window ended before an answer',
  released: 'Released after another hotel was booked',
  booked: 'Booked',
}

export function OffersBoard({ fileId, windowOpen }: { fileId: string; windowOpen: boolean }) {
  const [offers, setOffers] = useState<BoardOffer[]>([])

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
    // Poll while the decision window is open; a settled file stays static.
    const timer = windowOpen ? setInterval(load, 5000) : null
    return () => {
      active = false
      if (timer) clearInterval(timer)
    }
  }, [fileId, windowOpen])

  if (offers.length === 0) return null

  return (
    <Card title="Offers">
      <ol className="divide-y divide-hairline">
        {offers.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-paper text-xs">
              {o.priority}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{o.vendors?.name}</span>
                <span className="text-xs text-ink/50">
                  {o.listings?.name} · {o.package_code} ·{' '}
                  <span className="tabular">PKR {pkrPlain(o.rate_pkr)}</span>/night
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink/50">
                {statusLine[o.status] ?? o.status}
                {o.responded_at && ` · ${dateTimePkt(o.responded_at)}`}
              </p>
              {o.status === 'countered' && o.counter?.note && (
                <p className="mt-1 rounded-md bg-brass/10 px-2 py-1 text-xs text-ink">
                  “{o.counter.note}”
                </p>
              )}
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs ${statusTone[o.status] ?? ''}`}>
              {o.status === 'hold' ? 'on hold' : o.status}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
