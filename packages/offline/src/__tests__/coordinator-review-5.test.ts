// Coordinator round-4 verification of PR #39 (P1, P3, P4, P6, P7 and the audit 4xx regression). Each test failed first.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createMemoryLocks } from '../testing'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn, until, type Env, type Server } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
const TYPO = 'correct horse batery'
const HOUR = 3600_000
const DAY = 24 * HOUR
type Rt = ReturnType<typeof makeRuntime>

const clockedEnv = (): Env => ({ ...makeEnv(), serverClock: true })
const dump = async (rt: Rt) => (await rt.storeForDiagnostics())!.dump()
function later(env: Env, ms: number) {
  env.wall += ms
  env.mono += ms
}
async function savedOffline(rt: Rt, server: Server) {
  server.state.offline = true
  await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
  await settle(rt)
  server.state.offline = false
}

describe('1. a membership end after a facility switch marks the account\'s vault (P7)', () => {
  it('signIn X, save offline, attachSession(Y) with no password, wipe(membership): X is marked, unreadable, gone after 30 days', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    await savedOffline(rt, server)
    await rt.attachSession(AT_Y, { optIn: false, online: true })
    await rt.wipe('membership')
    const d = await dump(rt)
    const vault = (d.vaults as { header: unknown; flags: { membershipEndedAt: number | null } }[])[0]!
    expect(vault.header).toBeNull()
    expect(vault.flags.membershipEndedAt).not.toBeNull()
    const off = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    expect((await off.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
    later(env, 31 * DAY)
    const after = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(after, { server, session: AT_Y, optIn: false })
    expect((await dump(after)).outbox).toHaveLength(0)
  })
})

describe('2. only an invalid C2 refusal marks offline audit rejected', () => {
  for (const [status, code] of [[423, 'PLATFORM_PORTAL_DISABLED'], [404, 'NOT_FOUND'], [409, 'CONFLICT']] as const) {
    it(`${status} ${code}: kept, and delivered once lifted`, async () => {
      const server = createServer()
      const rt = makeRuntime({ server, env: makeEnv() })
      await signIn(rt, { server })
      server.state.auditRefusal = { status, code }
      rt.audit.recordOpen(PATIENT, 'encounters')
      const store = (await rt.storeForDiagnostics())!
      await until(async () => (await store.dump()).audit.length > 0)
      rt.commands.syncNow()
      await settle(rt)
      expect(((await store.dump()).audit as { state: string }[]).map(a => a.state)).toEqual(['pending'])
      server.state.auditRefusal = null
      rt.commands.syncNow()
      await settle(rt)
      await until(async () => (await store.dump()).audit.length === 0)
      expect(server.audit.flatMap(b => b.events.map(e => e.action))).toContain('ehr.record.read')
    })
  }

  it('a 400 VALIDATION_FAILED is still rejected and reported', async () => {
    const server = createServer()
    const reports: unknown[] = []
    const rt = makeRuntime({ server, env: makeEnv(), extra: { report: e => reports.push(e) } })
    await signIn(rt, { server })
    server.state.auditRefusal = { status: 400, code: 'VALIDATION_FAILED' }
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    rt.commands.syncNow()
    await settle(rt)
    await until(async () => ((await store.dump()).audit as { state: string }[]).every(a => a.state === 'rejected'))
    expect(reports).toContainEqual(expect.objectContaining({ kind: 'audit-refused', status: 400, code: 'VALIDATION_FAILED' }))
  })
})

describe('3. a password Identity refused never keys a session (P6)', () => {
  it('after forgetSignIn, offer is paused, no second vault is made, and the typo does not unlock', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const tab1 = makeRuntime({ server, env, idb })
    const tab2 = makeRuntime({ server, env, idb })
    tab1.prepareFromSignIn(SESSION.email, TYPO)
    tab1.forgetSignIn()
    await signIn(tab2, { server })
    expect(await tab1.offer(SESSION)).toEqual({ kind: 'paused' })
    await tab1.attachSession(SESSION, { optIn: true, online: true })
    expect((await dump(tab2)).vaults).toHaveLength(1)
    const off = makeRuntime({ server, env, idb })
    expect(await off.unlockOffline(SESSION.email, TYPO)).toEqual({ ok: false, reason: 'wrong-credentials' })
  })
})

describe('4. a facility switch never reopens the old facility\'s vault (P1)', () => {
  it('locked at X, attached at Y, more than 8 h later: unlockLocked does not open X even with a fresh X lease', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const tab1 = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(tab1, { server })
    tab1.lock('manual')
    await settle(tab1)
    await tab1.attachSession(AT_Y, { optIn: false, online: true })
    later(env, 9 * HOUR)
    // X's lease is refreshed by another tab still signed in there.
    await signIn(makeRuntime({ server, env, idb, extra: TWO_PILOTS }), { server })
    expect(await tab1.unlockLocked(PASSWORD)).toEqual({ ok: false, reason: 'lease-expired' })
    expect(tab1.restoreSession()).toBeNull()
  })

  it('unlocked at X, attachSession(Y) with no password: X\'s keys are dropped at once', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv(), extra: TWO_PILOTS })
    await signIn(rt, { server })
    await rt.attachSession(AT_Y, { optIn: false, online: true })
    expect(rt.summary().vault).toBe('locked')
    expect(await rt.unlockLocked(PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
  })
})

describe('5. escrow wraps move to the newest key version (P4)', () => {
  it('after a rotation, the next sign-in re-wraps escrow at the new version', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    await signIn(makeRuntime({ server, env, idb }), { server })
    const version = async () => ((await dump(makeRuntime({ server, env, idb }))).vaults as { wraps: { qkEsc?: { keyVersion: number } } }[])[0]!.wraps.qkEsc?.keyVersion
    expect(await version()).toBe(1)
    server.state.escrowVersion = 2
    await signIn(makeRuntime({ server, env, idb }), { server })
    expect(await version()).toBe(2)
  })
})

describe('6. unlock attempts are serialised across tabs (P3)', () => {
  it('after 4 typos, the right password in two tabs at once opens both and wipes nothing', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const locks = createMemoryLocks()
    await signIn(makeRuntime({ server, env, idb, locks }), { server })
    const a = makeRuntime({ server, env, idb, locks })
    const b = makeRuntime({ server, env, idb, locks })
    for (let i = 0; i < 4; i += 1) expect((await a.unlockOffline(SESSION.email, `wrong ${i}`)).ok).toBe(false)
    const both = await Promise.all([a.unlockOffline(SESSION.email, PASSWORD), b.unlockOffline(SESSION.email, PASSWORD)])
    expect(both.map(r => r.ok)).toEqual([true, true])
  })
})

describe('outbox: a load that started before a local change never undoes it', () => {
  it('cancel while another edit reloads: the cancelled entry stays gone (30 races)', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt, { server })
    rt.setSessionReady(false)
    for (let i = 0; i < 30; i += 1) {
      const p = `race-${i}`
      const a = await rt.commands.save('ehr.encounter.create', { patientId: p, text: 'a' }, { awaitMs: 0 })
      const b = await rt.commands.save('ehr.encounter.create', { patientId: p, text: 'b' }, { awaitMs: 0 })
      const idA = (a as { commandId: string }).commandId
      const idB = (b as { commandId: string }).commandId
      await Promise.all([rt.commands.edit(idB, { patientId: p, text: 'b2' }), rt.commands.cancel(idA)])
      expect((await rt.commands.pendingFor(p)).map(x => x.commandId)).toEqual([idB])
    }
  })
})
