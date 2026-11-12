import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncExternalStore, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { PATIENT_ROUTE, type AuthPrincipal } from '@hid/auth'
import { RequireAccess } from '../RequireAccess'
import type { AccessHistory, AccessRequest, PatientOrderRoute } from '../api'
import type { AccessLogEvent } from '../accessLog'
import type { ShareInvitation, ShareProvider } from '../shareRecords'
import { AccessPage } from '../routes/Portal'
import { ShareRecords, shareProblem } from '../routes/ShareRecords'
import { eventSentence } from '../routes/AccessLog'
import { patientRouteState, sentFields } from '../routes/SentOrders'
import { recentActivity } from '../routes/Overview'
import { SignIn } from '../routes/SignIn'
import { safeReturnPath } from '../returnPath'
import { purposeLabel } from '../routes/whoHasAccess'
import { LEGACY_PATIENT_PATHS } from '../legacyPaths'
import { ToastProvider } from '../kasuwa/toast'
import { forgetShareServed } from '../shareServed'
import { createTestSessionValue, SessionContext } from '../session'
import { json, patientApi, press, problem, profile, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

/**
 * Access & sharing before a full launch (launch audit, sharing and access, SA-02 to SA-23): what a patient sees while a
 * list loads or fails, after a refusal, on a phone and with a keyboard, in plain words. Fictional data only.
 */
vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
beforeEach(() => { forgetShareServed() })
afterEach(() => { vi.unstubAllEnvs() })

const REQUESTS = '/identity/me/access-requests'
const HISTORY = '/identity/me/access-history'
const INVITATIONS = '/identity/me/share-invitations'
const LOG = '/identity/me/access-log'
const LIMITS = { maxOpen: 20, maxNewPerDay: 5, remainingToday: 4 }
const REQUEST_ID = '70000000-0000-4000-8000-000000000001'
const pending: AccessRequest = {
  accessRequestId: REQUEST_ID, facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
}
type Grant = AccessHistory['items'][number]
const grant = (id: string, extra: Partial<Grant> = {}): Grant => ({ consentGrantId: id, scope: 'read_records', purpose: 'direct-care',
  status: 'active', startsAt: '2026-10-28T10:00:00Z', expiresAt: '2027-10-28T10:00:00Z', reason: null, facilityName: 'Lagos General',
  patientRevocable: true, ...extra })
const invitation = (overrides: Partial<ShareInvitation> = {}): ShareInvitation => ({
  invitationId: 'inv-1', reference: 'ABCD2345', inviteeEmail: 'dr.new@example.test', inviteeName: 'Dr New', level: 'view_only',
  duration: '7d', status: 'pending', createdAt: '2026-10-27T09:00:00Z', expiresAt: '2026-11-26T09:00:00Z', acceptedAt: null,
  deliveryOutcome: 'sent', offer: null, consentGrantId: null, ...overrides,
})
const providers: ShareProvider[] = [{ membershipId: '11111111-1111-4111-8111-111111111111', clinicianName: 'Dr Ada Obi', role: 'doctor',
  facilityName: 'Lagos General', organizationName: 'Lagos State Health', newOnHealthId: false }]

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname}{location.search}</p>
}
const where = () => screen.getByTestId('where').textContent

/** Access & sharing at `at`, with a toast provider and the address shown. */
function accessPage(handler: Handler, { at = '/access', parityB2 = false, parityB4 = false, signOut }: {
  at?: string; parityB2?: boolean; parityB4?: boolean; signOut?: () => Promise<void> } = {}) {
  return renderPortal(<ToastProvider><Routes>
    <Route path="/access" element={<AccessPage />} />
    <Route path="*" element={<p>Elsewhere</p>} />
  </Routes><Where /></ToastProvider>, handler, signOut ? { signOut } : {}, { at, parityB2, parityB4 })
}
const tabs = () => within(screen.getByRole('navigation', { name: 'Access' }))
const reads = (sent: Sent[], path: string) => sent.filter(item => item.method === 'GET' && item.path === path).length
const focused = () => document.activeElement

