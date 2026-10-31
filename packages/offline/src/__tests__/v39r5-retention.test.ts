// Round 5, item 1: a fast device clock must not let the lock overlay reopen an ended membership (D9, A9.2).
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createMemoryLocks } from '../testing'
import { PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, serverContact, settle, signIn, type Env, type Server } from './harness'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const B = { ...SESSION, accountId: 'acc-b', membershipId: 'mem-b', actorId: 'act-b', email: 'colleague@demo.example' }
type Rt = ReturnType<typeof makeRuntime>

/** The device clock is `skew` ms fast of the server's. */
function env(skew = 0): Env {
  const e: Env = { ...makeEnv(), serverClock: true }
  e.server = e.wall - skew
  return e
}
function later(e: Env, ms: number) {
  e.wall += ms
  e.mono += ms
  if (e.server !== undefined) e.server += ms
}
const dump = async (rt: Rt) => (await rt.storeForDiagnostics())!.dump()
const vaults = async (rt: Rt) => (await dump(rt)).vaults as { flags: { membershipEndedAt: number | null } }[]
async function savedOffline(rt: Rt, server: Server) {
  server.state.offline = true
  await rt.commands.save('ehr.encounter.create', { patientId: PATIENT, text: 'queued' }, { awaitMs: 0 })
  await settle(rt)
  server.state.offline = false
}
/** An online reload attaches before the tab has seen any server Date; serverContact() is the first one. */
async function reload(server: Server, e: Env, idb: IDBFactory, extra = {}) {
  const rt = makeRuntime({ server, env: e, idb, extra })
  await rt.attachSession(SESSION, { optIn: false, online: true })
  rt.setSessionReady(true, SESSION.accountId)
  return rt
}

describe('round 5 item 1: membership end with a fast device clock', () => {
  it('same tab, device 10 min fast', async () => {
    const server = createServer()
    const e = env(10 * MIN)
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env: e, idb })
    await signIn(first, { server })
    first.dispose()
    later(e, HOUR)
    const rt = await reload(server, e, idb)
    serverContact(rt)
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(true)
    later(e, 2 * MIN)
    rt.lock('manual')
    await rt.wipe('membership')
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(false)
    expect((await vaults(rt))[0]!.flags.membershipEndedAt).not.toBeNull()
  })

  it('two tabs, device 10 min fast', async () => {
    const server = createServer()
    const e = env(10 * MIN)
    const idb = new IDBFactory()
    const channel = privateChannel()
    const locks = createMemoryLocks()
    const a = makeRuntime({ server, env: e, idb, locks, extra: { BroadcastChannel: channel } })
    await signIn(a, { server })
    later(e, MIN)
    const b = await reload(server, e, idb, { locks, BroadcastChannel: channel })
    later(e, 2 * MIN)
    serverContact(b)
    serverContact(a)
    await a.wipe('membership')
    expect((await b.unlockLocked(PASSWORD)).ok).toBe(false)
    expect((await vaults(b))[0]!.flags.membershipEndedAt).not.toBeNull()
  })

  it('sign-in tab attached before its first server Date, device 10 min fast', async () => {
    const server = createServer()
    const e = env(10 * MIN)
    const rt = makeRuntime({ server, env: e })
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    await rt.attachSession(SESSION, { optIn: true, online: true })
    rt.setSessionReady(true, SESSION.accountId)
    later(e, 30_000)
    serverContact(rt) // the first ping
    later(e, 2 * MIN)
    rt.lock('idle')
    await rt.wipe('membership')
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(false)
  })

  it('consequence: the ended member\'s work is deleted after 30 days', async () => {
    const server = createServer()
    const e = env(10 * MIN)
    const idb = new IDBFactory()
    const first = makeRuntime({ server, env: e, idb })
    await signIn(first, { server })
    await savedOffline(first, server)
    first.dispose()
    later(e, HOUR)
    const rt = await reload(server, e, idb)
    serverContact(rt)
    await rt.unlockLocked(PASSWORD)
    later(e, 2 * MIN)
    rt.lock('manual')
    await rt.wipe('membership')
    await rt.unlockLocked(PASSWORD)
    rt.dispose()
    later(e, 31 * DAY)
    const other = makeRuntime({ server, env: e, idb })
    await signIn(other, { server, session: B, optIn: false })
    expect((await dump(other)).outbox).toHaveLength(0)
    expect((await dump(other)).vaults).toHaveLength(0)
  })
})
