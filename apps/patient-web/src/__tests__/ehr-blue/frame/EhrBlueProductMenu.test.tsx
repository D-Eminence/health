import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { inProduct, type Product } from '../../../ehr-blue/frame/product'
import { DEMO_HOSPITAL, DEMO_LABORATORY, REAL_FACILITY, SESSION, facility, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * Patients and Access requests on a single product's site (parity report 3.1 #7). On lab., pharmacy., outreach. and
 * migrate. the menu and search list only that product's pages and the facility's own (staff, audit, profile); a lab
 * scientist or a pharmacist still finds a patient and asks for access there, as the classic portal listed each page by
 * permission on every site (staff/navigation.ts). The other clinical pages, registration among them, stay the EHR's.
 * Most cases run on the frame's own registry at a demo facility; the rest run on the real, merged registry at a clinic or
 * a hospital.
 * Every account and facility here is fictional, and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
// withFramePages registers the frame's own registry for one test, but vi.resetModules does not drop a vi.doMock: without
// the doUnmock, a case on the real registry that runs after one on the frame's would get the frame's registry instead.
afterEach(() => {
  jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.doUnmock('../../../ehr-blue/routes'); vi.resetModules()
})

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
/** The sidebar's headings: a group of more than one page folds under a button that names it. */
const headings = () => within(nav()).queryAllByRole('button').map(button => button.textContent ?? '')

/** The pages search offers before anything is typed: every page the menu lists. */
function searchOffers(): string[] {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const drawer = screen.getByRole('dialog', { name: 'Search' })
  const offers = within(within(drawer).getByRole('navigation', { name: 'Pages' })).getAllByRole('link')
    .map(link => link.firstChild?.firstChild?.textContent ?? '')
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  return offers
}

/**
 * Opens `path` on `host`, at a facility holding `permissions`: by default What's left, a page every demo facility opens
 * and that is listed nowhere.
 */
async function openOn(host: string, id: string, name: string, permissions: readonly string[], path = '/provider/whats-left') {
  jsdom.reconfigure({ url: `https://${host}${path}` })
  const current = facility(id, name, permissions)
  serve({ [SESSION]: [sessionAt(current, [current])] })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
}

describe('which pages a single product keeps', () => {
  it.each(SITES.map(([product]) => product))('keeps Patients and Access requests on %s, and no other clinical page', product => {
    expect(inProduct(product, 'patients')).toBe(true)
    expect(inProduct(product, 'patients/*')).toBe(true)
    expect(inProduct(product, 'requests/*')).toBe(true)
    for (const path of ['registration', 'in-person-check', 'clinical/*', 'triage/*', 'nursing/*', 'emergency/*']) {
      expect(inProduct(product, path), path).toBe(false)
    }
  })

  it('leaves the EHR with every page', () => {
    for (const path of ['patients/*', 'requests/*', 'registration', 'in-person-check', 'clinical/*', 'emergency/*']) expect(inProduct('ehr', path)).toBe(true)
  })
})

describe('the menu on a single product’s site', () => {
  beforeEach(() => { withFramePages() })

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

  it('lists both under one plain heading, Patients, not the hospital’s front desk and care', async () => {
    await openOn('lab.healthidentitydirectory.com', DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read', ...FIND_AND_ASK])
    expect(headings()).toContain('Patients')
    expect(headings()).not.toContain('Front desk')
    expect(headings()).not.toContain('Care')
    const group = within(nav()).getByRole('button', { name: 'Patients' })
    expect(group.getAttribute('aria-expanded')).toBe('true')
    const under = within(group.parentElement!).getAllByRole('link').map(link => link.textContent)
    expect(under).toEqual(['Patients', 'Access requests'])
  })

  it('lists Patients alone with no heading over it', async () => {
    await openOn('pharmacy.healthidentitydirectory.com', DEMO_PHARMACY, 'Demo Pharmacy', ['pharmacy.work-item.read', 'identity.patient.read'])
    expect(listedInMenu('Patients')).toBe(true)
    expect(headings()).not.toContain('Patients')
    expect(headings()).not.toContain('Front desk')
  })
})

describe('a single product at an address that names no product', () => {
  beforeEach(() => { withFramePages() })

  // Away from the product sites (here the test page's own address), a pharmacy on its own is the pharmacy product by its
  // permissions (product.ts). Asking for access is not a clinical permission, so it stays the pharmacy and lists Access
  // requests; finding a patient would make it the EHR, so Patients is not there to list.
  it('lists Access requests and none of the EHR’s clinical pages', async () => {
    await openOn(new URL(servedFrom).host, DEMO_PHARMACY, 'Demo Pharmacy',
      ['pharmacy.work-item.read', 'identity.consent.write', 'identity.registration.write', 'identity.patient.assisted_registration'])
    expect(screen.getAllByRole('link', { name: 'Health ID Pharmacy home' }).length).toBeGreaterThan(0)
    expect(listedInMenu('Access requests')).toBe(true)
    for (const page of ['Patients', 'Patient registration', 'In-person check', 'Consultation']) expect(listedInMenu(page), page).toBe(false)
    const offers = searchOffers()
    expect(offers).toContain('Access requests')
    for (const page of ['Patients', 'Patient registration', 'In-person check', 'Consultation']) expect(offers, page).not.toContain(page)
  })
})

describe('at a clinic, on the real registry', () => {
  // No withFramePages: the merged registry (clinical/pages.ts) gives Patients and Access requests here, as at real clinics.
  // Consultation's permission is held too: the product, not the permission, keeps it out.
  it('lists Patients and Access requests on lab., by permission', async () => {
    await openOn('lab.healthidentitydirectory.com', REAL_FACILITY, 'Riverside Laboratory (fictional)',
      ['lab.work-item.read', ...FIND_AND_ASK, 'ehr.encounter.read'], '/provider/institutions')
    expect(listedInMenu('Patients')).toBe(true)
    expect(listedInMenu('Access requests')).toBe(true)
    expect(listedInMenu('Consultation')).toBe(false)
    expect(searchOffers()).toEqual(expect.arrayContaining(['Patients', 'Access requests']))
  })
})

describe('the Start menu', () => {
  beforeEach(() => { withFramePages() })

  // Registration stays in the EHR only. A single product's site draws no Start menu, and its sidebar lists no Patient
  // registration, so the frame adds no way to registration there, even for a session that holds registration's
  // permissions. This checks only the frame. The Patients page has its own "Register a patient" button. It shows on the
  // EHR's site only (clinical/patients/PatientsWorkspace.tsx), and 'Patients opened from the menu' below checks that end
  // to end.
  it.each(SITES)('draws no Start menu on %s (%s), and its sidebar lists no Patient registration', async (_product, host, id, name, own) => {
    await openOn(host, id, name, [own, ...FIND_AND_ASK, ...EHR_ONLY])
    expect(listedInMenu('Patients')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Start' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Register a patient/)
    // The frame's own menu offers no way there either. (What's left, the demo review page open below it, lists every
    // page, so the check stays on the menu.)
    expect(within(nav()).queryByRole('link', { name: /registration/i })).toBeNull()
    expect(nav().querySelector('a[href="/provider/registration"]')).toBeNull()
  })

  it('at a hospital still offers finding, registering and asking a patient for access', async () => {
    await openOn('ehr.healthidentitydirectory.com', DEMO_HOSPITAL, 'Demo Hospital', [...FIND_AND_ASK, ...EHR_ONLY])
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    const start = screen.getByRole('dialog', { name: 'Start' })
    expect(within(start).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['/provider/patients', '/provider/registration', '/provider/requests'])
    expect(within(start).getByRole('link', { name: /^Ask a patient for access/ })).toBeTruthy()
  })
})

describe('Patients opened from the menu, on the real registry', () => {
  // The whole path a person takes, end to end: the real, merged registry (no withFramePages) and the real Find a patient
  // (clinical/patients/PatientsWorkspace.tsx). The session holds registration's permission as well as Patients', so on
  // a product's site it is the site, not the permission, that keeps "Register a patient" away.
  const REGISTERS = ['identity.patient.read', 'identity.registration.write']

  /** Opens Choose workspace (listed nowhere), then Patients from the sidebar, and waits for Find a patient. */
  async function patientsFromMenu(host: string, name: string, permissions: readonly string[]) {
    await openOn(host, REAL_FACILITY, name, permissions, '/provider/institutions')
    fireEvent.click(within(nav()).getByRole('link', { name: 'Patients' }))
    // The real app loads its pages lazily: a cold first open can take longer than the ten seconds vitest.setup.ts gives
    // an element, so this one wait has most of the test's 30 s (vitest.config.ts).
    await screen.findByRole('heading', { name: 'Find a patient' }, { timeout: 25000 })
    expect(where()).toBe('/provider/patients')
  }

  it.each(SITES)('on %s (%s) brings no Register a patient, even to a session allowed registration', async (_product, host, _id, _name, own) => {
    await patientsFromMenu(host, 'Riverside Clinic (fictional)', [own, ...REGISTERS])
    expect(screen.getByRole('button', { name: 'Find' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Register a patient/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Register a patient/ })).toBeNull()
    expect(document.body.textContent).not.toMatch(/Register a patient/)
    // Nothing on the page leads to registration, by any name: not the page, not the menu.
    expect(document.querySelector('a[href*="/provider/registration"]')).toBeNull()
  })

  it.each(SITES)('at a hospital on the EHR’s address, the same session (with %s’s own permission) is offered Register a patient',
    async (_product, _host, _id, _name, own) => {
      await patientsFromMenu('ehr.healthidentitydirectory.com', 'Riverside Hospital (fictional)', [own, ...REGISTERS])
      const offered = screen.getAllByRole('link', { name: 'Register a patient' })
      expect(offered.length).toBeGreaterThan(0)
      for (const link of offered) expect(link.getAttribute('href')).toBe('/provider/registration')
    })
})

describe('the EHR’s menu at a hospital', () => {
  beforeEach(() => { withFramePages() })

  it('is unchanged: the front desk’s and care’s pages, each by its permission, under their headings', async () => {
    await openOn('ehr.healthidentitydirectory.com', DEMO_HOSPITAL, 'Demo Hospital', [...FIND_AND_ASK, ...EHR_ONLY])
    for (const page of ['Patients', 'Patient registration', 'In-person check', 'Consultation', 'Access requests']) expect(listedInMenu(page), page).toBe(true)
    expect(searchOffers()).toEqual(expect.arrayContaining(['Patients', 'Patient registration', 'In-person check', 'Consultation', 'Access requests']))
    expect(headings()).toEqual(expect.arrayContaining(['Front desk', 'Care']))
    expect(headings()).not.toContain('Patients')
  })
})
