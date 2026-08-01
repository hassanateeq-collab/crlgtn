import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { datePkt, pkrPlain } from '@/lib/format'
import { Notice } from '@/components/ui'

/**
 * Corporate invoices & statements (M7, spec §9). Read-only: payment happens by
 * bank transfer or deposit drawdown, recorded by the ops desk.
 */

interface InvoiceRow {
  id: string
  number: string
  amount_pkr: number
  due_date: string
  status: string
  bookings: { booking_files: { ref: string; name: string } | null } | null
}

const tone: Record<string, string> = {
  sent: 'bg-paper text-ink/60 border border-hairline',
  paid: 'bg-sage text-deep',
  overdue: 'bg-brass/15 text-brass',
  disputed: 'bg-brass/15 text-brass',
}

export function Invoices() {
  const [rows, setRows] = useState<InvoiceRow[] | null>(null)
  const [deposit, setDeposit] = useState<{ balance_pkr: number; amount_pkr: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('invoices')
      .select('id, number, amount_pkr, due_date, status, bookings(booking_files(ref, name))')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows((data ?? []) as unknown as InvoiceRow[])
      })
    supabase
      .from('deposits')
      .select('balance_pkr, amount_pkr')
      .maybeSingle()
      .then(({ data }) => setDeposit(data))
  }, [])

  const open = (rows ?? []).filter((r) => ['sent', 'overdue'].includes(r.status))
  const openTotal = open.reduce((s, r) => s + r.amount_pkr, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl">Invoices</h1>
        <div className="flex gap-4 text-sm text-ink/60">
          <span>
            Open: <span className="tabular text-ink">PKR {pkrPlain(openTotal)}</span>
          </span>
          {deposit && (
            <span>
              Deposit balance:{' '}
              <span className="tabular text-ink">PKR {pkrPlain(deposit.balance_pkr)}</span>
            </span>
          )}
        </div>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink/50">
              <th className="px-4 py-2.5 font-medium">Number</th>
              <th className="px-4 py-2.5 font-medium">Booking</th>
              <th className="px-4 py-2.5 font-medium">Amount (PKR)</th>
              <th className="px-4 py-2.5 font-medium">Due</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="tabular px-4 py-2.5 text-xs">{r.number}</td>
                <td className="px-4 py-2.5">
                  <span className="tabular text-xs">{r.bookings?.booking_files?.ref}</span>
                  <span className="ml-2 text-xs text-ink/50">
                    {r.bookings?.booking_files?.name}
                  </span>
                </td>
                <td className="tabular px-4 py-2.5">{pkrPlain(r.amount_pkr)}</td>
                <td className="px-4 py-2.5">{datePkt(r.due_date)}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${tone[r.status] ?? ''}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-ink/50">
                  No invoices yet — they appear the moment a booking confirms.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink/50">
        Payment by bank transfer to the account on your statement, or automatic
        drawdown where a standing deposit is held. The Corlington desk records
        receipts within one business day.
      </p>
    </div>
  )
}
