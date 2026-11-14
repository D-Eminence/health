import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Clinician self sign-up and its status page (hid-system ADR-066, branch
 * claude/clinician-self-signup), as the portal sends them. Every route is
 * public: the browser holds only the httpOnly capability cookie
 * hid_clinician_application (path /api/v1/identity/clinician-applications),
 * which it sends and the portal never reads. No call may restore or end a
 * staff session: a 401 here means only that the application page or step has
 * ended.
 */
vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

interface Sent { route: string; init: RequestInit }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const problem = (status: number, code: string, detail = code) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })

const BASE = '/api/v1/identity/clinician-applications'
const APPLICATION_ID = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const FACILITY_ID = '7c0d5b8e-4c1a-4f0e-9a51-0d6b2f7e9a10'
const view = { applicationId: APPLICATION_ID, state: 'submitted', version: 3, facility: { id: FACILITY_ID, name: 'Lagos General' },
  profession: 'doctor', regulator: { code: 'MDCN', name: 'Medical and Dental Council of Nigeria' }, licenceNumberHint: '2345',
  submittedAt: '2026-10-15T09:00:00.000Z', expiresAt: '2026-11-14T09:00:00.000Z', decidedAt: null, decisionCode: null,
  accessState: null, canWithdraw: true }
const account = { account: { email: 'ada@example.test', fullName: 'Ada Obi' }, stage: 'ready', applications: [view],
  canApply: true, applyRefusal: null }
const details = { profession: 'doctor', regulator: 'MDCN', licenceNumber: 'MDCN/12345', licenceValidUntil: '2027-06-30',
  facilityId: FACILITY_ID, declarations: { accurate: true, verificationConsent: true } } as const

