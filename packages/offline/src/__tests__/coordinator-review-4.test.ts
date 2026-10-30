// Regression tests for the coordinator's fourth review round (release gate) and the A10 client items.
// Each failed before its fix.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { LIMITS, OFFLINE_PATHS, type Json, type OfflineAuditEvent, type OpDefinition } from '../contracts'
import { fitAuditBatch } from '../audit'
import { classify } from '../outbox/classify'
import { createFakeOfflineRuntime, createMemoryLocks } from '../testing'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, serverContact, settle, signIn, until, type Env, type Server } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
const ACCOUNT_B = { ...SESSION, accountId: 'acc-b', membershipId: 'mem-b', email: 'colleague@demo.example' }
const NEW_PASSWORD = 'a brand new password'
const DAY = 86400_000
type Rt = ReturnType<typeof makeRuntime>

const clockedEnv = (): Env => ({ ...makeEnv(), serverClock: true })
async function dump(rt: Rt) {
  return (await rt.storeForDiagnostics())!.dump()
}
function later(env: Env, ms: number) {
  env.wall += ms
  env.mono += ms
}
const markers = async (rt: Rt) => ((await dump(rt)).vaults as { flags: { membershipEndedAt: number | null } }[]).map(v => v.flags.membershipEndedAt)
const readEvents = (server: Server, from = 0) => server.calls.slice(from).filter(c => c.spec.path === OFFLINE_PATHS.audit
  && (c.spec.body as { events: { action: string }[] }).events.some(e => e.action === 'ehr.record.read'))

async function savedOffline(rt: Rt, server: Server, text = 'queued') {
  server.state.offline = true
  await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text }, { awaitMs: 0 })
  await settle(rt)
  server.state.offline = false
}

describe('1. an ended membership is not undone by the lock overlay', () => {
  it('same tab: unlockLocked after wipe(membership) is refused and the work is deleted after 30 days', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    await savedOffline(rt, server)
    rt.lock('manual')
    await rt.wipe('membership')
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(false)
    expect((await markers(rt))[0]).not.toBeNull()
    rt.dispose()
    later(env, 31 * DAY)
    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(y, { server, session: AT_Y, optIn: false })
    const d = await dump(y)
    expect(d.vaults).toHaveLength(0)
    expect(d.outbox).toHaveLength(0)
  })

  it('two tabs: the tab that only hears the wipe cannot reopen the vault either', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    const channel = privateChannel()
    const a = makeRuntime({ server, env, idb, locks, extra: { BroadcastChannel: channel } })
    const b = makeRuntime({ server, env, idb, locks, extra: { BroadcastChannel: channel } })
    await signIn(a, { server })
    await signIn(b, { server })
    await a.wipe('membership')
    await until(() => b.summary().vault !== 'unlocked')
    expect((await b.unlockLocked(PASSWORD)).ok).toBe(false)
    expect((await markers(b))[0]).not.toBeNull()
  })
})

describe('2. wipe(membership) marks only the vault of the person whose membership ended', () => {
  it('(a) a signed-out X vault is not marked by a membership end at Y', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    await savedOffline(rt, server)
    await rt.signOut({ online: false })
    await rt.logoutSent()
    await signIn(rt, { server, session: AT_Y, optIn: false })
    await rt.wipe('membership')
    rt.dispose()
    later(env, 31 * DAY)
    const after = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(after, { server, session: AT_Y, optIn: false })
    expect((await dump(after)).outbox).toHaveLength(1)
  })

  it("(b) shared device: a colleague's membership end does not mark P's vault", async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    await savedOffline(rt, server)
    await rt.signOut({ online: true })
    await signIn(rt, { server, session: { ...ACCOUNT_B, facilityId: OTHER_FACILITY }, optIn: false })
    await rt.wipe('membership')
    rt.dispose()
    later(env, 31 * DAY)
    const after = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(after, { server, session: AT_Y, optIn: false })
    expect((await dump(after)).outbox).toHaveLength(1)
  })

  it('(c) after a facility switch without a password, the X vault is not marked', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    await rt.attachSession(AT_Y, { optIn: false, online: true })
    await rt.wipe('membership')
    expect(await markers(rt)).toEqual([null])
  })
})

describe('3. after recovery, the vault holding queued work is the one opened', () => {
  it('a kept placeholder that sorts first never shadows the recovered vault', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server })
    await savedOffline(first, server, 'old visit')
    first.dispose()

    server.state.escrow = false
    const down = makeRuntime({ server, env, idb })
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-4000-8000-000000000000')
    await signIn(down, { server, password: NEW_PASSWORD })
    spy.mockRestore()
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await down.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'conflict' }, { awaitMs: 0 })
    await settle(down)
    const [item] = await down.review.list()
    await down.review.resolve(item!.commandId, 'discard', { reason: 'Recorded on the ward computer' })
    down.dispose()
    server.state.escrow = true

    const up = makeRuntime({ server, env, idb })
    await signIn(up, { server, password: NEW_PASSWORD })
    await settle(up)
    await savedOffline(up, server, 'note after recovery')
    await up.signOut({ online: false })
    up.dispose()
    for (let i = 0; i < 3; i += 1) {
      const rt = makeRuntime({ server, env, idb })
      await rt.logoutSent()
      await signIn(rt, { server, password: NEW_PASSWORD })
      await settle(rt)
      rt.dispose()
    }
    expect(server.keys.size).toBe(2)
    const vaults = (await dump(makeRuntime({ server, env, idb }))).vaults as { pending: { commands: number } }[]
    expect(vaults.every(v => v.pending.commands === 0)).toBe(true)
  })
})

