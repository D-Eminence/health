import { useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, staffApi } from '../../../staff/api'
import { newKey } from './referralRules'

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and records nothing twice; any other body gets a key of its own, as
 * the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export function useIdempotencyKeys(): (action: string, body: unknown) => string {
  const [keyFor] = useState(() => {
    const keys = new Map<string, string>()
    return (action: string, body: unknown) => {
      const signature = `${action}\n${JSON.stringify(body)}`
      let key = keys.get(signature)
      if (!key) {
        key = newKey()
        keys.set(signature, key)
      }
      return key
    }
  })
  return keyFor
}

/**
 * The names of this facility's members by membership id (hid-system SX-9, GET identity/facility-staff-names), for who
 * did each step of a referral here. One request for up to 100 ids, each asked at most once while the page is open; a
 * failed read leaves them unnamed ("A staff member here"), never shown as an id. The other facility's members are never
 * named: their steps say the facility.
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
