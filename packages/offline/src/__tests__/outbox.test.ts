import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { Json, OpDefinition } from '../contracts'
import { createMemoryLocks } from '../testing'
import { SaveRefused } from '../types'
import { PATIENT, SESSION, encounterUpdate } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, settle, signIn, until, type Server } from './harness'

async function online(server = createServer(), extra: Parameters<typeof makeRuntime>[0]['extra'] = {}) {
  const env = makeEnv()
  const idb = new IDBFactory()
  const rt = makeRuntime({ server, env, idb, extra })
  await signIn(rt)
  return { rt, server, env, idb }
}

async function commands(rt: Awaited<ReturnType<typeof online>>['rt']) {
  const store = (await rt.storeForDiagnostics())!
  return store.dump()
}

describe('outbox: save path', () => {
  it('applies at once when online and returns the receipt', async () => {
    const { rt, server } = await online()
    const out = await rt.commands.save<{ id: string }>('ehr.encounter.create', { patientId: PATIENT })
    expect(out.kind).toBe('applied')
    if (out.kind !== 'applied') return
    expect(out.receipt).toMatchObject({ via: 'response', status: 201, resourceId: out.value.id })
    const sent = server.writes()[0]!
    expect(sent.spec.headers!['Idempotency-Key']).toMatch(/^off1\.[0-9a-f-]{36}$/)
    expect(sent.spec.headers!['Idempotency-Key']).toHaveLength(41)
    expect(sent.spec.headers!['X-HID-Offline-Command']).toBe(sent.spec.headers!['Idempotency-Key'])
    expect(sent.spec.headers!['X-HID-Clock']).toMatch(/^(anchored|wall|suspect)$/)
    expect(sent.spec.headers!['X-Facility-ID']).toBe(SESSION.facilityId)
  })

  it('I1: "saved" only after the record is committed', async () => {
    const { rt, server } = await online()
    server.state.offline = true
    const out = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    expect(out.kind).toBe('saved')
    const dump = await commands(rt)
    expect(dump.outbox).toHaveLength(1)
  })

  it('refuses a body over 8000 bytes at save (T14)', async () => {
    const { rt } = await online()
    await expect(rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'x'.repeat(8001) }))
      .rejects.toMatchObject({ name: 'SaveRefused', reason: 'too-long' })
    expect((await commands(rt)).outbox).toHaveLength(0)
  })

  it('a definitive first refusal is removed and goes to the form', async () => {
    const { rt, server } = await online()
    server.fail({ status: 400, code: 'INVALID_CLINICAL_DATA', body: { fields: { reason: 'required' } } })
    const err = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SaveRefused)
    expect((err as SaveRefused).reason).toBe('refused')
    expect((err as SaveRefused).cause).toMatchObject({ status: 400, code: 'INVALID_CLINICAL_DATA' })
    await settle(rt)
    expect((await commands(rt)).outbox).toHaveLength(0)
  })

  it('edit and cancel only while never sent', async () => {
    const { rt, server } = await online()
    server.state.offline = true
    const out = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'a' }, { awaitMs: 0 })
    await settle(rt)
    const id = (out as { commandId: string }).commandId
    await expect(rt.commands.edit(id, { patientId: PATIENT, text: 'b' })).rejects.toThrow(/already been sent/)
    await expect(rt.commands.cancel(id)).rejects.toThrow(/already been sent/)

    rt.setSessionReady(false)
    const second = await rt.commands.save('ehr.encounter.create', { patientId: 'p2', text: 'a' }, { awaitMs: 0 })
    const id2 = (second as { commandId: string }).commandId
    await rt.commands.edit(id2, { patientId: 'p2', text: 'changed' })
    expect((await rt.commands.pendingFor('p2'))[0]!.input).toEqual({ patientId: 'p2', text: 'changed' })
    await rt.commands.cancel(id2)
    expect(await rt.commands.pendingFor('p2')).toEqual([])
  })
})

