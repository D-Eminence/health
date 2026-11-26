import { useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, qualityApi, staffApi, type FacilityStaffName } from '../../../staff/api'
import { newKey } from './qualityRules'

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and records nothing twice; any other body gets a key of its own, as
 * the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export type IdempotencyKeys = (step: string, body: unknown) => string
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keyFor] = useState<IdempotencyKeys>(() => {
    const keys = new Map<string, string>()
    return (step: string, body: unknown) => {
      const signature = `${step}\n${JSON.stringify(body)}`
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

export interface StaffDirectory {
  /** This facility's current members, by name, to choose a reviewer, an action's owner or a lead from. */
  readonly current: readonly FacilityStaffName[]
  /** Names by lower-cased membership id; null for a deleted login ("Former staff member"). */
  readonly names: ReadonlyMap<string, string | null>
  readonly loaded: boolean
  readonly failed: boolean
}

/**
 * The facility's staff names (hid-system SX-9, GET identity/facility-staff-names): read once, with no ids, for the
 * pickers (current members first, up to 500), and again by id for anyone shown here the first read did not name (when
 * the facility has more than 500 members). Each id is asked at most once while the page is open; a failed read leaves
 * a member unnamed ("A staff member here"), never shown as an id. `wanted` false reads nothing (the reporter's view).
 */
export function useStaffDirectory(facilityId: string, ids: readonly (string | null | undefined)[], wanted = true): StaffDirectory {
  const [state, setState] = useState<{ facilityId: string; current: readonly FacilityStaffName[]; names: ReadonlyMap<string, string | null>;
    loaded: boolean; failed: boolean; complete: boolean }>(
    () => ({ facilityId, current: [], names: new Map(), loaded: false, failed: false, complete: true }))
  const asked = useRef({ facilityId, ids: new Set<string>(), listed: false })
  const missing = [...new Set(ids.filter((id): id is string => Boolean(id)).map(id => id.toLowerCase()))].sort().join(',')

  useEffect(() => {
    if (!wanted || !facilityId) return
    if (asked.current.facilityId !== facilityId) asked.current = { facilityId, ids: new Set(), listed: false }
    if (asked.current.listed) return
    asked.current.listed = true
    let alive = true
    qualityApi.staffChoices(facilityId).then(answer => {
      if (!alive) return
      const names = new Map<string, string | null>()
      for (const member of answer.staff) names.set(member.membershipId.toLowerCase(), member.name)
      setState(previous => ({ facilityId, current: answer.staff.filter(member => member.current && member.name),
        names: new Map([...(previous.facilityId === facilityId ? previous.names : []), ...names]), loaded: true, failed: false,
        complete: answer.complete }))
    }, () => {
      if (alive) setState(previous => ({ ...previous, facilityId, loaded: true, failed: true, complete: false }))
    })
    return () => { alive = false }
  }, [facilityId, wanted])

  useEffect(() => {
    if (!wanted || !facilityId || !missing || !state.loaded || state.facilityId !== facilityId) return
    const unnamed = missing.split(',').filter(id => !state.names.has(id) && !asked.current.ids.has(id))
    if (state.complete && !state.failed) return
    const ask = unnamed.slice(0, FACILITY_STAFF_NAMES_MAX_IDS)
    if (ask.length === 0) return
    for (const id of ask) asked.current.ids.add(id)
    void staffApi.facilityStaffNames(facilityId, ask).then(answer => {
      setState(previous => {
        if (previous.facilityId !== facilityId) return previous
        const names = new Map(previous.names)
        for (const member of answer.staff) names.set(member.membershipId.toLowerCase(), member.name)
        return { ...previous, names }
      })
    }, () => { /* left unnamed */ })
  }, [facilityId, missing, wanted, state.loaded, state.complete, state.failed, state.facilityId, state.names])

  return state.facilityId === facilityId
    ? { current: state.current, names: state.names, loaded: state.loaded, failed: state.failed }
    : { current: [], names: new Map(), loaded: false, failed: false }
}
