import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetDocumentTypesServed } from '../../../documentTypes'
import { setStaffSessionReady } from '../../../staff/session'
import { forgetReceiving } from '../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { Laboratory } from '../../../ehr-blue/departments/laboratory/Laboratory'
import { Pharmacy } from '../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from './harness'
import { accepted, AMOXICILLIN, PRESCRIPTIONS, READ } from './pharmacy/fixtures'

/**
 * Q123 A (hid-system #298): the lab and pharmacy work lists answer `since`, the Lagos calendar day 90 days back, and the
 * blue lists say which finished work they hold. The real staff API, with only the network stubbed, so the client's own
 * reading of `since` is what is tested: a real date is shown, anything else is ignored and the list still shows, and an
 * answer without it (every backend today) shows exactly as before. Fictional data only: Demo Laboratory, Demo Pharmacy.
 */
const network = vi.hoisted(() => {
  const state = { lab: {} as Record<string, unknown>, pharmacy: {} as Record<string, unknown> }
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  // In place before the staff API loads, which binds the transport's fetch then.
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && url.pathname === '/api/v1/lab/work-items') return json(state.lab)
    if (method === 'GET' && url.pathname === '/api/v1/pharmacy/work-items') return json(state.pharmacy)
    return new Response(null, { status: 404 })
  })
  return state
})
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))

vi.mock('../../../staff/App', async () => {
  const { staffContext } = await import('./harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const LAB_ITEM = { id: 'work-item-1', patientId: 'patient-1', version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: null,
  accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z' }
const LINE = /^Showing open work, and finished work received since/

function forget() {
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
}
beforeEach(() => { setStaffSessionReady(true); forget() })
afterEach(() => { setStaffSessionReady(false); forget() })

async function openLab(answer: Record<string, unknown>) {
  network.lab = answer
  session.facility = fakeFacility(['lab.work-item.read'])
  const view = renderDept(<Laboratory />, { route: '/provider/laboratory/work' })
  await screen.findByRole('button', { name: /, Haemoglobin$/ })
  return view
}

async function openPharmacy(answer: Record<string, unknown>) {
  network.pharmacy = answer
  session.facility = fakeFacility([READ], { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
  const view = renderDept(<Pharmacy />, { route: PRESCRIPTIONS })
  await screen.findByRole('button', { name: AMOXICILLIN })
  return view
}

describe.each([
  ['Laboratory work list', openLab, [LAB_ITEM]],
  ['Pharmacy Prescriptions list', openPharmacy, [accepted]],
] as const)('%s', (_name, open, items) => {
  it('says which finished work it holds when the answer carries a real since date', async () => {
    await open({ items, since: '2026-08-24' })
    expect(screen.getByText(LINE).textContent).toBe('Showing open work, and finished work received since 24 Aug 2026.')
  })

  it('shows exactly as today when the answer carries no since', async () => {
    const today = (await open({ items })).container.innerHTML
    expect(screen.queryByText(LINE)).toBeNull()
    cleanup()
    // The same list with a since, once its line is taken away, is the page as it is shown today.
    const withSince = (await open({ items, since: '2026-08-24' })).container
    withSince.querySelector('p.hid-ehr-dept-muted')?.remove()
    expect(withSince.innerHTML).toBe(today)
  })

  it.each(['2026-02-30', '24 Aug 2026', '2026-8-24', '2026-08-24T00:00:00Z', 20260824, null, ''])(
    'ignores a since of %j and still shows the list', async since => {
      await open({ items, since })
      expect(screen.queryByText(LINE)).toBeNull()
    })
})
