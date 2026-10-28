import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { PatientResourcesContext } from '../resourceCache'

/**
 * A patient read for a page. The last answer for the account signed in is kept in memory (resourceCache.ts), keyed
 * by `key` (the load itself unless given), so a page opened again shows it at once, with no loading state, while it
 * reads again; `loading` is still true until the new answer is in.
 */
export function usePatientResource<T>(load: (signal?: AbortSignal) => Promise<T>, key: unknown = load) {
  const resources = useContext(PatientResourcesContext)
  const account = resources?.account ?? null
  const [data, setData] = useState<T | null>(() => (resources?.cache.read(key, account)?.value as T | undefined) ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  // A reload settles once the load it asked for has, so an action that reloads is
  // finished only when its outcome is on screen.
  const requested = useRef(0)
  const waiting = useRef<Array<{ version: number; settle: () => void }>>([])
  const reload = useCallback(() => new Promise<void>(settle => {
    requested.current += 1
    waiting.current.push({ version: requested.current, settle })
    setVersion(requested.current)
  }), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void load(controller.signal).then(value => {
      if (controller.signal.aborted) return
      setData(value)
      resources?.cache.write(key, account, value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(isHidApiError(reason) ? reason.message : 'We could not load this information.')
    }).finally(() => {
      if (controller.signal.aborted) return
      setLoading(false)
      const settled = waiting.current.filter(entry => entry.version <= version)
      waiting.current = waiting.current.filter(entry => entry.version > version)
      for (const entry of settled) entry.settle()
    })
    return () => controller.abort()
  }, [load, version, resources, key, account])

  return { data, loading, error, reload }
}
