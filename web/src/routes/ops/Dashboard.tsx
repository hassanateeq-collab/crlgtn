import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui'

/**
 * The central ops dashboard — one place to see the whole platform.
 *
 * Today it shows supply and demand counts (M1 data). The reservations board —
 * every RFQ, hold and booking across all vendors with SLA timers — fills the
 * marked sections the moment those tables exist: offers at M4, bookings at M5,
 * money at M7. The layout reserves their place so the console grows into it
 * rather than being rearranged.
 */

interface Counts {
  vendorsLive: number
  vendorsTotal: number
  corporates: number
  corporateUsers: number
  roomsActive: number
  ratesBase: number
}

export function Dashboard() {
  const [counts, setCounts] = useState<Counts | null>(null)

  useEffect(() => {
    async function load() {
      const count = (table: string, filter?: (q: any) => any) => {
        let q = supabase.from(table).select('id', { count: 'exact', head: true })
        if (filter) q = filter(q)
        return q.then(({ count: c }: { count: number | null }) => c ?? 0)
      }
      const [vendorsLive, vendorsTotal, corporates, corporateUsers, roomsActive, ratesBase] =
        await Promise.all([
          count('vendors', (q) => q.eq('status', 'live')),
          count('vendors'),
          count('corporates'),
          count('corporate_users'),
          count('listings', (q) => q.eq('active', true)),
          count('listing_rates', (q) => q.is('corporate_id', null).is('valid_to', null)),
        ])
      setCounts({ vendorsLive, vendorsTotal, corporates, corporateUsers, roomsActive, ratesBase })
    }
    load()
  }, [])

  const stat = (label: string, value: number | string, to?: string) => (
    <div className="rounded-lg border border-hairline bg-white p-4">
      <div className="tabular text-2xl">{value}</div>
      {to ? (
        <Link to={to} className="text-xs text-deep hover:underline">{label}</Link>
      ) : (
        <div className="text-xs text-ink/60">{label}</div>
      )}
    </div>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-xl">Dashboard</h1>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/50">
          Supply & demand
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {stat('Live hotels', counts?.vendorsLive ?? '—', '/ops/vendors')}
          {stat('All vendors', counts?.vendorsTotal ?? '—', '/ops/vendors')}
          {stat('Bookable rooms', counts?.roomsActive ?? '—')}
          {stat('Base rates', counts?.ratesBase ?? '—')}
          {stat('Corporates', counts?.corporates ?? '—', '/ops/corporates')}
          {stat('Corporate users', counts?.corporateUsers ?? '—')}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Live request board" footer={
          <span className="text-xs text-ink/60">Activates at M4 — RFQ engine.</span>
        }>
          <p className="py-6 text-center text-sm text-ink/40">
            Every open RFQ across all hotels will appear here with decision-window
            countdowns and 10-minute SLA alerts.
          </p>
        </Card>
        <Card title="Reservations" footer={
          <span className="text-xs text-ink/60">Activates at M5 — bookings.</span>
        }>
          <p className="py-6 text-center text-sm text-ink/40">
            All bookings across all vendors in one place — filter by hotel, corporate,
            status and stay dates; check-ins and check-outs for today at the top.
          </p>
        </Card>
      </section>
    </div>
  )
}
