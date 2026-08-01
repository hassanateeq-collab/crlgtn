import { NavLink, Navigate, Outlet } from 'react-router-dom'
import { useIdentity } from '@/lib/identity'
import { useSession } from '@/lib/session'
import { Button } from '@/components/ui'

/**
 * Corporate portal shell (spec §9): topbar with the company's own name front
 * and center. The booking-file spine lives inside the file editor, not here —
 * it belongs to a file, not to the app.
 */

export function PortalLayout() {
  const { identity, loading } = useIdentity()
  const { signOut } = useSession()

  if (loading) return null
  // Ops have their own console; anyone unresolved goes back to the gate.
  if (!identity || identity.isOps) return <Navigate to="/" replace />

  return (
    <div className="min-h-svh bg-paper">
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span aria-hidden className="size-1.5 rounded-full bg-brass" />
            <div>
              <span className="font-display text-lg leading-none">Corlington</span>
              {identity.corporate && (
                <span className="ml-2 text-xs text-ink/50">{identity.corporate.name}</span>
              )}
            </div>
          </div>
          <nav className="flex items-center gap-1">
            <NavLink
              to="/files"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? 'bg-sage font-medium text-deep' : 'text-ink/70 hover:bg-sage/60'
                }`
              }
            >
              Booking files
            </NavLink>
            <NavLink
              to="/invoices"
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${
                  isActive ? 'bg-sage font-medium text-deep' : 'text-ink/70 hover:bg-sage/60'
                }`
              }
            >
              Invoices
            </NavLink>
            <span className="mx-2 h-5 w-px bg-hairline" />
            <span className="mr-2 hidden text-xs text-ink/50 sm:inline">
              {identity.name} · {identity.corporateRole?.replace('corp_', '')}
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
