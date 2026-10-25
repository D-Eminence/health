import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage } from '../routes/Portal'

/**
 * A patient's own access-request list, approval and denial are patient commands
 * bound to the patient session (hid-system consent.controller.ts: @PatientAllowed,
 * @FacilityOptional, no consentContext). They carry no purpose of use: Identity's
 * audit interceptor records an `X-Purpose-Of-Use` header as the request's purpose,
 * so sending `direct-care` labelled the patient's own decision as clinical care.
 */
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

interface Sent { path: string; method: string; body: unknown; headers: Headers }

function client(handler: (path: string, method: string) => Response) {
  const sent: Sent[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname
    const method = init?.method ?? 'GET'
    sent.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) as unknown : null, headers: new Headers(init?.headers) })
    return handler(path, method)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  return { api, sent }
}

const REQUEST_ID = '70000000-0000-4000-8000-000000000001'
const pending: AccessRequest = {
  accessRequestId: REQUEST_ID, facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
}

function renderAccess(decided: () => AccessRequest) {
  let answered: AccessRequest = pending
  const { api, sent } = client((path, method) => {
    if (path.endsWith('/me/access-requests')) return json([answered])
    if (path.endsWith('/me/access-history')) return json({ items: [] })
    if (method === 'POST') { answered = decided(); return json({ accessRequestId: REQUEST_ID, status: answered.status, replayed: false }) }
    return json({}, 404)
  })
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><AccessPage /></SessionContext.Provider></MemoryRouter>)
  return sent
}

const reads = (sent: Sent[], suffix: string) => sent.filter(request => request.method === 'GET' && request.path.endsWith(suffix)).length

describe('patient access-request commands', () => {
  it('sends no purpose of use on the list, approve and deny calls', async () => {
    const { api, sent } = client(path => path.endsWith('/me/access-requests') ? json([]) : json({ accessRequestId: REQUEST_ID }))
    await api.accessRequests()
    await api.approveAccess(REQUEST_ID)
    await api.denyAccess(REQUEST_ID, 'Not my clinic')
    expect(sent.map(request => `${request.method} ${request.path}`)).toEqual([
      'GET /api/v1/identity/me/access-requests',
      `POST /api/v1/identity/access-requests/${REQUEST_ID}/approve`,
      `POST /api/v1/identity/access-requests/${REQUEST_ID}/deny`,
    ])
    for (const request of sent) expect(request.headers.has('X-Purpose-Of-Use')).toBe(false)
  })

  it('approves a pending request through the patient route, then reloads the requests and the history', async () => {
    const sent = renderAccess(() => ({ ...pending, status: 'approved', approvedAt: '2026-10-08T10:05:00Z' }))
    const item = (await screen.findByText('Lagos General')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: /^Approve/ }))

    expect(await screen.findByText('Request approved.')).toBeTruthy()
    const approve = sent.find(request => request.method === 'POST')!
    expect(approve.path).toBe(`/api/v1/identity/access-requests/${REQUEST_ID}/approve`)
    expect(approve.headers.has('X-Purpose-Of-Use')).toBe(false)
    await waitFor(() => expect(reads(sent, '/me/access-requests')).toBe(2))
    expect(reads(sent, '/me/access-history')).toBe(2)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull())
  })

  // P4c review (Identity, as main): approving needs a sign-in within 10 minutes and no OTP account recovery in the last
  // 24 hours. The page says Identity's own words, and the request stays pending with Approve and Deny still offered.
  it.each([
    ['PATIENT_RECENT_AUTH_REQUIRED', 'For your security, sign out, sign in again, and approve within 10 minutes.'],
    ['PATIENT_RECENT_RECOVERY_HOLD', 'This account was recovered with a verification code less than 24 hours ago; new access '
      + 'approvals are available again once that period ends'],
  ])('says why Identity refused an approval (%s), and keeps the request pending', async (code, detail) => {
    const { api, sent } = client((path, method) => {
      if (path.endsWith('/me/access-requests')) return json([pending])
      if (path.endsWith('/me/access-history')) return json({ items: [] })
      if (method === 'POST') return json({ status: 403, code, detail }, 403)
      return json({}, 404)
    })
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
      kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
    }, api)}><AccessPage /></SessionContext.Provider></MemoryRouter>)
    const item = (await screen.findByText('Lagos General')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: /^Approve/ }))
    expect(await screen.findByText(detail)).toBeTruthy()
    expect(screen.queryByText('Request approved.')).toBeNull()
    expect(sent.filter(request => request.method === 'POST')).toHaveLength(1)
    expect(within(item).getByRole('button', { name: /^Approve/ })).toBeTruthy()
    expect(within(item).getByRole('button', { name: /^Deny/ })).toBeTruthy()
  })

  it('denies only with a reason of at least 3 characters, and sends that reason', async () => {
    const sent = renderAccess(() => ({ ...pending, status: 'denied', deniedAt: '2026-10-08T10:05:00Z', deniedReason: 'Not my clinic' }))
    const item = (await screen.findByText('Lagos General')).closest('li')!
    fireEvent.click(within(item).getByRole('button', { name: /^Deny/ }))
    const reason = screen.getByRole('textbox', { name: 'Reason for denial' })
    const confirm = screen.getByRole('button', { name: 'Confirm denial' }) as HTMLButtonElement
    fireEvent.change(reason, { target: { value: ' No ' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(reason, { target: { value: ' Not my clinic ' } })
    fireEvent.click(confirm)

    expect(await screen.findByText('Request denied.')).toBeTruthy()
    const deny = sent.find(request => request.method === 'POST')!
    expect(deny.path).toBe(`/api/v1/identity/access-requests/${REQUEST_ID}/deny`)
    expect(deny.body).toEqual({ reason: 'Not my clinic' })
    expect(deny.headers.has('X-Purpose-Of-Use')).toBe(false)
    await waitFor(() => expect(reads(sent, '/me/access-requests')).toBe(2))
    expect(reads(sent, '/me/access-history')).toBe(2)
  })
})
