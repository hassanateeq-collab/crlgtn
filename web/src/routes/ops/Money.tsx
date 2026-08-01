import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { callFunction, ApiError } from '@/lib/api'
import { datePkt, pkrPlain } from '@/lib/format'
import { Button, Card, Input, Notice } from '@/components/ui'

/**
 * Ops money desk (M7): invoices with inline payment recording, deposit
 * balances, and the monthly vendor settlement with CSV export.
 */

interface InvoiceRow {
  id: string
  number: string
  amount_pkr: number
  due_date: string
  status: string
  corporates: { name: string } | null
  bookings: { booking_files: { ref: string } | null } | null
}

interface SettlementRow {
  id: string
  period: string
  gross_pkr: number
  commission_pkr: number
  net_pkr: number
  status: string
  vendors: { name: string } | null
}

const invoiceTone: Record<string, string> = {
  sent: 'bg-paper text-ink/60 border border-hairline',
  paid: 'bg-sage text-deep',
  overdue: 'bg-brass/15 text-brass',
  disputed: 'bg-brass/15 text-brass',
  draft: 'bg-paper text-ink/40',
}

export function Money() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [deposits, setDeposits] = useState<
    { balance_pkr: number; amount_pkr: number; corporates: { name: string } | null }[]
  >([])
  const [settlements, setSettlements] = useState<SettlementRow[]>([])
  const [payFor, setPayFor] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payRef, setPayRef] = useState('')
  const [payMethod, setPayMethod] = useState('bank_transfer')
  const [period, setPeriod] = useState('2026-08')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const [i, d, s] = await Promise.all([
      supabase
        .from('invoices')
        .select('id, number, amount_pkr, due_date, status, corporates(name), bookings(booking_files(ref))')
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('deposits').select('balance_pkr, amount_pkr, corporates(name)'),
      supabase
        .from('settlements')
        .select('id, period, gross_pkr, commission_pkr, net_pkr, status, vendors(name)')
        .order('period', { ascending: false }),
    ])
    setInvoices((i.data ?? []) as unknown as InvoiceRow[])
    setDeposits((d.data ?? []) as never)
    setSettlements((s.data ?? []) as unknown as SettlementRow[])
  }

  useEffect(() => {
    load()
  }, [])

  async function recordPayment(invoiceId: string) {
    setBusy(true)
    setError(null)
    try {
      await callFunction('ef_finance', {
        action: 'record_payment',
        invoice_id: invoiceId,
        amount_pkr: parseInt(payAmount || '0', 10),
        method: payMethod,
        reference: payRef.trim() || undefined,
      })
      setPayFor(null)
      setPayAmount('')
      setPayRef('')
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  async function runSettlement() {
    setBusy(true)
    setError(null)
    try {
      await callFunction('ef_finance', { action: 'run_settlement', period })
      await load()
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : 'Settlement failed')
    } finally {
      setBusy(false)
    }
  }

  function exportCsv() {
    const rows = settlements.filter((s) => s.period === period)
    const csv = [
      'vendor,period,gross_pkr,commission_pkr,net_pkr,status',
      ...rows.map((s) =>
        [`"${s.vendors?.name ?? ''}"`, s.period, s.gross_pkr, s.commission_pkr, s.net_pkr, s.status].join(','),
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `corlington-settlement-${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const selectCls =
    'rounded-md border border-hairline bg-white px-2 py-1.5 text-sm text-ink focus:border-pine focus:outline-none'

  return (
    <div className="space-y-6">
      <h1 className="text-xl">Money</h1>
      {error && <Notice tone="error">{error}</Notice>}

      <Card title="Invoices">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink/50">
                <th className="py-2 pr-4 font-medium">Number</th>
                <th className="py-2 pr-4 font-medium">Ref</th>
                <th className="py-2 pr-4 font-medium">Corporate</th>
                <th className="py-2 pr-4 font-medium">Amount (PKR)</th>
                <th className="py-2 pr-4 font-medium">Due</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="tabular py-2 pr-4 text-xs">{i.number}</td>
                  <td className="tabular py-2 pr-4 text-xs">
                    {i.bookings?.booking_files?.ref ?? '—'}
                  </td>
                  <td className="py-2 pr-4">{i.corporates?.name}</td>
                  <td className="tabular py-2 pr-4">{pkrPlain(i.amount_pkr)}</td>
                  <td className="py-2 pr-4">{datePkt(i.due_date)}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${invoiceTone[i.status] ?? ''}`}>
                      {i.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {['sent', 'overdue'].includes(i.status) && (
                      <button
                        type="button"
                        className="text-xs text-deep hover:underline"
                        onClick={() => {
                          setPayFor(payFor === i.id ? null : i.id)
                          setPayAmount(i.amount_pkr.toString())
                        }}
                      >
                        record payment
                      </button>
                    )}
                    {payFor === i.id && (
                      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                        <Input
                          className="!w-32 tabular"
                          inputMode="numeric"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value.replace(/\D/g, ''))}
                        />
                        <select
                          className={selectCls}
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value)}
                        >
                          <option value="bank_transfer">bank transfer</option>
                          <option value="deposit_drawdown">deposit drawdown</option>
                        </select>
                        <Input
                          className="!w-36"
                          placeholder="reference"
                          value={payRef}
                          onChange={(e) => setPayRef(e.target.value)}
                        />
                        <Button type="button" disabled={busy} onClick={() => recordPayment(i.id)}>
                          Save
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-ink/40">
                    No invoices yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card title="Standing deposits">
          {deposits.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink/40">No deposit corporates.</p>
          ) : (
            <ul className="divide-y divide-hairline text-sm">
              {deposits.map((d, i) => (
                <li key={i} className="flex items-baseline justify-between py-2">
                  <span>{d.corporates?.name}</span>
                  <span className="tabular">
                    {pkrPlain(d.balance_pkr)}
                    <span className="text-xs text-ink/40"> / {pkrPlain(d.amount_pkr)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Vendor settlements"
          footer={
            <span className="text-xs text-ink/60">
              Gross − contracted commission, per stay checked out in the period. Runs
              automatically on the 1st; re-running a draft period recomputes it.
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              className="!w-32 tabular"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="YYYY-MM"
            />
            <Button type="button" disabled={busy} onClick={runSettlement}>
              Run settlement
            </Button>
            <Button type="button" variant="ghost" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink/50">
                  <th className="py-2 pr-4 font-medium">Vendor</th>
                  <th className="py-2 pr-4 font-medium">Period</th>
                  <th className="py-2 pr-4 font-medium">Gross</th>
                  <th className="py-2 pr-4 font-medium">Commission</th>
                  <th className="py-2 pr-4 font-medium">Net payable</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2 pr-4">{s.vendors?.name}</td>
                    <td className="tabular py-2 pr-4 text-xs">{s.period}</td>
                    <td className="tabular py-2 pr-4">{pkrPlain(s.gross_pkr)}</td>
                    <td className="tabular py-2 pr-4">{pkrPlain(s.commission_pkr)}</td>
                    <td className="tabular py-2 pr-4 font-medium">{pkrPlain(s.net_pkr)}</td>
                    <td className="py-2 text-xs">{s.status}</td>
                  </tr>
                ))}
                {settlements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-sm text-ink/40">
                      No settlements yet — run a period.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
