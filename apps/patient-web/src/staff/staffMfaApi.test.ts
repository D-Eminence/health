import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as ApiModule from './api'

/**
 * The second steps of staff sign-in (hid-system #71, ADR-054, 0088), as the
 * staff API sends them. Each needs Origin and the httpOnly challenge cookie
 * hid_access_mfa (path /api/v1/auth/mfa), which the browser sends and the portal
 * never reads, and no Turnstile, CSRF or session. Verify and activation set the
 * session cookies; the email code and enrolment start set none.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); Reflect.deleteProperty(navigator, 'locks') })

interface Sent { route: string; init: RequestInit }
type StaffApi = typeof ApiModule.staffApi

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })
const facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Lagos General', roles: ['doctor'],
  permissions: [], isPrimary: true }
const session = { actor: { id: 'staff-1', subject: 'staff-1', accountId: 'account-1', roles: ['doctor'], permissions: [],
  facilities: [facility], facility }, expiresAt: '2026-10-14T12:00:00.000Z', facilitySelection: 'default' }
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const enrollment = { secret: SECRET, otpauthUri: `otpauth://totp/Health%20ID:ada%40example.test?secret=${SECRET}&issuer=Health%20ID`,
  algorithm: 'SHA1', digits: 6, periodSeconds: 30, expiresAt: '2026-10-14T09:10:00.000Z' }
const RECOVERY_CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX']

const VERIFY = 'POST /api/v1/auth/mfa/verify'
const EMAIL_CODE = 'POST /api/v1/auth/mfa/enroll/email-code'
const START = 'POST /api/v1/auth/mfa/enroll/start'
const ACTIVATE = 'POST /api/v1/auth/mfa/enroll/activate'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGOUT = 'POST /api/v1/auth/logout'

/** Serves each `METHOD /path` from its own queue and records every request. */
function serve(routes: Record<string, Array<() => Response | Promise<Response>>>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    sent.push({ route, init })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

const routes = (sent: Sent[]) => sent.map(call => call.route)
const body = (sent: Sent[], route: string) => sent.find(call => call.route === route)?.init.body

describe('the staff MFA steps', () => {
  it('verify an authenticator code and answer with the staff session', async () => {
    const sent = serve({ [VERIFY]: [() => json(session)] })
    const { staffApi } = await import('./api')

    await expect(staffApi.verifyMfa({ code: '123456' })).resolves.toEqual(session)
    expect(routes(sent)).toEqual([VERIFY])
    expect(JSON.parse(String(body(sent, VERIFY)))).toEqual({ code: '123456' })
    const { init } = sent[0]!
    expect(init.credentials).toBe('include')
    // The steps name no client: only refresh and sign-out do (hid-system #39).
    expect(new Headers(init.headers).has('X-HID-Client')).toBe(false)
  })

  it('verify one recovery code instead', async () => {
    const sent = serve({ [VERIFY]: [() => json(session)] })
    const { staffApi } = await import('./api')

    await staffApi.verifyMfa({ recoveryCode: 'ABCDE-FGHJK' })
    expect(JSON.parse(String(body(sent, VERIFY)))).toEqual({ recoveryCode: 'ABCDE-FGHJK' })
  })

  it('ask for the enrolment email code with no body', async () => {
    const sent = serve({ [EMAIL_CODE]: [() => json({ accepted: true, channel: 'email', expiresAt: '2026-10-14T09:10:00.000Z' })] })
    const { staffApi } = await import('./api')

    await expect(staffApi.sendEnrollmentCode()).resolves.toEqual({ accepted: true, channel: 'email', expiresAt: '2026-10-14T09:10:00.000Z' })
    expect(routes(sent)).toEqual([EMAIL_CODE])
    expect(body(sent, EMAIL_CODE)).toBeUndefined()
    expect(sent[0]!.init.credentials).toBe('include')
  })

  it('start enrolment with the emailed code, or with none after provider activation', async () => {
    const sent = serve({ [START]: [() => json(enrollment), () => json(enrollment)] })
    const { staffApi } = await import('./api')

    await expect(staffApi.startEnrollment('654321')).resolves.toEqual(enrollment)
    await staffApi.startEnrollment()
    expect(routes(sent)).toEqual([START, START])
    expect(sent.map(call => JSON.parse(String(call.init.body)))).toEqual([{ emailCode: '654321' }, {}])
  })

  it('activate the authenticator with its first code and answer with the session and the recovery codes', async () => {
    const sent = serve({ [ACTIVATE]: [() => json({ ...session, recoveryCodes: RECOVERY_CODES })] })
    const { staffApi } = await import('./api')

    await expect(staffApi.activateEnrollment('123456')).resolves.toEqual({ ...session, recoveryCodes: RECOVERY_CODES })
    expect(JSON.parse(String(body(sent, ACTIVATE)))).toEqual({ code: '123456' })
    expect(sent[0]!.init.credentials).toBe('include')
  })

  // A 401 at these steps is about the code or the challenge, never the session: nothing restores or ends one.
  it.each([
    ['verify', 'MFA_INVALID_CODE', VERIFY, (api: StaffApi) => api.verifyMfa({ code: '123456' })],
    ['the email code', 'MFA_CHALLENGE_INVALID', EMAIL_CODE, (api: StaffApi) => api.sendEnrollmentCode()],
    ['enrolment start', 'MFA_INVALID_CODE', START, (api: StaffApi) => api.startEnrollment('123456')],
    ['activation', 'MFA_INVALID_CODE', ACTIVATE, (api: StaffApi) => api.activateEnrollment('123456')],
  ])('pass a 401 at %s (%s) back as it is, with no refresh and no session end', async (_label, code, route, step) => {
    const sent = serve({ [route]: [() => problem(401, code)] })
    const sessions = await import('./session')
    const { staffApi } = await import('./api')
    sessions.setStaffSessionActor('staff-0')
    const ended = vi.fn()
    sessions.onStaffSessionEnded(ended)

    const refused = await step(staffApi).catch((error: unknown) => error)
    // The module graph is loaded afresh, so the error is matched by name, not class.
    expect(refused).toMatchObject({ name: 'HidApiError', status: 401, code })
    expect(routes(sent)).toEqual([route])
    expect(routes(sent)).not.toContain(REFRESH)
    expect(ended).not.toHaveBeenCalled()
  })
})

/** Another window of the portal holding the session turn until released. */
function turnHeldElsewhere() {
  let release: () => void = () => {}
  const held = new Promise<void>(done => { release = done })
  const request = vi.fn(async (_name: string, ...rest: unknown[]) => {
    const callback = rest.at(-1) as (lock: object | null) => Promise<unknown>
    const options = rest.length > 1 ? rest[0] as { ifAvailable?: boolean } : {}
    if (options.ifAvailable) return callback(null)
    await held
    return callback({})
  })
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true })
  return { release }
}

