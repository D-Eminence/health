import { useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, staffApi } from '../../../staff/api'
import { newKey } from './inpatientRules'

export interface IdempotencyKeys {
  (action: string, body: unknown): string
  /**
   * Lets go of a request's key once its answer came: the same body sent later is a new request (a bed added again under
   * a name used before), not a retry, and gets a key of its own. A retry after a lost answer keeps its key.
   */
  readonly forget: (action: string, body: unknown) => void
}

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and records nothing twice; any other body gets a key of its own, as
 * the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keyFor] = useState(() => {
    const keys = new Map<string, string>()
    const signatureOf = (action: string, body: unknown) => `${action}\n${JSON.stringify(body)}`
    const forget = (action: string, body: unknown) => { keys.delete(signatureOf(action, body)) }
    return Object.assign((action: string, body: unknown) => {
      const signature = signatureOf(action, body)
      let key = keys.get(signature)
      if (!key) {
        key = newKey()
        keys.set(signature, key)
      }
      return key
    }, { forget })
  })
  return keyFor
}

/**
 * The names of this facility's members by membership id (hid-system SX-9, GET identity/facility-staff-names), for the
 * responsible doctor and who recorded each movement. Read in one request for up to 100 ids, each id asked at most once
 * while the page is open; a failed read leaves the ids unnamed ("A staff member here"), never shown as an id.
 */
export function useStaffNames(facilityId: string, ids: readonly (string | null | undefined)[]): ReadonlyMap<string, string | null> {
  const asked = useRef({ facilityId, ids: new Set<string>() })
  const [names, setNames] = useState<{ facilityId: string; known: ReadonlyMap<string, string | null> }>({ facilityId, known: new Map() })
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)).map(id => id.toLowerCase()))].sort().join(',')

  useEffect(() => {
    if (!facilityId || !wanted) return
    if (asked.current.facilityId !== facilityId) asked.current = { facilityId, ids: new Set() }
    const missing = wanted.split(',').filter(id => !asked.current.ids.has(id)).slice(0, FACILITY_STAFF_NAMES_MAX_IDS)
    if (missing.length === 0) return
    for (const id of missing) asked.current.ids.add(id)
    void staffApi.facilityStaffNames(facilityId, missing).then(answer => {
      setNames(previous => {
        const known = new Map(previous.facilityId === facilityId ? previous.known : [])
        for (const member of answer.staff) known.set(member.membershipId.toLowerCase(), member.name)
        return { facilityId, known }
      })
    }, () => { /* left unnamed */ })
  }, [facilityId, wanted])

  return names.facilityId === facilityId ? names.known : EMPTY
}

const EMPTY: ReadonlyMap<string, string | null> = new Map()

/** Read again every `every` ms while the page is shown, and when it comes back on screen; a hidden tab waits. */
export function usePolling(refresh: () => unknown, every: number) {
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh()
    }, every)
    const shown = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', shown)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [refresh, every])
}