describe("4. one account's password never keys another account's session", () => {
  it("a sign-in left at MFA by A does not key B's session", async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    expect((await rt.offer(ACCOUNT_B)).kind).not.toBe('ask')
    await rt.attachSession(ACCOUNT_B, { optIn: true, online: true })
    expect(rt.policy()).toMatchObject({ enabled: false, reason: 'not-opted-in' })
    expect(await rt.hasVaults()).toBe(false)
    expect((await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
  })
})

describe('5. a double submit of the right password after four typos', () => {
  it('both submits unlock; nothing is wiped', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server })
    first.dispose()
    const rt = makeRuntime({ server, env, idb })
    for (let i = 0; i < 4; i += 1) await rt.unlockOffline(SESSION.email, `wrong ${i} password`)
    const both = await Promise.all([rt.unlockOffline(SESSION.email, PASSWORD), rt.unlockOffline(SESSION.email, PASSWORD)])
    expect(both.map(r => r.ok)).toEqual([true, true])
  })
})

describe('6. a password-changed sign-in does not sweep the vault escrow can still recover', () => {
  async function setup(withOffer: boolean) {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    server.state.auditDown = true
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    rt.dispose()
    server.state.auditDown = false
    later(env, 31 * DAY)
    const from = server.calls.length
    const again = makeRuntime({ server, env, idb })
    again.prepareFromSignIn(SESSION.email, NEW_PASSWORD)
    serverContact(again)
    if (withOffer) await again.offer(SESSION)
    await again.attachSession(SESSION, { optIn: true, online: true })
    again.setSessionReady(true, SESSION.accountId)
    await settle(again)
    return { server, from }
  }
  it('31 days later, the offline open is recovered and sent (with offer)', async () => {
    const { server, from } = await setup(true)
    await until(() => readEvents(server, from).length > 0)
  })
  it('31 days later, the offline open is recovered and sent (without offer)', async () => {
    const { server, from } = await setup(false)
    await until(() => readEvents(server, from).length > 0)
  })
  it("guard: another account's tab-closed vault is still deleted 31 days later", async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const b = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    const bAtY = { ...ACCOUNT_B, facilityId: OTHER_FACILITY }
    await signIn(b, { server, session: bAtY })
    await b.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await b.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
    server.state.auditDown = true
    b.audit.recordOpen(PATIENT, 'encounters')
    const store = (await b.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    b.dispose()
    server.state.auditDown = false
    later(env, 31 * DAY)
    const a = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(a, { server, optIn: false })
    expect((await dump(a)).vaults).toHaveLength(0)
  })
})

describe('7. the kill-switch start-up never deletes a command another tab just saved', () => {
  it('saved means kept, across 20 races', async () => {
    for (let i = 0; i < 20; i += 1) {
      const server = createServer()
      const env = makeEnv()
      const idb = new IDBFactory()
      const old = makeRuntime({ server, env, idb })
      await signIn(old, { server })
      server.state.offline = true
      const killed = makeRuntime({ server, env, idb, mode: 'off' })
      const [outcome] = await Promise.all([
        old.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 }).catch(() => null),
        killed.ready(),
      ])
      await settle(old)
      const outbox = (await dump(killed)).outbox
      if (outcome?.kind === 'saved') expect(outbox, `race ${i}`).toHaveLength(1)
      old.dispose()
      killed.dispose()
    }
  }, 60_000)
})

describe('8. escrow recovery asks for the key version stored with the wrap (A10.5)', () => {
  it('after a key rotation the old vault is still recovered', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    await savedOffline(rt, server)
    rt.dispose()
    server.state.escrowVersion = 2
    server.state.escrowAsked.length = 0
    const again = makeRuntime({ server, env, idb })
    await signIn(again, { server, password: NEW_PASSWORD })
    await settle(again)
    expect(server.state.escrowAsked).toContain(1)
    expect(server.keys.size).toBe(1)
  })
})

