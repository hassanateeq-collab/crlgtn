import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useIdentity } from '@/lib/identity'
import { PageHead, ACard, Chip, Stat, Notice } from '@/components/atlas'
import { pkr, datePkt } from '@/lib/format'

/**
 * Vendor settlements — what Corlington owes and has paid. Corlington is the
 * merchant of record: corporates pay Corlington, Corlington settles the hotel
 * monthly, net of the agreed commission. Read-only; disputes go to the desk.
 */

interface SettlementRow {
  id: string
  period: string // 'YYYY-MM'
  gross_pkr: number
  commission_pkr: number
  adjustments: { label: string; amount_pkr: number }[] | null
  net_pkr: number
  status: 'draft' | 'approved' | 'paid'
  updated_at: string
}
interface BookingRow {
  id: string
  booking_file_id: string
  status: string
  nights: number
  grand_total_pkr: number
  created_at: string
}
interface FileRow {
  id: string
  ref: string
  check_in: string
  check_out: string
}

const STATUS_TONE = { draft: 'wait', approved: 'hot', paid: 'ok' } as const
const STATUS_LABEL = {
  draft: 'being prepared',
  approved: 'approved — payment on the way',
  paid: 'paid',
} as const

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(
    new Date(Date.UTC(y, (m ?? 1) - 1, 1)),
  )
}

export function VendorMoney() {
  const { identity } = useIdentity()
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [bookings, setBookings] = useState<BookingRow[]>([])
  const [files, setFiles] = useState<Map<string, FileRow>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [{ data: setRows }, { data: bookRows }] = await Promise.all([
        supabase
          .from('settlements')
          .select('id, period, gross_pkr, commission_pkr, adjustments, net_pkr, status, updated_at')
          .order('period', { ascending: false }),
        supabase
          .from('bookings')
          .select('id, booking_file_id, status, nights, grand_total_pkr, created_at')
          .in('status', ['confirmed', 'checked_in', 'checked_out'])
          .order('created_at', { ascending: false })
          .limit(60),
      ])
      if (cancelled) return
      const fileIds = [...new Set((bookRows ?? []).map((b) => b.booking_file_id))]
      const { data: fileRows } = fileIds.length
        ? await supabase.from('booking_files').select('id, ref, check_in, check_out').in('id', fileIds)
        : { data: [] as FileRow[] }
      if (cancelled) return
      setSettlements((setRows ?? []) as SettlementRow[])
      setBookings((bookRows ?? []) as BookingRow[])
      setFiles(new Map(((fileRows ?? []) as FileRow[]).map((f) => [f.id, f])))
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const owed = useMemo(
    () => settlements.filter((s) => s.status !== 'paid').reduce((sum, s) => sum + s.net_pkr, 0),
    [settlements],
  )
  const paidTotal = useMemo(
    () => settlements.filter((s) => s.status === 'paid').reduce((sum, s) => sum + s.net_pkr, 0),
    [settlements],
  )
  const bookedValue = useMemo(
    () => bookings.reduce((sum, b) => sum + b.grand_total_pkr, 0),
    [bookings],
  )

  if (loading) {
    return <p className="py-16 text-center text-sm text-ink/50">Loading settlements…</p>
  }

  return (
    <>
      <PageHead
        eyebrow={identity?.vendor?.name ?? 'Vendor'}
        title="Settlements"
        sub="Corporates pay Corlington; Corlington settles you monthly, net of the agreed commission."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Owed to you" value={pkr(owed)} tone={owed > 0 ? 'hot' : 'ink'} hint="approved & in preparation" />
        <Stat label="Paid to date" value={pkr(paidTotal)} hint="settled periods" />
        <Stat label="Booked value" value={pkr(bookedValue)} hint="recent confirmed stays, gross" />
      </div>

      <ACard title="Monthly statements" className="mb-6">
        {settlements.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">
            No statements yet — your first settlement is prepared after the first completed month.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink/50">
                  <th className="py-2 pr-4">Period</th>
                  <th className="py-2 pr-4 text-right">Gross</th>
                  <th className="py-2 pr-4 text-right">Commission</th>
                  <th className="py-2 pr-4 text-right">Adjustments</th>
                  <th className="py-2 pr-4 text-right">Net to you</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {settlements.map((s) => {
                  const adj = (s.adjustments ?? []).reduce((sum, a) => sum + (a.amount_pkr ?? 0), 0)
                  return (
                    <tr key={s.id}>
                      <td className="py-3 pr-4 font-semibold">{periodLabel(s.period)}</td>
                      <td className="py-3 pr-4 text-right text-ink/70">{pkr(s.gross_pkr)}</td>
                      <td className="py-3 pr-4 text-right text-ink/70">− {pkr(s.commission_pkr)}</td>
                      <td className="py-3 pr-4 text-right text-ink/70">{adj === 0 ? '—' : pkr(adj)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-deep">{pkr(s.net_pkr)}</td>
                      <td className="py-3">
                        <Chip tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Chip>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </ACard>

      <ACard title="Recent confirmed stays" sub="What each statement is built from." className="mb-6">
        {bookings.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink/50">No confirmed stays yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.05em] text-ink/50">
                  <th className="py-2 pr-4">File</th>
                  <th className="py-2 pr-4">Dates</th>
                  <th className="py-2 pr-4">Nights</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 text-right">Gross</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {bookings.map((b) => {
                  const f = files.get(b.booking_file_id)
                  return (
                    <tr key={b.id}>
                      <td className="py-2.5 pr-4 font-semibold">{f?.ref ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-ink/60">
                        {f ? `${datePkt(f.check_in)} → ${datePkt(f.check_out)}` : '—'}
                      </td>
                      <td className="py-2.5 pr-4 text-ink/60">{b.nights}</td>
                      <td className="py-2.5 pr-4 text-ink/60">{b.status}</td>
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
        Question about a statement? Reply to your settlement email or message the Corlington desk —
        adjustments are agreed before a period is approved.
      </Notice>
    </>
  )
}
