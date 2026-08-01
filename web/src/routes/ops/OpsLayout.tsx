import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import { useSession } from '@/lib/session'
import { Button } from '@/components/ui'

/**
 * Ops console shell. The role gate here is UX only — RLS and the Edge
 * Functions are the real enforcement; a corporate user who somehow lands on
 * /ops sees empty lists and gets 403s on save.
 */

const tabs = [
  { to: '/ops', label: 'Dashboard', end: true },
  { to: '/ops/vendors', label: 'Vendors' },
  { to: '/ops/corporates', label: 'Corporates' },
  { to: '/ops/money', label: 'Money' },
  { to: '/ops/diagnostics', label: 'Diagnostics' },
]

export function OpsLayout() {
  const { identity, loading } = useIdentity()
  const { signOut } = useSession()

  if (loading) return null
  if (!identity?.isOps) return <Navigate to="/" replace />

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-8 w-px bg-hairline" />
            <span aria-hidden className="size-1.5 rounded-full bg-brass" />
            <div>
              <span className="font-display text-lg leading-none">Corlington</span>
              <span className="ml-2 text-xs text-ink/50">ops console</span>
            </div>
          </div>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm ${
                    isActive
                      ? 'bg-sage font-medium text-deep'
                      : 'text-ink/70 hover:bg-sage/60'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
            <span className="mx-2 h-5 w-px bg-hairline" />
            <span className="mr-2 hidden text-xs text-ink/50 sm:inline">
              {identity.name} · {identity.opsRole}
            </span>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
