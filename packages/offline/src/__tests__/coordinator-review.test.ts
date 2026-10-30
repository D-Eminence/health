// Regression tests for the coordinator's review of PR #34 (findings 1–5, 7, 9–14). Each failed before its fix.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { LIMITS, OFFLINE_PATHS, type Json } from '../contracts'
import { fitAuditBatch } from '../audit'
import type { OfflineStore } from '../store'
import { createMemoryLocks } from '../testing'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, serverContact, settle, signIn, until, type Env, type Server } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
const ACCOUNT_B = { ...SESSION, accountId: 'acc-b', membershipId: 'mem-b', email: 'colleague@demo.example' }
type Rt = ReturnType<typeof makeRuntime>

async function dump(rt: Rt) {
  return (await rt.storeForDiagnostics())!.dump()
}

/** Run `before` ahead of this store's first write whose stores match `when` (to interleave another tab). */
function gateWrites(s: OfflineStore, when: (stores: readonly string[]) => boolean, before: () => Promise<void>) {
  const original = s.write.bind(s)
  let armed = true
  s.write = (async (stores: readonly string[], fn: never) => {
    if (armed && when(stores)) {
      armed = false
      await before()
    }
    return original(stores as never, fn)
  }) as typeof s.write
}

describe('1. failed offline unlocks cannot be reset by another account or run in parallel', () => {
  it("another account's unlock does not clear failures made against this one", async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const a = makeRuntime({ server, env, idb })
    await signIn(a, { server })
    a.dispose()
    const b = makeRuntime({ server, env, idb })
    await signIn(b, { server, session: ACCOUNT_B })
    b.dispose()

    const tab = makeRuntime({ server, env, idb })
    for (let i = 0; i < 4; i += 1) expect(await tab.unlockOffline(SESSION.email, `wrong password ${i}`)).toEqual({ ok: false, reason: 'wrong-credentials' })
    const other = makeRuntime({ server, env, idb })
    expect((await other.unlockOffline(ACCOUNT_B.email, PASSWORD)).ok).toBe(true)
    other.lock('manual')
    expect(await tab.unlockOffline(SESSION.email, 'wrong password 5')).toEqual({ ok: false, reason: 'wiped' })
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'wiped' })
  })

  it('ten parallel attempts: at most five are evaluated, the rest (the right password too) are wiped', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server })
    first.dispose()
    const tabs = Array.from({ length: 10 }, () => makeRuntime({ server, env, idb }))
    const results = await Promise.all(tabs.map((t, i) => t.unlockOffline(SESSION.email, i === 9 ? PASSWORD : `wrong password ${i}`)))
    expect(results.filter(r => r.ok)).toHaveLength(0)
    expect(results.filter(r => !r.ok && r.reason === 'wrong-credentials').length).toBeLessThanOrEqual(5)
    expect(results[9]).toEqual({ ok: false, reason: 'wiped' })
    expect(tabs.every(t => t.summary().vault !== 'unlocked')).toBe(true)

    // Refused before derivation until an online sign-in resets the counter.
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'wiped' })
    const online = makeRuntime({ server, env, idb })
    await signIn(online, { server })
    online.dispose()
    expect((await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
  })
})

describe('2. escrow recovery covers every vault the new password cannot open', () => {
  for (const order of [['X', 'Y'], ['Y', 'X'], ['X', 'Y-declined']] as const) {
    it(`recovers both facilities' unsent work (${order.join(' then ')})`, async () => {
      const server = createServer()
      const env = makeEnv()
      const idb = new IDBFactory()
      for (const s of [SESSION, AT_Y]) {
        const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
        await signIn(rt, { server, session: s })
        server.state.offline = true
        await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: s.facilityId }, { awaitMs: 0 })
        await settle(rt)
        server.state.offline = false
        rt.dispose()
      }
      for (const step of order) {
        const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
        await signIn(rt, { server, password: 'a brand new password', session: step === 'X' ? SESSION : AT_Y, optIn: step !== 'Y-declined' })
        await settle(rt)
        rt.dispose()
      }
      expect(server.keys.size).toBe(2)
      const vaults = (await dump(makeRuntime({ server, env, idb }))).vaults as { pending: { commands: number } }[]
      expect(vaults).toHaveLength(2)
      expect(vaults.every(v => v.pending.commands === 0)).toBe(true)
    })
  }
})

