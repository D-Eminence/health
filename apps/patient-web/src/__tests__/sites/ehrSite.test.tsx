import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { rightSiteHref, servedHere } from '../../productSites'
import type * as BlueFacilities from '../../ehr-blue/blueFacilities'
import { DEMO_HOSPITAL, DEMO_LABORATORY, facility } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_CLASSIC_PAGE, EVERY_PERMISSION, expectNoHostnameShown,
  expectOpenedElsewhere, openBlueOn, openClassicOn, openPortalOn, overviewWorkspaces, signInActionOn, siteLinks,
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
// The classic EHR is gone (#104): nothing in the app sets the flag staff/App.tsx still reads for today's workspace. This
// file sets it, to see today's workspace with a demo facility as a tab that chose the classic EHR had it.
const classicTab = vi.hoisted(() => ({ on: false, listeners: new Set<() => void>() }))
vi.mock('../../ehr-blue/blueFacilities', async importOriginal => {
  const subscribe = (listener: () => void) => { classicTab.listeners.add(listener); return () => { classicTab.listeners.delete(listener) } }
  const chosen = () => classicTab.on
  return { ...await importOriginal<typeof BlueFacilities>(), useClassicEhrChosen: () => useSyncExternalStore(subscribe, chosen, chosen) }
})
function chooseClassicEhr() {
  classicTab.on = true
  classicTab.listeners.forEach(listener => listener())
}

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); classicTab.on = false; classicTab.listeners.clear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
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

  it('offers every workspace on the Overview, with the access requests', async () => {
    await openClassicOn(EHR)
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(overviewWorkspaces()).toEqual(['Patient access', 'Clinical record', 'Laboratory', 'Pharmacy', 'Document OCR', 'Outreach'])
    expect(screen.queryByText(/Your other workspaces are on other Health ID sites/)).toBeNull()
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
  })

  it('opens the blue EHR at Demo Hospital as the Hospital EHR, with its own laboratory, pharmacy, OCR and outreach', async () => {
    const nav = await openBlueOn(EHR, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION)
    expect(blueProduct()).toBe('EHR')
    // The redesign lists the EHR's working pages; the hospital's own laboratory, pharmacy, OCR and outreach are served here.
    expect(blueAddresses(nav)).toEqual(expect.arrayContaining(['/provider', '/provider/patients', '/provider/clinical']))
    for (const own of ['/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/outreach']) expect(servedHere(own, EHR)).toBe(true)
    expect(siteLinks(nav)).toEqual([])
  })

  it('opens nothing of Demo Laboratory here: it works on the Laboratory’s site, in the blue EHR and today’s', async () => {
    const hospital = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    await openBlueOn(EHR, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, ['lab.work-item.read'], [hospital], '/provider/laboratory')
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Laboratory works on Laboratory' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByRole('link', { name: 'Open Laboratory' }).getAttribute('href')).toBe('https://lab.healthidentitydirectory.com/')
    expect(screen.queryByRole('heading', { name: 'Laboratory worklist' })).toBeNull()
    expect(page.getByText(/^Demo Laboratory is on Health ID Lab, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()

    // Today's workspace, as a tab that chose the classic EHR had it (nothing offers a way there now: the flag is set above).
    act(() => chooseClassicEhr())
    const sidebar = await screen.findByRole('complementary', { name: 'Provider navigation' })
    expect(within(sidebar).getByRole('combobox', { name: 'Working at' })).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Laboratory works on Laboratory' })).toBeTruthy()
    const main = within(document.querySelector<HTMLElement>('main.staff-main')!)
    expect(main.getByText(/Demo Laboratory is on Health ID Lab, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()
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
