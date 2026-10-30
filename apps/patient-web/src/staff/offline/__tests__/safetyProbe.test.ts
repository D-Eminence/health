import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { HidApiError } from '@hid/http'
import type { Json } from '@hid/offline'
import { fakeServer, PILOT, realVault } from './offlineFixture'

type ApiModule = typeof ApiModuleNs

/**
 * Review item 3 (A12.4, A8.3): the staff app's CC4 safety probe. A prescription saved online for a visit on Health ID
 * is sent as today; one saved offline is held for review when the patient's allergies or the visit's prescriptions
 * changed before it could be sent.
 */
const api = vi.hoisted(() => ({ reportedHealthProfile: vi.fn(), records: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
const { setOfflineRuntimeForTests } = await import('../runtime')
const { forgetDeviceCopies } = await import('../ehrReads')
const { staffSafetyProbe } = await import('../safetyProbe')

const PATIENT = 'a0000000-0000-4000-8000-00000000000a'
const profile = (allergies: string | null) => ({ bloodGroup: null, genotype: null, allergies, currentMedications: 'Metformin 500 mg',
  chronicConditions: null, medicalNotes: null, updatedAt: null })
const rx = (id: string, rowVersion = 1) => ({ id, patientId: PATIENT, encounterId: 'enc-1', createdAt: '2026-10-29T08:00:00.000Z',
  medicationDisplay: 'Ibuprofen 400 mg', rowVersion })
const input = { facilityId: PILOT, patientId: PATIENT, encounter: { server: 'enc-1' },
  body: { medicationDisplay: 'Amoxicillin 500 mg', frequency: 'three times a day', instructions: 'With food', status: 'draft' } }

const meta = (status: number | null) => ({ method: 'GET', path: '/api/v1/auth/session', status, date: null, problem: false, code: null,
  networkError: status === null, authenticated: true })

beforeEach(() => {
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  api.reportedHealthProfile.mockReset().mockResolvedValue(profile('Penicillin (rash)'))
  api.records.mockReset().mockResolvedValue({ items: [rx('rx-1')], nextCursor: null })
})
afterEach(() => { setOfflineRuntimeForTests(undefined); forgetDeviceCopies(); vi.unstubAllGlobals() })

describe('the CC4 safety probe', () => {
  it('sees no change when nothing changed, and a change in the allergies or the visit’s prescriptions', async () => {
    setOfflineRuntimeForTests(null)
    const seen = await staffSafetyProbe.capture(input as unknown as Json)
    expect(seen).not.toBeNull()
    const now = await staffSafetyProbe.current(input as unknown as Json, { encounterId: 'enc-1' })
    expect(now).toEqual({ allergiesSha256: seen!.allergiesSha256, encounterRxSha256: seen!.encounterRxSha256 })

    api.reportedHealthProfile.mockResolvedValue(profile('Penicillin (anaphylaxis)'))
    expect((await staffSafetyProbe.current(input as unknown as Json, { encounterId: 'enc-1' })).allergiesSha256).not.toBe(seen!.allergiesSha256)
    api.reportedHealthProfile.mockResolvedValue(profile('Penicillin (rash)'))
    api.records.mockResolvedValue({ items: [rx('rx-1'), rx('rx-2')], nextCursor: null })
    expect((await staffSafetyProbe.current(input as unknown as Json, { encounterId: 'enc-1' })).encounterRxSha256).not.toBe(seen!.encounterRxSha256)
  })

  it('takes nothing when the chart cannot be read at save, so the prescription is held', async () => {
    setOfflineRuntimeForTests(null)
    api.reportedHealthProfile.mockRejectedValue(new HidApiError(0, 'Network error', { code: 'NETWORK_ERROR' }))
    expect(await staffSafetyProbe.capture(input as unknown as Json)).toBeNull()
  })

  it('with the real core: a prescription saved online for a visit on Health ID is sent as today', async () => {
    const server = fakeServer()
    const runtime = await realVault(new IDBFactory(), server.transport, undefined, { safety: staffSafetyProbe })
    setOfflineRuntimeForTests(runtime)
    const outcome = await runtime.commands.save('ehr.prescription.create', input as unknown as Json, { awaitMs: 8000 })
    await runtime.settle()
    expect(outcome.kind).toBe('applied')
    expect(server.sent.filter(spec => spec.path.endsWith('/prescriptions'))).toHaveLength(1)
    expect(await runtime.review.list()).toEqual([])
    runtime.dispose()
  })

  it('with the real core: saved offline, then a new allergy before it is sent, it is held for review (CC4)', async () => {
    const server = fakeServer()
    const runtime = await realVault(new IDBFactory(), server.transport, undefined, { safety: staffSafetyProbe })
    setOfflineRuntimeForTests(runtime)
    // Read once online, so the device has the chart the form shows offline.
    await staffSafetyProbe.capture(input as unknown as Json)
    // Health ID stops answering: the runtime hears it as the staff client tells it (onResponseMeta).
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    expect(runtime.connectivity()).toBe('offline')
    await runtime.commands.save('ehr.prescription.create', input as unknown as Json, { awaitMs: 0 })
    await runtime.settle()
    api.reportedHealthProfile.mockResolvedValue(profile('Penicillin (anaphylaxis)'))
    server.state.offline = false
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
    await runtime.tick()
    await runtime.settle()
    await runtime.settle()
    expect(server.sent.filter(spec => spec.path.endsWith('/prescriptions'))).toEqual([])
    expect((await runtime.review.list()).map(item => item.class)).toEqual(['CC4'])
    runtime.dispose()
  })
})
