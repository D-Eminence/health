import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  DEMO_HOSPITAL, REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where, withFramePages,
} from './blueHarness'

/**
 * What the blue EHR must get right before it opens for every clinic: one person's samples never reach the next, Home
 * says what today's Overview says, reads what it reads and no more, and the session check keeps the keyboard.
 * Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const LOGOUT = 'POST /api/v1/auth/logout'
const LOGIN = 'POST /api/v1/auth/login'
const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const follow = (name: string) => act(() => { fireEvent.click(within(nav()).getByRole('link', { name })) })

/** The blue EHR at every facility: the clinic switch on, and both page sets present (as pageSets.ts lists them). */
function switchedOn() {
  vi.doMock('../../../ehr-blue/pageSets', () => ({
    PAGE_FILES: ['./clinical/pages.ts', './departments/pages.ts', './frame/pages.ts', './home/pages.ts'],
  }))
  vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
}

describe('1. samples belong to one person at one facility', () => {
  it('forgets them, and the classic EHR choice, at sign-out: the next person sees none of the last one\'s work', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const next = { actor: { id: 'staff-demo-2', email: 'second.clinician@example.test', displayName: 'Second Clinician', roles: ['clinician'],
      permissions: [], facilities: [demo], facility: demo }, expiresAt: '2026-11-30T12:00:00.000Z' }
    serve({
      [SESSION]: [sessionAt(demo, [demo]), ...many(() => json(next))],
      [REQUESTS]: many(() => json([])),
      [LOGOUT]: [() => new Response(null, { status: 204 })],
      [LOGIN]: [() => json(next)],
    })
    await openStaffApp('/provider/appointments/5a020001')
    await screen.findByRole('heading', { level: 1, name: 'Review of results' })

    // The first person reschedules with a private note, then checks the patient in.
    fireEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const reschedule = screen.getByRole('form', { name: 'Reschedule' })
    fireEvent.change(within(reschedule).getByLabelText(/^New time/), { target: { value: '2026-11-05T10:00' } })
    fireEvent.change(within(reschedule).getByRole('textbox', { name: 'Reason' }), { target: { value: 'First person’s private note' } })
    fireEvent.click(within(reschedule).getByRole('button', { name: 'Reschedule' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Check in' })).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('checked-in')).toBeDefined()
    expect(screen.getAllByText('Author: Demo Clinician').length).toBeGreaterThan(0)

    // Back to today's workspace, then sign out there.
    fireEvent.click(screen.getByRole('button', { name: 'Demo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the classic EHR' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(where()).toBe('/provider/sign-in'))

    // Someone else signs in through the form, in the same tab: the blue EHR again, and the first person's work gone.
    fireEvent.change(screen.getByLabelText(/^Work email/), { target: { value: 'second.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fictional-password-2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Second Clinician' })).toBeDefined()
    follow('Appointments')
    act(() => { fireEvent.click(screen.getAllByRole('link', { name: 'Review of results' })[0]!) })
    await waitFor(() => expect(where()).toBe('/provider/appointments/5a020001'))
    expect(screen.getByText('booked')).toBeDefined()
    expect(screen.queryByText('checked-in')).toBeNull()
    expect(screen.queryByText(/Author: Demo Clinician/)).toBeNull()
    expect(document.body.textContent).not.toContain('First person’s private note')
  })

  it('forgets them when the person switches facility', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const lab = facility('98d00002-0000-4000-8000-000000000002', 'Demo Laboratory', ['identity.consent.write'])
    serve({
      [SESSION]: [sessionAt(demo, [demo, lab]), ...many(sessionAt(lab, [demo, lab]))],
      [REQUESTS]: many(() => json([])),
      'POST /api/v1/auth/facility': [sessionAt(lab, [demo, lab])],
    })
    await openStaffApp('/provider/appointments/5a020001')
    fireEvent.click(await screen.findByRole('button', { name: 'Check in' }))
    fireEvent.click(within(screen.getByRole('form', { name: 'Check in' })).getByRole('button', { name: 'Check in' }))
    expect(await screen.findByText('checked-in')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Work at Demo Laboratory' }))
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Demo Laboratory')).toBeDefined())
    follow('Appointments')
    act(() => { fireEvent.click(screen.getAllByRole('link', { name: 'Review of results' })[0]!) })
    expect(await screen.findByText('booked')).toBeDefined()
    expect(screen.queryByText('checked-in')).toBeNull()
  })
})

describe('2. Home says what today\'s Overview says (a novu-v1 build)', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('shows the Facility check while Health ID support checks a self-signed-up facility', async () => {
    const pending = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write']), selfService: { review: 'pending', organizationType: 'clinic' } }
    serve({ [SESSION]: [sessionAt(pending as ReturnType<typeof facility>, [pending as ReturnType<typeof facility>])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    const check = (await screen.findByRole('heading', { name: 'Facility check' })).closest('section, div')!
    expect(within(check as HTMLElement).getByText('Pending')).toBeDefined()
    expect(within(check as HTMLElement).getByText(/Health ID support is checking Demo Hospital/)).toBeDefined()
  })

  it('says when the member holds no clinical module\'s permission, as today\'s Overview does, and not otherwise', async () => {
    const none = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    serve({ [SESSION]: [sessionAt(none, [none])] })
    const { unmount } = await openStaffApp('/provider')
    const sentence = 'Your active facility has no clinical module permissions. Ask an administrator to review your assignment.'
    expect(await screen.findByText(sentence)).toBeDefined()
    unmount()
    vi.resetModules()
    withFramePages()
    const some = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write', 'identity.patient.read'])
    serve({ [SESSION]: [sessionAt(some, [some])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
    expect(screen.queryByText(sentence)).toBeNull()
  })
})

describe('3. access requests are read where today reads them, each time', () => {
  it('reads them again each time Home opens', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const waiting = [{ accessRequestId: 'r1', patientId: 'p-0000aa11bb22', scope: 'read_records', purposeOfUse: 'direct-care', reason: 'Follow-up (fictional)',
      status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-29T09:00:00Z', approvedAt: null, deniedAt: null, deniedReason: null }]
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([]), () => json(waiting), () => json(waiting)] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('link', { name: '0 pending access requests' })).toBeDefined()
    follow('External record access')
    await waitFor(() => expect(where()).toBe('/provider/requests'))
    follow('Home')
    expect(await screen.findByRole('link', { name: '1 pending access request' })).toBeDefined()
  })

  it('reads none on another page', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write', 'audit.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: many(() => json([])), 'GET /api/v1/audit/events': many(() => json({ items: [] })) })
    await openStaffApp('/provider/audit')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await waitFor(() => expect(sent.some(call => call.route === 'GET /api/v1/audit/events')).toBe(true))
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })
})

describe('4. the session check keeps the keyboard over an open drawer', () => {
  it('lets Tab and Ctrl+K reach the lock screen, not the drawer under it', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    // The check after the page comes back gets an answer the portal cannot read: the session stays unconfirmed.
    serve({ [SESSION]: [sessionAt(demo, [demo]), () => json({})], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider/whats-left')
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeDefined()
    // Away for over a minute: the workspace locks and Health ID is asked again.
    act(() => {
      visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
      now += 61_000
      visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
    })
    const tryAgain = await screen.findByRole('button', { name: 'Try again' })
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    expect(tryAgain.closest('[inert], [hidden]')).toBeNull()
    expect(signOut.closest('[inert], [hidden]')).toBeNull()
    // The drawer is under the lock: its keys stand down, so the browser's Tab moves on to the lock screen.
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(true)
    act(() => { tryAgain.focus() })
    expect(fireEvent.keyDown(tryAgain, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(tryAgain)
    // Search does not open over the lock.
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Search Health ID' })).toBeNull()
  })
})

describe('6. Home reads only what today\'s Overview reads', () => {
  it('at a real clinic with the switch on: the session and the access requests, and nothing audited besides', async () => {
    switchedOn()
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write', 'lab.work-item.read', 'pharmacy.work-item.read'])
    const sent = serve({ [SESSION]: [sessionAt(riverside, [riverside])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
    await waitFor(() => expect(sent.some(call => call.route === REQUESTS)).toBe(true))
    expect([...new Set(sent.map(call => call.route))]).toEqual(['GET /api/v1/auth/session', REQUESTS])
    // Today links to the work pages instead of counting their work.
    const today = screen.getByRole('heading', { name: 'Today' }).closest('section')!
    expect(within(today).getByRole('link', { name: 'Laboratory' }).getAttribute('href')).toBe('/provider/laboratory')
    expect(within(today).getByRole('link', { name: 'Pharmacy' }).getAttribute('href')).toBe('/provider/pharmacy')
  })
})
