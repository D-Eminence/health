// Regression tests for the coordinator's third review round of PR #34 (items 1–4 and 6–8; item 5 is the repro-B fix
// in coordinator-review-2). Each failed before its fix.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { LIMITS, OFFLINE_PATHS } from '../contracts'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, serverContact, settle, signIn, until, type Env } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
const ACCOUNT_B = { ...SESSION, accountId: 'acc-b', membershipId: 'mem-b', email: 'colleague@demo.example' }
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
const readEvents = (calls: ReturnType<typeof createServer>['calls']) => calls.filter(c => c.spec.path === OFFLINE_PATHS.audit
  && (c.spec.body as { events: { action: string }[] }).events.some(e => e.action === 'ehr.record.read'))

async function signedOutWithOpen(server: ReturnType<typeof createServer>, env: Env, idb: IDBFactory) {
  const rt = makeRuntime({ server, env, idb })
  await signIn(rt, { server })
  server.state.auditDown = true
  rt.audit.recordOpen(PATIENT, 'encounters')
  const store = (await rt.storeForDiagnostics())!
  await until(async () => (await store.dump()).audit.length > 0)
  await rt.signOut({ online: false })
  rt.dispose()
  server.state.auditDown = false
}

describe('1. the returning owner\'s own vault is never treated as abandoned', () => {
  it('31 days later, the sign-in at the same facility sends the offline open and keeps the vault', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    await signedOutWithOpen(server, env, idb)
    later(env, 31 * DAY)
    const from = server.calls.length
    const rt = makeRuntime({ server, env, idb })
    await rt.logoutSent()
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    serverContact(rt)
    expect(await rt.offer(SESSION)).toEqual({ kind: 'existing' })
    await rt.attachSession(SESSION, { optIn: false, online: true })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    await until(() => readEvents(server.calls.slice(from)).length > 0)
    expect((await dump(rt)).vaults).toHaveLength(1)
  })
})

describe('2. an online-reload unlock at the facility clears an earlier membership end', () => {
  it('a note saved after the reload unlock is not deleted 30 days after the old end', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    rt.lock('manual')
    await rt.wipe('membership')
    rt.dispose()

    later(env, DAY)
    const reload = makeRuntime({ server, env, idb })
    serverContact(reload)
    await reload.attachSession(SESSION, { optIn: false, online: true })
    reload.setSessionReady(true, SESSION.accountId)
    expect((await reload.unlockLocked(PASSWORD)).ok).toBe(true)
    const vault = (await dump(reload)).vaults[0] as { flags: { membershipEndedAt: number | null } }
    expect(vault.flags.membershipEndedAt).toBeNull()
    server.state.offline = true
    await reload.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(reload)
    reload.dispose()

    later(env, LIMITS.membershipEndedKeepMs)
    server.state.offline = false
    const after = makeRuntime({ server, env, idb })
    await signIn(after, { server })
    await settle(after)
    expect(server.keys.size).toBe(1)
  })
})

describe('3. a vault whose tab was closed without signing out is freed after 30 days', () => {
  it('120 days later the abandoned vault, its header and cached charts are gone', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(y, { server, session: AT_Y })
    await y.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
    await y.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
    server.state.auditDown = true
    y.audit.recordOpen(PATIENT, 'encounters')
    const store = (await y.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    y.dispose()
    server.state.auditDown = false

    later(env, 120 * DAY)
    const x = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(x, { server })
    const d = await dump(x)
    expect(d.vaults).toHaveLength(1)
    expect(d.cache.filter(c => (c as { vaultId: string }).vaultId !== (d.vaults[0] as { vaultId: string }).vaultId)).toHaveLength(0)
  })
})

describe('4. a membership end while locked deletes the queued work after 30 days (D9)', () => {
  it('kept at 29 days, gone at 31', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const x = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(x, { server })
    server.state.offline = true
    await x.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(x)
    x.lock('manual')
    await x.wipe('membership')
    x.dispose()
    server.state.offline = false

    later(env, 29 * DAY)
    const y1 = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(y1, { server, session: AT_Y, optIn: false })
    expect((await dump(y1)).outbox).toHaveLength(1)
    y1.dispose()

    later(env, 2 * DAY)
    const y2 = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(y2, { server, session: AT_Y, optIn: false })
    const d = await dump(y2)
    expect(d.outbox).toHaveLength(0)
    expect(d.vaults).toHaveLength(0)
  })
})

describe("6. a right password on another person's signed-out vault is not a wrong guess", () => {
  it("A's readable copy survives four wrong guesses and B's right password", async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const a = makeRuntime({ server, env, idb })
    await signIn(a, { server })
    a.dispose()
    const b = makeRuntime({ server, env, idb })
    await signIn(b, { server, session: ACCOUNT_B })
    await b.signOut({ online: false })
    b.dispose()
    for (let i = 0; i < 4; i += 1) await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, `wrong ${i} password`)
    expect(await makeRuntime({ server, env, idb }).unlockOffline(ACCOUNT_B.email, PASSWORD)).toEqual({ ok: false, reason: 'wiped' })
    expect((await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
  })
})

describe('7 and 8. a placeholder vault made while escrow was down', () => {
  async function placeholderWithUnsentAudit() {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.dispose()
    server.state.offline = false

    server.state.escrow = false
    const down = makeRuntime({ server, env, idb })
    await signIn(down, { server, password: 'a brand new password' })
    down.lock('manual')
    server.state.offline = true
    // An offline unlock leaves an ehr.offline.unlock event pending in the placeholder.
    expect((await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, 'a brand new password')).ok).toBe(true)
    down.dispose()
    server.state.offline = false
    server.state.escrow = true
    return { server, env, idb }
  }

  it('7: escrowRetry stays until recovery has run, so the old vault is recovered at a later sign-in', async () => {
    const { server, env, idb } = await placeholderWithUnsentAudit()
    for (let i = 0; i < 3; i += 1) {
      const rt = makeRuntime({ server, env, idb })
      await signIn(rt, { server, password: 'a brand new password' })
      await settle(rt)
      await new Promise(r => setTimeout(r, 20))
      rt.dispose()
    }
    expect(server.keys.size).toBe(1)
    expect((await dump(makeRuntime({ server, env, idb }))).vaults).toHaveLength(1)
  })

  it('8: a placeholder kept for a discarded entry keeps nothing readable after recovery', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.dispose()
    server.state.offline = false

    server.state.escrow = false
    const down = makeRuntime({ server, env, idb })
    await signIn(down, { server, password: 'a brand new password' })
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await down.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'conflict' }, { awaitMs: 0 })
    await settle(down)
    const [item] = await down.review.list()
    await down.review.resolve(item!.commandId, 'discard', { reason: 'Recorded on the ward computer' })
    await settle(down)
    down.dispose()
    server.state.escrow = true

    const up = makeRuntime({ server, env, idb })
    await signIn(up, { server, password: 'a brand new password' })
    await settle(up)
    await up.signOut({ online: false })
    up.dispose()
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, 'a brand new password')).toEqual({ ok: false, reason: 'wiped' })
  })
})
