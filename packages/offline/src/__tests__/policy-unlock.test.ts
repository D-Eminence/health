import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createFakeOfflineRuntime } from '../testing'
import { OTHER_FACILITY, PASSWORD, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, signIn } from './harness'

async function deviceWithVault() {
  const server = createServer()
  const env = makeEnv()
  const idb = new IDBFactory()
  const first = makeRuntime({ server, env, idb })
  await signIn(first)
  first.dispose()
  return { server, env, idb }
}

describe('policy after an offline unlock', () => {
  it('real runtime: enabled after unlockOffline for a pilot facility', async () => {
    const { server, env, idb } = await deviceWithVault()
    const cold = makeRuntime({ server, env, idb })
    expect(cold.policy().enabled).toBe(false)
    expect((await cold.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
    expect(cold.policy()).toEqual({ mode: 'pilot', enabled: true })
  })

  it('real runtime: stays disabled when the facility left the pilot or the mode is off', async () => {
    const { server, env, idb } = await deviceWithVault()
    const left = makeRuntime({ server, env, idb, extra: { env: { mode: 'pilot', facilities: OTHER_FACILITY, hosts: 'ehr' } } })
    expect(await left.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
    expect(left.policy().enabled).toBe(false)
    const off = makeRuntime({ server, env, idb, mode: 'off' })
    expect(await off.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
    expect(off.policy()).toMatchObject({ mode: 'off', enabled: false })
  })

  it('fake: matches the real runtime', async () => {
    const pilot = createFakeOfflineRuntime()
    pilot.controls.seedVault(SESSION, PASSWORD)
    expect(pilot.runtime.policy().enabled).toBe(false)
    expect((await pilot.runtime.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(true)
    expect(pilot.runtime.policy()).toEqual({ mode: 'pilot', enabled: true })

    const left = createFakeOfflineRuntime({ env: { mode: 'pilot', facilities: OTHER_FACILITY, hosts: 'ehr' } })
    left.controls.seedVault(SESSION, PASSWORD)
    expect(await left.runtime.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
    expect(left.runtime.policy().enabled).toBe(false)
  })
})
