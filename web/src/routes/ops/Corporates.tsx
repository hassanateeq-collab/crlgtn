import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { corporateSteps, nextStep, type CorporateProgressRow } from '@/lib/onboarding'
import { ABtn, Chip, PageHead, Progress, statusTone } from '@/components/atlas'

/** Corporate cards fed by the corporate_onboarding view (migration 019). */
export function CorporateCards() {
  const [rows, setRows] = useState<CorporateProgressRow[] | null>(null)

  useEffect(() => {
    supabase
      .from('corporate_onboarding')
      .select('*')
      .order('name')
      .then(({ data }) => setRows((data ?? []) as CorporateProgressRow[]))
  }, [])

  if (!rows) return <p className="text-sm text-ink/50">Loading…</p>
  if (rows.length === 0) return <p className="rounded-2xl bg-white p-6 text-sm text-ink/60">No corporates yet.</p>

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => {
        const steps = corporateSteps(r)
        const next = nextStep(steps)
        const done = steps.filter((s) => s.done).length
        return (
          <article key={r.corporate_id} className="flex flex-col rounded-[20px] bg-white p-4 shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)]">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 text-[17px]">{r.name}</h3>
              <Chip tone={statusTone(r.status)}>{r.status}</Chip>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone="ink">Tier {r.tier}</Chip>
              <Chip tone="sage">{r.credit_terms.replace('_', ' ')}</Chip>
              {r.countersign_required && <Chip tone="hot">countersign on</Chip>}
              {r.security_type !== 'none' && <Chip tone="sage">{r.security_type} {r.security_amount_pkr.toLocaleString('en-PK')}</Chip>}
            </div>
            <p className={`mt-2 text-[12.5px] ${r.official_email ? 'text-ink/60' : 'text-brass'}`}>
              {r.official_email ?? 'No official email yet'}
            </p>
            <p className="text-[12.5px] text-ink/60">
              {r.users_linked} of {r.users_total} bookers can sign in · {r.files_total} booking files
            </p>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={done} max={steps.length} />
              <span className="tabular text-xs text-ink/55">{done}/{steps.length}</span>
            </div>
            <p className="mt-2 text-[13px]">
              {next ? (
                <span><span className="font-semibold text-brass">Next:</span> {next.label} — <span className="text-ink/60">{next.detail}</span></span>
              ) : (
                <span className="font-semibold text-deep">Setup complete</span>
              )}
            </p>
            <div className="mt-auto pt-3">
              <Link to={`/ops/corporates/${r.corporate_id}`} className="text-[13px] font-semibold text-pine">Open setup →</Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export function Corporates() {
  return (
    <div>
      <PageHead
        eyebrow="Clients"
        title="Corporates"
        sub="Closed access — every booker is provisioned here. Tier sets the credit ceiling."
        actions={<Link to="/ops/corporates/new"><ABtn>+ New corporate</ABtn></Link>}
      />
      <CorporateCards />
    </div>
  )
}
