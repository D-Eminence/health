import { describe, expect, it } from 'vitest'
import { SaveRefused } from '../types'
import { createFakeOfflineRuntime } from '../testing'
import { ALL_DEFS, OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'

async function signedIn() {
  const fake = createFakeOfflineRuntime()
  fake.runtime.commands.register(ALL_DEFS)
  fake.runtime.prepareFromSignIn(SESSION.email, PASSWORD)
  expect(await fake.runtime.offer(SESSION)).toEqual({ kind: 'ask' })
  await fake.runtime.attachSession(SESSION, { optIn: true, online: true })
  return fake
}

describe('fake offline runtime', () => {
  it('offers the one-time choice only for a pilot facility (A5)', async () => {
    const { runtime } = createFakeOfflineRuntime()
    runtime.prepareFromSignIn(SESSION.email, PASSWORD)
    expect(await runtime.offer({ ...SESSION, facilityId: OTHER_FACILITY })).toEqual({ kind: 'unavailable', reason: 'facility-off' })
    const s = await runtime.attachSession({ ...SESSION, facilityId: OTHER_FACILITY }, { optIn: true, online: true })
    expect(s.vault).toBe('none')
    expect(await runtime.hasVaults()).toBe(false)
  })

  it('declining writes nothing', async () => {
    const { runtime } = createFakeOfflineRuntime()
    runtime.prepareFromSignIn(SESSION.email, PASSWORD)
    await runtime.attachSession(SESSION, { optIn: false, online: true })
    expect(await runtime.hasVaults()).toBe(false)
  })

  it('applies online saves and queues offline ones with a stable key', async () => {
    const { runtime, controls } = await signedIn()
    const applied = await runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })
    expect(applied.kind).toBe('applied')
    controls.simulate('offline')
    const saved = await runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })
    expect(saved.kind).toBe('saved')
    expect(runtime.summary().pending).toBe(1)
    controls.simulate('flapping')
    await controls.flush()
    await controls.flush()
    const sent = controls.requests.filter(r => r.commandId === (saved as { commandId: string }).commandId)
    expect(new Set(sent.map(r => r.headers['Idempotency-Key'])).size).toBe(1)
    expect(runtime.summary().pending).toBe(0)
  })

  it('a dependent note waits for its visit and uses the server id', async () => {
    const { runtime, controls } = await signedIn()
    controls.simulate('offline')
    const visit = await runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })
    const id = (visit as { commandId: string }).commandId
    await runtime.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { local: id }, text: 'x' })
    controls.respondNext({ status: 201, body: { id: 'srv-enc', rowVersion: 1 } })
    controls.simulate('online')
    await controls.flush()
    expect(controls.requests.at(-1)!.path).toContain('/encounters/srv-enc/clinical-notes')
  })

  it('refuses a body over 8000 bytes at save', async () => {
    const { runtime } = await signedIn()
    await expect(runtime.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'a'.repeat(8100) }))
      .rejects.toBeInstanceOf(SaveRefused)
  })

  it('a first-attempt definitive refusal goes back to the form', async () => {
    const { runtime, controls } = await signedIn()
    controls.respondNext({ status: 400, code: 'BAD_REQUEST' })
    await expect(runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })).rejects.toMatchObject({ reason: 'refused' })
    expect(runtime.summary().pending).toBe(0)
  })

  it('simulates 412, 403 and receipt-found', async () => {
    const { runtime, controls } = await signedIn()
    controls.respondNext({ status: 503 }, { status: 412, code: 'VERSION_CONFLICT' })
    await runtime.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: 'e1' } })
    runtime.commands.syncNow()
    await controls.flush()
    expect((await runtime.review.list())[0]!.class).toBe('CC2')

    controls.respondNext({ status: null, networkError: true }, { status: 403, code: 'CONSENT_REQUIRED' })
    await runtime.commands.save('ehr.encounter.create', { patientId: 'p2' })
    runtime.commands.syncNow()
    await controls.flush()
    expect((await runtime.review.list()).map(r => r.class)).toContain('CC5')

    controls.receiptFound(true)
    controls.respondNext({ status: null, networkError: true }, { status: 404, code: 'ENCOUNTER_NOT_FOUND' })
    const r = await runtime.commands.save('ehr.encounter.create', { patientId: 'p3' })
    runtime.commands.syncNow()
    await controls.flush()
    expect(controls.commands().find(c => c.id === (r as { commandId: string }).commandId)!.receipt!.via).toBe('lookup')
  })

  it('a clock rollback refuses offline unlock', async () => {
    const { runtime, controls } = await signedIn()
    runtime.lock('manual')
    controls.rollbackClock(10 * 60_000)
    expect(await runtime.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'clock-suspect' })
  })

  it('five wrong passwords wipe the saved copies and keep pending work', async () => {
    const { runtime, controls } = await signedIn()
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await runtime.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => ['e'] })
    controls.simulate('offline')
    await runtime.commands.save('ehr.encounter.create', { patientId: PATIENT })
    runtime.lock('manual')
    for (let i = 0; i < 4; i += 1) expect((await runtime.unlockOffline(SESSION.email, 'wrong password!')).ok).toBe(false)
    expect(await runtime.unlockOffline(SESSION.email, 'wrong password!')).toEqual({ ok: false, reason: 'wiped' })
    expect((await runtime.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
    expect(controls.cachedPatients()).toEqual([])
    expect(runtime.summary().pending).toBe(1)
  })

  it('emergency reads are never kept', async () => {
    const { runtime, controls } = await signedIn()
    await runtime.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await runtime.reads.read({ method: 'emergencyRecords', args: [PATIENT], patientId: PATIENT, emergency: true, network: async () => 1 })
    expect(controls.cachedPatients()).toEqual([])
  })
})
