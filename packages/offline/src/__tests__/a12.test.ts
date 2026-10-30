// Contract A12 (after the review of PR #35): the core seams the screens need.
import { describe, expect, it } from 'vitest'
import { type GrantState } from '../contracts'
import { TransportError } from '../types'
import { PATIENT } from './fixtures'
import { createServer, makeEnv, makeRuntime, signIn, type Env } from './harness'

const PATIENT_B = '66666666-6666-4666-8666-666666666666'
const HOUR = 3600_000

const offline = () => Promise.reject(new TransportError({ status: null, networkError: true }))
const grant = (env: Env, patientId: string): GrantState => ({
  patientId, readAllowed: true, writeAllowed: true, expiresAt: new Date(env.wall + HOUR).toISOString(), breakGlass: false,
  observedAt: new Date(env.wall).toISOString(),
})
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
