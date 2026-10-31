import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { Json, OpDefinition } from '../contracts'
import { PASSWORD, PATIENT, SESSION, documentUpload, noteCreate } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn } from './harness'

async function ready(extra: Parameters<typeof makeRuntime>[0]['extra'] = {}) {
  const server = createServer()
  const env = makeEnv()
  const idb = new IDBFactory()
  const rt = makeRuntime({ server, env, idb, extra })
  rt.commands.register([documentUpload as unknown as OpDefinition<Json>])
  await signIn(rt)
  return { rt, server, env, idb }
}
const dump = async (rt: Awaited<ReturnType<typeof ready>>['rt']) => (await rt.storeForDiagnostics())!.dump()

describe('fixes from the core review', () => {
  it('a document whose PUT failed is never marked applied by the intent receipt; its chunks are kept', async () => {
    let failPut = true
    const { rt, server } = await ready({ upload: async () => { if (failPut) { failPut = false; throw new Error('network') } } })
    const staged = await rt.stageMedia(new Blob([new Uint8Array(32)], { type: 'application/pdf' }), { index: 1 })
    await rt.commands.save('ehr.document.upload', { patientId: PATIENT, encounterId: 'e1', media: staged } as unknown as Json, { awaitMs: 0 })
    await settle(rt)
    server.failWhenBody('clinical-10y', { status: 403, code: 'CONSENT_REQUIRED' })
    rt.commands.syncNow()
    await settle(rt)
    expect((await rt.review.list())[0]!.class).toBe('CC5')
    expect((await dump(rt)).media).toHaveLength(1)
    expect(server.calls.some(c => c.spec.path.endsWith('/complete'))).toBe(false)
  })

  it('a staged file survives a lock and unlock before it is saved', async () => {
    const { rt } = await ready()
    await rt.stageMedia(new Blob([new Uint8Array(32)], { type: 'application/pdf' }), { index: 1 })
    rt.lock('idle')
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(true)
    expect((await dump(rt)).media).toHaveLength(1)
  })

  it('a resolution whose new entry cannot be saved keeps the original in review', async () => {
    const { rt, server } = await ready()
    server.fail({ status: 503 }, { status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    const [item] = await rt.review.list()
    await expect(rt.review.resolve(item!.commandId, 'apply-on-top', { reason: 'Kept my change on top', input: { patientId: PATIENT, text: 'x'.repeat(9000) } }))
      .rejects.toMatchObject({ reason: 'too-long' })
    expect((await rt.review.list()).map(r => r.commandId)).toEqual([item!.commandId])
  })

  it('signing out after an online reload wipes the readable copy', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first)
    first.dispose()
    const reload = makeRuntime({ server, env, idb })
    await reload.attachSession(SESSION, { optIn: false, online: true })
    await reload.signOut({ online: true })
    const cold = makeRuntime({ server, env, idb })
    expect((await cold.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
  })

  it('an edit cannot move an entry to another visit; a definition that throws goes to review, not a busy loop', async () => {
    const { rt, server } = await ready()
    rt.setSessionReady(false)
    const out = await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'a' }, { awaitMs: 0 })
    const id = (out as { commandId: string }).commandId
    await expect(rt.commands.edit(id, { patientId: PATIENT, encounter: { server: 'e2' }, text: 'a' })).rejects.toThrow(/another visit/)

    let calls = 0
    rt.commands.register([{ ...(noteCreate as unknown as OpDefinition<Json>), op: 'ehr.diagnosis.create',
      body: () => { calls += 1; if (calls > 1) throw new Error('bad definition'); return { x: 1 } } }])
    await rt.commands.save('ehr.diagnosis.create', { patientId: 'p9', encounter: { server: 'e9' } }, { awaitMs: 0 })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    expect((await rt.review.list()).find(r => r.op === 'ehr.diagnosis.create')!.class).toBe('CC7')
    expect(calls).toBeLessThan(5)
    expect(server.writes().every(w => !w.spec.path.includes('p9'))).toBe(true)
  })

  it('a membership end keeps the answer of a request already on the wire', async () => {
    const { rt, server } = await ready()
    let release: () => void = () => undefined
    server.state.gate = new Promise(r => { release = r })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await new Promise(r => setTimeout(r, 20))
    const held = rt.wipe('membership')
    await new Promise(r => setTimeout(r, 20))
    server.state.gate = null
    release()
    await held
    const outbox = (await dump(rt)).outbox as { state: string }[]
    expect(outbox.map(o => o.state)).toEqual(['applied'])
    expect(server.keys.size).toBe(1)
  })

  it('a send-only vault (facility left the pilot) accepts no new entries', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.dispose()
    const off = makeRuntime({ server, env, idb, mode: 'off' })
    off.prepareFromSignIn(SESSION.email, PASSWORD)
    await off.attachSession(SESSION, { optIn: false, online: true })
    await expect(off.commands.save('ehr.encounter.create', { patientId: PATIENT })).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('an online sign-out keeps a vault that still holds a discarded entry', async () => {
    const { rt, server } = await ready()
    server.fail({ status: 503 }, { status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    const [item] = await rt.review.list()
    await rt.review.resolve(item!.commandId, 'discard', { reason: 'Entered elsewhere already' })
    await rt.signOut({ online: true })
    expect(await rt.hasVaults()).toBe(true)
  })
})