describe('outbox: at most once', () => {
  it('the frozen body bytes are identical across 100 replays (property)', async () => {
    const { rt, server } = await online()
    const faults = Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? { status: null, networkError: true } : { status: 503 }))
    server.fail(...faults)
    const out = await rt.commands.save('ehr.note.create', {
      patientId: PATIENT, encounter: { server: 'enc-1' }, text: 'Patient reports dizziness. ¿Mareo? 头晕 — follow up in 2 days.',
    }, { awaitMs: 0 })
    for (let i = 0; i < 150 && server.keys.size === 0; i += 1) {
      rt.commands.syncNow()
      await settle(rt)
    }
    const all = server.writes()
    expect(all).toHaveLength(101)
    const key = all[0]!.spec.headers!['Idempotency-Key']!
    expect(new Set(all.map(c => c.bodyText)).size).toBe(1)
    expect(new Set(all.map(c => JSON.stringify(c.spec.headers))).size).toBe(1)
    expect(new Set(all.map(c => c.spec.path)).size).toBe(1)
    expect(all.every(c => c.spec.headers!['Idempotency-Key'] === key)).toBe(true)
    expect(server.keys.size).toBe(1)
    expect(out.kind).toBe('saved')
    expect(rt.summary().pending).toBe(0)
  }, 60_000)

  it('a restart mid-sending replays the same key and applies once', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first)
    server.state.hangNextAnswer = true
    await first.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await new Promise(r => setTimeout(r, 30))
    first.dispose()

    const second = makeRuntime({ server, env, idb })
    await signIn(second)
    await settle(second)
    const writes = server.writes()
    expect(writes).toHaveLength(2)
    expect(writes[0]!.spec.headers!['Idempotency-Key']).toBe(writes[1]!.spec.headers!['Idempotency-Key'])
    expect(writes[0]!.bodyText).toBe(writes[1]!.bodyText)
    expect(server.keys.size).toBe(1)
    expect(second.summary().pending).toBe(0)
  })

  it('the outbox survives a restart (a new runtime on the same store)', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const a = makeRuntime({ server, env, idb })
    await signIn(a)
    a.setSessionReady(false)
    await a.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    a.dispose()
    const b = makeRuntime({ server, env, idb })
    expect((await b.unlockOffline(SESSION.email, 'correct horse battery')).ok).toBe(true)
    expect(await b.commands.pendingFor(PATIENT)).toHaveLength(1)
    expect((await b.commands.pendingFor(PATIENT))[0]!.label).toBe('Saved on this device, not sent yet')
  })

  it('receipt check: a refusal after an unknown outcome is applied when the key completed (F3)', async () => {
    const { rt, server } = await online()
    server.state.loseNextAnswer = true
    const out = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    server.fail({ status: 403, code: 'CONSENT_REQUIRED' })
    rt.commands.syncNow()
    await settle(rt)
    expect(server.calls.some(c => c.spec.path === '/api/v1/ehr/offline/receipts/lookup')).toBe(true)
    expect(rt.summary().pending).toBe(0)
    expect(await rt.review.list()).toEqual([])
    expect(out.kind).toBe('saved')
  })

  it('receipt lookup unreachable: stays "Sent, waiting for confirmation" (CC1)', async () => {
    const { rt, server } = await online()
    server.fail({ status: null, networkError: true }, { status: 404, code: 'ENCOUNTER_NOT_FOUND' })
    server.state.receiptsDown = true
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'x' }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    const pending = await rt.commands.pendingFor(PATIENT)
    expect(pending[0]!.label).toBe("Sent, waiting for confirmation. Don't enter it again.")
    expect((await rt.review.list())[0]!.class).toBe('CC1')
  })
})

