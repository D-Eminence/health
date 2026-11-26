import { useCallback, useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, staffApi } from '../../../staff/api'
import { learnFrom, newKey } from './dentalRules'

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and records nothing twice; any other body gets a key of its own, as
 * the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export interface IdempotencyKeys {
  (action: string, body: unknown): string
  /** Drops a body's key: a request that can never succeed as it was (a visit start across Lagos midnight). */
  forget(action: string, body: unknown): void
}
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keyFor] = useState<IdempotencyKeys>(() => {
    const keys = new Map<string, string>()
    const signature = (action: string, body: unknown) => `${action}\n${JSON.stringify(body)}`
    return Object.assign((action: string, body: unknown) => {
      let key = keys.get(signature(action, body))
      if (!key) {
        key = newKey()
        keys.set(signature(action, body), key)
      }
      return key
    }, { forget: (action: string, body: unknown) => { keys.delete(signature(action, body)) } })
  })
  return keyFor
}

/**
 * The names of this facility's members by membership id (hid-system SX-9, GET identity/facility-staff-names), for who
 * started a visit, saved a chart and signed a procedure. Read in one request for up to 100 ids, each id asked at most
 * once while the page is open; a failed read leaves the ids unnamed ("A staff member here"), never shown as an id.
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

export type Read<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly value: T }
  | { readonly phase: 'failed'; readonly caught: unknown }

/**
 * One read, made again whenever `key` changes or `reload` is called. Each answer or refusal of a dental route tells the
 * served store whether the dental routes are served here (dentalRules.ts learnFrom); `learn` false for any other route
 * (the waiting list), whose answers say nothing about it. The value read last stays on screen while the next read is on
 * its way.
 */
export function useDentalRead<T>(key: string, read: (() => Promise<T>) | null, learn = true): {
  readonly state: Read<T>
  readonly reload: () => Promise<void>
  readonly set: (value: T) => void
} {
  const [state, setState] = useState<{ key: string; read: Read<T> }>({ key, read: { phase: 'loading' } })
  const latest = useRef(read)
  latest.current = read
  const round = useRef(0)

  const reload = useCallback(async () => {
    const current = latest.current
    if (!current) return
    const mine = ++round.current
    try {
      const value = await current()
      if (learn) learnFrom()
      if (mine === round.current) setState({ key, read: { phase: 'ready', value } })
    } catch (caught) {
      if (learn) learnFrom(caught)
      if (mine === round.current) setState({ key, read: { phase: 'failed', caught } })
    }
  }, [key, learn])

  useEffect(() => {
    if (!latest.current) return
    setState(previous => previous.key === key ? previous : { key, read: { phase: 'loading' } })
    void reload()
  }, [key, reload])

  const set = useCallback((value: T) => { round.current += 1; setState({ key, read: { phase: 'ready', value } }) }, [key])
  return { state: state.key === key ? state.read : { phase: 'loading' }, reload, set }
}