describe('the MFA steps that set the session cookies', () => {
  it.each([
    ['verify', VERIFY, () => json(session), (api: StaffApi) => api.verifyMfa({ code: '123456' })],
    ['activation', ACTIVATE, () => json({ ...session, recoveryCodes: RECOVERY_CODES }),
      (api: StaffApi) => api.activateEnrollment('123456')],
  ])('send %s only once another window\'s refresh has answered, whose cookies would replace the new session\'s', async (_label, route, answer, step) => {
    const other = turnHeldElsewhere()
    const sent = serve({ [route]: [answer] })
    const { staffApi } = await import('./api')

    const signingIn = step(staffApi)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(routes(sent)).toEqual([])
    other.release()

    await signingIn
    expect(routes(sent)).toEqual([route])
  })

  it.each([
    ['verify', VERIFY, () => json(session), (api: StaffApi) => api.verifyMfa({ code: '123456' })],
    ['activation', ACTIVATE, () => json({ ...session, recoveryCodes: RECOVERY_CODES }),
      (api: StaffApi) => api.activateEnrollment('123456')],
  ])('send %s only once a sign-out in progress has answered, whose answer clears the session cookies', async (_label, route, answer, step) => {
    let signOutAnswers: (response: Response) => void = () => {}
    const sent = serve({ [LOGOUT]: [() => new Promise<Response>(resolve => { signOutAnswers = resolve })], [route]: [answer] })
    const sessions = await import('./session')
    const { staffApi } = await import('./api')
    sessions.setStaffSessionActor('staff-0')

    const signingOut = staffApi.logout()
    await new Promise(resolve => setTimeout(resolve, 0))
    const signingIn = step(staffApi)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(routes(sent)).toEqual([LOGOUT])
    signOutAnswers(new Response(null, { status: 204 }))

    await Promise.all([signingOut, signingIn])
    expect(routes(sent)).toEqual([LOGOUT, route])
  })

  it.each([
    ['the email code', EMAIL_CODE, () => json({ accepted: true, channel: 'email', expiresAt: '2026-10-14T09:10:00.000Z' }),
      (api: StaffApi) => api.sendEnrollmentCode()],
    ['enrolment start', START, () => json(enrollment), (api: StaffApi) => api.startEnrollment('654321')],
  ])('send %s at once: it sets no session cookie for another window\'s refresh to replace', async (_label, route, answer, step) => {
    turnHeldElsewhere()
    const sent = serve({ [route]: [answer] })
    const { staffApi } = await import('./api')

    await step(staffApi)
    expect(routes(sent)).toEqual([route])
  })
})