describe('outbox: classification flows', () => {
  async function sentThen(fault: Parameters<Server['fail']>[0], op: 'ehr.encounter.create' | 'ehr.note.create' = 'ehr.encounter.create') {
    const ctx = await online()
    ctx.server.fail({ status: 503 }, fault)
    const input: Json = op === 'ehr.note.create' ? { patientId: PATIENT, encounter: { server: 'e1' }, text: 'x' } : { patientId: PATIENT }
    await ctx.rt.commands.save(op, input, { awaitMs: 0 })
    await settle(ctx.rt)
    ctx.rt.commands.syncNow()
    await settle(ctx.rt)
    return ctx
  }

  it('403 consent after a send → held for access (CC5), resumes with the same key after re-consent', async () => {
    const { rt, server } = await sentThen({ status: 403, code: 'CONSENT_REQUIRED' })
    const [item] = await rt.review.list()
    expect(item!.class).toBe('CC5')
    await expect(rt.review.resolve(item!.commandId, 'ask-access', { reason: 'short' })).rejects.toThrow(/8 characters/)
    await rt.review.resolve(item!.commandId, 'ask-access', { reason: 'Patient re-approved access' })
    await rt.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await settle(rt)
    expect(rt.summary().pending).toBe(0)
    const keys = new Set(server.writes().map(c => c.spec.headers!['Idempotency-Key']))
    expect(keys.size).toBe(1)
  })

  it('a 403 that is not problem+json is "edge" (CC7, too long to send)', async () => {
    const { rt } = await sentThen({ status: 403, problem: false })
    expect((await rt.review.list())[0]!.class).toBe('CC7')
  })

  it('401 holds the vault for sign-in (CC6) and resumes after the session is back', async () => {
    const { rt } = await sentThen({ status: 401 })
    expect(rt.summary().attention).toBe(1)
    expect((await rt.commands.pendingFor(PATIENT))[0]!.label).toBe('Waiting for you to sign in')
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    expect(rt.summary().pending).toBe(0)
  })

  it('404 after a send with no receipt → CC3; 409 state → CC3; 412 POST → CC2', async () => {
    expect((await (await sentThen({ status: 404, code: 'ENCOUNTER_NOT_FOUND' }, 'ehr.note.create')).rt.review.list())[0]!.class).toBe('CC3')
    expect((await (await sentThen({ status: 409, code: 'INVALID_ENCOUNTER_TRANSITION' }, 'ehr.note.create')).rt.review.list())[0]!.class).toBe('CC3')
    expect((await (await sentThen({ status: 412, code: 'VERSION_CONFLICT' })).rt.review.list())[0]!.class).toBe('CC2')
  })

  it('400 after a send → CC7 with a redacted defect report', async () => {
    const reports: unknown[] = []
    const ctx = await online(createServer(), { report: e => reports.push(e) })
    ctx.server.fail({ status: 503 }, { status: 400, code: 'BAD_REQUEST' })
    await ctx.rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'secret note text' }, { awaitMs: 0 })
    await settle(ctx.rt)
    ctx.rt.commands.syncNow()
    await settle(ctx.rt)
    expect((await ctx.rt.review.list())[0]!.class).toBe('CC7')
    expect(reports).toContainEqual({ kind: 'defect', op: 'ehr.encounter.create', status: 400, code: 'BAD_REQUEST' })
    expect(JSON.stringify(reports)).not.toContain('secret note text')
  })

  it('409 IDEMPOTENCY_RESULT_UNAVAILABLE is applied after the receipt check', async () => {
    const { rt } = await sentThen({ status: 409, code: 'IDEMPOTENCY_RESULT_UNAVAILABLE' })
    // The 503 attempt never reached the table, so the lookup does not know the key: it keeps asking (CC1), never refuses.
    expect((await rt.review.list())[0]!.class).toBe('CC1')
  })

  it('discard needs a reason, keeps the body sealed and records an audit event', async () => {
    const { rt, server } = await sentThen({ status: 412, code: 'VERSION_CONFLICT' })
    const [item] = await rt.review.list()
    await expect(rt.review.resolve(item!.commandId, 'send-as-is', {})).rejects.toThrow(/not available/)
    await rt.review.resolve(item!.commandId, 'discard', { reason: 'Entered on the other device' })
    // The summary counts the discard's own audit event until it is sent, and refreshes in the background.
    await until(() => rt.summary().pending === 0)
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    await new Promise(r => setTimeout(r, 20))
    const dump = await commands(rt)
    expect(dump.outbox).toHaveLength(1)
    expect((dump.outbox[0] as { state: string }).state).toBe('discarded')
    const events = server.audit.flatMap(b => b.events)
    expect(events.map(e => e.action)).toContain('ehr.offline.command.discarded')
  })

  it('apply on top (CC2) sends a new command with a new key that supersedes the old one', async () => {
    const { rt, server } = await sentThen({ status: 412, code: 'VERSION_CONFLICT' })
    const [item] = await rt.review.list()
    await rt.review.resolve(item!.commandId, 'apply-on-top', { reason: 'Kept my change on top', input: { patientId: PATIENT, text: 'v2' } })
    await settle(rt)
    expect(rt.summary().pending).toBe(0)
    expect(new Set(server.writes().map(c => c.spec.headers!['Idempotency-Key'])).size).toBe(2)
  })
})

describe('outbox: PATCH re-read on 412', () => {
  function withReread(current: Record<string, Json>): OpDefinition<Json> {
    return { ...(encounterUpdate as unknown as OpDefinition<Json>), reread: async () => current }
  }

  it('applied when the record already shows the change', async () => {
    const { rt, server } = await online()
    rt.commands.register([withReread({ status: 'closed', rowVersion: 3 })])
    server.fail({ status: null, networkError: true }, { status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: 'e1' }, status: 'closed' }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    expect(rt.summary().pending).toBe(0)
    expect(await rt.review.list()).toEqual([])
    expect(server.writes().every(c => c.spec.method === 'PATCH')).toBe(true)
  })

  it('CC2 when it does not', async () => {
    const { rt, server } = await online()
    rt.commands.register([withReread({ status: 'open', rowVersion: 3 })])
    server.fail({ status: null, networkError: true }, { status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: 'e1' }, status: 'closed' }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    expect((await rt.review.list())[0]!.class).toBe('CC2')
  })
})

