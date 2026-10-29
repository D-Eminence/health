import { HidApiError, isHidApiError } from '@hid/http'
import { LIMITS, type CommandOutcome, type Json, type OpName, type Receipt, type Ref } from '@hid/offline'
import {
  staffApi, type ClinicalRecord, type DiagnosisUpdate, type Encounter, type GrantResult, type NoteRevision, type RecordKind,
  type SavedRecord, type VitalCorrection, type VitalMeasurements,
} from '../api'
import { offlineActive, offlineRuntime } from './runtime'
import { refFromId } from './registry'

/**
 * The EHR's writes, with the signatures of the `staffApi` methods they replace and a `CommandOutcome` for an answer.
 * Without offline in use each is the `staffApi` call itself, and its answer comes back 'applied'. With it, the change
 * is saved on the device first, then sent; the page waits up to 8 seconds (§2.8 save path, step 3) for Health ID's
 * answer, and otherwise says it is saved on this device. A definitive refusal of a first attempt (400, 403, 404, 409,
 * 412 before any earlier send) applied nothing, so it is thrown as the HidApiError the form shows today.
 */

const OP_KINDS: Readonly<Record<RecordKind, OpName>> = {
  'clinical-notes': 'ehr.note.create',
  vitals: 'ehr.vital.create',
  diagnoses: 'ehr.diagnosis.create',
  prescriptions: 'ehr.prescription.create',
  'lab-requests': 'ehr.lab-request.create',
}

/** An answer straight from Health ID, as an outcome. Its receipt says so: no command was queued. */
export function appliedOnline<V>(value: V, resourceType: string): CommandOutcome<V> {
  const id = (value as { id?: unknown } | null)?.id
  const receipt: Receipt = { commandId: '', resourceType, resourceId: typeof id === 'string' ? id : '', status: 200, replay: false,
    serverDate: new Date().toISOString(), via: 'response' }
  return { kind: 'applied', value, receipt }
}

/** A refusal the runtime reports, as the HidApiError the forms read (useFieldProblems, refusalText). */
export function asHidApiError(caught: unknown): unknown {
  if (isHidApiError(caught) || !caught || typeof caught !== 'object') return caught
  const problem = caught as { status?: unknown; message?: unknown; code?: unknown; details?: unknown; requestId?: unknown }
  if (typeof problem.status !== 'number') return caught
  return new HidApiError(problem.status, typeof problem.message === 'string' ? problem.message : 'Health ID refused this change.', {
    code: typeof problem.code === 'string' ? problem.code : undefined, details: problem.details ?? undefined,
    requestId: typeof problem.requestId === 'string' ? problem.requestId : undefined, retryable: false, cause: caught })
}

/** Commands saved on this device that this one must follow: the visit (or record) they create. */
function localDependencies(...refs: Ref[]): string[] {
  return refs.flatMap(ref => 'local' in ref ? [ref.local] : [])
}

/**
 * Saves `input` as `op` when offline is in use, else runs `online`. `online` is the unchanged staffApi call.
 */
export async function saveCommand<V>(op: OpName, input: Record<string, unknown>, online: () => Promise<V>, resourceType: string,
  refs: Ref[] = []): Promise<CommandOutcome<V>> {
  const runtime = offlineRuntime()
  if (!offlineActive(runtime)) return appliedOnline(await online(), resourceType)
  const dependsOn = localDependencies(...refs)
  try {
    return await runtime.commands.save<V>(op, input as Json, { awaitMs: LIMITS.receiptWaitMs, ...(dependsOn.length ? { dependsOn } : {}) })
  } catch (caught) { throw asHidApiError(caught) }
}

/** The day's clock for a time captured at save: the trusted clock when offline is in use (§2.6). */
export function capturedNow(): string {
  const runtime = offlineRuntime()
  return (offlineActive(runtime) ? runtime.trustedNow().at : new Date()).toISOString()
}

