import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

/**
 * Session state, hydrated once and then kept current by Supabase's auth events.
 *
 * `loading` matters: on a hard refresh the session is restored asynchronously
 * from storage, and rendering the sign-in screen during that gap would bounce a
 * signed-in booker out of a draft file.
 *
 * Auth events are noisy: supabase-js re-emits SIGNED_IN every time the tab
 * regains focus, TOKEN_REFRESHED on every token rotation, and it relays both
 * from other tabs. Each carries a fresh Session object for the same user, and
 * publishing every one of them re-rendered the whole tree as if the user had
 * just signed in — pages unmounted, drafts vanished, every list refetched. So
 * the stored session only changes when something the app actually keys on
 * changes: who is signed in, or whether anyone is.
 */

const sameSession = (a: Session | null, b: Session | null) =>
  a === b || (!!a && !!b && a.user.id === b.user.id && a.access_token === b.access_token)

interface SessionState {
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession((cur) => (sameSession(cur, data.session) ? cur : data.session))
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession((cur) => (sameSession(cur, next) ? cur : next))
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  return (
    <SessionContext.Provider value={{ session, loading, signOut }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>')
  return ctx
}
