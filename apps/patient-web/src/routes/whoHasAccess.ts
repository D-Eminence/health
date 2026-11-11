import type { AccessHistory } from '../api'

/**
 * "Who has access" on Access & sharing, counted and grouped the way the patient reads it. Each access (one row) is one
 * staff member's at one facility: Identity ties every grant to one staff member (consent_grants.staff_id is required).
 * The list does not say which staff member unless the access came from the patient's own share (clinicianName,
 * hid-system 0095), and it never says their role, so rows are not counted as people: one staff member can hold two.
 * Facilities are told apart by name, as the list carries no facility id.
 */
export type AccessItem = AccessHistory['items'][number]

/** Access open now, as the backend says it (an access past its end reads 'expired'). */
export const isOpen = (item: AccessItem) => item.status === 'active'

const facilityOf = (item: AccessItem) => item.facilityName.trim()

/** The facilities with access open now, each once, in the list's order. */
export function facilitiesWithAccess(items: readonly AccessItem[]): string[] {
  return [...new Set(items.filter(isOpen).map(facilityOf))]
}

/** The card's heading: the facility by name when only one has access, else how many facilities. */
export function whoHasAccessTitle(items: readonly AccessItem[]): string {
  const facilities = facilitiesWithAccess(items)
  if (facilities.length === 0) return 'No one has access now'
  return facilities.length === 1 ? `${facilities[0]} has access now` : `${facilities.length} facilities have access now`
}

export interface FacilityGroup {
  facility: string
  items: AccessItem[]
  /** How many of its rows are open now, and how many have ended. */
  open: number
  past: number
}

/** The list under one heading per facility, in the order the list first names each; rows keep their order. */
export function groupByFacility(items: readonly AccessItem[]): FacilityGroup[] {
  const groups = new Map<string, AccessItem[]>()
  for (const item of items) groups.set(facilityOf(item), [...(groups.get(facilityOf(item)) ?? []), item])
  return [...groups].map(([facility, rows]) => {
    const open = rows.filter(isOpen).length
    return { facility, items: rows, open, past: rows.length - open }
  })
}

/** "4 active · 1 past": what a facility's heading says about its rows. */
export function groupCounts(group: Pick<FacilityGroup, 'open' | 'past'>): string {
  return [group.open ? `${group.open} active` : '', group.past ? `${group.past} past` : ''].filter(Boolean).join(' · ')
}

/** The staff member's name where the list gives it (the patient's own share), else nothing. */
export function staffName(item: AccessItem): string | null {
  return typeof item.clinicianName === 'string' && item.clinicianName.trim() ? item.clinicianName.trim() : null
}

/** Who holds an access, under its facility's heading: the staff member by name, or "A staff member" when not named. */
export function holder(item: AccessItem): string {
  return staffName(item) ?? 'A staff member'
}
