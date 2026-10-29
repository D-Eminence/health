import { describe, expect, it, vi } from 'vitest'
import type { Json, OpDefinition, OpName } from '@hid/offline'

vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { STAFF_OFFLINE_REGISTRY, refFromId, idFromRef } = await import('../registry')

/** The wave-1 registry (OFFLINE-CONTRACT §2.8 table): 15 operations, each the request staffApi sends today. */
const E = '/api/v1/ehr/patients/p-1/encounters'
const definitions = STAFF_OFFLINE_REGISTRY as unknown as readonly OpDefinition<Json>[]
const definition = (op: OpName) => definitions.find(item => item.op === op)!
const scope = { facilityId: 'f-1', patientId: 'p-1', encounter: { server: 'enc-1' } }

describe('staff offline registry', () => {
  it('has the 15 wave-1 operations, once each, all version 1', () => {
    expect(definitions.map(item => item.op).sort()).toEqual([
      'ehr.diagnosis.create', 'ehr.diagnosis.update', 'ehr.document.upload', 'ehr.encounter.create', 'ehr.encounter.update',
      'ehr.lab-request.create', 'ehr.lab-request.to-lab', 'ehr.note.create', 'ehr.note.revise', 'ehr.note.update',
      'ehr.prescription.create', 'ehr.prescription.to-pharmacy', 'ehr.vital.correct', 'ehr.vital.create', 'identity.grant.close',
    ])
    for (const item of definitions) expect(item.opVersion).toBe(1)
  })

  it.each([
    ['ehr.note.create', { ...scope, body: { title: 'T' } }, { encounterId: 'enc-1' }, 'POST', `${E}/enc-1/clinical-notes`],
    ['ehr.vital.create', { ...scope, body: { pulseBpm: 80 } }, { encounterId: 'enc-1' }, 'POST', `${E}/enc-1/vitals`],
    ['ehr.prescription.create', { ...scope, body: {} }, { encounterId: 'enc-1' }, 'POST', `${E}/enc-1/prescriptions`],
    ['ehr.note.revise', { ...scope, note: { server: 'n-1' }, body: { expectedRowVersion: 2 } }, { encounterId: 'enc-1', targetId: 'n-1' }, 'POST', `${E}/enc-1/clinical-notes/n-1/revisions`],
    ['ehr.vital.correct', { ...scope, vital: { server: 'v-1' }, body: { expectedRowVersion: 2 } }, { encounterId: 'enc-1', targetId: 'v-1' }, 'POST', `${E}/enc-1/vitals/v-1/corrections`],
    ['ehr.prescription.to-pharmacy', { ...scope, prescription: { server: 'rx-1' }, body: { expectedRowVersion: 2, reason: 'Ready' } }, { encounterId: 'enc-1', targetId: 'rx-1' }, 'POST', `${E}/enc-1/prescriptions/rx-1/pharmacy-work-item`],
    ['ehr.lab-request.to-lab', { ...scope, labRequest: { server: 'lr-1' }, body: { expectedRowVersion: 2 } }, { encounterId: 'enc-1', targetId: 'lr-1' }, 'POST', `${E}/enc-1/lab-requests/lr-1/lab-work-item`],
    ['ehr.encounter.update', { ...scope, body: { expectedRowVersion: 2, changeReason: 'Done', status: 'completed' } }, { encounterId: 'enc-1' }, 'PATCH', `${E}/enc-1`],
    ['ehr.note.update', { ...scope, note: { server: 'n-1' }, body: { expectedRowVersion: 2, status: 'signed' } }, { encounterId: 'enc-1', targetId: 'n-1' }, 'PATCH', `${E}/enc-1/clinical-notes/n-1`],
    ['ehr.diagnosis.update', { ...scope, diagnosis: { server: 'd-1' }, body: { expectedRowVersion: 2 } }, { encounterId: 'enc-1', targetId: 'd-1' }, 'PATCH', `${E}/enc-1/diagnoses/d-1`],
    ['identity.grant.close', { facilityId: 'f-1', patientId: 'p-1', grantId: 'g-1', body: { reason: 'Done' } }, {}, 'POST', '/api/v1/identity/consent-grants/g-1/close'],
  ] as const)('%s sends %s to the path staffApi uses, with its body unchanged', (op, input, resolved, method, path) => {
    const item = definition(op)
    expect(item.method).toBe(method)
    expect(item.path(input as unknown as Json, resolved)).toBe(path)
    expect(item.body(input as unknown as Json, resolved)).toEqual((input as { body: unknown }).body)
  })

  it('opens a new visit in its own lane and sends the encounter as staffApi does', () => {
    const item = definition('ehr.encounter.create')
    const input = { facilityId: 'f-1', patientId: 'p-1', localId: 'local-1',
      body: { encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-29T10:42:00.000Z', chiefComplaint: 'Cough' } }
    expect(item.lane(input as unknown as Json)).toEqual({ patientId: 'p-1', visit: { local: 'local-1' } })
    expect(item.path(input as unknown as Json, {})).toBe(E)
    expect(item.body(input as unknown as Json, {})).toEqual(input.body)
  })

  it('keys every operation, declares grant close naturally idempotent, holds prescriptions for safety, and puts uploads on the media lane', () => {
    for (const item of definitions) expect(item.keyed).toBe(item.op === 'identity.grant.close' ? 'natural' : true)
    expect(definitions.filter(item => item.safety === 'prescription').map(item => item.op)).toEqual(['ehr.prescription.create'])
    expect(definition('ehr.document.upload').lane({ ...scope, body: {} } as unknown as Json)).toEqual({ patientId: 'p-1', visit: 'media' })
  })

  it('gives PATCH operations an intent and a re-read, and their version field', () => {
    for (const op of ['ehr.encounter.update', 'ehr.note.update', 'ehr.diagnosis.update'] as const) {
      const item = definition(op)
      expect(item.versionField).toBe('expectedRowVersion')
      expect(typeof item.intent).toBe('function')
      expect(typeof item.reread).toBe('function')
    }
    expect(definition('ehr.encounter.update').intent!({ ...scope, body: { status: 'completed' } } as unknown as Json)).toEqual({ status: 'completed' })
  })

  it('reads the receipt from EHR’s answer, with bigint versions sent as text', () => {
    expect(definition('ehr.note.create').receipt({ id: 'n-9', rowVersion: '3' })).toEqual({ resourceType: 'clinical-notes', resourceId: 'n-9', rowVersion: 3 })
    expect(definition('ehr.document.upload').receipt({ document: { id: 'doc-1' }, upload: {} })).toEqual({ resourceType: 'document', resourceId: 'doc-1' })
  })

  it('names a visit saved on this device by its command', () => {
    expect(refFromId('local:cmd-1')).toEqual({ local: 'cmd-1' })
    expect(refFromId('enc-1')).toEqual({ server: 'enc-1' })
    expect(idFromRef({ local: 'cmd-1' })).toBe('local:cmd-1')
  })
})
