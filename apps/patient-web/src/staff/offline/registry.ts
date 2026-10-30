import type { Json, OpDefinition, OpName, Ref } from '@hid/offline'
import { staffApi, type ClinicalRecord, type DiagnosisUpdate, type RecordKind, type VitalMeasurements } from '../api'

/**
 * The wave-1 commands the EHR and Migrate save through the device (OFFLINE-CONTRACT §2.8, registry table). Each body
 * is exactly what `staffApi` sends today, so a command sent later is the request the form would have sent then.
 * The engine adds the facility, purpose, key and offline headers from the vault's scope; nothing here reads a clock
 * (every time is captured by the form at save) or the network, except `reread`, which runs online only.
 */

/** Every input names the facility and patient it was captured for. */
interface Scoped { facilityId: string; patientId: string }
/** A record inside a visit: the visit, by server id or as the local command that creates it. */
interface InVisit extends Scoped { encounter: Ref }

export interface EncounterCreateInput extends Scoped {
  /** A new id for the visit, so its own lane exists before the server names it. */
  localId: string
  body: { encounterType: string; status: string; startedAt: string; chiefComplaint: string }
}
export interface RecordCreateInput extends InVisit { body: Record<string, Json> }
export interface NoteReviseInput extends InVisit { note: Ref; body: { expectedRowVersion: number; changeReason: string; content: string } }
export interface VitalCorrectInput extends InVisit { vital: Ref; body: { expectedRowVersion: number; changeReason: string; replacementValues: VitalMeasurements } }
export interface ToPharmacyInput extends InVisit { prescription: Ref; body: { expectedRowVersion: number; reason: string } }
export interface ToLabInput extends InVisit { labRequest: Ref; body: { expectedRowVersion: number } }
export interface EncounterUpdateInput extends InVisit { body: { expectedRowVersion: number; changeReason: string; status: string; endedAt?: string } }
export interface NoteUpdateInput extends InVisit { note: Ref; body: { expectedRowVersion: number; changeReason: string; status: string } }
export interface DiagnosisUpdateInput extends InVisit { diagnosis: Ref; body: DiagnosisUpdate }
export interface GrantCloseInput extends Scoped { grantId: string; body: { reason: string } }
export interface DocumentUploadInput extends InVisit {
  /** The upload intent's body; `fileName` is the safe `scan-YYYYMMDD-HHmm-<n>.<ext>` name, never a patient's. */
  body: { patientId: string; encounterId?: string; fileName: string; mediaType: string; sizeBytes: number; sha256Hex: string;
    classification: 'phi'; retentionClass: 'clinical-10y' }
  /** The sealed file on the device (§2.5 "Media"): its chunks are deleted once the upload is applied. */
  media: { blobId: string; mediaType: string; sizeBytes: number; sha256Hex: string; fileName: string }
}

/** A visit or record id as the portal holds it: a server id, or `local:<commandId>` for one saved on this device. */
export function refFromId(id: string): Ref {
  return id.startsWith('local:') ? { local: id.slice('local:'.length) } : { server: id }
}

export function idFromRef(ref: Ref): string {
  return 'local' in ref ? `local:${ref.local}` : ref.server
}

function patientPath(patientId: string) {
  return `/api/v1/ehr/patients/${encodeURIComponent(patientId)}/encounters`
}

function visitPath(i: Scoped, resolved: Record<string, string>) {
  return `${patientPath(i.patientId)}/${encodeURIComponent(required(resolved, 'encounterId'))}`
}

function required(resolved: Record<string, string>, name: string): string {
  const value = resolved[name]
  if (!value) throw new Error(`The ${name} of this change is not known yet.`)
  return value
}

/** The id and row version EHR answered with; pg sends bigint versions as strings. */
function receiptOf(resourceType: string, idOf: (body: Record<string, unknown>) => unknown = body => body.id) {
  return (responseBody: unknown) => {
    const body = (responseBody && typeof responseBody === 'object' ? responseBody : {}) as Record<string, unknown>
    const id = idOf(body)
    const version = Number(body.rowVersion)
    return { resourceType, resourceId: typeof id === 'string' ? id : '', ...(Number.isInteger(version) && version > 0 ? { rowVersion: version } : {}) }
  }
}

/** The server id of a ref already resolved, for reading the record back online. */
function serverId(ref: Ref, resolved: Record<string, string>, name: string): string {
  return 'server' in ref ? ref.server : required(resolved, name)
}

