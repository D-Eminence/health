// Round 5, item 5: a membership end learned in a tab that does not hold the person's vault (D9, §2.6).
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createMemoryLocks } from '../testing'
import { PASSWORD, SESSION } from './fixtures'
import { createServer, makeEnv, makeRuntime, privateChannel, serverContact, signIn, until, type Env } from './harness'

type Rt = ReturnType<typeof makeRuntime>
type V = { header: unknown; flags: { membershipEndedAt: number | null } }

function twoTabs() {
  const server = createServer()
  const env: Env = { ...makeEnv(), serverClock: true }
  const idb = new IDBFactory()
  const locks = createMemoryLocks()
  const extra = { BroadcastChannel: privateChannel() }
  const tab = () => makeRuntime({ server, env, idb, locks, extra })
  return { server, tab0: tab(), tab1: tab(), tab }
}
const vault = async (rt: Rt) => ((await (await rt.storeForDiagnostics())!.dump()).vaults as V[])[0]!

async function expectEnded(tab0: Rt, tab: () => Rt) {
  await until(async () => (await vault(tab0)).flags.membershipEndedAt !== null, 1000)
  expect((await vault(tab0)).header).toBeNull()
  expect(tab0.summary().vault).not.toBe('unlocked')
  tab0.lock('manual')
  expect((await tab0.unlockLocked(PASSWORD)).ok).toBe(false)
  expect((await tab().unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
}

describe('a membership end learned in another tab (D9)', () => {
  it('learned by a paused tab (online reload, never unlocked)', async () => {
    const { server, tab0, tab1, tab } = twoTabs()
    await signIn(tab0, { server })
    serverContact(tab1)
    await tab1.attachSession(SESSION, { optIn: false, online: true })
    tab1.setSessionReady(true, SESSION.accountId)
    await tab1.wipe('membership')
    await expectEnded(tab0, tab)
  })

  it('learned by a tab whose last vault another tab signed out of and replaced (seed 1607)', async () => {
    const { server, tab0, tab1, tab } = twoTabs()
    await signIn(tab1, { server })
    await tab0.signOut({ online: true })
    await signIn(tab0, { server })
    await tab1.wipe('membership')
    await expectEnded(tab0, tab)
  })

  it('learned by the only tab after a reload', async () => {
    const { server, tab0, tab } = twoTabs()
    await signIn(tab0, { server })
    tab0.dispose()
    const rt = tab()
    serverContact(rt)
    await rt.attachSession(SESSION, { optIn: false, online: true })
    rt.setSessionReady(true, SESSION.accountId)
    await rt.wipe('membership')
    expect((await vault(rt)).header).toBeNull()
    expect(await rt.unlockLocked(PASSWORD)).toEqual({ ok: false, reason: 'no-vault' })
    expect((await tab().unlockOffline(SESSION.email, PASSWORD)).ok).toBe(false)
  })
})
