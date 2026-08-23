import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { Step } from '@/lib/onboarding'

/**
 * Atlas primitives for the redesigned screens — soft cards, sentence case,
 * brass reserved for attention. ui.tsx stays for the older M1 pages until
 * they are rebuilt.
 */

export function PageHead({
  eyebrow,
  title,
  sub,
  actions,
}: {
  eyebrow?: string
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-brass">{eyebrow}</div>
        )}
        <h1 className="text-[26px] leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink/60">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function ACard({
  title,
  sub,
  children,
  className = '',
  right,
}: {
  title?: ReactNode
  sub?: ReactNode
  children: ReactNode
  className?: string
  right?: ReactNode
}) {
  return (
    <section
      className={`rounded-[20px] bg-white p-5 shadow-[0_1px_3px_rgba(20,36,31,.05),0_14px_36px_-22px_rgba(20,36,31,.16)] ${className}`}
    >
      {(title || right) && (
        <header className="mb-3 flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            {title && <h2 className="text-[17px]">{title}</h2>}
            {sub && <p className="mt-0.5 text-xs text-ink/55">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

type Tone = 'ok' | 'hot' | 'wait' | 'bad' | 'ink' | 'sage'
const chipTone: Record<Tone, string> = {
  ok: 'bg-sage text-deep',
  hot: 'bg-[#FBF3E2] text-brass',
  wait: 'bg-[#eef0ee] text-[#8a978f]',
  bad: 'bg-[#f7e9e6] text-[#8f3b2e]',
  ink: 'bg-ink text-[#e8c789]',
  sage: 'bg-sage text-deep',
}
export function Chip({ tone = 'sage', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${chipTone[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function statusTone(status: string): Tone {
  if (status === 'live' || status === 'active') return 'ok'
  if (status === 'onboarding') return 'hot'
  if (status === 'suspended') return 'bad'
  return 'wait'
}

export function Stat({ label, value, hint, tone = 'ink' }: { label: string; value: ReactNode; hint?: string; tone?: 'ink' | 'hot' | 'bad' }) {
  const color = tone === 'hot' ? 'text-brass' : tone === 'bad' ? 'text-[#8f3b2e]' : 'text-deep'
  return (
    <div className="rounded-2xl bg-white px-4 py-3.5 shadow-[0_1px_3px_rgba(20,36,31,.05)]">
      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink/55">{label}</div>
      <div className={`font-display text-[22px] font-semibold leading-tight ${color}`}>{value}</div>
      {hint && <div className="text-[11.5px] text-ink/55">{hint}</div>}
    </div>
  )
}

export function Progress({ value, max, className = '' }: { value: number; max: number; className?: string }) {
  const pct = max === 0 ? 0 : Math.round((value / max) * 100)
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-[#e6ece7] ${className}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${pct === 100 ? 'bg-pine' : 'bg-brass'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export const fieldCls =
  'w-full rounded-xl border-[1.5px] border-hairline bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink/35 focus:border-pine focus:outline-none disabled:bg-paper disabled:text-ink/50'

export function AField({ label, hint, children, className = '' }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12.5px] font-semibold text-ink/60">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink/50">{hint}</span>}
    </label>
  )
}
export function AInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldCls} ${className}`} {...props} />
}
export function ASelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldCls} ${className}`} {...props} />
}
export function ATextarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldCls} min-h-[88px] ${className}`} {...props} />
}

export function ABtn({
  variant = 'primary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'warn' }) {
  const v = {
    primary: 'bg-pine text-white hover:bg-deep',
    ghost: 'bg-white text-deep shadow-[inset_0_0_0_1.5px_#E3E9E4] hover:bg-paper',
    warn: 'bg-brass text-white hover:bg-[#8f6a22]',
  }[variant]
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`}
      {...props}
    />
  )
}

export function ChipToggle({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
        on ? 'border-deep bg-deep text-white' : 'border-hairline bg-white text-ink/60 hover:border-ink/30'
      }`}
    >
      {children}
    </button>
  )
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-start gap-3 rounded-2xl bg-paper px-4 py-3 text-left"
      aria-pressed={on}
    >
      <span className={`relative mt-0.5 h-[22px] w-[38px] flex-none rounded-full transition-colors ${on ? 'bg-brass' : 'bg-[#ccd8d1]'}`}>
        <span className={`absolute top-[2.5px] h-[17px] w-[17px] rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-[2.5px]'}`} />
      </span>
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        {hint && <span className="block text-[12.5px] text-ink/55">{hint}</span>}
      </span>
    </button>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  const t = {
    info: 'bg-sage text-deep',
    ok: 'bg-sage text-deep',
    error: 'bg-[#f7e9e6] text-[#8f3b2e]',
  }[tone]
  return (
    <div className={`rounded-2xl px-4 py-3 text-[13px] ${t}`} role="status">
      {children}
    </div>
  )
}

/** The onboarding plan — ordered steps with the next one highlighted. */
export function Plan({ steps, title = 'Onboarding plan' }: { steps: Step[]; title?: string }) {
  const next = steps.find((s) => !s.done)
  const done = steps.filter((s) => s.done).length
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink/55">{title}</span>
        <span className="tabular text-xs text-ink/55">
          {done}/{steps.length}
        </span>
      </div>
      <Progress value={done} max={steps.length} className="mb-3" />
      <ol className="space-y-1.5">
        {steps.map((s) => (
          <li
            key={s.key}
            className={`flex gap-2.5 rounded-xl px-2.5 py-2 text-[13px] ${s === next ? 'bg-[#FBF3E2]' : ''}`}
          >
            <span
              aria-hidden
              className={`mt-0.5 grid size-[18px] flex-none place-items-center rounded-full text-[11px] font-bold ${
                s.done ? 'bg-pine text-white' : s === next ? 'bg-brass text-white' : 'bg-[#e6ece7] text-ink/40'
              }`}
            >
              {s.done ? '✓' : s === next ? '→' : ''}
            </span>
            <span className="min-w-0">
              <span className={`block font-semibold ${s.done ? 'text-ink/70 line-through decoration-ink/20' : ''}`}>{s.label}</span>
              <span className="block text-[12px] text-ink/55">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
