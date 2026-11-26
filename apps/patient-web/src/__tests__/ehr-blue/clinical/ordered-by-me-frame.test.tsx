import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, serve, sessionAt } from '../frame/blueHarness'

/*
 * "Ordered by me" (hid-system 0143, MY-1) inside the blue EHR's real frame, joined as clinical/pages.ts joins it: listed
 * under Care, and found in search, only for a member who orders lab tests or medicines (the overseer, hid-system#258,
 * 26 Nov 2026, following Ola's clinical view), reading the list with the contract's headers, and never a patient or a
 * Health ID in an address. Every account, facility and patient is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.doMock('../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../ehr-blue/frame/pages')
    const home = await import('../../../ehr-blue/home/pages')
    const clinical = await import('../../../ehr-blue/clinical/pages')
    return {
      ...actual,
      BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home,
        './clinical/pages.ts': { pages: clinical.pages.filter(page => page.path === 'ordered-by-me') } }),
    }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const LIST = 'GET /api/v1/ehr/my-orders'
const DOCTOR = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.prescription.read',
  'ehr.prescription.write', 'identity.patient.read']
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' })
const REFUSED = 'Ordered by me shows the tests and medicines you ordered here. It is for staff who order them.'

/** The pages search finds for "ordered". */
function searchFinds(): string[] {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const drawer = screen.getByRole('dialog', { name: 'Search' })
  fireEvent.change(within(drawer).getByRole('searchbox', { name: 'Health ID or page' }), { target: { value: 'ordered' } })
  const found = within(drawer).queryAllByRole('link').map(link => link.textContent ?? '')
  fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
  return found
}
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

const ORDER = {
  kind: 'lab_request', orderId: 'c0000000-0000-4000-8000-000000000001', encounterId: 'e0000000-0000-4000-8000-000000000001',
  patient: { patientId: 'a0000000-0000-4000-8000-000000000001', fullName: 'Patient One', sex: 'female', dateOfBirth: '1990-04-12', healthIdLast4: 'AAA2' },
  display: 'Full blood count', status: 'active', priority: 'routine', createdAt: '2026-11-20T09:15:00.000Z', updatedAt: '2026-11-20T09:15:00.000Z',
  ownProgress: { status: 'unknown', receivedAt: null, collectedAt: null, lastResultAt: null }, orderRoute: null,
}

describe('Ordered by me in the frame', () => {
  it('is listed under Care and reads the list for direct care at the working facility, with nothing of the patient in the address', async () => {
    const doctor = facility(REAL_FACILITY, 'Demo Hospital', DOCTOR, ['doctor'])
    const urls: string[] = []
    const sent = serve({
      [SESSION]: [sessionAt(doctor, [doctor])],
      [LIST]: [() => json({ items: [ORDER], hiddenCount: 2, hiddenCountComplete: true, since: '2026-08-27', nextCursor: null })],
    })
    await openStaffApp('/provider/ordered-by-me')
    expect(await screen.findByRole('heading', { level: 1, name: 'Ordered by me' })).toBeDefined()
    const link = within(nav()).getByRole('link', { name: 'Ordered by me' })
    expect(link.getAttribute('href')).toBe('/provider/ordered-by-me')
    expect(within(nav()).getByText('Care')).toBeDefined()

    const row = await screen.findByRole('listitem', { name: 'Full blood count' })
    expect(within(row).getByText('Progress not available right now')).toBeDefined()
    expect(within(row).getByText('Routine')).toBeDefined()
    expect(screen.getByText('2 more orders are for patients whose records you can no longer open.')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/unverified|permission|HID-|[–—]/i)

    const call = sent.find(item => item.route === LIST)!
    expect(call.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(call.headers.get('X-Facility-ID')).toBe(REAL_FACILITY)
    for (const [url] of vi.mocked(fetch).mock.calls) urls.push(String(url))
    const read = new URL(urls.find(url => url.includes('/my-orders'))!)
    expect(Object.fromEntries(read.searchParams)).toEqual({ limit: '25' })
    for (const url of urls) expect(url).not.toMatch(/HID-|AAA2|Patient|a0000000-0000-4000-8000-000000000001/i)
  })

  it('is not listed for a role that reads neither kind of order, and its address says who it is for without reading', async () => {
    const desk = facility(REAL_FACILITY, 'Demo Hospital', ['ehr.encounter.read', 'ehr.encounter.write', 'identity.patient.read'], ['receptionist'])
    const sent = serve({ [SESSION]: [sessionAt(desk, [desk])] })
    await openStaffApp('/provider/ordered-by-me')
    expect(await screen.findByText(REFUSED)).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Ordered by me' })).toBeNull()
    await settle()
    expect(sent.filter(call => call.route === LIST)).toEqual([])
  })

  it.each([
    ['laboratory staff, who read lab requests only', ['ehr.lab-request.read', 'lab.work-item.read'], 'lab_scientist'],
    ['pharmacy staff, who read prescriptions only', ['ehr.prescription.read', 'pharmacy.work-item.read'], 'pharmacist'],
    ['a nurse who reads both kinds but orders neither', ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.prescription.read'], 'nurse'],
    ['a member who orders lab tests but cannot read them', ['ehr.encounter.read', 'ehr.lab-request.write'], 'doctor'],
  ])('is not listed or found for %s, and its address says who it is for without reading', async (_who, permissions, role) => {
    const member = facility(REAL_FACILITY, 'Demo Hospital', [...permissions, 'identity.patient.read'], [role])
    const sent = serve({ [SESSION]: [sessionAt(member, [member])] })
    await openStaffApp('/provider/ordered-by-me')
    expect(await screen.findByText(REFUSED)).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Ordered by me' })).toBeNull()
    expect(searchFinds()).toEqual([])
    await settle()
    expect(sent.filter(call => call.route === LIST)).toEqual([])
    expect(document.body.textContent).not.toMatch(/unverified|permission|HID-|[–—]/i)
  })

  it('is listed and found for a member who orders medicines only, and asks for prescriptions only', async () => {
    const prescriber = facility(REAL_FACILITY, 'Demo Hospital',
      ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.prescription.read', 'ehr.prescription.write', 'identity.patient.read'], ['nurse'])
    serve({
      [SESSION]: [sessionAt(prescriber, [prescriber])],
      [LIST]: [() => json({ items: [], hiddenCount: 0, hiddenCountComplete: true, since: '2026-08-27', nextCursor: null })],
    })
    await openStaffApp('/provider/ordered-by-me')
    expect(await screen.findByText('No orders')).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Ordered by me' })).toBeDefined()
    expect(searchFinds()).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Show' })).toBeNull()
    const read = vi.mocked(fetch).mock.calls.map(([url]) => String(url)).find(url => url.includes('/my-orders'))!
    expect(Object.fromEntries(new URL(read).searchParams)).toEqual({ kind: 'prescription', limit: '25' })
  })
})
