import { useEffect } from 'react'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ProductHostname from '../../../productHostname'
import { BlueFrame } from '../../../ehr-blue/frame/BlueFrame'

/**
 * Signing in on a product's own site (pharmacy., lab., outreach., migrate.) opens /provider, which the frame takes to
 * that product's first page. Whatever the role holds, the page settles: it never goes back to /provider and round
 * again. The product pages themselves are stand-ins here (what is tested is where the frame lands); each refusal is
 * the real one. Every account and facility is fictional.
 */

const host = vi.hoisted(() => ({ name: 'ehr.healthidentitydirectory.com' }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], selfService: undefined as { review: string; organizationType: string } | undefined }))

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../productHostname', async importOriginal => {
  const actual = await importOriginal<typeof ProductHostname>()
  return { ...actual, resolveStaffProductHostname: () => actual.resolveStaffProductHostname(host.name) }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: 'f0000000-0000-4000-8000-0000000000c1', membershipId: 'member-1', organizationId: 'org-1', name: 'Corner Pharmacy (fictional)',
      roles: ['facility_admin'], permissions: staff.permissions, isPrimary: true, ...(staff.selfService ? { selfService: staff.selfService } : {}) }
    return {
      state: { status: 'ready', session: { actor: { id: 'staff-1', email: 'admin@example.test', displayName: 'Demo Admin', roles: [], permissions: [],
        facilities: [facility], facility }, expiresAt: '2026-11-30T12:00:00.000Z' } },
      lock: null, signOut: async () => {}, refresh: async () => {}, activePatient: null, setActivePatient: () => true,
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
  it('neither permission (a pharmacy\'s administrator before Health ID\'s check): Prescriptions, which says plainly why it is closed', async () => {
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
    expect(screen.getByText(/^Your role at this facility doesn’t include pharmacy work\./)).toBeTruthy()
  })

  it('the same administrator once the facility is checked: today\'s sentence', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.selfService = { review: 'reviewed', organizationType: 'pharmacy' }
    const landed = await settle(PHARMACY, ['workforce.manage', 'audit.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText(NO_PHARMACY_WORK)).toBeTruthy()
  })

  it('other pharmacy pages but neither (Stock, Sales & receipts): Prescriptions, which says only prescriptions are not in the role', async () => {
    const landed = await settle(PHARMACY, ['pharmacy.stock.read', 'billing.bill.read'])
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Your role at this facility doesn’t include prescriptions. Ask your facility administrator.')).toBeTruthy()
    expect(screen.queryByText(NO_PHARMACY_WORK)).toBeNull()
    expect(screen.getByRole('link', { name: 'Stock' })).toBeTruthy()
  })

  it('a seller who opens Prescriptions by its address is told only prescriptions are not in the role', async () => {
    const landed = await settle(PHARMACY, [WALK_IN], '/provider/pharmacy/prescriptions')
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
    expect(screen.getByText('Your role at this facility doesn’t include prescriptions. Ask your facility administrator.')).toBeTruthy()
  })

  it('walk-in sales only: Sell', async () => {
    expect(await settle(PHARMACY, [WALK_IN])).toEqual({ where: '/provider/pharmacy/sell', heading: 'Sell (stand-in)' })
  })

  it('prescriptions only: Prescriptions', async () => {
    expect(await settle(PHARMACY, [READ])).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Prescriptions (stand-in)' })
  })

  it('both: Sell, as on that site today', async () => {
    expect(await settle(PHARMACY, [WALK_IN, READ])).toEqual({ where: '/provider/pharmacy/sell', heading: 'Sell (stand-in)' })
  })

  it('a Sell address the role cannot open comes back to a page that settles', async () => {
    const landed = await settle(PHARMACY, [], '/provider/pharmacy/sell')
    expect(landed).toEqual({ where: '/provider/pharmacy/prescriptions', heading: 'Pharmacy unavailable' })
  })
})

describe('the EHR site keeps its Pharmacy address as it was', () => {
  it.each([
    [[], '/provider/pharmacy/prescriptions', 'Pharmacy unavailable'],
    [[WALK_IN], '/provider/pharmacy/sell', 'Sell (stand-in)'],
    [[READ], '/provider/pharmacy/prescriptions', 'Prescriptions (stand-in)'],
    [[WALK_IN, READ], '/provider/pharmacy/prescriptions', 'Prescriptions (stand-in)'],
  ])('with %j, /provider/pharmacy opens %s', async (permissions, where, heading) => {
    // A clinical permission keeps the facility in the EHR, as a hospital is.
    expect(await settle('ehr.healthidentitydirectory.com', ['ehr.encounter.read', ...permissions], '/provider/pharmacy')).toEqual({ where, heading })
  })
})

describe('the lab., outreach. and migrate. sites settle too', () => {
  it.each([
    ['lab.healthidentitydirectory.com', [], '/provider/laboratory', 'Laboratory unavailable'],
    ['lab.healthidentitydirectory.com', ['lab.work-item.read'], '/provider/laboratory/work', 'Work list (stand-in)'],
    ['outreach.healthidentitydirectory.com', [], '/provider/outreach', 'Outreach unavailable'],
    ['outreach.healthidentitydirectory.com', ['outreach.registration.read'], '/provider/outreach', 'Outreach (stand-in)'],
    ['migrate.healthidentitydirectory.com', [], '/provider/ocr', 'Document OCR unavailable'],
    ['migrate.healthidentitydirectory.com', ['ocr.job.read'], '/provider/ocr', 'Document OCR (stand-in)'],
  ])('%s with %j settles on %s', async (site, permissions, where, heading) => {
    expect(await settle(site, permissions)).toEqual({ where, heading })
  })
})
