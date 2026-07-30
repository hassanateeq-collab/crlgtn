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
 * Who the platform says we are — resolved once per session via ef_whoami and
 * used for routing (ops → console, corporate → portal). The server, not the
 * client, decides the actor type; this is just a cache of its answer.
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
  const [state, setState] = useState<IdentityState>({
    identity: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    if (!session) {
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
  }, [session])

  return <IdentityContext.Provider value={state}>{children}</IdentityContext.Provider>
}

export const useIdentity = () => useContext(IdentityContext)
