import type { Json, OpDefinition, StaffSessionSnapshot } from '../contracts'
import { DEMO_HOSPITAL_FACILITY_ID } from '../testing'
import type { StagedMedia } from '../types'

// Fictional test identities only.
export const SESSION: StaffSessionSnapshot = {
  actorId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  email: 'Nurse.Test@demo.example',
  displayName: 'Ada Testnurse',
  facilityId: DEMO_HOSPITAL_FACILITY_ID,
  facilityName: 'Demo Hospital',
  permissions: ['ehr.encounter.read', 'ehr.encounter.write'],
  session: { status: 'ready' },
}
export const PASSWORD = 'correct horse battery'
export const PATIENT = '44444444-4444-4444-8444-444444444444'
export const OTHER_FACILITY = '55555555-5555-4555-8555-555555555555'

type In = { patientId: string; encounter?: { local: string } | { server: string }; noteId?: string; text?: string; startedAt?: string; expectedRowVersion?: number; status?: string }
const E = (i: In) => `/api/v1/ehr/patients/${i.patientId}/encounters`
const receipt = (b: unknown) => {
  const r = b as { id: string; rowVersion?: number }
  return { resourceType: 'record', resourceId: r.id, ...(r.rowVersion !== undefined ? { rowVersion: r.rowVersion } : {}) }
}

export const encounterCreate: OpDefinition<In> = {
  op: 'ehr.encounter.create', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: 'patient' }),
  refs: () => ({}),
  path: i => E(i),
  body: i => ({ startedAt: i.startedAt ?? '2026-10-29T09:00:00.000Z', reason: i.text ?? null }),
  receipt,
}
export const noteCreate: OpDefinition<In> = {
  op: 'ehr.note.create', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: i.encounter! }),
  refs: i => ({ encounterId: i.encounter! }),
  path: (i, r) => `${E(i)}/${r.encounterId}/clinical-notes`,
  body: i => ({ text: i.text ?? '' }),
  receipt,
}
export const encounterUpdate: OpDefinition<In> = {
  op: 'ehr.encounter.update', opVersion: 1, method: 'PATCH', keyed: true, versionField: 'expectedRowVersion',
  lane: i => ({ patientId: i.patientId, visit: i.encounter! }),
  refs: i => ({ encounterId: i.encounter! }),
  path: (i, r) => `${E(i)}/${r.encounterId}`,
  body: i => ({ status: i.status ?? 'closed', expectedRowVersion: i.expectedRowVersion ?? 1 }),
  receipt,
  intent: i => ({ status: i.status ?? 'closed' }),
}
export const prescriptionCreate: OpDefinition<In> = {
  ...noteCreate, op: 'ehr.prescription.create', safety: 'prescription',
  path: (i, r) => `${E(i)}/${r.encounterId}/prescriptions`,
}
export const ALL_DEFS = [encounterCreate, noteCreate, encounterUpdate, prescriptionCreate] as unknown as OpDefinition<Json>[]

type DocIn = { patientId: string; encounterId: string; media: StagedMedia }
export const documentUpload: OpDefinition<DocIn> = {
  op: 'ehr.document.upload', opVersion: 1, method: 'POST', keyed: true,
  lane: i => ({ patientId: i.patientId, visit: 'media' }),
  refs: i => ({ encounterId: { server: i.encounterId } }),
  path: () => '/api/v1/ehr/documents/upload-intents',
  body: (i, r) => ({
    patientId: i.patientId, encounterId: r.encounterId!, fileName: i.media.fileName, mediaType: i.media.mediaType,
    sizeBytes: i.media.sizeBytes, sha256Hex: i.media.sha256Hex, classification: 'phi', retentionClass: 'clinical-10y',
  }),
  receipt: b => ({ resourceType: 'document', resourceId: (b as { document: { id: string } }).document.id }),
}

