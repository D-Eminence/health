import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, serve, sessionAt, withFramePages,
} from './blueHarness'

/**
 * Role names, not role codes, wherever the frame shows a person's roles (parity report 3.1 #16): under the facility
 * name in the sidebar's switcher, in the person's line when there is no email, and on Choose workspace. A role Health
 * ID has no name for reads "Staff"; its code is never shown. Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const CODES = /\b(org_admin|org_admin_awaiting_review|records_officer|outreach_officer|lab_scientist)\b/

async function openHome(roles: readonly string[], session = sessionAt) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], roles)
  serve({ [SESSION]: [session(demo, [demo])], [REQUESTS]: many(() => json([])) })
  await openStaffApp('/provider')
  await screen.findByRole('heading', { level: 1, name: homeHeading() })
}

describe('the roles under the facility name', () => {
  it.each(['main-v1', 'novu-v1'])('names them on a %s build, never by their codes', async contract => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    await openHome(['org_admin', 'doctor'])
    expect(screen.getAllByText('Facility administrator, Doctor · Demo facility').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(CODES)
    expect(screen.queryByText(/org_admin, doctor/)).toBeNull()
  })

  it('names the administrator once, whichever of its two roles the person holds', async () => {
    await openHome(['org_admin_awaiting_review', 'org_admin', 'lab'])
    expect(screen.getAllByText('Facility administrator, Laboratory scientist · Demo facility').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(CODES)
  })

  it('reads "Staff" for a role Health ID has no name for, and never shows its code', async () => {
    await openHome(['records_officer'])
    expect(screen.getAllByText('Staff · Demo facility').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(CODES)
  })

  it('leaves out a role it has no name for beside one it has', async () => {
    await openHome(['nurse', 'records_officer'])
    expect(screen.getAllByText('Nurse · Demo facility').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(CODES)
  })
})

describe('the person\'s line, for an account with no email', () => {
  it('names the roles there too', async () => {
    const noEmail: typeof sessionAt = (current, facilities) => () => json({
      actor: { id: 'staff-demo-1', email: null, displayName: 'Demo Clinician', roles: ['clinician'], permissions: [], facilities, facility: current },
      expiresAt: '2026-11-30T12:00:00.000Z',
    })
    await openHome(['org_admin', 'doctor'], noEmail)
    const person = screen.getByRole('button', { name: 'Demo Clinician: account' }).parentElement as HTMLElement
    expect(within(person).getByText('Facility administrator, Doctor')).toBeDefined()
    expect(document.body.textContent).not.toMatch(CODES)
  })
})

describe('Choose workspace', () => {
  it.each(['main-v1', 'novu-v1'])('names each facility\'s roles on a %s build, and "Staff" for one it has no name for', async contract => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [], ['org_admin', 'doctor'])
    const laboratory = facility(DEMO_LABORATORY, 'Demo Laboratory', [], ['lab_scientist'])
    serve({ [SESSION]: [sessionAt(demo, [demo, laboratory])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Choose workspace' }))
    await screen.findByRole('heading', { level: 1, name: 'Switch facility' })
    const card = (name: string) => screen.getByRole('heading', { level: 2, name }).closest('li') as HTMLElement
    expect(within(card('Demo Hospital')).getByText('Facility administrator, Doctor')).toBeDefined()
    expect(within(card('Demo Laboratory')).getByText('Staff')).toBeDefined()
    expect(document.body.textContent).not.toMatch(CODES)
  })
})
