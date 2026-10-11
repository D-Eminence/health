import { afterEach, describe, expect, it, vi } from 'vitest'
import { inRefreshTurn, refreshInTurn, signOutInTurn } from './sessionRefreshTurn'

/** Web Locks as browsers implement them for one exclusive lock: granted in turn, or refused with ifAvailable. */
function fakeLocks() {
  let held: Promise<unknown> = Promise.resolve()
  let busy = false
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable && busy) return callback(null)
    const previous = held
    let release: () => void = () => {}
    held = new Promise<void>(done => { release = done })
    await previous
    busy = true
    try { return await callback({}) } finally { busy = false; release() }
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return request
}

afterEach(() => { Reflect.deleteProperty(navigator, 'locks') })

describe('a session refresh across windows', () => {
  it('is sent as before where the browser has no Web Locks', async () => {
    const refresh = vi.fn(async () => 'refreshed')
    const current = vi.fn(async () => 'current')
    await expect(refreshInTurn(current, refresh)).resolves.toBe('refreshed')
    expect(current).not.toHaveBeenCalled()
  })

  it('refreshes at once when no other window is refreshing', async () => {
    fakeLocks()
    const refresh = vi.fn(async () => 'refreshed')
    const current = vi.fn(async () => 'current')
    await expect(refreshInTurn(current, refresh)).resolves.toBe('refreshed')
    expect(current).not.toHaveBeenCalled()
  })

  it('waits for a window already refreshing, then uses the session it restored instead of refreshing again', async () => {
    fakeLocks()
    let finishFirst: (value: string) => void = () => {}
    const first = refreshInTurn(async () => null, () => new Promise<string>(done => { finishFirst = done }))
    await Promise.resolve()
    const secondRefresh = vi.fn(async () => 'second refresh')
    const second = refreshInTurn(async () => 'session restored by the first window', secondRefresh)
    await Promise.resolve()
    expect(secondRefresh).not.toHaveBeenCalled()

    finishFirst('first refresh')
    await expect(first).resolves.toBe('first refresh')
    await expect(second).resolves.toBe('session restored by the first window')
    expect(secondRefresh).not.toHaveBeenCalled()
  })

  it('refreshes after waiting when the session is still not accepted', async () => {
    fakeLocks()
    let finishFirst: (value: string) => void = () => {}
    const first = refreshInTurn(async () => null, () => new Promise<string>(done => { finishFirst = done }))
    await Promise.resolve()
    const second = refreshInTurn(async () => null, async () => 'second refresh')
    finishFirst('first refresh')
    await first
    await expect(second).resolves.toBe('second refresh')
  })
})

describe('a sign-in across windows', () => {
  it('is sent at once where the browser has no Web Locks', async () => {
    await expect(inRefreshTurn(async () => 'signed in')).resolves.toBe('signed in')
  })

  it('waits for a refresh another window has in flight, so that refresh cannot land on the new session', async () => {
    fakeLocks()
    let finishRefresh: (value: string) => void = () => {}
    const refresh = refreshInTurn(async () => null, () => new Promise<string>(done => { finishRefresh = done }))
    await Promise.resolve()
    const signIn = vi.fn(async () => 'signed in')
    const signedIn = inRefreshTurn(signIn)
    await Promise.resolve()
    expect(signIn).not.toHaveBeenCalled()

    finishRefresh('refreshed')
    await refresh
    await expect(signedIn).resolves.toBe('signed in')
  })
})

/**
 * hid-system's logout clears the session cookies in its answer, and ends
 * whichever session the cookies carry when it arrives at the server.
 */
describe('a sign-out across windows', () => {
  it('is sent at once where the browser has no Web Locks', async () => {
    const stillOurs = vi.fn(async () => true)
    const signOut = vi.fn(async () => undefined)
    await signOutInTurn(stillOurs, signOut)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(stillOurs).not.toHaveBeenCalled()
  })

  it('holds the turn until it is answered, so a sign-in in another window cannot have its cookies cleared', async () => {
    fakeLocks()
    let finishSignOut: () => void = () => {}
    const signedOut = signOutInTurn(async () => true, () => new Promise<void>(done => { finishSignOut = done }))
    await Promise.resolve()
    const signIn = vi.fn(async () => 'signed in')
    const signedIn = inRefreshTurn(signIn)
    await Promise.resolve()
    expect(signIn).not.toHaveBeenCalled()

    finishSignOut()
    await signedOut
    await expect(signedIn).resolves.toBe('signed in')
  })

  it('is sent at once, asking nothing, when no other window holds the turn', async () => {
    fakeLocks()
    const stillOurs = vi.fn(async () => true)
    const signOut = vi.fn(async () => undefined)
    await signOutInTurn(stillOurs, signOut)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(stillOurs).not.toHaveBeenCalled()
  })

  it('that had to wait is sent while the browser still holds this session', async () => {
    fakeLocks()
    let finishSignIn: () => void = () => {}
    const signIn = inRefreshTurn(() => new Promise<void>(done => { finishSignIn = done }))
    await Promise.resolve()
    const stillOurs = vi.fn(async () => true)
    const signOut = vi.fn(async () => undefined)
    const signedOut = signOutInTurn(stillOurs, signOut)
    await Promise.resolve()
    expect(stillOurs).not.toHaveBeenCalled()

    finishSignIn()
    await signIn
    await signedOut
    expect(stillOurs).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('that had to wait leaves alone a session another window signed in meanwhile', async () => {
    fakeLocks()
    let finishSignIn: () => void = () => {}
    const signIn = inRefreshTurn(() => new Promise<void>(done => { finishSignIn = done }))
    await Promise.resolve()
    const signOut = vi.fn(async () => undefined)
    const signedOut = signOutInTurn(async () => false, signOut)

    finishSignIn()
    await signIn
    await signedOut
    expect(signOut).not.toHaveBeenCalled()
  })

  it.each([
    ['no other window holds the turn', () => { fakeLocks() }],
    ['the browser has no Web Locks', () => {}],
  ])('asks first when told to always ask, even when %s', async (_label, setUp) => {
    setUp()
    const signOut = vi.fn(async () => undefined)
    await signOutInTurn(async () => false, signOut, { alwaysAsk: true })
    expect(signOut).not.toHaveBeenCalled()
    await signOutInTurn(async () => true, signOut, { alwaysAsk: true })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('that had to wait is not sent when the browser cannot be asked whose session it holds', async () => {
    fakeLocks()
    let finishSignIn: () => void = () => {}
    const signIn = inRefreshTurn(() => new Promise<void>(done => { finishSignIn = done }))
    await Promise.resolve()
    const signOut = vi.fn(async () => undefined)
    const signedOut = signOutInTurn(async () => { throw new Error('offline') }, signOut)

    finishSignIn()
    await signIn
    await expect(signedOut).rejects.toThrow('offline')
    expect(signOut).not.toHaveBeenCalled()
  })
})
