import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { LIMITS } from '../contracts'
import { OTHER_FACILITY, PASSWORD, PATIENT, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, settle, signIn } from './harness'

const GRANT = { patientId: PATIENT, readAllowed: true, writeAllowed: true, expiresAt: '2026-10-29T17:00:00.000Z', breakGlass: false, observedAt: '2026-10-29T09:00:00.000Z' }

async function dbNames(idb: IDBFactory) {
  return (await idb.databases()).map(d => d.name)
}

describe('vault: one-time choice (A5)', () => {
  it('asks once for a pilot facility, then opens the existing vault without asking', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    expect(await rt.offer(SESSION)).toEqual({ kind: 'ask' })
    const s = await rt.attachSession(SESSION, { optIn: true, online: true })
    expect(s.vault).toBe('unlocked')
    expect(s.escrow).toBe(true)
    expect(rt.policy().enabled).toBe(true)
    expect(rt.restoreSession()?.accountId).toBe(SESSION.accountId)

    const rt2 = makeRuntime({ server, env, idb })
    rt2.prepareFromSignIn(SESSION.email.toUpperCase(), PASSWORD)
    expect(await rt2.offer(SESSION)).toEqual({ kind: 'existing' })
    expect((await rt2.attachSession(SESSION, { optIn: false, online: true })).vault).toBe('unlocked')
  })

  it('a facility outside the pilot list derives nothing to disk and writes nothing', async () => {
    const server = createServer()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env: makeEnv(), idb })
    rt.prepareFromSignIn(SESSION.email, PASSWORD)
    const other = { ...SESSION, facilityId: OTHER_FACILITY }
    expect(await rt.offer(other)).toEqual({ kind: 'unavailable', reason: 'facility-off' })
    const s = await rt.attachSession(other, { optIn: true, online: true })
    expect(s.vault).toBe('none')
    expect(rt.policy()).toMatchObject({ enabled: false, reason: 'facility-off' })
    expect(await dbNames(idb)).not.toContain('health-id-offline')
  })

  it('declining writes nothing; mode off derives nothing', async () => {
    const idb = new IDBFactory()
    const rt = makeRuntime({ server: createServer(), env: makeEnv(), idb })
    await signIn(rt, { optIn: false })
    expect(rt.summary().vault).toBe('none')
    expect(await dbNames(idb)).not.toContain('health-id-offline')

    const off = makeRuntime({ server: createServer(), env: makeEnv(), idb, mode: 'off' })
    off.prepareFromSignIn(SESSION.email, PASSWORD)
    expect(await off.offer(SESSION)).toEqual({ kind: 'unavailable', reason: 'mode-off' })
    expect(off.policy()).toMatchObject({ mode: 'off', enabled: false, reason: 'mode-off' })
  })

  it('a password under 12 characters cannot opt in', async () => {
    const idb = new IDBFactory()
    const rt = makeRuntime({ server: createServer(), env: makeEnv(), idb })
    rt.prepareFromSignIn(SESSION.email, 'short-pass')
    expect(await rt.offer(SESSION)).toEqual({ kind: 'unavailable', reason: 'password-too-short' })
    await rt.attachSession(SESSION, { optIn: true, online: true })
    expect(rt.policy().reason).toBe('password-too-short')
    expect(await rt.hasVaults()).toBe(false)
  })

  it('an online reload without a password is paused until unlocked', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    await signIn(makeRuntime({ server, env, idb }))
    const reload = makeRuntime({ server, env, idb })
    expect(await reload.offer(SESSION)).toEqual({ kind: 'paused' })
    expect((await reload.attachSession(SESSION, { optIn: false, online: true })).vault).toBe('locked')
    expect(await reload.unlockLocked('wrong password here')).toEqual({ ok: false, reason: 'wrong-credentials' })
    expect((await reload.unlockLocked(PASSWORD)).ok).toBe(true)
  })
})

