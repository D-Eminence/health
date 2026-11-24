import type { ReportedHealthProfile } from '../../../profileParity'
import { staffApi } from '../../../staff/api'
import type { ActivePatient } from '../../../staff/App'
import { staffSessionGeneration } from '../../../staff/session'

/**
 * What the patient reported about their health, read once for the open patient (row 8b of the parity report). Every
 * read of it is logged as a view of the record, and today's portal read it once, on the chart. Here the patient's page,
 * its allergies card (on a backend before the allergies route) and the chart's "Reported by the patient" all show it, so
 * they share one read: the answer is held for the open patient (the lookup that opened them, which a new lookup, a
 * facility change or a sign-out replaces), and only for the same staff session, facility and patient. It is held in
 * this module's memory only, never stored. A read that failed is not kept, so the next one reads again; a retry
 * (`fresh`) reads again and keeps the new answer.
 */
interface Held { readonly key: string; readonly answer: Promise<ReportedHealthProfile | null> }

const held = new WeakMap<ActivePatient, Held>()

export function readReportedHealth(patient: ActivePatient, facilityId: string, patientId: string,
  { fresh = false }: { fresh?: boolean } = {}): Promise<ReportedHealthProfile | null> {
  const key = JSON.stringify([staffSessionGeneration(), facilityId, patientId])
  const current = held.get(patient)
  if (!fresh && current?.key === key) return current.answer
  // Not tied to the page that asked first, so its signal is the read's own: the chart opened next uses the same answer
  // even once that page has gone. Run as a promise, so a read that throws at once is this read's failure, never the page's.
  const { signal } = new AbortController()
  const answer = Promise.resolve().then(() => staffApi.reportedHealthProfile(facilityId, patientId, signal))
  const entry: Held = { key, answer }
  held.set(patient, entry)
  answer.catch(() => { if (held.get(patient) === entry) held.delete(patient) })
  return answer
}
