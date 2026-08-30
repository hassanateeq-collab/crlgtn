import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ABtn, ACard, AInput, Chip, Notice, PageHead } from '@/components/atlas'

/**
 * /dev — one-click role switching for the testing phase.
 *
 * Deliberately ships NO credentials: the fixture password is typed once and
 * kept only in this browser's localStorage. The accounts themselves are .test
 * fixtures that scripts/purge-test-data.sql deletes before go-live — after
 * that purge every button here simply fails to sign in. The route itself is
 * on the LAUNCH checklist to be removed at go-live regardless.
 */

const PASS_KEY = 'corlington-dev-pass'

const ACCOUNTS = [
  { email: 'ops.admin@corlington.test', label: 'Ops — admin', detail: 'Full Atlas console, Team & passwords', portal: 'Atlas console' },
  { email: 'ops.agent@corlington.test', label: 'Ops — desk agent', detail: 'Console without account management', portal: 'Atlas console' },
  { email: 'nadia@northbridge.test', label: 'Corporate — admin', detail: 'Northbridge Textiles (TEST)', portal: 'Corporate portal' },
  { email: 'bilal@northbridge.test', label: 'Corporate — booker', detail: 'Northbridge Textiles (TEST)', portal: 'Corporate portal' },
  { email: 'zeeshan@meridian.test', label: 'Corporate — booker', detail: 'Meridian Logistics (TEST)', portal: 'Corporate portal' },
  { email: 'res@faisalcourt.test', label: 'Vendor — front office', detail: 'Faisal Court Executive (TEST)', portal: 'Vendor portal' },
]

export function Dev() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PASS_KEY)
      if (saved) setPassword(saved)
    } catch {
      /* storage unavailable — type it each time */
    }
    supabase.auth.getSession().then(({ data }) => {
      setCurrentEmail(data.session?.user.email ?? null)
    })
  }, [])

  async function signInAs(email: string) {
    if (!password) {
      setError('Enter the fixture password once — it stays in this browser only.')
      return
    }
    setBusy(email)
    setError(null)
    try {
      await supabase.auth.signOut()
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) throw err
      try {
        localStorage.setItem(PASS_KEY, password)
      } catch {
        /* fine */
      }
      // Full reload so identity resolution runs fresh and routes by role.
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(null)
    }
  }

  return (
    <main className="min-h-svh bg-paper">
      <div className="mx-auto max-w-[680px] px-6 py-12">
        <PageHead
          eyebrow="Testing only"
          title="Quick role switch"
          sub="One click signs you in as a test fixture and lands you in that role's portal. Removed at launch."
        />

        {currentEmail && (
          <Notice tone="info">
            Currently signed in as <b>{currentEmail}</b> — picking a role below switches accounts.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <ACard title="Fixture password" sub="Typed once, kept only in this browser — never shipped in the app." className="my-4">
          <AInput
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="the shared test password"
            autoComplete="off"
          />
        </ACard>

        <div className="space-y-2.5">
          {ACCOUNTS.map((a) => (
            <ACard key={a.email} className="!p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[14.5px] font-semibold">
                    {a.label}
                    <Chip tone="sage">{a.portal}</Chip>
                  </div>
                  <div className="text-[12.5px] text-ink/55">
                    {a.detail} · <span className="font-mono text-[11.5px]">{a.email}</span>
                  </div>
                </div>
                <ABtn onClick={() => signInAs(a.email)} disabled={busy !== null} className="px-4 py-2">
                  {busy === a.email ? 'Signing in…' : 'Sign in'}
                </ABtn>
              </div>
            </ACard>
          ))}
        </div>

        <p className="mt-6 text-center text-[12px] text-ink/45">
          These are .test fixtures, purged before real corporates come on. Real sign-in stays at{' '}
          <a href="/" className="font-semibold text-deep underline">the front door</a>.
        </p>
      </div>
    </main>
  )
}