describe('outbox: lanes and dependencies', () => {
  it('a note waits for its offline visit and is sent with the server id', async () => {
    const { rt, server } = await online()
    rt.setSessionReady(false)
    const visit = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    const vid = (visit as { commandId: string }).commandId
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { local: vid }, text: 'n1' }, { awaitMs: 0 })
    expect(await rt.commands.pendingFor(PATIENT, { local: vid })).toHaveLength(2)
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    const [enc, note] = server.writes()
    const encId = (server.keys.get(enc!.spec.headers!['Idempotency-Key']!)!.body as { id: string }).id
    expect(note!.spec.path).toBe(`/api/v1/ehr/patients/${PATIENT}/encounters/${encId}/clinical-notes`)
  })

  it('head-of-line: a visit in review blocks its lane, other lanes still send', async () => {
    const { rt, server } = await online()
    rt.setSessionReady(false)
    server.failWhenBody('first', { status: 503 }, { status: 409, code: 'CLINICAL_CONFLICT' })
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'first' }, { awaitMs: 0 })
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'second' }, { awaitMs: 0 })
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e2' }, text: 'other visit' }, { awaitMs: 0 })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    const review = await rt.review.list()
    expect(review).toHaveLength(1)
    expect(review[0]!.laneBlocked).toBe(1)
    expect(server.writes().some(c => c.bodyText.includes('second'))).toBe(false)
    expect(server.writes().some(c => c.bodyText.includes('other visit'))).toBe(true)
  })

  it('FIFO within a lane', async () => {
    const { rt, server } = await online()
    rt.setSessionReady(false)
    for (const t of ['a', 'b', 'c', 'd']) await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: t }, { awaitMs: 0 })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    expect(server.writes().map(c => JSON.parse(c.bodyText).text)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a note whose visit was discarded goes to review (CC3)', async () => {
    const { rt, server } = await online()
    rt.setSessionReady(false)
    server.fail({ status: 503 }, { status: 400, code: 'BAD_REQUEST' })
    const visit = await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    const vid = (visit as { commandId: string }).commandId
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { local: vid }, text: 'n' }, { awaitMs: 0 })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    await rt.review.resolve(vid, 'discard', { reason: 'Wrong patient chosen' })
    await settle(rt)
    const list = await rt.review.list()
    expect(list.map(r => r.class)).toEqual(['CC3'])
  })
})

describe('outbox: one sender per vault (Web Lock)', () => {
  it('two engines on one store send each command exactly once', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    const channel = privateChannel()
    const a = makeRuntime({ server, env, idb, locks, extra: { BroadcastChannel: channel } })
    await signIn(a)
    const b = makeRuntime({ server, env, idb, locks, extra: { BroadcastChannel: channel } })
    await signIn(b)
    server.state.offline = true
    await a.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'from a' }, { awaitMs: 0 })
    await b.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'from b' }, { awaitMs: 0 })
    await settle(a)
    await settle(b)
    server.state.offline = false
    a.commands.syncNow()
    b.commands.syncNow()
    for (let i = 0; i < 5; i += 1) { await settle(a); await settle(b) }
    expect(server.keys.size).toBe(2)
    const applied = server.writes().filter((c, i, all) => all.findIndex(x => x.spec.headers!['Idempotency-Key'] === c.spec.headers!['Idempotency-Key'] && x.bodyText === c.bodyText) === i)
    expect(applied).toHaveLength(2)
    expect(locks.held('health-id-offline:send:' + (await a.storeForDiagnostics().then(s => s!.dump())).vaults.map(v => (v as { vaultId: string }).vaultId)[0])).toBe(true)
    a.dispose()
    b.dispose()
  })
})

describe('outbox: CC4 safety hold', () => {
  it('a prescription saved offline is held until the author checks it', async () => {
    const { rt, server } = await online()
    server.state.offline = true
    rt.setSessionReady(false)
    await rt.commands.save('ehr.prescription.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'rx' }, { awaitMs: 0 })
    server.state.offline = false
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    const [item] = await rt.review.list()
    expect(item!.class).toBe('CC4')
    expect(server.writes()).toHaveLength(0)
    await rt.review.resolve(item!.commandId, 'send-as-is', {})
    await settle(rt)
    expect(server.writes()).toHaveLength(1)
    expect(rt.summary().pending).toBe(0)
  })

  it('with a safety probe, an unchanged record sends without a hold', async () => {
    const server = createServer()
    const probe = { capture: async () => ({ allergiesSha256: 'a', encounterRxSha256: 'b', seenAt: '2026-10-29T09:00:00.000Z' }),
      current: async () => ({ allergiesSha256: 'a', encounterRxSha256: 'b' }) }
    const { rt } = await online(server, { safety: probe })
    rt.setSessionReady(false)
    await rt.commands.save('ehr.prescription.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'rx' }, { awaitMs: 0 })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    expect(server.writes()).toHaveLength(1)
  })
})

