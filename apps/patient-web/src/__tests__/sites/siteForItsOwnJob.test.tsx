import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { facility, json, openStaffApp, REQUESTS, serve } from '../ehr-blue/frame/blueHarness'
import { backToTestSite, EVERY_PERMISSION, onSite, REAL_CLINIC, screen, SESSION, siteLinks } from './siteHarness'

/**
 * Each staff site for its own job (owner decision Q97): Identity's actor.products names the staff sites a login can
 * open, and the blue frame's "Other Health ID sites" offers only those. A doctor, clinician, nurse or receptionist opens
 * Health ID EHR and Migrate only, so is never offered the Lab, Pharmacy or Outreach site; a hospital administrator opens
 * every site of their own hospital and is offered every one, as before. Without actor.products (an Identity before
 * Q97), every site as before. Every account and facility here is fictional, and the hosts are only set as the page's
 * address: nothing is sent there.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
const clinicSwitch = vi.hoisted(() => ({ on: true }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ get BLUE_FOR_ALL() { return clinicSwitch.on } }))
vi.mock('../../openSite', () => ({ openSite: vi.fn() }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { clinicSwitch.on = true; vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const LAB = 'lab.healthidentitydirectory.com'
const PHARMACY = 'pharmacy.healthidentitydirectory.com'
const EVERY_SITE = ['ehr', 'lab', 'pharmacy', 'migrate', 'outreach'] as const

/** A doctor's codes at their hospital: the seeds also give the lab, pharmacy and outreach reading codes (Q97). */
const DOCTOR = ['identity.patient.read', 'identity.consent.write', 'audit.read', 'ehr.encounter.read', 'ehr.encounter.write',
  'lab.work-item.read', 'pharmacy.work-item.read', 'outreach.registration.read']
/** A hospital administrator's codes: every page, and organization.manage. */
const ADMINISTRATOR = [...EVERY_PERMISSION, 'ehr.encounter.write', 'organization.manage', 'workforce.manage']

/** The blue frame on `hostname` at a fictional clinic holding `permissions`, with `products` as Identity sends it. */
async function openWith(hostname: string, permissions: readonly string[], roles: readonly string[], products?: readonly string[],
  path = '/provider/audit') {
  const clinic = facility(REAL_CLINIC, 'Fictional Clinic', permissions, roles)
  serve({ [SESSION]: [() => json({
    actor: { kind: 'staff', id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Demo Clinician', roles: [...roles],
      permissions: [], facilities: [clinic], facility: clinic, ...(products ? { products } : {}) },
    expiresAt: '2026-11-30T12:00:00.000Z',
  })], [REQUESTS]: [() => json([])] })
  onSite(hostname, path)
  await openStaffApp(path)
  return clinicSwitch.on ? screen.findByRole('navigation', { name: 'Main navigation' })
    : screen.findByRole('complementary', { name: 'Provider navigation' })
}

/** Every link on the page to another Health ID site's address. */
const linksTo = (host: string) => [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
  .map(link => link.getAttribute('href') ?? '').filter(href => href.startsWith(`https://${host}`))

describe('Other Health ID sites, by actor.products (Q97)', () => {
  it('a hospital administrator on lab. is still offered every other site the role uses there', async () => {
    const nav = await openWith(LAB, ADMINISTRATOR, ['org_admin'], EVERY_SITE)
    expect(siteLinks(nav)).toEqual([
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('without actor.products (an Identity before Q97) offers the same sites as before', async () => {
    const nav = await openWith(LAB, ADMINISTRATOR, ['org_admin'])
    expect(siteLinks(nav).map(([name]) => name)).toEqual(['Pharmacy', 'Migrate', 'Outreach'])
  })

  it('offers only the sites the login can open', async () => {
    const nav = await openWith(LAB, ADMINISTRATOR, ['lab_scientist'], ['lab', 'outreach'])
    expect(siteLinks(nav)).toEqual([['Outreach', 'https://outreach.healthidentitydirectory.com/']])
    expect(linksTo('pharmacy.healthidentitydirectory.com')).toEqual([])
    expect(linksTo('migrate.healthidentitydirectory.com')).toEqual([])
  })

  it('a doctor on ehr. is offered no Lab, Pharmacy or Outreach site', async () => {
    const nav = await openWith(EHR, DOCTOR, ['doctor'], ['ehr', 'migrate'])
    expect(siteLinks(nav)).toEqual([])
    for (const host of ['lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com']) {
      expect(linksTo(host), host).toEqual([])
    }
  })

  it('Switch facility on ehr. offers a doctor no outreach group to start on Health ID Outreach, where the login is refused', async () => {
    await openWith(EHR, DOCTOR, ['doctor'], ['ehr', 'migrate'], '/provider/institutions')
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Start one on Health ID Outreach' })).toBeNull()
    expect(screen.queryByText(/Run outreach events with your own volunteer group/)).toBeNull()
    expect(linksTo('outreach.healthidentitydirectory.com')).toEqual([])
  })

  it.each([
    ['a hospital administrator', ADMINISTRATOR, ['org_admin'], EVERY_SITE],
    ['a login before Q97 (no actor.products)', DOCTOR, ['doctor'], undefined],
  ])('Switch facility on ehr. still offers %s Start one on Health ID Outreach', async (_who, permissions, roles, products) => {
    await openWith(EHR, permissions, roles, products, '/provider/institutions')
    const link = await screen.findByRole('link', { name: 'Start one on Health ID Outreach' })
    expect(link.getAttribute('href')).toBe('https://outreach.healthidentitydirectory.com/provider/start-outreach-group')
  })
})

describe('today’s sidebar and Overview, by actor.products (Q97)', () => {
  beforeEach(() => { clinicSwitch.on = false })
  const ELSEWHERE = /Your other workspaces are on other Health ID sites/

  it.each([
    ['a hospital administrator', EVERY_SITE],
    ['a login before Q97 (no actor.products)', undefined],
  ])('on pharmacy., %s is still offered every other site, and told of them', async (_who, products) => {
    const sidebar = await openWith(PHARMACY, ADMINISTRATOR, ['org_admin'], products, '/provider')
    expect(siteLinks(sidebar)).toEqual([
      ['Laboratory', 'https://lab.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
    expect(await screen.findByText(ELSEWHERE)).toBeTruthy()
  })

  it('on pharmacy., a login that opens the Pharmacy only is offered no other site, and not told of one', async () => {
    const sidebar = await openWith(PHARMACY, ADMINISTRATOR, ['pharmacist'], ['pharmacy'], '/provider')
    expect(siteLinks(sidebar)).toEqual([])
    expect(screen.queryByRole('navigation', { name: 'Other Health ID sites' })).toBeNull()
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(screen.queryByText(ELSEWHERE)).toBeNull()
  })
})

