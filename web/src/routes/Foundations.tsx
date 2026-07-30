import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session'
import { supabase } from '@/lib/supabase'
import { whoami, ApiError, type WhoAmI } from '@/lib/api'
import { Button, Card, Notice, Verdict } from '@/components/ui'
import { dateTimePkt } from '@/lib/format'

/**
 * M0 diagnostics — the milestone's done-gate, runnable from the browser.
 *
 * This screen is temporary scaffolding with a permanent purpose: it re-runs the
 * foundation checks (identity resolves, RLS scopes reads, client writes fail,
 * audit row written) against the live project every time it mounts. When M2
 * replaces it with the real portal shell, it moves under an /ops diagnostics
 * route rather than being deleted.
 */

interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

export function Foundations() {
  const { session, signOut } = useSession()
  const [identity, setIdentity] = useState<WhoAmI | null>(null)
  const [checks, setChecks] = useState<CheckResult[]>([])
  const [running, setRunning] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function run() {
      setRunning(true)
      setFatal(null)
      const results: CheckResult[] = []

      // ---- 1. Edge Function resolves the actor (JWT → profile) ------------
      let who: WhoAmI
      try {
        who = await whoami()
        if (cancelled) return
        setIdentity(who)
        results.push({
          name: 'Edge Function auth',
          pass: true,
          detail: `ef_whoami resolved ${who.email} as ${who.actorType}${
            who.corporate ? ` at ${who.corporate.name}` : ''
          }`,
        })
      } catch (err: unknown) {
        const msg =
          err instanceof ApiError ? `${err.code}: ${err.message}` : 'unreachable'
        setFatal(
          `ef_whoami failed (${msg}). If this account has no Corlington profile, that refusal is itself correct behaviour — closed access means unprovisioned users get nothing.`,
        )
        setRunning(false)
        return
      }

      // ---- 2. RLS scopes reads to the caller's tenant -----------------------
      const { data: corps, error: corpErr } = await supabase
        .from('corporates')
        .select('id, name')
      const corpCount = corps?.length ?? 0
      const expectedCorps = who.isOps ? 2 : 1
      results.push({
        name: 'RLS: corporates',
        pass: !corpErr && corpCount === expectedCorps,
        detail: corpErr
          ? corpErr.message
          : `sees ${corpCount} (expected ${expectedCorps} for ${
              who.isOps ? 'ops' : 'a corporate user'
            })`,
      })

      const { data: vendors } = await supabase.from('vendors').select('id, status')
      const vendorCount = vendors?.length ?? 0
      const expectedVendors = who.isOps ? 4 : 3
      results.push({
        name: 'RLS: vendors',
        pass: vendorCount === expectedVendors,
        detail: `sees ${vendorCount} (expected ${expectedVendors}: non-live supply is ${
          who.isOps ? 'visible to ops' : 'hidden from corporates'
        })`,
      })

      const { data: vUsers } = await supabase.from('vendor_users').select('id')
      const vUserCount = vUsers?.length ?? 0
      results.push({
        name: 'RLS: vendor contacts',
        pass: who.isOps ? vUserCount === 4 : vUserCount === 0,
        detail: who.isOps
          ? `ops sees ${vUserCount} of 4`
          : `corporate sees ${vUserCount} (hotel WhatsApp numbers must stay with Corlington)`,
      })

      // ---- 3. Direct client-side write fails -------------------------------
      // The M0 gate. Migration 004 makes this a privilege error (42501), not a
      // silent zero-row no-op.
      const { error: writeErr } = await supabase
        .from('corporates')
        .update({ notes: 'client-side write attempt' })
        .eq('id', corps?.[0]?.id ?? '00000000-0000-0000-0000-000000000000')
      results.push({
        name: 'Client writes blocked',
        pass: writeErr !== null,
        detail: writeErr
          ? `rejected: ${writeErr.code ?? writeErr.message}`
          : 'UPDATE succeeded — the hard rule is broken',
      })

      const { error: insertErr } = await supabase
        .from('audit_log')
        .insert({ actor_type: 'system', action: 'forged', entity: 'corporates' })
      results.push({
        name: 'Audit log unforgeable',
        pass: insertErr !== null,
        detail: insertErr
          ? `rejected: ${insertErr.code ?? insertErr.message}`
          : 'client INSERT into audit_log succeeded — broken',
      })

      if (!cancelled) {
        setChecks(results)
        setRunning(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [session])

  const allPass = checks.length > 0 && checks.every((c) => c.pass)

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span aria-hidden className="h-10 w-px bg-hairline" />
          <span aria-hidden className="size-1.5 rounded-full bg-brass" />
          <div>
            <h1 className="font-display text-xl leading-tight">Corlington</h1>
            <p className="text-xs text-ink/60">M0 · foundations check</p>
          </div>
        </div>
        <Button variant="ghost" onClick={signOut}>
          Sign out
        </Button>
      </header>

      {fatal && <Notice tone="error">{fatal}</Notice>}

      {identity && (
        <div className="space-y-4">
          <Card title="Identity">
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              <dt className="text-ink/60">Signed in as</dt>
              <dd>{identity.name}</dd>
              <dt className="text-ink/60">Email</dt>
              <dd className="tabular text-[13px]">{identity.email}</dd>
              <dt className="text-ink/60">Acting as</dt>
              <dd>
                {identity.isOps
                  ? `Corlington ops (${identity.opsRole})`
                  : `${identity.corporateRole} at ${identity.corporate?.name ?? '—'}`}
              </dd>
              <dt className="text-ink/60">Server time</dt>
              <dd className="tabular text-[13px]">
                {dateTimePkt(identity.serverTimeUtc)} PKT
              </dd>
            </dl>
          </Card>

          <Card
            title="Foundation checks"
            footer={
              running ? (
                <span className="text-xs text-ink/60">Running…</span>
              ) : (
                <Verdict pass={allPass}>
                  {allPass
                    ? 'All gates pass. M0 holds.'
                    : 'A gate failed — fix before building on top.'}
                </Verdict>
              )
            }
          >
            <ul className="divide-y divide-hairline">
              {checks.map((c) => (
                <li key={c.name} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-44 shrink-0">
                    <Verdict pass={c.pass}>{c.name}</Verdict>
                  </div>
                  <span className="text-xs text-ink/60">{c.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </main>
  )
}
