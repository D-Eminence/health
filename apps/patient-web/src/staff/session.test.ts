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

describe('a refusal that ends the staff session', () => {
  const refusal = async (status: number, code: string) => {
    const { HidApiError } = await import('@hid/http')
    return new HidApiError(status, 'detail', { code })
  }

  it('is a 401, or a 403 STAFF_MFA_REQUIRED for a sign-in made without an authenticator; no other 403 or 503', async () => {
    const session = await import('./session')
    expect(session.endsStaffSession(await refusal(401, 'AUTHENTICATION_REQUIRED'))).toBe(true)
    expect(session.endsStaffSession(await refusal(403, 'STAFF_MFA_REQUIRED'))).toBe(true)
    for (const code of ['FORBIDDEN', 'PATIENT_SCOPE_DENIED', 'FACILITY_ACCESS_DENIED', 'STAFF_MFA_FACTOR_UNPROVEN', 'CSRF_VALIDATION_FAILED']) {
      expect(session.endsStaffSession(await refusal(403, code)), code).toBe(false)
    }
    expect(session.endsStaffSession(await refusal(503, 'STAFF_MFA_REQUIRED'))).toBe(false)
    expect(session.endsStaffSession(new Error('STAFF_MFA_REQUIRED'))).toBe(false)
  })

  it('names why for the session it was heard in, until that session is read as accepted again', async () => {
    const session = await import('./session')
    session.startStaffSessionGeneration()
    const sentIn = session.staffSessionGeneration()
    session.noteStaffSessionRefusal(await refusal(401, 'AUTHENTICATION_REQUIRED'), sentIn)
    expect(session.staffSessionEndReason(sentIn)).toBeUndefined()
    session.noteStaffSessionRefusal(await refusal(403, 'STAFF_MFA_REQUIRED'), sentIn)
    expect(session.staffSessionEndReason(sentIn)).toBe('mfa-required')
    expect(session.staffSessionEndReason(sentIn + 1)).toBeUndefined()
    // A read of another session leaves it; a read of this one, accepted, clears it.
    session.reportStaffSessionRead({ actor: { id: 'staff-1', roles: [], permissions: [], facilities: [] } }, sentIn - 1)
    expect(session.staffSessionEndReason(sentIn)).toBe('mfa-required')
    session.reportStaffSessionRead({ actor: { id: 'staff-1', roles: [], permissions: [], facilities: [] } }, sentIn)
    expect(session.staffSessionEndReason(sentIn)).toBeUndefined()
  })
})

/** The pages a staff sign-in may return to: Novu adds the Staff page and the signed-in join page (P4b). */
describe('the return address of a staff sign-in', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it.each([
    ['novu-v1', '/provider/staff', '/provider/sign-in?returnTo=%2Fprovider%2Fstaff'],
    ['novu-v1', '/provider/staff/join', '/provider/sign-in?returnTo=%2Fprovider%2Fstaff%2Fjoin'],
    ['main-v1', '/provider/staff', '/provider/sign-in'],
    ['main-v1', '/provider/staff/join', '/provider/sign-in'],
  ])('on a %s build, %s signs in at %s', async (contract, page, signIn) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    const { staffReturnPath, staffSignInPath } = await import('./session')
    expect(staffSignInPath(page)).toBe(signIn)
    expect(staffReturnPath(page)).toBe(contract === 'novu-v1' ? page : null)
  })

  it.each(['/provider/staff/', '/provider/staff/join/', '/provider/staff/join#id.token', '/provider/staff?view=all',
    '/provider/staffx', '/provider/invitation'])('keeps nothing of %s on Novu', async page => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { staffReturnPath } = await import('./session')
    expect(staffReturnPath(page)).toBeNull()
  })
})
