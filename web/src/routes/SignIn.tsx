import { useState, type FormEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { AField, AInput, ABtn, Notice } from '@/components/atlas'

/**
 * Email OTP sign-in (spec M0), in the approved Atlas split-hero layout.
 *
 * A six-digit code rather than a magic link, deliberately: no credential ever
 * lands in a URL. `shouldCreateUser: false` is the closed-access rule in one
 * flag — accounts are provisioned by ops, never self-served. An unknown
 * address gets the same neutral confirmation as a known one, so this screen
 * cannot be used to enumerate which companies Corlington works with.
 */

type Stage = 'email' | 'code' | 'password'

const POINTS = [
  {
    n: '①',
    t: 'Offers in 15 minutes',
    s: 'Send one request; up to three hotels answer inside the window.',
  },
  {
    n: '②',
    t: 'Your rate, honored',
    s: 'Negotiated corporate rates on every card — never the walk-in price.',
  },
  {
    n: '③',
    t: 'One invoice, your terms',
    s: 'Bookings consolidate to a single monthly invoice on your credit terms.',
  },
]

export function SignIn() {
  const [stage, setStage] = useState<Stage>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signInWithPassword(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })
    setBusy(false)
    if (error) {
      // Same neutrality as the OTP path: wrong email and wrong password are
      // indistinguishable, so this form can't enumerate accounts either.
      setError('That email and password combination is not valid.')
    }
  }

  async function requestCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false },
    })
    setBusy(false)
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
    if (error) setError('That code is not valid or has expired.')
    // On success the auth listener in SessionProvider swaps the route.
  }

  return (
    <main className="grid min-h-svh bg-paper lg:grid-cols-[1.1fr_1fr]">
      {/* ---- hero ----------------------------------------------------------- */}
      <section className="flex flex-col bg-deep px-8 py-10 text-white lg:px-14">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="size-2 rounded-full bg-brass" />
          <span className="font-display text-xl font-semibold">Corlington</span>
        </div>
        <h2 className="mb-5 mt-auto max-w-[13ch] font-display text-3xl font-semibold leading-tight tracking-tight text-white lg:text-4xl">
          The rates your company <em className="not-italic text-[#e8c789]">already negotiated.</em>
        </h2>
        <div className="mb-auto hidden gap-4 lg:grid">
          {POINTS.map((p) => (
            <div key={p.t} className="flex max-w-[46ch] items-start gap-3">
              <span aria-hidden className="mt-0.5 grid size-7 flex-none place-items-center rounded-full bg-white/10 text-xs text-[#e8c789]">
                {p.n}
              </span>
              <span>
                <span className="block text-[14.5px] font-semibold">{p.t}</span>
                <span className="block text-[12.5px] text-[#b9cdc4]">{p.s}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6 text-xs text-[#8ca79c]">Corlington · corporate stays, Karachi first</div>
      </section>

      {/* ---- form ----------------------------------------------------------- */}
      <section className="grid place-items-center px-6 py-10">
        <div className="w-full max-w-[400px]">
          {stage === 'email' ? (
            <form onSubmit={requestCode} className="space-y-4">
              <div>
                <h1 className="text-[25px]">Sign in</h1>
                <p className="mt-1 text-[13.5px] text-ink/60">
                  Use your work email — the one your company registered.
                </p>
              </div>
              <AField label="Work email">
                <AInput
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com.pk"
                />
              </AField>
              {error && <Notice tone="error">{error}</Notice>}
              <ABtn type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Email me a sign-in code'}
              </ABtn>
              <button
                type="button"
                className="text-[13px] font-semibold text-pine"
                onClick={() => {
                  setStage('password')
                  setError(null)
                }}
              >
                Use a password instead
              </button>
              <div className="mt-4 rounded-2xl bg-sage px-4 py-3 text-[12.5px] text-deep">
                <b className="font-semibold">Closed access.</b> There is no sign-up. Accounts are
                provisioned by your company's Corlington manager — if your email isn't recognised,
                nothing is sent.
              </div>
            </form>
          ) : stage === 'password' ? (
            <form onSubmit={signInWithPassword} className="space-y-4">
              <div>
                <h1 className="text-[25px]">Sign in</h1>
                <p className="mt-1 text-[13.5px] text-ink/60">
                  Password sign-in — for accounts the Corlington desk has issued a password to.
                </p>
              </div>
              <AField label="Work email">
                <AInput
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.com.pk"
                />
              </AField>
              <AField label="Password">
                <AInput
                  type="password"
                  required
                  autoFocus={email.length > 0}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </AField>
              {error && <Notice tone="error">{error}</Notice>}
              <ABtn type="submit" disabled={busy} className="w-full">
                {busy ? 'Checking…' : 'Sign in'}
              </ABtn>
              <button
                type="button"
                className="text-[13px] font-semibold text-pine"
                onClick={() => {
                  setStage('email')
                  setPassword('')
                  setError(null)
                }}
              >
                Use an email code instead
              </button>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div>
                <h1 className="text-[25px]">Check your inbox</h1>
                <p className="mt-1 text-[13.5px] text-ink/60">
                  If <span className="tabular">{email}</span> is registered, a six-digit code is on
                  its way. It expires in 10 minutes.
                </p>
              </div>
              <div className="rounded-2xl bg-sage px-4 py-2.5 text-[12.5px] text-deep">
                Codes arrive within a minute. Nothing came? Check spam, then resend.
              </div>
              <AField label="Sign-in code">
                <AInput
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="tabular text-center text-[22px] tracking-[0.4em]"
                  placeholder="000000"
                />
              </AField>
              {error && <Notice tone="error">{error}</Notice>}
              <ABtn type="submit" disabled={busy || code.length !== 6} className="w-full">
                {busy ? 'Checking…' : 'Sign in'}
              </ABtn>
              <button
                type="button"
                className="text-[13px] font-semibold text-pine"
                onClick={() => {
                  setStage('email')
                  setCode('')
                  setError(null)
                }}
              >
                ← Different email
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  )
}