describe('vault: unlock, lock, wipe', () => {
  it('locks, needs the password to reopen, and unlocks offline within the lease', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    rt.lock('manual')
    expect(rt.summary().vault).toBe('locked')
    expect(rt.restoreSession()).toBeNull()
    expect(await rt.unlockLocked('not the password')).toEqual({ ok: false, reason: 'wrong-credentials' })
    expect((await rt.unlockLocked(PASSWORD)).ok).toBe(true)

    // Offline cold start in a new tab.
    const cold = makeRuntime({ server, env, idb })
    const r = await cold.unlockOffline(SESSION.email, PASSWORD)
    expect(r.ok).toBe(true)
    expect(cold.restoreSession()?.facilityId).toBe(SESSION.facilityId)
  })

  it('locks after 5 minutes idle', async () => {
    const env = makeEnv()
    const rt = makeRuntime({ server: createServer(), env })
    await signIn(rt)
    env.mono += LIMITS.idleLockMs - 1000
    await rt.tick()
    expect(rt.summary().vault).toBe('unlocked')
    rt.noteActivity()
    env.mono += LIMITS.idleLockMs
    await rt.tick()
    expect(rt.summary().vault).toBe('locked')
  })

  it('refuses offline unlock after the lease and after a clock rollback', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    await rt.tick()
    rt.lock('manual')

    env.wall -= 10 * 60_000 // clock moved back 10 minutes (T11)
    const back = makeRuntime({ server, env, idb })
    expect(await back.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'clock-suspect' })

    env.wall += 10 * 60_000 + LIMITS.leaseMs + 1
    const late = makeRuntime({ server, env, idb })
    expect(await late.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'lease-expired' })
  })

  it('five wrong offline passwords wipe every readable copy and keep pending work (T9)', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    await rt.reads.setGrant(GRANT)
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => ['visit'] })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.lock('manual')

    const cold = makeRuntime({ server, env, idb })
    for (let i = 1; i < LIMITS.maxFailedUnlocks; i += 1) {
      expect(await cold.unlockOffline(SESSION.email, `wrong password ${i}`)).toEqual({ ok: false, reason: 'wrong-credentials' })
    }
    expect(await cold.unlockOffline(SESSION.email, 'wrong password 5')).toEqual({ ok: false, reason: 'wiped' })
    expect(await cold.unlockOffline(SESSION.email, PASSWORD)).toEqual({ ok: false, reason: 'wiped' })
    const dump = await (await cold.storeForDiagnostics())!.dump()
    expect(dump.cache).toHaveLength(0)
    expect(dump.outbox).toHaveLength(1)

    // The next online sign-in opens it again and sends the pending work.
    server.state.offline = false
    const online = makeRuntime({ server, env, idb })
    await signIn(online)
    await settle(online)
    expect(server.writes().filter(c => c.spec.method === 'POST')).toHaveLength(2)
    expect(online.summary().pending).toBe(0)
  })

  it("wipe('sign-out') leaves outbox, audit and media intact", async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    await rt.reads.setGrant(GRANT)
    await rt.reads.read({ method: 'encounters', args: [PATIENT], patientId: PATIENT, network: async () => ['visit'] })
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await rt.stageMedia(new Blob([new Uint8Array(10)], { type: 'application/pdf' }), { index: 1 })
    rt.audit.recordOpen(PATIENT, 'encounters')
    await settle(rt)
    await new Promise(r => setTimeout(r, 20))
    const before = await (await rt.storeForDiagnostics())!.dump()
    expect(before.audit.length).toBeGreaterThan(0)
    await rt.wipe('sign-out')
    const after = await (await rt.storeForDiagnostics())!.dump()
    expect(after.cache).toHaveLength(0)
    expect(after.outbox).toHaveLength(before.outbox.length)
    expect(after.audit.length).toBeGreaterThanOrEqual(before.audit.length)
    expect(after.media).toHaveLength(before.media.length)
    expect((after.vaults[0] as { header: unknown }).header).toBeNull()
  })

  it('signing out offline leaves logoutPending; online deletes an idle vault', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    await rt.signOut({ online: false })
    expect(await rt.logoutPending()).toBe(true)
    await rt.logoutSent()
    expect(await rt.hasVaults()).toBe(false)

    const again = makeRuntime({ server, env, idb })
    await signIn(again)
    await again.signOut({ online: true })
    expect(await again.hasVaults()).toBe(false)
  })

  it('keeps at most five vaults and refuses a sixth when all have pending work', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    for (let i = 0; i < 5; i += 1) {
      const rt = makeRuntime({ server, env, idb })
      await signIn(rt, { server, session: { ...SESSION, accountId: `acc-${i}`, email: `user${i}@demo.example` } })
      server.state.offline = true
      await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
      await settle(rt)
      server.state.offline = false
      rt.dispose()
    }
    const sixth = makeRuntime({ server, env, idb })
    const s = await signIn(sixth, { server, session: { ...SESSION, accountId: 'acc-6', email: 'user6@demo.example' } })
    expect(s.vault).not.toBe('unlocked')
    const dump = await (await sixth.storeForDiagnostics())!.dump()
    expect(dump.vaults).toHaveLength(5)
  })

  it('evicts the oldest idle vault for a sixth account', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    for (let i = 0; i < 6; i += 1) {
      env.wall += 1000
      const rt = makeRuntime({ server, env, idb })
      expect((await signIn(rt, { server, session: { ...SESSION, accountId: `acc-${i}`, email: `user${i}@demo.example` } })).vault).toBe('unlocked')
      rt.dispose()
    }
    const dump = await (await makeRuntime({ server, env, idb }).storeForDiagnostics())!.dump()
    expect(dump.vaults).toHaveLength(5)
  })

  it('after a password change, escrow recovers the queue under the new password (F4)', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const rt = makeRuntime({ server, env, idb })
    await signIn(rt)
    server.state.offline = true
    await rt.commands.save('ehr.encounter.create', { patientId: PATIENT }, { awaitMs: 0 })
    await settle(rt)
    rt.dispose()
    server.state.offline = false

    const next = makeRuntime({ server, env, idb })
    const s = await signIn(next, { password: 'a brand new password' })
    expect(s.vault).toBe('unlocked')
    await settle(next)
    expect(next.summary().pending).toBe(0)
    expect(server.keys.size).toBe(1)
    next.lock('manual')
    expect((await next.unlockLocked('a brand new password')).ok).toBe(true)
  })
})
