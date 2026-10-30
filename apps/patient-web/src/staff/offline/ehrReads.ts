import { useSyncExternalStore } from 'react'
import { HidApiError } from '@hid/http'
import { isTransportError, type OfflineCore } from '@hid/offline'
import {
  isAllowedPatientLookup, staffApi, type ConsentStatus, type EmergencyRecords, type PatientLookup, type RecordKind,
} from '../api'
import { offlineActive, offlineRuntime } from './runtime'

/**
 * The chart reads the EHR may answer from the device (OFFLINE-CONTRACT §2.7 allowlist), with the same signatures as
 * `staffApi`. Without offline in use each one is the `staffApi` call itself, unchanged. With it, the runtime asks the
 * network first and shows the copy saved on this device only when Health ID cannot answer in time, and only while
 * the patient's access lasts. Emergency reads never reach the device: `emergencyRecords`, and any read under the
 * emergency purpose or a break-glass authorization, go straight to the network and stay in memory.
 */

type Section = 'consent' | 'encounters' | 'encounter' | 'clinical-notes' | 'vitals' | 'diagnoses' | 'prescriptions' | 'lab-requests'
  | 'documents' | 'note-revisions' | 'vital-corrections' | 'reported-health' | 'lab-results' | 'summary'

// Copies shown from the device, per patient and read, so a chart can say "Saved copy from 10:42".
const shownFromDevice = new Map<string, { patientId: string; savedAt: string }>()
const listeners = new Set<() => void>()
let version = 0
function changed() { version += 1; for (const listener of [...listeners]) listener() }

function note(patientId: string, method: string, source: 'network' | 'cache', savedAt: string | null) {
  const key = `${patientId}|${method}`
  if (source === 'cache' && savedAt) shownFromDevice.set(key, { patientId, savedAt })
  else if (!shownFromDevice.delete(key)) return
  changed()
}

/** The oldest saved copy shown for `patientId` since its reads last came from Health ID, or null. */
export function deviceCopySavedAt(patientId: string | undefined): string | null {
  if (!patientId) return null
  let oldest: string | null = null
  for (const item of shownFromDevice.values()) if (item.patientId === patientId && (!oldest || item.savedAt < oldest)) oldest = item.savedAt
  return oldest
}

export function useDeviceCopySavedAt(patientId: string | undefined): string | null {
  useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => version, () => version)
  return deviceCopySavedAt(patientId)
}

/** Tests only. */
export function forgetDeviceCopies(): void { shownFromDevice.clear(); changed() }

async function cached<T>(method: string, args: readonly unknown[], patientId: string, section: Section, network: () => Promise<T>,
  runtime: OfflineCore | null = offlineRuntime()): Promise<T> {
  if (!offlineActive(runtime)) return network()
  let result: Awaited<ReturnType<typeof runtime.reads.read<T>>>
  // The patient leads the key: a read whose own arguments do not name the patient (consent, reported health, visits)
  // must never answer with another patient's copy (A12.1).
  try { result = await runtime.reads.read({ method, args: [patientId, ...args], patientId, network }) }
  catch (caught) {
    // Offline with no readable copy on this device: said as the network error the pages already handle.
    if (isTransportError(caught) && caught.networkError) {
      throw new HidApiError(0, 'Health ID can’t be reached, and this is not kept on this device.', { code: 'NETWORK_ERROR', retryable: false, cause: caught })
    }
    throw caught
  }
  note(patientId, method, result.source, result.savedAt)
  if (result.source === 'cache') runtime.audit.recordOpen(patientId, section)
  return result.value
}

/** Records the grant a lookup reported, so the device keeps the chart only while access lasts (§2.7 "Readable only when"). */
async function keepGrant(runtime: OfflineCore, lookup: PatientLookup) {
  if (!isAllowedPatientLookup(lookup)) return
  const { authorization: auth, patient } = lookup
  await runtime.reads.setGrant({ patientId: patient.patientId, readAllowed: true, writeAllowed: auth.scope === 'write_records',
    expiresAt: auth.expiresAt ?? null, grantId: auth.consentGrantId ?? null, breakGlass: auth.breakGlass === true,
    observedAt: runtime.trustedNow().at.toISOString() })
  // The patient joins this device's index ("On this device"); a break-glass opening never does.
  if (!auth.breakGlass) await runtime.rememberPatient({ patientId: patient.patientId, displayName: patient.fullName ?? patient.hid,
    hidCode: patient.hid, grantExpiresAt: auth.expiresAt ?? null })
}

