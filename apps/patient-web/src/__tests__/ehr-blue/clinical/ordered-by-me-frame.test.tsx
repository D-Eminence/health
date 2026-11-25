import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import { REAL_FACILITY, SESSION, facility, json, openStaffApp, serve, sessionAt } from '../frame/blueHarness'

/*
 * "Ordered by me" (hid-system 0143, MY-1) inside the blue EHR's real frame, joined as clinical/pages.ts joins it: listed
 * under Care for a member holding either read permission, reading the list with the contract's headers, and never a
 * patient or a Health ID in an address. Every account, facility and patient is fictional.
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
    expect(await screen.findByText('Ordered by me shows the tests and medicines you ordered here. It is for staff who order them.')).toBeDefined()
    expect(within(nav()).queryByRole('link', { name: 'Ordered by me' })).toBeNull()
    await settle()
    expect(sent.filter(call => call.route === LIST)).toEqual([])
  })

  it('is listed for a role that reads prescriptions only', async () => {
    const nurse = facility(REAL_FACILITY, 'Demo Hospital', ['ehr.encounter.read', 'ehr.prescription.read', 'identity.patient.read'], ['nurse'])
    serve({
      [SESSION]: [sessionAt(nurse, [nurse])],
      [LIST]: [() => json({ items: [], hiddenCount: 0, hiddenCountComplete: true, since: '2026-08-27', nextCursor: null })],
    })
    await openStaffApp('/provider/ordered-by-me')
    expect(await screen.findByText('No orders')).toBeDefined()
    expect(within(nav()).getByRole('link', { name: 'Ordered by me' })).toBeDefined()
  })
})