describe('headings while a list loads or fails (SA-02, SA-11)', () => {
  it('names the section, and claims no count, when a list could not be read', async () => {
    accessPage(path => path === REQUESTS || path === HISTORY ? problem(503, 'UNAVAILABLE', 'down') : json([]))
    expect(await screen.findByText('Couldn’t load requests')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Requests' })).toBeTruthy()
    expect(screen.queryByText('Nothing waiting for you')).toBeNull()
    await press(tabs().getByRole('button', { name: /^Who has access/ }))
    expect(await screen.findByText('Couldn’t load who has access')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Who has access' })).toBeTruthy()
    expect(screen.queryByText('No one has access now')).toBeNull()
    expect(screen.queryByText(/Past access stays listed/)).toBeNull()
  })

  it('says only that past access stays listed: the list has no time it ended', async () => {
    accessPage(path => path === HISTORY ? json({ items: [] }) : json([]), { at: '/access?tab=granted' })
    expect(await screen.findByRole('heading', { name: 'No one has access now' })).toBeTruthy()
    expect(screen.getByText('Past access stays listed.')).toBeTruthy()
  })
})

describe('the page name and its tab in the address (SA-22, SA-08)', () => {
  it('is called Access & sharing, as the heading and the menu say', async () => {
    accessPage(path => path === HISTORY ? json({ items: [] }) : json([]))
    await screen.findByRole('heading', { name: 'Nothing waiting for you' })
    expect(document.title).toBe('Access & sharing · Health ID')
  })

  it('opens the tab the address names, and keeps the tab chosen in the address', async () => {
    accessPage(path => path === HISTORY ? json({ items: [] }) : json([]), { at: '/access?tab=granted' })
    expect(await screen.findByRole('heading', { name: 'No one has access now' })).toBeTruthy()
    expect(tabs().getByRole('button', { name: /^Who has access/ }).getAttribute('aria-pressed')).toBe('true')
    await press(tabs().getByRole('button', { name: 'Activity' }))
    expect(where()).toBe('/access?tab=activity')
    await press(tabs().getByRole('button', { name: /^Requests/ }))
    expect(where()).toBe('/access')
  })

  it('sends the old activity address, and Home’s activity rows, to the Activity tab', () => {
    expect(LEGACY_PATIENT_PATHS['/logs']).toBe('/access?tab=activity')
    const rows = recentActivity({ events: [{ id: 'e-1', at: '2026-10-28T09:00:00Z', action: 'viewed', actorKind: 'clinician',
      actorName: 'Dr Bello', facilityName: 'Lagos General' }], nextBefore: null }, [])
    expect(rows[0]!.to).toBe('/access?tab=activity')
  })
})

describe('reviewing a request (SA-04, SA-05, SA-09)', () => {
  async function review() {
    fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
    return within(screen.getByRole('dialog', { name: 'Lagos General' }))
  }

  it('asks for a recent sign-in in the drawer, with a button that signs out and comes back to Access & sharing', async () => {
    const signOut = vi.fn(async () => {})
    accessPage((path, method) => {
      if (path === REQUESTS) return json([pending])
      if (path === HISTORY) return json({ items: [] })
      if (method === 'POST') return problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Recent authentication required')
      return json([])
    }, { signOut })
    const drawer = await review()
    await press(drawer.getByRole('button', { name: /^Approve/ }))
    const alert = await drawer.findByRole('alert')
    expect(shownText(alert)).toContain('For your safety, sign out, sign in again, then come back within 10 minutes.')
    await press(drawer.getByRole('button', { name: 'Sign in again' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess'))
  })

  it('reads the lists again after a conflict, closes the drawer and says so plainly', async () => {
    let answered = pending
    const { sent } = accessPage((path, method) => {
      if (path === REQUESTS) return json([answered])
      if (path === HISTORY) return json({ items: [] })
      if (method === 'POST') { answered = { ...pending, status: 'approved' }; return problem(409, 'CONSENT_COMMAND_CONFLICT', 'conflict') }
      return json([])
    })
    const drawer = await review()
    const before = reads(sent, REQUESTS)
    await press(drawer.getByRole('button', { name: /^Approve/ }))
    expect(await screen.findByText('This request was already decided or has ended. The list is up to date.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lagos General' })).toBeNull())
    expect(reads(sent, REQUESTS)).toBeGreaterThan(before)
    expect(reads(sent, HISTORY)).toBeGreaterThan(1)
  })

  it('moves focus to the reason box when "Other" is chosen and left empty', async () => {
    accessPage(path => path === REQUESTS ? json([pending]) : path === HISTORY ? json({ items: [] }) : json([]))
    const drawer = await review()
    await press(drawer.getByRole('button', { name: /^Deny/ }))
    fireEvent.click(drawer.getByLabelText('Other…'))
    const box = drawer.getByLabelText(/Your reason/)
    await press(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(focused()).toBe(box))
    expect(box.getAttribute('aria-invalid')).toBe('true')
  })
})

describe('who has access (SA-10, SA-15, SA-23, SA-16)', () => {
  it('says the purpose in plain words and links to the Access PIN in the End access drawer', async () => {
    accessPage(path => path === HISTORY ? json({ items: [grant('g-1')] }) : json([]), { at: '/access?tab=granted' })
    await press(await screen.findByRole('button', { name: /^End access for A staff member at Lagos General/ }))
    const drawer = within(screen.getByRole('dialog'))
    expect(drawer.queryByText('direct-care')).toBeNull()
    expect(drawer.getByText('Your care')).toBeTruthy()
    expect(drawer.getByRole('link', { name: 'Change it in your profile' }).getAttribute('href')).toBe('/profile#access-pin')
  })

  it('names purposes in words, never as codes', () => {
    // One label for purposes, health#218's (whoHasAccess.ts), from identity.purpose_of_use_codes: a purpose with no
    // words here is left out, never shown as "Your care" or as its code.
    expect(purposeLabel('direct-care')).toBe('Your care')
    expect(purposeLabel('emergency')).toBe('Emergency care')
    expect(purposeLabel('healthcare-operations')).toBe('Records processing')
    expect(purposeLabel('some_new_code')).toBeNull()
  })

  it('says why emergency access was used, until when, and whom to contact; and why other access can’t be ended here', async () => {
    vi.stubEnv('VITE_HID_SUPPORT_CONTACT', 'mailto:help@example.test')
    accessPage(path => path === HISTORY ? json({ items: [
      grant('g-1', { breakGlass: true, patientRevocable: false, reason: 'Unconscious on arrival', facilityName: 'Ikeja Hospital',
        expiresAt: '2026-11-03T14:30:00Z' }),
      grant('g-2', { patientRevocable: false, facilityName: 'Yaba Clinic', expiresAt: '2026-12-01T10:00:00Z' }),
    ] }) : json([]), { at: '/access?tab=granted' })
    // Who has access groups rows under a heading per facility (health#218): each facility's group holds its rows.
    const group = async (facility: string) => (await screen.findByRole('heading', { name: facility })).closest<HTMLElement>('.border-t')!
    const emergency = await group('Ikeja Hospital')
    expect(emergency.textContent).toContain('Reason given: “Unconscious on arrival”')
    expect(emergency.textContent).toMatch(/It ends by itself on 3 Nov 2026, \d{1,2}:30/)
    const contact = within(emergency).getByRole('link', { name: /Contact Health ID support/ })
    expect(contact.getAttribute('href')).toMatch(/^mailto:/)
    const other = await group('Yaba Clinic')
    expect(other.textContent).toContain('Given by Yaba Clinic. It ends by itself on 1 Dec 2026, and you can’t end it here.')
    expect(within(other).getByRole('link', { name: /Contact Health ID support/ })).toBeTruthy()
  })

  it('shows a designed empty state with the next step for no access', async () => {
    accessPage(path => path === HISTORY ? json({ items: [] }) : path === INVITATIONS ? json({ items: [], limits: LIMITS }) : json([]),
      { at: '/access?tab=granted', parityB4: true })
    const region = await screen.findByRole('region', { name: 'Invitations to share' })
    expect(await within(region).findByText('No invitations yet')).toBeTruthy()
    expect(within(region).getByRole('link', { name: 'Invite by email' }).getAttribute('href')).toBe('/access/share?by=email')
    expect(region.querySelector('svg.h-20')).not.toBeNull()
  })
})

describe('invitations to share (SA-03, SA-12, SA-21, SA-04, SA-05)', () => {
  const offer = { clinicianName: 'Dr Chidi Eze', role: 'doctor' as const, facilityName: 'Ikeja Hospital', organizationName: 'Ikeja Health',
    newOnHealthId: false }

  it('lets the status wrap below the name on a phone', async () => {
    accessPage(path => path === INVITATIONS ? json({ items: [invitation({ status: 'accepted', offer })], limits: LIMITS })
      : path === HISTORY ? json({ items: [] }) : json([]), { at: '/access?tab=granted', parityB4: true })
    const region = await screen.findByRole('region', { name: 'Invitations to share' })
    const name = await within(region).findByText('Dr New (dr.new@example.test)')
    const row = name.parentElement!.parentElement!
    expect(row.className).toContain('flex-wrap')
    expect(name.parentElement!.className).toContain('flex-[1_1_12rem]')
  })

  it('says a confirmed share has ended once it no longer gives access, and that it is shared while it does', async () => {
    accessPage(path => path === INVITATIONS ? json({ items: [
      invitation({ invitationId: 'inv-1', status: 'confirmed', consentGrantId: 'g-ended', acceptedAt: '2026-10-28T08:00:00Z' }),
      invitation({ invitationId: 'inv-2', inviteeEmail: 'b@example.test', inviteeName: null, status: 'confirmed', consentGrantId: 'g-live' }),
    ], limits: LIMITS }) : path === HISTORY ? json({ items: [grant('g-ended', { status: 'revoked' }), grant('g-live')] }) : json([]),
    { at: '/access?tab=granted', parityB4: true })
    const region = await screen.findByRole('region', { name: 'Invitations to share' })
    const rows = await within(region).findAllByRole('listitem')
    await waitFor(() => expect(rows[0]!.textContent).toContain('Confirmed · sharing has ended'))
    expect(rows[1]!.textContent).toContain('Confirmed · your records are shared')
  })

  it('shows the pressed button as busy while it sends', async () => {
    let release: (value: Response) => void = () => {}
    accessPage((path, method) => {
      if (method === 'POST') return new Promise<Response>(resolve => { release = resolve })
      return path === INVITATIONS ? json({ items: [invitation()], limits: LIMITS }) : path === HISTORY ? json({ items: [] }) : json([])
    }, { at: '/access?tab=granted', parityB4: true })
    const button = await screen.findByRole('button', { name: /^Cancel invitation/ })
    await press(button)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Cancelling/ }).getAttribute('aria-busy')).toBe('true'))
    await act(async () => { release(json({ invitationId: 'inv-1', status: 'cancelled', replayed: false })) })
  })

  it('offers a sign-in again on a confirm refused for an old sign-in', async () => {
    const signOut = vi.fn(async () => {})
    accessPage((path, method) => {
      if (method === 'POST') return problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.')
      return path === INVITATIONS ? json({ items: [invitation({ status: 'accepted', offer })], limits: LIMITS })
        : path === HISTORY ? json({ items: [] }) : json([])
    }, { at: '/access?tab=granted', parityB4: true, signOut })
    await press(await screen.findByRole('button', { name: /^Confirm and share/ }))
    await press(await screen.findByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess%3Ftab%3Dgranted'))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('reads the invitations again when one was changed elsewhere', async () => {
    const { sent } = accessPage((path, method) => {
      if (method === 'POST') return problem(409, 'SHARE_INVITATION_NOT_PENDING', 'Not pending')
      return path === INVITATIONS ? json({ items: [invitation()], limits: LIMITS }) : path === HISTORY ? json({ items: [] }) : json([])
    }, { at: '/access?tab=granted', parityB4: true })
    await press(await screen.findByRole('button', { name: /^Cancel invitation/ }))
    expect(await screen.findByText('This invitation has already been accepted, cancelled or has ended.')).toBeTruthy()
    await waitFor(() => expect(reads(sent, INVITATIONS)).toBeGreaterThan(1))
  })
})

