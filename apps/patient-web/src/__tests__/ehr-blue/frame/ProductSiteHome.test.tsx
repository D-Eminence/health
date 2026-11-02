import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../productHostname'
import type * as StaffApi from '../../../staff/api'
import { BlueFrame } from '../../../ehr-blue/frame/BlueFrame'
import { forgetReceiving } from '../../../staff/orderRoutes'
import { DEMO_PHARMACY_ID } from '../departments/harness'

/**
 * Signing in on a product's own site (pharmacy., lab., outreach., migrate.) opens /provider, which the frame takes to
 * that product's first page (on lab., outreach. and migrate., only when this role may open it: otherwise /provider stays
 * on Home). Whatever the role holds, the page settles: it never goes back to /provider and round again. The product
 * pages themselves are stand-ins here (what is tested is where the frame lands); each refusal is the real one. Sell and
 * the pharmacy's other counter pages show at the demo facilities only until Health ID serves their routes
 * (departments/commerce/served.ts), so the cases that open them are at Demo Pharmacy, and each has its case at a real
 * facility, where the pharmacy opens on Prescriptions. Every account and facility is fictional.
 */

const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], selfService: undefined as { review: string; organizationType: string } | undefined,
  activePatient: null as unknown, facility: { id: '', name: '' } }))

/**
 * The order routes Home reads (Incoming orders, Orders accepted for the wrong person), answered here by service: the
 * mocked session above is not the API client's, which would hold every protected request until one is ready.
 */
