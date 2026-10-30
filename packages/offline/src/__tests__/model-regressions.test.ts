// Counterexamples the model-based test found (model.ts), kept as fixed regression tests.
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { PASSWORD, PATIENT } from './fixtures'
import { runSequence } from './model'
import { createServer, makeEnv, makeRuntime, signIn, until, type Env } from './harness'

const DAY = 86400_000

describe('model counterexamples', () => {
  it('seed 118: the lock overlay of a tab signed in long ago does not skip the lease', async () => {
    // A tab signed in, then locked; 62 days pass with no server contact. The unlock used to take the online-reload
    // path, open the vault without a lease check, record an offline open, and the abandoned rule then deleted it.
    const server = createServer()
    const env: Env = { ...makeEnv(), serverClock: true }
    const rt = makeRuntime({ server, env, idb: new IDBFactory() })
    await signIn(rt, { server })
    rt.lock('idle')
    server.state.offline = true
    env.wall += 62 * DAY
    env.mono += 62 * DAY
    expect(await rt.unlockLocked(PASSWORD)).toEqual({ ok: false, reason: 'lease-expired' })
    rt.audit.recordOpen(PATIENT, 'encounters')
    await expect(until(async () => (await (await rt.storeForDiagnostics())!.dump()).audit.length > 0, 200)).rejects.toThrow()
  })

  it('seed 118 and seed 51 replay clean', async () => {
    await runSequence(118, 40)
    await runSequence(51, 40)
  }, 60_000)
})
