import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HID_ENDPOINTS } from '@hid/contracts'
import type { StaffSession } from '../../../../staff/api'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, LAB_WORK, PHARMACY_WORK, REAL_FACILITY, SESSION, facility, json, openStaffApp, serve, sessionAt, where,
  type Answer, type Sent,
} from '../../frame/blueHarness'
import { DEMO_PHARMACY_ID } from '../harness'

/*
 * The point-of-care pages (parity report 3.1 #20: Payments, Price list, End of day, Payment setup, the lab's New request,
 * Tests & prices, Till and Settings, the pharmacy's Sell, Sales & receipts, Stock, Products & prices, Till and Settings)
 * call routes Health ID does not serve yet. At a real facility none is listed or opens, and opening its address sends
 * none of those requests; the pharmacy's work list opens without reading payment settings. The live pages' ways into
 * point of care (Paper prescription on Prescriptions, a lab request's sample guess, sending a released result) are closed
 * there too. The four demo facilities keep every page and way in as they had them. The blue EHR runs as clinics have it:
 * the clinic switch on and the real, merged registry. Every account and facility here is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

/** The point-of-care routes: proposed in the contract registry, served by no Health ID release yet. */
const UNSERVED = HID_ENDPOINTS.filter(endpoint => endpoint.status === 'proposed' && endpoint.note?.startsWith('Point of care'))
  .map(endpoint => new RegExp(`^(${endpoint.methods.join('|')}) ${endpoint.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`))
const unserved = (sent: readonly Sent[]) => sent.map(request => request.route).filter(route => UNSERVED.some(pattern => pattern.test(route)))

// Every permission these pages ask for (docs/POINT_OF_CARE_SPEC.md), held here so that only the facility decides.
const BILLING = ['billing.bill.read', 'billing.catalogue.read', 'billing.shift.own', 'billing.settings.manage', 'billing.payment.confirm']
const PHARMACY = ['pharmacy.work-item.read', 'pharmacy.walk-in.create', 'pharmacy.stock.read']
const LAB = ['lab.work-item.read', 'lab.walk-in.create']
const CLINICAL = ['identity.patient.read', 'ehr.encounter.read']

/** Each page by its address, with its name. */
const POINT_OF_CARE: readonly (readonly [string, string])[] = [
  ['payments', 'Payments'], ['price-list', 'Price list'], ['end-of-day', 'End of day'], ['payment-setup', 'Payment setup'],
  ['laboratory/new', 'New request'], ['laboratory/tests', 'Tests & prices'], ['laboratory/till', 'Till / End of day'],
  ['laboratory/settings', 'Payment setup'],
  ['pharmacy/sell', 'Sell'], ['pharmacy/sales', 'Sales & receipts'], ['pharmacy/stock', 'Stock'], ['pharmacy/products', 'Products & prices'],
  ['pharmacy/till', 'Till / End of day'], ['pharmacy/settings', 'Payment setup'],
]
const PHARMACY_COUNTER = ['Sell', 'Sales & receipts', 'Stock', 'Products & prices', 'Till / End of day', 'Payment setup']
const LAB_COUNTER = ['New request', 'Tests & prices', 'Till / End of day', 'Payment setup']
const FINANCE = ['Payments', 'Price list', 'End of day', 'Payment setup']

/** The price list read a lab request makes to guess its sample; the reads of a released result's record; sharing a result. */
const CATALOGUE = 'GET /api/v1/commercial/catalogue-items'
const ACCESSION = 'GET /api/v1/lab/accessions/accession-1'
const EXECUTIONS = 'GET /api/v1/lab/specimens/specimen-1/executions'
const SHARE = ['lab.result.share', 'lab.accession.read', 'lab.execution.read']

