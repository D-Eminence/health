import { describe, expect, it } from 'vitest'
import { useRef } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AccessRequest, EmergencyContact } from '../api'
import { AccessPage, NotificationsPage, PortalShell, RecordsPage, SettingsPage } from '../routes/Portal'
import { Overview } from '../routes/Overview'
import { AccountDeletionCard, EmergencyContactsCard } from '../routes/AccountSafety'
import { useFocusOnPageChange } from '../pageFocus'
import { json, press, pressOnArrival, problem, profile, renderPortal, type Handler } from './portalHarness'

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
const access = (handler: Handler) => renderPortal(<AccessPage />, handler)

describe('access and consent', () => {
  it('moves focus to the requests heading once an approved request has left the list, which stays on screen', async () => {
    let status = 'pending'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([{ ...request, status }])
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') status = 'approved'
      return json({ accessRequestId: request.accessRequestId, status })
    })
    const list = (await screen.findByText('Lagos General')).closest('ul')!
    await inChromium(screen.getByRole('button', { name: /^Approve/ }))

    expect(await screen.findByText('Request approved.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access requests' })))
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    expect(list.isConnected).toBe(true)
  })

  it('gives focus back to Approve when the approval is refused', async () => {
    const answer = deferred()
    access((path, method) => method === 'POST' ? answer.promise
      : json(path === '/identity/me/access-requests' ? [request] : { items: [] }))
    const approve = await screen.findByRole('button', { name: /^Approve/ })
    await inChromium(approve)
    expect(focused()).toBe(document.body)
    await act(async () => { answer.resolve(problem(409, 'ACCESS_REQUEST_NOT_PENDING', 'This request was already decided.')) })

    expect((await screen.findByRole('alert')).textContent).toContain('already decided')
    await waitFor(() => expect(focused()).toBe(approve))
  })

  it('keeps every decision disabled until the list shows the decision just made', async () => {
    const reloaded = deferred()
    let reads = 0
    access((path, method) => {
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') return json({ accessRequestId: request.accessRequestId, status: 'approved' })
      return ++reads === 1 ? json([request]) : reloaded.promise
    })
    await press(await screen.findByRole('button', { name: /^Approve/ }))
    await screen.findByText('Request approved.')
    expect((screen.getByRole('button', { name: /^Approve/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /^Deny/ }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { reloaded.resolve(json([{ ...request, status: 'approved' }])) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull())
  })

  it('opens the denial with focus in its reason, cancels back to Deny, and confirms to the requests heading', async () => {
    let status = 'pending'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([{ ...request, status }])
      if (path === '/identity/me/access-history') return json({ items: [] })
      if (method === 'POST') status = 'denied'
      return json({ accessRequestId: request.accessRequestId, status })
    })
    const deny = await screen.findByRole('button', { name: /^Deny/ })
    await press(deny)
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Reason for denial' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Reason for denial' })).toBeNull()
    expect(focused()).toBe(deny)

    await press(deny)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for denial' }), { target: { value: 'Not my clinic' } })
    await inChromium(screen.getByRole('button', { name: 'Confirm denial' }))
    expect(await screen.findByText('Request denied.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access requests' })))
  })

  it('opens the revocation with focus in its reason, cancels back to Revoke access, and confirms to the history heading', async () => {
    let status = 'active'
    access((path, method) => {
      if (path === '/identity/me/access-requests') return json([])
      if (path === '/identity/me/access-history') return json({ items: [{ ...grant, status, patientRevocable: status === 'active' }] })
      if (method === 'POST') status = 'revoked'
      return json({ consentGrantId: grant.consentGrantId, status, replayed: false })
    })
    await press(await screen.findByRole('button', { name: /^Revoke access/ }))
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Reason for revocation' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Reason for revocation' })).toBeNull()
    expect(focused()).toBe(screen.getByRole('button', { name: /^Revoke access/ }))

    await press(screen.getByRole('button', { name: /^Revoke access/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason for revocation' }), { target: { value: 'No longer needed' } })
    await inChromium(screen.getByRole('button', { name: 'Confirm revocation' }))
    expect(await screen.findByText('Access grant revoked.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access history' })))
    expect(screen.queryByRole('button', { name: /^Revoke access/ })).toBeNull()
  })

  it('reports each outcome in one status region that was there before the action', async () => {
    access((path, method) => method === 'POST' ? json({ accessRequestId: request.accessRequestId, status: 'approved' })
      : json(path === '/identity/me/access-requests' ? [request] : { items: [] }))
    await screen.findByText('Lagos General')
    const region = screen.getByRole('status')
    expect(region.textContent).toBe('')
    await press(screen.getByRole('button', { name: /^Approve/ }))
    await screen.findByText('Request approved.')
    expect(screen.getByRole('status')).toBe(region)
    expect(region.textContent).toBe('Request approved.')
  })

  it('moves focus to the history heading after Try again loads it', async () => {
    let reads = 0
    access(path => path === '/identity/me/access-requests' ? json([]) : ++reads === 1 ? unavailable() : json({ items: [grant] }))
    await press(await screen.findByRole('button', { name: 'Try again' }))
    await screen.findByText('Lagos General')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access history' })))
  })
})

/**
 * 'Try again' pressed before React has run the effects of the render that showed
 * it. An effect still pending from that render then runs after the press, and
 * once took the press for the outcome: focus stayed on the button it replaced.
 */
