import { describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AccessRequest, EmergencyContact } from '../api'
import { AccessPage, NotificationsPage, PortalShell, ProfilePage, RecordsPage } from '../routes/Portal'
import { Overview } from '../routes/Overview'
import { AccountDeletionCard, EmergencyContactsCard } from '../routes/AccountSafety'
import { useFocusOnPageChange } from '../pageFocus'
import { ToastProvider } from '../kasuwa/toast'
import { json, press, pressOnArrival, problem, profile, renderPortal, shownText, type Handler } from './portalHarness'
import { enterCode } from './codeBoxes'

// Record chat is a staging feature; these tests run without a configured environment.
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))

/**
 * Keyboard focus after the portal's actions (PR-03, PR-04, PR-05) and the notices
 * that report them (NEW-PORTAL-STATUS-NOTICES). Before, an action's button was
 * disabled while it ran, the card holding it was unmounted while it reloaded, and
 * forms that opened in place took nothing: a keyboard or screen reader user was
 * left on the document after each step. Chromium also moves focus off a focused
 * control as it becomes disabled; jsdom does not, so `inChromium` does it here.
 */
const request: AccessRequest = {
  accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
}
const grant = {
  consentGrantId: '60000000-0000-4000-8000-000000000001', scope: 'read_records', purpose: 'direct-care', status: 'active',
  startsAt: '2026-10-08T10:00:00Z', expiresAt: '2026-10-08T11:00:00Z', reason: 'Follow-up', facilityName: 'Lagos General',
  breakGlass: false, patientRevocable: true,
}
const contact: EmergencyContact = {
  contactId: 'a0000000-0000-4000-8000-000000000001', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms',
  destinationHint: '+234•••••567', status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true,
  eligibleForEmergencyNotification: false, version: 1, pendingVerification: null, lastNotification: null,
}
const noDeletion = { waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }
const unavailable = () => json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'UPSTREAM_UNAVAILABLE',
  detail: 'This information is unavailable right now.', retryable: false }, 503)

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

/**
 * Presses `button`, then takes focus off it while it is disabled, as Chromium
 * does. jsdom neither moves focus off a control as it becomes disabled nor blurs
 * a disabled one, so the button is enabled for the blur and disabled again.
 */
async function inChromium(button: HTMLElement) {
  await press(button)
  const control = button as HTMLButtonElement
  if (!control.disabled) return
  control.disabled = false
  control.blur()
  control.disabled = true
}

const focused = () => document.activeElement
// Outcomes are said in the shell's toasts (PortalShell holds the provider).
const access = (handler: Handler) => renderPortal(<ToastProvider><AccessPage /></ToastProvider>, handler)
/** Opens Lagos General's request in its drawer with its row, as a keyboard user does; returns the row. */
async function review() {
  const row = await screen.findByRole('button', { name: /^Lagos General/ })
  await press(row)
  return row
}
const drawer = () => within(screen.getByRole('dialog', { name: 'Lagos General' }))
/** Shows Access & sharing's "Who has access" tab. */
const whoHasAccess = async () => press(within(await screen.findByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }))

