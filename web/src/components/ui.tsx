import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

/**
 * The handful of primitives M0 needs. Deliberately small — the real component
 * set grows with M2's portal shell, and inventing it now would be guessing.
 */

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50'
  const variants = {
    primary: 'bg-pine text-paper hover:bg-deep',
    ghost: 'border border-hairline bg-transparent text-ink hover:bg-sage',
    danger: 'border border-hairline bg-transparent text-ink hover:bg-sage',
  }
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />
}

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-md border border-hairline bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-pine focus:outline-none ${className}`}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink/70">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink/50">{hint}</span>}
    </label>
  )
}

export function Card({
  title,
  children,
  footer,
}: {
  title?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="rounded-lg border border-hairline bg-white">
      {title && (
        <header className="border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
        </header>
      )}
      <div className="px-4 py-3">{children}</div>
      {footer && (
        <footer className="border-t border-hairline bg-paper px-4 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  )
}

/** Pass/fail marker for the M0 diagnostics screen. */
export function Verdict({ pass, children }: { pass: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden
        className={`inline-block size-2 shrink-0 rounded-full ${
          pass ? 'bg-pine' : 'bg-brass'
        }`}
      />
      <span className={pass ? 'text-ink' : 'text-brass'}>{children}</span>
      <span className="sr-only">{pass ? '(pass)' : '(fail)'}</span>
    </span>
  )
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'error'
  children: ReactNode
}) {
  const tones = {
    info: 'border-hairline bg-sage text-ink',
    error: 'border-brass/40 bg-brass/10 text-ink',
  }
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`} role="status">
      {children}
    </div>
  )
}
