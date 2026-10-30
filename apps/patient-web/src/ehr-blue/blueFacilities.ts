import { useSyncExternalStore } from 'react'
import type { Actor } from '../staff/api'
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
 * "Use the classic EHR" (the account menu): this tab goes back to today's staff portal while the switch-over beds in.
 * Memory only, never stored, so a reload opens the blue EHR again.
 */
let classic = false
const classicListeners = new Set<() => void>()

export function chooseClassicEhr(): void {
  if (classic) return
  classic = true
  classicListeners.forEach(listener => listener())
}

/** Back to the blue EHR for whoever signs in next in this tab: StaffProvider calls it on sign-out. */
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

/** Whether this tab chose the classic EHR. */
export function useClassicEhrChosen(): boolean {
  return useSyncExternalStore(subscribeClassic, classicChosen, classicChosen)
}
