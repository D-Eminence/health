import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

async function signedInStaffApi() {
  const { setStaffSessionReady } = await import('./session')
  setStaffSessionReady(true)
  return import('./api')
}

interface Recorded { url: URL; headers: Headers; method: string; body: unknown }

function recordFetch(...answers: Array<() => Response | Promise<Response>>) {
  const requests: Recorded[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    requests.push({ url: new URL(String(url)), headers: new Headers(init.headers), method: String(init.method),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const answer = answers.shift()
    if (!answer) throw new Error(`unexpected request ${String(url)}`)
    return answer()
  }))
  return requests
}

const problem = (status: number, code: string, detail: string, extra: Record<string, unknown> = {}) => () =>
  new Response(JSON.stringify({ status, code, detail, correlationId: `corr-${status}`, ...extra }),
    { status, headers: { 'Content-Type': 'application/problem+json' } })

const CHECK = {
  deskCode: '7K3M9Q2XWD',
  method: 'government_photo_id_in_person' as const,
  documentType: 'national_id_card' as const,
  document: { firstName: 'Synthetic-Ada', lastName: 'Okafor', dateOfBirth: '1990-04-02' },
  attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
    codeShownOnPatientsOwnDevice: true, patientConsents: true } as const,
}

/**
 * The staff in-person check of facility-assisted registration (hid-system main
 * f9dbaf0: #85, ADR-063; identity/assisted-verification.controller.ts and
 * dto/assisted-verification.dto.ts).
 */
describe('the staff in-person check request', () => {
  it('posts the check with the facility, healthcare-operations purpose, CSRF token and the submission key', async () => {
    document.cookie = 'hid_access_csrf=csrf-1'
    const requests = recordFetch(() => new Response(JSON.stringify({ outcome: 'verified' }), { status: 200 }))
    const { staffApi } = await signedInStaffApi()

    await expect(staffApi.assistedVerification('facility-1', CHECK, 'key-0001-0001-0001')).resolves.toEqual({ outcome: 'verified' })

    expect(requests).toHaveLength(1)
    const [sent] = requests
    expect(sent!.method).toBe('POST')
    expect(sent!.url.href).toBe('https://gateway.example.test/api/v1/identity/assisted-verifications')
    expect(sent!.body).toEqual(CHECK)
    expect(sent!.headers.get('x-facility-id')).toBe('facility-1')
    expect(sent!.headers.get('x-purpose-of-use')).toBe('healthcare-operations')
    expect(sent!.headers.get('idempotency-key')).toBe('key-0001-0001-0001')
    expect(sent!.headers.get('x-csrf-token')).toBe('csrf-1')
  })

  it('sends no date of birth when none was typed', async () => {
    const requests = recordFetch(() => new Response(JSON.stringify({ outcome: 'verified' }), { status: 200 }))
    const { staffApi } = await signedInStaffApi()
    const { dateOfBirth: _none, ...document } = CHECK.document
    await staffApi.assistedVerification('facility-1', { ...CHECK, document }, 'key-0002-0002-0002')
    expect((requests[0]!.body as typeof CHECK).document).toEqual({ firstName: 'Synthetic-Ada', lastName: 'Okafor' })
  })

  it('rejects a 422 with the per-field results and nothing else of the record', async () => {
    recordFetch(problem(422, 'ASSISTED_VERIFICATION_NOT_MATCHED', 'The details on the document do not match the NIN record.',
      { fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' } }))
    const { staffApi } = await signedInStaffApi()
    await expect(staffApi.assistedVerification('facility-1', CHECK, 'key-0003-0003-0003')).rejects.toMatchObject({
      status: 422, code: 'ASSISTED_VERIFICATION_NOT_MATCHED',
      fields: { firstName: 'match', lastName: 'no_match', dateOfBirth: 'not_in_record' } })
  })

  it.each([
    ['a 503', problem(503, 'ASSISTED_VERIFICATION_UNAVAILABLE', 'The in-person check could not be completed. Try again.')],
    ['the route switched off', problem(503, 'ASSISTED_REGISTRATION_DISABLED', 'Registration at a facility is not available.')],
    ['a refusal of the facility', problem(403, 'ASSISTED_REGISTRATION_NOT_AUTHORIZED', 'You cannot register patients in person at this facility.')],
    ['a missing permission', problem(403, 'PERMISSION_DENIED', 'Required permission is missing')],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('neither restores nor ends the session after %s', async (_label, answer) => {
    const requests = recordFetch(answer)
    const { staffApi } = await signedInStaffApi()
    const { staffSessionGeneration } = await import('./session')
    const generation = staffSessionGeneration()
    await expect(staffApi.assistedVerification('facility-1', CHECK, 'key-0004-0004-0004')).rejects.toBeTruthy()
    // One request: no refresh, no session read, no sign-out.
    expect(requests.map(request => request.url.pathname)).toEqual(['/api/v1/identity/assisted-verifications'])
    expect(staffSessionGeneration()).toBe(generation)
  })
})
