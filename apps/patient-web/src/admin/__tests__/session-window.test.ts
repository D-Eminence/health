import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionWindow, currentSessionWindow, onSessionEnded, recordSessionWindow, reportSessionEnded, sessionEndReason,
} from '../session-window'

afterEach(() => clearSessionWindow())

describe('platform session window', () => {
  it('has no reason when this page never held a platform session', () => {
    expect(sessionEndReason()).toBeNull()
  })

  it('keeps the last server-reported values and ignores unreadable ones', () => {
    recordSessionWindow({ idleExpiresAt: '2026-10-08T12:15:00.000Z', absoluteExpiresAt: '2026-10-08T20:00:00.000Z' })
    recordSessionWindow({ idleExpiresAt: 'not a date' })
    expect(currentSessionWindow()).toEqual({ idleExpiresAt: Date.parse('2026-10-08T12:15:00.000Z'),
      absoluteExpiresAt: Date.parse('2026-10-08T20:00:00.000Z') })
  })

  it('reads a refusal after the idle or absolute expiry as expired, and before it as revoked', () => {
    recordSessionWindow({ idleExpiresAt: '2026-10-08T12:15:00.000Z', absoluteExpiresAt: '2026-10-08T20:00:00.000Z' })
    expect(sessionEndReason(Date.parse('2026-10-08T12:10:00.000Z'))).toBe('revoked')
    expect(sessionEndReason(Date.parse('2026-10-08T12:15:00.000Z'))).toBe('expired')
    recordSessionWindow({ idleExpiresAt: '2026-10-08T21:00:00.000Z' })
    expect(sessionEndReason(Date.parse('2026-10-08T20:00:01.000Z'))).toBe('expired')
  })

  it('notifies listeners with the reason until they unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = onSessionEnded(listener)
    reportSessionEnded()
    expect(listener).toHaveBeenLastCalledWith(null)
    unsubscribe()
    reportSessionEnded()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
