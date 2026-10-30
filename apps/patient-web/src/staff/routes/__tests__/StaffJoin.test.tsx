import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

// Today's workspace at every facility, as real clinics have it until the clinic switch (ehr-blue/clinicSwitch.ts):
// these tests cover the classic portal whatever BLUE_FOR_ALL is. The blue one is EhrBlueAtClinics.test.tsx's.
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))

/**
 * Existing staff accept an invitation signed in on their own staff site (Novu, P4b SPEC 8.3). The email's link opens
 * /provider/staff/join#<id>.<token> there: the workspace takes the link out of the address before its sign-in gate
 * decides anything, keeps it through the sign-in, previews the invitation, accepts it, and switches to the facility.
 */
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const INVITATION = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const TOKEN = 'Abc_-0123456789abcdefghijklmnopqrstuvwxyzAB'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json' } })
const facility = (id: string, name: string, roles: string[], permissions: string[], isPrimary: boolean) => ({ id,
  membershipId: `member-${id}`, organizationId: `org-${id}`, name, roles, permissions, isPrimary })
const HOME = facility('facility-1', 'Lagos General', ['nurse'], ['identity.patient.read', 'ehr.encounter.read'], true)
const JOINED = facility('facility-2', 'Ikeja Care', ['nurse'], ['identity.patient.read', 'ehr.encounter.read'], false)
const session = (facilities: unknown[], current: unknown) => ({ actor: { kind: 'staff', id: 'staff-1', email: 'ngozi@example.test',
  displayName: 'Ngozi Okafor', roles: ['nurse'], permissions: [], facilities, facility: current }, expiresAt: '2026-10-25T20:00:00.000Z' })

interface Call { route: string; body: unknown; headers: Headers }

function serve({ signedIn = true, preview = json({ invitationId: INVITATION, facilityId: 'facility-2', facilityName: 'Ikeja Care',
  roleCode: 'nurse', inviterName: 'Bola Adewale', expiresAt: '2026-11-01T09:30:00.000Z' }) }: { signedIn?: boolean;
  preview?: Response | (() => Response) } = {}) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    calls.push({ route, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: new Headers(init?.headers) })
    if (route === 'GET /api/v1/auth/session') {
      return signedIn ? json(session([HOME], HOME)) : json({ status: 401, code: 'AUTHENTICATION_REQUIRED' }, 401)
    }
    if (route === 'POST /api/v1/auth/login') { signedIn = true; return json(session([HOME], HOME)) }
    if (route === 'POST /api/v1/auth/refresh') return json({ status: 401, code: 'AUTHENTICATION_REQUIRED' }, 401)
    if (route === 'POST /api/v1/identity/staff-invitations/signed-in/preview') return typeof preview === 'function' ? preview() : preview.clone()
    if (route === 'POST /api/v1/identity/staff-invitations/signed-in/accept') {
      return json({ accepted: true, facilityId: 'facility-2', membershipId: 'member-facility-2', facilityName: 'Ikeja Care', roleCode: 'nurse' })
    }
    if (route === 'POST /api/v1/auth/facility') return json(session([HOME, JOINED], JOINED))
    return json([])
  }))
  return calls
}

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.search}</output>
}

async function open(address: string) {
  window.history.replaceState(null, '', address)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[address.split('#')[0]!]}><Routes>
    <Route path="/provider/*" element={<><App /><Where /></>} />
  </Routes></MemoryRouter>)
}

beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  window.history.replaceState(null, '', '/')
})