describe('access and consent', () => {
  it('gives focus back to the request\'s row once it is approved, the row still on screen and saying so', async () => {
    let status = 'pending'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([{ ...request, status }])
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') status = 'approved'
      return json({ accessRequestId: request.accessRequestId, status })
    })
    const row = await review()
    await inChromium(drawer().getByRole('button', { name: /^Approve/ }))

    expect(await screen.findByText('Lagos General can see your records now.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(focused()).toBe(row))
    expect(row.isConnected).toBe(true)
    expect(row.textContent).toContain('Approved')
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Nothing waiting for you' })).toBeTruthy()
  })

  it('gives focus back to Approve when the approval is refused', async () => {
    const answer = deferred()
    access((path, method) => method === 'POST' ? answer.promise
      : json(path === '/identity/me/access-requests' ? [request] : { items: [] }))
    await review()
    const approve = drawer().getByRole('button', { name: /^Approve/ })
    await inChromium(approve)
    expect(focused()).toBe(document.body)
    await act(async () => { answer.resolve(problem(409, 'ACCESS_REQUEST_NOT_PENDING', 'This request was already decided.')) })

    expect((await screen.findByRole('alert')).textContent).toContain('already decided')
    await waitFor(() => expect(focused()).toBe(approve))
  })

  it('keeps every decision disabled until the list shows the decision just made', async () => {
    const reloaded = deferred()
    let reads = 0
    const { sent } = access((path, method) => {
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') return json({ accessRequestId: request.accessRequestId, status: 'approved' })
      return ++reads === 1 ? json([request]) : reloaded.promise
    })
    await review()
    await press(drawer().getByRole('button', { name: /^Approve/ }))
    await waitFor(() => expect(sent.filter(item => item.method === 'POST')).toHaveLength(1))
    expect((drawer().getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((drawer().getByRole('button', { name: /^Deny/ }) as HTMLButtonElement).disabled).toBe(true)
    // Not said until the list shows it.
    expect(screen.queryByText('Lagos General can see your records now.')).toBeNull()
    await act(async () => { reloaded.resolve(json([{ ...request, status: 'approved' }])) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull())
    expect(await screen.findByText('Lagos General can see your records now.')).toBeTruthy()
    expect(sent.filter(item => item.method === 'POST')).toHaveLength(1)
  })

  it('opens the denial with focus on its reason, goes Back to Deny, and gives focus back to the row once denied', async () => {
    let status = 'pending'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([{ ...request, status }])
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') status = 'denied'
      return json({ accessRequestId: request.accessRequestId, status })
    })
    const row = await review()
    await press(drawer().getByRole('button', { name: /^Deny/ }))
    // A quick reason is chosen already, and has focus: one tap from denying.
    expect(focused()).toBe(drawer().getByRole('radio', { name: 'I don’t know them' }))
    await press(drawer().getByRole('button', { name: 'Back' }))
    expect(drawer().queryByRole('radio')).toBeNull()
    await waitFor(() => expect(focused()).toBe(drawer().getByRole('button', { name: /^Deny/ })))

    await press(drawer().getByRole('button', { name: /^Deny/ }))
    await press(drawer().getByRole('radio', { name: 'Other…' }))
    await waitFor(() => expect(focused()).toBe(drawer().getByRole('textbox', { name: 'Your reason' })))
    fireEvent.change(drawer().getByRole('textbox', { name: 'Your reason' }), { target: { value: 'Not my clinic' } })
    await inChromium(drawer().getByRole('button', { name: 'Deny' }))
    expect(await screen.findByText('Nothing was shared with Lagos General.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(row))
    expect(row.textContent).toContain('Denied')
  })

  it('opens the ending of access with focus in its reason, cancels back to End access, and confirms to the heading', async () => {
    let status = 'active'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([])
      if (path === '/identity/me/access-history') return json({ items: [{ ...grant, status, patientRevocable: status === 'active' }] })
      if (method === 'POST') status = 'revoked'
      return json({ consentGrantId: grant.consentGrantId, status, replayed: false })
    })
    await whoHasAccess()
    await press(await screen.findByRole('button', { name: /^End access for/ }))
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Why are you ending it?' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Why are you ending it?' })).toBeNull()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: /^End access for/ })))

    await press(screen.getByRole('button', { name: /^End access for/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Why are you ending it?' }), { target: { value: 'No longer needed' } })
    await inChromium(screen.getByRole('button', { name: 'End access' }))
    expect(await screen.findByText('Lagos General can no longer see your records.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'No one has access now' })))
    expect(screen.queryByRole('button', { name: /^End access/ })).toBeNull()
  })

  it('says each outcome in a polite status, and a refusal in an alert', async () => {
    let refuse = false
    access((path, method) => method === 'POST'
      ? (refuse ? problem(409, 'ACCESS_REQUEST_NOT_PENDING', 'This request was already decided.')
        : json({ accessRequestId: request.accessRequestId, status: 'approved' }))
      : json(path === '/identity/me/access-requests' ? [request] : { items: [] }))
    await review()
    refuse = true
    await press(drawer().getByRole('button', { name: /^Approve/ }))
    const refusal = await screen.findByRole('alert')
    expect(refusal.textContent).toContain('This request was already decided.')
    expect(refusal.getAttribute('aria-live')).toBe('assertive')
    refuse = false
    await press(drawer().getByRole('button', { name: /^Approve/ }))
    const outcome = (await screen.findByText('Lagos General can see your records now.')).closest('[role="status"]') as HTMLElement
    expect(outcome.getAttribute('aria-live')).toBe('polite')
    expect(outcome.textContent).toContain('Approved')
  })

  it('moves focus to the history heading after Try again loads it', async () => {
    let reads = 0
    access(path => path === '/identity/me/access-requests' ? json([]) : ++reads === 1 ? unavailable() : json({ items: [grant] }))
    await whoHasAccess()
    await press(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByText('Lagos General')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: '1 facility has access now' })))
  })
})

/**
 * 'Try again' pressed before React has run the effects of the render that showed
 * it. An effect still pending from that render then runs after the press, and
 * once took the press for the outcome: focus stayed on the button it replaced.
 */
