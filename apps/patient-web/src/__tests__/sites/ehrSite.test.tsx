import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY, facility } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, bluePages, classicPages, EVERY_CLASSIC_PAGE, EVERY_PERMISSION, expectOpenedElsewhere, openBlueOn,
  openClassicOn, openPortalOn, signInActionOn, siteLinks,
} from './siteHarness'

/**
 * ehr.: the hospital EHR, with the hospital's own laboratory, pharmacy, OCR, migration and outreach (owner,
 * 2026-10-31), and the pages every staff site serves. The patient portal opens on the main site.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const EHR_STAGING = 'ehr.staging.healthidentitydirectory.com'

describe(EHR, () => {
  it.each(['/provider', '/provider/sign-in', '/provider/patients', '/provider/registration', '/provider/in-person-check',
    '/provider/requests', '/provider/clinical', '/provider/appointments/5a020001', '/provider/patient-billing',
    '/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/migrate', '/provider/outreach', '/provider/audit',
    '/provider/billing', '/provider/staff', '/provider/staff/join', '/provider/institutions', '/provider/tour', '/'])('serves %s', path => {
    expect(servedHere(path, EHR)).toBe(true)
    expect(servedHere(path, EHR_STAGING)).toBe(true)
  })

  it.each([
    ['/records', 'https://app.healthidentitydirectory.com/records'],
    ['/sign-in', 'https://app.healthidentitydirectory.com/sign-in'],
    ['/access/share', 'https://app.healthidentitydirectory.com/access/share'],
  ])('opens the patient portal’s %s on the main site', (pathname, href) => {
    expect(rightSiteHref({ pathname, search: '', hash: '' }, EHR)).toBe(href)
  })

  it('sends the patient portal to the main site, in place of this address', async () => {
    await openPortalOn(EHR, '/records')
    await expectOpenedElsewhere(opened, 'https://app.healthidentitydirectory.com/records')
  })

  it('opens the hospital’s own Laboratory here, behind its own sign-in', async () => {
    await openPortalOn(EHR, '/provider/laboratory')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(opened).not.toHaveBeenCalled()
  })

  it('opens its own page at its address', async () => {
    await openPortalOn(EHR, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fclinical')
  })

  it('keeps the main site’s public staff pages’ own link there (clinician sign-up)', async () => {
    await openPortalOn(EHR, '/provider/join')
    const link = await screen.findByRole('link', { name: /main Health ID site|Continue/ })
    expect(link.getAttribute('href')).toBe('https://app.healthidentitydirectory.com/provider/join')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with staff-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(EHR)).toBe('staff-login')
  })

  it('lists every page in today’s sidebar, and no other site', async () => {
    const sidebar = await openClassicOn(EHR)
    expect(classicPages(sidebar)).toEqual(EVERY_CLASSIC_PAGE)
    expect(siteLinks(sidebar)).toEqual([])
    expect(screen.queryByRole('navigation', { name: 'Other Health ID sites' })).toBeNull()
  })

  it('opens the blue EHR at Demo Hospital as the Hospital EHR, with its own laboratory, pharmacy, OCR and outreach', async () => {
    const nav = await openBlueOn(EHR, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION)
    expect(document.querySelector('.hid-ehr-sidebar-product')?.textContent).toBe('Hospital EHR')
    expect(bluePages(nav)).toEqual(expect.arrayContaining(['Home', 'Patients', 'Consultation', 'Laboratory', 'Pharmacy',
      'Document OCR', 'Outreach', 'Facility subscription', 'Audit & Compliance']))
    expect(siteLinks(nav)).toEqual([])
  })

  it('opens nothing of Demo Laboratory here: it works on the Laboratory’s site, in the blue EHR and today’s', async () => {
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    await openBlueOn(EHR, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, ['lab.work-item.read'], [hospital], '/provider/laboratory')
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Laboratory works on Laboratory' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Laboratory' }).getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/')
    expect(screen.queryByRole('heading', { name: 'Laboratory worklist' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use the classic EHR' }))
    const sidebar = await screen.findByRole('complementary', { name: 'Provider navigation' })
    expect(within(sidebar).getByRole('combobox', { name: 'Working at' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Laboratory works on Laboratory' })).toBeTruthy()
    const main = within(document.querySelector<HTMLElement>('main.staff-main')!)
    expect(main.getByText(/Demo Laboratory is on lab\.healthidentitydirectory\.com, where you sign in separately\./)).toBeTruthy()
    expect(main.getByRole('link', { name: 'Open Laboratory →' }).getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/')
  })
})

describe(EHR_STAGING, () => {
  it('sends the patient portal to the staging main site', async () => {
    await openPortalOn(EHR_STAGING, '/notifications')
    await expectOpenedElsewhere(opened, 'https://staging.healthidentitydirectory.com/notifications')
  })

  it('signs in with staff-login', async () => {
    expect(await signInActionOn(EHR_STAGING)).toBe('staff-login')
  })
})