describe('the link carried through a staff sign-in', () => {
  it('leaves the address before the gate sends a signed-out visit to sign in, which returns to the join page', async () => {
    serve({ signedIn: false })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/provider/staff/join')
    await waitFor(() => expect(screen.getByTestId('where').textContent)
      .toBe(`/provider/sign-in?returnTo=${encodeURIComponent('/provider/staff/join')}`))
    // Held in this page only: never in the return address, and never in browser storage.
    expect(screen.getByTestId('where').textContent).not.toContain(TOKEN)
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation()).toEqual({ invitationId: INVITATION, token: TOKEN })
    expect(window.sessionStorage.length).toBe(0)
    expect(window.localStorage.length).toBe(0)
  })

  it('is forgotten after 30 minutes', async () => {
    const { capturedStaffInvitation, captureStaffInvitationFragment } = await import('../../invitationCapture')
    window.history.replaceState(null, '', `/provider/staff/join#${INVITATION}.${TOKEN}`)
    const entries = window.history.length
    expect(captureStaffInvitationFragment(1_000)).toBe(true)
    // The link's entry is replaced, so Back never shows it in the address again.
    expect(window.history.length).toBe(entries)
    expect(window.location.hash).toBe('')
    expect(capturedStaffInvitation(1_000 + 29 * 60_000)).toEqual({ invitationId: INVITATION, token: TOKEN })
    expect(capturedStaffInvitation(1_000 + 30 * 60_000)).toBeNull()
    expect(capturedStaffInvitation(1_000)).toBeNull()
  })

  it('takes nothing from another page’s fragment, and strips a malformed one from the join page', async () => {
    const { capturedStaffInvitation, captureStaffInvitationFragment } = await import('../../invitationCapture')
    window.history.replaceState(null, '', `/provider/patients#${INVITATION}.${TOKEN}`)
    expect(captureStaffInvitationFragment()).toBe(false)
    expect(window.location.hash).toBe(`#${INVITATION}.${TOKEN}`)
    window.history.replaceState(null, '', '/provider/staff/join#not-a-link')
    expect(captureStaffInvitationFragment()).toBe(false)
    expect(window.location.hash).toBe('')
    expect(capturedStaffInvitation()).toBeNull()
  })

  it('is not taken, and the page is not routed, on a main-v1 build', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    serve()
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy()
    expect(window.location.hash).toBe(`#${INVITATION}.${TOKEN}`)
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation()).toBeNull()
  })
})

