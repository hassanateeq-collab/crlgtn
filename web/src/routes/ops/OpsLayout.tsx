import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import { useSession } from '@/lib/session'

/**
 * Ops console shell (Atlas). The role gate here is UX only — RLS and the Edge
 * Functions are the real enforcement; a corporate user who somehow lands on
 * /ops sees empty lists and gets 403s on save.
 */

const tabs = [
  { to: '/ops', label: 'Dashboard', end: true },
  { to: '/ops/vendors', label: 'Supply' },
  { to: '/ops/corporates', label: 'Corporates' },
  { to: '/ops/money', label: 'Money' },
  { to: '/ops/team', label: 'Team' },
  { to: '/ops/diagnostics', label: 'Diagnostics' },
]

export function OpsLayout() {
  const { identity, loading } = useIdentity()
  const { signOut } = useSession()

  if (loading) return null
  if (!identity?.isOps) return <Navigate to="/" replace />

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-20 bg-ink text-white">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-[7px] rounded-full bg-brass" />
            <span className="font-display text-[17px] font-semibold leading-none">Corlington</span>
            <span className="ml-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#e8c789]">Ops</span>
          </div>
          <nav className="ml-3 hidden items-center gap-0.5 sm:flex">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
                    isActive ? 'bg-white/12 text-white' : 'text-[#b9cdc4] hover:text-white'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-[#9fb5ab] sm:inline">
              {identity.name} · {identity.opsRole === 'ops_admin' ? 'ops admin' : 'ops agent'}
            </span>
            <button
              onClick={signOut}
              className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-[#b9cdc4] hover:bg-white/10 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-6 py-7">
        <Outlet />
      </main>
    </div>
  )
}
