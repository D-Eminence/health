import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * Signing in again from a blue page returns to it, as from one of today's: the blue EHR's own page addresses join
 * today's exact list (ehr-blue/returnPaths.ts), never a record below a page. Every account here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const ended = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required')
const many = <T,>(answer: T, count = 6): T[] => Array.from({ length: count }, () => answer)

describe('the blue return list', () => {
  it('names every page address the blue EHR serves that is not one of today\'s, and no design review page', async () => {
    const [{ BLUE_PAGES }, { pageHrefOf }, { TODAY_PATHS, isDemoOnly }, { BLUE_RETURN_PATHS }, { NOVU_STAFF_RETURN_PATHS }] = await Promise.all([
      import('../../../ehr-blue/routes'), import('../../../ehr-blue/frame/pageHref'), import('../../../ehr-blue/frame/pages'),
      import('../../../ehr-blue/returnPaths'), import('../../../staff/session'),
    ])
    const today = new Set(['/provider', ...[...TODAY_PATHS].map(path => `/provider/${path}`), ...NOVU_STAFF_RETURN_PATHS])
    const served = BLUE_PAGES.filter(page => !isDemoOnly(page)).map(page => pageHrefOf(page)).filter(href => !today.has(href))
    // The design review pages are there to leave out: only the demo facilities open them.
    expect(BLUE_PAGES.filter(isDemoOnly).map(page => pageHrefOf(page))).toEqual(expect.arrayContaining(['/provider/whats-left', '/provider/tour']))
    // A page set that adds an address adds it here too, or a sign-in from that page goes to Home.
    expect([...BLUE_RETURN_PATHS].sort()).toEqual([...new Set(served)].sort())
  })

  it.each([
    ['/provider/appointments', '/provider/appointments'],
    ['/provider/laboratory/work', '/provider/laboratory/work'],
    // Design review pages open only at the demo facilities: a clinic would be told the page is not open to it.
    ['/provider/tour/sign-in', null],
    ['/provider/whats-left', null],
    ['/provider/appointments/5a020001', null],
    ['/provider/appointments/', null],
    ['/provider/appointments?status=booked', null],
    ['/provider/Appointments', null],
    // Today's own choices stand: its billing page is not a return address, nor Novu's Staff page on main.
    ['/provider/billing', null],
    ['/provider/staff', null],
  ])('returns from %s to %s', async (page, expected) => {
    const { staffReturnPath } = await import('../../../staff/session')
    expect(staffReturnPath(page)).toBe(expected)
  })
})

describe('signing in again from a blue page', () => {
  async function endOn(path: string) {
    withFramePages()
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({
      [SESSION]: [sessionAt(demo, [demo]), ended, ...many(sessionAt(demo, [demo]))],
      'POST /api/v1/auth/refresh': [ended],
      'POST /api/v1/auth/login': [sessionAt(demo, [demo])],
      [REQUESTS]: many(() => json([])),
    })
    await openStaffApp(path)
    await screen.findByRole('navigation', { name: 'Main navigation' })
    const { reportStaffSessionEnded } = await import('../../../staff/session')
    act(() => reportStaffSessionEnded())
    return screen.findByRole('link', { name: 'Sign in again' })
  }

  it('returns to the blue page the session ended on', async () => {
    const again = await endOn('/provider/appointments')
    expect(again.getAttribute('href')).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fappointments')
    fireEvent.click(again)
    // The blue sign-in, as every facility now has it (BLUE_FOR_ALL).
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'demo.clinician@example.test' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fictional passphrase for tests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(where()).toBe('/provider/appointments'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
  })

  it('keeps nothing of a record\'s address', async () => {
    const again = await endOn('/provider/appointments/5a020001')
    expect(again.getAttribute('href')).toBe('/provider/sign-in')
  })
})