describe('joining signed in', () => {
  it('previews the invitation, accepts it, works at the facility joined, and says how to come back to it', async () => {
    const calls = serve()
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect(await screen.findByRole('heading', { name: 'Join Ikeja Care as a nurse' })).toBeTruthy()
    expect(screen.getByText(/^Bola Adewale, the facility administrator, invited you\./)).toBeTruthy()
    const preview = calls.find(call => call.route.endsWith('/signed-in/preview'))!
    expect(preview.body).toEqual({ invitationId: INVITATION, token: TOKEN })
    expect(preview.headers.has('x-facility-id')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect(await screen.findByRole('heading', { name: 'You’ve joined Ikeja Care' })).toBeTruthy()
    expect(screen.getByText(/^You’re now working at Ikeja Care as a nurse\./).textContent).toBe('You’re now working at Ikeja Care '
      + 'as a nurse. Next time you sign in, Health ID opens your main facility: switch to Ikeja Care from “Working at”.')
    expect(calls.filter(call => call.route.startsWith('POST')).map(call => [call.route, call.body])).toEqual([
      ['POST /api/v1/identity/staff-invitations/signed-in/preview', { invitationId: INVITATION, token: TOKEN }],
      ['POST /api/v1/identity/staff-invitations/signed-in/accept', { invitationId: INVITATION, token: TOKEN }],
      ['POST /api/v1/auth/facility', { facilityId: 'facility-2' }],
    ])
    expect((screen.getByLabelText('Working at') as HTMLSelectElement).value).toBe('facility-2')
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open Patient access' }))
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/patients'))
  })

  it('asks for the email’s code without a link, the email being the session’s own', async () => {
    const calls = serve()
    await open('/provider/staff/join')
    fireEvent.change(await screen.findByLabelText('Invitation code'), { target: { value: '12a3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the 6-digit code from the invitation email.')
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'Join Ikeja Care as a nurse' })).toBeTruthy()
    expect(calls.find(call => call.route.endsWith('/signed-in/preview'))!.body).toEqual({ code: '123456' })
  })

  it('keeps the link when the invitation is for another email, so another account can use it after signing in', async () => {
    serve({ preview: json({ status: 409, code: 'STAFF_INVITATION_EMAIL_MISMATCH' }, 409) })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation is for another email address. Sign in with the '
      + 'account for the invited email.')
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation()).toEqual({ invitationId: INVITATION, token: TOKEN })
  })

  it.each([
    ['STAFF_INVITATION_EXPIRED', 410, 'This invitation has expired. Ask the facility to send it again.'],
    ['STAFF_INVITATION_ALREADY_MEMBER', 409, 'You already work at the facility on Health ID.'],
    ['STAFF_INVITATION_ACCOUNT_UNAVAILABLE', 409, 'This account can’t join a facility by invitation. Contact Health ID support.'],
    ['STAFF_INVITATIONS_UNAVAILABLE', 423, 'Joining is paused by Health ID. Try again later.'],
  ])('says %s, and forgets a link that can never work', async (code, status, text) => {
    serve({ preview: json({ status, code }, status) })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation() === null).toBe(code !== 'STAFF_INVITATIONS_UNAVAILABLE')
  })

  it.each([
    ['no answer (the gateway’s 503)', 503, 'UPSTREAM_UNAVAILABLE', 'Joining a facility is temporarily unavailable. Please try again in a few minutes.'],
    ['joining paused', 423, 'STAFF_INVITATIONS_UNAVAILABLE', 'Joining is paused by Health ID. Try again later.'],
    ['too many tries from the network', 429, 'STAFF_INVITATION_RATE_LIMITED', 'Too many invitations have been opened from your network. Please try again in an hour.'],
    ['the account changed', 409, 'STAFF_INVITATION_ACCOUNT_CHANGED', 'Your Health ID account changed while you were joining. Open the invitation again from the email.'],
  ])('after %s, offers to try the held link again, which then previews it', async (_case, status, code, text) => {
    let answers = 0
    const calls = serve({ preview: () => (answers++ === 0 ? json({ status, code }, status) : json({ invitationId: INVITATION,
      facilityId: 'facility-2', facilityName: 'Ikeja Care', roleCode: 'nurse', inviterName: 'Bola Adewale',
      expiresAt: '2026-11-01T09:30:00.000Z' })) })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(screen.getByRole('button', { name: 'Use the code instead' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Join Ikeja Care as a nurse' })).toBeTruthy()
    expect(calls.filter(call => call.route.endsWith('/signed-in/preview')).map(call => call.body)).toEqual([
      { invitationId: INVITATION, token: TOKEN }, { invitationId: INVITATION, token: TOKEN }])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('lets the person use the email’s code instead of a held link that did not work, forgetting the link', async () => {
    serve({ preview: json({ status: 503, code: 'UPSTREAM_UNAVAILABLE' }, 503) })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Use the code instead' }))
    expect(await screen.findByLabelText('Invitation code')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    const { capturedStaffInvitation } = await import('../../invitationCapture')
    expect(capturedStaffInvitation()).toBeNull()
  })

  it('offers the code, not trying again, when the link is for another email', async () => {
    serve({ preview: json({ status: 409, code: 'STAFF_INVITATION_EMAIL_MISMATCH' }, 409) })
    await open(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Use the code instead' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
  })

  it('names the page in the tab', async () => {
    serve()
    await open('/provider/staff/join')
    await waitFor(() => expect(document.title).toBe('Join a facility · Health ID Provider'))
  })
})

/**
 * K2 (P4b SPEC 8.3): signed out on a staff product site, the workspace would send a sign-in back to the site's own
 * product page; on the join page it comes back to the join page, and the invitation is previewed there.
 */
describe('signed out on the EHR site', () => {
  const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
  const servedFrom = window.location.href
  afterEach(() => { jsdom.reconfigure({ url: servedFrom }) })

  it('signs in there and comes back to the join page, not the Clinical record, with the link still held', async () => {
    jsdom.reconfigure({ url: `https://ehr.healthidentitydirectory.com/provider/staff/join#${INVITATION}.${TOKEN}` })
    const calls = serve({ signedIn: false })
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/provider/staff/join']}><Routes>
      <Route path="/provider/*" element={<><App /><Where /></>} />
    </Routes></MemoryRouter>)
    expect(window.location.hash).toBe('')
    await waitFor(() => expect(screen.getByTestId('where').textContent)
      .toBe(`/provider/sign-in?returnTo=${encodeURIComponent('/provider/staff/join')}`))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'ngozi@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Join Ikeja Care as a nurse' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe('/provider/staff/join')
    expect(calls.find(call => call.route.endsWith('/signed-in/preview'))!.body).toEqual({ invitationId: INVITATION, token: TOKEN })
  })

  it('on a main-v1 build, sends the signed-out visit to sign in for the Clinical record', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    jsdom.reconfigure({ url: 'https://ehr.healthidentitydirectory.com/provider/staff/join' })
    serve({ signedIn: false })
    const { App } = await import('../../App')
    render(<MemoryRouter initialEntries={['/provider/staff/join']}><Routes>
      <Route path="/provider/*" element={<><App /><Where /></>} />
    </Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('where').textContent)
      .toBe(`/provider/sign-in?returnTo=${encodeURIComponent('/provider/clinical')}`))
  })
})
