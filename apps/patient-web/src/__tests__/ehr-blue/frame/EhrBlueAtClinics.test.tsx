import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { REAL_FACILITY, facility, json, openStaffApp, problem, serve, sessionAt, where } from './blueHarness'

/**
 * Today's session rules, on the blue EHR at a clinic: the clinic switch on (BLUE_FOR_ALL, mocked here) and the real,
 * merged registry (the frame's, Home's, the clinical and the department pages). What today's staff-portal tests prove
 * of the classic portal, these prove of the blue one: a session that ends takes the open patient with it, for good; an
 * authenticator requirement ends it on a refused switch; a facility lost, chosen or switched; the lock screen by
 * keyboard; and sign-out with its CSRF token. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))

/** The portal's other tabs, as BroadcastChannel would connect them. */
class TabChannel extends EventTarget {
  static open = new Set<TabChannel>()
  constructor(readonly name: string) { super(); TabChannel.open.add(this) }
  postMessage() {}
  close() { TabChannel.open.delete(this) }
}
beforeEach(() => {
  TabChannel.open.clear()
  vi.stubGlobal('BroadcastChannel', TabChannel)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

/** Another tab says the session changed: this one reads it again. */
function fromAnotherTab() {
  act(() => { for (const channel of TabChannel.open) channel.dispatchEvent(new MessageEvent('message', { data: 'changed' })) })
}

const SESSION = 'GET /api/v1/auth/session'
const REFRESH = 'POST /api/v1/auth/refresh'
const LOGIN = 'POST /api/v1/auth/login'
const LOGOUT = 'POST /api/v1/auth/logout'
const FACILITY = 'POST /api/v1/auth/facility'
const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const PATIENT_HID = 'HID-ABCDEF23'
const PATIENT_NAME = 'Chidi Okafor (fictional)'
const ENCOUNTERS = `GET /api/v1/ehr/patients/${PATIENT_ID}/encounters`

const ANNEX = 'f0000000-0000-4000-8000-000000000002'
const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const mfaRequired = () => problem(403, 'STAFF_MFA_REQUIRED', 'Sign in again with your authenticator code to continue')
const MFA_NOTICE = 'Health ID now asks staff for a code from an authenticator app at sign-in. Sign in again to set one up, or to use the one you have.'
const allowedLookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
  patient: { patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME } })

const CLINICAL = ['identity.patient.read', 'ehr.encounter.read']
const riverside = (permissions: readonly string[] = CLINICAL) => facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)
const annex = (permissions: readonly string[] = CLINICAL) => facility(ANNEX, 'Riverside Annex (fictional)', permissions)

async function expectBlueHome() {
  expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
  expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
  expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
}

async function signIn() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'next.clinician@example.test' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'fictional passphrase for tests' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

