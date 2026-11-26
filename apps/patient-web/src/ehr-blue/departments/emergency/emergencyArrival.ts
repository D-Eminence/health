import { staffSessionGeneration, staffSessionSignal } from '../../../staff/session'

/**
 * The emergency search card a patient was opened from by break-glass (hid-system ID-5), kept so the emergency summary can
 * offer "Add to the emergency board" (ED-1 route 1 with that card's matchRef, sent as emergency: Q-ED-3 A, built at the
 * recommended option). Held in this module's memory only (never in the address, router state or browser storage), for
 * the facility, patient and staff session it was made in, and dropped as the session ends. The server decides: it needs
 * this member's own emergency search and an active, unexpired break-glass grant for the patient here.
 */
interface Held { readonly facilityId: string; readonly patientId: string; readonly matchRef: string; readonly generation: number }
let held: Held | null = null

export function rememberEmergencyCard(facilityId: string, patientId: string, matchRef: string): void {
  const entry: Held = { facilityId, patientId, matchRef, generation: staffSessionGeneration() }
  held = entry
  staffSessionSignal().addEventListener('abort', () => { if (held === entry) held = null }, { once: true })
}

/** The matchRef for this facility's emergency patient, if this session opened them from an emergency search card. */
export function emergencyCardFor(facilityId: string, patientId: string): string | null {
  const current = held
  if (!current || current.facilityId !== facilityId || current.patientId !== patientId || current.generation !== staffSessionGeneration()) return null
  return current.matchRef
}

export function forgetEmergencyCard(): void {
  held = null
}
