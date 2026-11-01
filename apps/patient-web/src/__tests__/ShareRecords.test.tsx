import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { AccessHistory, PatientNotification } from '../api'
import type { ShareInvitation, ShareProvider } from '../shareRecords'
import { ShareRecords } from '../routes/ShareRecords'
import { AccessPage } from '../routes/Portal'
import { NOTIFICATION_SUBJECTS, notificationTitle } from '../routes/notificationTitles'
import { forgetShareServed, shareServed } from '../shareServed'
import { json, press, problem, renderPortal, shownText, type Handler } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
beforeEach(() => { forgetShareServed() })

/**
 * Share my records (hid-1.0 parity B4, hid-system 0095; contract b45-contract.md §2.1, §2.3, §2.7): the search, level,
 * duration and confirm steps with focus on each step's heading, the invite form, the invitations card on Access and
 * consent with Cancel, Confirm and Decline, the share's level and duration in Access history, and the new inbox titles.
 * Today's backend answers 404 to every one of these routes: the page opens Access and consent and nothing is shown.
 */
const INVITATIONS = '/identity/me/share-invitations'
const LIMITS = { maxOpen: 20, maxNewPerDay: 5, remainingToday: 4 }
const providers: ShareProvider[] = [
  { membershipId: '11111111-1111-4111-8111-111111111111', clinicianName: 'Dr Ada Obi', role: 'doctor', facilityName: 'Lagos General',
    organizationName: 'Lagos State Health', newOnHealthId: false },
  { membershipId: '22222222-2222-4222-8222-222222222222', clinicianName: 'Nurse Bisi Ade', role: 'nurse', facilityName: 'Yaba Clinic',
    organizationName: 'Yaba Care', newOnHealthId: true },
]
const invitation = (overrides: Partial<ShareInvitation> = {}): ShareInvitation => ({
  invitationId: 'inv-1', reference: 'ABCD2345', inviteeEmail: 'dr.new@example.com', inviteeName: 'Dr New', level: 'view_only',
  duration: '7d', status: 'pending', createdAt: '2026-10-27T09:00:00Z', expiresAt: '2026-11-26T09:00:00Z', acceptedAt: null,
  deliveryOutcome: 'sent', offer: null, consentGrantId: null, ...overrides,
})
const shared = (overrides: Record<string, unknown> = {}) => ({
  consentGrantId: 'grant-9', membershipId: providers[0]!.membershipId, scope: 'write_records', level: 'clinical_collaboration',
  duration: 'until_revoked', startsAt: '2026-10-28T10:00:00Z', expiresAt: '2027-10-28T10:00:00Z', clinicianName: 'Dr Ada Obi',
  facilityName: 'Lagos General', replacedConsentGrantId: null, replayed: false, ...overrides,
})

/** /access/share against `handler`, with Access and consent as a plain page to land on. */
function sharePage(handler: Handler, served = true) {
  return renderPortal(<Routes>
    <Route path="/access/share" element={<ShareRecords />} />
    <Route path="/access" element={<p>Access and consent page</p>} />
  </Routes>, (path, method, body) => {
    if (path === INVITATIONS && method === 'GET') return json({ items: [], limits: LIMITS })
    return handler(path, method, body)
  }, {}, { parityB4: served, at: '/access/share' })
}

