import type { Actor } from '../staff/api'

/**
 * The four facilities of the sealed demo tenant. Staff working at one of them see the blue Hospital EHR; every other
 * facility keeps today's provider workspace, unchanged. The ids are Identity's facility ids, not names: a facility
 * renamed "Demo" elsewhere is not one of these.
 */
export const BLUE_FACILITIES = [
  { id: '98d00002-0000-4000-8000-000000000001', name: 'Demo Hospital' },
  { id: '98d00002-0000-4000-8000-000000000002', name: 'Demo Laboratory' },
  { id: '98d00002-0000-4000-8000-000000000003', name: 'Demo Pharmacy' },
  { id: '98d00002-0000-4000-8000-000000000004', name: 'Demo Outreach' },
] as const

const BLUE_IDS: ReadonlySet<string> = new Set(BLUE_FACILITIES.map(facility => facility.id))

export function isBlueFacility(id: string | null | undefined): boolean {
  return typeof id === 'string' && BLUE_IDS.has(id.toLowerCase())
}

/**
 * Whether the signed-in workspace opens as the blue EHR: at a demo facility, or, while the person must still choose
 * where they work, when every facility they could choose is a demo facility. Anyone who could choose a real facility
 * chooses in today's workspace.
 */
export function showsBlueEhr(actor: Pick<Actor, 'facility' | 'facilities'>, choosing: boolean): boolean {
  if (choosing) return actor.facilities.length > 0 && actor.facilities.every(facility => isBlueFacility(facility.id))
  return isBlueFacility(actor.facility?.id)
}