describe('Try again pressed as soon as it is shown', () => {
  it.each([
    ['the access history', () => {
      let reads = 0
      access(path => path === '/identity/me/access-requests' ? json([]) : ++reads === 1 ? unavailable() : json({ items: [grant] }))
      return { loaded: 'Lagos General', heading: () => screen.getByRole('heading', { name: 'Access history' }) }
    }],
    ['the overview', () => {
      let reads = 0
      renderPortal(<Overview />, () => ++reads === 1 ? unavailable() : json(profile))
      return { loaded: 'HID-ABC234', heading: () => screen.getByRole('heading', { level: 1 }) }
    }],
    ['the emergency contacts', () => {
      let reads = 0
      renderPortal(<EmergencyContactsCard />, () => ++reads === 1 ? unavailable() : json([contact]))
      return { loaded: 'Chidi Okafor', heading: () => screen.getByRole('heading', { name: 'Emergency contacts' }) }
    }],
    ['the account deletion status', () => {
      let reads = 0
      renderPortal(<AccountDeletionCard />, () => ++reads === 1 ? unavailable() : json(noDeletion))
      return { loaded: 'I understand what deleting my account means', heading: () => screen.getByRole('heading', { name: 'Delete account' }) }
    }],
  ])('moves focus to the heading of %s once it loads', async (_label, open) => {
    const pressed = pressOnArrival('Try again')
    const { loaded, heading } = open()
    await waitFor(() => expect(pressed()).toBe(true))
    await screen.findByText(loaded)
    await waitFor(() => expect(focused()).toBe(heading()))
  })
})

describe('pages that load once', () => {
  it('moves focus to the page heading after Try again loads the records, and to Try again when it fails again', async () => {
    let reads = 0
    renderPortal(<RecordsPage />, () => ++reads <= 2 ? unavailable()
      : json({ encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], limit: 100 }))
    await press(await screen.findByRole('button', { name: 'Try again' }))
    const again = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(focused()).toBe(again))
    await press(again)
    await screen.findByRole('heading', { name: 'Encounters' })
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Health records' })))
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

  it('gives focus back to Sign out when signing out fails', async () => {
    const answer = deferred()
    renderPortal(<PortalShell />, () => json({}), {
      signOut: () => answer.promise.then(() => { throw new HidApiError(503, 'Sign-out is unavailable right now.') }),
    })
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    await inChromium(signOut)
    expect(focused()).toBe(document.body)
    await act(async () => { answer.resolve(json({})) })

    expect((await screen.findByRole('alert')).textContent).toContain('Sign-out is unavailable right now.')
    await waitFor(() => expect(focused()).toBe(signOut))
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
  return renderPortal(<SettingsPage />, (path, method, body) => {
    if (path === '/identity/me/access-pin') {
      const answer = pin(path, method, body) as Response
      if (answer.ok) configured = method === 'POST'
      return answer
    }
    if (path === '/identity/me') return json({ ...profile, accessPinConfigured: configured })
    if (path === '/identity/me/emergency-contacts') return json([])
    return json(noDeletion)
  })
}

describe('settings', () => {
  it('keeps the PIN field on screen while the profile reloads, and focus in it after Save PIN', async () => {
    settings()
    const input = await screen.findByLabelText('Set PIN')
    fireEvent.change(input, { target: { value: '1234' } })
    await inChromium(screen.getByRole('button', { name: 'Save PIN' }))
    expect(await screen.findByText('Configured')).toBeTruthy()
    expect(input.isConnected).toBe(true)
    await waitFor(() => expect(focused()).toBe(input))
  })

  it('moves focus to the Access PIN heading once Revoke Access PIN has gone', async () => {
    settings((_path, method) => method === 'POST' ? json({ configured: true }) : json({ revoked: true }))
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await inChromium(await screen.findByRole('button', { name: 'Revoke Access PIN' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke Access PIN' })).toBeNull())
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Access PIN' })))
  })

  it('reports the outcome in the page\'s status region that was there before the action', async () => {
    settings()
    fireEvent.change(await screen.findByLabelText('Set PIN'), { target: { value: '1234' } })
    const region = document.querySelector('section > [role="status"]')!
    expect(region.textContent).toBe('')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await screen.findByText('Access PIN configured.')
    expect(document.querySelector('section > [role="status"]')).toBe(region)
    expect(region.textContent).toBe('Access PIN configured.')
  })
})

describe('emergency contacts', () => {
  const contacts = (handler: Handler) => renderPortal(<EmergencyContactsCard />, handler)

  it('opens the new contact with focus in its name, and cancels back to Add emergency contact', async () => {
    contacts(() => json([]))
    const add = await screen.findByRole('button', { name: 'Add emergency contact' })
    await press(add)
    expect(focused()).toBe(screen.getByRole('textbox', { name: 'Contact name' }))
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
    await inChromium(await screen.findByRole('button', { name: /^Send verification code/ }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('textbox', { name: /Code from Chidi Okafor/ })))
    fireEvent.change(screen.getByRole('textbox', { name: /Code from Chidi Okafor/ }), { target: { value: '482913' } })
    await inChromium(screen.getByRole('button', { name: 'Verify contact' }))
    expect(await screen.findByText('Verified · will be notified in an emergency')).toBeTruthy()
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
    expect(await screen.findByText('Account deletion cancelled. Your account stays open.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Delete account' })))
  })
})