/** A fictional lab request, accepted and waiting for its sample. */
const toCollect = { id: 'work-item-1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e', version: 1, status: 'accepted',
  testName: 'Haemoglobin', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z' }
/** The same request with its result released, and the record the Results page reads for it (fresh answers each time). */
const released = { ...toCollect, status: 'completed', accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123' }
const revision = { version: 1, resultType: 'numeric', numericValue: 13.1, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5',
  abnormalFlag: null, entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-10-09T10:00:00.000Z',
  releasedAt: '2026-10-09T12:00:00.000Z', correctionReason: null }
const releasedRecord = (): Record<string, Answer[]> => ({
  [LAB_WORK]: [() => json({ items: [released] })],
  [ACCESSION]: [() => json({ id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open',
    specimens: [{ id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-000123', specimenType: 'Venous blood', status: 'received', version: 2 }] })],
  [EXECUTIONS]: [() => json({ items: [{ id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'requested-test-1',
    test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: toCollect.patientId, status: 'completed', version: 2,
    result: { id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 1,
      currentReleasedVersion: 1, revisions: [revision] } }] })],
})

const riverside = (permissions: readonly string[], name = 'Riverside Teaching Hospital (fictional)') => facility(REAL_FACILITY, name, permissions)

function sessionOf(current: ReturnType<typeof facility>): StaffSession {
  return { actor: { id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Demo Clinician', roles: current.roles, permissions: [],
    facilities: [current], facility: current }, expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

/** Every page the sidebar lists, its folded groups opened first. */
function linksIn(nav: HTMLElement): string[] {
  for (const group of within(nav).queryAllByRole('button', { expanded: false })) fireEvent.click(group)
  return within(nav).queryAllByRole('link').map(link => link.textContent ?? '')
}

describe('the point-of-care page entries', () => {
  it('open at none of them at a real facility, whatever it holds, and each at a demo facility that holds its permission', async () => {
    const [{ pages }, { pageAllowed }, { basePath }] = await Promise.all([import('../../../../ehr-blue/departments/pages'),
      import('../../../../ehr-blue/frame/pageAccess'), import('../../../../ehr-blue/frame/pageHref')])
    const all = [...CLINICAL, ...BILLING, ...PHARMACY, ...LAB]
    // With the old New walk-in address, which opens New request.
    const entries = [...POINT_OF_CARE.map(([path]) => path), 'laboratory/new-walk-in'].map(path => pages.find(page => basePath(page.path) === path))
    expect(entries.every(Boolean)).toBe(true)
    for (const page of entries) {
      expect(pageAllowed(page!, sessionOf(riverside(all)))).toBe(false)
      expect(pageAllowed(page!, sessionOf(facility(DEMO_HOSPITAL, 'Demo Hospital', all)))).toBe(true)
      // At a demo facility each still needs its own permission, as it did.
      expect(pageAllowed(page!, sessionOf(facility(DEMO_HOSPITAL, 'Demo Hospital', CLINICAL)))).toBe(false)
    }
  })
})

describe('at a real facility', () => {
  it.each(POINT_OF_CARE)('says /provider/%s is not available here, and sends none of the unserved requests', async (path, label) => {
    const here = riverside([...CLINICAL, ...BILLING, ...PHARMACY, ...LAB])
    const sent = serve({ [SESSION]: [sessionAt(here, [here])] })
    await openStaffApp(`/provider/${path}`)
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(label)
    expect(screen.getByText(`${label} is part of the Health ID demo only`)).toBeDefined()
    expect(screen.getByText('It is not available at Riverside Teaching Hospital (fictional).')).toBeDefined()
    const listed = linksIn(nav)
    for (const name of [...FINANCE, ...PHARMACY_COUNTER]) expect(listed).not.toContain(name)
    expect(listed).toContain('Prescriptions')
    expect(where()).toBe(`/provider/${path}`)
    expect(unserved(sent)).toEqual([])
  })

  it('opens a pharmacy on Prescriptions, lists none of the counter pages, and reads no payment settings', async () => {
    const pharmacy = riverside([...PHARMACY, ...BILLING], 'Riverside Pharmacy (fictional)')
    const sent = serve({ [SESSION]: [sessionAt(pharmacy, [pharmacy])], [PHARMACY_WORK]: [() => json({ items: [] })] })
    await openStaffApp('/provider')
    await waitFor(() => expect(where()).toBe('/provider/pharmacy/prescriptions'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Prescriptions' })).toBeDefined()
    const listed = linksIn(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(listed).toContain('Prescriptions')
    for (const name of PHARMACY_COUNTER) expect(listed).not.toContain(name)
    await waitFor(() => expect(sent.some(request => request.route === PHARMACY_WORK)).toBe(true))
    expect(unserved(sent)).toEqual([])
  })

  it('lists a laboratory’s Work list and Results, and none of its counter pages', async () => {
    const lab = riverside([...LAB, ...BILLING], 'Riverside Laboratory (fictional)')
    serve({ [SESSION]: [sessionAt(lab, [lab])] })
    // Tests & prices, not the work list: the work list's own payment-settings read waits for #64 (Laboratory.tsx).
    await openStaffApp('/provider/laboratory/tests')
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' })
    const listed = linksIn(nav)
    expect(listed).toEqual(expect.arrayContaining(['Work list', 'Results']))
    for (const name of LAB_COUNTER) expect(listed).not.toContain(name)
  })
})

describe('the live pages that lead into point of care, at a real facility', () => {
  it('offers no Paper prescription, and takes its address to the list without sending anything unserved', async () => {
    const pharmacy = riverside([...PHARMACY, ...BILLING], 'Riverside Pharmacy (fictional)')
    const sent = serve({ [SESSION]: [sessionAt(pharmacy, [pharmacy])], [PHARMACY_WORK]: [() => json({ items: [] }), () => json({ items: [] })] })
    await openStaffApp('/provider/pharmacy/prescriptions/paper')
    await waitFor(() => expect(where()).toBe('/provider/pharmacy/prescriptions'))
    expect(await screen.findByText('Nothing waiting to dispense')).toBeDefined()
    expect(screen.queryByRole('link', { name: 'Paper prescription' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Paper prescription' })).toBeNull()
    await act(async () => {})
    expect(unserved(sent)).toEqual([])
  })

  it('opens a lab request waiting for its sample without reading the price list', async () => {
    const lab = riverside([...LAB, ...BILLING, 'lab.accession.create', 'lab.specimen.collect'], 'Riverside Laboratory (fictional)')
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])], [LAB_WORK]: [() => json({ items: [toCollect] })] })
    await openStaffApp('/provider/laboratory/work/work-item-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeDefined()
    await act(async () => {})
    // The work list's own payment-settings read waits for #64 (Laboratory.tsx); the request itself reads nothing unserved.
    expect(sent.map(request => request.route)).not.toContain(CATALOGUE)
  })

  it('shows a released result without offering to send it', async () => {
    const lab = riverside([...LAB, ...SHARE], 'Riverside Laboratory (fictional)')
    const sent = serve({ [SESSION]: [sessionAt(lab, [lab])], ...releasedRecord() })
    await openStaffApp('/provider/laboratory/results/work-item-1')
    expect(await screen.findByText('Hemoglobin')).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Give the result' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Send to/ })).toBeNull()
    expect(unserved(sent)).toEqual([])
  })
})

describe('at the demo facilities, as before', () => {
  it('opens Demo Pharmacy on Sell, with every counter page in its menu', async () => {
    const demo = facility(DEMO_PHARMACY_ID, 'Demo Pharmacy', [...PHARMACY, ...BILLING], ['pharmacist'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider')
    await waitFor(() => expect(where()).toBe('/provider/pharmacy/sell'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Sell' })).toBeDefined()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(linksIn(nav)).toEqual(expect.arrayContaining(['Prescriptions', ...PHARMACY_COUNTER]))
  })

  it('lists every page of Demo Laboratory, and opens Tests & prices', async () => {
    const demo = facility(DEMO_LABORATORY, 'Demo Laboratory', [...LAB, ...BILLING], ['lab'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/laboratory/tests')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tests & prices' })).toBeDefined()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(linksIn(nav)).toEqual(expect.arrayContaining(['Work list', 'Results', ...LAB_COUNTER]))
    expect(screen.queryByText(/part of the Health ID demo only/)).toBeNull()
  })

  it('lists Finance’s pages at Demo Hospital, and opens Payments, which reads its bills as it did', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [...CLINICAL, ...BILLING])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp('/provider/payments')
    expect(await screen.findByRole('heading', { level: 1, name: 'Payments' })).toBeDefined()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(linksIn(nav)).toEqual(expect.arrayContaining(FINANCE))
    expect(screen.queryByText(/part of the Health ID demo only/)).toBeNull()
    await waitFor(() => expect(unserved(sent)).toContain('GET /api/v1/commercial/bills'))
  })

  it('offers Paper prescription at Demo Pharmacy, and opens it', async () => {
    const demo = facility(DEMO_PHARMACY_ID, 'Demo Pharmacy', [...PHARMACY, ...BILLING], ['pharmacist'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [PHARMACY_WORK]: [() => json({ items: [] })] })
    await openStaffApp('/provider/pharmacy/prescriptions')
    const link = await screen.findByRole('link', { name: 'Paper prescription' })
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'Paper prescription' })).toBeDefined()
    expect(where()).toBe('/provider/pharmacy/prescriptions/paper')
  })

  it('reads the price list for a sample guess at Demo Laboratory, as it did', async () => {
    const demo = facility(DEMO_LABORATORY, 'Demo Laboratory', [...LAB, ...BILLING, 'lab.accession.create', 'lab.specimen.collect'], ['lab'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [LAB_WORK]: [() => json({ items: [toCollect] })] })
    await openStaffApp('/provider/laboratory/work/work-item-1')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeDefined()
    await waitFor(() => expect(sent.map(request => request.route)).toContain(CATALOGUE))
  })

  it('offers to send a released result at Demo Laboratory, as it did', async () => {
    const demo = facility(DEMO_LABORATORY, 'Demo Laboratory', [...LAB, ...SHARE], ['lab'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], ...releasedRecord() })
    await openStaffApp('/provider/laboratory/results/work-item-1')
    expect(await screen.findByRole('heading', { name: 'Give the result' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send to patient: Haemoglobin' })).toBeDefined()
  })
})