async function openPatient() {
  fireEvent.change(await screen.findByRole('textbox', { name: 'Search Patients' }), { target: { value: PATIENT_HID } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
  await waitFor(() => expect(document.body.textContent).toContain(PATIENT_NAME))
}

describe('at a clinic, with the clinic switch on', () => {
  it('opens the blue EHR on the merged registry, the clinical and department pages among its own', async () => {
    serve({ [SESSION]: [sessionAt(riverside(), [riverside()])] })
    // The registry the frame runs on holds every clinical and department page itself, not the frame's stand-ins
    // (imported once fetch is served, as the app is: the session client keeps the fetch it finds).
    const [{ BLUE_PAGES }, clinical, departments] = await Promise.all([import('../../../ehr-blue/routes'),
      import('../../../ehr-blue/clinical/pages'), import('../../../ehr-blue/departments/pages')])
    expect(clinical.pages.length).toBeGreaterThan(0)
    expect(departments.pages.length).toBeGreaterThan(0)
    for (const page of [...clinical.pages, ...departments.pages]) expect(BLUE_PAGES).toContain(page)
    await openStaffApp('/provider')
    await expectBlueHome()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Patients' })).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Consultation' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Demo' })).toBeNull()
  })

  it('ends the session with the open patient, and the patient stays gone after the next sign-in', async () => {
    const sent = serve({
      [SESSION]: [sessionAt(riverside(), [riverside()]), ended, ...many(sessionAt(riverside(), [riverside()]))],
      [REFRESH]: [ended],
      [LOOKUP]: many(allowedLookup),
      [ENCOUNTERS]: many(() => json({ items: [] })),
      [LOGIN]: [sessionAt(riverside(), [riverside()])],
    })
    await openStaffApp('/provider/patients')
    await openPatient()

    const { reportStaffSessionEnded } = await import('../../../staff/session')
    act(() => reportStaffSessionEnded())
    expect(await screen.findByRole('heading', { name: 'Your session has ended' })).toBeDefined()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    expect(document.body.textContent).not.toContain(PATIENT_HID)
    expect(document.querySelector('.hid-ehr')).toBeNull()

    fireEvent.click(screen.getByRole('link', { name: 'Sign in again' }))
    await signIn()
    await expectBlueHome()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    // The Patients page has no patient open either: the next person starts from a search.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Patients' }))
    await waitFor(() => expect(where()).toBe('/provider/patients'))
    expect(await screen.findByRole('textbox', { name: 'Search Patients' })).toBeDefined()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    // One lookup, before the session ended: nothing reopened the patient.
    expect(sent.filter(call => call.route === LOOKUP)).toHaveLength(1)
  })

  it('ends the session for an authenticator requirement when a facility switch is refused', async () => {
    const sent = serve({
      [SESSION]: [sessionAt(riverside(), [riverside(), annex()]), ended],
      [FACILITY]: [mfaRequired],
      [REFRESH]: [mfaRequired, () => problem(403, 'CSRF_VALIDATION_FAILED', 'Refresh CSRF validation failed')],
    })
    await openStaffApp('/provider')
    await expectBlueHome()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Work at Riverside Annex (fictional)' }))

    const heading = await screen.findByRole('heading', { name: 'Your session has ended' })
    expect(heading.closest('section')?.textContent).toContain(MFA_NOTICE)
    expect(screen.queryByText(/STAFF_MFA_REQUIRED|authenticator code to continue/)).toBeNull()
    expect(document.querySelector('.hid-ehr')).toBeNull()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: ANNEX }])
  })

  it('asks where they work when their facility is lost, closing the patient, and works where they choose', async () => {
    const atAnnex = sessionAt(annex(), [annex()], 'selected')
    serve({
      [SESSION]: [sessionAt(riverside(), [riverside(), annex()]), sessionAt(annex(), [annex()]), ...many(atAnnex)],
      [LOOKUP]: many(allowedLookup),
      [ENCOUNTERS]: many(() => json({ items: [] })),
      [FACILITY]: [atAnnex],
    })
    await openStaffApp('/provider/patients')
    await openPatient()

    // Another tab's change: the session read no longer lists Riverside.
    fromAnotherTab()
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
    expect(screen.getByText(/The facility you were working at is no longer available to you\./)).toBeDefined()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)

    fireEvent.click(screen.getByRole('button', { name: 'Work at Riverside Annex (fictional)' }))
    // The workspace opens again at the facility chosen, on the same page, with no patient open.
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Riverside Annex (fictional)')).toBeDefined())
    expect(screen.getByRole('heading', { level: 1, name: 'Patients' })).toBeDefined()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
  })

  it('asks someone with two facilities where they work before any page opens, then opens there', async () => {
    const sent = serve({
      [SESSION]: [sessionAt(undefined, [riverside(), annex()], 'default')],
      [FACILITY]: [sessionAt(annex(), [riverside(), annex()], 'selected')],
    })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose your workspace' })).toBeDefined()
    expect(screen.getByText(/You work at more than one facility\./)).toBeDefined()
    expect(document.querySelector('.hid-ehr-blue-standalone')).not.toBeNull()
    expect(sent.map(call => call.route)).toEqual([SESSION])

    fireEvent.click(screen.getByRole('button', { name: 'Work at Riverside Annex (fictional)' }))
    await expectBlueHome()
    expect(within(screen.getByRole('banner')).getByText('Riverside Annex (fictional)')).toBeDefined()
    expect(sent.filter(call => call.route === FACILITY).map(call => call.body)).toEqual([{ facilityId: ANNEX }])
  })

  it('switches facility from the account menu, closing the open patient', async () => {
    const sent = serve({
      [SESSION]: [sessionAt(riverside(), [riverside(), annex()])],
      [LOOKUP]: many(allowedLookup),
      [ENCOUNTERS]: many(() => json({ items: [] })),
      [FACILITY]: [sessionAt(annex(), [riverside(), annex()], 'selected')],
    })
    await openStaffApp('/provider/patients')
    await openPatient()
    // The record has opened (its encounters read): every lookup it makes is in.
    await waitFor(() => expect(sent.some(call => call.route === ENCOUNTERS)).toBe(true))
    const lookups = sent.filter(call => call.route === LOOKUP).length
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Work at Riverside Annex (fictional)' }))
    await waitFor(() => expect(within(screen.getByRole('banner')).getByText('Riverside Annex (fictional)')).toBeDefined())
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    // Back on Patients, nothing is open: the search, and no further lookup.
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Patients' }))
    await waitFor(() => expect(where()).toBe('/provider/patients'))
    expect(await screen.findByRole('textbox', { name: 'Search Patients' })).toBeDefined()
    expect(document.body.textContent).not.toContain(PATIENT_NAME)
    expect(sent.filter(call => call.route === LOOKUP)).toHaveLength(lookups)
  })

  it('locks while the session is checked, and the lock screen is used by keyboard', async () => {
    let visibility: DocumentVisibilityState = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    // The check on return gets an answer the portal cannot read; Try again gets the session.
    serve({ [SESSION]: [sessionAt(riverside(), [riverside()]), () => json({}), sessionAt(riverside(), [riverside()])] })
    await openStaffApp('/provider')
    await expectBlueHome()
    const menu = screen.getByRole('button', { name: 'Account menu' })
    act(() => { menu.focus() })

    act(() => {
      visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange'))
      now += 61_000
      visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange'))
    })
    const tryAgain = await screen.findByRole('button', { name: 'Try again' })
    // The workspace is out of reach under the lock; its controls are not.
    expect(menu.closest('[inert]')).not.toBeNull()
    expect(tryAgain.closest('[inert], [hidden]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign out' }).closest('[inert], [hidden]')).toBeNull()
    // Focus is on the lock screen, and Tab moves through it as the browser does: nothing in the shell takes the key.
    await waitFor(() => expect(document.activeElement?.closest('[inert]')).toBeNull())
    act(() => { tryAgain.focus() })
    expect(fireEvent.keyDown(tryAgain, { key: 'Tab' })).toBe(true)
    expect(fireEvent.keyDown(tryAgain, { key: 'Tab', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(window, { key: 'k', ctrlKey: true })).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Search Health ID' })).toBeNull()

    // Enter on Try again (a button's click): the session is confirmed and the workspace comes back.
    fireEvent.click(tryAgain)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull())
    expect(menu.closest('[inert]')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
  })

  it('signs out from the account menu with its CSRF token and client name', async () => {
    vi.spyOn(document, 'cookie', 'get').mockReturnValue('hid_access_csrf=csrf-staff')
    const sent = serve({ [SESSION]: [sessionAt(riverside(), [riverside()])], [LOGOUT]: [() => new Response(null, { status: 204 })] })
    await openStaffApp('/provider')
    await expectBlueHome()
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Account' })).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(where()).toBe('/provider/sign-in'))
    const logout = sent.find(call => call.route === LOGOUT)
    expect(logout?.headers.get('X-CSRF-Token')).toBe('csrf-staff')
    expect(logout?.headers.get('X-HID-Client')).toBe('staff-web')
    expect(sent.filter(call => call.route === SESSION).every(call => call.headers.get('X-HID-Client') === null)).toBe(true)
  })
})
