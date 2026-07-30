import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { SessionProvider, useSession } from '@/lib/session'
import { SignIn } from '@/routes/SignIn'
import { Foundations } from '@/routes/Foundations'

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
    <Routes>
      <Route path="/" element={<Foundations />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
