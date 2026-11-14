import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearSessionWindow, currentSessionWindow, onSessionEnded, recordServerSessionEnd, recordSessionWindow, reportSessionEnded,
  serverSessionEnd, sessionEndReason,
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

  it('maps only the server session-end codes to a reason (Stage 4A)', () => {
    expect(serverSessionEnd('PLATFORM_SESSION_EXPIRED')).toBe('expired')
    expect(serverSessionEnd('PLATFORM_SESSION_REVOKED')).toBe('revoked')
    expect(serverSessionEnd('AUTHENTICATION_REQUIRED')).toBeNull()
    expect(serverSessionEnd(undefined)).toBeNull()
  })

  it('prefers the reason the server gave over the expiry reading, once, until a new session', () => {
    const listener = vi.fn()
    const unsubscribe = onSessionEnded(listener)
    recordSessionWindow({ idleExpiresAt: '2000-01-01T00:00:00.000Z' })
    reportSessionEnded('revoked')
    expect(listener).toHaveBeenLastCalledWith('revoked')
    recordServerSessionEnd('revoked')
    reportSessionEnded()
    expect(listener).toHaveBeenLastCalledWith('revoked')
    reportSessionEnded()
    expect(listener).toHaveBeenLastCalledWith('expired')
    recordServerSessionEnd('expired')
    recordSessionWindow({ idleExpiresAt: '2999-01-01T00:00:00.000Z' })
    reportSessionEnded()
    expect(listener).toHaveBeenLastCalledWith('revoked')
    unsubscribe()
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
