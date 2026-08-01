import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { opsOverrideAccept, ApiError } from '@/lib/api'
import { countdown, datePkt, dateTimePkt, pkrPlain } from '@/lib/format'
import { Button, Card, Input, Notice } from '@/components/ui'

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

      <LiveBoard />
      <Reservations />
    </div>
  )
}

/**
 * Live request board (spec §9): every open RFQ across all hotels, decision
 * windows, SLA flags, and the evidence-gated override. Polls every 10s.
 */
interface LiveFile {
  id: string
  ref: string
  name: string
  status: string
  window_expires_at: string
  corporates: { name: string } | null
}
interface LiveOffer {
  id: string
  booking_file_id: string
  priority: number
  status: string
  sla_flagged_at: string | null
  vendors: { name: string } | null
}

function LiveBoard() {
  const [files, setFiles] = useState<LiveFile[]>([])
  const [offers, setOffers] = useState<LiveOffer[]>([])
  const [now, setNow] = useState(Date.now())
  const [overrideFor, setOverrideFor] = useState<string | null>(null)
  const [waId, setWaId] = useState('')
  const [emailId, setEmailId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [f, o] = await Promise.all([
      supabase
        .from('booking_files')
        .select('id, ref, name, status, window_expires_at, corporates(name)')
        .in('status', ['requested', 'responded'])
        .order('window_expires_at'),
      supabase
        .from('rfq_offers')
        .select('id, booking_file_id, priority, status, sla_flagged_at, vendors(name)')
        .order('priority'),
    ])
    setFiles((f.data ?? []) as unknown as LiveFile[])
    setOffers((o.data ?? []) as unknown as LiveOffer[])
  }

  useEffect(() => {
    load()
    const poll = setInterval(load, 10000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  async function doOverride(offerId: string) {
    setBusy(true)
    setError(null)
    try {
      await opsOverrideAccept(offerId, { wa_msg_id: waId.trim(), email_msg_id: emailId.trim() })
      setOverrideFor(null)
      setWaId('')
      setEmailId('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Override failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Live request board" footer={
      <span className="text-xs text-ink/60">
        Override-accept needs the hotel's written confirmation on record — both the
        WhatsApp and email message ids.
      </span>
    }>
      {error && <div className="mb-3"><Notice tone="error">{error}</Notice></div>}
      {files.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink/40">No open requests right now.</p>
      ) : (
        <div className="space-y-3">
          {files.map((f) => {
            const remaining = new Date(f.window_expires_at).getTime() - now
            return (
              <div key={f.id} className="rounded-md border border-hairline p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular text-sm text-deep">{f.ref}</span>
                  <span className="text-sm">{f.corporates?.name}</span>
                  <span className="text-xs text-ink/50">· {f.name}</span>
                  <span
                    className={`tabular ml-auto rounded-md px-2 py-0.5 text-xs ${
                      remaining > 0 ? 'bg-brass/15 text-brass' : 'bg-ink/10 text-ink/50'
                    }`}
                  >
                    {remaining > 0 ? countdown(remaining) : 'expired'}
                  </span>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {offers
                    .filter((o) => o.booking_file_id === f.id)
                    .map((o) => (
                      <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="tabular text-xs text-ink/40">#{o.priority}</span>
                        <span>{o.vendors?.name}</span>
                        <span className="rounded-full bg-paper px-2 py-0.5 text-xs">
                          {o.status}
                        </span>
                        {o.sla_flagged_at && ['sent', 'viewed'].includes(o.status) && (
                          <span className="rounded-full bg-brass/15 px-2 py-0.5 text-xs text-brass">
                            quiet 10m+ — chase
                          </span>
                        )}
                        {['sent', 'viewed'].includes(o.status) && remaining > 0 && (
                          <button
                            type="button"
                            className="text-xs text-deep underline-offset-2 hover:underline"
                            onClick={() => setOverrideFor(overrideFor === o.id ? null : o.id)}
                          >
                            override-accept
                          </button>
                        )}
                        {overrideFor === o.id && (
                          <span className="flex w-full flex-wrap items-center gap-2 pl-6 pt-1">
                            <Input
                              className="!w-44"
                              placeholder="WhatsApp msg id"
                              value={waId}
                              onChange={(e) => setWaId(e.target.value)}
                            />
                            <Input
                              className="!w-44"
                              placeholder="Email msg id"
                              value={emailId}
                              onChange={(e) => setEmailId(e.target.value)}
                            />
                            <Button
                              type="button"
                              disabled={busy}
                              onClick={() => doOverride(o.id)}
                            >
                              {busy ? 'Recording…' : 'Accept for hotel'}
                            </Button>
                          </span>
                        )}
                      </li>
                    ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/** Central reservations view: every booking across every vendor (M5). */
interface ReservationRow {
  id: string
  status: string
  nights: number
  grand_total_pkr: number
  created_at: string
  vendors: { name: string } | null
  booking_files: {
    ref: string
    check_in: string
    check_out: string
    corporates: { name: string } | null
  } | null
}

function Reservations() {
  const [rows, setRows] = useState<ReservationRow[]>([])

  useEffect(() => {
    supabase
      .from('bookings')
      .select(
        'id, status, nights, grand_total_pkr, created_at, vendors(name), booking_files(ref, check_in, check_out, corporates(name))',
      )
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setRows((data ?? []) as unknown as ReservationRow[]))
  }, [])

  return (
    <Card title="Reservations">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink/40">No bookings yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink/50">
                <th className="py-2 pr-4 font-medium">Ref</th>
                <th className="py-2 pr-4 font-medium">Corporate</th>
                <th className="py-2 pr-4 font-medium">Hotel</th>
                <th className="py-2 pr-4 font-medium">Stay</th>
                <th className="py-2 pr-4 font-medium">Total (PKR)</th>
                <th className="py-2 font-medium">Booked</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((b) => (
                <tr key={b.id}>
                  <td className="tabular py-2 pr-4 text-xs">{b.booking_files?.ref}</td>
                  <td className="py-2 pr-4">{b.booking_files?.corporates?.name}</td>
                  <td className="py-2 pr-4">{b.vendors?.name}</td>
                  <td className="py-2 pr-4 text-ink/70">
                    {b.booking_files &&
                      `${datePkt(b.booking_files.check_in)} → ${datePkt(b.booking_files.check_out)}`}
                  </td>
                  <td className="tabular py-2 pr-4">{pkrPlain(b.grand_total_pkr)}</td>
                  <td className="py-2 text-xs text-ink/50">{dateTimePkt(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

