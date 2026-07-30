import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Field, Input, Notice } from '@/components/ui'

/**
 * Email OTP sign-in (spec M0).
 *
 * A six-digit code rather than a magic link, deliberately: no credential ever
 * lands in a URL, which is the same reasoning that governs the vendor
 * magic-link page in M4 (single-use, expiring, no PII in the URL).
 *
 * `shouldCreateUser: false` is the closed-access rule in one flag — accounts are
 * provisioned by ops, never self-served. An unknown address gets the same
 * neutral confirmation as a known one, so this screen cannot be used to
 * enumerate which companies Corlington works with.
 */

type Stage = 'email' | 'code'

export function SignIn() {
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    })
    setBusy(false)

    // Rate limiting is the one failure worth naming: the built-in SMTP allows
    // only a few sends per hour, and silence would look like a broken form.
    if (error && /rate|limit/i.test(error.message)) {
      setError('Too many attempts. Wait a few minutes and try again.')
      return
    }
    // Everything else advances regardless, so a wrong address reveals nothing.
    setStage('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    })
    setBusy(false)
    if (error) {
      setError('That code is not valid or has expired.')
      return
    }
    // On success the auth listener in SessionProvider swaps the route.
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        {/* The spine: a vertical hairline with a brass cap, the signature
            element from spec §10, here in its quietest form. */}
        <div className="mb-8 flex items-center gap-3">
          <span aria-hidden className="h-10 w-px bg-hairline" />
          <span aria-hidden className="size-1.5 rounded-full bg-brass" />
          <h1 className="font-display text-2xl">Corlington</h1>
        </div>

        {stage === 'email' ? (
          <form onSubmit={requestCode} className="space-y-4">
            <p className="text-sm text-ink/70">
              Sign in with your work email. We will send a six-digit code.
            </p>
            <Field label="Work email">
              <Input
                type="email"
                required
                autoFocus
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-ink/70">
              If <span className="tabular">{email}</span> is registered, a code is on
              its way. It expires in 10 minutes.
            </p>
            <Field label="Six-digit code">
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                autoFocus
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="tabular tracking-[0.4em]"
                placeholder="000000"
              />
            </Field>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStage('email')
                setCode('')
                setError(null)
              }}
            >
              Use a different email
            </Button>
          </form>
        )}
      </div>
    </main>
  )
}
