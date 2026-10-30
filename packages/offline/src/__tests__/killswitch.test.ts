import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn } from './harness'

async function withPending() {
  const server = createServer()
  const env = makeEnv()
  const idb = new IDBFactory()
  const rt = makeRuntime({ server, env, idb })
  await signIn(rt)
  await rt.reads.setGrant({ patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: null, breakGlass: false, observedAt: '' })
  await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => 'chart' })
  server.state.offline = true
  await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
  await settle(rt)
  rt.dispose()
  server.state.offline = false
  return { server, env, idb }
}

describe('kill switch (§2.3, T17, T19)', () => {
  it('mode off wipes every readable copy, refuses offline unlock, still sends pending work, then deletes the vault', async () => {
    const { server, env, idb } = await withPending()
    const off = makeRuntime({ server, env, idb, mode: 'off' })
    await off.ready()
    const dump = await (await off.storeForDiagnostics())!.dump()
    expect(dump.cache).toHaveLength(0)
    expect(dump.outbox).toHaveLength(1)
    expect(await off.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })

    off.prepareFromSignIn(SESSION.email, PASSWORD)
    await off.attachSession(SESSION, { optIn: false, online: true })
    off.setSessionReady(true, SESSION.accountId)
    await settle(off)
    await settle(off)
    expect(server.keys.size).toBe(1)
    expect(await off.hasVaults()).toBe(false)
    expect(off.policy()).toMatchObject({ enabled: false, reason: 'mode-off' })
  })

  it('a facility removed from the pilot list is treated the same way', async () => {
    const { server, env, idb } = await withPending()
    const rt = makeRuntime({ server, env, idb, extra: { env: { mode: 'pilot', facilities: OTHER_FACILITY, hosts: 'ehr' } } })
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    expect(await rt.offer(SESSION)).toEqual({ kind: 'unavailable', reason: 'facility-off' })
    await rt.attachSession(SESSION, { optIn: false, online: true })
    rt.setSessionReady(true, SESSION.accountId)
    await settle(rt)
    await settle(rt)
    expect(server.keys.size).toBe(1)
    expect(await rt.hasVaults()).toBe(false)
  })

  it('membership ended: cache wiped, unsent work held (CC8)', async () => {
    const server = createServer()
    const rt = makeRuntime({ server, env: makeEnv() })
    await signIn(rt)
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    await rt.wipe('membership')
    const dump = await (await rt.storeForDiagnostics())!.dump()
    expect((dump.outbox[0] as { state: string }).state).toBe('held_membership')
    expect(dump.cache).toHaveLength(0)
  })
})
