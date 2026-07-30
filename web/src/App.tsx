import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SessionProvider, useSession } from '@/lib/session'
import { IdentityProvider, useIdentity } from '@/lib/identity'
import { SignIn } from '@/routes/SignIn'
import { Foundations } from '@/routes/Foundations'
import { OpsLayout } from '@/routes/ops/OpsLayout'
import { Dashboard } from '@/routes/ops/Dashboard'
import { Vendors } from '@/routes/ops/Vendors'
import { VendorEditor } from '@/routes/ops/VendorEditor'
import { PropertyPage } from '@/routes/ops/PropertyPage'
import { Corporates } from '@/routes/ops/Corporates'
import { CorporateEditor } from '@/routes/ops/CorporateEditor'

function Home() {
  const { identity, loading } = useIdentity()
  if (loading) return null
  // Ops land in the console; corporates keep the diagnostics screen until the
  // M2 portal shell replaces it.
  if (identity?.isOps) return <Navigate to="/ops" replace />
  return <Foundations />
}

function Gate() {
  const { session, loading } = useSession()

  // Session restore is async on refresh; don't flash the sign-in screen.
  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-paper">
        <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-brass" />
        <span className="sr-only">Loading</span>
      </main>
    )
  }

  if (!session) return <SignIn />

  return (
    <IdentityProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ops" element={<OpsLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="vendors/new" element={<VendorEditor />} />
          <Route path="vendors/:id" element={<VendorEditor />} />
          <Route path="vendors/:id/page" element={<PropertyPage />} />
          <Route path="corporates" element={<Corporates />} />
          <Route path="corporates/new" element={<CorporateEditor />} />
          <Route path="corporates/:id" element={<CorporateEditor />} />
          <Route path="diagnostics" element={<Foundations />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </IdentityProvider>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </SessionProvider>
  )
}
