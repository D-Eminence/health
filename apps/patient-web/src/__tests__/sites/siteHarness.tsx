import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { expect, type Mock } from 'vitest'
import { facility, json, openStaffApp, problem, REQUESTS, serve, sessionAt, type Answer, type Sent } from '../ehr-blue/frame/blueHarness'

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

/**
 * The portal at `path` on `hostname`, as the browser opens it there, signed in at `at` holding `permissions`: the site's
 * own redirects (ProductHostnameGate) first, then the staff app.
 */
export async function openPortalSignedInOn(hostname: string, path: string, at: { id: string; name: string }, permissions: readonly string[]) {
  const here = facility(at.id, at.name, permissions)
  const sent = serve({ [SESSION]: [sessionAt(here, [here])] })
  onSite(hostname, path)
  const { App } = await import('../../App')
  render(<MemoryRouter initialEntries={[path]}><Address /><App /></MemoryRouter>)
  return sent
}

/** What a page calls each Health ID site, by the first part of its hostname: the product's plain name. */
const PLAIN_NAMES: Readonly<Record<string, string>> = {
  app: 'the main Health ID site', staging: 'the main Health ID site', ehr: 'Health ID EHR', lab: 'Health ID Lab',
  pharmacy: 'Health ID Pharmacy', migrate: 'Health ID Migrate', outreach: 'Health ID Outreach',
}

/** The plain name a page gives the site of `href`. */
export function plainNameOf(href: string): string {
  const name = PLAIN_NAMES[new URL(href).hostname.split('.')[0]!]
  if (!name) throw new Error(`No Health ID site at ${href}`)
  return name
}

/** No Health ID hostname in what `container` shows (screens name a site by its product, and keep its address in links). */
export function expectNoHostnameShown(container: HTMLElement = document.body) {
  expect(container.textContent).not.toMatch(/healthidentitydirectory\.com/i)
}

/** The page says, by the site's plain name, where the address went, and the browser was sent there, once, in its place. */
export async function expectOpenedElsewhere(opened: Mock, href: string) {
  const name = plainNameOf(href)
  expect(await screen.findByRole('status')).toHaveProperty('textContent', `This page is on ${name}. Opening it there…`)
  expect(screen.getByRole('link', { name: `Continue to ${name}` }).getAttribute('href')).toBe(href)
  expectNoHostnameShown()
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  expect(opened).toHaveBeenCalledWith(href)
}

/** The plain names today's sidebar shows below the other sites' links. */
export function siteLinkNotes(sidebar: HTMLElement): string[] {
  return [...sidebar.querySelectorAll('.staff-nav-sites .staff-nav-meta')].map(note => note.textContent ?? '')
}

/**
 * Today's workspace at a fictional clinic holding `permissions` (every one), on `hostname`, answering `routes` besides
 * its session and access requests; what it sent is in `sent`.
 */
export async function openClassicOn(hostname: string, path = '/provider', sent: Sent[] = [], permissions: readonly string[] = EVERY_PERMISSION,
  routes: Record<string, Answer[]> = {}) {
  const clinic = facility(REAL_CLINIC, 'Fictional Clinic', permissions)
  serve({ [SESSION]: [sessionAt(clinic, [clinic])], [REQUESTS]: [() => json([])], ...routes }, sent)
  onSite(hostname, path)
  await openStaffApp(path)
  return screen.findByRole('complementary', { name: 'Provider navigation' })
}

/** The Overview's workspaces, by name. */
export function overviewWorkspaces(): string[] {
  const section = screen.getByRole('heading', { level: 2, name: 'Workspaces' }).parentElement!
  return within(section).queryAllByRole('link').map(link => link.querySelector('strong')?.textContent ?? '')
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

/** The product the blue EHR names for itself, from its brand link ("Health ID Lab home" is "Lab"). */
export function blueProduct(): string {
  const brand = screen.getAllByRole('link', { name: /^Health ID .+ home$/ })[0]!
  return brand.getAttribute('aria-label')!.replace(/^Health ID (.+) home$/, '$1')
}

/** The blue sidebar's links to pages of this site, by address. */
export function blueAddresses(nav: HTMLElement): string[] {
  return [...nav.querySelectorAll<HTMLAnchorElement>('a')].map(link => link.getAttribute('href') ?? '')
    .filter(href => !href.startsWith('https:'))
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
