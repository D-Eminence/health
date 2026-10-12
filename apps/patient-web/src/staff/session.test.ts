import { afterEach, describe, expect, it, vi } from 'vitest'

// The session state lives in the module, so each test loads it afresh.
afterEach(() => { vi.resetModules() })

/** How a waiting step has ended once everything already due has run, or that it still waits. */
function outcome(step: Promise<void>) {
  const ended = step.then(() => 'resumed', (error: { code?: string }) => error.code)
  return Promise.race([ended, new Promise<string>(resolve => { setTimeout(() => resolve('still waiting'), 0) })])
}

describe('a protected step waiting for its staff session', () => {
  it('waits while the session is not ready, and resumes once it is', async () => {
    const session = await import('./session')
    const step = session.untilStaffSessionReady(session.staffSessionGeneration())

    expect(await outcome(step)).toBe('still waiting')
    session.setStaffSessionReady(true)
    expect(await outcome(step)).toBe('resumed')
  })

  it('is abandoned once its session ends, without waiting for the next to be ready', async () => {
    const session = await import('./session')
    const step = session.untilStaffSessionReady(session.staffSessionGeneration())

    session.startStaffSessionGeneration()
    expect(await outcome(step)).toBe('REQUEST_CANCELLED')
  })

  it('is abandoned, not resumed, when a later session is ready', async () => {
    const session = await import('./session')
    const sentIn = session.staffSessionGeneration()
    session.startStaffSessionGeneration()
    session.setStaffSessionReady(true)

    expect(await outcome(session.untilStaffSessionReady(sentIn))).toBe('REQUEST_CANCELLED')
  })
})

describe('a protected request for a facility', () => {
  const cancelled = (check: () => void) => { try { check(); return 'sent' } catch (error) { return (error as { code?: string }).code } }
  const at = (facilityId: string) => ({ 'X-Facility-ID': facilityId, 'X-Purpose-Of-Use': 'direct-care' })

  it('goes out for one of the session\'s facilities, and for any while no session is in use', async () => {
    const session = await import('./session')
    expect(cancelled(() => session.assertStaffSessionFacility(at('facility-2')))).toBe('sent')
    session.setStaffSessionFacilities(['facility-1', 'facility-2'])
    expect(cancelled(() => session.assertStaffSessionFacility(at('facility-2')))).toBe('sent')
    expect(cancelled(() => session.assertStaffSessionFacility(undefined))).toBe('sent')
    expect(cancelled(() => session.assertStaffSessionFacility({ 'Idempotency-Key': 'key-1' }))).toBe('sent')
    // One naming no facility is the server's to refuse (400 FACILITY_REQUIRED), as before.
    expect(cancelled(() => session.assertStaffSessionFacility(at('')))).toBe('sent')
  })

  it('is cancelled once its facility is no longer one of the session\'s', async () => {
    const session = await import('./session')
    session.setStaffSessionFacilities(['facility-1'])
    expect(cancelled(() => session.assertStaffSessionFacility(at('facility-2')))).toBe('REQUEST_CANCELLED')
  })

  it('names its facility however the header is written: header names are not case-sensitive', async () => {
    const session = await import('./session')
    session.setStaffSessionFacilities(['facility-1'])
    expect(cancelled(() => session.assertStaffSessionFacility({ 'x-facility-id': 'facility-1' }))).toBe('sent')
    expect(cancelled(() => session.assertStaffSessionFacility({ 'x-facility-id': 'facility-2' }))).toBe('REQUEST_CANCELLED')
    expect(cancelled(() => session.assertStaffSessionFacility({ 'X-FACILITY-ID': 'facility-2' }))).toBe('REQUEST_CANCELLED')
  })
})