/** Serves each `METHOD /path` from its own queue and records every request. */
function serve(routes: Record<string, Array<() => Response>>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const route = `${String(init.method)} ${new URL(String(url)).pathname}`
    sent.push({ route, init })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

const bodyOf = (call: Sent | undefined) => typeof call?.init.body === 'string' ? JSON.parse(call.init.body) : call?.init.body
const header = (call: Sent | undefined, name: string) => new Headers(call?.init.headers).get(name)

describe('the clinician application API', () => {
  it('sends each step to its registered route, with the bodies Identity reads', async () => {
    const sent = serve({
      [`GET ${BASE}/availability`]: [() => json({ open: true })],
      [`POST ${BASE}/email-code`]: [() => json({ accepted: true, challengeId: 'c1', expiresInSeconds: 600, resendAfterSeconds: 60 }, 202)],
      [`POST ${BASE}/email-code/verify`]: [() => json({ verified: true, expiresAt: '2026-10-15T10:00:00.000Z' })],
      [`POST ${BASE}/facility-search`]: [() => json({ facilities: [{ facilityId: FACILITY_ID, name: 'Lagos General', organizationName: 'LG Org' }] })],
      [`POST ${BASE}`]: [() => json({ applicationId: APPLICATION_ID, state: 'awaiting_authenticator', version: 1 }, 201)],
      [`POST ${BASE}/authenticator/email-code`]: [() => json({ accepted: true, channel: 'email', expiresAt: '2026-10-15T09:10:00.000Z' })],
      [`POST ${BASE}/authenticator/start`]: [() => json({ secret: 'S', otpauthUri: 'otpauth://totp/x', algorithm: 'SHA1', digits: 6,
        periodSeconds: 30, expiresAt: '2026-10-15T09:10:00.000Z' })],
      [`POST ${BASE}/authenticator/activate`]: [() => json({ recoveryCodes: ['A'], ...account })],
      [`POST ${BASE}/authenticator/verify`]: [() => json(account), () => json(account)],
      [`POST ${BASE}/authenticator/challenge`]: [() => json({ purpose: 'enroll', expiresAt: '2026-10-15T09:10:00.000Z' })],
      [`POST ${BASE}/status/email-code`]: [() => json({ accepted: true, challengeId: 'c2', expiresInSeconds: 600, resendAfterSeconds: 60 }, 202)],
      [`POST ${BASE}/status/email-code/verify`]: [() => json({ next: 'authenticator_verify', expiresAt: '2026-10-15T09:30:00.000Z' })],
      [`GET ${BASE}/current`]: [() => json(account)],
      [`POST ${BASE}/${APPLICATION_ID}/withdraw`]: [() => json({ ...view, state: 'withdrawn', version: 4, canWithdraw: false })],
      [`POST ${BASE}/current/applications`]: [() => json({ ...view, replayed: false }, 201)],
      [`POST ${BASE}/session/end`]: [() => new Response(null, { status: 204 })],
    })
    const { clinicianApplicationApi: api } = await import('./clinicianApplicationApi')

    await expect(api.availability()).resolves.toEqual({ open: true })
    await api.sendCode('ada@example.test', 'turnstile-1')
    await api.verifyCode('c1', 'ada@example.test', '123456')
    await expect(api.searchFacilities('Lagos')).resolves.toEqual([{ facilityId: FACILITY_ID, name: 'Lagos General', organizationName: 'LG Org' }])
    await api.submit({ ...details, email: 'ada@example.test', fullName: 'Ada Obi', password: 'a-long-enough-password' }, 'key-submit-0001')
    await api.authenticator.sendEmailCode()
    await api.authenticator.start('654321')
    await api.authenticator.activate('112233')
    await api.authenticator.verify({ code: '445566' })
    await api.authenticator.verify({ recoveryCode: 'ABCDE-FGHJK' })
    await api.authenticator.reopen()
    await api.sendStatusCode('ada@example.test', 'turnstile-2')
    await api.verifyStatusCode('c2', 'ada@example.test', '778899')
    await expect(api.current()).resolves.toEqual(account)
    await api.withdraw(view)
    await api.apply(details, 'key-apply-00001')
    await api.endSession()

    expect(sent.map(call => call.route)).toEqual([
      `GET ${BASE}/availability`, `POST ${BASE}/email-code`, `POST ${BASE}/email-code/verify`, `POST ${BASE}/facility-search`,
      `POST ${BASE}`, `POST ${BASE}/authenticator/email-code`, `POST ${BASE}/authenticator/start`,
      `POST ${BASE}/authenticator/activate`, `POST ${BASE}/authenticator/verify`, `POST ${BASE}/authenticator/verify`,
      `POST ${BASE}/authenticator/challenge`, `POST ${BASE}/status/email-code`, `POST ${BASE}/status/email-code/verify`,
      `GET ${BASE}/current`, `POST ${BASE}/${APPLICATION_ID}/withdraw`, `POST ${BASE}/current/applications`, `POST ${BASE}/session/end`,
    ])
    const bodies = sent.map(bodyOf)
    expect(bodies).toEqual([
      undefined,
      { email: 'ada@example.test', turnstileAction: 'clinician-application', turnstileToken: 'turnstile-1' },
      { challengeId: 'c1', email: 'ada@example.test', code: '123456' },
      { query: 'Lagos' },
      { ...details, email: 'ada@example.test', fullName: 'Ada Obi', password: 'a-long-enough-password' },
      undefined,
      { emailCode: '654321' },
      { code: '112233' },
      { code: '445566' },
      { recoveryCode: 'ABCDE-FGHJK' },
      undefined,
      { email: 'ada@example.test', turnstileAction: 'clinician-application-status', turnstileToken: 'turnstile-2' },
      { challengeId: 'c2', email: 'ada@example.test', code: '778899' },
      undefined,
      undefined,
      details,
      undefined,
    ])
    // The capability is an httpOnly cookie the browser sends; nothing identifying is in a URL or a header of the portal's own.
    for (const call of sent) {
      expect(call.init.credentials).toBe('include')
      expect(header(call, 'authorization')).toBeNull()
      expect(header(call, 'x-hid-client')).toBeNull()
      expect(call.route).not.toMatch(/ada|example|Lagos|12345/i)
    }
    expect(header(sent[4], 'idempotency-key')).toBe('key-submit-0001')
    expect(header(sent[15], 'idempotency-key')).toBe('key-apply-00001')
    // The version the page showed, as Identity's If-Match reads it.
    expect(header(sent[14], 'if-match')).toBe('"3"')
    expect(sent.filter(call => header(call, 'idempotency-key') !== null)).toHaveLength(2)
    expect(sent.filter(call => header(call, 'if-match') !== null)).toHaveLength(1)
  })

  it('treats any availability answer but { open: true } as not open', async () => {
    serve({ [`GET ${BASE}/availability`]: [() => json({ open: 'true' }), () => json({}), () => json({ open: false })] })
    const { clinicianApplicationApi: api } = await import('./clinicianApplicationApi')
    await expect(api.availability()).resolves.toEqual({ open: false })
    await expect(api.availability()).resolves.toEqual({ open: false })
    await expect(api.availability()).resolves.toEqual({ open: false })
  })

  it('never restores, ends or asks about a staff session when a step answers 401', async () => {
    const sent = serve({
      [`GET ${BASE}/current`]: [() => problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID')],
      [`POST ${BASE}/authenticator/verify`]: [() => problem(401, 'MFA_INVALID_CODE')],
      [`POST ${BASE}/facility-search`]: [() => problem(401, 'CLINICIAN_APPLICATION_SESSION_INVALID')],
    })
    const { clinicianApplicationApi: api } = await import('./clinicianApplicationApi')

    await expect(api.current()).rejects.toMatchObject({ status: 401, code: 'CLINICIAN_APPLICATION_SESSION_INVALID' })
    await expect(api.authenticator.verify({ code: '123456' })).rejects.toMatchObject({ status: 401, code: 'MFA_INVALID_CODE' })
    await expect(api.searchFacilities('Lagos')).rejects.toMatchObject({ code: 'CLINICIAN_APPLICATION_SESSION_INVALID' })
    expect(sent.map(call => call.route)).toEqual([`GET ${BASE}/current`, `POST ${BASE}/authenticator/verify`, `POST ${BASE}/facility-search`])
  })

  it('sends a command once, whatever it answers: the page decides whether to send it again', async () => {
    const sent = serve({
      [`POST ${BASE}`]: [() => problem(503, 'CLINICIAN_APPLICATION_UNAVAILABLE')],
      [`POST ${BASE}/current/applications`]: [() => problem(503, 'PLATFORM_MAINTENANCE')],
    })
    const { clinicianApplicationApi: api } = await import('./clinicianApplicationApi')
    await expect(api.submit({ ...details, email: 'ada@example.test', fullName: 'Ada Obi', password: 'a-long-enough-password' }, 'key-1-abcdefghijk'))
      .rejects.toMatchObject({ status: 503, code: 'CLINICIAN_APPLICATION_UNAVAILABLE' })
    await expect(api.apply(details, 'key-2-abcdefghijk')).rejects.toMatchObject({ status: 503, code: 'PLATFORM_MAINTENANCE' })
    expect(sent).toHaveLength(2)
  })

  it('makes a new idempotency key for each submission', async () => {
    const { newClinicianIdempotencyKey } = await import('./clinicianApplicationApi')
    const first = newClinicianIdempotencyKey()
    const second = newClinicianIdempotencyKey()
    expect(first).not.toBe(second)
    // Identity takes 16 to 128 URL-safe characters.
    expect(first).toMatch(/^[A-Za-z0-9_-]{16,128}$/)
  })

  it('names the path of the application withdrawn, encoded', async () => {
    const sent = serve({ [`POST ${BASE}/${APPLICATION_ID}/withdraw`]: [() => json(view)] })
    const { clinicianApplicationApi: api } = await import('./clinicianApplicationApi')
    await api.withdraw({ applicationId: APPLICATION_ID, version: 12 })
    expect(header(sent[0], 'if-match')).toBe('"12"')
    await expect(api.withdraw({ applicationId: '../current', version: 1 })).rejects.toThrow()
    expect(sent).toHaveLength(1)
  })
})
