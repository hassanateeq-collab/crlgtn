import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { bookTransfer, ApiError, type TransferResult } from '@/lib/api'
import { dateTimePkt, pkrPlain } from '@/lib/format'
import { Button, Card, Field, Input, Notice } from '@/components/ui'

/**
 * Airport transfers (owner decision 2026-08-18): standalone instant booking at
 * fixed contracted route prices — no RFQ, no window. Attaching a transfer to a
 * hotel booking (add-on mode) ships in a later pass.
 */

interface Route {
  id: string
  name: string
  description: string | null
  max_occupancy: number
  vendor_id: string
  vendors: { name: string } | null
  price: number | null
  negotiated: boolean
}

interface MyTransfer {
  id: string
  ref: string
  direction: string
  travel_at: string
  flight_no: string | null
  passengers: number
  price_pkr: number
  status: string
  listings: { name: string } | null
}

export function Transfers() {
  const [routes, setRoutes] = useState<Route[]>([])
  const [mine, setMine] = useState<MyTransfer[]>([])
  const [routeId, setRouteId] = useState('')
  const [direction, setDirection] = useState<'pickup' | 'dropoff'>('pickup')
  const [travelAt, setTravelAt] = useState('')
  const [flightNo, setFlightNo] = useState('')
  const [passengers, setPassengers] = useState(1)
  const [point, setPoint] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<TransferResult | null>(null)

  async function load() {
    const [ls, rates, my] = await Promise.all([
      supabase
        .from('listings')
        .select('id, name, description, max_occupancy, vendor_id, vendors(name)')
        .eq('listing_type', 'transfer_route')
        .eq('active', true)
        .order('name'),
      supabase
        .from('listing_rates')
        .select('listing_id, rate_pkr, corporate_id')
        .eq('package_code', 'V2')
        .is('valid_to', null),
      supabase
        .from('transfer_bookings')
        .select('id, ref, direction, travel_at, flight_no, passengers, price_pkr, status, listings(name)')
        .order('travel_at', { ascending: false })
        .limit(20),
    ])
    const routeRows = ((ls.data ?? []) as unknown as Omit<Route, 'price' | 'negotiated'>[]).map(
      (r) => {
        const mineRate = (rates.data ?? []).find(
          (x) => x.listing_id === r.id && x.corporate_id !== null,
        )
        const base = (rates.data ?? []).find(
          (x) => x.listing_id === r.id && x.corporate_id === null,
        )
        return {
          ...r,
          price: mineRate?.rate_pkr ?? base?.rate_pkr ?? null,
          negotiated: !!mineRate,
        }
      },
    )
    setRoutes(routeRows.filter((r) => r.price !== null))
    setMine((my.data ?? []) as unknown as MyTransfer[])
  }

  useEffect(() => {
    load()
  }, [])

  const route = routes.find((r) => r.id === routeId) ?? null

  async function book(e: FormEvent) {
    e.preventDefault()
    if (!route) return
    setBusy(true)
    setError(null)
    try {
      const result = await bookTransfer({
        listing_id: route.id,
        direction,
        travel_at: new Date(travelAt).toISOString(),
        flight_no: flightNo.trim() || undefined,
        passengers,
        ...(direction === 'pickup'
          ? { dropoff_point: point.trim() || undefined }
          : { pickup_point: point.trim() || undefined }),
      })
      setDone(result)
      setTravelAt('')
      setFlightNo('')
      setPoint('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Booking failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Airport transfers</h1>
        <p className="mt-1 text-sm text-ink/60">
          Fixed contracted prices, booked instantly — a car is assigned the moment you confirm.
        </p>
      </div>

      {done && (
        <Notice>
          Booked — <span className="tabular">{done.ref}</span> · {done.route} ·{' '}
          <span className="tabular">PKR {pkrPlain(done.price_pkr)}</span> · invoice{' '}
          <span className="tabular">{done.invoice_number}</span>
          {done.invoice_status === 'paid' ? ' (settled from deposit)' : ''}. The operator has
          been handed your details.
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Route cards */}
        <div className="space-y-4">
          {routes.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRouteId(r.id)}
              className={`block w-full overflow-hidden rounded-2xl bg-white text-left shadow-[0_1px_2px_rgba(20,36,31,.06),0_10px_28px_-14px_rgba(20,36,31,.2)] transition ${
                routeId === r.id ? 'ring-2 ring-pine' : 'hover:shadow-lg'
              }`}
            >
              <div className="relative h-2 bg-gradient-to-r from-deep via-pine to-brass" />
              <div className="flex items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-lg font-bold">{r.name}</div>
                  <div className="mt-0.5 text-xs text-ink/55">
                    {r.vendors?.name} · sedan · up to {r.max_occupancy} passengers
                    {r.description ? ` · ${r.description}` : ''}
                  </div>
                </div>
                <div className="shrink-0 rounded-xl bg-ink px-4 py-2.5 text-right text-white">
                  {r.negotiated && (
                    <div className="font-mono text-[8.5px] font-semibold uppercase tracking-[.15em] text-[#e8c789]">
                      Your rate
                    </div>
                  )}
                  <div className="font-display text-lg font-bold leading-tight">
                    PKR {pkrPlain(r.price!)}
                  </div>
                  <div className="text-[10px] opacity-70">per car, fixed</div>
                </div>
              </div>
            </button>
          ))}
          {routes.length === 0 && (
            <p className="rounded-2xl border border-dashed border-hairline p-10 text-center text-sm text-ink/50">
              No transfer routes are live yet.
            </p>
          )}
        </div>

        {/* Booking form */}
        <Card title={route ? `Book — ${route.name}` : 'Book a transfer'}>
          <form onSubmit={book} className="space-y-4">
            <div className="flex rounded-xl bg-paper p-1">
              {(['pickup', 'dropoff'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`flex-1 rounded-lg py-2 text-xs font-semibold ${
                    direction === d
                      ? 'bg-white text-deep shadow-[0_1px_3px_rgba(20,36,31,.12)]'
                      : 'text-ink/50'
                  }`}
                  onClick={() => setDirection(d)}
                >
                  {d === 'pickup' ? 'Airport pick-up' : 'Drop-off to airport'}
                </button>
              ))}
            </div>
            <Field label={direction === 'pickup' ? 'Flight lands at' : 'Pick up at'}>
              <Input
                type="datetime-local"
                required
                value={travelAt}
                onChange={(e) => setTravelAt(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Flight no. (optional)">
                <Input
                  placeholder="PK-301"
                  value={flightNo}
                  onChange={(e) => setFlightNo(e.target.value)}
                />
              </Field>
              <Field label="Passengers">
                <Input
                  type="number"
                  min={1}
                  max={route?.max_occupancy ?? 4}
                  value={passengers}
                  onChange={(e) => setPassengers(Number(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label={direction === 'pickup' ? 'Drop-off address' : 'Pick-up address'}
              hint="Hotel or office — the driver gets this with the handover"
            >
              <Input
                placeholder="Harbourline Grand, Clifton Block 4"
                value={point}
                onChange={(e) => setPoint(e.target.value)}
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy || !route || !travelAt} className="w-full !rounded-xl !py-3">
              {busy
                ? 'Booking…'
                : route
                  ? `Book now — PKR ${pkrPlain(route.price!)}`
                  : 'Pick a route first'}
            </Button>
            <p className="text-center text-[11px] text-ink/45">
              Bill to company — invoiced on your usual terms.
            </p>
          </form>
        </Card>
      </div>

      {mine.length > 0 && (
        <Card title="Your transfers">
          <ul className="divide-y divide-hairline text-sm">
            {mine.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="tabular text-xs text-deep">{t.ref}</span>
                <span className="font-medium">{t.listings?.name}</span>
                <span className="text-xs text-ink/55">
                  {t.direction === 'pickup' ? 'pick-up' : 'drop-off'} · {dateTimePkt(t.travel_at)}
                  {t.flight_no ? ` · ${t.flight_no}` : ''} · {t.passengers} pax
                </span>
                <span className="tabular ml-auto">PKR {pkrPlain(t.price_pkr)}</span>
                <span className="rounded-full bg-sage px-2 py-0.5 text-xs text-deep">{t.status}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