describe('activity (SA-13, SA-16, SA-17)', () => {
  const event = (overrides: Partial<AccessLogEvent>): AccessLogEvent => ({ id: 'e-1', at: '2026-10-28T09:00:00Z', action: 'access_granted',
    actorKind: 'patient', actorName: null, facilityName: 'Lagos General', ...overrides })

  it('names whom the patient let in or shut out', () => {
    expect(eventSentence(event({}))).toBe('You gave Lagos General access to your records')
    expect(eventSentence(event({ action: 'access_ended', facilityName: 'Reddington Clinic' }))).toBe('You ended Reddington Clinic’s access')
    expect(eventSentence(event({ facilityName: null }))).toBe('You gave a facility access to your records')
    expect(eventSentence(event({ actorKind: 'clinician', actorName: 'Dr Bello' }))).toBeNull()
    expect(recentActivity({ events: [event({})], nextBefore: null }, [])[0]!.text).toBe('You gave Lagos General access to your records')
  })

  it('shows a designed empty state when there is no activity, and when the log is not served', async () => {
    accessPage(path => path === LOG ? json({ events: [], nextBefore: null }) : path === HISTORY ? json({ items: [] }) : json([]),
      { at: '/access?tab=activity', parityB2: true })
    expect(await screen.findByText('No activity yet')).toBeTruthy()
  })

  it('is not blank when the log is not served (404)', async () => {
    accessPage(path => path === HISTORY ? json({ items: [] }) : json([]), { at: '/access?tab=activity' })
    expect(await screen.findByText('No activity yet')).toBeTruthy()
  })
})

