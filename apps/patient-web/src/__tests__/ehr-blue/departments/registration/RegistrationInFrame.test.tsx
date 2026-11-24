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
    // Patients, where a registered patient is handed on to ("Open in Patients").
    const clinical = await import('../../../../ehr-blue/clinical/pages')
    const patients = clinical.pages.filter(page => page.path === 'patients/*')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './clinical/pages.ts': { pages: patients },
        './departments/pages.ts': { pages: [registrationPage] } }),
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
// SX-10: the registration list, read as the page opens.
const LIST = 'GET /api/v1/identity/registration-cases'
const listed = () => json({ view: 'mine', nextCursor: null, cases: [{ caseId: CASE, status: 'approved_new_identity', version: 2,
  candidateCount: 0, contactRecorded: true, ninStatus: 'verified', identityEvidence: 'nin',
  patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ZDEMAAA2' }, fullName: 'Patient One', dateOfBirth: '1990-01-02',
  createdAt: '2026-11-20T09:15:00.000Z', updatedAt: '2026-11-21T10:30:00.000Z', createdByMe: true }] })

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
    // NIN checks work, so classic's card is not shown: only its loading line, until the answer.
    await waitFor(() => expect(screen.queryByText('Checking NIN checks are working…')).toBeNull())
    expect(screen.queryByText(/NIN checks are/)).toBeNull()
    const link = within(nav()).getByRole('link', { name: 'Patient registration' })
    expect(link.getAttribute('aria-current')).toBe('page')
    expect(link.getAttribute('href')).toBe('/provider/registration')
    expect(sent.filter(call => call.route === CAPABILITIES).length).toBeGreaterThan(0)
  })

  it('lists My registrations through the gateway, and opens one by GET :caseId with nothing of it in the address', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.write'], ['receptionist'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled), [LIST]: many(listed), [CASE_READ]: [approved] })
    await openStaffApp('/provider/registration')
    const table = await screen.findByRole('region', { name: 'My registrations' })
    const read = sent.find(call => call.route === LIST)
    expect(read?.headers.get('X-Facility-ID')).toBe(DEMO_HOSPITAL)
    expect(read?.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    expect(within(table).getByText('NIN Verified')).toBeDefined()
    fireEvent.click(within(table).getByRole('button', { name: 'Patient One' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Registration for Patient One' })).toBeDefined()
    expect(sent.some(call => call.route === CASE_READ)).toBe(true)
    expect(where()).toBe('/provider/registration')
  })

  it('without identity registration write, refuses at the address in plain words that name no permission, and reads nothing', async () => {
    // A nurse: a role that does not register patients.
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.approve'], ['nurse'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled) })
    await openStaffApp('/provider/registration')
    const title = await screen.findByRole('heading', { level: 1, name: 'You can’t register patients here' })
    // The two roles that register patients, by their words (owner's answer, 2 Nov 2026), never their codes.
    expect(screen.getByText('Your role at this facility doesn’t include registering patients. Ask your facility administrator for the Receptionist or Records officer role.')).toBeDefined()
    // The frame names the person's own role, which is neither of them.
    expect(screen.getAllByText(/^Nurse\b/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Records officer\b/)).toBeNull()
    expect(title.closest('.hid-ehr-dept')?.textContent).not.toMatch(/permission|membership|registration write|identity\.registration\.write/i)
    expect(title.closest('.hid-ehr-dept')?.textContent).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/)
    expect(screen.queryByText(/is not open to you here$/)).toBeNull()
    expect(within(nav()).queryByRole('link', { name: 'Patient registration' })).toBeNull()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('a records officer without identity registration write is not told to ask for the role the frame names as theirs', async () => {
    // A facility's own grants can differ from the roles' usual ones (owner's answer: both roles register patients).
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.registration.approve'], ['records_officer'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled) })
    await openStaffApp('/provider/registration')
    const title = await screen.findByRole('heading', { level: 1, name: 'You can’t register patients here' })
    expect(screen.getAllByText(/^Records officer\b/).length).toBeGreaterThan(0)
    expect(screen.getByText('Your role at this facility doesn’t include registering patients. Ask your facility administrator.')).toBeDefined()
    expect(title.closest('.hid-ehr-dept')?.textContent).not.toMatch(/Receptionist|Records officer|\b[a-z]+(?:_[a-z]+)+\b/)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(sent.map(call => call.route)).toEqual([SESSION])
  })

  it('offers "Open consent" as a next step where External record access is open to this session, and nothing of the case goes with it', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital',
      ['identity.registration.write', 'identity.registration.approve', 'identity.consent.write'], ['records_officer'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled), [CASE_READ]: [approved], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider/registration')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })).toBeDefined()
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
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    // Patients is not open to a role without patient lookup: no way there is offered.
    expect(screen.queryByRole('link', { name: 'Open in Patients' })).toBeNull()
  })

  it('hands a registered patient on to Patients with their Health ID filled in, where Patients is open to this session', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital',
      ['identity.registration.write', 'identity.registration.approve', 'identity.patient.read'], ['records_officer'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [CAPABILITIES]: many(enabled), [CASE_READ]: [approved] })
    await openStaffApp('/provider/registration')
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Earlier registration' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeDefined()
    const patients = screen.getByRole('link', { name: 'Open in Patients' })
    expect(patients.getAttribute('href')).toBe('/provider/patients')
    fireEvent.click(patients)
    await waitFor(() => expect(where()).toBe('/provider/patients'))
    // Only the Health ID goes with it, in navigation state, never in the address.
    expect(where()).not.toContain(CASE)
    expect(where()).not.toContain('HID-')
    expect((await screen.findByRole('textbox', { name: 'Health ID' }) as HTMLInputElement).value).toBe('HID-ZDEMAAA2')
  })
})
