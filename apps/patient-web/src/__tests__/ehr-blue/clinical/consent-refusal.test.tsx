import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from '../frame/blueHarness'

/**
 * Access requests opened from a link or a typed address by a role without identity.consent.write, in the blue EHR at a
 * clinic (the clinic switch on, the real merged registry). Today's portal has no gate there and says why in its own
 * words (staff/routes/AccessRequests.tsx:33-43,118; Patients.tsx:244); the blue page says the same, reading nothing. The
 * patient PIN needs no identity.consent.write. Every account, facility and patient here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const DENIED_NOTICE = 'Your current permissions no longer allow that page. Choose an authorized workflow.'

function openAs(permissions: readonly string[], path: string) {
  const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)
  const sent = serve({ [SESSION]: many(sessionAt(riverside, [riverside])), [REQUESTS]: many(() => json([])) })
  return { sent, opened: openStaffApp(path) }
}

describe('Access requests without identity.consent.write', () => {
  it('names the permission a new request needs, in today’s words, and reads nothing', async () => {
    const { sent, opened } = openAs(['identity.patient.read'], '/provider/requests/new')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Ask the patient for access' })).toBeDefined()
    expect(screen.getByText('Your role at this facility cannot ask patients for access: it needs identity.consent.write. Ask your organization administrator.')).toBeDefined()
    expect(where()).toBe('/provider/requests/new')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
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

  it('opens the patient PIN at Patients, which needs no identity.consent.write', async () => {
    const { sent, opened } = openAs(['identity.patient.read', 'identity.patient-access-pin.verify'], '/provider/requests/pin')
    await opened
    expect(await screen.findByRole('heading', { level: 1, name: 'Use the patient’s Access PIN' })).toBeDefined()
    expect(where()).toBe('/provider/patients/pin')
    expect(screen.queryByText(DENIED_NOTICE)).toBeNull()
    expect(sent.some(call => call.route === REQUESTS)).toBe(false)
  })
})
