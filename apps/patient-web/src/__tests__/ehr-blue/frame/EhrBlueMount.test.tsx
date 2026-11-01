import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { blueForAll, isBlueFacility, isDemoFacility, showsBlueEhr } from '../../../ehr-blue/blueFacilities'
import type * as ClinicSwitch from '../../../ehr-blue/clinicSwitch'
import type * as PageSets from '../../../ehr-blue/pageSets'
import {
  DEMO_HOSPITAL, LAB_WORK, REAL_FACILITY, REQUESTS, SESSION, accountButton, facility, homeHeading, json, openStaffApp, serve, sessionAt, where,
} from './blueHarness'

/**
 * The mount and the switch-over: the blue EHR opens at the four demo facilities, and at every facility once both the
 * clinical and the department pages are merged. Until then a real facility opens today's provider workspace and never
 * loads the blue EHR's module. (The clinic switch is on as it ships, and there is no classic EHR to go back to.)
 *
 * The page files are stood in for here (pageSets.ts lists them from the same glob routes.tsx uses), so both sides of
 * the switch can be tried before Ola's and Lekan's pages exist.
 */
const blue = vi.hoisted(() => ({ loads: 0 }))
const pageSets = vi.hoisted(() => ({ files: ['./frame/pages.ts', './home/pages.ts'] as string[] }))
vi.mock('../../../ehr-blue/pageSets', () => ({ get PAGE_FILES() { return pageSets.files } }))
// The clinic switch (clinicSwitch.ts): off, as it ships, unless a test turns it on.
const clinic = vi.hoisted(() => ({ switchedOn: false }))
vi.mock('../../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinic.switchedOn } }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

const TODAY = ['./frame/pages.ts', './home/pages.ts']
const CLINICAL = './clinical/pages.ts'
const DEPARTMENTS = './departments/pages.ts'
const DEMO_IDS = ['98d00002-0000-4000-8000-000000000001', '98d00002-0000-4000-8000-000000000002',
  '98d00002-0000-4000-8000-000000000003', '98d00002-0000-4000-8000-000000000004']

beforeEach(() => {
  blue.loads = 0
  pageSets.files = [...TODAY]
  clinic.switchedOn = false
  // Registered afresh for each test: a vi.mock factory's module outlives vi.resetModules, and would keep the blue EHR
  // bound to the staff app of the test before.
  vi.doMock('../../../ehr-blue/EhrBlueApp', async importOriginal => {
    blue.loads += 1
    return importOriginal()
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const real = (permissions: readonly string[] = ['identity.consent.write']) => facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)

async function expectBlue() {
  expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
  expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
  expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
  expect(blue.loads).toBe(1)
}

async function expectToday() {
  expect(await screen.findByRole('heading', { level: 1, name: 'Good to see you, Demo.' })).toBeDefined()
  expect(screen.getByRole('complementary', { name: 'Provider navigation' })).toBeDefined()
  expect(document.querySelector('.hid-ehr')).toBeNull()
}

describe('blueFacilities', () => {
  it('reads the page files by the keys routes.tsx discovers its pages by', async () => {
    const { PAGE_FILES } = await vi.importActual<typeof PageSets>('../../../ehr-blue/pageSets')
    expect(PAGE_FILES).toEqual(expect.arrayContaining(TODAY))
    for (const file of PAGE_FILES) expect(file).toMatch(/^\.\/[^/]+\/pages\.ts$/)
  })

  it('switches on for every facility only when both the clinical and the department pages are present', () => {
    expect(blueForAll(TODAY, true)).toBe(false)
    expect(blueForAll([...TODAY, CLINICAL], true)).toBe(false)
    expect(blueForAll([...TODAY, DEPARTMENTS], true)).toBe(false)
    expect(blueForAll([...TODAY, CLINICAL, DEPARTMENTS], true)).toBe(true)
  })

  it('switches on for every facility only once the clinic switch is set, whatever pages are merged', async () => {
    expect(blueForAll([...TODAY, CLINICAL, DEPARTMENTS], false)).toBe(false)
    // As it ships: on, by the owner's decision of 2026-10-31 (one EHR, blue, for every facility). The switch over
    // changed two lines on purpose, clinicSwitch.ts and this one, so an accidental flip back fails here.
    const { BLUE_FOR_ALL } = await vi.importActual<typeof ClinicSwitch>('../../../ehr-blue/clinicSwitch')
    expect(BLUE_FOR_ALL).toBe(true)
    clinic.switchedOn = false
    pageSets.files = [...TODAY, CLINICAL, DEPARTMENTS]
    expect(blueForAll()).toBe(false)
    expect(isBlueFacility(REAL_FACILITY)).toBe(false)
    clinic.switchedOn = true
    expect(blueForAll()).toBe(true)
    expect(isBlueFacility(REAL_FACILITY)).toBe(true)
  })

  it('knows the four demo facilities by id, and until the switch nothing else', () => {
    pageSets.files = [...TODAY, CLINICAL]
    for (const id of DEMO_IDS) expect([isBlueFacility(id), isDemoFacility(id)]).toEqual([true, true])
    expect(isBlueFacility('98d00002-0000-4000-8000-000000000005')).toBe(false)
    expect(isBlueFacility(REAL_FACILITY)).toBe(false)
    expect(isBlueFacility(undefined)).toBe(false)
  })

  it('takes every facility once switched on with both page sets present, and still tells the demo ones apart', () => {
    pageSets.files = [...TODAY, CLINICAL, DEPARTMENTS]
    clinic.switchedOn = true
    expect(isBlueFacility(REAL_FACILITY)).toBe(true)
    expect(isDemoFacility(REAL_FACILITY)).toBe(false)
    for (const id of DEMO_IDS) expect(isBlueFacility(id)).toBe(true)
    expect(isBlueFacility(undefined)).toBe(false)
  })

  it('opens blue at a blue facility, and asks in blue only when every facility to choose from is a blue one', () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const riverside = real([])
    expect(showsBlueEhr({ facility: demo, facilities: [demo, riverside] }, false)).toBe(true)
    expect(showsBlueEhr({ facility: riverside, facilities: [demo, riverside] }, false)).toBe(false)
    expect(showsBlueEhr({ facility: demo, facilities: [demo, riverside] }, true)).toBe(false)
    expect(showsBlueEhr({ facility: riverside, facilities: [demo] }, true)).toBe(true)
    expect(showsBlueEhr({ facilities: [] }, true)).toBe(false)
    pageSets.files = [...TODAY, CLINICAL, DEPARTMENTS]
    clinic.switchedOn = true
    expect(showsBlueEhr({ facility: riverside, facilities: [demo, riverside] }, false)).toBe(true)
    expect(showsBlueEhr({ facility: demo, facilities: [demo, riverside] }, true)).toBe(true)
  })
})

describe('the staff app at a real facility', () => {
  it.each([
    ['no new page set', TODAY],
    ['only the clinical pages', [...TODAY, CLINICAL]],
    ['only the department pages', [...TODAY, DEPARTMENTS]],
    ['both page sets but the clinic switch off', [...TODAY, CLINICAL, DEPARTMENTS]],
  ])('with %s, renders today\'s workspace and never loads the blue EHR', async (_, files) => {
    pageSets.files = files
    const riverside = real()
    serve({ [SESSION]: [sessionAt(riverside, [riverside])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider')
    await expectToday()
    expect(blue.loads).toBe(0)
  })

  it('with the clinic switch on and both page sets, opens the blue EHR on its own data', async () => {
    pageSets.files = [...TODAY, CLINICAL, DEPARTMENTS]
    clinic.switchedOn = true
    const riverside = real()
    const sent = serve({ [SESSION]: [sessionAt(riverside, [riverside])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider')
    await expectBlue()
    expect(within(screen.getByRole('banner')).getByText('Riverside Teaching Hospital (fictional)')).toBeDefined()
    // It is no demo facility, so no Demo chip; its access requests are its own.
    expect(screen.queryByRole('button', { name: 'Demo' })).toBeNull()
    await waitFor(() => expect(sent.some(call => call.route.includes('/access-requests'))).toBe(true))
    // Only working screens are listed (sample pages are not), and a live page it has no permission for is not either.
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Access requests' })).toBeDefined()
    expect(within(nav).queryByRole('link', { name: 'Appointments' })).toBeNull()
    expect(within(nav).queryByRole('link', { name: 'Pharmacy' })).toBeNull()
  })
})

describe('the staff app at a demo facility', () => {
  it.each([
    ['before the switch', TODAY],
    ['with both page sets merged', [...TODAY, CLINICAL, DEPARTMENTS]],
  ])('opens the blue EHR %s', async (_, files) => {
    pageSets.files = files
    // A clinical permission besides the laboratory's: a facility holding only lab permissions is the Lab product (product.ts).
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write', 'identity.patient.read', 'lab.work-item.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])], [LAB_WORK]: [() => json({ items: [] })] })
    await openStaffApp('/provider')
    await expectBlue()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page')
    expect(within(screen.getByRole('banner')).getByText('Demo Hospital')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Demo' })).toBeDefined()
  })
})

/** "Use the classic EHR" was removed (one EHR for every facility): each page stays the blue page at its address. */
describe('no classic EHR', () => {
  async function offersNoClassic() {
    fireEvent.click(accountButton())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Use the classic EHR' })).toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
    expect(document.querySelector('.hid-ehr')).not.toBeNull()
  }

  it('keeps this tab in the blue EHR on a sample page, and stores nothing', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider/appointments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Appointments' })).toBeDefined()
    await offersNoClassic()
    expect(where()).toBe('/provider/appointments')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('keeps a page today\'s workspace also serves at the same address, as the blue page', async () => {
    pageSets.files = [...TODAY, CLINICAL, DEPARTMENTS]
    clinic.switchedOn = true
    const riverside = real()
    serve({ [SESSION]: [sessionAt(riverside, [riverside])], [REQUESTS]: [() => json([]), () => json([]), () => json([])] })
    await openStaffApp('/provider/requests')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await offersNoClassic()
    expect(where()).toBe('/provider/requests')
  })

  it('keeps the blue EHR\'s own pages: What\'s left stays open', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider/whats-left')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    await offersNoClassic()
    expect(where()).toBe('/provider/whats-left')
  })
})
