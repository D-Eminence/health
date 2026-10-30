import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { HidApiError } from '@hid/http'
import { TransportError, type Json } from '@hid/offline'
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
const { ehrCommands } = await import('../ehrCommands')

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
    // Access allows writing and the chart was read once online, so the device has the chart the form shows offline.
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false,
      observedAt: runtime.trustedNow().at.toISOString() })
    expect(await staffSafetyProbe.capture(input as unknown as Json)).not.toBeNull()
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

/**
 * The coordinator's rule for this device's own prescriptions on one visit: the prescriber saw them, so they are not a
 * change. They are matched by receipt at send time (`receiptFor`, #39, stood in for here from the server's answers).
 */
describe('this device’s own earlier prescriptions on the visit', () => {
  async function offlineVisit() {
    const server = fakeServer()
    const onServer: ReturnType<typeof rx>[] = []
    const byCommand = new Map<string, string>()
    // Health ID gives each prescription an id from its medicine; the visit's list is what it holds.
    server.state.answer = spec => {
      if (!spec.path.endsWith('/prescriptions') || spec.method !== 'POST') return null
      const id = `rx-${String((spec.body as { medicationDisplay: string }).medicationDisplay).split(' ')[0]!.toLowerCase()}`
      onServer.push(rx(id))
      return { status: 201, body: { id, rowVersion: 1 }, date: null }
    }
    api.records.mockImplementation(async () => {
      if (server.state.offline) throw new HidApiError(0, 'Network error', { code: 'NETWORK_ERROR' })
      return { items: [...onServer], nextCursor: null }
    })
    api.reportedHealthProfile.mockImplementation(async () => {
      if (server.state.offline) throw new HidApiError(0, 'Network error', { code: 'NETWORK_ERROR' })
      return profile('Penicillin (rash)')
    })
    const runtime = await realVault(new IDBFactory(), server.transport, undefined, { safety: staffSafetyProbe })
    setOfflineRuntimeForTests(runtime)
    Object.assign(runtime, { receiptFor: async (commandId: string) => {
      const medicine = byCommand.get(commandId)
      const found = medicine ? onServer.find(item => item.id === `rx-${medicine}`) : undefined
      return found ? { commandId, resourceType: 'prescriptions', resourceId: found.id, status: 201, replay: false,
        serverDate: '2026-10-30T08:00:00.000Z', via: 'response' } : null
    } })
    // Access allows writing, and the chart was read once online, so the form has it offline; then Health ID stops answering.
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false,
      observedAt: runtime.trustedNow().at.toISOString() })
    expect(await staffSafetyProbe.capture(input as unknown as Json)).not.toBeNull()
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    const prescribe = async (medicine: string) => {
      const outcome = await ehrCommands.createRecord(PILOT, PATIENT, 'enc-1', 'prescriptions',
        { medicationDisplay: `${medicine} 500 mg`, frequency: 'twice a day', instructions: 'With food', status: 'draft' })
      if (outcome.kind !== 'saved') throw new Error('expected it saved on the device')
      byCommand.set(outcome.commandId, medicine.toLowerCase())
      return outcome.commandId
    }
    const reconnect = async () => {
      server.state.offline = false
      for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
      runtime.commands.syncNow()
      for (let i = 0; i < 6; i += 1) { await runtime.tick(); await runtime.settle() }
    }
    const sentMedicines = () => server.sent.filter(spec => spec.path.endsWith('/prescriptions'))
      .map(spec => (spec.body as { medicationDisplay: string }).medicationDisplay)
    return { server, runtime, onServer, prescribe, reconnect, sentMedicines }
  }
  const reviewed = async (runtime: { review: { list(): Promise<{ commandId: string; class: string }[]> } }) =>
    (await runtime.review.list()).map(item => [item.commandId, item.class])

  beforeEach(() => { api.records.mockReset(); api.reportedHealthProfile.mockReset() })

  it('two prescriptions saved offline on one visit are both sent; neither is held', async () => {
    const visit = await offlineVisit()
    await visit.prescribe('Amoxicillin')
    await visit.prescribe('Paracetamol')
    await visit.reconnect()
    expect(visit.sentMedicines()).toEqual(['Amoxicillin 500 mg', 'Paracetamol 500 mg'])
    expect(await reviewed(visit.runtime)).toEqual([])
    visit.runtime.dispose()
  })

  it('a prescription added on the visit from another browser before they are sent holds them', async () => {
    const visit = await offlineVisit()
    const first = await visit.prescribe('Amoxicillin')
    const second = await visit.prescribe('Paracetamol')
    visit.onServer.push(rx('rx-from-elsewhere'))
    await visit.reconnect()
    // The first is held; the second waits behind it on the visit.
    expect(visit.sentMedicines()).toEqual([])
    expect(await reviewed(visit.runtime)).toEqual([[first, 'CC4']])

    // Sent as is after checking: the second is still held, for the prescription from elsewhere, not for the first.
    await visit.runtime.review.resolve(first, 'send-as-is', {})
    for (let i = 0; i < 6; i += 1) { await visit.runtime.tick(); await visit.runtime.settle() }
    expect(visit.sentMedicines()).toEqual(['Amoxicillin 500 mg'])
    expect(await reviewed(visit.runtime)).toEqual([[second, 'CC4']])
    visit.runtime.dispose()
  })

  it('the first one discarded before it was sent holds the second, which relied on it', async () => {
    const visit = await offlineVisit()
    const first = await visit.prescribe('Amoxicillin')
    const second = await visit.prescribe('Paracetamol')
    await visit.runtime.commands.cancel(first)
    await visit.reconnect()
    expect(visit.sentMedicines()).toEqual([])
    expect(await reviewed(visit.runtime)).toEqual([[second, 'CC4']])
    visit.runtime.dispose()
  })
})