const orders = vi.hoisted(() => ({ answers: {} as Record<string, unknown>, asked: [] as string[] }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  const answer = (route: string, otherwise: () => Promise<never>) => {
    orders.asked.push(route)
    return route in orders.answers ? Promise.resolve(orders.answers[route] as never) : otherwise()
  }
  return { ...actual, orderRoutesApi: { ...actual.orderRoutesApi,
    incoming: (facilityId: string, service: StaffApi.ReceivingService, healthId?: string) =>
      answer(`incoming ${service}`, () => actual.orderRoutesApi.incoming(facilityId, service, healthId) as Promise<never>),
    sentWrongPatient: (facilityId: string) =>
      answer('wrong-patient', () => actual.orderRoutesApi.sentWrongPatient(facilityId) as Promise<never>),
  } }
})
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: () => actual.resolveStaffProductHostname(host.name) }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: staff.facility.id, membershipId: 'member-1', organizationId: 'org-1', name: staff.facility.name,
      roles: ['facility_admin'], permissions: staff.permissions, isPrimary: true, ...(staff.selfService ? { selfService: staff.selfService } : {}) }
    return {
      state: { status: 'ready', session: { actor: { id: 'staff-1', email: 'admin@example.test', displayName: 'Demo Admin', roles: [], permissions: [],
        facilities: [facility], facility }, expiresAt: '2026-11-30T12:00:00.000Z' } },
      lock: null, signOut: async () => {}, refresh: async () => {}, activePatient: staff.activePatient, setActivePatient: () => true,
    }
  },
}))
vi.mock('../../../ehr-blue/departments/pharmacy/Sell', () => ({ Sell: () => <h1>Sell (stand-in)</h1> }))
vi.mock('../../../ehr-blue/departments/pharmacy/Pharmacy', async importOriginal => ({
  ...await importOriginal<object>(), Prescriptions: () => <h1>Prescriptions (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/laboratory/Laboratory', async importOriginal => ({
  ...await importOriginal<object>(), Laboratory: () => <h1>Work list (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/outreach/Outreach', async importOriginal => ({
  ...await importOriginal<object>(), Outreach: () => <h1>Outreach (stand-in)</h1>,
}))
vi.mock('../../../ehr-blue/departments/migrate/Migrate', async importOriginal => ({
  ...await importOriginal<object>(), Migrate: () => <h1>Document OCR (stand-in)</h1>,
}))

/** A real facility: Health ID does not serve the point-of-care routes there yet, so it has no Sell. */
const REAL = { id: 'f0000000-0000-4000-8000-0000000000c1', name: 'Corner Pharmacy (fictional)' }
/** One of the four demo facilities, where Sell and the other counter pages show. */
const DEMO = { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy' }

/** Every address the app went to, in order. */
let trail: string[] = []

/** A loop goes round without a pause: past this many addresses, the app is stopped, so the test fails instead of hanging. */
const ROUND = 25

function Trail() {
  const { pathname } = useLocation()
  useEffect(() => {
    trail.push(pathname)
    if (trail.length > ROUND) throw new Error(`The address went round: ${trail.slice(0, 6).join(' → ')} …`)
  }, [pathname])
  return <output data-testid="where">{pathname}</output>
}

beforeEach(() => {
  trail = []
  host.name = 'ehr.healthidentitydirectory.com'
  staff.permissions = []
  staff.selfService = undefined
  staff.activePatient = null
  staff.facility = REAL
  orders.answers = {}
  orders.asked = []
})
afterEach(() => { vi.unstubAllEnvs() })

/** Signs in on `site` with `permissions` and waits for the page to settle; answers where it settled and its heading. */
async function settle(site: string, permissions: readonly string[], path = '/provider') {
  host.name = site
  staff.permissions = [...permissions]
  render(<MemoryRouter initialEntries={[path]}><Trail /><Routes><Route path="/provider/*" element={<BlueFrame />} /></Routes></MemoryRouter>)
  const heading = await screen.findByRole('heading', { level: 1 })
  // Give a loop the time to show itself: the address must stay where it landed.
  const landed = screen.getByTestId('where').textContent
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  expect(screen.getByTestId('where').textContent).toBe(landed)
  // /provider is passed once at most, never again on the way round.
  expect(trail.filter(address => address === '/provider').length).toBeLessThanOrEqual(1)
  return { where: landed, heading: heading.textContent }
}

const PHARMACY = 'pharmacy.healthidentitydirectory.com'
const WALK_IN = 'pharmacy.walk-in.create'
const READ = 'pharmacy.work-item.read'
const NO_PHARMACY_WORK = 'Your role at this facility doesn’t include pharmacy work. Ask your facility administrator.'
/** What a self-signed-up facility's administrator holds while Health ID support checks it. */
const AWAITING_REVIEW = ['workforce.manage', 'audit.read', 'outreach.registration.read', 'outreach.registration.write', 'outreach.campaign.read', 'outreach.campaign.write']

describe('the pharmacy. site settles on a page whatever the role holds', () => {
  it('neither permission (a non-pharmacist on that site): Prescriptions, which says plainly why it is closed', async () => {
    const landed = await settle(PHARMACY, ['workforce.manage'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
    // No permission name, code or dotted id on the page.
    expect(document.body.textContent).not.toMatch(/work-item|walk-in|permission|pharmacy\.\w/)
  })

  it('a pharmacy\'s administrator while Health ID checks the facility: Prescriptions, which says it opens after the check', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.selfService = { review: 'pending', organizationType: 'pharmacy' }
    const landed = await settle(PHARMACY, ['workforce.manage', 'audit.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Pharmacy opens once Health ID support has checked your facility.')).toBeTruthy()
    // Not told to ask the facility administrator, which they are.
    expect(screen.queryByText(NO_PHARMACY_WORK)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Ask your facility administrator/)
    expect(document.body.textContent).not.toMatch(/work-item|walk-in|permission|pharmacy\.\w/)
  })

  it.each([['a laboratory', 'laboratory'], ['another kind of', 'other']])('%s facility\'s administrator while Health ID checks it: never promised Pharmacy, which it will not get', async (_kind, organizationType) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.selfService = { review: 'pending', organizationType }
    const landed = await settle(PHARMACY, AWAITING_REVIEW)
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    // The banner names no Pharmacy for this kind of facility, so the page below it promises none.
    expect(screen.getByText(/^Health ID support is checking/).textContent).not.toMatch(/Pharmacy (work|workspace)/)
    expect(document.body.textContent).not.toMatch(/Pharmacy opens/)
    // Nor told to ask the facility administrator, which they are: there is no pharmacy step to give them.
    expect(screen.getByText('Your role at this facility doesn’t include pharmacy work.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Ask your facility administrator|Add a pharmacist/)
  })

  it('the same administrator once the facility is checked: told the step that is theirs, adding a pharmacist', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    const landed = await settle(PHARMACY, ['organization.manage', 'workforce.manage', 'audit.read', 'identity.registration.read',
      'outreach.registration.read', 'outreach.campaign.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Your role at this facility doesn’t include pharmacy work. Add a pharmacist on the Staff page.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Ask your facility administrator/)
    expect(document.body.textContent).not.toMatch(/work-item|walk-in|permission|pharmacy\.\w/)
  })

  it('anyone else at that checked facility is still told to ask its administrator', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    await settle(PHARMACY, ['outreach.registration.read'])
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
  })

  it('other pharmacy pages but neither (Stock, Sales & receipts), at a demo facility: Prescriptions, which says only prescriptions are not in the role', async () => {
    staff.facility = DEMO
    const landed = await settle(PHARMACY, ['pharmacy.stock.read', 'billing.bill.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Your role at this facility doesn’t include prescriptions. Ask your facility administrator.')).toBeTruthy()
    expect(screen.queryByText(NO_PHARMACY_WORK)).toBeNull()
    expect(screen.getByRole('link', { name: 'Stock' })).toBeTruthy()
  })

  it('a seller at a demo facility who opens Prescriptions by its address is told only prescriptions are not in the role', async () => {
    staff.facility = DEMO
    const landed = await settle(PHARMACY, [WALK_IN], '/provider/pharmacy/prescriptions')
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Your role at this facility doesn’t include prescriptions. Ask your facility administrator.')).toBeTruthy()
  })

  it('walk-in sales only, at a demo facility: Sell', async () => {
    staff.facility = DEMO
    expect(await settle(PHARMACY, [WALK_IN])).toEqual({ where: '/provider/pharmacy/sell', heading: 'Sell (stand-in)' })
  })

  it('prescriptions only: Prescriptions', async () => {
    expect(await settle(PHARMACY, [READ])).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Prescriptions (stand-in)' })
  })

  it('both, at a demo facility: Sell, as on that site today', async () => {
    staff.facility = DEMO
    expect(await settle(PHARMACY, [WALK_IN, READ])).toEqual({ where: '/provider/pharmacy/sell', heading: 'Sell (stand-in)' })
  })

  it('a Sell address the role cannot open at a demo facility comes back to a page that settles', async () => {
    staff.facility = DEMO
    const landed = await settle(PHARMACY, [], '/provider/pharmacy/sell')
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
  })
})

describe('at a real facility, where Health ID does not serve Sell yet, the pharmacy. site settles on Prescriptions', () => {
  it('walk-in sales only: Prescriptions, which says plainly why it is closed', async () => {
    const landed = await settle(PHARMACY, [WALK_IN])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    // Sell does not open here, so no pharmacy page is in the role: "only prescriptions are not in it" would be wrong.
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sell' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/work-item|walk-in|permission|pharmacy\.\w/)
  })

  it('both: Prescriptions, with no Sell in the menu', async () => {
    expect(await settle(PHARMACY, [WALK_IN, READ])).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Prescriptions (stand-in)' })
    expect(screen.queryByRole('link', { name: 'Sell' })).toBeNull()
  })

  it('other pharmacy pages but neither (Stock, Sales & receipts): Prescriptions, with none of those pages in the menu', async () => {
    const landed = await settle(PHARMACY, ['pharmacy.stock.read', 'billing.bill.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Stock' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sales & receipts' })).toBeNull()
  })

  it('a seller who opens Prescriptions by its address is told the role has no pharmacy work here', async () => {
    const landed = await settle(PHARMACY, [WALK_IN], '/provider/pharmacy/prescriptions')
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/include prescriptions/)
  })

  it.each([[[]], [[WALK_IN]]])('the Sell address, with %j, says Sell is part of the demo only and stays there', async permissions => {
    const landed = await settle(PHARMACY, permissions, '/provider/pharmacy/sell')
    expect(landed).toEqual({ where: '/provider/pharmacy/sell', heading: 'Sell' })
    expect(screen.getByText('Sell is part of the Health ID demo only')).toBeTruthy()
    expect(screen.getByText('It is not available at Corner Pharmacy (fictional).')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sell (stand-in)' })).toBeNull()
  })
})

describe('the EHR site keeps its Pharmacy address as it was', () => {
  it.each([
    [[], '/provider/pharmacy/prescriptions', 'Pharmacy unavailable'],
    [[WALK_IN], '/provider/pharmacy/sell', 'Sell (stand-in)'],
    [[READ], '/provider/pharmacy/prescriptions', 'Prescriptions (stand-in)'],
    [[WALK_IN, READ], '/provider/pharmacy/prescriptions', 'Prescriptions (stand-in)'],
  ])('at a demo facility, with %j, /provider/pharmacy opens %s', async (permissions, where, heading) => {
    staff.facility = DEMO
    // A clinical permission keeps the facility in the EHR, as a hospital is.
    expect(await settle('ehr.healthidentitydirectory.com', ['ehr.encounter.read', ...permissions], '/provider/pharmacy')).toEqual({ where, heading })
  })

  it.each([
    [[], 'Pharmacy unavailable'],
    [[WALK_IN], 'Pharmacy unavailable'],
    [[READ], 'Prescriptions (stand-in)'],
    [[WALK_IN, READ], 'Prescriptions (stand-in)'],
  ])('at a real facility, with %j, /provider/pharmacy opens Prescriptions (%s): Sell is not served there yet', async (permissions, heading) => {
    expect(await settle('ehr.healthidentitydirectory.com', ['ehr.encounter.read', ...permissions], '/provider/pharmacy'))
      .toEqual({ where: '/provider/pharmacy/prescriptions', heading })
  })
})

describe('the lab., outreach. and migrate. sites settle too', () => {
  it.each([
    ['lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/laboratory/work', 'Work list (stand-in)'],
    ['outreach.healthidentitydirectory.com', ['outreach.registration.read'], '/provider/outreach', 'Outreach (stand-in)'],
    ['migrate.healthidentitydirectory.com', ['ocr.job.read'], '/provider/ocr', 'Document OCR (stand-in)'],
  ])('%s with %j settles on %s', async (site, permissions, where, heading) => {
    expect(await settle(site, permissions)).toEqual({ where, heading })
  })

  // With none of the product's work, its own page would only refuse, so /provider stays on Home (the Overview), as
  // today's portal lands there (EhrBlueProductFallback.test.tsx). It settles there and never visits the refusal.
  it.each([
    ['lab.healthidentitydirectory.com', 'Laboratory unavailable'],
    ['outreach.healthidentitydirectory.com', 'Outreach unavailable'],
    ['migrate.healthidentitydirectory.com', 'Document OCR unavailable'],
  ])('%s with none of the product\'s work settles on Home at /provider, not on "%s"', async (site, refusal) => {
    const sent = vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', sent)
    try {
      const landed = await settle(site, [])
      expect(landed.where).toBe('/provider')
      expect(landed.heading).toMatch(/^Good (morning|afternoon|evening), Demo Admin$/)
      expect(trail).toEqual(['/provider'])
      expect(screen.queryByRole('heading', { name: refusal })).toBeNull()
      // Home reads none of the product's work (nor anything else, for a role with none).
      expect(sent).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // The product's own address, opened directly (a bookmark), still settles on its plain refusal.
  it.each([
    ['lab.healthidentitydirectory.com', '/provider/laboratory', 'Laboratory unavailable'],
    ['outreach.healthidentitydirectory.com', '/provider/outreach', 'Outreach unavailable'],
    ['migrate.healthidentitydirectory.com', '/provider/ocr', 'Document OCR unavailable'],
  ])('%s opened at %s with none of the product\'s work settles on "%s"', async (site, where, heading) => {
    expect(await settle(site, [], where)).toEqual({ where, heading })
  })
})

/**
 * Home on lab. (where /provider stays Home for a role without the work list) links only to pages lab. opens: the frame
 * sends any other page back Home (product.ts opensInProduct), so a link to Consultation or to Pharmacy would only come
 * back. In the EHR, where every page opens, the same links are as they were.
 */
describe('Home on a product site links only to pages that site opens', () => {
  const LAB = 'lab.healthidentitydirectory.com'
  const EHR = 'ehr.healthidentitydirectory.com'
  const PATIENT_ID = 'a0000000-0000-4000-8000-0000000000d1'
  const PATIENT = 'Ada Obi (fictional)'
  const openPatient = {
    hid: 'HID-ZDEMOAD1', purpose: 'direct-care',
    lookup: {
      patient: { patientId: PATIENT_ID, hid: 'HID-ZDEMOAD1', fullName: PATIENT, dateOfBirth: '1990-04-12', gender: 'female', version: 1 },
      authorization: { decision: 'allow', consentGrantId: 'grant-d1', expiresAt: '2026-11-30T12:00:00.000Z', breakGlass: false },
    },
  }

  // A lab request this facility sent, which a laboratory reports it accepted for someone who was not the patient.
  const WRONG_PATIENT = {
    windowDays: 30,
    others: { count: 0, references: [] },
    items: [{
      routeId: 'route-wrong-1', kind: 'lab_request', reference: 'AB12CD34', endedAt: '2026-10-30T10:00:00.000Z', resultsWithdrawn: 0,
      dispensingReversed: false, patient: { name: PATIENT }, receivingFacility: { id: null, name: 'Hilltop Laboratory (fictional)' },
      link: { patientId: PATIENT_ID, encounterId: 'e0000000-0000-4000-8000-0000000000d1', kind: 'lab_request', orderId: 'o0000000-0000-4000-8000-0000000000d1' },
    }],
  }

  /** Answers the order routes named; nothing else is answered (and nothing reaches the network), so nothing else shows. */
  function answer(routes: Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL) => new Promise<Response>(() => {})))
    orders.answers = routes
  }

  afterEach(() => { vi.unstubAllGlobals(); forgetReceiving() })

  it('the open patient leads to their page under Patients, not to Consultation, and it stays there', async () => {
    answer({})
    staff.activePatient = openPatient
    const landed = await settle(LAB, ['audit.read', 'identity.patient.read'])
    expect(landed.where).toBe('/provider')
    const row = screen.getByRole('link', { name: new RegExp(PATIENT.replace(/[()]/g, '\\$&')) })
    expect(row.getAttribute('href')).toBe('/provider/patients/open')
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/patients/open'))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(screen.getByTestId('where').textContent).toBe('/provider/patients/open')
  })

  it('without Patients, the open patient is not offered there at all', async () => {
    answer({})
    staff.activePatient = openPatient
    const landed = await settle(LAB, ['audit.read'])
    expect(landed.where).toBe('/provider')
    expect(screen.queryByText(PATIENT)).toBeNull()
    expect(document.querySelector('a[href="/provider/clinical"]')).toBeNull()
  })

  it('in the EHR, the open patient still leads to Consultation', async () => {
    answer({})
    staff.activePatient = openPatient
    await settle(EHR, ['identity.patient.read', 'ehr.encounter.read'])
    expect(screen.getByRole('link', { name: new RegExp(PATIENT.replace(/[()]/g, '\\$&')) }).getAttribute('href')).toBe('/provider/clinical')
  })

  it('incoming orders offer the laboratory only, and read no prescriptions', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    answer({
      'incoming lab': { items: [{ routeId: 'route-lab-1' }], receives: true },
      'incoming pharmacy': { items: [{ routeId: 'route-rx-1' }], receives: true },
    })
    const landed = await settle(LAB, ['audit.read', 'lab.order-route.receive', 'pharmacy.order-route.receive'])
    expect(landed.where).toBe('/provider')
    expect((await screen.findByRole('link', { name: 'Open Laboratory →' })).getAttribute('href')).toBe('/provider/laboratory')
    expect(screen.queryByRole('link', { name: 'Open Pharmacy →' })).toBeNull()
    expect(orders.asked).toEqual(['incoming lab'])
  })

  it('an order accepted for the wrong person is still told, with no way to open it in Consultation, which lab. does not open', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    answer({ 'wrong-patient': WRONG_PATIENT })
    staff.activePatient = openPatient
    await settle(LAB, ['audit.read', 'identity.patient.read', 'ehr.order-route.send'])
    expect(await screen.findByText(/Hilltop Laboratory \(fictional\) reports that it accepted it/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Open the lab request/ })).toBeNull()
    expect(document.querySelector('a[href="/provider/clinical"]')).toBeNull()
    // Nor sent round Patients to a consultation it cannot open here.
    expect(screen.queryByText(/To see it/)).toBeNull()
  })

  it('in the EHR, the same order still opens in Consultation', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    answer({ 'wrong-patient': WRONG_PATIENT })
    staff.activePatient = openPatient
    await settle(EHR, ['identity.patient.read', 'ehr.encounter.read', 'ehr.order-route.send'])
    expect((await screen.findByRole('link', { name: /Open the lab request/ })).getAttribute('href')).toBe('/provider/clinical')
  })

})
