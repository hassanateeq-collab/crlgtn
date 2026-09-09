import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { useSession } from './session'
import { whoami, type WhoAmI } from './api'

/**
 * Who the platform says we are — resolved once per signed-in user via
 * ef_whoami and used for routing (ops → console, corporate → portal). The
 * server, not the client, decides the actor type; this is just a cache of its
 * answer.
 *
 * Keyed on the user id, not the Session object: a token refresh or a tab
 * regaining focus yields a new Session for the same person, and re-resolving
 * (with `loading` flipping true) would blank every layout and unmount the
 * page the user was on.
 */

interface IdentityState {
  identity: WhoAmI | null
  loading: boolean
  error: string | null
}

const IdentityContext = createContext<IdentityState>({
  identity: null,
  loading: true,
  error: null,
})

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  const [state, setState] = useState<IdentityState>({
    identity: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    if (!userId) {
      setState({ identity: null, loading: false, error: null })
      return
    }
    setState((s) => ({ ...s, loading: true }))
    whoami()
      .then((identity) => {
        if (!cancelled) setState({ identity, loading: false, error: null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            identity: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Could not resolve identity',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  return <IdentityContext.Provider value={state}>{children}</IdentityContext.Provider>
}

export const useIdentity = () => useContext(IdentityContext)
