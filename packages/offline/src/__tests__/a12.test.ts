// Contract A12 (after the review of PR #35): the core seams the screens need.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { OFFLINE_PATHS, type GrantState } from '../contracts'
import { createFakeOfflineRuntime } from '../testing'
import { TransportError } from '../types'
import { ALL_DEFS, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn, type Env } from './harness'

const PATIENT_B = '66666666-6666-4666-8666-666666666666'
const HOUR = 3600_000
type Rt = ReturnType<typeof makeRuntime>

const offline = () => Promise.reject(new TransportError({ status: null, networkError: true }))
const grant = (env: Env, patientId: string): GrantState => ({
  patientId, readAllowed: true, writeAllowed: true, expiresAt: new Date(env.wall + HOUR).toISOString(), breakGlass: false,
  observedAt: new Date(env.wall).toISOString(),
})
const contact = (rt: Rt) => rt.onResponseMeta({
  method: 'GET', path: '/api/v1/ehr/patients', status: 200, date: null, problem: false, code: null, networkError: false, authenticated: true,
})
/** The last server contact as stored (lock persists the in-memory lease). */
async function storedContact(rt: Rt): Promise<number> {
  const d = await (await rt.storeForDiagnostics())!.dump()
  return (d.vaults as { lease: { lastServerContactAt: number } }[])[0]!.lease.lastServerContactAt
}

async function fakeSignedIn() {
  const fake = createFakeOfflineRuntime()
  fake.runtime.commands.register(ALL_DEFS)
  fake.runtime.prepareFromSignIn(SESSION.email, PASSWORD)
  await fake.runtime.attachSession(SESSION, { optIn: true, online: true })
  return fake
}

describe('A12.1: a cached read is only ever the asked patient\'s', () => {
  it('two patients read under the same args each get their own copy, or nothing', async () => {
    const server = createServer()
    const env = makeEnv()
    const rt = makeRuntime({ server, env })
    await signIn(rt, { server })
    await rt.reads.setGrant(grant(env, PATIENT))
    await rt.reads.setGrant(grant(env, PATIENT_B))
    // A caller that leaves the patient out of the arguments.
    await rt.reads.read({ method: 'vitals', args: [], patientId: PATIENT, network: async () => 'A only' })
    await expect(rt.reads.read({ method: 'vitals', args: [], patientId: PATIENT_B, network: offline })).rejects.toBeInstanceOf(TransportError)
    await rt.reads.read({ method: 'vitals', args: [], patientId: PATIENT_B, network: async () => 'B only' })
    expect((await rt.reads.read({ method: 'vitals', args: [], patientId: PATIENT_B, network: offline })).value).toBe('B only')
    // B's copy took the shared key, so A gets nothing rather than B's copy.
    await expect(rt.reads.read({ method: 'vitals', args: [], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)
  })
})

describe('A12.3: sending is bound to the account Health ID confirmed', () => {
  async function unlocked() {
    const server = createServer()
    const env = makeEnv()
    const rt = makeRuntime({ server, env })
    await signIn(rt, { server })
    rt.setSessionReady(false)
    return { server, env, rt }
  }

  it('ready for another account: nothing is sent or audited, and the lease is not extended', async () => {
    const { server, env, rt } = await unlocked()
    const signedInContact = await storedContact(rt)
    const from = server.calls.length
    rt.setSessionReady(true, 'another-account')
    expect((await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })).kind).toBe('saved')
    await settle(rt)
    expect(server.calls.slice(from).map(c => c.spec.path).filter(p => p !== OFFLINE_PATHS.ping)).toEqual([])
    env.wall += HOUR
    env.mono += HOUR
    contact(rt)
    rt.lock('manual')
    await settle(rt)
    expect(await storedContact(rt)).toBe(signedInContact)
  })

  it('ready for the vault\'s own account: the command is sent and the lease is extended', async () => {
    const { server, env, rt } = await unlocked()
    rt.setSessionReady(true, SESSION.accountId)
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    expect(server.writes()).toHaveLength(1)
    env.wall += HOUR
    env.mono += HOUR
    contact(rt)
    rt.lock('manual')
    await settle(rt)
    expect(await storedContact(rt)).toBe(env.wall)
  })
})

describe('A12.8: unlock after an offline cold start', () => {
  async function coldStart() {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    await signIn(makeRuntime({ server, env, idb }), { server })
    const rt = makeRuntime({ server, env, idb })
    expect(await rt.unlockOffline(SESSION.email, PASSWORD)).toMatchObject({ ok: true })
    rt.lock('idle')
    return rt
  }

  it('unlockOffline, lock(idle), then unlockLocked with the password opens it again', async () => {
    const rt = await coldStart()
    expect(await rt.unlockLocked(PASSWORD)).toMatchObject({ ok: true })
    expect(rt.restoreSession()).not.toBeNull()
  })

  it('a wrong password after the lock is wrong-credentials, not no-vault', async () => {
    const rt = await coldStart()
    expect(await rt.unlockLocked('not the password')).toEqual({ ok: false, reason: 'wrong-credentials' })
  })

  it('the fake refuses unlockLocked with no email, as the real runtime does', async () => {
    const { runtime } = await fakeSignedIn()
    await runtime.signOut({ online: false })
    expect(await runtime.hasVaults()).toBe(true)
    expect(await runtime.unlockLocked(PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
  })
})
