import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { App } from '../App'

/**
 * The production patient portal (app.healthidentitydirectory.com) serves patients only (owner, 2026-11-01). However
 * its app reaches the staff entrance or sign-in (an address opened in the app, a link inside it, the workspace sending a
 * stranger to sign in), it opens the EHR site's sign-in at once: no step of its own, no "Continue", and the staff
 * workspace never loads there. Staging's portal and the product sites keep their own staff sign-in.
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

const EHR_SIGN_IN = 'https://ehr.healthidentitydirectory.com/provider/sign-in'
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

describe('on the production portal, the staff entrance and sign-in are the EHR site’s sign-in', () => {
  it.each(['/provider', '/provider/', '/provider/sign-in', '/provider/sign-in/', '/Provider/Sign-In',
    '/provider/sign-in?returnTo=https://evil.example', '/provider?returnTo=/provider/laboratory'])(
    'opening %s replaces the page with it at once, and the staff workspace never loads', async path => {
      serveFrom('app.healthidentitydirectory.com')
      open(path)
      expect(screen.getByText('Opening the EHR sign-in…').getAttribute('role')).toBe('status')
      expect(screen.getByRole('link', { name: 'Go to the EHR sign-in' }).getAttribute('href')).toBe(EHR_SIGN_IN)
      await settle()
      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith(EHR_SIGN_IN)
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
    expect(screen.getByText('Opening the EHR sign-in…').getAttribute('role')).toBe('status')
    await settle()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(calls.staffSession).not.toHaveBeenCalled()
  })

  it('a workspace page sends a stranger to sign in, which is the EHR site’s, with no step of the portal’s own', async () => {
    serveFrom('app.healthidentitydirectory.com')
    open('/sign-in')
    expect(await screen.findByLabelText('Email, phone or Health ID')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'In-app workspace link' }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith(EHR_SIGN_IN))
    expect(screen.getByTestId('portal-path').textContent).toBe('/provider/sign-in')
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
    expect(screen.queryByText(/continue/i)).toBeNull()
  })

  it('keeps the portal’s staff recovery, facility sign-up and clinician pages, which Identity accepts only there for now', async () => {
    serveFrom('app.healthidentitydirectory.com')
    for (const path of ['/provider/recover', '/provider/enroll', '/provider/join']) {
      const { unmount } = open(path)
      await settle()
      expect(replace, path).not.toHaveBeenCalled()
      expect(screen.queryByText('Opening the EHR sign-in…'), path).toBeNull()
      unmount()
    }
  })
})

describe('elsewhere, the staff sign-in stays each site’s own', () => {
  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'staging.healthidentitydirectory.com'])(
    'on %s, /provider/sign-in shows the sign-in form and opens nothing else', async hostname => {
      serveFrom(hostname)
      open('/provider/sign-in')
      expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back.' })).toBeTruthy()
      expect(screen.getByRole('textbox', { name: 'Email' })).toBeTruthy()
      expect(replace).not.toHaveBeenCalled()
      expect(screen.queryByText('Opening the EHR sign-in…')).toBeNull()
    })
})
