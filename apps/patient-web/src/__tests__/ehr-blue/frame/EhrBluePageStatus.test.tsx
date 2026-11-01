import { describe, expect, it, vi } from 'vitest'
import { BLUE_PAGES, pageAllowed } from '../../../ehr-blue/routes'
import { TODAY_PAGES, pages as framePages } from '../../../ehr-blue/frame/pages'
import { FRAME_PARTS, STATUS_WORDS } from '../../../ehr-blue/frame/WhatsLeft'
import { JOURNEYS } from '../../../ehr-blue/frame/tour/journeys'
import type { StaffSession } from '../../../staff/api'
import { DEMO_HOSPITAL, facility } from './blueHarness'

/**
 * What's left says what is true (parity report 3.1 #21): a page that works on Health ID, but not yet with today's
 * words, steps or checks throughout, is partial, not live, and keeps its permission (partial is never sample, which
 * would change who may open it). Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

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