const focused = () => document.activeElement
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('the share flow', () => {
  it('opens Access and consent, with no error, where the backend does not serve sharing (404)', async () => {
    const { sent } = sharePage(() => problem(404, 'NOT_FOUND', 'Cannot GET'), false)
    expect(await screen.findByText('Access and consent page')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sent).toEqual([])
    expect(shareServed()).toBe(false)
  })

  it('searches, chooses who, what and how long, checks and shares, moving focus to each step\'s heading', async () => {
    const { sent, headers } = sharePage((path, method) => {
      if (path === '/identity/me/share-providers/search') return json({ items: providers })
      if (path === '/identity/me/shares' && method === 'POST') return json(shared(), 201)
      return problem(404, 'NOT_FOUND', path)
    })
    expect(await screen.findByRole('heading', { name: 'Who do you want to share with?' })).toBeTruthy()
    type('Name of the clinician or facility', '  lagos ')
    await press(screen.getByRole('button', { name: 'Search' }))
    const note = await screen.findByText('2 found for “lagos”. Choose who to share with.')
    expect(focused()).toBe(note)
    expect(sent.find(item => item.path === '/identity/me/share-providers/search')?.body).toEqual({ query: 'lagos' })
    // Only the name, role, facility, organisation and the "new" flag are shown.
    const choices = within(screen.getByRole('group', { name: 'Who to share with' })).getAllByRole('radio')
    expect(choices).toHaveLength(2)
    expect(screen.getByText('Nurse · Yaba Clinic · Yaba Care')).toBeTruthy()
    expect(screen.getByText('New on Health ID')).toBeTruthy()

    fireEvent.click(screen.getByLabelText(/Dr Ada Obi/))
    await press(screen.getByRole('button', { name: 'Continue' }))
    // What they can do and for how long are one step: two choices about the same grant.
    const access = screen.getByRole('heading', { name: 'What can they see, and for how long?' })
    expect(focused()).toBe(access)
    expect(access.nextElementSibling?.textContent).toBe('Sharing with Dr Ada Obi at Lagos General. You can end it sooner at any time.')
    fireEvent.click(screen.getByLabelText(/Clinical Collaboration/))
    expect(screen.getByText(/send your test requests or prescriptions to another facility/)).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'How long' })).getAllByRole('radio').map(radio => radio.closest('label')?.textContent))
      .toEqual(['24 hours', '7 days', '30 days', 'Until I end it'])
    fireEvent.click(screen.getByLabelText('Until I end it'))
    expect(screen.getByText('Up to 1 year at most, never forever.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Continue' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Check and share' }))
    expect(screen.getByText('Dr Ada Obi, Doctor')).toBeTruthy()
    expect(screen.getByText('They can also send your test requests or prescriptions to another facility.')).toBeTruthy()

    await press(screen.getByRole('button', { name: 'Share my records' }))
    const done = await screen.findByRole('heading', { name: 'Your records are shared' })
    expect(focused()).toBe(done)
    expect(done.parentElement?.nextElementSibling?.textContent?.replace(/\s+/g, ' '))
      .toBe('Your card is on its way to Dr Ada Obi at Lagos General. They can open your records until you end it, up to 1 year.')
    const post = sent.find(item => item.path === '/identity/me/shares')
    expect(post?.body).toEqual({ membershipId: providers[0]!.membershipId, level: 'clinical_collaboration', duration: 'until_revoked' })
    expect(headers.find(item => item.path === '/identity/me/shares')?.headers.get('Idempotency-Key')).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/)
    expect(screen.getByRole('link', { name: 'See who has access' }).getAttribute('href')).toBe('/access')
  })

  it('asks for a recent sign-in in its own words, moves focus to the error, and sends the same key again', async () => {
    let attempt = 0
    const { headers } = sharePage((path, method) => {
      if (path === '/identity/me/share-providers/search') return json({ items: providers })
      if (path !== '/identity/me/shares' || method !== 'POST') return problem(404, 'NOT_FOUND', path)
      attempt += 1
      return attempt === 1 ? problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.') : json(shared({ level: 'view_only', duration: '24h' }), 201)
    })
    await screen.findByLabelText('Name of the clinician or facility')
    type('Name of the clinician or facility', 'ada')
    await press(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByLabelText(/Dr Ada Obi/))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Share my records' }))
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('For your security, sign out, sign in again, and share within 10 minutes.')
    // Focus is on the error's place under the step, which holds the alert.
    expect(focused()?.contains(alert)).toBe(true)
    await press(screen.getByRole('button', { name: 'Share my records' }))
    expect(await screen.findByRole('heading', { name: 'Your records are shared' })).toBeTruthy()
    expect(screen.getByText(/They can open your\s+records until/)).toBeTruthy()
    const keys = headers.filter(item => item.path === '/identity/me/shares').map(item => item.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('refuses a search of fewer than 3 characters on the page, with focus on the field', async () => {
    const { sent } = sharePage(() => json({ items: [] }))
    await screen.findByLabelText('Name of the clinician or facility')
    type('Name of the clinician or facility', 'ab')
    await press(screen.getByRole('button', { name: 'Search' }))
    const field = screen.getByLabelText('Name of the clinician or facility')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Enter at least 3 characters of a name or facility.')).toBeTruthy()
    expect(focused()).toBe(field)
    expect(sent.some(item => item.path.startsWith('/identity/me/share-providers'))).toBe(false)
  })

  // Each step's root is keyed by the step: a Back button kept from the step before would hold focus.
  it('moves focus to the step\'s heading on Back, from the access step to who and from the check to the access step', async () => {
    sharePage((path) => path === '/identity/me/share-providers/search' ? json({ items: providers }) : problem(404, 'NOT_FOUND', path))
    await screen.findByLabelText('Name of the clinician or facility')
    type('Name of the clinician or facility', 'ada')
    await press(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByLabelText(/Dr Ada Obi/))
    await press(screen.getByRole('button', { name: 'Continue' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'What can they see, and for how long?' }))
    await press(screen.getByRole('button', { name: 'Back' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Who do you want to share with?' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    await press(screen.getByRole('button', { name: 'Continue' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Check and share' }))
    await press(screen.getByRole('button', { name: 'Back' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'What can they see, and for how long?' }))
  })

  // Sent with Enter in the field, focus stays there and its description is not read again: the problem is an alert.
  it('announces a search of fewer than 3 characters sent with Enter in the field, as a new alert each time', async () => {
    const { sent } = sharePage(() => json({ items: [] }))
    const field = await screen.findByLabelText('Name of the clinician or facility')
    type('Name of the clinician or facility', 'ab')
    field.focus()
    fireEvent.submit(field.closest('form')!)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Enter at least 3 characters of a name or facility.')
    expect(focused()).toBe(field)
    fireEvent.submit(field.closest('form')!)
    expect(screen.getByRole('alert')).not.toBe(alert)
    expect(sent.some(item => item.path.startsWith('/identity/me/share-providers'))).toBe(false)
    // From the Search button, focus moves to the field, whose description says it: no alert.
    await press(screen.getByRole('button', { name: 'Search' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(focused()).toBe(field)
  })

  it('says when no one matched, and offers the invitation by email', async () => {
    sharePage(() => json({ items: [] }))
    await screen.findByLabelText('Name of the clinician or facility')
    type('Name of the clinician or facility', 'nobody')
    await press(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('No one matched “nobody”. Check the spelling, or invite them by email.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    await press(screen.getByRole('button', { name: 'Can’t find them? Invite them by email' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Invite them by email' }))
  })
})

describe('inviting a provider by email', () => {
  it('checks the address, sends the invitation with a key, and says delivery was not confirmed when it was not', async () => {
    const { sent, headers } = sharePage((path, method) => path === INVITATIONS && method === 'POST'
      ? json({ invitationId: 'inv-9', reference: 'WXYZ2345', status: 'pending', expiresAt: '2026-11-27T10:00:00Z',
        deliveryOutcome: 'not_confirmed', replayed: false }, 201)
      : problem(404, 'NOT_FOUND', path))
    await press(await screen.findByRole('button', { name: 'Can’t find them? Invite them by email' }))
    expect(screen.getByText('Nothing is shared until they join Health ID, accept, and you confirm.')).toBeTruthy()
    type('Their email address', 'not-an-email')
    await press(screen.getByRole('button', { name: 'Send invitation' }))
    const email = screen.getByLabelText('Their email address')
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(focused()).toBe(email)
    expect(sent.some(item => item.method === 'POST')).toBe(false)

    type('Their email address', ' dr.new@example.com ')
    type('Their name (optional)', 'Dr New')
    fireEvent.click(screen.getByLabelText(/Clinical Review/))
    fireEvent.click(screen.getByLabelText('30 days'))
    await press(screen.getByRole('button', { name: 'Send invitation' }))
    expect(focused()).toBe(await screen.findByRole('heading', { name: 'Invitation sent' }))
    expect(screen.getByText(/Delivery not confirmed/)).toBeTruthy()
    expect(sent.find(item => item.path === INVITATIONS && item.method === 'POST')?.body)
      .toEqual({ email: 'dr.new@example.com', name: 'Dr New', level: 'clinical_review', duration: '30d' })
    expect(headers.find(item => item.path === INVITATIONS && item.method === 'POST')?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('announces a wrong address sent with Enter in the name field, where focus stays, as one alert', async () => {
    const { sent } = sharePage(() => problem(404, 'NOT_FOUND', 'Cannot GET'))
    await press(await screen.findByRole('button', { name: 'Can’t find them? Invite them by email' }))
    type('Their email address', 'bob')
    type('Their name (optional)', 'Bob 2')
    const name = screen.getByLabelText('Their name (optional)')
    name.focus()
    fireEvent.submit(name.closest('form')!)
    // Both are wrong; only the first, the email's, is the alert.
    expect(screen.getAllByRole('alert').map(item => item.textContent)).toEqual(['Enter a valid email address.'])
    expect(screen.getByText('Enter their name using letters, spaces, apostrophes, dots or hyphens.')).toBeTruthy()
    expect(focused()).toBe(name)
    type('Their email address', 'bob@example.com')
    fireEvent.submit(name.closest('form')!)
    expect(screen.getAllByRole('alert').map(item => item.textContent))
      .toEqual(['Enter their name using letters, spaces, apostrophes, dots or hyphens.'])
    expect(sent.some(item => item.method === 'POST')).toBe(false)
  })

  it('shows the backend\'s words for an invitation already open, with focus on them', async () => {
    sharePage((path, method) => path === INVITATIONS && method === 'POST'
      ? problem(409, 'SHARE_INVITATION_ALREADY_OPEN', 'You already invited this address. Cancel that invitation to send a new one.')
      : problem(404, 'NOT_FOUND', path))
    await press(await screen.findByRole('button', { name: 'Can’t find them? Invite them by email' }))
    type('Their email address', 'dr.new@example.com')
    await press(screen.getByRole('button', { name: 'Send invitation' }))
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('You already invited this address. Cancel that invitation to send a new one.')
    expect(focused()?.contains(alert)).toBe(true)
  })
})

/** Access & sharing against a gateway whose invitations list is `invitations`; history as given. On "Who has access". */
async function accessPage(invitations: Handler, history: AccessHistory = { items: [] }, served = true) {
  const view = renderPortal(<AccessPage />, (path, method, body) => {
    if (path.startsWith(INVITATIONS)) return invitations(path, method, body)
    if (path === '/identity/me/access-history') return json(history)
    return json([])
  }, {}, { parityB4: served })
  await press(within(screen.getByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }))
  return view
}
const card = async () => screen.findByRole('region', { name: 'Invitations to share' })

describe('Access and consent with sharing', () => {
  it('offers "Share my records" and lists invitations, with Cancel for a pending one', async () => {
    let list = [invitation(), invitation({ invitationId: 'inv-2', inviteeEmail: 'x@example.com', inviteeName: null, status: 'pending',
      deliveryOutcome: 'not_confirmed' }), invitation({ invitationId: 'inv-3', status: 'expired' })]
    const { sent } = await accessPage((path, method) => {
      if (method === 'POST' && path === `${INVITATIONS}/inv-1/cancel`) {
        list = list.map(item => item.invitationId === 'inv-1' ? { ...item, status: 'cancelled' } : item)
        return json({ invitationId: 'inv-1', status: 'cancelled', replayed: false })
      }
      return json({ items: list, limits: LIMITS })
    })
    const section = await card()
    expect(screen.getByRole('link', { name: 'Share records' }).getAttribute('href')).toBe('/access/share')
    const rows = within(section).getAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('Dr New (dr.new@example.com)')
    expect(rows[0]!.textContent).toContain('View Only · 7 days')
    expect(rows[1]!.textContent).toContain('We aren’t sure the email arrived')
    expect(rows[2]!.textContent).toContain('Expired')
    expect(within(rows[2]!).queryByRole('button')).toBeNull()
    expect(within(section).getByText('You can send 4 more invitations today.')).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'Invite' }).getAttribute('href')).toBe('/access/share?by=email')

    await press(within(rows[0]!).getByRole('button', { name: 'Cancel invitation to dr.new@example.com' }))
    expect(await within(section).findByText('Invitation cancelled.')).toBeTruthy()
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Invitations to share' }))
    expect(sent.filter(item => item.method === 'POST').map(item => [item.path, item.body]))
      .toEqual([[`${INVITATIONS}/inv-1/cancel`, null]])
  })

  it('shows who accepted, and confirms (sharing the record) or declines', async () => {
    const offer = { clinicianName: 'Dr Chidi Eze', role: 'doctor' as const, facilityName: 'Ikeja Hospital', organizationName: 'Ikeja Health',
      newOnHealthId: true }
    let confirms = 0
    const { sent } = await accessPage((path, method) => {
      if (method === 'POST' && path.endsWith('/confirm')) {
        confirms += 1
        return confirms === 1 ? problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again.')
          : json({ ...shared({ clinicianName: 'Dr Chidi Eze', facilityName: 'Ikeja Hospital', level: 'view_only', duration: '7d',
            expiresAt: '2026-11-04T10:00:00Z' }), invitationId: 'inv-1', status: 'confirmed' }, 201)
      }
      return json({ items: [invitation({ status: 'accepted', acceptedAt: '2026-10-28T08:00:00Z', offer })], limits: LIMITS })
    })
    const section = await card()
    expect(section.textContent).toContain('Dr Chidi Eze, Doctor at Ikeja Hospital, Ikeja Health.')
    expect(within(section).getByText('New on Health ID')).toBeTruthy()
    expect(within(section).getByRole('button', { name: 'Decline the invitation to dr.new@example.com' })).toBeTruthy()
    await press(within(section).getByRole('button', { name: 'Confirm and share with Dr Chidi Eze' }))
    expect(shownText(await within(section).findByRole('alert'))).toBe('For your security, sign out, sign in again, and share within 10 minutes.')
    await press(within(section).getByRole('button', { name: 'Confirm and share with Dr Chidi Eze' }))
    expect(await within(section).findByText(/Dr Chidi Eze at Ikeja Hospital can see your records until/)).toBeTruthy()
    expect(sent.filter(item => item.method === 'POST').map(item => item.path)).toEqual([`${INVITATIONS}/inv-1/confirm`, `${INVITATIONS}/inv-1/confirm`])
  })

  it('shows neither the card nor the button where sharing is not served (404), and says nothing', async () => {
    await accessPage(() => problem(404, 'NOT_FOUND', 'Cannot GET'), { items: [] }, false)
    expect(await screen.findByText('Facilities you approve or share with appear here, with when their access ends.')).toBeTruthy()
    await waitFor(() => expect(shareServed()).toBe(false))
    expect(screen.queryByRole('heading', { name: 'Invitations to share' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Share records' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('names the clinician, the level and the duration of the patient\'s own share in Access history', async () => {
    const grant = (id: string, extra: Partial<AccessHistory['items'][number]>): AccessHistory['items'][number] => ({ consentGrantId: id,
      scope: 'read_records', purpose: 'direct-care', status: 'active', startsAt: '2026-10-28T10:00:00Z', expiresAt: '2027-10-28T10:00:00Z',
      reason: null, facilityName: 'Lagos General', patientRevocable: true, ...extra })
    await accessPage(() => json({ items: [], limits: LIMITS }), { items: [
      grant('g-1', { clinicianName: 'Dr Ada Obi', shareLevel: 'view_only', shareDuration: 'until_revoked' }),
      grant('g-2', { shareLevel: null, shareDuration: null, clinicianName: null }),
    ] })
    const history = (await screen.findByRole('heading', { name: '2 facilities have access now' })).closest('section') as HTMLElement
    const rows = await within(history).findAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('Dr Ada Obi at Lagos General')
    expect(rows[0]!.textContent).toContain('Shared by you · View Only · Until you end it')
    expect(within(rows[0]!).getByRole('button', { name: /^End access for Dr Ada Obi at Lagos General/ })).toBeTruthy()
    expect(rows[1]!.textContent).not.toContain('Shared by you')
  })
})

describe('the inbox notices of sharing', () => {
  const notice = (code: string, metadata: Record<string, unknown>, resourceType: string): PatientNotification => ({ id: 'n-1',
    notificationCode: code, resourceType, resourceId: 'r-1', metadata, readAt: null, createdAt: '2026-10-28T10:00:00Z' })

  it('names the facility, or stands in for it when the metadata lacks it', () => {
    expect(notificationTitle(notice('RECORDS_OPENED', { facilityName: 'Lagos General', accessKind: 'share' }, 'record-access')))
      .toBe('Lagos General opened your health records')
    expect(notificationTitle(notice('RECORDS_OPENED', {}, 'record-access'))).toBe('A hospital opened your health records')
    expect(notificationTitle(notice('SHARE_INVITATION_ACCEPTED', { facilityName: 'Ikeja Hospital' }, 'share-invitation')))
      .toBe('A health worker at Ikeja Hospital accepted your invitation. Confirm it in Access & sharing')
    expect(notificationTitle(notice('SHARE_INVITATION_ACCEPTED', { facilityName: 42 }, 'share-invitation')))
      .toBe('A health worker at a hospital accepted your invitation. Confirm it in Access & sharing')
    expect(notificationTitle(notice('SHARE_INVITATION_EXPIRED', {}, 'share-invitation')))
      .toBe('Your invitation to share your records has expired')
    expect(NOTIFICATION_SUBJECTS['record-access']).toBe('Record access')
    expect(NOTIFICATION_SUBJECTS['share-invitation']).toBe('Invitation to share')
  })
})
