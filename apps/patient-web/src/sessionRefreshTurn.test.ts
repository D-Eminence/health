import { afterEach, describe, expect, it, vi } from 'vitest'
import { refreshInTurn } from './sessionRefreshTurn'

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
