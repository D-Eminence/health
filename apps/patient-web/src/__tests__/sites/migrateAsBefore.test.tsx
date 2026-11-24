import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  facility, FACILITY, homeHeading, json, openStaffApp, problem, REAL_FACILITY, REQUESTS, serve, sessionAt, switchFacilityTo, where,
} from '../ehr-blue/frame/blueHarness'
import { backToTestSite, LOGIN, onSite, REFRESH, SESSION } from './siteHarness'

/**
 * Health ID Migrate works as it did before website release C (owner, 24 November 2026: "i need migrate to work smoothly
 * as it has before"). On migrate. (and the other single-product sites) every arrival at /provider opens the product's
 * own page for a member who can use it: a sign-in and its return address, a facility switch, the brand, and a page of
 * the hospital EHR's sent back. The front desk (hid-system 0136: ocr.job.read-own, no ocr.job.read) signs in to Scan
 * paper records too. The full EHR site keeps its Home. Every account and facility here is fictional.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const MIGRATE = 'migrate.healthidentitydirectory.com'
const EHR = 'ehr.healthidentitydirectory.com'
const OTHER_FACILITY = 'f0000000-0000-4000-8000-000000000002'

/** The front desk's Migrate codes since hid-system 0136: its own readings and documents, never ocr.job.read. */
const RECEPTIONIST = ['ocr.job.read-own', 'ocr.job.write', 'ocr.job.start', 'ehr.document.read-own', 'ehr.document.write']
/** A nurse's: every reading, and starting them. */
const NURSE = ['ocr.job.read', 'ocr.job.write', 'ocr.job.start', 'ehr.document.read', 'ehr.document.write']

const many = <T,>(answer: T, count = 12): T[] => Array.from({ length: count }, () => answer)

function Address() {
  const { pathname } = useLocation()
  return <output data-testid="where">{pathname}</output>
}

/** The portal on `hostname` at `path`, signed out, then signed in with the blue sign-in as `roles` holding `permissions`. */
async function signInOn(hostname: string, path: string, permissions: readonly string[], roles: readonly string[]) {
  const here = facility(REAL_FACILITY, 'Fictional Records Office', permissions, roles)
  const signedOut = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')
  serve({ [SESSION]: [signedOut], [REFRESH]: [signedOut], [LOGIN]: [sessionAt(here, [here])], [REQUESTS]: many(() => json([])) })
  onSite(hostname, path)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Address /><App /></MemoryRouter>)
  fireEvent.change(await screen.findByRole('textbox', { name: 'Work email' }), { target: { value: 'front.desk@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional passphrase for tests' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

/** Waits for the address to settle on `path` and stay there. */
async function settlesOn(path: string) {
  await waitFor(() => expect(where()).toBe(path))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(where()).toBe(path)
}

/** The blue frame on `hostname` at `path`, signed in at a fictional facility (and another to switch to). */
async function openOn(hostname: string, path: string, permissions: readonly string[], roles: readonly string[] = ['nurse']) {
  const here = facility(REAL_FACILITY, 'Fictional Records Office', permissions, roles)
  const other = facility(OTHER_FACILITY, 'Fictional Annex Clinic', permissions, roles)
  const sent = serve({ [SESSION]: [sessionAt(here, [here, other])], [FACILITY]: [sessionAt(other, [here, other])], [REQUESTS]: many(() => json([])) })
  onSite(hostname, path)
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe(`${MIGRATE}: /provider opens Scan paper records, however it is reached`, () => {
  it('a sign-in returning to /provider lands on Scan paper records', async () => {
    await signInOn(MIGRATE, `/provider/sign-in?returnTo=${encodeURIComponent('/provider')}`, NURSE, ['nurse'])
    await settlesOn('/provider/ocr')
    expect(screen.queryByRole('heading', { level: 1, name: homeHeading() })).toBeNull()
  })

  it('a nurse\'s sign-in lands on Scan paper records, as before', async () => {
    await signInOn(MIGRATE, '/provider/sign-in', NURSE, ['nurse'])
    await settlesOn('/provider/ocr')
  })

  it('the front desk\'s sign-in lands on Scan paper records, not on Home', async () => {
    await signInOn(MIGRATE, '/provider/sign-in', RECEPTIONIST, ['receptionist'])
    await settlesOn('/provider/ocr')
    expect(screen.queryByRole('heading', { level: 1, name: homeHeading() })).toBeNull()
    expect(document.body.textContent).not.toMatch(/permission/i)
  })

  it('a facility switch from the facility menu lands on Scan paper records', async () => {
    const sent = await openOn(MIGRATE, '/provider/ocr', NURSE)
    await waitFor(() => expect(where()).toBe('/provider/ocr'))
    switchFacilityTo('Fictional Records Office', 'Fictional Annex Clinic')
    await waitFor(() => expect(sent.some(call => call.route === FACILITY)).toBe(true))
    await settlesOn('/provider/ocr')
    expect(screen.queryByRole('heading', { level: 1, name: homeHeading() })).toBeNull()
  })

  it('a facility switch on the Switch facility page lands on Scan paper records', async () => {
    await openOn(MIGRATE, '/provider/institutions', NURSE)
    fireEvent.click(await screen.findByRole('radio', { name: /Fictional Annex Clinic/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch facility' }))
    await settlesOn('/provider/ocr')
  })

  it('the brand leads to Scan paper records, and no Home is listed', async () => {
    await openOn(MIGRATE, '/provider/audit', [...NURSE, 'audit.read'])
    const menu = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(menu.queryByRole('link', { name: 'Home' })).toBeNull()
    fireEvent.click(screen.getAllByRole('link', { name: 'Health ID Migrate home' })[0]!)
    await settlesOn('/provider/ocr')
  })

  it.each([['a nurse', NURSE, ['nurse']], ['the front desk', RECEPTIONIST, ['receptionist']]] as const)(
    'Patient registration, typed, opens Scan paper records for %s', async (_who, permissions, roles) => {
      await openOn(MIGRATE, '/provider/registration', [...permissions, 'identity.registration.write'], roles)
      await settlesOn('/provider/ocr')
      expect(opened).not.toHaveBeenCalled()
    })
})

describe(`${EHR} is unchanged`, () => {
  it('a sign-in returning to /provider lands on Home', async () => {
    await signInOn(EHR, `/provider/sign-in?returnTo=${encodeURIComponent('/provider')}`, ['identity.patient.read', ...NURSE], ['nurse'])
    await settlesOn('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
  })

  it('the brand and a facility switch lead to Home', async () => {
    const sent = await openOn(EHR, '/provider/audit', ['identity.patient.read', 'audit.read', ...NURSE])
    fireEvent.click(screen.getAllByRole('link', { name: 'Health ID EHR home' })[0]!)
    await settlesOn('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    switchFacilityTo('Fictional Records Office', 'Fictional Annex Clinic')
    await waitFor(() => expect(sent.some(call => call.route === FACILITY)).toBe(true))
    await settlesOn('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
  })

  it('shows the front desk the Health ID Migrate card and the Document OCR workspace on Home', async () => {
    await openOn(EHR, '/provider', RECEPTIONIST, ['receptionist'])
    const migrate = within(await screen.findByRole('region', { name: 'Health ID Migrate' }))
    expect(migrate.getByRole('link', { name: 'Open document workflow' }).getAttribute('href')).toBe('/provider/ocr')
    const workspaces = within(screen.getByRole('region', { name: 'Workspaces' }))
    expect(workspaces.getByText('Document OCR')).toBeDefined()
    expect(workspaces.queryByText(/no clinical modules/)).toBeNull()
  })
})
