import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { datePkt } from '@/lib/format'
import type { BookingFile } from '@/lib/api'
import { Button, Notice } from '@/components/ui'

/**
 * Booking files list (spec §9): status, dates, resume. Drafts float to the top
 * because "resume the file I was building" is the whole point of the list.
 */

const statusTone: Record<string, string> = {
  draft: 'bg-paper text-ink/60 border border-hairline',
  requested: 'bg-brass/15 text-brass',
  responded: 'bg-brass/15 text-brass',
  confirmed: 'bg-sage text-deep',
  completed: 'bg-sage text-deep',
  cancelled: 'bg-ink/10 text-ink/60',
  expired: 'bg-ink/10 text-ink/60',
}

export function Files() {
  const [rows, setRows] = useState<BookingFile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('booking_files')
      .select('*')
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          const files = (data ?? []) as BookingFile[]
          // Drafts first, then the rest by recency.
          setRows([
            ...files.filter((f) => f.status === 'draft'),
            ...files.filter((f) => f.status !== 'draft'),
          ])
        }
      })
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl">Booking files</h1>
        <Link to="/files/new">
          <Button>New booking file</Button>
        </Link>
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-ink/50">
              <th className="px-4 py-2.5 font-medium">Ref</th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Stay</th>
              <th className="px-4 py-2.5 font-medium">Rooms</th>
              <th className="px-4 py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows?.map((f) => (
              <tr key={f.id} className="hover:bg-paper/60">
                <td className="tabular px-4 py-2.5 text-xs">{f.ref}</td>
                <td className="px-4 py-2.5 font-medium">{f.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${statusTone[f.status] ?? ''}`}>
                    {f.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-ink/70">
                  {datePkt(f.check_in)} → {datePkt(f.check_out)}
                </td>
                <td className="tabular px-4 py-2.5">{f.rooms.length}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link to={`/files/${f.id}`} className="text-deep hover:underline">
                    {f.status === 'draft' ? 'Resume' : 'Open'}
                  </Link>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink/50">
                  No booking files yet. Start your first request.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
