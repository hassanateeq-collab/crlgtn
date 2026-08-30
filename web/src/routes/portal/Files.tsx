import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity'
import { countdown, datePkt, dateTimePkt, pkrPlain } from '@/lib/format'
import type { BookingFile } from '@/lib/api'
import { ABtn, Chip, Notice, Stat } from '@/components/atlas'

/**
 * Portal home (Atlas, per the approved prototype): greeting, three tiles,
 * needs-your-decision with a live countdown, drafts, upcoming trips unified
 * across hotels/cars/transfers, past & closed. Everything RLS-scoped to the
 * caller's corporate — no filtering needed here beyond presentation.
 */

interface BookingRow {
  id: string
  booking_file_id: string
  status: string
  nights: number
  grand_total_pkr: number
  created_at: string
  vendors: { name: string } | null
}

interface TransferRow {
  id: string
  ref: string
  direction: string
  travel_at: string
  flight_no: string | null
  passengers: number
  price_pkr: number
  status: string
  created_at: string
}

const greeting = () => {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', hour: 'numeric', hour12: false }).format(new Date()),
  )
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function Files() {
  const { identity } = useIdentity()
  const [files, setFiles] = useState<BookingFile[] | null>(null)
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    async function load() {
      const [f, b, t] = await Promise.all([
        supabase.from('booking_files').select('*').order('updated_at', { ascending: false }),
        supabase
          .from('bookings')
          .select('id, booking_file_id, status, nights, grand_total_pkr, created_at, vendors(name)')
          .order('created_at', { ascending: false }),
        supabase.from('transfer_bookings').select('*').order('travel_at', { ascending: false }),
      ])
      if (f.error) setError(f.error.message)
      setFiles((f.data ?? []) as BookingFile[])
      setBookings((b.data ?? []) as unknown as BookingRow[])
      setTransfers((t.data ?? []) as TransferRow[])
    }
    load()
  }, [])

  // One ticking clock for every countdown on the page.
  const anyWindow = files?.some(
    (f) => f.window_expires_at && new Date(f.window_expires_at).getTime() > now,
  )
  useEffect(() => {
    if (!anyWindow) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyWindow])

  const view = useMemo(() => {
    const fs = files ?? []
    const byId = new Map(fs.map((f) => [f.id, f]))
    const needsDecision = fs.filter(
      (f) =>
        ['requested', 'responded'].includes(f.status) &&
        f.window_expires_at &&
        new Date(f.window_expires_at).getTime() > now,
    )
    const drafts = fs.filter((f) => f.status === 'draft')
    const today = new Date().toISOString().slice(0, 10)
    const upcomingBookings = bookings
      .filter((b) => {
        const f = byId.get(b.booking_file_id)
        return b.status === 'confirmed' && f && f.check_out >= today
      })
      .map((b) => ({ b, f: byId.get(b.booking_file_id)! }))
    const upcomingTransfers = transfers.filter(
      (t) => t.status === 'confirmed' && new Date(t.travel_at).getTime() > now - 6 * 36e5,
    )
    const past = fs.filter(
      (f) =>
        ['completed', 'cancelled', 'expired'].includes(f.status) ||
        (['requested', 'responded'].includes(f.status) &&
          (!f.window_expires_at || new Date(f.window_expires_at).getTime() <= now)),
    )
    const monthStart = new Date()
    monthStart.setDate(1)
    const monthTotal =
      bookings
        .filter((b) => new Date(b.created_at) >= monthStart && b.status !== 'cancelled')
        .reduce((s, b) => s + b.grand_total_pkr, 0) +
      transfers
        .filter((t) => new Date(t.created_at) >= monthStart && t.status !== 'cancelled')
        .reduce((s, t) => s + t.price_pkr, 0)
    const monthCount =
      bookings.filter((b) => new Date(b.created_at) >= monthStart && b.status !== 'cancelled').length +
      transfers.filter((t) => new Date(t.created_at) >= monthStart && t.status !== 'cancelled').length
    return { needsDecision, drafts, upcomingBookings, upcomingTransfers, past, monthTotal, monthCount }
  }, [files, bookings, transfers, now])

  if (!files && !error) return <p className="text-sm text-ink/50">Loading…</p>

  const firstName = identity?.name.split(' ')[0] ?? 'there'
  const upcomingCount = view.upcomingBookings.length + view.upcomingTransfers.length

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px]">
            {greeting()}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {view.needsDecision.length
              ? `${view.needsDecision.length} request${view.needsDecision.length > 1 ? 's need' : ' needs'} your decision`
              : 'Nothing waiting on you'}
            {upcomingCount ? ` · ${upcomingCount} trip${upcomingCount > 1 ? 's' : ''} coming up` : ''}
          </p>
        </div>
        <Link to="/files/new">
          <ABtn>+ New booking file</ABtn>
        </Link>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="mb-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Needs attention"
          value={view.needsDecision.length || '—'}
          hint={view.needsDecision.length ? 'offers on the table, window closing' : 'no open decision windows'}
          tone={view.needsDecision.length ? 'hot' : 'ink'}
        />
        <Stat
          label="Upcoming trips"
          value={upcomingCount || '—'}
          hint={upcomingCount ? 'across hotels, cars and transfers' : 'nothing booked ahead'}
        />
        <Stat
          label="This month"
          value={view.monthCount ? `PKR ${pkrPlain(view.monthTotal)}` : '—'}
          hint={view.monthCount ? `${view.monthCount} booking${view.monthCount > 1 ? 's' : ''} · invoiced on your terms` : 'no bookings yet this month'}
        />
      </div>

      {/* ---- needs your decision ------------------------------------------- */}
      {view.needsDecision.length > 0 && (
        <>
          <SectionLabel>Needs your decision</SectionLabel>
          {view.needsDecision.map((f) => {
            const remaining = new Date(f.window_expires_at!).getTime() - now
            return (
              <Link
                key={f.id}
                to={`/files/${f.id}`}
                className="mb-2.5 flex flex-wrap items-center gap-4 rounded-2xl border-l-4 border-brass bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(20,36,31,.05)] transition-shadow hover:shadow-[0_2px_6px_rgba(20,36,31,.08),0_12px_28px_-16px_rgba(20,36,31,.2)]"
              >
                <Ref>{f.ref}</Ref>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">{f.name}</span>
                  <span className="block text-[12.5px] text-ink/55">
                    {datePkt(f.check_in)} → {datePkt(f.check_out)} · {f.rooms.length}{' '}
                    {f.service === 'car' ? 'vehicle' : 'room'}
                    {f.rooms.length > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <Chip tone="hot">offers in</Chip>
                  <span className="tabular text-[15px] font-semibold text-brass">{countdown(remaining)}</span>
                  <span className="text-[13px] font-semibold text-pine">Review offers →</span>
                </span>
              </Link>
            )
          })}
        </>
      )}

      {/* ---- drafts --------------------------------------------------------- */}
      {view.drafts.length > 0 && (
        <>
          <SectionLabel>Drafts — pick up where you left</SectionLabel>
          {view.drafts.map((f) => (
            <Row key={f.id} to={`/files/${f.id}`} refText={f.ref} title={f.name}
              meta={`${datePkt(f.check_in)} → ${datePkt(f.check_out)} · ${f.rooms.length} ${f.service === 'car' ? 'vehicle' : 'room'}${f.rooms.length > 1 ? 's' : ''} · ${f.service}`}
              right={<><Chip tone="wait">draft</Chip><span className="text-[13px] font-semibold text-pine">Resume →</span></>}
            />
          ))}
        </>
      )}

      {/* ---- upcoming ------------------------------------------------------- */}
      {upcomingCount > 0 && (
        <>
          <SectionLabel>Upcoming trips</SectionLabel>
          {view.upcomingBookings.map(({ b, f }) => (
            <Row key={b.id} to={`/files/${f.id}`} refText={f.ref} title={f.name}
              meta={`${datePkt(f.check_in)} → ${datePkt(f.check_out)} · ${b.vendors?.name ?? ''} · PKR ${pkrPlain(b.grand_total_pkr)}`}
              right={<><ServiceTag s={f.service} /><Chip tone="ok">confirmed</Chip><span className="text-[13px] font-semibold text-pine">Open →</span></>}
            />
          ))}
          {view.upcomingTransfers.map((t) => (
            <Row key={t.id} to="/transfers" refText={t.ref}
              title={`Airport ${t.direction === 'pickup' ? 'pick-up' : 'drop-off'}${t.flight_no ? ` — ${t.flight_no}` : ''}`}
              meta={`${dateTimePkt(t.travel_at)} · ${t.passengers} passenger${t.passengers > 1 ? 's' : ''} · PKR ${pkrPlain(t.price_pkr)}`}
              right={<><ServiceTag s="transfer" /><Chip tone="ok">confirmed</Chip></>}
            />
          ))}
        </>
      )}

      {/* ---- past ----------------------------------------------------------- */}
      {view.past.length > 0 && (
        <>
          <SectionLabel>Past & closed</SectionLabel>
          {view.past.slice(0, 8).map((f) => (
            <Row key={f.id} to={`/files/${f.id}`} refText={f.ref} title={f.name} dim
              meta={`${datePkt(f.check_in)} → ${datePkt(f.check_out)}`}
              right={<><Chip tone={f.status === 'completed' ? 'ok' : 'wait'}>{f.status}</Chip><span className="text-[13px] font-semibold text-ink/45">Open →</span></>}
            />
          ))}
        </>
      )}

      {files && files.length === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-hairline p-12 text-center text-sm text-ink/50">
          No booking files yet. Start your first request — offers come back inside 15 minutes.
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink/55">{children}</div>
  )
}
function Ref({ children }: { children: React.ReactNode }) {
  return (
    <span className="tabular rounded-lg bg-sage px-2.5 py-1 text-xs font-semibold text-deep">{children}</span>
  )
}
function ServiceTag({ s }: { s: string }) {
  return (
    <span className="rounded-md bg-paper px-2 py-0.5 text-[11px] text-ink/55">
      {s === 'car' ? 'rent-a-car' : s}
    </span>
  )
}
function Row({
  to, refText, title, meta, right, dim,
}: {
  to: string
  refText: string
  title: string
  meta: string
  right: React.ReactNode
  dim?: boolean
}) {
  return (
    <Link
      to={to}
      className={`mb-2.5 flex flex-wrap items-center gap-4 rounded-2xl bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(20,36,31,.05)] transition-shadow hover:shadow-[0_2px_6px_rgba(20,36,31,.08),0_12px_28px_-16px_rgba(20,36,31,.2)] ${dim ? 'opacity-75' : ''}`}
    >
      <Ref>{refText}</Ref>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-[12.5px] text-ink/55">{meta}</span>
      </span>
      <span className="ml-auto flex items-center gap-3">{right}</span>
    </Link>
  )
}
