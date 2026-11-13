import { useSyncExternalStore } from 'react'
import type { Actor } from '../staff/api'
import type { StaffProductKey } from '../productHostname'
import { BLUE_FOR_ALL } from './clinicSwitch'
import { PAGE_FILES } from './pageSets'

/** The clinic switch, set in its own one-line module (clinicSwitch.ts) so that tests can turn it. */
export { BLUE_FOR_ALL }

/**
 * Who opens the blue Hospital EHR. It is on for every facility once the clinic switch is set (clinicSwitch.ts) and both
 * the clinical pages (clinical/pages.ts) and the department pages (departments/pages.ts) are merged; until then only
 * for the four facilities of the sealed demo tenant, and every other facility keeps today's provider workspace,
 * unchanged. The ids are Identity's facility ids, not names: a facility renamed "Demo" elsewhere is not one of these.
 */
export const BLUE_FACILITIES = [
  { id: '98d00002-0000-4000-8000-000000000001', name: 'Demo Hospital' },
  { id: '98d00002-0000-4000-8000-000000000002', name: 'Demo Laboratory' },
  { id: '98d00002-0000-4000-8000-000000000003', name: 'Demo Pharmacy' },
  { id: '98d00002-0000-4000-8000-000000000004', name: 'Demo Outreach' },
] as const

const BLUE_IDS: ReadonlySet<string> = new Set(BLUE_FACILITIES.map(facility => facility.id))

/**
 * The staff sites each demo facility works on, its primary site first (owner, 2026-10-31: each product on its own
 * site, productSites.ts). Demo Hospital also works on the Migrate site (owner: the demo staff login works on every
 * product site, Migrate included); every other demo facility works on its one site only.
 */
const DEMO_FACILITY_SITES: ReadonlyMap<string, ReadonlySet<StaffProductKey>> = new Map([
  ['98d00002-0000-4000-8000-000000000001', new Set<StaffProductKey>(['ehr', 'migrate'])],
  ['98d00002-0000-4000-8000-000000000002', new Set<StaffProductKey>(['lab'])],
  ['98d00002-0000-4000-8000-000000000003', new Set<StaffProductKey>(['pharmacy'])],
  ['98d00002-0000-4000-8000-000000000004', new Set<StaffProductKey>(['outreach'])],
])

function demoSitesOf(id: string | null | undefined): ReadonlySet<StaffProductKey> | null {
  return typeof id === 'string' ? DEMO_FACILITY_SITES.get(id.toLowerCase()) ?? null : null
}

/**
 * The primary staff site a demo facility works on (Demo Hospital's is the EHR site); null for any other facility,
 * which works on the site it is opened on.
 */
export function demoFacilitySite(id: string | null | undefined): StaffProductKey | null {
  const sites = demoSitesOf(id)
  return sites ? sites.values().next().value ?? null : null
}

/**
 * The staff site a demo facility opened on the staff site `here` must be sent to: its primary site when `here` is not
 * one it works on; null when it works on `here`, when `here` is not a staff site (the caller decides that, through
 * productSites.ts siteElsewhere), and for any facility that is not one of the demo's.
 */
export function demoFacilitySiteFrom(id: string | null | undefined, here: StaffProductKey | 'web' | null | undefined): StaffProductKey | null {
  const sites = demoSitesOf(id)
  if (!sites) return null
  if (here && here !== 'web' && sites.has(here)) return null
  return demoFacilitySite(id)
}

/** The page sets whose arrival switches the blue EHR on for every facility. */
export const SWITCH_PAGE_SETS = ['./clinical/pages.ts', './departments/pages.ts'] as const

/**
 * Whether the blue EHR is on for every facility: only once the clinic switch is set (BLUE_FOR_ALL, clinicSwitch.ts)
 * and both the clinical and the department pages are present. Merging the pages alone moves no real clinic.
 */
export function blueForAll(files: readonly string[] = PAGE_FILES, switchedOn: boolean = BLUE_FOR_ALL): boolean {
  return switchedOn && SWITCH_PAGE_SETS.every(set => files.includes(set))
}

/** One of the four demo facilities. */
export function isDemoFacility(id: string | null | undefined): boolean {
  return typeof id === 'string' && BLUE_IDS.has(id.toLowerCase())
}

export function isBlueFacility(id: string | null | undefined): boolean {
  return typeof id === 'string' && (blueForAll() || isDemoFacility(id))
}

/**
 * Whether the signed-in workspace opens as the blue EHR: at a blue facility, or, while the person must still choose
 * where they work, when every facility they could choose is a blue one. Anyone who could choose a facility still on
 * today's workspace chooses there.
 */
export function showsBlueEhr(actor: Pick<Actor, 'facility' | 'facilities'>, choosing: boolean): boolean {
  if (choosing) return actor.facilities.length > 0 && actor.facilities.every(facility => isBlueFacility(facility.id))
  return isBlueFacility(actor.facility?.id)
}

/*
 * The classic EHR is gone for good (the owner's decision, clinicSwitch.ts): nothing offers a way back to it, and
 * nothing sets this flag any more, so it stays false. The reset on sign-in and sign-out and the check in staff/App.tsx
 * are left as they were.
 */
let classic = false
const classicListeners = new Set<() => void>()

/** Clears the flag for whoever signs in next in this tab: StaffProvider calls it on sign-in and sign-out. */
export function resetClassicEhr(): void {
  if (!classic) return
  classic = false
  classicListeners.forEach(listener => listener())
}

function subscribeClassic(listener: () => void): () => void {
  classicListeners.add(listener)
  return () => { classicListeners.delete(listener) }
}

const classicChosen = () => classic

/** The flag above: always false now that nothing sets it. */
export function useClassicEhrChosen(): boolean {
  return useSyncExternalStore(subscribeClassic, classicChosen, classicChosen)
}
