import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { App } from '../App'

/**
 * The production patient portal (app.healthidentitydirectory.com) serves patients only (owner, 2026-11-01). However
 * its app reaches a staff page (/provider or any page under it: an address opened in the app, a link inside it, the
 * installed app), it opens the same page on the EHR site at once, with its path, query and fragment: no step of its own,
 * no "Continue", and the staff workspace never loads there. An admin site does the same. Staging's portal and each
 * product site keep all their own staff pages.
 */
const calls = vi.hoisted(() => ({
  patientSession: vi.fn(), patientRefresh: vi.fn(), staffSession: vi.fn(), staffRefresh: vi.fn(), staffLogout: vi.fn(),
  adminSession: vi.fn(), adminRefresh: vi.fn(),
}))

const localEnvironment = { name: 'local', apiBaseUrl: 'http://localhost:3000', turnstileSiteKey: null }

vi.mock('../env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../staff/env', () => ({ getEnvironment: () => localEnvironment }))
vi.mock('../admin/env', () => ({ environment: () => localEnvironment }))
vi.mock('../api', () => ({
  createPatientApi: () => ({ session: calls.patientSession, refresh: calls.patientRefresh,
    onSessionAccepted: () => () => undefined,
    ...Object.fromEntries(['enrollmentCurrent', 'googleOnboarding', 'profile', 'enrollmentAvailability', 'participatingFacilities',
      'records', 'accessHistory', 'accessRequests', 'notifications', 'accessLog', 'profileDetails', 'healthProfile',
      'emergencyContactsAvailability', 'emergencyContacts', 'photo', 'shareInvitations']
      .map(name => [name, () => Promise.reject(new HidApiError(404, 'Not served'))])) }),
}))
vi.mock('../staff/api', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  staffApi: { session: calls.staffSession, refresh: calls.staffRefresh, logout: calls.staffLogout },
}))
vi.mock('../staff/clinicianApplicationApi', () => ({
  clinicianApplicationApi: { availability: vi.fn().mockResolvedValue({ open: false }), current: vi.fn() },
  newClinicianIdempotencyKey: () => 'key-1',
  CLINICIAN_REGULATOR_OF: { doctor: 'MDCN', nurse: 'NMCN' },
}))
vi.mock('../admin/api', () => ({
  adminApi: { session: calls.adminSession, refresh: calls.adminRefresh },
  adminSessionAccount: () => null, setAdminSessionAccount: () => undefined, closeAdminSession: () => undefined,
}))

const EHR = 'https://ehr.healthidentitydirectory.com'
const EHR_SIGN_IN = `${EHR}/provider/sign-in`
const replace = vi.fn()

function serveFrom(hostname: string) {
  vi.stubGlobal('location', { ...window.location, hostname, replace })
}

function Path() {
  return <output data-testid="portal-path">{useLocation().pathname}</output>
}

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Path /><Link to="/provider/sign-in">In-app staff link</Link>
    <Link to="/provider/clinical">In-app workspace link</Link><App /></MemoryRouter>)
}

/** Lets any lazy page (the staff workspace) load and any session question be asked. */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
}

beforeEach(() => {
  vi.clearAllMocks()
  const signedOut = new HidApiError(401, 'Sign in required')
  for (const call of [calls.patientSession, calls.patientRefresh, calls.staffSession, calls.staffRefresh, calls.adminSession,
    calls.adminRefresh]) call.mockRejectedValue(signedOut)
  calls.staffLogout.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('on the production portal, every staff page is the same page on the EHR site', () => {
  it.each(['/provider', '/provider/', '/provider/sign-in', '/provider/sign-in/', '/Provider/Sign-In',
    '/provider/sign-in?returnTo=/provider/clinical', '/provider?returnTo=/provider/laboratory', '/provider/recover',
    '/provider/enroll?product=laboratory', '/provider/invitation#2f6c1a.token', '/provider/join', '/provider/join/status',
    '/provider/staff/join', '/provider/clinical'])(
    'opening %s replaces the page with the EHR site’s at once, and the staff workspace never loads', async path => {
      serveFrom('app.healthidentitydirectory.com')
      open(path)
      const target = `${EHR}${path}`
      expect(screen.getByText('Opening Health ID EHR…').getAttribute('role')).toBe('status')
      expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(target)
      await settle()
      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith(target)
      expect(calls.staffSession).not.toHaveBeenCalled()
      expect(calls.staffRefresh).not.toHaveBeenCalled()
      expect(screen.queryByRole('heading')).toBeNull()
      expect(screen.queryByRole('textbox')).toBeNull()
      expect(screen.queryByText(/continue/i)).toBeNull()
    })

  it('a link inside the app to the staff sign-in opens it the same way', async () => {
    serveFrom('app.healthidentitydirectory.com')
    open('/sign-in')
    expect(await screen.findByLabelText('Email, phone or Health ID')).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: 'In-app staff link' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith(EHR_SIGN_IN))
    expect(screen.getByText('Opening Health ID EHR…').getAttribute('role')).toBe('status')
    await settle()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(calls.staffSession).not.toHaveBeenCalled()
  })

  it('a link inside the app to a workspace page opens that page on the EHR site, with no step of the portal’s own', async () => {
    serveFrom('app.healthidentitydirectory.com')
    open('/sign-in')
    expect(await screen.findByLabelText('Email, phone or Health ID')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'In-app workspace link' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`${EHR}/provider/clinical`))
    await settle()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/clinical')
    expect(calls.staffSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
    expect(screen.queryByText(/continue/i)).toBeNull()
  })

  it('keeps the portal’s patient pages, and addresses that only look like staff pages, its own', async () => {
    serveFrom('app.healthidentitydirectory.com')
    for (const path of ['/sign-in', '/recover', '/providers', '/provider-sign-in']) {
      const { unmount } = open(path)
      await settle()
      expect(replace, path).not.toHaveBeenCalled()
      expect(screen.queryByText('Opening Health ID EHR…'), path).toBeNull()
      unmount()
    }
  })
})

describe('an admin site serves no staff pages either', () => {
  it.each([
    ['admin.healthidentitydirectory.com', EHR],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com'],
  ])('on %s, a staff page opens the same page on %s', async (hostname, origin) => {
    serveFrom(hostname)
    open('/provider/recover')
    await settle()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(`${origin}/provider/recover`)
    expect(calls.staffSession).not.toHaveBeenCalled()
  })
})

describe('elsewhere, every staff page stays each site’s own', () => {
  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com',
    'staging.healthidentitydirectory.com'])(
    'on %s, /provider/sign-in shows the sign-in form and opens nothing else', async hostname => {
      serveFrom(hostname)
      open('/provider/sign-in')
      expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back.' })).toBeTruthy()
      expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
      expect(replace).not.toHaveBeenCalled()
      expect(screen.queryByText('Opening Health ID EHR…')).toBeNull()
    })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com'])(
    'on %s, /provider/recover is the site’s own password recovery', async hostname => {
      serveFrom(hostname)
      open('/provider/recover')
      expect(await screen.findByRole('heading', { level: 1, name: 'Recover account access' })).toBeTruthy()
      expect(screen.getByRole('textbox', { name: /email/i })).toBeTruthy()
      await settle()
      expect(replace).not.toHaveBeenCalled()
    })
})
