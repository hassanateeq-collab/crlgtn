import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One polling primitive for every live board in the app.
 *
 * Guarantees, so no screen has to re-derive them:
 *  - exactly one timer per hook instance — restarting (deps / interval / live
 *    change, StrictMode double-mount) always clears the previous one first;
 *  - no overlapping loads — a tick that fires while a fetch is still in flight
 *    is skipped instead of stacking a second request;
 *  - no stale writes — every load carries a generation number, and a result
 *    whose generation is no longer current (unmounted, key changed, or a newer
 *    manual refresh started meanwhile) is dropped on the floor. Out-of-order
 *    responses can therefore never overwrite fresher data;
 *  - polling pauses while the tab is hidden and refreshes the moment it is
 *    visible again, so a background tab neither hammers the API nor shows a
 *    minutes-old board when the user comes back;
 *  - `refresh()` after a mutation supersedes any in-flight poll, so what the
 *    user just did is what the board shows next.
 *
 * The fetcher returns the whole snapshot; the hook commits it as one state
 * update, so related lists (files + offers, say) never render half-updated.
 */

interface PollingOptions {
  /** Poll interval in milliseconds. */
  intervalMs: number
  /** Keep polling while true; the initial load always runs regardless. Default true. */
  live?: boolean
  /** Suspend polling while `document.hidden`. Default true. */
  pauseWhenHidden?: boolean
}

interface PollingState<T> {
  data: T | null
  error: string | null
  /** Force a fresh load now; resolves when it has been committed (or dropped). */
  refresh: () => Promise<void>
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  key: readonly unknown[],
  { intervalMs, live = true, pauseWhenHidden = true }: PollingOptions,
): PollingState<T> {
  // The snapshot remembers which key it belongs to, so a key change exposes
  // `null` on the very same render instead of one frame of the old record.
  const [snapshot, setSnapshot] = useState<{ key: string; data: T } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const keyString = JSON.stringify(key)
  const keyRef = useRef(keyString)
  keyRef.current = keyString

  // Always call the latest fetcher without making it a dependency — the
  // callers define it inline, and re-arming the timer on every render is
  // exactly the duplicate-interval bug this hook exists to prevent.
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const generation = useRef(0)
  const inFlight = useRef(false)
  const timer = useRef<number | null>(null)

  const run = useCallback(async (force: boolean) => {
    if (inFlight.current && !force) return
    const mine = ++generation.current
    inFlight.current = true
    try {
      const next = await fetcherRef.current()
      if (mine !== generation.current) return
      setSnapshot({ key: keyRef.current, data: next })
      setError(null)
    } catch (err: unknown) {
      if (mine !== generation.current) return
      setError(err instanceof Error ? err.message : 'Could not refresh')
    } finally {
      if (mine === generation.current) inFlight.current = false
    }
  }, [])

  useEffect(() => {
    // Local aliases: these refs hold mutable bookkeeping, not DOM nodes, and
    // the cleanup deliberately reads their latest value.
    const gen = generation
    const flight = inFlight

    const stop = () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }
    const start = () => {
      stop()
      timer.current = window.setInterval(() => void run(false), intervalMs)
    }

    void run(true)

    if (!live) {
      return () => {
        gen.current++
        flight.current = false
      }
    }

    const hidden = () => pauseWhenHidden && document.visibilityState === 'hidden'
    if (!hidden()) start()

    const onVisibility = () => {
      if (hidden()) {
        stop()
      } else {
        void run(true)
        start()
      }
    }
    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisibility)
      // Invalidate anything still in flight so it cannot land after cleanup.
      gen.current++
      flight.current = false
    }
  }, [keyString, live, intervalMs, pauseWhenHidden, run])

  const refresh = useCallback(() => run(true), [run])

  const data = snapshot !== null && snapshot.key === keyString ? snapshot.data : null
  return { data, error, refresh }
}