describe('the share flow (SA-04, SA-06, SA-07, SA-08, SA-20)', () => {
  function sharePage(handler: Handler, signOut?: () => Promise<void>) {
    return renderPortal(<Routes>
      <Route path="/access/share" element={<><ShareRecords /><Where /></>} />
      <Route path="*" element={<Where />} />
    </Routes>, (path, method, body) => {
      if (path === INVITATIONS && method === 'GET') return json({ items: [], limits: LIMITS })
      if (path === '/identity/me/share-providers/search') return json({ items: providers })
      return handler(path, method, body)
    }, signOut ? { signOut } : {}, { parityB4: true, at: '/access/share' })
  }
  async function toConfirm() {
    fireEvent.change(await screen.findByLabelText('Name of the clinician or facility'), { target: { value: 'ada' } })
    await press(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByLabelText(/Dr Ada Obi/))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
  }

  it('offers a sign-in again that comes back to sharing', async () => {
    const signOut = vi.fn(async () => {})
    sharePage(() => problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.'), signOut)
    await toConfirm()
    await press(screen.getByRole('button', { name: 'Share my records' }))
    await press(await screen.findByRole('button', { name: 'Sign in again' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess%2Fshare'))
  })

  it('says a person who can’t receive records in plain words, with a way back to choose someone else', async () => {
    sharePage(() => problem(404, 'SHARE_PROVIDER_UNAVAILABLE', 'Provider unavailable'))
    await toConfirm()
    await press(screen.getByRole('button', { name: 'Share my records' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('This person can’t receive records through Health ID right now. Choose someone else.')
    await press(screen.getByRole('button', { name: 'Choose someone else' }))
    expect(await screen.findByRole('heading', { name: 'Who do you want to share with?' })).toBeTruthy()
  })

  it('keeps every Change button still while the share is sending, each a large enough target', async () => {
    let release: (value: Response) => void = () => {}
    sharePage(() => new Promise<Response>(resolve => { release = resolve }))
    await toConfirm()
    const changes = screen.getAllByRole('button', { name: /^Change/ })
    expect(changes).toHaveLength(3)
    for (const change of changes) expect(change.className).toContain('min-h-11')
    await press(screen.getByRole('button', { name: 'Share my records' }))
    for (const change of screen.getAllByRole('button', { name: /^Change/ })) expect((change as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { release(problem(503, 'UNAVAILABLE', 'down')) })
  })

  it('makes the invite link a large enough target', async () => {
    sharePage(() => problem(404, 'NOT_FOUND', 'x'))
    expect((await screen.findByRole('button', { name: 'Can’t find them? Invite them by email' })).className).toContain('min-h-11')
  })

  it('says each known refusal with the right next step', () => {
    const refused = (status: number, code: string) => shareProblem(new HidApiError(status, 'server words', { code }), 'Fallback.')
    expect(refused(429, 'SHARE_CREATE_LIMITED')).toBe('You’ve shared your records many times today. Try again tomorrow.')
    expect(refused(429, 'SHARE_SEARCH_LIMITED')).toBe('Too many searches. Try again in an hour.')
    expect(refused(409, 'SHARE_INVITATION_TOO_MANY_OPEN')).toBe('You have 20 open invitations. Cancel one to send another.')
    expect(refused(429, 'SHARE_INVITATION_LIMITED')).toBe('You can send 5 invitations a day. Try again tomorrow.')
    expect(refused(409, 'SHARE_INVITATION_NOT_ACCEPTED')).toMatch(/haven’t accepted/)
    expect(refused(409, 'SHARE_INVITATION_NOT_CANCELLABLE')).toMatch(/can’t be cancelled/)
    expect(refused(422, 'IDEMPOTENCY_KEY_REUSED')).toBe('Something changed while this was sending. Start again.')
  })

  it('sends "See who has access" to the Who has access tab', async () => {
    sharePage((path, method) => path === '/identity/me/shares' && method === 'POST' ? json({ consentGrantId: 'grant-9',
      membershipId: providers[0]!.membershipId, scope: 'read_records', level: 'view_only', duration: '24h', startsAt: '2026-10-28T10:00:00Z',
      expiresAt: '2026-10-29T10:00:00Z', clinicianName: 'Dr Ada Obi', facilityName: 'Lagos General', replacedConsentGrantId: null,
      replayed: false }, 201) : problem(404, 'NOT_FOUND', path))
    await toConfirm()
    await press(screen.getByRole('button', { name: 'Share my records' }))
    expect((await screen.findByRole('link', { name: 'See who has access' })).getAttribute('href')).toBe('/access?tab=granted')
  })
})

describe('signing in again comes back (SA-04)', () => {
  it('accepts only a path on this site', () => {
    expect(safeReturnPath('/access?tab=granted')).toBe('/access?tab=granted')
    expect(safeReturnPath('/access/share')).toBe('/access/share')
    for (const unsafe of [null, '', 'access', '//evil.example', '/\\evil.example', 'https://evil.example/', '/\\/x', ' /access']) {
      expect(safeReturnPath(unsafe)).toBe('/')
    }
  })

  it('goes to the page it was sent from once signed in', async () => {
    const { api } = patientApi(() => json({}))
    render(<MemoryRouter initialEntries={['/sign-in?next=%2Faccess%3Ftab%3Dgranted']}><SessionContext.Provider value={createTestSessionValue({
      kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1' }, api)}>
      <Routes><Route path="/sign-in" element={<SignIn />} /><Route path="*" element={<Where />} /></Routes>
    </SessionContext.Provider></MemoryRouter>)
    await waitFor(() => expect(where()).toBe('/access?tab=granted'))
  })
})

describe('orders sent elsewhere (SA-18, SA-19)', () => {
  const ROUTE = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
  const route = (overrides: Partial<PatientOrderRoute> = {}): PatientOrderRoute => ({ id: ROUTE, reference: '9C1B2D3E', kind: 'lab_request',
    version: 1, effectiveState: 'sent', receivingFacility: { id: 'f1', name: 'Yaba Diagnostics', available: true },
    createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: null, completedAt: null, endedAt: null,
    endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false, orderingFacilityName: 'General Hospital',
    receivingFacilityName: 'Yaba Diagnostics', receivingRegisteredAddress: null,
    content: { testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin', priority: 'asap', specimenTypeCode: 'venous_blood',
      clinicalInformation: null, requestedAt: '2026-10-20T08:55:00.000Z', ordererName: 'Dr Ade Okon' },
    attestationTextVersion: 'v1', attestationText: null, attestedByName: 'Dr Ade Okon', actions: ['withdraw'], ...overrides })
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('says priority, how to take it, sample type and an unknown state in words', () => {
    const lab = Object.fromEntries(sentFields(route()))
    expect(lab['Priority']).toBe('As soon as possible')
    expect(lab['Sample type']).toBe('Venous blood')
    const medicine = Object.fromEntries(sentFields(route({ kind: 'prescription', content: { medicationDisplay: 'Amoxicillin', routeCode: 'PO' } })))
    expect(medicine['How to take it']).toBe('By mouth')
    expect(patientRouteState(route({ effectiveState: 'some_new_state' as PatientOrderRoute['effectiveState'] }))).toBe('in progress')
  })

  it('offers Try again when the orders could not be read', async () => {
    let calls = 0
    renderPortal(<AccessPage />, path => {
      if (path === '/ehr/me/order-routes') { calls += 1; return calls === 1 ? problem(400, 'BAD_REQUEST', 'down') : json({ items: [] }) }
      if (path === HISTORY) return json({ items: [] })
      if (path === '/identity/me') return json(profile)
      return json([])
    }, {}, { at: '/access?tab=granted' })
    const region = await screen.findByRole('region', { name: 'Tests and prescriptions sent elsewhere' })
    expect(await within(region).findByText('Couldn’t load your orders')).toBeTruthy()
    await press(within(region).getByRole('button', { name: /Try again/ }))
    expect(await within(region).findByText('Nothing sent elsewhere')).toBeTruthy()
  })

  it('asks before Stop, and stops only once confirmed', async () => {
    const { sent } = renderPortal(<AccessPage />, (path, method) => {
      if (path === '/ehr/me/order-routes') return json({ items: [route()] })
      if (method === 'POST') return json({ route: route({ effectiveState: 'withdrawn', endedKind: 'patient', actions: [] }) })
      if (path === HISTORY) return json({ items: [] })
      if (path === '/identity/me') return json(profile)
      return json([])
    }, {}, { at: '/access?tab=granted' })
    await press(await screen.findByRole('button', { name: /^Stop it/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Stop this test request?' }))
    expect(sent.filter(item => item.method === 'POST')).toHaveLength(0)
    await press(dialog.getByRole('button', { name: 'Cancel' }))
    expect(sent.filter(item => item.method === 'POST')).toHaveLength(0)
    await press(screen.getByRole('button', { name: /^Stop it/ }))
    await press(within(await screen.findByRole('dialog', { name: 'Stop this test request?' })).getByRole('button', { name: 'Stop it' }))
    await waitFor(() => expect(sent.filter(item => item.method === 'POST')).toHaveLength(1))
  })
})

describe('Sign in again, with a sign-out that really ends the session (SA-04)', () => {
  /**
   * The session as the app keeps it: an external store read with useSyncExternalStore, which sign-out clears before it
   * returns. The page guard (RequireAccess) then sees a signed-out patient in the same turn as the button's own move.
   */
  function guarded(handler: Handler, at: string) {
    const { api } = patientApi(handler, { parityB4: true })
    let principal: AuthPrincipal | null = { kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1' }
    const listeners = new Set<() => void>()
    const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
    const signOut = vi.fn(async () => {
      await Promise.resolve()
      principal = null
      listeners.forEach(listener => listener())
    })
    function Session({ children }: { children: ReactNode }) {
      const current = useSyncExternalStore(subscribe, () => principal)
      return <SessionContext.Provider value={{ ...createTestSessionValue(current, api), signOut }}>{children}</SessionContext.Provider>
    }
    const view = render(<MemoryRouter initialEntries={[at]}><Session><ToastProvider><Routes>
      <Route path="/access" element={<RequireAccess requirement={PATIENT_ROUTE}><AccessPage /></RequireAccess>} />
      <Route path="/access/share" element={<RequireAccess requirement={PATIENT_ROUTE}><ShareRecords /></RequireAccess>} />
      <Route path="*" element={<p>Elsewhere</p>} />
    </Routes><Where /></ToastProvider></Session></MemoryRouter>)
    return { view, signOut }
  }

  /**
   * Presses the button outside act(), so React and the router schedule their updates as they do in a browser (the
   * router's in a transition), and not all in one batch at the end of act.
   */
  async function pressAsTheBrowserDoes(button: HTMLElement) {
    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = actEnvironment.IS_REACT_ACT_ENVIRONMENT
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    try {
      button.focus()
      button.click()
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally { actEnvironment.IS_REACT_ACT_ENVIRONMENT = before }
  }

  it('comes back to Access & sharing from the request drawer', async () => {
    const { signOut } = guarded((path, method) => {
      if (path === REQUESTS) return json([pending])
      if (path === HISTORY) return json({ items: [] })
      if (method === 'POST') return problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Recent authentication required')
      return json([])
    }, '/access')
    fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
    const drawer = within(screen.getByRole('dialog', { name: 'Lagos General' }))
    await press(drawer.getByRole('button', { name: /^Approve/ }))
    await pressAsTheBrowserDoes(await drawer.findByRole('button', { name: 'Sign in again' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(where()).toBe('/sign-in?next=%2Faccess')
  })

  it('comes back to the share flow', async () => {
    guarded((path, method) => {
      if (path === INVITATIONS && method === 'GET') return json({ items: [], limits: LIMITS })
      if (path === '/identity/me/share-providers/search') return json({ items: providers })
      return problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.')
    }, '/access/share')
    fireEvent.change(await screen.findByLabelText('Name of the clinician or facility'), { target: { value: 'ada' } })
    await press(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByLabelText(/Dr Ada Obi/))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Share my records' }))
    await pressAsTheBrowserDoes(await screen.findByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess%2Fshare'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(where()).toBe('/sign-in?next=%2Faccess%2Fshare')
  })

  it('comes back to Who has access after confirming an invitation was refused', async () => {
    const offer = { clinicianName: 'Dr Chidi Eze', role: 'doctor' as const, facilityName: 'Ikeja Hospital', organizationName: 'Ikeja Health',
      newOnHealthId: false }
    guarded((path, method) => {
      if (method === 'POST') return problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.')
      return path === INVITATIONS ? json({ items: [invitation({ status: 'accepted', offer })], limits: LIMITS })
        : path === HISTORY ? json({ items: [] }) : json([])
    }, '/access?tab=granted')
    await press(await screen.findByRole('button', { name: /^Confirm and share/ }))
    await pressAsTheBrowserDoes(await screen.findByRole('button', { name: 'Sign in again' }))
    await waitFor(() => expect(where()).toBe('/sign-in?next=%2Faccess%3Ftab%3Dgranted'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(where()).toBe('/sign-in?next=%2Faccess%3Ftab%3Dgranted')
  })
})