describe('9. C2 answers (A10.1–2)', () => {
  it('503 OFFLINE_AUDIT_UNAVAILABLE keeps the events and retries them', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt, { server })
    server.state.auditDown = true
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    rt.commands.syncNow()
    await settle(rt)
    expect((await store.dump()).audit).toHaveLength(1)
    server.state.auditDown = false
    rt.commands.syncNow()
    await settle(rt)
    await until(async () => (await store.dump()).audit.length === 0)
  })

  it('a 400 VALIDATION_FAILED refusal is reported and not retried silently', async () => {
    const server = createServer()
    const reports: unknown[] = []
    const rt = makeRuntime({ server, env: makeEnv(), extra: { report: e => reports.push(e) } })
    await signIn(rt, { server })
    server.state.auditRefusal = { status: 400, code: 'VALIDATION_FAILED' }
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    for (let i = 0; i < 4; i += 1) { rt.commands.syncNow(); await settle(rt) }
    const posts = server.calls.filter(c => c.spec.path === OFFLINE_PATHS.audit).length
    for (let i = 0; i < 4; i += 1) { rt.commands.syncNow(); await settle(rt) }
    expect(server.calls.filter(c => c.spec.path === OFFLINE_PATHS.audit).length).toBe(posts)
    expect(reports).toContainEqual(expect.objectContaining({ kind: 'audit-refused', status: 400, code: 'VALIDATION_FAILED' }))
    expect(rt.summary().attention).toBeGreaterThan(0)
  })
})

describe('10. C2 events carry only the details keys of §2.10 (A10.2)', () => {
  it('an oversized event is cut without adding reasonTruncated', () => {
    const big: OfflineAuditEvent = { eventId: 'e1', seq: 1, action: 'ehr.offline.command.discarded', patientId: PATIENT, section: null, resourceId: null,
      occurredAt: '2026-10-29T09:00:00.000Z', clock: 'wall', grantExpiresAt: null,
      details: { op: 'ehr.note.create', reason: 'r'.repeat(9000), bodySha256: 'a'.repeat(64), capturedAt: '2026-10-29T09:00:00.000Z' } }
    const [sent] = fitAuditBatch('vault-1', [big])
    expect(Object.keys(sent!.details as Record<string, Json>).sort()).toEqual(['bodySha256', 'capturedAt', 'op', 'reason'])
    expect(JSON.stringify({ vaultId: 'vault-1', events: [sent] }).length).toBeLessThanOrEqual(LIMITS.maxBodyBytes)
  })
})

describe('11. classification additions (A10.6)', () => {
  it('423 PLATFORM_PORTAL_DISABLED is transient', () => {
    expect(classify({ status: 423, code: 'PLATFORM_PORTAL_DISABLED', problem: true })).toBe('transient')
  })
  it('409 INVALID_DOCUMENT_TRANSITION on /documents is state (CC3)', () => {
    expect(classify({ status: 409, code: 'INVALID_DOCUMENT_TRANSITION', problem: true, path: '/api/v1/ehr/documents/d1/complete' })).toBe('state')
  })
})

describe('12. intent plus reread applies to any op that declares both (A10.7)', () => {
  type ToLab = { patientId: string; encounter: { server: string }; requestId: string }
  const toLab = (current: Record<string, Json>): OpDefinition<ToLab> => ({
    op: 'ehr.lab-request.to-lab', opVersion: 1, method: 'POST', keyed: true, versionField: 'expectedRowVersion',
    lane: i => ({ patientId: i.patientId, visit: i.encounter }),
    refs: i => ({ encounterId: i.encounter }),
    path: (i, r) => `/api/v1/ehr/patients/${i.patientId}/encounters/${r.encounterId}/lab-requests/${i.requestId}/lab-work-item`,
    body: () => ({ expectedRowVersion: 3 }),
    receipt: b => ({ resourceType: 'lab-work-item', resourceId: (b as { id: string }).id }),
    intent: i => ({ sourceEhrOrderId: i.requestId }),
    reread: async () => current,
  })
  const input = { patientId: PATIENT, encounter: { server: 'e1' }, requestId: 'lr-1' }

  it('real engine: a 412 after a lost success is applied via reread', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    rt.commands.register([toLab({ sourceEhrOrderId: 'lr-1', id: 'wi-1' }) as unknown as OpDefinition<Json>])
    await signIn(rt, { server })
    server.fail({ status: null, networkError: true }, { status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.lab-request.to-lab', input, { awaitMs: 0 })
    await settle(rt)
    rt.commands.syncNow()
    await settle(rt)
    expect(await rt.review.list()).toEqual([])
    expect(rt.summary().pending).toBe(0)
  })

  it('fake: the same', async () => {
    const { runtime, controls } = createFakeOfflineRuntime()
    runtime.commands.register([toLab({ sourceEhrOrderId: 'lr-1', id: 'wi-1' }) as unknown as OpDefinition<Json>])
    runtime.prepareFromSignIn(SESSION.email, PASSWORD)
    await runtime.attachSession(SESSION, { optIn: true, online: true })
    controls.respondNext({ status: null, networkError: true }, { status: 412, code: 'VERSION_CONFLICT' })
    await runtime.commands.save('ehr.lab-request.to-lab', input, { awaitMs: 0 })
    await controls.flush()
    runtime.commands.syncNow()
    await controls.flush()
    expect(await runtime.review.list()).toEqual([])
  })
})
