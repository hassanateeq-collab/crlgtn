import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { VendorRespond } from '@/routes/VendorRespond'
import { SessionProvider, useSession } from '@/lib/session'
import { IdentityProvider, useIdentity } from '@/lib/identity'
import { SignIn } from '@/routes/SignIn'
import { Foundations } from '@/routes/Foundations'
import { OpsLayout } from '@/routes/ops/OpsLayout'
import { Dashboard } from '@/routes/ops/Dashboard'
import { Supply } from '@/routes/ops/Supply'
import { VendorEditor } from '@/routes/ops/VendorEditor'
import { PropertyPage } from '@/routes/ops/PropertyPage'
import { Corporates } from '@/routes/ops/Corporates'
import { CorporateEditor } from '@/routes/ops/CorporateEditor'
import { Money } from '@/routes/ops/Money'
import { Leads } from '@/routes/ops/Leads'
import { Team } from '@/routes/ops/Team'
import { Invoices } from '@/routes/portal/Invoices'
import { PortalLayout } from '@/routes/portal/PortalLayout'
import { Files } from '@/routes/portal/Files'
import { FileEditor } from '@/routes/portal/FileEditor'
import { Results } from '@/routes/portal/Results'
import { Transfers } from '@/routes/portal/Transfers'

function Home() {
  const { identity, loading } = useIdentity()
  if (loading) return null
  // Ops land in the console; corporate users in the portal.
  if (identity?.isOps) return <Navigate to="/ops" replace />
  return <Navigate to="/files" replace />
}

function Gate() {
  const { session, loading } = useSession()
  const location = useLocation()

  // The vendor magic-link page is public by design: hotels hold no accounts in
  // MVP, the URL token is the credential. It must never bounce to sign-in.
  // `/r/` is the live path (short enough to read off a phone in WhatsApp);
  // `/respond/` stays as an alias so links already sent keep resolving.
  if (location.pathname.startsWith('/r/') || location.pathname.startsWith('/respond/')) {
    return (
      <Routes>
        <Route path="/r/:token" element={<VendorRespond />} />
        <Route path="/respond/:token" element={<VendorRespond />} />
      </Routes>
    )
  }

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
        <Route element={<PortalLayout />}>
          <Route path="/files" element={<Files />} />
          <Route path="/files/new" element={<FileEditor />} />
          <Route path="/files/:id" element={<FileEditor />} />
          <Route path="/files/:id/results" element={<Results />} />
          <Route path="/property/:id" element={<PropertyPage />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/transfers" element={<Transfers />} />
        </Route>
        <Route path="/ops" element={<OpsLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="vendors" element={<Supply />} />
          <Route path="vendors/new" element={<VendorEditor />} />
          <Route path="vendors/:id" element={<VendorEditor />} />
          <Route path="vendors/:id/page" element={<PropertyPage />} />
          <Route path="corporates" element={<Corporates />} />
          <Route path="corporates/new" element={<CorporateEditor />} />
          <Route path="corporates/:id" element={<CorporateEditor />} />
          <Route path="money" element={<Money />} />
          <Route path="leads" element={<Leads />} />
          <Route path="team" element={<Team />} />
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
