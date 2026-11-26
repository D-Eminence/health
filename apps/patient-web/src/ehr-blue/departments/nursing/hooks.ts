import { useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, staffApi } from '../../../staff/api'
import { newKey } from './nursingRules'

/**
 * One Idempotency-Key per request body until the server accepts it: the same body sent again after a lost answer or a
 * refusal (a retry) carries the same key, so the server answers its first answer ("replayed") and records nothing
 * twice. Once a request succeeds its key is forgotten, so the same body sent again after that (a second 500 mL bag at
 * the same minute, a shift added again) is a new request with a key of its own. Any other body gets a key of its own,
 * as the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export interface IdempotencyKeys {
  /** The key for this body: the same one until a request sent with it succeeds. */
  (action: string, body: unknown): string
  /** Sends the request with the body's key, and forgets the key once the request succeeds. */
  send<T>(action: string, body: unknown, request: (key: string) => Promise<T>): Promise<T>
}
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keyFor] = useState<IdempotencyKeys>(() => {
    const keys = new Map<string, string>()
    const signature = (action: string, body: unknown) => `${action}\n${JSON.stringify(body)}`
    const keyFor = (action: string, body: unknown) => {
      const asked = signature(action, body)
      let key = keys.get(asked)
      if (!key) {
        key = newKey()
        keys.set(asked, key)
      }
      return key
    }
    return Object.assign(keyFor, {
      async send<T>(action: string, body: unknown, request: (key: string) => Promise<T>): Promise<T> {
        const key = keyFor(action, body)
        const answer = await request(key)
        const asked = signature(action, body)
        if (keys.get(asked) === key) keys.delete(asked)
        return answer
      },
    })
  })
  return keyFor
}

/**
 * The names of this facility's members by membership id (hid-system SX-9), for who a task is for, who is on a shift and
 * who recorded a dose. Each id is asked at most once while the page is open; a failed read leaves the ids unnamed ("A
 * staff member here"), never shown as an id.
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
