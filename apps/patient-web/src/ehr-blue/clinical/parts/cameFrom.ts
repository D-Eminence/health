import { createContext } from 'react'

/**
 * Where a page was opened from, carried in router state so Back can return there by name ("Back to consultation",
 * "Back to Adaeze Okafor"). Only an address inside the provider workspace is taken; nothing about the patient is put in
 * the address itself. Router state is kept in the browser's history, so it never holds a patient's name either: Back to
 * the open patient keeps a fixed label (BACK_TO_PATIENT) and `patient`, and the page names the patient as it draws, from
 * the patient open in memory (backLabel).
 */
export interface CameFrom { readonly to: string; readonly label: string; readonly patient?: true }

/** Back to the open patient's page, as kept in history: the patient's name is put in only as the page draws. */
export const BACK_TO_PATIENT = 'Back to patient'

/** Router state saying the page being opened was reached from `to`, with Back named `label`. */
export function fromHere(to: string, label: string, state: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...state, from: { to, label } }
}

/** Router state saying the page being opened was reached from the open patient's page at `to`. No name goes in it. */
export function fromPatient(to: string, state: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...state, from: { to, label: BACK_TO_PATIENT, patient: true } }
}

/**
 * The name of the patient open now, from memory (useStaff's activePatient), for Back to name them as a page draws.
 * Clinical pages' Workspace provides it; elsewhere it is null and Back keeps BACK_TO_PATIENT.
 */
export const OpenPatientName = createContext<string | null>(null)

/** Back's name: the open patient's, from memory, when it goes back to that patient's page; else as it was kept. */
export function backLabel(from: CameFrom, patientName: string | null | undefined): string {
  return from.patient && patientName ? `Back to ${patientName}` : from.label
}

/** The page this one was opened from, when the router state names a provider address. */
export function cameFrom(state: unknown): CameFrom | null {
  if (!state || typeof state !== 'object' || !('from' in state)) return null
  const from = (state as { from?: unknown }).from
  if (!from || typeof from !== 'object') return null
  const { to, label, patient } = from as { to?: unknown; label?: unknown; patient?: unknown }
  if (!(typeof to === 'string' && to.startsWith('/provider') && !to.startsWith('//') && typeof label === 'string' && label)) return null
  return patient === true ? { to, label, patient } : { to, label }
}
