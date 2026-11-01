import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage } from '../routes/Portal'
import { ToastProvider } from '../kasuwa/toast'
import { described } from './portalHarness'

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
  }, api)}><ToastProvider><AccessPage /></ToastProvider></SessionContext.Provider></MemoryRouter>)
  return sent
}

/** Opens the request from Lagos General in its drawer, as the patient does with its row; returns the drawer. */
async function review() {
  fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
  return within(screen.getByRole('dialog', { name: 'Lagos General' }))
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
    const drawer = await review()
    // Approve and Deny side by side, equally easy.
    expect(drawer.getByRole('button', { name: /^Deny/ })).toBeTruthy()
    fireEvent.click(drawer.getByRole('button', { name: /^Approve/ }))

    expect(await screen.findByText('Lagos General can see your records now.')).toBeTruthy()
    const approve = sent.find(request => request.method === 'POST')!
    expect(approve.path).toBe(`/api/v1/identity/access-requests/${REQUEST_ID}/approve`)
    expect(approve.headers.has('X-Purpose-Of-Use')).toBe(false)
    expect(sent.filter(request => request.method === 'POST')).toHaveLength(1)
    await waitFor(() => expect(reads(sent, '/me/access-requests')).toBe(2))
    expect(reads(sent, '/me/access-history')).toBe(2)
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull())
    // Focus goes to the requests' heading, which now says nothing waits.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Nothing waiting for you' })))
  })

  // P4c review (Identity, as main): approving needs a sign-in within 10 minutes and no OTP account recovery in the last
  // 24 hours. The page says it in plain words (never Identity's), and the request stays pending with Approve and Deny still offered.
  it.each([
    ['PATIENT_RECENT_AUTH_REQUIRED', 'For your security, sign out, sign in again, and approve within 10 minutes.',
      'For your safety, sign out, sign in again, then come back within 10 minutes.'],
    ['PATIENT_RECENT_RECOVERY_HOLD', 'This account was recovered with a verification code less than 24 hours ago; new access '
      + 'approvals are available again once that period ends', 'For your safety, this isn’t available for 24 hours after you recover your account.'],
  ])('says why Identity refused an approval (%s), and keeps the request pending', async (code, detail, said) => {
    const { api, sent } = client((path, method) => {
      if (path.endsWith('/me/access-requests')) return json([pending])
      if (path.endsWith('/me/access-history')) return json({ items: [] })
      if (method === 'POST') return json({ status: 403, code, detail }, 403)
      return json({}, 404)
    })
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
      kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
    }, api)}><ToastProvider><AccessPage /></ToastProvider></SessionContext.Provider></MemoryRouter>)
    const drawer = await review()
    // Pressed as a keyboard user does: focused, then activated (it is disabled while the request runs).
    const approve = drawer.getByRole('button', { name: /^Approve/ })
    approve.focus()
    fireEvent.click(approve)
    expect((await screen.findByRole('alert')).textContent).toContain(said)
    expect(screen.getByRole('alert').textContent).not.toContain(detail)
    expect(screen.queryByText('Lagos General can see your records now.')).toBeNull()
    expect(sent.filter(request => request.method === 'POST')).toHaveLength(1)
    // Still pending: the drawer stays with Approve and Deny, and focus is back on Approve.
    await waitFor(() => expect(document.activeElement).toBe(drawer.getByRole('button', { name: /^Approve/ })))
    expect(drawer.getByRole('button', { name: /^Deny/ })).toBeTruthy()
  })

  it('denies only with a reason of at least 3 characters, and sends that reason', async () => {
    const sent = renderAccess(() => ({ ...pending, status: 'denied', deniedAt: '2026-10-08T10:05:00Z', deniedReason: 'Not my clinic' }))
    const drawer = await review()
    fireEvent.click(drawer.getByRole('button', { name: /^Deny/ }))
    // A quick reason is chosen already, one tap away; "Other" asks for the patient's own words.
    expect((drawer.getByRole('radio', { name: 'I don’t know them' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(drawer.getByRole('radio', { name: 'Other…' }))
    const reason = drawer.getByRole('textbox', { name: 'Your reason' })
    const confirm = drawer.getByRole('button', { name: 'Deny' })
    fireEvent.change(reason, { target: { value: ' No ' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(described(reason)).toContain('Say why in a few words.')
    expect(sent.some(request => request.method === 'POST')).toBe(false)
    fireEvent.change(reason, { target: { value: ' Not my clinic ' } })
    fireEvent.click(confirm)

    expect(await screen.findByText('Nothing was shared with Lagos General.')).toBeTruthy()
    const deny = sent.find(request => request.method === 'POST')!
    expect(deny.path).toBe(`/api/v1/identity/access-requests/${REQUEST_ID}/deny`)
    expect(deny.body).toEqual({ reason: 'Not my clinic' })
    expect(deny.headers.has('X-Purpose-Of-Use')).toBe(false)
    await waitFor(() => expect(reads(sent, '/me/access-requests')).toBe(2))
    expect(reads(sent, '/me/access-history')).toBe(2)
  })

  it('denies with a quick reason in one tap, sending its words', async () => {
    const sent = renderAccess(() => ({ ...pending, status: 'denied', deniedAt: '2026-10-08T10:05:00Z', deniedReason: 'Not now' }))
    const drawer = await review()
    fireEvent.click(drawer.getByRole('button', { name: /^Deny/ }))
    fireEvent.click(drawer.getByRole('radio', { name: 'Not now' }))
    fireEvent.click(drawer.getByRole('button', { name: 'Deny' }))
    expect(await screen.findByText('Nothing was shared with Lagos General.')).toBeTruthy()
    expect(sent.filter(request => request.method === 'POST').map(request => request.body)).toEqual([{ reason: 'Not now' }])
  })
})
