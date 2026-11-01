import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import type * as ProductHostname from '../../../productHostname'
import { BLUE_PAGES, pageAllowed } from '../../../ehr-blue/routes'
import { TODAY_PAGES, pages as framePages } from '../../../ehr-blue/frame/pages'
import { FRAME_PARTS, STATUS_WORDS } from '../../../ehr-blue/frame/WhatsLeft'
import { JOURNEYS } from '../../../ehr-blue/frame/tour/journeys'
import type { StaffSession } from '../../../staff/api'
import { DEMO_HOSPITAL, DEMO_LABORATORY, SESSION, facility, openStaffApp, serve, sessionAt } from './blueHarness'

/**
 * What's left says what is true (parity report 3.1 #21): a page that works on Health ID, but not yet with today's
 * words, steps or checks throughout, is partial, not live, and keeps its permission (partial is never sample, which
 * would change who may open it). Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// The site's address, as the product-site tests set it (ProductSiteHome.test.tsx): the page's own unless a test names one.
const host = vi.hoisted(() => ({ name: null as string | null }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: (hostname: string) => actual.resolveStaffProductHostname(host.name ?? hostname) }
})
afterEach(() => { host.name = null; vi.unstubAllGlobals(); vi.resetModules() })

function sessionWith(permissions: readonly string[]): StaffSession {
  const current = facility(DEMO_HOSPITAL, 'Demo Hospital', permissions)
  return { actor: { id: 'staff-demo-1', displayName: 'Demo Clinician', roles: ['clinician'], permissions: [], facilities: [current], facility: current },
    expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

const page = (path: string) => {
  const found = BLUE_PAGES.find(candidate => candidate.path === path)
  if (!found) throw new Error(`No page at ${path}`)
  return found
}

describe('page statuses', () => {
  it.each([
    ['registration', 'Patient registration', 'identity.registration.write'],
    ['in-person-check', 'In-person check', 'identity.patient.assisted_registration'],
    ['audit', 'Audit & Compliance', 'audit.read'],
    ['billing', 'Facility subscription', 'billing.subscription.read'],
    ['outreach', 'Outreach', undefined],
    ['ocr', 'Document OCR', 'ocr.job.read'],
    ['staff', 'Staff & access', 'workforce.manage'],
    ['laboratory', 'Laboratory', 'lab.work-item.read'],
    ['laboratory/work/*', 'Work list', 'lab.work-item.read'],
    ['laboratory/results/*', 'Results', 'lab.work-item.read'],
    ['pharmacy/*', 'Pharmacy', undefined],
    ['pharmacy/prescriptions/*', 'Prescriptions', 'pharmacy.work-item.read'],
    // The point-of-care pages call addresses Health ID does not serve yet (report #20): partial, never sample.
    ['laboratory/new', 'New request', 'lab.walk-in.create'],
    ['laboratory/new-walk-in', 'New request', 'lab.walk-in.create'],
    ['laboratory/tests', 'Tests & prices', 'billing.catalogue.read'],
    ['laboratory/till', 'Till / End of day', 'billing.shift.own'],
    ['laboratory/settings', 'Payment setup', 'billing.settings.manage'],
    ['pharmacy/sell', 'Sell', 'pharmacy.walk-in.create'],
    ['pharmacy/sales/*', 'Sales & receipts', 'billing.bill.read'],
    ['pharmacy/stock/*', 'Stock', 'pharmacy.stock.read'],
    ['pharmacy/products', 'Products & prices', 'billing.catalogue.read'],
    ['pharmacy/till', 'Till / End of day', 'billing.shift.own'],
    ['pharmacy/settings', 'Payment setup', 'billing.settings.manage'],
  ])('labels %s (%s) partial, under the same permission', (path, label, permission) => {
    const entry = page(path)
    expect(entry.label).toBe(label)
    expect(entry.status).toBe('partial')
    expect(entry.permission).toBe(permission)
    if (!permission) return
    // Still opened by its live permission (where its own visible() lets it show at all), not by the design's sample roles.
    const holder = sessionWith([permission])
    expect(pageAllowed(entry, sessionWith([]))).toBe(false)
    expect(pageAllowed(entry, holder)).toBe(entry.visible?.(holder) ?? true)
  })

  it('keeps Facility subscription one of today\'s pages, so without its permission it still refuses in its own words', () => {
    const subscription = framePages.find(candidate => candidate.path === 'billing')!
    expect(subscription.status).toBe('partial')
    expect(TODAY_PAGES.has(subscription)).toBe(true)
    expect(page('billing')).toBe(subscription)
  })
})

describe('What\'s left', () => {
  it('says what partial means without calling the rest a sample', () => {
    expect(STATUS_WORDS.partial.meaning).toBe('On Health ID, but something is missing, worded differently or still a sample.')
  })

  const part = (name: string) => FRAME_PARTS.find(candidate => candidate.name === name)!

  it('says what the frame does with an address that is no page, and with a page the role may not open', () => {
    expect(part('Unknown address')).toEqual({ name: 'Unknown address', status: 'live',
      note: 'An address that is no page says “Page not found”, with one way back: to Home, or to the first page of a lab, pharmacy, outreach or migration site.' })
    // On a single product's site the notice is lost (report #15): the screen says so, not only a comment.
    expect(part('Page not open to your role')).toEqual({ name: 'Page not open to your role', status: 'partial',
      note: 'It shows its own refusal, or opens Home with a notice; on a lab, pharmacy, outreach or migration site it opens that site’s first page, with no notice yet. Nothing of it is read.' })
  })

  it('calls no partial page a live list', () => {
    expect(part('Record quick view').note).toBe('On sample workspace lists, and on some working lists such as Consultation and Document OCR.')
  })

  it('claims no control the frame no longer has, in its notes or in the design tour', () => {
    const notes = FRAME_PARTS.map(part => part.note).join(' ')
    for (const gone of ['View Home as', 'Preferences', 'Help', 'Every workspace in the design', 'says so']) expect(notes).not.toContain(gone)
    const tour = JOURNEYS.flatMap(journey => journey.steps.map(step => step.text ?? '')).join(' ')
    expect(tour).not.toContain('View Home as')
  })
})

/**
 * On a product's own site What's left lists only the pages that site shows, by the frame's own rule: its own pages and
 * the shared ones (staff, audit, facility), never Patient registration (the EHR's alone, by the owner's rule) or another
 * EHR-only page. In the EHR it lists every page, as before.
 */
