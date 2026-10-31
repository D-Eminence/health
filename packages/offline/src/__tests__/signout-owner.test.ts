// Round 5, item 2: a sign-out after the tab's session changed owner wipes that session's readable copy (A8.11).
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { OTHER_FACILITY, PASSWORD, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, signIn } from './harness'

const TWO_PILOTS = { env: { mode: 'pilot', facilities: `${SESSION.facilityId},${OTHER_FACILITY}`, hosts: 'ehr' } }
const AT_Y = { ...SESSION, facilityId: OTHER_FACILITY, facilityName: 'Second Pilot' }
const B = {
  ...SESSION, actorId: '99999999-9999-4999-8999-999999999991', accountId: '77777777-7777-4777-8777-777777777777',
  membershipId: '88888888-8888-4888-8888-888888888888', email: 'Other.Nurse@demo.example', displayName: 'Bo Othernurse',
}
const PASSWORD_B = 'another long passphrase'

describe('a sign-out after the tab\'s session changed owner wipes that session\'s readable copy', () => {
  it('facility switch X -> Y (no password, as selectFacility does), then sign-out: A\'s Y copy does not open offline', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const earlier = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(earlier, { server, session: AT_Y })
    earlier.dispose()
    const tab = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    await signIn(tab, { server })
    tab.lock('manual')
    expect(await tab.offer(AT_Y)).toEqual({ kind: 'paused' })
    await tab.attachSession(AT_Y, { optIn: false, online: true })
    tab.setSessionReady(true, SESSION.accountId)
    await tab.signOut({ online: true })
    const off = makeRuntime({ server, env, idb, extra: TWO_PILOTS })
    expect((await off.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
    expect(off.restoreSession()).toBeNull()
  })

  it('the tab\'s session becomes B\'s with no password typed here, B signs out here: B\'s copy does not open offline', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const other = makeRuntime({ server, env, idb })
    await signIn(other, { server, session: B, password: PASSWORD_B })
    other.dispose()
    const tab = makeRuntime({ server, env, idb })
    await signIn(tab, { server })
    server.state.account = B.accountId
    await tab.attachSession(B, { optIn: false, online: true })
    tab.setSessionReady(true, B.accountId)
    await tab.signOut({ online: true })
    const off = makeRuntime({ server, env, idb })
    expect((await off.unlockOffline(B.email, PASSWORD_B)).ok).toBe(false)
  })

  it('the vault this tab opened was since replaced in another tab (seed 349): sign-out still wipes the session\'s copy', async () => {
    const server = createServer()
    const env = makeEnv()
    const idb = new IDBFactory()
    const tab1 = makeRuntime({ server, env, idb })
    await signIn(tab1, { server })
    const tab0 = makeRuntime({ server, env, idb })
    await tab0.signOut({ online: true })
    await signIn(tab0, { server })
    await tab1.signOut({ online: false })
    const off = makeRuntime({ server, env, idb })
    expect((await off.unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
  })
})
