import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, FACILITY, REAL_FACILITY, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, serve, sessionAt,
  withFramePages,
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

async function openHome(roles: readonly string[], session = sessionAt,
  at = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], roles)) {
  serve({ [SESSION]: [session(at, [at])], [REQUESTS]: many(() => json([])) })
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

  // What real staff see every day: the roles alone, with no demo label after them.
  it('names them at a real facility, with nothing after them', async () => {
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write'], ['org_admin', 'doctor'])
    await openHome([], sessionAt, riverside)
    expect(screen.getAllByText('Facility administrator, Doctor').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Demo facility/)).toBeNull()
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

/**
 * Joining another facility signed in (Novu): the blue invitation page sends existing staff to /provider/staff/join,
 * which the frame shows as today's page. A role Health ID has no name for reads "a staff member" there too.
 */
describe('Join a facility', () => {
  it('names the role in its sentences, "a staff member" for one it has no name for, never its code', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const laboratory = facility(DEMO_LABORATORY, 'Demo Laboratory', [], ['lab_scientist'])
    serve({
      [SESSION]: [sessionAt(demo, [demo]), sessionAt(laboratory, [demo, laboratory])], [REQUESTS]: many(() => json([])),
      'POST /api/v1/identity/staff-invitations/signed-in/preview': [() => json({ invitationId: 'invitation-demo-1',
        facilityId: DEMO_LABORATORY, facilityName: 'Demo Laboratory', roleCode: 'lab_scientist', inviterName: 'Demo Administrator',
        expiresAt: '2026-11-08T09:30:00.000Z' })],
      'POST /api/v1/identity/staff-invitations/signed-in/accept': [() => json({ accepted: true, facilityId: DEMO_LABORATORY,
        membershipId: `member-${DEMO_LABORATORY}`, facilityName: 'Demo Laboratory', roleCode: 'lab_scientist' })],
      [FACILITY]: [sessionAt(laboratory, [demo, laboratory])],
    })
    await openStaffApp('/provider/staff/join')
    fireEvent.change(await screen.findByLabelText('Invitation code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Join Demo Laboratory as a staff member' })).toBeDefined()
    expect(document.body.textContent).not.toMatch(CODES)
    fireEvent.click(screen.getByRole('button', { name: 'Join Demo Laboratory' }))
    expect(await screen.findByText(/^You’re now working at Demo Laboratory as a staff member\./)).toBeDefined()
    expect(document.body.textContent).not.toMatch(CODES)
  })
})
