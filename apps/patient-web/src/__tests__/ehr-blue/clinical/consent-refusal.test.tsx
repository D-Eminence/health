import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../frame/blueHarness'

/**
 * Access requests opened from a link or a typed address by a role without identity.consent.write, in the blue EHR at a
 * clinic (the clinic switch on, the real merged registry). Today's portal has no gate there and says why
 * (staff/routes/AccessRequests.tsx:33-43,118); the blue page says why too, reading nothing, and a new request says it in
 * plain words without the permission's name. The patient PIN needs no identity.consent.write. Every account, facility
 * and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const DENIED_NOTICE = 'Your current permissions no longer allow that page. Choose an authorized workflow.'

/** No permission name, code or dotted id on the page. */
const NO_PERMISSION_NAME = /identity\.|consent\.write|permission/

function openAs(permissions: readonly string[], path: string, selfService?: { review: string; organizationType: string }) {
  const riverside = { ...facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions), ...(selfService ? { selfService } : {}) }
  const sent = serve({ [SESSION]: many(sessionAt(riverside, [riverside])), [REQUESTS]: many(() => json([])) })
  return { sent, opened: openStaffApp(path) }
}

describe('Access requests without identity.consent.write', () => {
  it('says plainly that the role can’t ask patients for access, without the permission’s name, and reads nothing', async () => {
    const { sent, opened } = openAs(['identity.patient.read'], '/provider/requests/new')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Ask the patient for access' })).toBeDefined()
    expect(screen.getByText('Your role at this facility can’t ask patients for access. Ask your facility administrator.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(NO_PERMISSION_NAME)
    expect(where()).toBe('/provider/requests/new')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })

  it.each([
    ['pending', 'You are this facility’s administrator. Health ID support gives your own role clinical access when it checks your facility: add your licence on the Staff page.'],
    ['reviewed', 'You are this facility’s administrator. Health ID support gives your own role clinical access; ask them, or invite a colleague who holds this role.'],
  ] as const)('tells a self-signed-up facility’s own administrator (review %s) who gives clinical access, not to ask themselves', async (review, who) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const { sent, opened } = openAs(['workforce.manage'], '/provider/requests/new', { review, organizationType: 'clinic' })
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Ask the patient for access' })).toBeDefined()
    expect(screen.getByText(`Your role at this facility can’t ask patients for access. ${who}`)).toBeDefined()
    expect(document.body.textContent).not.toMatch(/Ask your facility administrator/)
    expect(document.body.textContent).not.toMatch(NO_PERMISSION_NAME)
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })

  it('says today’s list refusal at the list’s address, and reads nothing', async () => {
    const { sent, opened } = openAs(['identity.patient.read'], '/provider/requests')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Access requests' })).toBeDefined()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Your role at this facility cannot list access requests. Ask an administrator to review your assignment.')
    expect(where()).toBe('/provider/requests')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })

  it('says today’s list refusal at a request’s own address, and reads nothing', async () => {
    const { sent, opened } = openAs(['identity.patient.read'], '/provider/requests/r0000000-0000-4000-8000-000000000001')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Access requests' })).toBeDefined()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Your role at this facility cannot list access requests. Ask an administrator to review your assignment.')
    expect(where()).toBe('/provider/requests/r0000000-0000-4000-8000-000000000001')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })

  it('opens the patient PIN at Patients, which needs no identity.consent.write', async () => {
    const { sent, opened } = openAs(['identity.patient.read', 'identity.patient-access-pin.verify'], '/provider/requests/pin')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Use the patient’s Access PIN' })).toBeDefined()
    expect(where()).toBe('/provider/patients/pin')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })
})
