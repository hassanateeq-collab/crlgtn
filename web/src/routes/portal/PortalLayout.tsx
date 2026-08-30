import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import { useSession } from '@/lib/session'

/**
 * Corporate portal shell (Atlas): the company's own name beside the brand,
 * pill navigation, booker identity on the right. The booking-file spine lives
 * inside the file editor, not here — it belongs to a file, not to the app.
 */

const tabs = [
  { to: '/files', label: 'Booking files' },
  { to: '/transfers', label: 'Transfers' },
  { to: '/invoices', label: 'Invoices' },
]

export function PortalLayout() {
  const { identity, loading } = useIdentity()
  const { signOut } = useSession()

  if (loading) return null
  if (!identity || identity.isOps) return <Navigate to="/" replace />

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-20 border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-[1120px] items-center gap-4 px-6 py-3.5">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-[7px] rounded-full bg-brass" />
            <span className="font-display text-lg font-semibold leading-none">Corlington</span>
            {identity.corporate && (
              <span className="hidden text-xs text-ink/50 sm:inline">{identity.corporate.name}</span>
            )}
          </div>
          <nav className="ml-2 flex items-center gap-1">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
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
              {identity.name} · {identity.corporateRole?.replace('corp_', '')}
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