describe('What\'s left on a product\'s own site', () => {
  const DEMO_PHARMACY = '98d00002-0000-4000-8000-000000000003'

  async function openWhatsLeft(site: string, current: ReturnType<typeof facility>) {
    host.name = site
    serve({ [SESSION]: [sessionAt(current, [current])] })
    await openStaffApp('/provider/whats-left')
    await screen.findByRole('heading', { level: 1, name: 'What’s left' })
    return screen.getByRole('table', { name: 'Pages and their status' })
  }

  /** Each row's page, by its link's address under /provider ('' for Home). */
  const addresses = (table: HTMLElement) => within(table).getAllByRole('link').map(link => link.getAttribute('href')!.replace(/^\/provider\/?/, ''))

  // Pages only a hospital's EHR has: none may be listed on a lab's, pharmacy's, outreach team's or migration site.
  const EHR_ONLY = ['Patient registration', 'Home', 'Patients', 'In-person check', 'Triage & Vitals', 'Consultation', 'Nursing observations',
    'Emergency', 'Access requests', 'Radiology', 'Patient billing', 'Facility subscription', 'Reports & Analytics']

  it.each([
    ['lab.healthidentitydirectory.com', facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read']), 'Lab', 'laboratory',
      ['Laboratory', 'Work list', 'Results'], 'Pharmacy'],
    ['pharmacy.healthidentitydirectory.com', facility(DEMO_PHARMACY, 'Demo Pharmacy', ['pharmacy.work-item.read']), 'Pharmacy', 'pharmacy',
      ['Pharmacy', 'Sell', 'Prescriptions', 'Stock'], 'Laboratory'],
  ])('on %s lists only that site\'s own pages and the shared ones', async (site, current, product, home, own, other) => {
    const table = await openWhatsLeft(site, current)
    for (const label of [...EHR_ONLY, other]) expect(within(table).queryByRole('link', { name: label })).toBeNull()
    for (const address of addresses(table)) expect(address).toMatch(new RegExp(`^(${home}(/|$)|(staff|audit|facility|hr|institutions)$)`))
    // Its own pages, and the facility's own (its people, its audit trail), are still there.
    for (const label of [...own, 'Staff & access', 'Audit & Compliance']) expect(within(table).getAllByRole('link', { name: label }).length).toBeGreaterThan(0)
    // The page says what it lists, and its counts are of those rows only.
    expect(screen.getByText(`Every page of the ${product} workspace, and how much of it runs on Health ID today.`)).toBeDefined()
    expect(screen.queryByText(/of the design/)).toBeNull()
    const counted = [...document.querySelectorAll('.hid-ehr-stat-card .hid-ehr-stat-value')].map(value => Number(value.textContent))
    expect(counted).toHaveLength(3)
    expect(counted.reduce((sum, count) => sum + count, 0)).toBe(within(table).getAllByRole('row').length - 1)
  })

  it('in the EHR lists every page, Patient registration among them, as before', async () => {
    const table = await openWhatsLeft('ehr.healthidentitydirectory.com', facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read']))
    expect(within(table).getAllByRole('row')).toHaveLength(BLUE_PAGES.length + 1)
    for (const label of ['Patient registration', 'Consultation', 'Triage & Vitals', 'Laboratory', 'Pharmacy', 'Staff & access']) {
      expect(within(table).getAllByRole('link', { name: label }).length).toBeGreaterThan(0)
    }
    expect(screen.getByText('Every workspace, flow and admin page of the design, and how much of it runs on Health ID today.')).toBeDefined()
  })
})