describe('3. a wiped vault is only reused for the facility it was made for', () => {
  it("an offline chart open at X is never sent under Y's facility", async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const x = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(x, { server })
    server.state.offline = true
    x.audit.recordOpen(PATIENT, 'encounters')
    const store = (await x.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    const vaultX = ((await store.dump()).vaults[0] as { vaultId: string }).vaultId
    await x.signOut({ online: false })
    x.dispose()
    server.state.offline = false
    const from = server.calls.length

    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await y.logoutSent()
    await signIn(y, { server, session: AT_Y })
    await settle(y)
    await new Promise(r => setTimeout(r, 20))
    expect((await dump(y)).vaults).toHaveLength(2)
    const auditPosts = () => server.calls.slice(from).filter(c => c.spec.path === OFFLINE_PATHS.audit && (c.spec.body as { vaultId: string }).vaultId === vaultX)
    expect(auditPosts().every(c => c.spec.headers?.['X-Facility-ID'] === SESSION.facilityId)).toBe(true)
    expect(auditPosts()).toHaveLength(0)
    y.dispose()

    const back = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(back, { server })
    await settle(back)
    await until(() => auditPosts().length > 0)
    expect(auditPosts().every(c => c.spec.headers?.['X-Facility-ID'] === SESSION.facilityId)).toBe(true)
  })
})

describe('4. two first sign-ins on a new device at once', () => {
  it('keeps one device salt: only a vault that can be opened again is created', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const a = makeRuntime({ server, env, idb })
    const b = makeRuntime({ server, env, idb })
    a.prepareFromSignIn(SESSION.email, PASSWORD)
    b.prepareFromSignIn(SESSION.email, PASSWORD)
    await a.attachSession(SESSION, { optIn: true, online: true })
    await b.attachSession(SESSION, { optIn: true, online: true })
    expect((await dump(a)).vaults).toHaveLength(1)
    a.setSessionReady(false)
    await a.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    const cold = makeRuntime({ server, env, idb })
    expect((await cold.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
    expect(await cold.commands.pendingFor(PATIENT)).toHaveLength(1)
  })
})

describe('5. eviction keeps a vault that still holds a discarded entry', () => {
  it('evicts the oldest idle vault without discarded entries', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const accounts = Array.from({ length: 6 }, (_, i) => ({ ...SESSION, accountId: `acc-${i}`, email: `user${i}@demo.example` }))
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server, session: accounts[0] })
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await first.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(first)
    const [item] = await first.review.list()
    await first.review.resolve(item!.commandId, 'discard', { reason: 'Entered on the ward PC' })
    const vault0 = ((await dump(first)).vaults[0] as { vaultId: string }).vaultId
    first.dispose()
    for (let i = 1; i < 6; i += 1) {
      env.wall += 1000
      const rt = makeRuntime({ server, env, idb })
      await signIn(rt, { server, session: accounts[i] })
      rt.dispose()
    }
    const d = await dump(makeRuntime({ server, env, idb }))
    expect(d.vaults).toHaveLength(5)
    expect(d.vaults.some(v => (v as { vaultId: string }).vaultId === vault0)).toBe(true)
    expect(d.outbox.some(o => (o as { state: string }).state === 'discarded')).toBe(true)
  })
})