export const ehrCommands = {
  /** `localId` names the new visit on this device until Health ID does (its lane, §2.8). */
  createEncounter: (facilityId: string, patientId: string, input: { encounterType: string; status: string; startedAt: string; chiefComplaint: string },
    idempotencyKey?: string, localId: string = crypto.randomUUID()): Promise<CommandOutcome<Encounter>> =>
    saveCommand('ehr.encounter.create', { facilityId, patientId, localId, body: input },
      () => staffApi.createEncounter(facilityId, patientId, input, idempotencyKey), 'encounter'),

  createRecord: (facilityId: string, patientId: string, encounterId: string, kind: RecordKind, input: object,
    idempotencyKey?: string): Promise<CommandOutcome<SavedRecord>> => {
    const encounter = refFromId(encounterId)
    return saveCommand(OP_KINDS[kind], { facilityId, patientId, encounter, body: input },
      () => staffApi.createRecord(facilityId, patientId, encounterId, kind, input, idempotencyKey), kind, [encounter])
  },

  updateEncounter: (facilityId: string, patientId: string, encounterId: string,
    input: { expectedRowVersion: number; changeReason: string; status: string; endedAt?: string }): Promise<CommandOutcome<Encounter>> => {
    const encounter = refFromId(encounterId)
    return saveCommand('ehr.encounter.update', { facilityId, patientId, encounter, body: input },
      () => staffApi.updateEncounter(facilityId, patientId, encounterId, input), 'encounter', [encounter])
  },

  /**
   * A status change. Only a note's goes through the device: prescription and lab request status changes stay online
   * in wave 1 (§2.8), and are the staffApi call whether or not offline is in use.
   */
  updateRecord: (facilityId: string, patientId: string, encounterId: string, kind: 'clinical-notes' | 'prescriptions' | 'lab-requests',
    recordId: string, input: { expectedRowVersion: number; changeReason: string; status: string }): Promise<CommandOutcome<SavedRecord>> => {
    if (kind !== 'clinical-notes') return staffApi.updateRecord(facilityId, patientId, encounterId, kind, recordId, input).then(value => appliedOnline(value, kind))
    const encounter = refFromId(encounterId)
    const note = refFromId(recordId)
    return saveCommand('ehr.note.update', { facilityId, patientId, encounter, note, body: input },
      () => staffApi.updateRecord(facilityId, patientId, encounterId, kind, recordId, input), 'clinical-notes', [encounter, note])
  },

  updateDiagnosis: (facilityId: string, patientId: string, encounterId: string, diagnosisId: string,
    input: DiagnosisUpdate): Promise<CommandOutcome<ClinicalRecord>> => {
    const encounter = refFromId(encounterId)
    const diagnosis = refFromId(diagnosisId)
    return saveCommand('ehr.diagnosis.update', { facilityId, patientId, encounter, diagnosis, body: { ...input } },
      () => staffApi.updateDiagnosis(facilityId, patientId, encounterId, diagnosisId, input), 'diagnoses', [encounter, diagnosis])
  },

  correctVital: (facilityId: string, patientId: string, encounterId: string, vitalId: string,
    input: { expectedRowVersion: number; changeReason: string; replacementValues: VitalMeasurements }, idempotencyKey?: string): Promise<CommandOutcome<VitalCorrection>> => {
    const encounter = refFromId(encounterId)
    const vital = refFromId(vitalId)
    return saveCommand('ehr.vital.correct', { facilityId, patientId, encounter, vital, body: input },
      () => staffApi.correctVital(facilityId, patientId, encounterId, vitalId, input, idempotencyKey), 'vital-correction', [encounter, vital])
  },

  acceptPrescription: (facilityId: string, patientId: string, encounterId: string, prescriptionId: string, expectedRowVersion: number,
    reason: string, idempotencyKey?: string): Promise<CommandOutcome<unknown>> => {
    const encounter = refFromId(encounterId)
    const prescription = refFromId(prescriptionId)
    return saveCommand('ehr.prescription.to-pharmacy', { facilityId, patientId, encounter, prescription, body: { expectedRowVersion, reason } },
      () => staffApi.acceptPrescription(facilityId, patientId, encounterId, prescriptionId, expectedRowVersion, reason, idempotencyKey),
      'pharmacy-work-item', [encounter, prescription])
  },

  sendLabRequestToLab: (facilityId: string, patientId: string, encounterId: string, requestId: string, expectedRowVersion: number,
    idempotencyKey?: string): Promise<CommandOutcome<unknown>> => {
    const encounter = refFromId(encounterId)
    const labRequest = refFromId(requestId)
    return saveCommand('ehr.lab-request.to-lab', { facilityId, patientId, encounter, labRequest, body: { expectedRowVersion } },
      () => staffApi.sendLabRequestToLab(facilityId, patientId, encounterId, requestId, expectedRowVersion, idempotencyKey),
      'lab-work-item', [encounter, labRequest])
  },

  addNoteRevision: (facilityId: string, patientId: string, encounterId: string, noteId: string,
    input: { expectedRowVersion: number; changeReason: string; content: string }, idempotencyKey?: string): Promise<CommandOutcome<NoteRevision>> => {
    const encounter = refFromId(encounterId)
    const note = refFromId(noteId)
    return saveCommand('ehr.note.revise', { facilityId, patientId, encounter, note, body: input },
      () => staffApi.addNoteRevision(facilityId, patientId, encounterId, noteId, input, idempotencyKey), 'note-revision', [encounter, note])
  },

  /**
   * Closes the clinician's own grant. Offline, the patient leaves this device first (§2.8, `identity.grant.close`:
   * "the patient is removed locally first"), then the close is sent when Health ID can be reached.
   */
  closeGrant: async (facilityId: string, patientId: string, grantId: string, reason: string): Promise<CommandOutcome<GrantResult>> => {
    const runtime = offlineRuntime()
    if (offlineActive(runtime)) await runtime.reads.dropPatient(patientId)
    return saveCommand('identity.grant.close', { facilityId, patientId, grantId, body: { reason } },
      () => staffApi.closeGrant(facilityId, grantId, reason), 'consent-grant')
  },
}
