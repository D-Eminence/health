import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { LIMITS, type GrantState } from '../contracts'
import { TransportError } from '../types'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, signIn } from './harness'

const T0 = Date.parse('2026-10-29T09:00:00.000Z')
const grant = (over: Partial<GrantState> = {}): GrantState => ({
  patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: new Date(T0 + 3600_000).toISOString(), breakGlass: false,
  observedAt: new Date(T0).toISOString(), ...over,
})
const offline = () => Promise.reject(new TransportError({ status: null, networkError: true }))

async function ready() {
  const server = createServer()
  const env = makeEnv()
  const idb = new IDBFactory()
  const rt = makeRuntime({ server, env, idb })
  await signIn(rt)
  return { rt, env, idb, server }
}

describe('read cache', () => {
  it('network first; offline shows the saved copy with its time (T1)', async () => {
    const { rt } = await ready()
    await rt.reads.setGrant(grant())
    const first = await rt.reads.read({ method: 'encounters', args: [PATIENT, 1], patientId: PATIENT, network: async () => ({ items: ['v1'] }) })
    expect(first).toEqual({ value: { items: ['v1'] }, source: 'network', savedAt: null })
    const again = await rt.reads.read({ method: 'encounters', args: [PATIENT, 1], patientId: PATIENT, network: offline })
    expect(again).toEqual({ value: { items: ['v1'] }, source: 'cache', savedAt: new Date(T0).toISOString() })
    // A 502 from the Worker also falls back; a 404 does not.
    const gw = await rt.reads.read({ method: 'encounters', args: [PATIENT, 1], patientId: PATIENT,
      network: () => Promise.reject(new TransportError({ status: 502, code: 'API_ORIGIN_UNAVAILABLE' })) })
    expect(gw.source).toBe('cache')
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT, 1], patientId: PATIENT,
      network: () => Promise.reject(new TransportError({ status: 404, code: 'NOT_FOUND' })) })).rejects.toMatchObject({ status: 404 })
  })

  it('a slow network shows the saved copy and the late answer refreshes it', async () => {
    const { rt } = await ready()
    await rt.reads.setGrant(grant())
    await rt.reads.read({ method: 'encounter', args: ['e1'], patientId: PATIENT, network: async () => 'old' })
    let release: (v: string) => void = () => undefined
    const slow = new Promise<string>(r => { release = r })
    const shown = await rt.reads.read({ method: 'encounter', args: ['e1'], patientId: PATIENT, network: () => slow })
    expect(shown.source).toBe('cache')
    expect(shown.value).toBe('old')
    release('new')
    await new Promise(r => setTimeout(r, 30))
    const after = await rt.reads.read({ method: 'encounter', args: ['e1'], patientId: PATIENT, network: offline })
    expect(after.value).toBe('new')
  })

  it('never caches without a grant, under break-glass, or for emergency reads (T13, F5)', async () => {
    const { rt } = await ready()
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'no grant yet' })
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)

    await rt.reads.setGrant(grant())
    await rt.reads.read({ method: 'emergencyRecords', args: [PATIENT], patientId: PATIENT, network: async () => 'summary' })
    await rt.reads.read({ method: 'records', args: [PATIENT], patientId: PATIENT, emergency: true, network: async () => 'summary' })
    await rt.reads.read({ method: 'documentDownload', args: ['d1'], patientId: PATIENT, network: async () => 'bytes' })
    const dump = await (await rt.storeForDiagnostics())!.dump()
    expect(dump.cache.filter(r => (r as { kind: string }).kind === 'read')).toHaveLength(0)

    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'kept' })
    await rt.reads.setGrant(grant({ breakGlass: true }))
    const after = await (await rt.storeForDiagnostics())!.dump()
    expect(after.cache.filter(r => (r as { kind: string }).kind !== 'index')).toHaveLength(0)
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'under break-glass' })
    expect((await (await rt.storeForDiagnostics())!.dump()).cache.filter(r => (r as { kind: string }).kind === 'read')).toHaveLength(0)
  })

  it('denies after grant.expiresAt by trusted time even if Date.now() is moved back (T7)', async () => {
    const { rt, env } = await ready()
    rt.onResponseMeta({ method: 'GET', path: '/x', status: 200, date: new Date(T0).toUTCString(), problem: false, code: null, networkError: false, authenticated: true })
    await rt.reads.setGrant(grant())
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
    // Two hours pass on the monotonic clock while the wall clock is moved back an hour.
    env.mono += 2 * 3600_000
    env.wall -= 3600_000
    expect(rt.trustedNow().at.getTime()).toBeGreaterThanOrEqual(T0 + 2 * 3600_000)
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)
    const dump = await (await rt.storeForDiagnostics())!.dump()
    expect(dump.cache.filter(r => (r as { pt: string }).pt !== '')).toHaveLength(0)
  })

  it('an online 403 CONSENT_REQUIRED removes the patient', async () => {
    const { rt } = await ready()
    await rt.reads.setGrant(grant())
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT,
      network: () => Promise.reject(Object.assign(new Error('x'), { status: 403, code: 'CONSENT_REQUIRED' })) })).rejects.toBeTruthy()
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)
  })

  it('locked or past the lease: nothing is readable', async () => {
    const { rt, env } = await ready()
    await rt.reads.setGrant(grant({ expiresAt: null }))
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
    rt.lock('manual')
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)
    expect((await rt.unlockLocked('correct horse battery')).ok).toBe(true)
    expect((await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).source).toBe('cache')
    env.wall += LIMITS.leaseMs
    await expect(rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: offline })).rejects.toBeInstanceOf(TransportError)
  })

  it('keeps the 100 most recently opened patients', async () => {
    const { rt, env } = await ready()
    for (let i = 0; i <= LIMITS.maxPatients; i += 1) {
      const id = `p-${String(i).padStart(3, '0')}`
      env.wall += 1000
      await rt.reads.setGrant(grant({ patientId: id, expiresAt: null }))
      await rt.rememberPatient({ patientId: id, displayName: `Test Patient ${i}`, hidCode: `HID-${i}`, grantExpiresAt: null })
    }
    const list = await rt.patients.list()
    expect(list).toHaveLength(LIMITS.maxPatients)
    expect(list.some(e => e.patientId === 'p-000')).toBe(false)
    expect((await rt.patients.search('test patient 100'))[0]!.patientId).toBe('p-100')
  }, 30_000)

  it('keepOffline runs its fetchers two at a time', async () => {
    const { rt } = await ready()
    let running = 0
    let peak = 0
    const f = () => async () => { running += 1; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running -= 1 }
    await rt.reads.keepOffline(PATIENT, [f(), f(), f(), f(), f()])
    expect(peak).toBe(2)
  })
})