/** Re-review 1 and 5: a chart from the device is checked online before sending; a re-read refused for good holds it. */
describe('the CC4 check before sending', () => {
  beforeEach(() => { api.records.mockReset(); api.reportedHealthProfile.mockReset() })

  it('a prescription written from an old copy on the device is checked online, and held for a new allergy', async () => {
    let wall = Date.parse('2026-10-30T08:00:00.000Z')
    const server = fakeServer()
    let slow = false
    let allergies: string | null = null
    const answer = async <T,>(value: () => T) => {
      if (slow) await new Promise(resolve => setTimeout(resolve, 100))
      return value()
    }
    api.reportedHealthProfile.mockImplementation(() => answer(() => profile(allergies)))
    api.records.mockImplementation(() => answer(() => ({ items: [], nextCursor: null })))
    const runtime = await realVault(new IDBFactory(), server.transport, undefined,
      { safety: staffSafetyProbe, wall: () => wall, mono: () => wall, networkFirstMs: 20 })
    setOfflineRuntimeForTests(runtime)
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false,
      observedAt: runtime.trustedNow().at.toISOString() })
    // 08:00: the chart is read online and kept.
    await staffSafetyProbe.capture(input as unknown as Json)

    // 11:00: Health ID now has an anaphylaxis, but answers slower than the read waits; the connection still looks fine.
    wall += 3 * 60 * 60_000
    // The prescriber is at the keyboard (the vault stays open).
    runtime.noteActivity()
    slow = true
    allergies = 'Penicillin (anaphylaxis)'
    await runtime.commands.save('ehr.prescription.create', input as unknown as Json, { awaitMs: 0 })
    for (let i = 0; i < 4; i += 1) {
      runtime.noteActivity(); await runtime.tick(); await runtime.settle(); await new Promise(resolve => setTimeout(resolve, 150))
    }
    expect(runtime.summary().vault).toBe('unlocked')
    expect(server.sent.filter(spec => spec.path.endsWith('/prescriptions'))).toEqual([])
    expect((await runtime.review.list()).map(item => item.class)).toEqual(['CC4'])
    runtime.dispose()
  })

  it('a re-read Health ID refuses for good (access ended) holds it for review instead of waiting unseen', async () => {
    api.reportedHealthProfile.mockResolvedValue(profile('Penicillin (rash)'))
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    const server = fakeServer()
    const runtime = await realVault(new IDBFactory(), server.transport, undefined, { safety: staffSafetyProbe })
    setOfflineRuntimeForTests(runtime)
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false,
      observedAt: runtime.trustedNow().at.toISOString() })
    expect(await staffSafetyProbe.capture(input as unknown as Json)).not.toBeNull()
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    // A note on one visit, and the prescription on another, so the prescription does not wait behind the note.
    await runtime.commands.save('ehr.note.create', { ...input, encounter: { server: 'enc-2' }, body: { noteType: 'Consultation',
      title: 'Ward round', status: 'draft', content: 'Stable' } } as unknown as Json, { awaitMs: 0 })
    await runtime.commands.save('ehr.prescription.create', input as unknown as Json, { awaitMs: 0 })
    await runtime.settle()
    // Back online, access has ended: the reads and the writes are all refused for good.
    const refused = new HidApiError(403, 'Access to this patient has ended.', { code: 'CONSENT_REQUIRED' })
    api.reportedHealthProfile.mockRejectedValue(refused)
    api.records.mockRejectedValue(refused)
    server.state.answer = () => { throw new TransportError({ status: 403, code: 'CONSENT_REQUIRED', problem: true, networkError: false }) }
    server.state.offline = false
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
    runtime.commands.syncNow()
    for (let i = 0; i < 5; i += 1) { await runtime.tick(); await runtime.settle() }
    const states = Object.fromEntries((await runtime.commands.pendingFor(PATIENT)).map(view => [view.op, view.state]))
    expect(states['ehr.prescription.create']).toBe('review')
    expect((await runtime.review.list()).find(item => item.op === 'ehr.prescription.create')?.class).toBe('CC4')
    runtime.dispose()
  })

  it('a session or passing failure of the re-read is tried again later, not held', async () => {
    setOfflineRuntimeForTests(null)
    api.reportedHealthProfile.mockRejectedValue(new HidApiError(401, 'Sign in again.', { code: 'AUTHENTICATION_REQUIRED' }))
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    await expect(staffSafetyProbe.current(input as unknown as Json, { encounterId: 'enc-1' })).rejects.toThrow('Sign in again.')
    api.reportedHealthProfile.mockRejectedValue(new HidApiError(429, 'Slow down.', { code: 'RATE_LIMITED' }))
    await expect(staffSafetyProbe.current(input as unknown as Json, { encounterId: 'enc-1' })).rejects.toThrow('Slow down.')
  })
})
