import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, type Mock } from 'vitest'
import { facility, json, openStaffApp, problem, serve, sessionAt } from '../ehr-blue/frame/blueHarness'

/**
 * Each product on its own site (productSites.ts): the portal as each Health ID host serves it. jsdom's page address
 * is set to the host a test is on; the browser's move to another site is the test's stand-in for openSite.ts. Every
 * account and facility here is fictional.
 */
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href

export function onSite(hostname: string, path = '/') {
  jsdom.reconfigure({ url: `https://${hostname}${path}` })
}

export function backToTestSite() {
  jsdom.reconfigure({ url: servedFrom })
}

export const SESSION = 'GET /api/v1/auth/session'
export const LOGIN = 'POST /api/v1/auth/login'
export const REFRESH = 'POST /api/v1/auth/refresh'

/** Every page the classic sidebar lists, opened by these permissions (staff/navigation.ts). */
export const EVERY_PERMISSION = ['identity.patient.read', 'identity.registration.write', 'identity.patient.assisted_registration',
  'identity.consent.write', 'audit.read', 'ehr.encounter.read', 'lab.work-item.read', 'pharmacy.work-item.read', 'ocr.job.read',
  'outreach.registration.read', 'billing.subscription.read']

/** The classic sidebar's pages, in order, at a facility holding every permission. */
export const EVERY_CLASSIC_PAGE = ['Overview', 'Patient access', 'Patient registration', 'In-person check', 'Access requests',
  'Facility audit', 'Clinical record', 'Laboratory', 'Pharmacy', 'Document OCR', 'Outreach', 'Plan & billing']

export const REAL_CLINIC = 'f0000000-0000-4000-8000-0000000051e5'
/** The demo tenant's pharmacy and outreach (ehr-blue/blueFacilities.ts). */
export const PHARMACY_DEMO = '98d00002-0000-4000-8000-000000000003'
export const OUTREACH_DEMO = '98d00002-0000-4000-8000-000000000004'

function Address() {
  const { pathname, search } = useLocation()
  return <span data-testid="address" hidden>{pathname + search}</span>
}

/** Where the portal is now, within this site. */
export const address = () => screen.getByTestId('address').textContent

/** The portal at `path` on `hostname`, as the browser opens it there, signed out. */
export async function openPortalOn(hostname: string, path: string) {
  const signedOut = () => problem(401, 'AUTHENTICATION_REQUIRED', 'Valid authentication is required.')
  const sent = serve({ [SESSION]: [signedOut], [REFRESH]: [signedOut] })
  onSite(hostname, path)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Address /><App /></MemoryRouter>)
  return sent
}

/** The page says where the address went, and the browser was sent there, once, in place of this address. */
export async function expectOpenedElsewhere(opened: Mock, href: string) {
  const hostname = new URL(href).hostname
  expect(await screen.findByRole('status')).toHaveProperty('textContent', `This page is on ${hostname}. Opening it there…`)
  expect(screen.getByRole('link', { name: `Continue to ${hostname}` }).getAttribute('href')).toBe(href)
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  expect(opened).toHaveBeenCalledWith(href)
}

/** Today's workspace at a fictional clinic holding every permission, on `hostname`. */
export async function openClassicOn(hostname: string, path = '/provider') {
  const clinic = facility(REAL_CLINIC, 'Fictional Clinic', EVERY_PERMISSION)
  serve({ [SESSION]: [sessionAt(clinic, [clinic])] })
  onSite(hostname, path)
  await openStaffApp(path)
  return screen.findByRole('complementary', { name: 'Provider navigation' })
}

/** The classic sidebar's own pages, by name. */
export function classicPages(sidebar: HTMLElement): string[] {
  const own = sidebar.querySelector('nav.staff-nav:not(.staff-nav-sites)')!
  return [...own.querySelectorAll('a')].map(link => link.firstChild?.textContent ?? '')
}

/** The other Health ID sites a sidebar links to, as [name, address]. */
export function siteLinks(container: HTMLElement): [string, string][] {
  return [...container.querySelectorAll<HTMLAnchorElement>('a[href^="https:"]')].map(link => {
    const label = (link.textContent ?? '').replace(link.querySelector('.staff-nav-meta')?.textContent ?? '', '').trim()
    return [label, link.getAttribute('href') ?? '']
  })
}

/** The blue EHR at a demo facility (or at any facility, with the clinic switch on), on `hostname`. */
export async function openBlueOn(hostname: string, at: { id: string; name: string }, permissions: readonly string[],
  others: ReturnType<typeof facility>[] = [], path = '/provider/audit') {
  const here = facility(at.id, at.name, permissions)
  serve({ [SESSION]: [sessionAt(here, [here, ...others])] })
  onSite(hostname, path)
  await openStaffApp(path)
  return screen.findByRole('navigation', { name: 'Main navigation' })
}

/** The blue sidebar's links to pages of this site, by name. */
export function bluePages(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll<HTMLAnchorElement>('a')].filter(link => !link.getAttribute('href')?.startsWith('https:'))
    .map(link => (link.textContent ?? '').trim())
}

/** The Turnstile action a staff sign-in on `hostname` sends to Identity. */
export async function signInActionOn(hostname: string): Promise<unknown> {
  const sent = serve({ [LOGIN]: [() => json({ status: 'mfa_required', expiresAt: '2026-11-30T12:00:00.000Z' })] })
  onSite(hostname, '/provider/sign-in')
  const { staffApi } = await import('../../staff/api')
  await staffApi.login('demo.clinician@example.test', 'fictional-test-password', 'turnstile-token')
  const login = sent.find(request => request.route === LOGIN)
  return (login?.body as { turnstileAction?: unknown } | undefined)?.turnstileAction
}

export { within, screen }