describe('7. CC4 after an edit that followed "Send as is"', () => {
  it('holds the edited prescription again', async () => {
    const server = createServer()
    const probe = {
      capture: async () => ({ allergiesSha256: 'A1', encounterRxSha256: 'R1', seenAt: '2026-10-29T07:00:00.000Z' }),
      current: async () => ({ allergiesSha256: 'A2', encounterRxSha256: 'R1' }),
    }
    const rt = makeRuntime({ server, env: makeEnv(), extra: { safety: probe } })
    await signIn(rt, { server })
    rt.setSessionReady(false)
    await rt.commands.save('ehr.prescription.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'drug X' }, { awaitMs: 0 })
    rt.setSessionReady(true)
    await settle(rt)
    const [hold] = await rt.review.list()
    expect(hold!.class).toBe('CC4')
    rt.setSessionReady(false)
    await rt.review.resolve(hold!.commandId, 'send-as-is', {})
    await rt.commands.edit(hold!.commandId, { patientId: PATIENT, encounter: { server: 'e1' }, text: 'drug Y' })
    rt.setSessionReady(true)
    await settle(rt)
    expect((await rt.review.list())[0]!.class).toBe('CC4')
    expect(server.writes()).toHaveLength(0)
  })
})

describe('9. a visit saved offline keeps one lane under both its names', () => {
  async function visitApplied() {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt, { server })
    const visit = await rt.commands.save<{ id: string }>('ehr.encounter.create', { patientId: PATIENT })
    if (visit.kind !== 'applied') throw new Error('visit not applied')
    return { rt, server, local: visit.receipt.commandId, serverId: visit.value.id }
  }
  const order = (server: Server) => server.writes().slice(1).map(c => `${c.spec.method}:${(JSON.parse(c.bodyText || '{}') as { text?: string; status?: string }).text ?? 'update'}`)

  it('entries named by the server id wait behind entries named by the local id', async () => {
    const { rt, server, local, serverId } = await visitApplied()
    server.failWhenBody('n1', { status: 503 })
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { local }, text: 'n1' }, { awaitMs: 0 })
    await settle(rt)
    expect((await rt.commands.pendingFor(PATIENT, { server: serverId })).map(p => (p.input as { text: string }).text)).toEqual(['n1'])
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: serverId }, text: 'n2' }, { awaitMs: 0 })
    await rt.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: serverId }, status: 'closed' }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    expect(order(server).filter((x, i, all) => all.indexOf(x) === i)).toEqual(['POST:n1', 'POST:n2', 'PATCH:update'])
  })

  it('an entry named by the local id waits behind entries already queued under the server id', async () => {
    const { rt, server, local, serverId } = await visitApplied()
    server.failWhenBody('n0', { status: 503 })
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: serverId }, text: 'n0' }, { awaitMs: 0 })
    await rt.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: serverId }, status: 'closed' }, { awaitMs: 0 })
    await settle(rt)
    await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { local }, text: 'late' }, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    expect(order(server).filter((x, i, all) => all.indexOf(x) === i)).toEqual(['POST:n0', 'PATCH:update', 'POST:late'])
  })
})

describe('10. offline audit batches stay under 8000 bytes', () => {
  it('18 discards and an offline read drain in batches the WAF accepts', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt, { server })
    server.failWhenBody('', ...Array.from({ length: 18 }, () => ({ status: 412, code: 'VERSION_CONFLICT' })))
    for (let i = 0; i < 18; i += 1) await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: `v${i}` }, { awaitMs: 0 })
    await settle(rt)
    server.state.offline = true
    for (const item of await rt.review.list()) {
      await rt.review.resolve(item.commandId, 'discard', { reason: `Entered twice by mistake. ${'This visit was already recorded on the ward computer. '.repeat(3)}` })
    }
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length >= 19)
    server.state.offline = false
    for (let i = 0; i < 6; i += 1) { rt.commands.syncNow(); await settle(rt) }
    const posts = server.calls.filter(c => c.spec.path === OFFLINE_PATHS.audit)
    expect(posts.length).toBeGreaterThan(1)
    expect(posts.every(c => new TextEncoder().encode(c.bodyText).length <= LIMITS.maxBodyBytes)).toBe(true)
    await until(async () => (await store.dump()).audit.length === 0)
  })

  it('refuses a review reason over 500 characters', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt, { server })
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    const [item] = await rt.review.list()
    await expect(rt.review.resolve(item!.commandId, 'discard', { reason: 'x'.repeat(501) })).rejects.toThrow(/500 characters/)
  })

  it('an event too large on its own is sent with its reason cut, and later events still go out', () => {
    const big = { eventId: 'e1', seq: 1, action: 'ehr.offline.command.discarded' as const, patientId: PATIENT, section: null, resourceId: null,
      occurredAt: '2026-10-29T09:00:00.000Z', clock: 'wall' as const, grantExpiresAt: null, details: { op: 'ehr.note.create', reason: 'r'.repeat(9000) } as Json }
    const small = { ...big, eventId: 'e2', seq: 2, action: 'ehr.record.read' as const, details: undefined }
    const first = fitAuditBatch('vault-1', [big, small])
    expect(first).toHaveLength(1)
    expect(JSON.stringify({ vaultId: 'vault-1', events: first }).length).toBeLessThanOrEqual(LIMITS.maxBodyBytes)
    // Cut to fit, with no marker key: the server rejects details keys beyond §2.10 (A10.2).
    expect(Object.keys(first[0]!.details as object).sort()).toEqual(['op', 'reason'])
    expect(((first[0]!.details as { reason: string }).reason.length)).toBeLessThan(9000)
    expect(fitAuditBatch('vault-1', [small])).toEqual([small])
  })
})

