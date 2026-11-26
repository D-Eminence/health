import { useEffect, useRef, useState } from 'react'
import { FACILITY_STAFF_NAMES_MAX_IDS, staffApi, workforceApi, type FacilityStaffName } from '../../../staff/api'
import { learnFrom, newKey } from './rosterRules'

/**
 * One Idempotency-Key per request body: the same body sent again (a retry after a lost answer) carries the same key, so
 * the server answers its first answer ("replayed") and records nothing twice; any other body gets a key of its own, as
 * the server refuses a key reused for another body (IDEMPOTENCY_KEY_REUSED). In memory for the page's life only.
 */
export type IdempotencyKeys = (action: string, body: unknown) => string
export function useIdempotencyKeys(): IdempotencyKeys {
  const [keyFor] = useState<IdempotencyKeys>(() => {
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

const EMPTY: ReadonlyMap<string, string | null> = new Map()

/**
 * The names of this facility's members by membership id (hid-system SX-9), for who is on a duty, who is in charge and
 * whose leave it is. Each id is asked at most once while the page is open; a failed read leaves the ids unnamed ("A staff
 * member here"), never shown as an id. Names only.
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

/**
 * Everyone who works at the facility now, by name (SX-9 without ids, up to 500), read once when `wanted`: the choices
 * for a roster's duties, an in-charge and who covered a shift. Only members whose name is known are offered; nobody is
 * offered by id. `failed` when the read was refused: the page then offers no one and says so.
 */
export function useCurrentMembers(facilityId: string, wanted: boolean): { members: readonly FacilityStaffName[]; failed: boolean; loaded: boolean } {
  const [state, setState] = useState<{ facilityId: string; members: readonly FacilityStaffName[]; failed: boolean; loaded: boolean }>(
    { facilityId, members: [], failed: false, loaded: false })
  useEffect(() => {
    if (!wanted || !facilityId) return
    let alive = true
    workforceApi.members(facilityId).then(
      answer => { if (alive) setState({ facilityId, members: answer.staff.filter(member => member.current && member.name), failed: false, loaded: true }) },
      () => { if (alive) setState({ facilityId, members: [], failed: true, loaded: true }) })
    return () => { alive = false }
  }, [facilityId, wanted])
  return state.facilityId === facilityId ? state : { members: [], failed: false, loaded: false }
}

/** The names `useStaffNames` read, with the current members' names added. */
export function withMembers(names: ReadonlyMap<string, string | null>, members: readonly FacilityStaffName[]): ReadonlyMap<string, string | null> {
  if (members.length === 0) return names
  const all = new Map(names)
  for (const member of members) if (!all.has(member.membershipId.toLowerCase())) all.set(member.membershipId.toLowerCase(), member.name)
  return all
}

/**
 * The facility's profile departments (route 6's list), for whose in-charge decides a leave request and the decider's
 * filter. A refused read leaves only "An administrator".
 */
export function useDepartments(facilityId: string): readonly string[] {
  const [departments, setDepartments] = useState<readonly string[]>([])
  useEffect(() => {
    let alive = true
    workforceApi.inCharges(facilityId).then(
      answer => { if (alive) setDepartments(answer.departments.map(item => item.departmentCode)) },
      caught => { learnFrom(facilityId, caught) })
    return () => { alive = false }
  }, [facilityId])
  return departments
}

