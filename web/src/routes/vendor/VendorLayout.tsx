import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import { useSession } from '@/lib/session'

/**
 * Vendor portal shell (Atlas). Hotels answer requests through the magic link
 * sent to their front office — this portal is the standing view around those
 * moments: what's coming, what's open, what Corlington owes them.
 *
 * Anonymity (F-004): nothing in this tree may name a corporate. RLS gives a
 * vendor login no path to the corporates table; the UI never tries.
 */

const tabs = [
  { to: '/vendor', label: 'Overview', end: true },
  { to: '/vendor/money', label: 'Settlements' },
]

export function VendorLayout() {
  const { identity, loading } = useIdentity()
  const { signOut } = useSession()

  if (loading) return null
  if (!identity || identity.actorType !== 'vendor_user') return <Navigate to="/" replace />

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-20 border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-[1120px] items-center gap-4 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-[7px] rounded-full bg-brass" />
            <span className="font-display text-lg font-semibold leading-none">Corlington</span>
            {identity.vendor && (
              <span className="hidden text-xs text-ink/50 sm:inline">{identity.vendor.name}</span>
            )}
          </div>
          <nav className="ml-2 flex items-center gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `rounded-[10px] px-3.5 py-2 text-[13.5px] font-semibold ${
                    isActive ? 'bg-sage text-deep' : 'text-ink/60 hover:bg-sage/60'
                  }`
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[12.5px] text-ink/50 md:inline">
              {identity.name} · front office
            </span>
            <button
              onClick={signOut}
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-ink/55 hover:bg-sage/60"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1120px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
