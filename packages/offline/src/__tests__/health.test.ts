import { describe, expect, it } from 'vitest'
import { ConnectivityMonitor } from '../connectivity'
import { OFFLINE_PATHS } from '../contracts'
import { StorageHealth, isLow } from '../storageHealth'
import { TransportError, type SendSpec } from '../types'

describe('storage health', () => {
  it('is low under 200 MB free or over 80% used', () => {
    const MB = 1024 * 1024
    expect(isLow(100 * MB, 1000 * MB)).toBe(false)
    expect(isLow(900 * MB, 1000 * MB)).toBe(true)
    expect(isLow(10 * MB, 150 * MB)).toBe(true)
    expect(isLow(null, null)).toBe(false)
  })

  it('reads estimate() and asks for persist()', async () => {
    let changes = 0
    const h = new StorageHealth({ estimate: async () => ({ usage: 10, quota: 100 }), persist: async () => true, persisted: async () => true }, () => { changes += 1 })
    expect(await h.persist()).toBe(true)
    expect(await h.check()).toEqual({ usageBytes: 10, quotaBytes: 100, persisted: true, low: true })
    expect(changes).toBe(2)
  })
})

describe('connectivity monitor', () => {
  it('goes offline after three failed probes and back online after three good ones, without probing via the client hook', async () => {
    let down = true
    const calls: SendSpec[] = []
    const states: string[] = []
    const m = new ConnectivityMonitor({
      transport: async spec => {
        calls.push(spec)
        if (down) throw new TransportError({ status: null, networkError: true })
        return { status: 200, body: { service: 'ehr-api', serverTime: '2026-10-29T10:42:00.123Z' }, date: null }
      },
      setTimer: () => 0, clearTimer: () => undefined,
      onChange: next => states.push(next),
    })
    for (let i = 0; i < 3; i += 1) await m.probe()
    expect(m.current()).toBe('offline')
    down = false
    for (let i = 0; i < 3; i += 1) await m.probe()
    expect(m.current()).toBe('online')
    expect(states).toEqual(['reconnecting', 'offline', 'reconnecting', 'online'])
    expect(calls.every(c => c.path === OFFLINE_PATHS.ping && c.auth === 'none')).toBe(true)
    // The ping's own responses reported through onResponseMeta are not counted twice.
    m.observe({ method: 'GET', path: OFFLINE_PATHS.ping, status: null, date: null, problem: false, code: null, networkError: true, authenticated: false })
    expect(m.current()).toBe('online')
  })
})