/** Finds one record of a visit by reading its list, a page at a time (EHR has no single-record read for these). */
export async function findRecord(facilityId: string, patientId: string, encounterId: string, kind: RecordKind, id: string): Promise<ClinicalRecord | null> {
  let cursor: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const read = await staffApi.records(facilityId, patientId, encounterId, kind, { cursor, fresh: true })
    const found = read.items.find(item => item.id === id)
    if (found) return found
    if (!read.nextCursor) return null
    cursor = read.nextCursor
  }
  return null
}

function create(op: OpName, kind: RecordKind, safety?: 'prescription'): OpDefinition<RecordCreateInput> {
  return {
    op, opVersion: 1, method: 'POST', keyed: true,
    lane: i => ({ patientId: i.patientId, visit: i.encounter }),
    refs: i => ({ encounterId: i.encounter }),
    path: (i, resolved) => `${visitPath(i, resolved)}/${kind}`,
    body: i => i.body,
    receipt: receiptOf(kind),
    ...(safety ? { safety } : {}),
  }
}

/** A POST that changes a record at the version the clinician saw: its key makes it safe to send again. */
function versioned<I extends InVisit & { body: { expectedRowVersion: number } }>(op: OpName, target: keyof I & string, kind: RecordKind,
  suffix: string, resourceType: string): OpDefinition<I> {
  const ref = (i: I) => i[target] as unknown as Ref
  return {
    op, opVersion: 1, method: 'POST', keyed: true, versionField: 'expectedRowVersion',
    lane: i => ({ patientId: i.patientId, visit: i.encounter }),
    refs: i => ({ encounterId: i.encounter, targetId: ref(i) }),
    path: (i, resolved) => `${visitPath(i, resolved)}/${kind}/${encodeURIComponent(required(resolved, 'targetId'))}/${suffix}`,
    body: i => i.body as unknown as Json,
    receipt: receiptOf(resourceType),
    reread: (i, resolved) => findRecord(i.facilityId, i.patientId, serverId(i.encounter, resolved, 'encounterId'), kind,
      serverId(ref(i), resolved, 'targetId')),
  }
}

/**
 * Sending a lab request to Lab keeps no client key on the server (A10.7: C1 answers `unknown` for it), so a replay after
 * a lost success can come back 412. It counts as applied when Lab already holds a work item for this request at the
 * version sent: the re-read asks Lab for the request's work item (`/lab/ehr-orders/:id/released-results`, direct care)
 * and reports the version it accepted as `handedOffAtVersion`, beside the request itself for the review drawer. A read
 * Lab refuses (no work item: 404) reports nothing handed off, so the change goes to review as before.
 */
const toLab: OpDefinition<ToLabInput> = {
  ...versioned<ToLabInput>('ehr.lab-request.to-lab', 'labRequest', 'lab-requests', 'lab-work-item', 'lab-work-item'),
  intent: i => ({ handedOffAtVersion: i.body.expectedRowVersion }),
  reread: async (i, resolved) => {
    const encounterId = serverId(i.encounter, resolved, 'encounterId')
    const requestId = serverId(i.labRequest, resolved, 'targetId')
    const [record, held] = await Promise.all([
      findRecord(i.facilityId, i.patientId, encounterId, 'lab-requests', requestId).catch(() => null),
      staffApi.labReleasedResultsForOrder(i.facilityId, requestId, 'direct-care').catch(() => null),
    ])
    const handedOff = held && held.sourceEhrOrderId === requestId ? Number(held.sourceEhrOrderVersion) : null
    return { ...(record ?? {}), handedOffAtVersion: handedOff }
  },
}

const encounterCreate: OpDefinition<EncounterCreateInput> = {
  op: 'ehr.encounter.create', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: { local: i.localId } }),
  refs: () => ({}),
  path: i => patientPath(i.patientId),
  body: i => i.body,
  receipt: receiptOf('encounter'),
}

const encounterUpdate: OpDefinition<EncounterUpdateInput> = {
  op: 'ehr.encounter.update', opVersion: 1, method: 'PATCH', keyed: true, versionField: 'expectedRowVersion',
  lane: i => ({ patientId: i.patientId, visit: i.encounter }),
  refs: i => ({ encounterId: i.encounter }),
  path: (i, resolved) => visitPath(i, resolved),
  body: i => i.body,
  receipt: receiptOf('encounter'),
  // Applied already when the visit has the status asked for (a completed visit also has an end time).
  intent: i => ({ status: i.body.status }),
  reread: (i, resolved) => staffApi.encounter(i.facilityId, i.patientId, serverId(i.encounter, resolved, 'encounterId')),
}

