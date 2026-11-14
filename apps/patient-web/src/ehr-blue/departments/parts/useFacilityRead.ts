import { useCallback, useEffect, useRef, useState } from 'react'
import { errorText } from './errors'

/**
 * One read for the working facility, as today's work lists make it
 * (staff/routes/Operations.tsx useFacilityRead): read when the facility or the
 * permission changes, read again on `refresh`, and an answer for an earlier facility
 * or an earlier request is dropped. What was read stays shown while it is read again.
 */
export function useFacilityRead<T>(facilityId: string | undefined, enabled: boolean, loader: (id: string) => Promise<T>, fallback = 'Work could not be loaded.') {
  const [result, setResult] = useState<{ facilityId: string; value: T | null; loading: boolean; error: string; caught: unknown }>(
    { facilityId: '', value: null, loading: false, error: '', caught: null })
  const epoch = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++epoch.current
    if (!facilityId || !enabled) return
    setResult(previous => ({ facilityId, value: previous.facilityId === facilityId ? previous.value : null, loading: true, error: '', caught: null }))
    try {
      const value = await loader(facilityId)
      if (epoch.current === request) setResult({ facilityId, value, loading: false, error: '', caught: null })
    } catch (caught) {
      if (epoch.current === request) setResult(previous => ({ facilityId, value: previous.facilityId === facilityId ? previous.value : null, loading: false,
        error: errorText(caught, fallback), caught }))
    }
  }, [facilityId, enabled, loader, fallback])
  useEffect(() => {
    if (enabled && facilityId) void refresh()
    return () => { epoch.current += 1 }
  }, [facilityId, enabled, refresh])
  const current = result.facilityId === facilityId
  return {
    value: current ? result.value : null,
    loading: !current || result.loading,
    error: current ? result.error : '',
    /** The refusal itself, for a page that says something particular about it. */
    caught: current ? result.caught : null,
    refresh,
  }
}
