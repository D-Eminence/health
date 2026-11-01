import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { inProduct, type Product } from '../../../ehr-blue/frame/product'
import { DEMO_HOSPITAL, DEMO_LABORATORY, SESSION, facility, openStaffApp, serve, sessionAt, withFramePages } from './blueHarness'

/**
 * Patients and Access requests on a single product's site (parity report 3.1 #7). On lab., pharmacy., outreach. and
 * migrate. the menu and search list only that product's pages and the facility's own (staff, audit, profile); a lab
 * scientist or a pharmacist still finds a patient and asks for access there, as the classic portal listed each page by
 * permission on every site (staff/navigation.ts). The other clinical pages, registration among them, stay the EHR's.
 * Every account and facility here is fictional, and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
afterEach(() => { jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const DEMO_PHARMACY = '98d00002-0000-4000-8000-000000000003'
const DEMO_OUTREACH = '98d00002-0000-4000-8000-000000000004'
const FIND_AND_ASK = ['identity.patient.read', 'identity.consent.write']
// The EHR's other clinical pages, each with its permission: none of them joins a single product's menu.
const EHR_ONLY = ['identity.registration.write', 'identity.patient.assisted_registration', 'ehr.encounter.read']

const SITES: readonly [Exclude<Product, 'ehr'>, string, string, string, string][] = [
  ['lab', 'lab.healthidentitydirectory.com', DEMO_LABORATORY, 'Demo Laboratory', 'lab.work-item.read'],
  ['pharmacy', 'pharmacy.healthidentitydirectory.com', DEMO_PHARMACY, 'Demo Pharmacy', 'pharmacy.work-item.read'],
  ['outreach', 'outreach.staging.healthidentitydirectory.com', DEMO_OUTREACH, 'Demo Outreach', 'outreach.registration.read'],
  ['migrate', 'migrate.healthidentitydirectory.com', DEMO_HOSPITAL, 'Demo Hospital', 'ocr.job.read'],
]

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const listedInMenu = (label: string) => within(nav()).queryByRole('link', { name: label }) !== null

/** The pages search offers before anything is typed: every page the menu lists. */
function searchOffers(): string[] {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const drawer = screen.getByRole('dialog', { name: 'Search' })
  const offers = within(within(drawer).getByRole('navigation', { name: 'Pages' })).getAllByRole('link')
    .map(link => link.firstChild?.firstChild?.textContent ?? '')
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  return offers
}

/** Opens What's left (a page every demo facility opens, listed nowhere) on `host`, at a facility holding `permissions`. */
async function openOn(host: string, id: string, name: string, permissions: readonly string[]) {
  jsdom.reconfigure({ url: `https://${host}/provider/whats-left` })
  const current = facility(id, name, permissions)
  serve({ [SESSION]: [sessionAt(current, [current])] })
  await openStaffApp('/provider/whats-left')
  await screen.findByRole('navigation', { name: 'Main navigation' })
}

describe('which pages a single product keeps', () => {
  it.each(SITES.map(([product]) => product))('keeps Patients and Access requests on %s, and no other clinical page', product => {
    expect(inProduct(product, 'patients')).toBe(true)
    expect(inProduct(product, 'patients/*')).toBe(true)
    expect(inProduct(product, 'requests/*')).toBe(true)
    for (const path of ['registration', 'in-person-check', 'clinical/*', 'triage/*', 'nursing/*', 'emergency/*', 'billing']) {
      expect(inProduct(product, path), path).toBe(false)
    }
  })

  it('leaves the EHR with every page', () => {
    for (const path of ['patients/*', 'requests/*', 'registration', 'in-person-check', 'clinical/*', 'emergency/*']) expect(inProduct('ehr', path)).toBe(true)
  })
})

describe('the menu on a single product’s site', () => {
  it.each(SITES)('on %s (%s) lists Patients and Access requests for a session allowed them, in the menu and in search',
    async (_product, host, id, name, own) => {
      await openOn(host, id, name, [own, ...FIND_AND_ASK, ...EHR_ONLY])
      expect(listedInMenu('Patients')).toBe(true)
      expect(listedInMenu('Access requests')).toBe(true)
      // Registration stays in the EHR only; the In-person check and Consultation are the EHR's too.
      for (const page of ['Patient registration', 'In-person check', 'Consultation']) expect(listedInMenu(page), page).toBe(false)
      const offers = searchOffers()
      expect(offers).toEqual(expect.arrayContaining(['Patients', 'Access requests']))
      for (const page of ['Patient registration', 'In-person check', 'Consultation']) expect(offers, page).not.toContain(page)
    })

  it.each(SITES)('on %s (%s) leaves them out for a session whose permissions do not open them', async (_product, host, id, name, own) => {
    await openOn(host, id, name, [own])
    expect(listedInMenu('Patients')).toBe(false)
    expect(listedInMenu('Access requests')).toBe(false)
    const offers = searchOffers()
    expect(offers).not.toContain('Patients')
    expect(offers).not.toContain('Access requests')
  })

  it.each([
    ['identity.patient.read', true, false],
    ['identity.consent.write', false, true],
  ])('lists each by its own permission: with only %s, Patients %s and Access requests %s', async (permission, patients, requests) => {
    await openOn('lab.healthidentitydirectory.com', DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read', permission])
    expect(listedInMenu('Patients')).toBe(patients)
    expect(listedInMenu('Access requests')).toBe(requests)
  })

  it('offers to find a patient by Health ID in search, once Patients is listed', async () => {
    await openOn('pharmacy.healthidentitydirectory.com', DEMO_PHARMACY, 'Demo Pharmacy', ['pharmacy.work-item.read', ...FIND_AND_ASK])
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const drawer = screen.getByRole('dialog', { name: 'Search' })
    fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: 'HID-ABCDEF23' } })
    expect(within(drawer).getByRole('link', { name: /^Find patient/ }).getAttribute('href')).toBe('/provider/patients')
  })
})

describe('the EHR’s menu', () => {
  it('is unchanged: the front desk’s and care’s pages, each by its permission', async () => {
    await openOn('ehr.healthidentitydirectory.com', DEMO_HOSPITAL, 'Demo Hospital', [...FIND_AND_ASK, ...EHR_ONLY])
    for (const page of ['Patients', 'Patient registration', 'In-person check', 'Consultation', 'Access requests']) expect(listedInMenu(page), page).toBe(true)
    expect(searchOffers()).toEqual(expect.arrayContaining(['Patients', 'Patient registration', 'In-person check', 'Consultation', 'Access requests']))
  })
})