export const ehrReads = {
  /**
   * A Health ID already on this device may be answered from it (§2.7: "only the HID already in the index"); any other
   * goes to Health ID as today. An emergency lookup is never kept.
   */
  async lookupPatient(facilityId: string, hid: string, purpose: 'direct-care' | 'emergency' = 'direct-care'): Promise<PatientLookup> {
    const runtime = offlineRuntime()
    if (purpose === 'emergency' || !offlineActive(runtime)) return staffApi.lookupPatient(facilityId, hid, purpose)
    const code = hid.trim().toUpperCase()
    const known = (await runtime.patients.search(code)).find(entry => entry.hidCode.toUpperCase() === code)
    const network = async () => {
      const lookup = await staffApi.lookupPatient(facilityId, code, purpose)
      await keepGrant(runtime, lookup)
      return lookup
    }
    if (!known) return network()
    const lookup = await cached('lookupPatient', [code], known.patientId, 'summary', network, runtime)
    // A break-glass authorization is never kept: the device drops the patient (§2.6, per-patient wipe).
    if (isAllowedPatientLookup(lookup) && lookup.authorization.breakGlass) await runtime.reads.dropPatient(known.patientId)
    return lookup
  },
  async consentStatus(facilityId: string, patientId: string): Promise<ConsentStatus> {
    const runtime = offlineRuntime()
    if (!offlineActive(runtime)) return staffApi.consentStatus(facilityId, patientId)
    return cached('consentStatus', [], patientId, 'consent', async () => {
      const status = await staffApi.consentStatus(facilityId, patientId)
      await runtime.reads.setGrant({ patientId, readAllowed: status.readAllowed === true, writeAllowed: status.writeAllowed === true,
        expiresAt: status.expiresAt ?? null, breakGlass: false, observedAt: runtime.trustedNow().at.toISOString() })
      return status
    }, runtime)
  },
  // Each read passes on exactly the arguments it was given: without offline it is the staffApi call, unchanged.
  encounters: (...args: Parameters<typeof staffApi.encounters>) =>
    cached('encounters', [args[2]?.cursor ?? null], args[1], 'encounters', () => staffApi.encounters(...args)),
  encounter: (facilityId: string, patientId: string, encounterId: string) =>
    cached('encounter', [encounterId], patientId, 'encounter', () => staffApi.encounter(facilityId, patientId, encounterId)),
  /** A visit saved on this device and not sent yet has no records on the server: only its pending rows. */
  records: (...args: Parameters<typeof staffApi.records>): ReturnType<typeof staffApi.records> =>
    args[2].startsWith('local:') ? Promise.resolve({ items: [], nextCursor: null })
      : cached('records', [args[2], args[3], args[4]?.cursor ?? null], args[1], args[3], () => staffApi.records(...args)),
  noteRevisions: (facilityId: string, patientId: string, encounterId: string, noteId: string) =>
    cached('noteRevisions', [encounterId, noteId], patientId, 'note-revisions', () => staffApi.noteRevisions(facilityId, patientId, encounterId, noteId)),
  vitalCorrections: (facilityId: string, patientId: string, encounterId: string, vitalId: string) =>
    cached('vitalCorrections', [encounterId, vitalId], patientId, 'vital-corrections',
      () => staffApi.vitalCorrections(facilityId, patientId, encounterId, vitalId)),
  /** Metadata only: document bytes from the server are never kept (§2.4). */
  documents: (facilityId: string, patientId: string, encounterId: string): ReturnType<typeof staffApi.documents> =>
    encounterId.startsWith('local:') ? Promise.resolve({ items: [], nextCursor: null })
      : cached('documents', [encounterId], patientId, 'documents', () => staffApi.documents(facilityId, patientId, encounterId)),
  reportedHealthProfile: (facilityId: string, patientId: string, signal?: AbortSignal) =>
    cached('reportedHealthProfile', [], patientId, 'reported-health', () => staffApi.reportedHealthProfile(facilityId, patientId, signal)),
  /** Direct care only: under the emergency purpose it is the network read, kept in memory. */
  labReleasedResultsForOrder: (facilityId: string, labRequestId: string, purpose: 'direct-care' | 'emergency' = 'direct-care', patientId?: string) =>
    purpose === 'emergency' || !patientId ? staffApi.labReleasedResultsForOrder(facilityId, labRequestId, purpose)
      : cached('labReleasedResultsForOrder', [labRequestId], patientId, 'lab-results',
        () => staffApi.labReleasedResultsForOrder(facilityId, labRequestId, purpose)),
  /** Never cached (§2.7, D5): passed through untouched. */
  emergencyRecords: (facilityId: string, patientId: string): Promise<EmergencyRecords> => staffApi.emergencyRecords(facilityId, patientId),
}

/**
 * "Keep available offline" (§2.7): consent, the latest 3 visits, each with the five record kinds (page 1), what the
 * patient reported and document metadata. Every read is a normal audited read; the runtime runs two at a time.
 */
export async function keepPatientOffline(facilityId: string, patientId: string): Promise<void> {
  const runtime = offlineRuntime()
  if (!offlineActive(runtime)) return
  await ehrReads.consentStatus(facilityId, patientId)
  const visits = (await ehrReads.encounters(facilityId, patientId)).items.slice(0, 3)
  const kinds: RecordKind[] = ['clinical-notes', 'vitals', 'diagnoses', 'prescriptions', 'lab-requests']
  await runtime.reads.keepOffline(patientId, [
    () => ehrReads.reportedHealthProfile(facilityId, patientId),
    ...visits.flatMap(visit => [
      () => ehrReads.encounter(facilityId, patientId, visit.id),
      () => ehrReads.documents(facilityId, patientId, visit.id),
      ...kinds.map(kind => () => ehrReads.records(facilityId, patientId, visit.id, kind)),
    ]),
  ])
}
