import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { pkrPlain } from '@/lib/format'
import { Button, Notice } from '@/components/ui'

interface CorporateRow {
  id: string
  name: string
  status: string
  credit_limit_pkr: number
  credit_terms: string
  security_type: string
  approval_required: boolean
}

const TERMS_LABEL: Record<string, string> = {
  on_checkout: 'upon checkout',
  d7: '7 days',
  d15: '15 days',
  d30: '30 days',
}

export function Corporates() {
  const [rows, setRows] = useState<CorporateRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('corporates')
      .select('id, name, status, credit_limit_pkr, credit_terms, security_type, approval_required')
      .order('name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows(data ?? [])
      })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">Corporates</h1>
        <Link to="/ops/corporates/new">
          <Button>Add corporate</Button>
        </Link>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink/50">
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Credit limit (PKR)</th>
              <th className="px-4 py-2.5 font-medium">Terms</th>
              <th className="px-4 py-2.5 font-medium">Security</th>
              <th className="px-4 py-2.5 font-medium">Approval</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows?.map((c) => (
              <tr key={c.id} className="hover:bg-paper/60">
                <td className="px-4 py-2.5">
                  <Link to={`/ops/corporates/${c.id}`} className="font-medium text-deep hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{c.status}</td>
                <td className="px-4 py-2.5 tabular">{pkrPlain(c.credit_limit_pkr)}</td>
                <td className="px-4 py-2.5">{TERMS_LABEL[c.credit_terms] ?? c.credit_terms}</td>
                <td className="px-4 py-2.5">{c.security_type}</td>
                <td className="px-4 py-2.5">{c.approval_required ? 'required' : '—'}</td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  No corporates yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
