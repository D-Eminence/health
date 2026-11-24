import { useCallback, useEffect, useRef, useState } from 'react'
import { staffApi } from '../../../staff/api'
import type { AcceptorName } from './pharmacyText'

/** A member's name by membership id, as SX-9 answers it (AcceptorName); undefined on any failure or when there is no row. */
export type StaffNameLookup = (membershipId: string) => Promise<AcceptorName>

/**
 * Names for "Accepted by <name>" (ORD-4) from GET /identity/facility-staff-names (hid-system SX-9), one membership id per
 * read, each asked at most once while the page is open: the answer is kept, a failure too, so nothing is asked twice.
 * Nothing is read until a lookup is called, and the record calls it only when it has an acceptance to show.
 */
export function useStaffNameLookup(facilityId: string): StaffNameLookup {
  const asked = useRef(new Map<string, Promise<AcceptorName>>())
  return useCallback((membershipId: string) => {
    const id = membershipId.toLowerCase()
    const key = `${facilityId}\n${id}`
    let found = asked.current.get(key)
    if (!found) {
      found = staffApi.facilityStaffNames(facilityId, [membershipId])
        .then(answer => {
          const row = answer.staff.find(member => member.membershipId.toLowerCase() === id)
          return row ? row.name : undefined
        }, () => undefined)
      asked.current.set(key, found)
    }
    return found
  }, [facilityId])
}

/**
 * The name for one acceptance's membership id, once known; undefined while it is asked, when it can't be read, with no
 * id, or with no lookup.
 */
export function useAcceptorName(lookup: StaffNameLookup | undefined, membershipId: string | null | undefined): AcceptorName {
  const [known, setKnown] = useState<{ id: string; name: AcceptorName } | null>(null)
  useEffect(() => {
    if (!lookup || !membershipId) return
    let alive = true
    void lookup(membershipId).then(name => { if (alive) setKnown({ id: membershipId, name }) })
    return () => { alive = false }
  }, [lookup, membershipId])
  return known && known.id === membershipId ? known.name : undefined
}