const noteUpdate: OpDefinition<NoteUpdateInput> = {
  op: 'ehr.note.update', opVersion: 1, method: 'PATCH', keyed: true, versionField: 'expectedRowVersion',
  lane: i => ({ patientId: i.patientId, visit: i.encounter }),
  refs: i => ({ encounterId: i.encounter, targetId: i.note }),
  path: (i, resolved) => `${visitPath(i, resolved)}/clinical-notes/${encodeURIComponent(required(resolved, 'targetId'))}`,
  body: i => i.body,
  receipt: receiptOf('clinical-note'),
  intent: i => ({ status: i.body.status }),
  reread: (i, resolved) => findRecord(i.facilityId, i.patientId, serverId(i.encounter, resolved, 'encounterId'), 'clinical-notes',
    serverId(i.note, resolved, 'targetId')),
}

const diagnosisUpdate: OpDefinition<DiagnosisUpdateInput> = {
  op: 'ehr.diagnosis.update', opVersion: 1, method: 'PATCH', keyed: true, versionField: 'expectedRowVersion',
  lane: i => ({ patientId: i.patientId, visit: i.encounter }),
  refs: i => ({ encounterId: i.encounter, targetId: i.diagnosis }),
  path: (i, resolved) => `${visitPath(i, resolved)}/diagnoses/${encodeURIComponent(required(resolved, 'targetId'))}`,
  body: i => i.body as unknown as Json,
  receipt: receiptOf('diagnosis'),
  // The fields the change sets: when the diagnosis already holds them, the change is in.
  intent: i => {
    const { clinicalStatus, verificationStatus, notes } = i.body
    return { ...(clinicalStatus !== undefined ? { clinicalStatus } : {}), ...(verificationStatus !== undefined ? { verificationStatus } : {}),
      ...(notes !== undefined ? { notes } : {}) }
  },
  reread: (i, resolved) => findRecord(i.facilityId, i.patientId, serverId(i.encounter, resolved, 'encounterId'), 'diagnoses',
    serverId(i.diagnosis, resolved, 'targetId')),
}

const grantClose: OpDefinition<GrantCloseInput> = {
  op: 'identity.grant.close', opVersion: 1, method: 'POST', keyed: 'natural',
  lane: i => ({ patientId: i.patientId, visit: 'patient' }),
  refs: () => ({}),
  path: i => `/api/v1/identity/consent-grants/${encodeURIComponent(i.grantId)}/close`,
  body: i => i.body,
  receipt: receiptOf('consent-grant', body => body.consentGrantId ?? body.id),
}

const documentUpload: OpDefinition<DocumentUploadInput> = {
  op: 'ehr.document.upload', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: 'media' }),
  refs: i => ({ encounterId: i.encounter }),
  path: () => '/api/v1/ehr/documents/upload-intents',
  body: (i, resolved) => ({ ...i.body, patientId: i.patientId, encounterId: String(resolved.encounterId ?? i.body.encounterId ?? '') }),
  receipt: receiptOf('document', body => (body.document as { id?: unknown } | undefined)?.id ?? body.id),
}

export const STAFF_OFFLINE_REGISTRY: readonly OpDefinition<never>[] = [
  encounterCreate,
  create('ehr.note.create', 'clinical-notes'),
  create('ehr.vital.create', 'vitals'),
  create('ehr.diagnosis.create', 'diagnoses'),
  create('ehr.prescription.create', 'prescriptions', 'prescription'),
  create('ehr.lab-request.create', 'lab-requests'),
  versioned<NoteReviseInput>('ehr.note.revise', 'note', 'clinical-notes', 'revisions', 'note-revision'),
  versioned<VitalCorrectInput>('ehr.vital.correct', 'vital', 'vitals', 'corrections', 'vital-correction'),
  versioned<ToPharmacyInput>('ehr.prescription.to-pharmacy', 'prescription', 'prescriptions', 'pharmacy-work-item', 'pharmacy-work-item'),
  toLab,
  encounterUpdate,
  noteUpdate,
  diagnosisUpdate,
  grantClose,
  documentUpload,
] as unknown as readonly OpDefinition<never>[]

/** The definition of `op`, for the review drawer's re-read of the current record. */
export function definitionOf(op: OpName): OpDefinition<Json> | undefined {
  return (STAFF_OFFLINE_REGISTRY as unknown as readonly OpDefinition<Json>[]).find(item => item.op === op)
}
