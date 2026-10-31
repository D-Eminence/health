import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTED_ORDERS_NOTE, EncounterOrderPages, EncounterOrders, orderPath } from '../../../ehr-blue/clinical/consult/orders'
import { ChartProvider, READ_ONLY, useChart } from '../../../ehr-blue/clinical/parts/chart'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, FACILITY_NAME, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup, labelled, patientBanner, renderPage } from './harness'

/**
 * Orders raised from a consultation (prescriptions and lab requests): the design's "Connected orders", create and
 * record pages on today's API, with Send to Pharmacy, Send to Lab, sending to another facility (Demo Pharmacy, Demo
 * Laboratory) and what the receiving side reported. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(),
  acceptPrescription: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const routes = vi.hoisted(() => ({ destinations: vi.fn(), attestation: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  orderRoutesApi: routes,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const RX = 'b0000000-0000-4000-8000-000000000001'
const LAB = 'c0000000-0000-4000-8000-000000000001'
const ROUTE = 'd0000000-0000-4000-8000-000000000001'
const PHARMACY_ID = 'f0000000-0000-4000-8000-0000000000a1'
const LABORATORY_ID = 'f0000000-0000-4000-8000-0000000000b1'
const READ_WRITE = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.lab-request.read', 'ehr.lab-request.write']

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: RX, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z', medicationDisplay: 'Amoxicillin',
    doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily', instructions: 'After meals', status: 'draft', rowVersion: 1,
    ...overrides,
  }
}

function labRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: LAB, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:05:00.000Z', testCodeSystem: 'LOINC', testCode: '718-7',
    testDisplay: 'Haemoglobin', priority: 'routine', specimenTypeCode: 'blood', clinicalInformation: 'Tired for two weeks', status: 'draft', rowVersion: 1,
    ...overrides,
  }
}

function route(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTE, reference: '9C1B2D3E', kind: 'lab_request', version: 1, effectiveState: 'sent',
    receivingFacility: { id: LABORATORY_ID, name: 'Demo Laboratory', available: true }, createdAt: '2026-10-30T09:10:00.000Z',
    respondBy: '2026-11-06T09:10:00.000Z', acceptedAt: null, completedAt: null, endedAt: null, endedKind: null, declineReason: null,
    acceptLocked: false, resendAllowed: false, ...overrides,
  }
}

let lists: Record<string, unknown[]> = {}
let listExtra: Record<string, unknown> = {}

function setLists(prescriptions: unknown[], labs: unknown[], extra: Record<string, unknown> = {}) {
  lists = { prescriptions, 'lab-requests': labs }
  listExtra = extra
}

beforeEach(() => {
  staff.facilityId = undefined
  vi.clearAllMocks()
  forgetWrongPatientServed()
  forgetLateCorrectionServed()
  staff.permissions = [...READ_WRITE]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
  setLists([prescription()], [labRequest()])
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) => ({
    items: lists[kind] ?? [], nextCursor: null, ...listExtra,
  }))
  api.createRecord.mockResolvedValue(prescription())
  api.updateRecord.mockResolvedValue(prescription())
  api.reportedHealthProfile.mockResolvedValue(null)
  routes.attestation.mockImplementation(async (_facility: string, kind: string) => kind === 'lab_request'
    ? { kind, version: 'order-route-lab-attestation-v1', text: 'I confirm that {patient} agreed that {orderingFacility} sends this test request to {receivingFacility}.' }
    : { kind, version: 'order-route-prescription-attestation-v1', text: 'I confirm that {patient} agreed that {orderingFacility} sends this prescription to {receivingFacility}.' })
  routes.destinations.mockImplementation(async (_facility: string, kind: string) => ({
    items: [kind === 'pharmacy'
      ? { facilityId: PHARMACY_ID, facilityName: 'Demo Pharmacy', organizationName: 'Demo Health Ltd', registeredAddress: '1 Example Street, Lagos', newOnHealthId: false }
      : { facilityId: LABORATORY_ID, facilityName: 'Demo Laboratory', organizationName: null, registeredAddress: null, newOnHealthId: true }],
  }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function EncounterStub() {
  const chart = useChart()
  const { recordId = '' } = useParams()
  if (!chart) return <p>No patient open</p>
  return (
    <section aria-label="Available actions">
      <EncounterOrders chart={chart} encounter={{ id: recordId, patientId: PATIENT_ID, facilityId: staff.facilityId ?? FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }} />
    </section>
  )
}

/** As the consultation workspace mounts these parts: the encounter page and `:recordId/orders/*`. */
function Consult() {
  return (
    <Workspace path="consult">
      <ChartProvider>
        <Routes>
          <Route path=":recordId" element={<EncounterStub />} />
          <Route path=":recordId/orders/*" element={<EncounterOrderPages />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

function open(rest: string) {
  return renderPage(<Consult />, 'consult', `/${rest}`)
}

function where() {
  return screen.queryByTestId('elsewhere')?.textContent ?? null
}

function field(label: string) {
  return screen.getByLabelText(labelled(label)) as HTMLInputElement
}

function change(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

/**
 * The confirm-patient sheet every order save asks first (wrong-patient prevention): the open patient, compact, and what
 * saving does. Confirms it, so the save goes on.
 */
async function confirmPatient(effect: string, confirmLabel: string) {
  const sheet = await screen.findByRole('dialog', { name: 'Confirm the patient' })
  expect(within(sheet).getByRole('region', { name: `Patient: ${PATIENT_NAME}` })).toBeTruthy()
  expect(within(sheet).getByText(effect)).toBeTruthy()
  fireEvent.click(within(sheet).getByRole('button', { name: confirmLabel }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm the patient' })).toBeNull())
}

const SAVE_RX = (medicine = 'Amoxicillin') => `Save this prescription of ${medicine} for ${PATIENT_NAME}?`
const SAVE_LAB = (test = 'Haemoglobin') => `Save this lab request (${test}) for ${PATIENT_NAME} as a draft?`
const SEND_LAB = (test = 'Haemoglobin') => `Send this lab request (${test}) for ${PATIENT_NAME}?`

async function openOrder(kind: 'pharmacy' | 'laboratory', id: string) {
  open(orderPath(ENCOUNTER_ID, kind, id))
  return screen.findByRole('heading', { level: 1 })
}

describe('Connected orders', () => {
  it('shows the design’s create steps, its note and this encounter’s orders, read as today’s page reads them', async () => {
    // Radiology and referrals are samples, offered only at a demo facility.
    staff.facilityId = DEMO_HOSPITAL_ID
    open(ENCOUNTER_ID)
    // The encounter page's "Orders" card holds these steps (its heading is the encounter page's own).
    for (const name of ['New prescription', 'New lab request', 'New radiology request', 'New referral']) {
      expect((await screen.findByRole('button', { name })).tagName).toBe('BUTTON')
    }
    expect(screen.getByText(CONNECTED_ORDERS_NOTE)).toBeTruthy()
    const list = await screen.findByRole('list', { name: 'Orders from this consultation' })
    const rx = within(list).getByRole('link', { name: 'Pharmacy · Amoxicillin' })
    expect(rx.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${RX}`)
    expect(within(list).getByRole('link', { name: 'Laboratory · Haemoglobin' }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB}`)
    expect(within(list).getAllByText('Draft')).toHaveLength(2)
    expect(api.records).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')
    expect(api.records).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests')
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('offers no sample radiology or referral step at a real facility, only today’s pharmacy and laboratory', async () => {
    open(ENCOUNTER_ID)
    for (const name of ['New prescription', 'New lab request']) {
      expect((await screen.findByRole('button', { name })).tagName).toBe('BUTTON')
    }
    await screen.findByRole('list', { name: 'Orders from this consultation' })
    expect(screen.queryByRole('button', { name: 'New radiology request' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New referral' })).toBeNull()
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/provider\/(radiology|referrals)(\/|$)/)
    }
  })

  it('opens the pharmacy and laboratory create pages', async () => {
    open(ENCOUNTER_ID)
    fireEvent.click(await screen.findByRole('button', { name: 'New prescription' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New prescription' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New lab request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New lab request' })).toBeTruthy()
  })

  it('links radiology and referrals to their sample workspaces with no record of this patient in the address', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    open(ENCOUNTER_ID)
    fireEvent.click(await screen.findByRole('button', { name: 'New radiology request' }))
    expect(where()).toBe('/provider/radiology/new')
  })

  it('links referrals to the sample Referral Network workspace', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    open(ENCOUNTER_ID)
    fireEvent.click(await screen.findByRole('button', { name: 'New referral' }))
    expect(where()).toBe('/provider/referrals/new')
  })

  it('offers no create step under read-only access, and still lists the orders', async () => {
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    open(ENCOUNTER_ID)
    await screen.findByRole('link', { name: 'Pharmacy · Amoxicillin' })
    expect(screen.queryByRole('button', { name: /^New / })).toBeNull()
  })

  it('offers each create step only with its write permission', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.lab-request.read', 'ehr.lab-request.write']
    open(ENCOUNTER_ID)
    await screen.findByRole('button', { name: 'New lab request' })
    expect(screen.queryByRole('button', { name: 'New prescription' })).toBeNull()
  })

  it('says today’s empty sentences, and a refused read', async () => {
    setLists([], [])
    open(ENCOUNTER_ID)
    expect(await screen.findByText('No prescriptions yet.')).toBeTruthy()
    expect(screen.getByText('No lab requests yet.')).toBeTruthy()
  })

  it('shows a refused read in the design’s error box', async () => {
    api.records.mockRejectedValue(new HidApiError(503, 'Records are unavailable'))
    open(ENCOUNTER_ID)
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toBe('Records are unavailable')
  })

  it('shows nothing of orders for an emergency patient, and the order pages show the read-only notice', async () => {
    staff.activePatient = activePatient('emergency')
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save prescription' })).toBeNull()
    expect(api.records).not.toHaveBeenCalled()
  })
})

/** Fictional orders past today's 50 to a page: "Test medicine 1" … and "Test 1" … with ids of their own. */
function manyPrescriptions(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => prescription({
    id: `b1000000-0000-4000-8000-${String(from + index).padStart(12, '0')}`, medicationDisplay: `Test medicine ${from + index}`,
  }))
}

function manyLabRequests(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, index) => labRequest({
    id: `c1000000-0000-4000-8000-${String(from + index).padStart(12, '0')}`, testDisplay: `Test ${from + index}`,
  }))
}

type PageAnswer = { items: unknown[]; nextCursor: string | null }

/** Each kind's pages by cursor (none: the first page); a cursor with no page is refused as today's EHR refuses a stale one. */
function pagedLists(pages: Record<string, Record<string, PageAnswer>>) {
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string, page?: { cursor?: string }) => {
    const answer = pages[kind]?.[page?.cursor ?? 'first']
    if (!answer) throw new HidApiError(400, 'The cursor is invalid.', { code: 'INVALID_CURSOR' })
    return answer
  })
}

const RX_PAGES = { first: { items: manyPrescriptions(1, 50), nextCursor: 'rx-page-2' }, 'rx-page-2': { items: manyPrescriptions(51, 53), nextCursor: null } }
const LAB_PAGES = { first: { items: manyLabRequests(1, 50), nextCursor: 'lab-page-2' }, 'lab-page-2': { items: manyLabRequests(51, 52), nextCursor: null } }

async function pagerOf(list: 'Pharmacy' | 'Laboratory') {
  const group = await screen.findByRole('group', { name: list })
  return { group, pager: within(group).getByRole('navigation', { name: 'Record pages' }) }
}

function pageButton(pager: HTMLElement, name: 'Previous page' | 'Next page') {
  return within(pager).getByRole('button', { name }) as HTMLButtonElement
}

describe('Connected orders past 50 (review item 6: pagers past 50)', () => {
  it('item 6: pages more than 50 prescriptions with Next and Previous, sending today’s cursor', async () => {
    pagedLists({ prescriptions: RX_PAGES, 'lab-requests': { first: { items: [labRequest()], nextCursor: null } } })
    open(ENCOUNTER_ID)
    const { pager } = await pagerOf('Pharmacy')
    // The lab requests fit on one page: only the prescriptions are paged.
    expect(screen.getAllByRole('navigation', { name: 'Record pages' })).toHaveLength(1)
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    expect(pageButton(pager, 'Previous page').disabled).toBe(true)
    const list = screen.getByRole('list', { name: 'Orders from this consultation' })
    expect(within(list).getAllByRole('link', { name: /^Pharmacy · / })).toHaveLength(50)
    expect(within(list).queryByRole('link', { name: 'Pharmacy · Test medicine 51' })).toBeNull()
    // Today's first read takes no page argument.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')

    fireEvent.click(pageButton(pager, 'Next page'))
    expect(await within(pager).findByText('Page 2')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: 'rx-page-2', fresh: false })
    const second = screen.getByRole('list', { name: 'Orders from this consultation' })
    expect(within(second).getAllByRole('link', { name: /^Pharmacy · / }).map(link => link.textContent))
      .toEqual(['Pharmacy · Test medicine 51', 'Pharmacy · Test medicine 52', 'Pharmacy · Test medicine 53'])
    expect(within(second).getByRole('link', { name: 'Laboratory · Haemoglobin' })).toBeTruthy()
    expect(pageButton(pager, 'Next page').disabled).toBe(true)
    expect(pageButton(pager, 'Previous page').disabled).toBe(false)

    fireEvent.click(pageButton(pager, 'Previous page'))
    expect(await within(pager).findByText('Page 1')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: false })
    expect(screen.getByRole('link', { name: 'Pharmacy · Test medicine 1' })).toBeTruthy()
    // As today, moving between record pages re-checks no access.
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('item 6: pages more than 50 lab requests with Next and Previous on their own pager, sending today’s cursor', async () => {
    pagedLists({ prescriptions: RX_PAGES, 'lab-requests': LAB_PAGES })
    open(ENCOUNTER_ID)
    const lab = await pagerOf('Laboratory')
    const rx = await pagerOf('Pharmacy')
    expect(screen.getAllByRole('navigation', { name: 'Record pages' })).toHaveLength(2)
    expect(within(screen.getByRole('list', { name: 'Orders from this consultation' })).getAllByRole('link', { name: /^Laboratory · / })).toHaveLength(50)

    fireEvent.click(pageButton(lab.pager, 'Next page'))
    expect(await within(lab.pager).findByText('Page 2')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', { cursor: 'lab-page-2', fresh: false })
    const list = screen.getByRole('list', { name: 'Orders from this consultation' })
    expect(within(list).getAllByRole('link', { name: /^Laboratory · / }).map(link => link.textContent))
      .toEqual(['Laboratory · Test 51', 'Laboratory · Test 52'])
    // The prescriptions stay on their own first page.
    expect(within(rx.pager).getByText('Page 1')).toBeTruthy()
    expect(within(list).getAllByRole('link', { name: /^Pharmacy · / })).toHaveLength(50)
    expect(pageButton(lab.pager, 'Next page').disabled).toBe(true)

    fireEvent.click(pageButton(lab.pager, 'Previous page'))
    expect(await within(lab.pager).findByText('Page 1')).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', { cursor: undefined, fresh: false })
    expect(screen.getByRole('link', { name: 'Laboratory · Test 1' })).toBeTruthy()
  })

  it('item 6: starts a list again from the newest, with today’s notice, when EHR no longer accepts its cursor', async () => {
    // EHR refuses the second page's cursor (400 INVALID_CURSOR): the list is read again from the newest, afresh.
    pagedLists({ prescriptions: { first: RX_PAGES.first }, 'lab-requests': { first: { items: [labRequest()], nextCursor: null } } })
    open(ENCOUNTER_ID)
    const { group, pager } = await pagerOf('Pharmacy')
    fireEvent.click(pageButton(pager, 'Next page'))
    const notice = await within(group).findByRole('status')
    expect(notice.textContent).toBe('This list changed since it was opened, so it shows the newest entries again.')
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: 'rx-page-2', fresh: false })
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true })
    const shown = within(screen.getByRole('group', { name: 'Pharmacy' })).getByRole('navigation', { name: 'Record pages' })
    expect(within(shown).getByText('Page 1')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pharmacy · Test medicine 1' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('item 6: says a page that could not be loaded beside its pager, in today’s words, and keeps the page shown', async () => {
    pagedLists({ prescriptions: RX_PAGES, 'lab-requests': { first: { items: [labRequest()], nextCursor: null } } })
    open(ENCOUNTER_ID)
    const { group, pager } = await pagerOf('Pharmacy')
    api.records.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(pageButton(pager, 'Next page'))
    expect((await within(group).findByRole('alert')).textContent).toBe('The page could not be loaded. EHR is unavailable.')
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pharmacy · Test medicine 1' })).toBeTruthy()
    // The next move clears the notice and reads the page.
    fireEvent.click(pageButton(pager, 'Next page'))
    expect(await within(pager).findByText('Page 2')).toBeTruthy()
    expect(within(group).queryByRole('alert')).toBeNull()
  })

  it('item 6: shows no pager while each list fits on one page', async () => {
    open(ENCOUNTER_ID)
    await screen.findByRole('list', { name: 'Orders from this consultation' })
    expect(screen.queryByRole('navigation', { name: 'Record pages' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Pharmacy' })).toBeNull()
  })

  it('item 6: opens a prescription past the first 50 from its page, found by the order page’s own search across pages', async () => {
    pagedLists({ prescriptions: RX_PAGES, 'lab-requests': { first: { items: [labRequest()], nextCursor: null } } })
    open(ENCOUNTER_ID)
    const { pager } = await pagerOf('Pharmacy')
    fireEvent.click(pageButton(pager, 'Next page'))
    const link = await screen.findByRole('link', { name: 'Pharmacy · Test medicine 52' })
    expect(link.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/b1000000-0000-4000-8000-000000000052`)
    api.records.mockClear()
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'Test medicine 52' })).toBeTruthy()
    expect(api.records).toHaveBeenNthCalledWith(1, FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')
    expect(api.records).toHaveBeenNthCalledWith(2, FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: 'rx-page-2', fresh: false })
  })
})

describe('New pharmacy (prescription)', () => {
  async function form() {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByRole('heading', { level: 1, name: 'New prescription' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Save prescription' })
  }

  it('saves today’s draft after the patient is confirmed and the access re-check, then opens the saved order', async () => {
    const save = await form()
    // The patient is the banner; the consultation carries in.
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(new RegExp(PATIENT_HID))).toBeTruthy()
    expect(screen.getByText('For consultation e0000000')).toBeTruthy()
    expect(screen.getByText('This saves a draft. The pharmacy accepts and dispenses it as a next step.')).toBeTruthy()
    change('Medicine', ' Amoxicillin ')
    change('Dose', '500')
    change('Unit', 'mg')
    change('Route', 'oral')
    change('How often', 'Twice daily')
    change('Instructions', 'After meals')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', {
      medicationDisplay: 'Amoxicillin', doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily', instructions: 'After meals', status: 'draft',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
  })

  it('sends nothing when the patient is not confirmed (Cancel), and keeps what was typed', async () => {
    const save = await form()
    fill()
    fireEvent.click(save)
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the patient' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm the patient' })).toBeNull())
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(api.createRecord).not.toHaveBeenCalled()
    expect(field('Medicine').value).toBe('Amoxicillin')
    // Asked again, it saves.
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
  })

  it('keeps today’s limits and checks: required fields, and a dose with its unit picked from the list', async () => {
    const save = await form()
    expect(field('Medicine').maxLength).toBe(500)
    expect(field('Route').maxLength).toBe(100)
    expect(field('How often').maxLength).toBe(240)
    expect(field('Instructions').maxLength).toBe(4000)
    expect(field('Dose').maxLength).toBe(12)
    expect(field('Dose').inputMode).toBe('decimal')
    // The unit is a pick-list ("Other…" opens a field for one not listed).
    expect(field('Unit').tagName).toBe('SELECT')
    expect(options('Unit')).toEqual(['Select…', 'mg', 'g', 'mcg', 'mL', 'units', 'tablet(s)', 'capsule(s)', 'drop(s)', 'puff(s)', 'Other…'])
    expect(screen.queryByLabelText(labelled('Other unit'))).toBeNull()
    fireEvent.click(save)
    // Medicine, dose, unit, how often and instructions are required.
    expect(screen.getAllByText('Complete this field.')).toHaveLength(5)
    expect(document.activeElement).toBe(field('Medicine'))
    change('Medicine', 'Amoxicillin')
    change('How often', 'Twice daily')
    change('Instructions', 'After meals')
    change('Dose', '500')
    // Enter in a field submits the form: a dose without its unit is refused at the unit.
    fireEvent.submit(field('How often').closest('form')!)
    expect(await screen.findByText('Enter the dose and pick its unit.')).toBeTruthy()
    expect(field('Unit').getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('Complete this field.')).toBeNull()
    // A dose is a number with at most four decimal places.
    change('Unit', 'mg')
    change('Dose', '0.00001')
    fireEvent.submit(field('How often').closest('form')!)
    expect(await screen.findByText('Enter the dose as a number, like 0.5 or 250 (up to 4 decimal places).')).toBeTruthy()
    expect(field('Dose').getAttribute('aria-invalid')).toBe('true')
    // "Other…" asks for the unit, up to today's 80 characters.
    change('Unit', 'other')
    expect(field('Other unit').maxLength).toBe(80)
    expect(field('Other unit').required).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  function fill() {
    change('Medicine', 'Amoxicillin')
    change('Dose', '500')
    change('Unit', 'mg')
    change('How often', 'Twice daily')
    change('Instructions', 'After meals')
  }

  it('marks the fields the EHR refused, and says each refusal', async () => {
    const save = await form()
    fill()
    api.createRecord.mockRejectedValue(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'medicationDisplay', messages: ['medicationDisplay must be shorter than or equal to 500 characters'] }],
    }))
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('One or more request fields are invalid. Medication display must be shorter than or equal to 500 characters.')
    expect(field('Medicine').getAttribute('aria-invalid')).toBe('true')
  })

  it('says a permission refusal, and an unanswered save sent again is the same create', async () => {
    const save = await form()
    fill()
    api.createRecord.mockRejectedValueOnce(new Error('Network error'))
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe('Network error')
    api.createRecord.mockRejectedValueOnce(new HidApiError(403, 'Your role may not write prescriptions.', { code: 'FORBIDDEN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save prescription' }))
    await confirmPatient(SAVE_RX(), 'Save prescription')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Your role may not write prescriptions.'))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('closes the patient when the re-check refuses, and shows that access ended', async () => {
    const save = await form()
    fill()
    api.lookupPatient.mockResolvedValue(deniedLookup)
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText('Open the patient again to keep working.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('offers no form under read-only access, with today’s sentence', async () => {
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save prescription' })).toBeNull()
  })

  it('refuses the page without the write permission', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.read']
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByRole('button', { name: 'Save prescription' })).toBeNull()
  })

  it('goes back to the encounter', async () => {
    await form()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const actions = await screen.findByRole('region', { name: 'Available actions' })
    expect(within(actions).getByRole('button', { name: 'New prescription' })).toBeTruthy()
  })
})

describe('New laboratory (lab request)', () => {
  async function form() {
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect(await screen.findByRole('heading', { level: 1, name: 'New lab request' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Save draft' })
  }

  function fill() {
    change('Code system', 'LOINC')
    change('Test code', '718-7')
    change('Test', 'Haemoglobin')
  }

  function handling() {
    return Array.from((field('What to do with it') as unknown as HTMLSelectElement).options).map(option => option.value)
  }

  it('saves a draft with today’s fields and limits', async () => {
    api.createRecord.mockResolvedValue(labRequest())
    const save = await form()
    expect(field('Code system').maxLength).toBe(255)
    expect(field('Test code').maxLength).toBe(100)
    expect(field('Test').maxLength).toBe(500)
    expect(field('Specimen type').maxLength).toBe(100)
    expect(field('Clinical information').maxLength).toBe(4000)
    expect(handling()).toEqual(['draft'])
    expect(screen.getByText('A draft is not sent to the Laboratory until it is activated. Only someone who may send requests to Lab can activate it or create an active request.')).toBeTruthy()
    fill()
    fireEvent.change(field('Priority'), { target: { value: 'urgent' } })
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', {
      testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin', priority: 'urgent', status: 'draft', specimenTypeCode: undefined, clinicalInformation: undefined,
    }, expect.any(String))
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
  })

  it('creates an active request that Lab accepts', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.createRecord.mockResolvedValue({ ...labRequest({ status: 'active' }), labHandoff: { state: 'accepted' } })
    await form()
    expect(handling()).toEqual(['draft', 'active'])
    expect(screen.getByText('If the laboratory doesn’t accept it, the request is still saved. Check the orders list before sending it again.')).toBeTruthy()
    fill()
    fireEvent.change(field('What to do with it'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
    expect(api.createRecord.mock.calls[0]![4]).toMatchObject({ status: 'active' })
  })

  it('says Lab refused a saved active request, without its id, on the saved request’s page', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active' })])
    api.createRecord.mockRejectedValue(new HidApiError(409, `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)`, { code: 'LAB_HANDOFF_REFUSED' }))
    await form()
    fill()
    fireEvent.change(field('What to do with it'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    const alert = await screen.findByText(/^Lab request saved and active in the EHR, but Lab refused it/)
    expect(alert.textContent).toBe('Lab request saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN), so the Laboratory does not have it. Do not create it again: once that is resolved, use Send to Lab on the request.')
    expect(alert.textContent).not.toContain(LAB)
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', { cursor: undefined, fresh: true })
  })

  it('says an active create may have been saved when the answer is unclear, and sends the same create again', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.createRecord.mockRejectedValue(new HidApiError(503, 'Lab is unavailable'))
    await form()
    fill()
    fireEvent.change(field('What to do with it'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect((await screen.findByRole('alert')).textContent).toBe('Lab is unavailable. The lab request may have been saved and active even so: check the list before creating it again.')
    fireEvent.click(screen.getByRole('button', { name: 'Send lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('creates and sends a request to another laboratory, after the patient’s agreement is ticked', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest()], { crossFacilityOrders: true })
    api.createRecord.mockResolvedValue(labRequest())
    routes.send.mockResolvedValue({})
    const save = await form()
    await waitFor(() => expect(handling()).toEqual(['draft', 'route']))
    fill()
    fireEvent.change(field('Priority'), { target: { value: 'stat' } })
    fireEvent.change(field('What to do with it'), { target: { value: 'route' } })
    expect(screen.getByText('The request is saved as a draft, then sent to the laboratory you choose: sending it activates it. If it can’t be sent, it stays a draft.')).toBeTruthy()
    fireEvent.click(save)
    // With no laboratory chosen nothing is asked or sent: the missing choice is said.
    expect(await screen.findByText('Choose the laboratory the patient will use.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Confirm the patient' })).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    change('Search for the laboratory', 'Demo  Laboratory ')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Laboratory · Registered office not on record/ }))
    expect(routes.destinations).toHaveBeenCalledWith(FACILITY_ID, 'laboratory', 'Demo Laboratory')
    expect(screen.getByText('Demo Laboratory is not alerted when it arrives: phone them.')).toBeTruthy()
    const send = screen.getByRole('button', { name: 'Send to Demo Laboratory' })
    fireEvent.click(send)
    expect(await screen.findByText('Tick the box to confirm that the patient agreed.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Confirm the patient' })).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: `I confirm that Patient One agreed that ${FACILITY_NAME} sends this test request to Demo Laboratory.` }))
    fireEvent.click(send)
    await confirmPatient(`Send this lab request (Haemoglobin) for ${PATIENT_NAME} to Demo Laboratory?`, 'Send lab request')
    expect(await screen.findByText('Lab request created and sent to Demo Laboratory. It waits there until Demo Laboratory accepts it, and Patient One is told in the Health ID app.')).toBeTruthy()
    expect(api.createRecord.mock.calls[0]![4]).toMatchObject({ status: 'draft', priority: 'stat' })
    expect(routes.send).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab_request', LAB,
      { expectedRowVersion: 1, receivingFacilityId: LABORATORY_ID, attestationTextVersion: 'order-route-lab-attestation-v1' }, expect.any(String))
    expect(routes.send.mock.calls[0]![6]).not.toBe(api.createRecord.mock.calls[0]![5])
  })

  it('says a refused send leaves the saved draft', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest()], { crossFacilityOrders: true })
    api.createRecord.mockResolvedValue(labRequest())
    routes.send.mockRejectedValue(new HidApiError(409, 'Not eligible', { code: 'ORDER_ROUTE_DESTINATION_INELIGIBLE' }))
    await form()
    await waitFor(() => expect(handling()).toEqual(['draft', 'route']))
    fill()
    fireEvent.change(field('What to do with it'), { target: { value: 'route' } })
    change('Search for the laboratory', 'Demo')
    fireEvent.keyDown(field('Search for the laboratory'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Laboratory/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Laboratory' }))
    await confirmPatient(`Send this lab request (Haemoglobin) for ${PATIENT_NAME} to Demo Laboratory?`, 'Send lab request')
    expect(await screen.findByText('Saved as a draft. Not sent: Demo Laboratory can’t receive this order on Health ID at the moment. Choose another laboratory.')).toBeTruthy()
  })
})

describe('A prescription’s page', () => {
  it('shows the design’s record page: meta, saved record and today’s status changes', async () => {
    expect((await openOrder('pharmacy', RX)).textContent).toBe('Amoxicillin')
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to consultation' })).toBeTruthy()
    expect(screen.getByText('Twice daily')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Saved record' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Actions' })).toBeTruthy()
    for (const name of ['Activate', 'Cancel order', 'Mark entered in error']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')
  })

  it('shows the loading state, then a missing order', async () => {
    setLists([], [])
    open(orderPath(ENCOUNTER_ID, 'pharmacy', RX))
    expect(screen.getByText('Loading records…')).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
  })

  it('changes the status after the re-check, with a reason', async () => {
    await openOrder('pharmacy', RX)
    const activate = screen.getByRole('button', { name: 'Activate' })
    fireEvent.click(activate)
    expect(activate.getAttribute('aria-expanded')).toBe('true')
    const submit = screen.getAllByRole('button', { name: 'Activate' })[1]!
    change('Reason for change', 'ok')
    fireEvent.click(submit)
    expect(await screen.findByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.updateRecord).not.toHaveBeenCalled()
    change('Reason for change', 'Treatment starts today')
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', RX,
      { expectedRowVersion: 1, changeReason: 'Treatment starts today', status: 'active' })
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.updateRecord.mock.invocationCallOrder[0]!)
    expect(await screen.findByRole('button', { name: 'Put on hold' })).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true })
  })

  it('asks a plain confirmation before cancelling; Escape keeps the order', async () => {
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    change('Reason for change', 'Prescribed in error')
    fireEvent.submit(field('Reason for change').closest('form')!)
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel order?' })
    expect(within(dialog).queryByRole('textbox')).toBeNull()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
    fireEvent.submit(field('Reason for change').closest('form')!)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel order' }))
    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', RX,
      { expectedRowVersion: 1, changeReason: 'Prescribed in error', status: 'cancelled' }))
  })

  it('keeps a conflict in the form', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.updateRecord.mockRejectedValue(new HidApiError(412, 'Prescription changed since it was loaded'))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    expect(screen.getByText(/^Pharmacy is not told of this change/)).toBeTruthy()
    change('Reason for change', 'Waiting for results')
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Prescription changed since it was loaded')
  })

  it('sends an active prescription to Pharmacy, the same send again after no answer', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    expect(screen.getByText('Send active prescription to Pharmacy')).toBeTruthy()
    change('Reason', 'Collect')
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText('Give a reason of at least 8 characters.')).toBeTruthy()
    change('Reason', 'Patient collecting today')
    api.acceptPrescription.mockRejectedValueOnce(new Error('Network error'))
    fireEvent.submit(field('Reason').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Network error')
    api.acceptPrescription.mockResolvedValueOnce({})
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText('Pharmacy accepted this exact prescription version.')).toBeTruthy()
    expect(api.acceptPrescription).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 3, 'Patient collecting today', expect.any(String))
    expect(api.acceptPrescription.mock.calls[1]![6]).toBe(api.acceptPrescription.mock.calls[0]![6])
  })

  it('says why Pharmacy did not take it, reading the order again', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.acceptPrescription.mockRejectedValue(new HidApiError(409, 'Not eligible', { code: 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE' }))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText('This prescription no longer matches what was sent (it was changed, put on hold or cancelled meanwhile), so Pharmacy did not accept it. The list was reloaded.')).toBeTruthy()
  })

  it('says Pharmacy already holds work for it', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.acceptPrescription.mockRejectedValue(new HidApiError(409, 'Conflict', { code: 'IDEMPOTENCY_CONFLICT' }))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Pharmacy already holds work for this prescription/)
  })

  it('offers no change under read-only access', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    await openOrder('pharmacy', RX)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.getByText('Nothing more to do here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
  })

  it('shows today’s message when the order cannot be read', async () => {
    api.records.mockRejectedValue(new HidApiError(503, 'Identity is unavailable'))
    open(orderPath(ENCOUNTER_ID, 'pharmacy', RX))
    expect((await screen.findByRole('alert')).textContent).toBe('Identity is unavailable')
  })
})

describe('A lab request’s page', () => {
  it('offers today’s draft changes to a role that can’t send to Lab, and says who can', async () => {
    expect((await openOrder('laboratory', LAB)).textContent).toBe('Haemoglobin')
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark entered in error' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Activate and send to Lab' })).toBeNull()
    expect(screen.getByText('Only someone who may send requests to Lab can activate this draft.')).toBeTruthy()
    expect(screen.getByText('Routine')).toBeTruthy()
  })

  it('activates a draft and says what Lab answered', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.updateRecord.mockResolvedValue({ ...labRequest({ status: 'active', rowVersion: 2 }), labHandoff: { state: 'already_accepted', code: 'LAB_ORDER_ALREADY_ACCEPTED' } })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Activate and send to Lab' }))
    change('Reason for change', 'Results needed today')
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText('Lab request activated in the EHR, but Lab holds an earlier version of it, so this change is not in Lab. Contact the laboratory.')).toBeTruthy()
  })

  it('sends an active request to Lab, the same send again after Lab did not confirm', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    await openOrder('laboratory', LAB)
    expect(screen.getByText(/^Lab may already be working on this request/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Lab' }))
    expect(screen.getByText(/^Sends this active request to Lab if Lab does not have it yet/)).toBeTruthy()
    api.sendLabRequestToLab.mockRejectedValueOnce(new HidApiError(502, 'Bad gateway', { code: 'LAB_HANDOFF_UNCONFIRMED' }))
    const send = screen.getAllByRole('button', { name: 'Send to Lab' })[1]!
    fireEvent.click(send)
    expect((await screen.findByRole('alert')).textContent).toBe('Lab did not confirm that it accepted this request, so the Laboratory may not have it: send again.')
    api.sendLabRequestToLab.mockResolvedValueOnce({})
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to Lab' })[1]!)
    expect(await screen.findByText('Lab accepted this lab request at its current version.')).toBeTruthy()
    expect(api.sendLabRequestToLab).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, LAB, 3, expect.any(String))
    expect(api.sendLabRequestToLab.mock.calls[1]![5]).toBe(api.sendLabRequestToLab.mock.calls[0]![5])
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
  })

  it('reads the request again when Lab says it is no longer active', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    api.sendLabRequestToLab.mockRejectedValue(new HidApiError(409, 'Not eligible', { code: 'LAB_REQUEST_NOT_ELIGIBLE' }))
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Lab' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Send to Lab' })[1]!)
    expect(await screen.findByText('This lab request is no longer active, so it was not sent to Lab. The list was reloaded.')).toBeTruthy()
  })

  it('reads released results only when asked, with today’s words', async () => {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    api.labReleasedResultsForOrder.mockResolvedValue({
      workItemId: 'w1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, patientId: PATIENT_ID, acceptedAt: '2026-10-30T10:00:00.000Z',
      test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' },
      results: [{ id: 'r1', executionId: 'x1', status: 'released', verificationStatus: 'verified', currentVersion: 2, currentReleasedVersion: 2, revisions: [
        { version: 2, resultType: 'numeric', numericValue: 9.8, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low', entrySource: 'manual',
          verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-10-30T11:00:00.000Z', releasedAt: '2026-10-30T11:30:00.000Z', correctionReason: null },
      ] }],
    })
    await openOrder('laboratory', LAB)
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
    const view = screen.getByRole('button', { name: 'View released results' })
    fireEvent.click(view)
    expect(view.getAttribute('aria-expanded')).toBe('true')
    expect(await screen.findByText('9.8 g/dL · low')).toBeTruthy()
    expect(screen.getByText('Reference range: 12.0-15.5')).toBeTruthy()
    expect(screen.getByText('Result 1')).toBeTruthy()
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith(FACILITY_ID, LAB, 'direct-care')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh released results' }))
    await waitFor(() => expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2))
  })

  it('says when no result is released, and today’s refusals', async () => {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    api.labReleasedResultsForOrder.mockResolvedValueOnce({ workItemId: 'w1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, patientId: PATIENT_ID,
      acceptedAt: '2026-10-30T10:00:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results: [] })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    expect(await screen.findByText('No result released yet.')).toBeTruthy()
    api.labReleasedResultsForOrder.mockRejectedValueOnce(new HidApiError(404, 'Not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh released results' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Lab has no work item for this request that you can see: Lab has not accepted it, accepted it at another facility, or your access to this patient does not cover it.')
    api.labReleasedResultsForOrder.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'LAB_ACCESS_DENIED' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh released results' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Access denied: you may not read this request\'s Lab results here (LAB_ACCESS_DENIED).'))
  })

  it('offers no released results for a draft', async () => {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    await openOrder('laboratory', LAB)
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
  })
})

describe('Sending to another facility, and what it reported', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
  })

  it('finds Demo Pharmacy through today’s destination search and sends the prescription there', async () => {
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: true })
    routes.send.mockResolvedValue({})
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    expect(routes.attestation).toHaveBeenCalledWith(FACILITY_ID, 'prescription')
    change('Search for the pharmacy', 'De')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText('Type 3 to 80 letters of the facility’s name.')).toBeTruthy()
    expect(routes.destinations).not.toHaveBeenCalled()
    change('Search for the pharmacy', 'Demo Pharmacy')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('1 pharmacy found.')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Demo Pharmacy · Demo Health Ltd · Registered office: 1 Example Street, Lagos' }))
    expect(screen.getByText('If this is a controlled medicine, Demo Pharmacy may ask the patient for a paper prescription.')).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: `I confirm that Patient One agreed that ${FACILITY_NAME} sends this prescription to Demo Pharmacy.` }))
    setLists([prescription({ status: 'active', rowVersion: 2, orderRoute: route({ kind: 'prescription', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true } }) })], [], { crossFacilityOrders: true })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect(await screen.findByText('Prescription sent to Demo Pharmacy. It waits there until Demo Pharmacy accepts it, and Patient One is told in the Health ID app.')).toBeTruthy()
    expect(routes.send).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescription', RX,
      { expectedRowVersion: 1, receivingFacilityId: PHARMACY_ID, attestationTextVersion: 'order-route-prescription-attestation-v1' }, expect.any(String))
    expect(await screen.findByRole('heading', { level: 2, name: 'Sent to a pharmacy' })).toBeTruthy()
    expect(screen.getByText(/^Sent to Demo Pharmacy: waiting for it to accept, until/)).toBeTruthy()
  })

  it('keeps a refused send in its form, in today’s words', async () => {
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: true })
    routes.send.mockRejectedValue(new HidApiError(409, 'No app', { code: 'ORDER_ROUTE_PATIENT_APP_REQUIRED' }))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    change('Search for the pharmacy', 'Demo Pharmacy')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Pharmacy/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Patient One has no active Health ID account, so Health ID can’t tell them where the order went. Give them a paper prescription instead.')
  })

  it('offers no send without the send permission', async () => {
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: true })
    staff.permissions = [...READ_WRITE]
    await openOrder('pharmacy', RX)
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
  })

  it('offers no send while Health ID has orders between facilities off', async () => {
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: false })
    await openOrder('pharmacy', RX)
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
  })

  it('offers no send for an order whose routes the EHR did not send', async () => {
    setLists([prescription()], [], { crossFacilityOrders: true })
    await openOrder('pharmacy', RX)
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
  })

  it('offers no send on today’s main backend', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: true })
    await openOrder('pharmacy', RX)
    expect(screen.queryByRole('button', { name: 'Send to a pharmacy' })).toBeNull()
    expect(routes.attestation).not.toHaveBeenCalled()
  })

  it('withdraws a request still waiting, with a reason, and says the patient is told', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    routes.withdraw.mockResolvedValue({ route: route({ effectiveState: 'withdrawn' }) })
    await openOrder('laboratory', LAB)
    expect(screen.getByRole('heading', { level: 2, name: 'Sent to another laboratory' })).toBeTruthy()
    expect(screen.getByText('Ref 9C1B2D3E')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Lab' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Choose why it is being withdrawn.')).toBeTruthy()
    fireEvent.change(field('Withdraw it from Demo Laboratory'), { target: { value: 'patient_request' } })
    setLists([], [labRequest({ status: 'active', rowVersion: 3, orderRoute: route({ effectiveState: 'withdrawn', endedKind: null, resendAllowed: true }) })], { crossFacilityOrders: true })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Withdrawn from Demo Laboratory. Patient One is told in the Health ID app.')).toBeTruthy()
    expect(routes.withdraw).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab_request', LAB, expect.objectContaining({ id: ROUTE, version: 1 }), 'patient_request')
    expect(await screen.findByText('Withdrawn.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('withdraws under read-only access too, as today', async () => {
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Put on hold' })).toBeNull()
  })

  it('shows the wrong-patient report under the order, in today’s words', async () => {
    setLists([], [labRequest({ status: 'completed', rowVersion: 4, orderRoute: route({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'wrong_patient' }) })], { crossFacilityOrders: true, wrongPatientReports: true })
    await openOrder('laboratory', LAB)
    expect(screen.getByText('Demo Laboratory reports that the results it released belong to someone else, and has ended it. Do not use them.')).toBeTruthy()
    expect(screen.getByText('This order can’t be sent again. Write a new lab request if Patient One still needs it.')).toBeTruthy()
    expect(screen.getByText(/^Do not use any result from Demo Laboratory on this order/)).toBeTruthy()
  })

  it('shows a late report after the order came back', async () => {
    setLists([prescription({ status: 'active', rowVersion: 4, orderRoute: route({ kind: 'prescription', effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.000Z', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true },
      wrongPatient: { reportedAt: '2026-10-25T10:00:00.000Z', late: true }, correctableUntil: null }) })], [], { crossFacilityOrders: true, lateCorrection: true })
    await openOrder('pharmacy', RX)
    expect(screen.getByText('Demo Pharmacy reports that it dispensed this to someone who was not Patient One, and has reversed it.')).toBeTruthy()
    expect(screen.getByText(/^This was reported 3 days after it came back\. Anything you recorded from it/)).toBeTruthy()
    expect(screen.getByText(/^Demo Pharmacy reports that Patient One did not receive this medicine from it/)).toBeTruthy()
  })

  it('says what to do about a dispensing that was not the patient’s, until the late correction’s date', async () => {
    setLists([prescription({ status: 'active', rowVersion: 4, orderRoute: route({ kind: 'prescription', effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z',
      completedAt: '2026-10-22T10:00:00.000Z', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true },
      correctableUntil: '2027-04-19T10:00:00.000Z' }) })], [], { crossFacilityOrders: true, lateCorrection: true })
    await openOrder('pharmacy', RX)
    expect(screen.getByText(/^If Patient One did not receive this medicine from Demo Pharmacy, and no one collected it for them, phone Demo Pharmacy and give it the reference 9C1B2D3E: it can reverse the dispensing until 19 Apr 2027, 11:00\.$/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    expect(screen.getByText(/^Changing it withdraws it from Demo Pharmacy, or cancels it there if Demo Pharmacy has accepted it/)).toBeTruthy()
  })

  it('says why the receiving facility couldn’t complete it', async () => {
    setLists([prescription({ status: 'active', rowVersion: 4, orderRoute: route({ kind: 'prescription', effectiveState: 'cancelled', acceptedAt: '2026-10-21T10:00:00.000Z',
      endedAt: '2026-10-22T10:00:00.000Z', endedKind: 'receiving_unable', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true },
      notCompleted: { reason: 'controlled_requirements', sampleTaken: null, resultRecorded: null } }) })], [], { crossFacilityOrders: true })
    await openOrder('pharmacy', RX)
    expect(screen.getByText('Demo Pharmacy says it needs a signed or paper prescription for this controlled medicine. Give Patient One a signed paper prescription, or write a new prescription and send it to another pharmacy.')).toBeTruthy()
    expect(screen.getByText(/^Accepted by Demo Pharmacy on .*; ended on .*: Demo Pharmacy couldn’t complete it\.$/)).toBeTruthy()
  })

  it('reads what came back only when asked', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-22T10:00:00.000Z' }) })], { crossFacilityOrders: true })
    routes.routes.mockResolvedValue({ items: [{ ...route({ effectiveState: 'completed', acceptedAt: '2026-10-21T10:00:00.000Z' }),
      attestation: { textVersion: 'v1', attestedByName: 'Demo Clinician', attestedAt: '2026-10-20T10:00:00.000Z', receivingFacilityName: 'Demo Laboratory' }, events: [],
      results: [{ resultId: 'res-1', resultVersion: 1, kind: 'released', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, resultType: 'numeric',
        numericValue: 9.8, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low', revisionKind: 'original', correctionReason: null, occurredAt: '2026-10-22T10:00:00.000Z' }] }] })
    await openOrder('laboratory', LAB)
    expect(routes.routes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show details and results' }))
    expect(await screen.findByText(/^Haemoglobin: Released by Demo Laboratory on .*: 9\.8 g\/dL, flagged low, reference 12\.0-15\.5$/)).toBeTruthy()
    expect(routes.routes).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab_request', LAB)
    expect(screen.getByRole('button', { name: 'Hide details' }).getAttribute('aria-expanded')).toBe('true')
  })
})

/** A select's options, as their visible text. */
function options(label: string) {
  return Array.from((field(label) as unknown as HTMLSelectElement).options).map(option => option.textContent)
}

const ALLERGIES = 'Recorded allergies: Penicillin (patient-reported: entered by the patient in their Health ID portal, not clinically verified).'
const NONE_RECORDED = 'Recorded allergies: None recorded. Confirm with the patient.'
const NOT_LOADED = 'Recorded allergies: what the patient entered about their health could not be loaded. Confirm with the patient.'

/**
 * Hand-off 06, as the redesign settled it: the one-option "Patient *" and "Encounter *" selects are gone. The patient is
 * the banner (and is confirmed before saving), the consultation is the one in the address ("For consultation …"), and
 * neither is a field that could be blanked or sent.
 */
describe('Hand-off 06: the open patient and this consultation carry in on New lab request and New prescription', () => {
  it.each([
    ['laboratory', 'New lab request', 'Test'],
    ['pharmacy', 'New prescription', 'Medicine'],
  ] as const)('06: New %s names the open patient in the banner and this consultation, with no Patient or Encounter field', async (kind, title, first) => {
    open(`${ENCOUNTER_ID}/orders/new/${kind}`)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(new RegExp(PATIENT_HID))).toBeTruthy()
    expect(screen.getByText('For consultation e0000000')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Patient'))).toBeNull()
    expect(screen.queryByLabelText(labelled('Encounter'))).toBeNull()
    // The form starts with today's first field; the address names record ids only.
    const form = field(first).closest('form')!
    expect(form.querySelector('input, select, textarea')).toBe(field(first))
    expect(document.title).not.toContain('Patient One')
  })

  it('06: New lab request shows no allergies and reads none (only a new prescription and consultation do)', async () => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    await screen.findByRole('button', { name: 'Save draft' })
    await act(async () => {})
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('06: the lab request is raised on the encounter in the address, and no patient or encounter field is sent', async () => {
    api.createRecord.mockResolvedValue(labRequest())
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    change('Code system', 'LOINC')
    change('Test code', '718-7')
    change('Test', 'Haemoglobin')
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledTimes(1)
    const [facilityId, patientId, encounterId, kind, body] = api.createRecord.mock.calls[0]!
    expect([facilityId, patientId, encounterId, kind]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests'])
    expect(Object.keys(body as object)).not.toContain('encounter')
    expect(Object.keys(body as object)).not.toContain('patient')
  })

  it('06: a prescription is raised on the encounter in the address (keyboard: Enter submits)', async () => {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save prescription' })
    change('Medicine', 'Amoxicillin')
    change('Dose', '500')
    change('Unit', 'mg')
    change('How often', 'Twice daily')
    change('Instructions', 'After meals')
    field('Instructions').focus()
    await act(async () => { fireEvent.submit(field('Instructions').closest('form')!) })
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', expect.not.objectContaining({ encounter: expect.anything() }), expect.any(String))
  })

  it('06: the same values sent again after no answer are the same create (one Idempotency-Key)', async () => {
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    change('Code system', 'LOINC')
    change('Test code', '718-7')
    change('Test', 'Haemoglobin')
    api.createRecord.mockRejectedValueOnce(new Error('Network error'))
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect((await screen.findByRole('alert')).textContent).toBe('Network error')
    expect(screen.getByText('For consultation e0000000')).toBeTruthy()
    api.createRecord.mockResolvedValueOnce(labRequest())
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('06: after a save the page cannot name, the form starts again for this consultation', async () => {
    api.createRecord.mockResolvedValue({})
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    change('Code system', 'LOINC')
    change('Test code', '718-7')
    change('Test', 'Haemoglobin')
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(screen.getByText('For consultation e0000000')).toBeTruthy()
    expect(field('Test code').value).toBe('')
  })

  it('06: New prescription says the recorded allergies above the form, and nothing while their read runs', async () => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    let answer: (value: unknown) => void = () => {}
    api.reportedHealthProfile.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save prescription' })
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
    // The read starts in an effect after the form is drawn: wait for it to be asked for before answering it.
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal)))
    await act(async () => { answer({ allergies: 'Penicillin', bloodGroup: null, genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null }) })
    const allergies = screen.getByText(ALLERGIES)
    // Between the patient banner and the form.
    expect(patientBanner().compareDocumentPosition(allergies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(allergies.compareDocumentPosition(field('Medicine')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['an answer with no allergies', () => api.reportedHealthProfile.mockResolvedValue({ allergies: null }), NONE_RECORDED],
    ['no profile', () => api.reportedHealthProfile.mockResolvedValue(null), NONE_RECORDED],
    ['an outage (503)', () => api.reportedHealthProfile.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })), NOT_LOADED],
  ])('06: New prescription’s allergies after %s say today’s sentence', async (_label, arrange, sentence) => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    arrange()
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText(sentence)).toBeTruthy()
  })

  it.each([
    ['a refusal (403)', new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' })],
    ['a route EHR does not serve (404)', new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })],
  ])('06: New prescription says nothing of allergies after %s', async (_label, refusal) => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.reportedHealthProfile.mockRejectedValue(refusal)
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save prescription' })
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
  })

  it('06: New prescription reads no allergies without ehr.note.read, as today’s chart', async () => {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save prescription' })
    await act(async () => {})
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
  })

  it('06: no form or allergies show without the write permission, under read-only access or for an emergency patient', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.lab-request.read']
    const refused = open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByLabelText(labelled('Test'))).toBeNull()
    refused.unmount()
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    const readOnly = open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Medicine'))).toBeNull()
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
    readOnly.unmount()
    api.reportedHealthProfile.mockClear()
    staff.activePatient = activePatient('emergency')
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Medicine'))).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('06: says it is checking access while the grant is asked about, with no form yet', async () => {
    api.consentStatus.mockReturnValue(new Promise(() => {}))
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect(await screen.findByText('Checking your access…')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Test'))).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  })
})

describe('Keyboard and roles', () => {
  it('uses real buttons and links, and moves focus to the first problem', async () => {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    const save = await screen.findByRole('button', { name: 'Save prescription' })
    expect(save.getAttribute('type')).toBe('submit')
    expect(screen.getByRole('button', { name: 'Back to list' }).getAttribute('type')).toBe('button')
    await act(async () => { fireEvent.submit(save.closest('form')!) })
    expect(document.activeElement).toBe(field('Medicine'))
  })
})
