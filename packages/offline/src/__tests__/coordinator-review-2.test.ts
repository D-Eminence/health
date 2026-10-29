// Regression tests for the coordinator's second review round of PR #34 (items 1–7). Each failed before its fix.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { LIMITS, OFFLINE_PATHS } from '../contracts'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, serverContact, settle, signIn, until, type Env } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
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

describe('1. a signed-out vault keeps its unsent audit and discarded entries', () => {
  it('repro B: an offline chart open survives the owner signing in again two minutes later', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    // C2 is down from the chart open through the sign-out, so the event cannot be delivered early (round 3, item 5).
    server.state.auditDown = true
    rt.audit.recordOpen(PATIENT, 'encounters')
    const store = (await rt.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT })
    await settle(rt)
    await rt.signOut({ online: false })
    rt.dispose()
    expect((await store.dump()).audit.length).toBeGreaterThan(0)
    server.state.auditDown = false
    const from = server.calls.length

    later(env, 2 * 60_000)
    const again = makeRuntime({ server, env, idb })
    await again.logoutSent()
    await signIn(again, { server })
    await settle(again)
    await until(() => server.calls.slice(from).some(c => c.spec.path === OFFLINE_PATHS.audit
      && (c.spec.body as { events: { action: string }[] }).events.some(e => e.action === 'ehr.record.read')))
  })

  it('repro G: a discarded entry is still kept two minutes after an online sign-out', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'conflict' }, { awaitMs: 0 })
    await settle(rt)
    const [item] = await rt.review.list()
    await rt.review.resolve(item!.commandId, 'discard', { reason: 'Recorded on the ward computer' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'second' })
    await rt.signOut({ online: true })
    rt.dispose()

    later(env, 2 * 60_000)
    const again = makeRuntime({ server, env, idb })
    await signIn(again, { server })
    const outbox = (await dump(again)).outbox as { state: string }[]
    expect(outbox.map(o => o.state)).toContain('discarded')
  })
})

describe('2. a new sign-in at the facility clears an earlier membership end', () => {
  it('a note saved after coming back is not deleted 30 days after the old end', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt, { server })
    rt.lock('manual')
    await rt.wipe('membership')
    rt.dispose()

    later(env, DAY)
    const back = makeRuntime({ server, env, idb })
    await signIn(back, { server })
    server.state.offline = true
    await back.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(back)
    await back.signOut({ online: false })
    back.dispose()

    later(env, LIMITS.membershipEndedKeepMs)
    server.state.offline = false
    const after = makeRuntime({ server, env, idb })
    await after.logoutSent()
    await signIn(after, { server })
    await settle(after)
    expect(server.keys.size).toBe(1)
  })
})

describe('3. 30-day deletions follow server time, not a device clock moved forward', () => {
  it('the sign-in sweep keeps a membership hold when only the wall clock jumped', async () => {
    const server = createServer()
    const env: Env = { ...clockedEnv(), server: Date.parse('2026-10-29T09:00:00.000Z') }
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(rt, { server })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    await rt.wipe('membership')
    rt.dispose()
    server.state.offline = false
    env.wall += 31 * DAY // the device clock only
    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    y.prepareFromSignIn(AT_Y.email, PASSWORD)
    serverContact(y)
    await y.attachSession(AT_Y, { optIn: false, online: true })
    expect(((await dump(y)).outbox as { state: string }[]).map(o => o.state)).toEqual(['held_membership'])
  })

  it('the engine keeps a discarded entry when only the wall clock jumped', async () => {
    const server = createServer()
    const env: Env = { ...clockedEnv(), server: Date.parse('2026-10-29T09:00:00.000Z') }
    const rt = makeRuntime({ server, env })
    await signIn(rt, { server })
    server.fail({ status: 412, code: 'VERSION_CONFLICT' })
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    const [item] = await rt.review.list()
    await rt.review.resolve(item!.commandId, 'discard', { reason: 'Recorded on the ward computer' })
    env.wall += 31 * DAY
    rt.commands.syncNow()
    await settle(rt)
    expect(((await dump(rt)).outbox as { state: string }[]).map(o => o.state)).toEqual(['discarded'])
  })
})

describe('4. a right password on a wiped vault does not reset the failed-unlock counter', () => {
  async function signedOutDevice() {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server })
    await first.signOut({ online: false })
    first.dispose()
    return { server, env, idb }
  }

  it('right password first among ten parallel attempts: the counter ends at the limit', async () => {
    // A readable vault (round 3, item 6): the wipe lands while the right attempt is deriving.
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env, idb })
    await signIn(first, { server })
    first.dispose()
    const tabs = Array.from({ length: 10 }, () => makeRuntime({ server, env, idb }))
    const results = await Promise.all(tabs.map((t, i) => t.unlockOffline(SESSION.email, i === 0 ? PASSWORD : `wrong password ${i}`)))
    expect(results.every(r => !r.ok)).toBe(true)
    expect(((await dump(tabs[0]!)).meta[0] as { failedUnlocks: number }).failedUnlocks).toBe(LIMITS.maxFailedUnlocks)
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, 'another wrong one')).toEqual({ ok: false, reason: 'wiped' })
  })

  it('four wrong, then the right one on the wiped vault: the next wrong guess is still refused', async () => {
    const { server, env, idb } = await signedOutDevice()
    for (let i = 0; i < 4; i += 1) await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, `wrong ${i} password`)
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'wiped' })
    expect(await makeRuntime({ server, env, idb }).unlockOffline(SESSION.email, 'wrong 5 password')).toEqual({ ok: false, reason: 'wiped' })
  })
})

describe('5. escrow is asked again after it was unreachable', () => {
  it('a placeholder vault made while escrow was down gives way to the recovered one', async () => {
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
    await settle(down)
    down.dispose()
    expect(server.keys.size).toBe(0)

    server.state.escrow = true
    const up = makeRuntime({ server, env, idb })
    await signIn(up, { server, password: 'a brand new password' })
    await settle(up)
    expect(server.keys.size).toBe(1)
    const vaults = (await dump(up)).vaults as { pending: { commands: number }; flags: { escrowRetry?: boolean } }[]
    expect(vaults).toHaveLength(1)
    expect(vaults[0]!.pending.commands).toBe(0)
    expect(vaults[0]!.flags.escrowRetry ?? false).toBe(false)
  })
})

describe('6. a wiped vault abandoned for 30 days is freed', () => {
  it('a vault bound to X holding only undelivered audit goes 30 days after its last server contact', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const x = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(x, { server })
    server.state.offline = true
    x.audit.recordOpen(PATIENT, 'encounters')
    const store = (await x.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    await x.signOut({ online: false })
    x.dispose()
    server.state.offline = false

    later(env, 31 * DAY)
    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await y.logoutSent()
    await signIn(y, { server, session: AT_Y })
    const d = await dump(y)
    expect(d.vaults).toHaveLength(1)
    expect(d.audit).toHaveLength(0)
  })

  it('but not before 30 days', async () => {
    const server = createServer()
    const env = clockedEnv()
    const idb = new IDBFactory()
    const x = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(x, { server })
    server.state.offline = true
    x.audit.recordOpen(PATIENT, 'encounters')
    const store = (await x.storeForDiagnostics())!
    await until(async () => (await store.dump()).audit.length > 0)
    await x.signOut({ online: false })
    x.dispose()
    server.state.offline = false
    later(env, 29 * DAY)
    const y = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await y.logoutSent()
    await signIn(y, { server, session: AT_Y })
    expect((await dump(y)).vaults).toHaveLength(2)
  })
})