describe('Try again pressed as soon as it is shown', () => {
  it.each([
    ['the access history', async () => {
      let reads = 0
      access(path => path === '/identity/me/access-requests' ? json([]) : ++reads === 1 ? unavailable() : json({ items: [grant] }))
      await whoHasAccess()
      return { loaded: 'Lagos General', heading: () => screen.getByRole('heading', { name: '1 facility has access now' }) }
    }],
    ['the overview', async () => {
      let reads = 0
      renderPortal(<Overview />, () => ++reads === 1 ? unavailable() : json(profile))
      return { loaded: 'HID-ABC234', heading: () => screen.getByRole('heading', { level: 1 }) }
    }],
    ['the emergency contacts', async () => {
      let reads = 0
      renderPortal(<EmergencyContactsCard />, () => ++reads === 1 ? unavailable() : json([contact]))
      return { loaded: 'Chidi Okafor', heading: () => screen.getByRole('heading', { name: 'Emergency contacts' }) }
    }],
    ['the account deletion status', async () => {
      let reads = 0
      renderPortal(<AccountDeletionCard />, () => ++reads === 1 ? unavailable() : json(noDeletion))
      return { loaded: 'I understand what deleting my account means', heading: () => screen.getByRole('heading', { name: 'Delete account' }) }
    }],
  ])('moves focus to the heading of %s once it loads', async (_label, open) => {
    const pressed = pressOnArrival('Try again')
    const { loaded, heading } = await open()
    await waitFor(() => expect(pressed()).toBe(true))
    await screen.findByText(loaded)
    await waitFor(() => expect(focused()).toBe(heading()))
  })
})

describe('pages that load once', () => {
  it('moves focus to the page heading after Try again loads the records, and to Try again when it fails again', async () => {
    let reads = 0
    // Only the records read is counted: the page also reads imported history (hid-system main, #94), which an older backend answers 404.
    renderPortal(<RecordsPage />, path => !path.endsWith('/ehr/me/records') ? json({}, 404) : ++reads <= 2 ? unavailable()
      : json({ encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], limit: 100 }))
    await press(await screen.findByRole('button', { name: 'Try again' }))
    const again = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(focused()).toBe(again))
    await press(again)
    await screen.findByText('No records yet')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Records' })))
  })

  it('moves focus to the overview heading after Try again loads the profile', async () => {
    let reads = 0
    renderPortal(<Overview />, () => ++reads === 1 ? unavailable() : json(profile))
    await press(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByText('HID-ABC234')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1 })))
  })

  it('moves focus to the notifications heading once a notification marked read has lost its button', async () => {
    let readAt: string | null = null
    renderPortal(<NotificationsPage />, (_path, method) => {
      if (method === 'POST') readAt = '2026-10-08T10:05:00Z'
      return json(method === 'POST' ? { id: 'n-1', readAt } : [{ id: 'n-1', notificationCode: 'ACCESS_REQUEST_RECEIVED',
        resourceType: 'access-request', resourceId: null, metadata: {}, readAt, createdAt: '2026-10-08T10:00:00Z' }])
    })
    await inChromium(await screen.findByRole('button', { name: /^Mark as read/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Mark as read/ })).toBeNull())
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Notifications' })))
  })

  it('keeps focus on the account button whose menu held Sign out when signing out fails', async () => {
    const answer = deferred()
    const signOut = vi.fn(() => answer.promise.then(() => { throw new HidApiError(503, 'Sign-out is unavailable right now.') }))
    renderPortal(<PortalShell />, () => json({}), { signOut })
    // Sign out is in the person's ⋯ menu, last and out of the easy path.
    const account = screen.getByRole('button', { name: 'Your Health ID: account' })
    await press(account)
    await press(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(focused()).toBe(account)
    await act(async () => { answer.resolve(json({})) })

    expect((await screen.findByRole('alert')).textContent).toContain('Health ID isn’t available right now. Please try again in a few minutes.')
    await waitFor(() => expect(focused()).toBe(account))
  })
})

describe('a change of page', () => {
  it('moves focus to the new page\'s heading when it was left on a button disabled as the page changed', async () => {
    // Chromium moves focus off a control as it is disabled; an engine that keeps it
    // there leaves the person on a control that does nothing.
    function Shell() {
      const main = useRef<HTMLElement>(null)
      const navigate = useNavigate()
      const next = useLocation().pathname === '/next'
      useFocusOnPageChange(main)
      return <><button type="button" disabled={next} onClick={() => navigate('/next')}>Continue</button>
        <main ref={main}><h1>{next ? 'Next page' : 'First page'}</h1></main></>
    }
    render(<MemoryRouter><Shell /></MemoryRouter>)
    const button = screen.getByRole('button', { name: 'Continue' })
    await press(button)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Next page' })))
  })
})

const settings = (pin: Handler = () => json({ configured: true })) => {
  let configured = false
  return renderPortal(<ProfilePage />, (path, method, body) => {
    if (path === '/identity/me/access-pin') {
      const answer = pin(path, method, body) as Response
      if (answer.ok) configured = method === 'POST'
      return answer
    }
    if (path === '/identity/me') return json({ ...profile, accessPinConfigured: configured })
    if (path === '/identity/me/emergency-contacts') return json([])
    return json(noDeletion)
  }, {}, { at: '/profile#access-pin' })
}

