import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button, Notice } from '@/components/ui'

interface VendorRow {
  id: string
  name: string
  vendor_type: string
  status: string
  stars_assigned: number | null
  price_bracket: string | null
  commission_pct: number | null
  corridors: { name: string } | null
}

const statusTone: Record<string, string> = {
  live: 'bg-sage text-deep',
  onboarding: 'bg-brass/15 text-brass',
  prospect: 'bg-paper text-ink/60 border border-hairline',
  suspended: 'bg-ink/10 text-ink/60',
}

export function Vendors() {
  const [rows, setRows] = useState<VendorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('vendors')
      .select(
        'id, name, vendor_type, status, stars_assigned, price_bracket, commission_pct, corridors(name)',
      )
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows((data ?? []) as unknown as VendorRow[])
      })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">Vendors</h1>
        <Link to="/ops/vendors/new">
          <Button>Onboard vendor</Button>
        </Link>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink/50">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Corridor</th>
              <th className="px-4 py-2.5 font-medium">Stars</th>
              <th className="px-4 py-2.5 font-medium">Bracket</th>
              <th className="px-4 py-2.5 font-medium">Commission</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows?.map((v) => (
              <tr key={v.id} className="hover:bg-paper/60">
                <td className="px-4 py-2.5">
                  <Link to={`/ops/vendors/${v.id}`} className="font-medium text-deep hover:underline">
                    {v.name}
                  </Link>
                  <Link
                    to={`/ops/vendors/${v.id}/page`}
                    className="ml-2 text-xs text-ink/40 hover:text-ink"
                  >
                    view page
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[v.status] ?? ''}`}>
                    {v.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink/70">{v.corridors?.name ?? '—'}</td>
                <td className="px-4 py-2.5 tabular">{v.stars_assigned ?? '—'}</td>
                <td className="px-4 py-2.5 tabular uppercase">{v.price_bracket ?? '—'}</td>
                <td className="px-4 py-2.5 tabular">
                  {v.commission_pct != null ? `${v.commission_pct}%` : '—'}
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  No vendors yet. Onboard the first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
