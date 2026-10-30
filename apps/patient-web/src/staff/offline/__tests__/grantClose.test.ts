import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { TransportError, type Json, type SendSpec } from '@hid/offline'
import { fakeServer, PILOT, realVault } from './offlineFixture'

/**
 * Review item 8 (A12.6): closing access waits for the patient's work on this device, held or in review included; a
 * change it waited for that is discarded leaves the close saved again, so access still closes.
 */
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
const { setOfflineRuntimeForTests } = await import('../runtime')
const { CLOSE_RESAVED, ehrCommands, resaveGrantCloses } = await import('../ehrCommands')

const PATIENT = 'a0000000-0000-4000-8000-00000000000a'
const note = { facilityId: PILOT, patientId: PATIENT, encounter: { server: 'enc-1' },
  body: { noteType: 'Consultation', title: 'Ward round', status: 'draft', content: 'Stable' } }
const isNote = (spec: SendSpec) => spec.path.endsWith('/clinical-notes')
const isClose = (spec: SendSpec) => spec.path.endsWith('/close')

/** What the staff client tells the runtime of each answer: none (offline) or a status. */
const meta = (status: number | null) => ({ method: 'GET', path: '/api/v1/auth/session', status, date: null, problem: false, code: null,
  networkError: status === null, authenticated: true })

beforeEach(() => { vi.stubGlobal('IDBKeyRange', IDBKeyRange) })
afterEach(() => { setOfflineRuntimeForTests(undefined); vi.unstubAllGlobals() })

async function setUp() {
  const server = fakeServer()
  const runtime = await realVault(new IDBFactory(), server.transport)
  setOfflineRuntimeForTests(runtime)
  return { server, runtime }
}

describe('closing access waits for the patient’s work (A12.6)', () => {
  it('is sent only after a note saved before it, even when the note is delayed', async () => {
    const { server, runtime } = await setUp()
    // The note's first try meets a busy server (503) and waits to try again; the close must not go ahead of it.
    let notesTried = 0
    server.state.answer = spec => {
      if (isNote(spec) && (notesTried += 1) === 1) throw new TransportError({ status: 503, networkError: false })
      return isClose(spec) ? { status: 200, body: { id: 'grant-1' }, date: null } : null
    }
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    await runtime.commands.save('ehr.note.create', note as unknown as Json, { awaitMs: 0 })
    await ehrCommands.closeGrant(PILOT, PATIENT, 'grant-1', 'Care handed over')
    await runtime.settle()
    server.state.offline = false
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
    runtime.commands.syncNow()
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    expect(server.sent.filter(isClose)).toEqual([])
    runtime.commands.syncNow()
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    const order = server.sent.filter(spec => isNote(spec) || isClose(spec)).map(spec => (isNote(spec) ? 'note' : 'close'))
    expect(order).toEqual(['note', 'note', 'close'])
    runtime.dispose()
  })

  it('waits for a note held for review, and is saved again and sent when that note is discarded', async () => {
    const { server, runtime } = await setUp()
    // The note is refused (the visit was closed meanwhile): it goes to review and stays unfinished.
    server.state.answer = spec => {
      if (isNote(spec)) throw new TransportError({ status: 409, code: 'ENCOUNTER_CLOSED', problem: true, networkError: false })
      return isClose(spec) ? { status: 200, body: { id: 'grant-1' }, date: null } : null
    }
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    await runtime.commands.save('ehr.note.create', note as unknown as Json, { awaitMs: 0 })
    await ehrCommands.closeGrant(PILOT, PATIENT, 'grant-1', 'Care handed over')
    server.state.offline = false
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
    runtime.commands.syncNow()
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    const review = await runtime.review.list()
    const held = review.find(item => item.op === 'ehr.note.create')
    expect(held).toBeTruthy()
    expect(server.sent.filter(isClose)).toEqual([])

    await runtime.review.resolve(held!.commandId, 'discard', { reason: 'Entered on the wrong visit' })
    for (let i = 0; i < 3; i += 1) await runtime.settle()
    // The close, left in review (CC3) by the discard, is saved again as it was.
    expect((await runtime.review.list()).map(item => [item.op, item.class])).toContainEqual(['identity.grant.close', 'CC3'])
    expect(await resaveGrantCloses(runtime)).toBe(1)
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    const closes = server.sent.filter(isClose)
    expect(closes).toHaveLength(1)
    expect(closes[0]!.body).toEqual({ reason: 'Care handed over' })
    expect(await runtime.review.list()).toEqual([])
    expect(CLOSE_RESAVED.length).toBeGreaterThanOrEqual(8)
    runtime.dispose()
  })

  it('saved again after a discard, still waits for a prescription held for review on another visit (re-review 2)', async () => {
    const { server, runtime } = await setUp()
    server.state.answer = spec => {
      if (isNote(spec)) throw new TransportError({ status: 409, code: 'ENCOUNTER_CLOSED', problem: true, networkError: false })
      return isClose(spec) ? { status: 200, body: { id: 'grant-1' }, date: null } : null
    }
    server.state.offline = true
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(null))
    await runtime.commands.save('ehr.note.create', note as unknown as Json, { awaitMs: 0 })
    // Saved offline with no safety probe here: held for review before it is sent (CC4, A8.3).
    await runtime.commands.save('ehr.prescription.create', { ...note, encounter: { server: 'enc-2' }, body: { medicationDisplay: 'Amoxicillin 500 mg',
      frequency: 'twice a day', instructions: 'With food', status: 'draft' } } as unknown as Json, { awaitMs: 0 })
    await ehrCommands.closeGrant(PILOT, PATIENT, 'grant-1', 'Care handed over')
    server.state.offline = false
    for (let i = 0; i < 3; i += 1) runtime.onResponseMeta(meta(200))
    runtime.commands.syncNow()
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    const review = await runtime.review.list()
    const held = review.find(item => item.op === 'ehr.note.create')!
    expect(review.find(item => item.op === 'ehr.prescription.create')?.class).toBe('CC4')

    await runtime.review.resolve(held.commandId, 'discard', { reason: 'Entered on the wrong visit' })
    for (let i = 0; i < 3; i += 1) await runtime.settle()
    // The prescription is still waiting for review: the close is not saved again, and not sent.
    expect(await resaveGrantCloses(runtime)).toBe(0)
    for (let i = 0; i < 3; i += 1) await runtime.settle()
    expect(server.sent.filter(isClose)).toEqual([])

    // Once nothing else of the patient's is waiting, it is saved again and sent.
    const prescription = (await runtime.review.list()).find(item => item.op === 'ehr.prescription.create')!
    await runtime.review.resolve(prescription.commandId, 'discard', { reason: 'Prescribed on paper instead' })
    for (let i = 0; i < 3; i += 1) await runtime.settle()
    expect(await resaveGrantCloses(runtime)).toBe(1)
    for (let i = 0; i < 4; i += 1) await runtime.settle()
    expect(server.sent.filter(isClose)).toHaveLength(1)
    runtime.dispose()
  })
})