describe('the Access PIN, in the profile\'s Bio-data', () => {
  it('keeps the PIN field on screen while the profile reloads, and focus in it after Save PIN', async () => {
    settings()
    const input = await screen.findByLabelText('Set PIN')
    fireEvent.change(input, { target: { value: '1234' } })
    await inChromium(screen.getByRole('button', { name: 'Save PIN' }))
    expect(await screen.findByText('Set')).toBeTruthy()
    expect(input.isConnected).toBe(true)
    await waitFor(() => expect(focused()).toBe(input))
  })

  it('moves focus to the Access PIN heading once Remove PIN has gone', async () => {
    settings((_path, method) => method === 'POST' ? json({ configured: true }) : json({ revoked: true }))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await inChromium(await screen.findByRole('button', { name: 'Remove PIN' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove PIN' })).toBeNull())
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access PIN' })))
  })

  it('reports the outcome in the PIN\'s status region that was there before the action', async () => {
    settings()
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    const region = document.querySelector('#access-pin > [role="status"]')!
    expect(region.textContent).toBe('')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await screen.findByText('PIN saved.')
    expect(document.querySelector('#access-pin > [role="status"]')).toBe(region)
    expect(shownText(region as HTMLElement)).toBe('PIN saved.')
  })
})

describe('emergency contacts', () => {
  const contacts = (handler: Handler) => renderPortal(<EmergencyContactsCard />, handler)

  it('opens the new contact with focus in its name, and cancels back to Add emergency contact', async () => {
    contacts(() => json([]))
    const add = await screen.findByRole('button', { name: 'Add emergency contact' })
    await press(add)
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Name' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(focused()).toBe(screen.getByRole('button', { name: 'Add emergency contact' }))
  })

  it('opens an edit with focus in the name and cancels back to Edit; Keep contact goes back to Remove', async () => {
    contacts(() => json([contact]))
    await press(await screen.findByRole('button', { name: /^Edit/ }))
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Name' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(focused()).toBe(screen.getByRole('button', { name: /^Edit/ }))

    await press(screen.getByRole('button', { name: /^Remove/ }))
    await press(screen.getByRole('button', { name: 'Keep contact' }))
    expect(focused()).toBe(screen.getByRole('button', { name: /^Remove/ }))
  })

  it('moves focus to the code field once a code is sent, and to the contacts heading once the contact is verified', async () => {
    let verified = false
    contacts((path, method) => {
      if (method === 'GET') return json([{ ...contact, status: verified ? 'verified' : 'unverified', eligibleForEmergencyNotification: verified }])
      if (path.endsWith('/verification')) return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-08T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
      verified = true
      return json({ contactId: contact.contactId, status: 'verified' })
    })
    await inChromium(await screen.findByRole('button', { name: /^Send code/ }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: /Code from Chidi Okafor/ })))
    // The sixth digit sends the code, from the last box, which goes with the form once it is verified.
    await enterCode(screen.getByRole('textbox', { name: /Code from Chidi Okafor/ }), '482913')
    expect(await screen.findByText('Verified · will be told in an emergency')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Emergency contacts' })))
  })

  it('moves focus to the contacts heading after Try again loads them', async () => {
    let reads = 0
    contacts(() => ++reads === 1 ? unavailable() : json([contact]))
    await press(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByText('Chidi Okafor')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Emergency contacts' })))
  })
})

describe('account deletion', () => {
  it('opens the confirmation with focus in the phrase field', async () => {
    renderPortal(<AccountDeletionCard />, (_path, method) => method === 'GET' ? json(noDeletion)
      : json({ requestId: 'req-1', confirmationToken: 'A'.repeat(43), confirmationExpiresAt: '2026-10-08T10:10:00Z', waitingPeriodSeconds: 1_209_600 }, 201))
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    await inChromium(screen.getByRole('button', { name: 'Continue to delete account' }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })))
  })

  it('moves focus to the deletion heading once a scheduled deletion is cancelled', async () => {
    let state = 'pending'
    renderPortal(<AccountDeletionCard />, (_path, method) => {
      if (method === 'POST') { state = 'cancelled'; return json({ requestId: 'req-1', state, replayed: false }) }
      return json({ ...noDeletion, request: { requestId: 'req-1', state, requestedAt: '2026-10-08T10:00:00Z', confirmationExpiresAt: null,
        scheduledFor: state === 'pending' ? '2026-10-22T10:00:00Z' : null, blockedReasonCode: null, cancelledAt: null, cancellable: state === 'pending' } })
    })
    await inChromium(await screen.findByRole('button', { name: 'Cancel deletion' }))
    expect(await screen.findByText('Deletion cancelled. Your account stays open.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Delete account' })))
  })
})
