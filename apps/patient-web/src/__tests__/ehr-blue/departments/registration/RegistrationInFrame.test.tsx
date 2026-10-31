import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../../ehr-blue/routes'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../../frame/blueHarness'

/*
 * Patient registration inside the blue EHR's frame, in place of its live stand-in (today's page at
 * /provider/registration): listed where it was, refused in today's words without its permission (and reading nothing),
 * and offering a next step only to a live page this session may open. Every account, facility and case is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The frame's own registry and Home, with this page joining it as departments/pages.ts will. Registered per test: a
// vi.mock factory's module outlives vi.resetModules.
beforeEach(() => {
  vi.doMock('../../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../../ehr-blue/frame/pages')
    const home = await import('../../../../ehr-blue/home/pages')
    const { registrationPage } = await import('../../../../ehr-blue/departments/registration/page')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': { pages: [registrationPage] } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const CAPABILITIES = 'GET /api/v1/identity/registration-capabilities'
const CASE = 'c0000000-0000-4000-8000-000000000001'
const CASE_READ = `GET /api/v1/identity/registration-cases/${CASE}`
const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const enabled = () => json({ nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true })
const approved = () => json({ caseId: CASE, status: 'approved_new_identity', version: 2, candidateCount: 0,
  patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ZDEMAAA2' } })
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })

describe('Patient registration in the frame', () => {
  it('replaces the stand-in at /provider/registration, listed where it was', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.write', 'identity.registration.approve'], ['records_officer'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled) })
    await openStaffApp('/provider/registration')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(where()).toBe('/provider/registration')
    // The blue page's own heading, not today's ("Patient registration." in the stand-in).
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Patient registration')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeDefined()
    expect(await screen.findByText('NIN verification is enabled in test-only mode.')).toBeDefined()
    const link = within(nav()).getByRole('link', { name: 'Patient registration' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.getAttribute('href')).toBe('/provider/registration')
    expect(sent.filter(call => call.route === CAPABILITIES).length).toBeGreaterThan(0)
  })

  it('without identity registration write, shows today\'s refusal at the address and reads nothing', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.approve'], ['records_officer'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled) })
    await openStaffApp('/provider/registration')
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration unavailable' })).toBeDefined()
    expect(screen.getByText('This facility membership needs identity registration write permission.')).toBeDefined()
    expect(screen.queryByText(/is not open to you here$/)).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Patient registration' })).toBeNull()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('offers "Open consent" as a next step where External record access is open to this session, and nothing of the case goes with it', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital',
      ['identity.registration.write', 'identity.registration.approve', 'identity.consent.write'], ['records_officer'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled), [CASE_READ]: [approved], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider/registration')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE}` })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeDefined()
    // Appointments and Patient visits are samples here: not offered.
    expect(screen.queryByRole('link', { name: 'Open appointments' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Register walk-in visit' })).toBeNull()
    const consent = screen.getByRole('link', { name: 'Open consent' })
    expect(consent.getAttribute('href')).toBe('/provider/requests')
    fireEvent.click(consent)
    await waitFor(() => expect(where()).toBe('/provider/requests'))
    expect(where()).not.toContain(CASE)
  })

  it('offers no next step where none leads to a live page this session may open', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.write', 'identity.registration.approve'], ['records_officer'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled), [CASE_READ]: [approved] })
    await openStaffApp('/provider/registration')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    expect(await screen.findByRole('heading', { level: 1, name: `Case ${CASE}` })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
  })
})