describe('11. a review successor keeps its original place in the lane', () => {
  for (const [cls, fault, action] of [
    ['CC7', { status: 400, code: 'BAD_REQUEST' }, 'edit-as-new'],
    ['CC2', { status: 412, code: 'VERSION_CONFLICT' }, 'apply-on-top'],
  ] as const) {
    it(`${cls} ${action} is sent before the entry saved after the original`, async () => {
      const server = createServer()
      const rt = makeRuntime({ server, env: makeEnv() })
      await signIn(rt, { server })
      server.failWhenBody('first', { status: 503 }, fault)
      await rt.commands.save('ehr.note.create', { patientId: PATIENT, encounter: { server: 'e1' }, text: 'first' }, { awaitMs: 0 })
      await rt.commands.save('ehr.encounter.update', { patientId: PATIENT, encounter: { server: 'e1' }, status: 'closed' }, { awaitMs: 0 })
      await settle(rt)
      rt.commands.syncNow()
      await settle(rt)
      const [item] = await rt.review.list()
      expect(item!.class).toBe(cls)
      await rt.review.resolve(item!.commandId, action, { reason: 'Corrected the entry', input: { patientId: PATIENT, encounter: { server: 'e1' }, text: 'fixed' } })
      await settle(rt)
      const sent = server.writes().map(c => (JSON.parse(c.bodyText) as { text?: string }).text ?? 'update')
      expect(sent.slice(sent.indexOf('fixed'))).toEqual(['fixed', 'update'])
    })
  }
})

describe('12. writes from another tab are not overwritten', () => {
  it('a discard in tab B survives tab A resuming access for the same entry', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    const a = makeRuntime({ server, env, idb, locks })
    await signIn(a, { server })
    server.fail({ status: 503 }, { status: 403, code: 'CONSENT_REQUIRED' })
    await a.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(a)
    a.commands.syncNow()
    await settle(a)
    const [item] = await a.review.list()
    await a.review.resolve(item!.commandId, 'ask-access', { reason: 'Patient asked again' })
    const b = makeRuntime({ server, env, idb, locks })
    await signIn(b, { server })
    const writesBefore = server.writes().length
    gateWrites((await a.storeForDiagnostics())!, stores => stores.includes('outbox'), async () => {
      await b.review.resolve(item!.commandId, 'discard', { reason: 'Recorded by a colleague' })
    })
    await a.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await settle(a)
    await settle(b)
    const states = ((await dump(a)).outbox as { state: string }[]).map(o => o.state)
    expect(states).toEqual(['discarded'])
    expect(server.writes()).toHaveLength(writesBefore)
  })
})

describe('13. save fails if its vault is deleted between reserving the seq and writing (I1)', () => {
  it('rejects with unavailable and leaves no orphan record', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    const a = makeRuntime({ server, env, idb, locks })
    await signIn(a, { server })
    const b = makeRuntime({ server, env, idb, locks })
    await signIn(b, { server })
    a.setSessionReady(false)
    gateWrites((await a.storeForDiagnostics())!, stores => stores.includes('outbox') && stores.includes('vaults'), async () => {
      await b.signOut({ online: true })
    })
    await expect(a.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })).rejects.toMatchObject({ reason: 'unavailable' })
    expect((await dump(a)).outbox).toHaveLength(0)
  })
})

describe('14. membership-ended work is deleted after 30 days', () => {
  it('a later sign-in elsewhere removes the expired hold and its vault', async () => {
    const server = createServer()
    const env: Env = { ...makeEnv(), serverClock: true }
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    await rt.wipe('membership')
    rt.dispose()
    server.state.offline = false
    env.wall += LIMITS.membershipEndedKeepMs + 86400_000
    const later = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(later, { server, session: AT_Y })
    const d = await dump(later)
    expect(d.vaults).toHaveLength(1)
    expect(d.outbox.filter(o => (o as { state: string }).state === 'held_membership')).toHaveLength(0)
  })

  it('five expired holds no longer make the device full', async () => {
    const server = createServer()
    const env: Env = { ...makeEnv(), serverClock: true }
    const idb = new IDBFactory()
    for (let i = 0; i < 5; i += 1) {
      const rt = makeRuntime({ server, env, idb })
      const s = { ...SESSION, accountId: `acc-${i}`, email: `user${i}@demo.example` }
      await signIn(rt, { server, session: s })
      server.state.offline = true
      await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
      await settle(rt)
      await rt.wipe('membership')
      server.state.offline = false
      rt.dispose()
    }
    env.wall += LIMITS.membershipEndedKeepMs + 86400_000
    const sixth = makeRuntime({ server, env, idb })
    const s6 = { ...SESSION, accountId: 'acc-6', email: 'user6@demo.example' }
    sixth.prepareFromSignIn(s6.email, PASSWORD)
    serverContact(sixth)
    expect(await sixth.offer(s6)).toEqual({ kind: 'ask' })
  })
})

