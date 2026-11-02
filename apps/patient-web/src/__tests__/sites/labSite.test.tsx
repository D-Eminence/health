import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { offeredHere, servedHere, rightSiteHref } from '../../productSites'
import { DEMO_HOSPITAL, DEMO_LABORATORY, facility, homeHeading, json, where } from '../ehr-blue/frame/blueHarness'
import {
  address, backToTestSite, blueAddresses, blueProduct, classicPages, EVERY_PERMISSION, expectNoHostnameShown, expectOpenedElsewhere, openBlueOn,
  openClassicOn, openPortalOn, openPortalSignedInOn, overviewWorkspaces, signInActionOn, siteLinkNotes, siteLinks,
} from './siteHarness'
import type { Sent } from '../ehr-blue/frame/blueHarness'

/**
 * lab.: the Laboratory product, which works on its own (owner, 2026-11-02). It serves every page the Laboratory opens
 * (ehr-blue/frame/product.ts opensInProduct) and its own sign-up, sign-in, recovery and invitations. Another product's own
 * page opens on that product's site. A page of the hospital EHR's stays here, where the frame opens the Laboratory's
 * Home in its place: nothing sends anyone to the EHR site.
 */
vi.mock('../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
const opened = vi.hoisted(() => vi.fn())
vi.mock('../../openSite', () => ({ openSite: opened }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => { opened.mockClear(); vi.stubGlobal('BroadcastChannel', TabChannel) })
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const LAB = 'lab.healthidentitydirectory.com'
const LOOKUP = 'POST /api/v1/identity/patient-lookup'
const LAB_STAGING = 'lab.staging.healthidentitydirectory.com'

describe(LAB, () => {
  it.each(['/provider', '/provider/sign-in', '/provider/recover', '/provider/enroll', '/provider/invitation', '/provider/join',
    '/provider/laboratory', '/provider/laboratory/item-1', '/provider/audit', '/provider/billing', '/provider/staff', '/provider/staff/join',
    '/provider/institutions', '/provider/patients', '/provider/patients/5a020001', '/provider/requests', '/provider/whats-left',
    '/provider/onboarding', '/provider/payments', '/provider/end-of-day', '/provider/payment-setup', '/provider/registration',
    '/provider/clinical', '/'])('serves %s', path => {
    expect(servedHere(path, LAB)).toBe(true)
    expect(servedHere(path, LAB_STAGING)).toBe(true)
  })

  it.each([
    ['/provider/pharmacy', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy'],
    ['/provider/pharmacy/sell?from=lab', 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy/sell?from=lab'],
    ['/provider/ocr', 'https://migrate.healthidentitydirectory.com/provider/ocr'],
    ['/provider/migrate', 'https://migrate.healthidentitydirectory.com/provider/migrate'],
    ['/provider/outreach', 'https://outreach.healthidentitydirectory.com/provider/outreach'],
    ['/records', 'https://app.healthidentitydirectory.com/records'],
  ])('opens %s on its own site', (path, href) => {
    const [pathname, search = ''] = path.split('?')
    expect(rightSiteHref({ pathname: pathname!, search: search ? `?${search}` : '', hash: '' }, LAB)).toBe(href)
  })

  it.each(['/provider/registration', '/provider/clinical?from=lab'])('keeps the Hospital EHR’s %s here, behind its own sign-in: nothing opens the EHR site', async path => {
    await openPortalOn(LAB, path)
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe(`/provider/sign-in?returnTo=${encodeURIComponent(path.split('?')[0]!)}`)
    expect(screen.queryByText(/Opening it there/)).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })

  // Signed in, through this site's own redirects and then the blue EHR: the page stays on this site, where the frame's
  // guard (#113) opens the Laboratory's Home in its place.
  it.each(['/provider/registration', '/provider/clinical', '/provider/in-person-check'])(
    'opens the Laboratory’s Home in place of the Hospital EHR’s %s, signed in, on this site: nothing opens the EHR site', async path => {
      await openPortalSignedInOn(LAB, path, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, EVERY_PERMISSION)
      await waitFor(() => expect(address()).toBe('/provider/laboratory'))
      expect(screen.queryByText(/Opening it there/)).toBeNull()
      expect(screen.queryByRole('heading', { name: homeHeading() })).toBeNull()
      expect(opened).not.toHaveBeenCalled()
    })

  it('opens the Laboratory’s Overview in place of the Hospital EHR’s pages in today’s workspace too', async () => {
    await openClassicOn(LAB, '/provider/clinical')
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(where()).toBe('/provider')
    expect(opened).not.toHaveBeenCalled()
  })

  it('sends Pharmacy, another product’s own page, to the pharmacy site', async () => {
    await openPortalOn(LAB, '/provider/pharmacy')
    await expectOpenedElsewhere(opened, 'https://pharmacy.healthidentitydirectory.com/provider/pharmacy')
    expect(document.title).toBe('Opening another Health ID site · Health ID')
  })

  it('sends the patient portal to the main site', async () => {
    await openPortalOn(LAB, '/records')
    await expectOpenedElsewhere(opened, 'https://app.healthidentitydirectory.com/records')
  })

  it('opens its own staff sign-in, which comes back to the page asked for', async () => {
    await openPortalOn(LAB, '/provider/audit')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Faudit')
    expect(opened).not.toHaveBeenCalled()
  })

  it('opens its own page at its address', async () => {
    await openPortalOn(LAB, '/')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Flaboratory')
    expect(opened).not.toHaveBeenCalled()
  })

  it('signs in with lab-login, the action Identity accepts on this site', async () => {
    expect(await signInActionOn(LAB)).toBe('lab-login')
  })

  it('lists the laboratory’s pages in today’s sidebar, and links to the other products’ sites, never the EHR’s', async () => {
    const sidebar = await openClassicOn(LAB)
    expect(classicPages(sidebar)).toEqual(['Overview', 'Patient access', 'Access requests', 'Facility audit', 'Laboratory', 'Plan & billing'])
    expect(siteLinks(sidebar)).toEqual([
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
    // Each named by its product, not its address.
    expect(siteLinkNotes(sidebar)).toEqual(['Health ID Pharmacy', 'Health ID Migrate', 'Health ID Outreach'])
    expectNoHostnameShown(sidebar)
  })

  it('offers the laboratory’s own workspace, Patient access and the access requests on the Overview, and nothing of the Hospital EHR’s', async () => {
    const sent: Sent[] = []
    await openClassicOn(LAB, '/provider', sent)
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(overviewWorkspaces()).toEqual(['Patient access', 'Laboratory'])
    expect(screen.getByText('Your other workspaces are on other Health ID sites, linked in the sidebar.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Access requests' })).toBeTruthy()
    expect(await screen.findByText('0 pending requests')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Health ID Migrate' })).toBeNull()
    expect(sent.map(request => request.route)).toContain('GET /api/v1/identity/access-requests')
  })

  it('serves Patients and Access requests here, behind its own sign-in, and offers no Patient registration', async () => {
    await openPortalOn(LAB, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(opened).not.toHaveBeenCalled()
    expect(offeredHere('/provider/requests', LAB)).toBe(true)
    // Registration stays in the EHR (owner rule): served here only so that the frame can open the Laboratory's Home.
    expect(offeredHere('/provider/registration', LAB)).toBe(false)
  })

  it('offers Patients and Access requests only to a role holding their own permissions', async () => {
    const sidebar = await openClassicOn(LAB, '/provider', [], ['lab.work-item.read'])
    expect(classicPages(sidebar)).toEqual(['Overview', 'Laboratory'])
  })

  it('counts no Hospital EHR workspace as elsewhere on the Overview: nothing links to one', async () => {
    const sidebar = await openClassicOn(LAB, '/provider', [], ['lab.work-item.read', 'ehr.encounter.read', 'identity.registration.write'])
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(overviewWorkspaces()).toEqual(['Laboratory'])
    expect(screen.queryByText('Your other workspaces are on other Health ID sites, linked in the sidebar.')).toBeNull()
    expect(screen.queryByText(/has no workspace/)).toBeNull()
    expect(siteLinks(sidebar)).toEqual([])
  })

  it('says plainly when a role’s workspaces are all the Hospital EHR’s, in place of an empty list', async () => {
    await openClassicOn(LAB, '/provider', [], ['ehr.encounter.read'])
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(overviewWorkspaces()).toEqual([])
    expect(screen.getByText('Your role has no workspace in Health ID Lab. Ask an administrator to review your assignment.')).toBeTruthy()
    expect(screen.queryByText('Your other workspaces are on other Health ID sites, linked in the sidebar.')).toBeNull()
    expectNoHostnameShown()
  })

  it('keeps a patient opened from Patient access on that page, with no link to a clinical record this site does not open', async () => {
    const lookup = () => json({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'read_records' },
      patient: { patientId: 'b1000000-0000-4000-8000-00000000a7c3', hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })
    const sidebar = await openClassicOn(LAB, '/provider/patients', [], ['identity.patient.read', 'lab.work-item.read'], { [LOOKUP]: [lookup] })
    fireEvent.change(await screen.findByRole('textbox', { name: 'Health ID' }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    expect(await screen.findByText('Access is allowed.')).toBeTruthy()
    expect(where()).toBe('/provider/patients')
    expect(screen.getByRole('heading', { level: 2, name: 'Current authorized record' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Open clinical record|emergency summary/ })).toBeNull()
    // The Overview offers no clinical record for it either.
    fireEvent.click(within(sidebar).getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Workspaces' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Current patient' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open clinical record →' })).toBeNull()
    expect(opened).not.toHaveBeenCalled()
  })

  it('opens the blue EHR at Demo Laboratory as the Laboratory, with this site’s pages only', async () => {
    const nav = await openBlueOn(LAB, { id: DEMO_LABORATORY, name: 'Demo Laboratory' }, EVERY_PERMISSION)
    // The redesign names the product and lists its own pages (frame/product.ts): each is one this site serves.
    expect(blueProduct()).toBe('Lab')
    expect(blueAddresses(nav).some(address => address === '/provider/laboratory' || address.startsWith('/provider/laboratory/'))).toBe(true)
    expect(blueAddresses(nav).filter(address => !offeredHere(address, LAB))).toEqual([])
    expect(siteLinks(nav)).toEqual([
      ['Pharmacy', 'https://pharmacy.healthidentitydirectory.com/'],
      ['Migrate', 'https://migrate.healthidentitydirectory.com/'],
      ['Outreach', 'https://outreach.healthidentitydirectory.com/'],
    ])
  })

  it('opens nothing of Demo Hospital here: it works on the Hospital EHR’s site', async () => {
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['lab.work-item.read'])
    await openBlueOn(LAB, { id: DEMO_HOSPITAL, name: 'Demo Hospital' }, EVERY_PERMISSION, [lab])
    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Hospital works on Hospital EHR' })).toBeTruthy()
    const page = within(document.querySelector<HTMLElement>('.hid-ehr-blue-page')!)
    expect(page.getByText(/^Demo Hospital is on Health ID EHR, where you sign in separately\./)).toBeTruthy()
    expectNoHostnameShown()
    expect(page.getByRole('link', { name: 'Open Hospital EHR' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/')
    expect(page.getByRole('link', { name: 'Choose workspace' }).getAttribute('href')).toBe('/provider/institutions')
  })
})

describe(LAB_STAGING, () => {
  it('keeps the Hospital EHR’s pages here, and sends Pharmacy to the staging pharmacy site', async () => {
    expect(rightSiteHref({ pathname: '/provider/registration', search: '', hash: '' }, LAB_STAGING)).toBeNull()
    await openPortalOn(LAB_STAGING, '/provider/pharmacy')
    await expectOpenedElsewhere(opened, 'https://pharmacy.staging.healthidentitydirectory.com/provider/pharmacy')
  })

  it('signs in with lab-login', async () => {
    expect(await signInActionOn(LAB_STAGING)).toBe('lab-login')
  })
})
