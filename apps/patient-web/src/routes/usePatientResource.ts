import { useCallback, useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'

export function usePatientResource<T>(load: (signal?: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion(value => value + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void load(controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(reason => {
      if (!controller.signal.aborted) setError(isHidApiError(reason) ? reason.message : 'We could not load this information.')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [load, version])

  return { data, loading, error, reload }
}
