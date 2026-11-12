import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELOAD_FAILED } from '../../../ehr-blue/clinical/consult/encounters'
import { CONNECTED_ORDERS_NOTE, EncounterOrderPages, EncounterOrders, orderPath } from '../../../ehr-blue/clinical/consult/orders'
import { OVERRIDES_NOT_SHOWN } from '../../../ehr-blue/clinical/consult/orders/AllergyOverrides'
import { learnFrom } from '../../../ehr-blue/clinical/consult/orders/orders'
import {
  ACK_REFUSED_ERROR, ALLERGY_CHANGED_ERROR, ALLERGY_TICK_AGAIN_ERROR, ALLERGY_TICK_AND_REASON_ERROR, MEDICINE_CHANGED_ERROR,
} from '../../../ehr-blue/clinical/consult/orders/prescribingAllergies'
import { PHARMACY_NOT_TOLD } from '../../../ehr-blue/clinical/consult/orders/words'
import { ALLERGIES_NOT_SHOWN, ALLERGIES_UNREAD, NOTHING_REPORTED } from '../../../ehr-blue/clinical/patients/AllergiesCard'
import { useRecordList } from '../../../ehr-blue/clinical/consult/records'
import {
  ACK_NOT_ACCEPTED, ACK_REASON_HINT, ACK_REASON_LONG, ACK_REASON_NO_WORD, ACK_REASON_SHORT, ALLERGY_GO_AHEAD_ERROR, ALLERGY_WARNING_CHANGED,
  ALLERGY_WARNING_UNREAD, NO_WARNING_NOT_SAFE, tickError, tickLabel,
} from '../../../ehr-blue/clinical/parts/allergyWarning'
import type { Chart } from '../../../ehr-blue/clinical/parts/chart'
import { ChartProvider, READ_ONLY, useChart } from '../../../ehr-blue/clinical/parts/chart'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { SAID_CHANGED, SAID_FIELDS_REFUSED, SAID_REFUSED, SAID_UNAVAILABLE } from '../../said'
import { COLLEAGUE, DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, FACILITY_NAME, PATIENT_HID, PATIENT_ID, PATIENT_NAME, SIGNED_IN, activePatient, allowedLookup, deniedLookup, labelled, patientBanner, renderPage, type SignedIn } from './harness'

/**
 * Orders raised from a consultation (prescriptions and lab requests): the design's "Connected orders", create and
 * record pages on today's API, with Send to Pharmacy, Send to Lab, sending to another facility (Demo Pharmacy, Demo
 * Laboratory) and what the receiving side reported. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(),
  acceptPrescription: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(), reportedHealthProfile: vi.fn(),
  allergies: vi.fn(), allergyCheck: vi.fn(),
}))
const routes = vi.hoisted(() => ({ destinations: vi.fn(), attestation: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, roles: undefined as string[] | undefined, signedIn: undefined as SignedIn | undefined }))

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
  staff.roles = undefined
  staff.signedIn = undefined
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
  // A backend before hid-system 0124 (allergies): both allergy routes answer 404.
  api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
  api.allergyCheck.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
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
  return <OrdersStub chart={chart} encounterId={recordId} />
}

/** The visit page's two order lists, read as it reads them (direct care only: emergency never reaches the visit page). */
function OrdersStub({ chart, encounterId }: { chart: Chart; encounterId: string }) {
  const direct = chart.purpose === 'direct-care'
  const pharmacy = useRecordList(chart, encounterId, 'prescriptions', direct && chart.can('ehr.prescription.read'), learnFrom)
  const laboratory = useRecordList(chart, encounterId, 'lab-requests', direct && chart.can('ehr.lab-request.read'), learnFrom)
  return (
    <section aria-label="Available actions">
      <EncounterOrders chart={chart} lists={{ pharmacy, laboratory }} encounter={{ id: encounterId, patientId: PATIENT_ID, facilityId: staff.facilityId ?? FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }} />
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

/** A saved record's value by its label, and the closed "More details" under it (owner decision 33.4), if any. */
function savedValue(label: string) {
  const value = screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement
  const details = value.querySelector('details')
  if (details) {
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toMatch(/^More details/)
  }
  return { lead: details ? value.querySelector(':scope > span > span')?.textContent : value.textContent, more: details?.querySelector(':scope > div')?.textContent }
}

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

  it('offers a demo facility\'s administrator no radiology or referral step: the design gives the role neither sample', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    staff.roles = ['org_admin']
    open(ENCOUNTER_ID)
    expect(await screen.findByRole('button', { name: 'New prescription' })).toBeTruthy()
    await screen.findByRole('list', { name: 'Orders from this consultation' })
    expect(screen.queryByRole('button', { name: 'New radiology request' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New referral' })).toBeNull()
  })

  it('opens the pharmacy and laboratory create pages', async () => {
    open(ENCOUNTER_ID)
    fireEvent.click(await screen.findByRole('button', { name: 'New prescription' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add prescriptions' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(await screen.findByRole('button', { name: 'New lab request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Add lab requests' })).toBeTruthy()
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
    expect(await screen.findByText('No prescriptions for this consultation.')).toBeTruthy()
    expect(screen.getByText('No lab requests for this consultation.')).toBeTruthy()
  })

  it('shows a refused read in the design’s error box', async () => {
    api.records.mockRejectedValue(new HidApiError(503, 'Records are unavailable'))
    open(ENCOUNTER_ID)
    expect((await screen.findAllByRole('alert'))[0]!.textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('Records are unavailable')
    // A read that failed is not still loading.
    expect(screen.queryByText('Loading records…')).toBeNull()
  })

  it('shows nothing of orders for an emergency patient, and the order pages show the read-only notice', async () => {
    staff.activePatient = activePatient('emergency')
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
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

/** A page button that cannot act is unavailable (aria-disabled) but stays focusable, as today's Pager. */
function unavailable(button: HTMLButtonElement) {
  return button.getAttribute('aria-disabled') === 'true' && !button.disabled
}

describe('Connected orders past 50 (review item 6: pagers past 50)', () => {
  it('item 6: pages more than 50 prescriptions with Next and Previous, sending today’s cursor', async () => {
    pagedLists({ prescriptions: RX_PAGES, 'lab-requests': { first: { items: [labRequest()], nextCursor: null } } })
    open(ENCOUNTER_ID)
    const { pager } = await pagerOf('Pharmacy')
    // The lab requests fit on one page: only the prescriptions are paged.
    expect(screen.getAllByRole('navigation', { name: 'Record pages' })).toHaveLength(1)
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    expect(unavailable(pageButton(pager, 'Previous page'))).toBe(true)
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
    expect(unavailable(pageButton(pager, 'Next page'))).toBe(true)
    expect(pageButton(pager, 'Previous page').getAttribute('aria-disabled')).toBeNull()

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
    expect(unavailable(pageButton(lab.pager, 'Next page'))).toBe(true)

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
    // Said in a status region of its own (the pager's page is one too).
    const notice = await within(group).findByText('This list changed since it was opened, so it shows the newest entries again.')
    expect(notice.getAttribute('role')).toBe('status')
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
    expect((await within(group).findByRole('alert')).textContent).toBe(`The page could not be loaded. ${SAID_UNAVAILABLE}`)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Add prescriptions' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Save draft' })
  }

  it('saves today’s draft after the patient is confirmed and the access re-check, then opens the saved order', async () => {
    const save = await form()
    // The patient is the banner; the consultation carries in.
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(new RegExp(PATIENT_HID))).toBeTruthy()
    expect(screen.getByText('For this consultation')).toBeTruthy()
    expect(screen.getByText('This saves a draft. The pharmacy accepts and dispenses it as a next step.')).toBeTruthy()
    change('Medication', ' Amoxicillin ')
    change('Dose quantity', '500')
    change('Dose unit', 'mg')
    change('Route code', 'oral')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', {
      medicationDisplay: 'Amoxicillin', doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily', instructions: 'After meals', status: 'draft',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
  })

  it('says to open the saved prescription to send it elsewhere, as Send to a pharmacy is on its own page (review)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [], { crossFacilityOrders: true })
    await form()
    expect(await screen.findByText('This saves a draft. To send it to a pharmacy elsewhere, open it and choose Send to a pharmacy.')).toBeTruthy()
    expect(screen.queryByText(/in the list/)).toBeNull()
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
    expect(field('Medication').value).toBe('Amoxicillin')
    // Asked again, it saves.
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
  })

  it('keeps today’s limits and checks: required fields, and a dose with its unit picked from the list', async () => {
    const save = await form()
    expect(field('Medication').maxLength).toBe(500)
    expect(field('Route code').maxLength).toBe(100)
    expect(field('Frequency').maxLength).toBe(240)
    expect(field('Instructions').maxLength).toBe(4000)
    expect(field('Dose quantity').maxLength).toBe(12)
    expect(field('Dose quantity').inputMode).toBe('decimal')
    // The unit is a pick-list ("Other…" opens a field for one not listed).
    expect(field('Dose unit').tagName).toBe('SELECT')
    expect(options('Dose unit')).toEqual(['Select…', 'mg', 'g', 'mcg', 'mL', 'units', 'tablet(s)', 'capsule(s)', 'drop(s)', 'puff(s)', 'Other…'])
    expect(screen.queryByLabelText(labelled('Other unit'))).toBeNull()
    fireEvent.click(save)
    // Medication, frequency and instructions are required, as in classic; the dose and its unit are optional, together.
    expect(screen.getAllByText('Complete this field.')).toHaveLength(3)
    expect(field('Dose quantity').getAttribute('aria-invalid')).toBeNull()
    expect(field('Dose unit').getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(field('Medication'))
    change('Medication', 'Amoxicillin')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
    change('Dose quantity', '500')
    // Enter in a field submits the form: a dose without its unit is refused at the unit.
    fireEvent.submit(field('Frequency').closest('form')!)
    expect(await screen.findByText('Enter both dose quantity and dose unit, or leave both blank.')).toBeTruthy()
    expect(field('Dose unit').getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText('Complete this field.')).toBeNull()
    // A dose is a number with at most four decimal places.
    change('Dose unit', 'mg')
    change('Dose quantity', '0.00001')
    fireEvent.submit(field('Frequency').closest('form')!)
    expect(await screen.findByText('Enter the dose as a number, like 0.5 or 250 (up to 4 decimal places).')).toBeTruthy()
    expect(field('Dose quantity').getAttribute('aria-invalid')).toBe('true')
    // "Other…" asks for the unit, up to today's 80 characters (needed only with a dose).
    change('Dose unit', 'other')
    expect(field('Other unit').maxLength).toBe(80)
    expect(field('Other unit').required).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  function fill() {
    change('Medication', 'Amoxicillin')
    change('Dose quantity', '500')
    change('Dose unit', 'mg')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
  }

  it('gap: saves a prescription with no dose, the dose and its unit both left blank, as today (Clinical.tsx:505-512, :567)', async () => {
    const save = await form()
    change('Medication', 'Hydrocortisone 1% cream')
    change('Frequency', 'Twice daily')
    change('Instructions', 'Apply thinly to the rash')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX('Hydrocortisone 1% cream'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    const body = api.createRecord.mock.calls[0]![4] as Record<string, unknown>
    expect(body).toEqual({ medicationDisplay: 'Hydrocortisone 1% cream', doseQuantity: undefined, doseUnit: undefined, routeCode: undefined,
      frequency: 'Twice daily', instructions: 'Apply thinly to the rash', status: 'draft' })
    expect(screen.queryByText('Complete this field.')).toBeNull()
  })

  it('marks the fields the EHR refused, and says each refusal', async () => {
    const save = await form()
    fill()
    api.createRecord.mockRejectedValue(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'medicationDisplay', messages: ['medicationDisplay must be shorter than or equal to 500 characters'] }],
    }))
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(document.body.textContent).not.toContain('shorter than or equal to 500 characters')
    expect(field('Medication').getAttribute('aria-invalid')).toBe('true')
  })

  it('says a permission refusal, and an unanswered save sent again is the same create', async () => {
    const save = await form()
    fill()
    api.createRecord.mockRejectedValueOnce(new Error('Network error'))
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe('Record could not be saved.')
    expect(document.body.textContent).not.toContain('Network error')
    api.createRecord.mockRejectedValueOnce(new HidApiError(403, 'Your role may not write prescriptions.', { code: 'FORBIDDEN' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_RX(), 'Save prescription')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(SAID_REFUSED))
    expect(document.body.textContent).not.toContain('Your role may not write prescriptions.')
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
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  })

  it('refuses the page without the write permission', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.read']
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  })

  it('goes back to the encounter', async () => {
    await form()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    const actions = await screen.findByRole('region', { name: 'Available actions' })
    expect(within(actions).getByRole('button', { name: 'New prescription' })).toBeTruthy()
  })
})

describe('A prescription with no dose (a cream, or "as directed"), as classic allowed', () => {
  const PAIR = 'Enter both dose quantity and dose unit, or leave both blank.'

  async function form() {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    return screen.findByRole('button', { name: 'Save draft' })
  }

  function fillWithoutDose(medicine = 'Hydrocortisone 1% cream') {
    change('Medication', medicine)
    change('Frequency', 'Twice daily')
    change('Instructions', 'Apply thinly to the rash')
  }

  it('saves with the dose and unit left blank, and sends no dose, as classic did', async () => {
    const save = await form()
    // Dose quantity and dose unit are optional (no asterisk); medication, frequency and instructions stay required, as in classic.
    expect(field('Dose quantity').required).toBe(false)
    expect(field('Dose unit').required).toBe(false)
    expect(field('Frequency').required).toBe(true)
    expect(field('Instructions').required).toBe(true)
    fillWithoutDose()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX('Hydrocortisone 1% cream'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    const [facility, patient, encounter, kind, body] = api.createRecord.mock.calls[0]!
    expect([facility, patient, encounter, kind]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions'])
    // What goes to Health ID: no dose and no unit at all (and no route), exactly as classic's blank dose.
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      medicationDisplay: 'Hydrocortisone 1% cream', frequency: 'Twice daily', instructions: 'Apply thinly to the rash', status: 'draft',
    })
  })

  it('refuses a dose without its unit, and a unit without a dose, with the paired sentence', async () => {
    const save = await form()
    fillWithoutDose()
    change('Dose quantity', '1')
    fireEvent.click(save)
    expect(await screen.findByText(PAIR)).toBeTruthy()
    expect(field('Dose unit').getAttribute('aria-invalid')).toBe('true')
    // At the missing half, with focus, as classic's FieldRefusal (Clinical.tsx:505-512).
    expect(document.activeElement).toBe(field('Dose unit'))
    expect(screen.queryByText('Complete this field.')).toBeNull()
    change('Dose quantity', '')
    change('Dose unit', 'g')
    fireEvent.click(save)
    expect(await screen.findByText(PAIR)).toBeTruthy()
    expect(field('Dose quantity').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Dose quantity'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('asks for the other unit only when a dose is given', async () => {
    const save = await form()
    fillWithoutDose()
    change('Dose unit', 'other')
    // "Other…" with no dose and no unit typed is still a prescription with no dose.
    expect(field('Other unit').required).toBe(false)
    fireEvent.click(save)
    await confirmPatient(SAVE_RX('Hydrocortisone 1% cream'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(JSON.parse(JSON.stringify(api.createRecord.mock.calls[0]![4]))).not.toHaveProperty('doseUnit')
  })

  it('refuses a dose with "Other…" picked and no unit typed, at the other unit', async () => {
    const save = await form()
    fillWithoutDose()
    change('Dose quantity', '2')
    change('Dose unit', 'other')
    fireEvent.click(save)
    expect(await screen.findByText(PAIR)).toBeTruthy()
    expect(field('Other unit').getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(field('Other unit'))
    expect(api.createRecord).not.toHaveBeenCalled()
    change('Other unit', 'sachet(s)')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX('Hydrocortisone 1% cream'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![4]).toMatchObject({ doseQuantity: 2, doseUnit: 'sachet(s)' })
  })

  it('offers New prescription only where the saved prescription can be read back, as classic did', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.write', 'ehr.lab-request.read', 'ehr.lab-request.write']
    open(ENCOUNTER_ID)
    await screen.findByRole('button', { name: 'New lab request' })
    expect(screen.queryByRole('button', { name: 'New prescription' })).toBeNull()
  })

  it('offers New lab request only where the saved request can be read back, as classic did', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.lab-request.write']
    open(ENCOUNTER_ID)
    await screen.findByRole('button', { name: 'New prescription' })
    expect(screen.queryByRole('button', { name: 'New lab request' })).toBeNull()
  })

  it('refuses the create page by its address without the read permission, so a real save never looks like a failure', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.write']
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull()
  })
})

describe('New laboratory (lab request)', () => {
  async function form() {
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Add lab requests' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Create lab request' })
  }

  function fill() {
    change('Test code system', 'LOINC')
    change('Test code', '718-7')
    change('Test display', 'Haemoglobin')
  }

  function handling() {
    return Array.from((field('Request handling') as unknown as HTMLSelectElement).options).map(option => option.value)
  }

  it('saves a draft with today’s fields and limits', async () => {
    api.createRecord.mockResolvedValue(labRequest())
    const save = await form()
    expect(field('Test code system').maxLength).toBe(255)
    expect(field('Test code').maxLength).toBe(100)
    expect(field('Test display').maxLength).toBe(500)
    expect(field('Specimen type code').maxLength).toBe(100)
    expect(field('Clinical information').maxLength).toBe(4000)
    expect(handling()).toEqual(['draft'])
    expect(screen.getByText('A draft is not sent to the Laboratory until it is activated. Only someone who may send requests to Lab can activate it or create an active request.')).toBeTruthy()
    fill()
    fireEvent.change(field('Priority'), { target: { value: 'urgent' } })
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
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
    expect(options('Request handling')).toEqual(['Save as a draft', 'Create active request and send to Lab'])
    expect(screen.getByText('Active creation saves the request, then asks Lab to accept it. If Lab does not, the request stays saved and active, even when an error is shown: '
      + 'check the list before creating it again, then open the request and use Send to Lab.')).toBeTruthy()
    fill()
    fireEvent.change(field('Request handling'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
    expect(api.createRecord.mock.calls[0]![4]).toMatchObject({ status: 'active' })
  })

  it('words: says today’s refusal when the request handling chosen is not one offered (Clinical.tsx:518)', async () => {
    await form()
    fill()
    fireEvent.change(field('Request handling'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByText('Choose a draft request.')).toBeTruthy()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('says Lab refused a saved active request, without its id, on the saved request’s page', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active' })])
    api.createRecord.mockRejectedValue(new HidApiError(409, `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)`, { code: 'LAB_HANDOFF_REFUSED' }))
    await form()
    fill()
    fireEvent.change(field('Request handling'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    const alert = await screen.findByText(/^Lab request saved and active in the EHR, but Lab refused it/)
    expect(alert.textContent).toBe('Lab request saved and active in the EHR, but Lab refused it, so the Laboratory does not have it. Do not create it again: once that is resolved, use Send to Lab on the request.')
    expect(document.body.textContent).not.toContain('LAB_TEST_UNKNOWN')
    expect(alert.textContent).not.toContain(LAB)
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', { cursor: undefined, fresh: true })
  })

  it('says an active create may have been saved when the answer is unclear, and sends the same create again', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.createRecord.mockRejectedValue(new HidApiError(503, 'Lab is unavailable'))
    await form()
    fill()
    fireEvent.change(field('Request handling'), { target: { value: 'active' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect((await screen.findByRole('alert')).textContent).toBe(`${SAID_UNAVAILABLE} The lab request may have been saved and active even so: check the list before creating it again.`)
    expect(document.body.textContent).not.toContain('Lab is unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
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
    expect(options('Request handling')).toEqual(['Save as a draft', 'Create and send to another laboratory'])
    fill()
    fireEvent.change(field('Priority'), { target: { value: 'stat' } })
    fireEvent.change(field('Request handling'), { target: { value: 'route' } })
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
    const send = screen.getByRole('button', { name: 'Create and send to Demo Laboratory' })
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
    fireEvent.change(field('Request handling'), { target: { value: 'route' } })
    change('Search for the laboratory', 'Demo')
    fireEvent.keyDown(field('Search for the laboratory'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Laboratory/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create and send to Demo Laboratory' }))
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

  it('says the route in plain words, with the route code under More details', async () => {
    await openOrder('pharmacy', RX)
    expect(savedValue('Route')).toEqual({ lead: 'By mouth', more: 'Route code: oral' })
    expect(screen.queryByText('oral')).toBeNull()
  })

  it('shows a route with no plain words as written', async () => {
    setLists([prescription({ routeCode: 'intrathecal' })], [])
    await openOrder('pharmacy', RX)
    expect(savedValue('Route')).toEqual({ lead: 'intrathecal', more: undefined })
  })

  it('says a missing route is not recorded', async () => {
    setLists([prescription({ routeCode: null })], [])
    await openOrder('pharmacy', RX)
    expect(savedValue('Route')).toEqual({ lead: 'Not recorded', more: undefined })
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
    expect(screen.getByText('Prescription status')).toBeTruthy()
    // The form names the new status it sets, with today's "New status" and choice label (Clinical.tsx:613).
    expect(screen.getByText('New status: Activate')).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Update status' })
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
    expect(screen.getByText('New status: Cancel')).toBeTruthy()
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
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain('Prescription changed since it was loaded')
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
    expect((await screen.findByRole('alert')).textContent).toBe('Send to Pharmacy could not be completed.')
    expect(document.body.textContent).not.toContain('Network error')
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

  // hid-system 0100: Pharmacy checks the prescription itself as it accepts it, and the EHR passes its refusal on.
  it.each([
    ['PRESCRIPTION_SOURCE_VERSION_MISMATCH', 409, 'This prescription changed since it was read; reload it and send it again',
      'This prescription changed since it was loaded, so it was not sent to Pharmacy: check it, and send it again if it is still needed.'],
    ['PRESCRIPTION_SOURCE_NOT_ACTIVE', 409, 'This prescription is no longer active, so Pharmacy did not accept it',
      'This prescription is no longer active, so it was not sent to Pharmacy.'],
    ['PRESCRIPTION_SOURCE_NOT_FOUND', 404, 'The prescription was not found at this facility',
      'This prescription can’t be sent to Pharmacy as it is: check it, and try again if it is still needed.'],
    ['PRESCRIPTION_SOURCE_MISMATCH', 422, 'The details sent do not match the prescription, so Pharmacy did not accept it',
      'This prescription can’t be sent to Pharmacy as it is: check it, and try again if it is still needed.'],
  ])('reads the order again and says plainly why Pharmacy refused it (%s)', async (code, status, detail, said) => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(status, detail, { code }))
    await openOrder('pharmacy', RX)
    api.records.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)

    expect(await screen.findByText(`${said} The list was reloaded.`)).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true })
    expect(document.body.textContent).not.toContain(code)
    expect(document.body.textContent).not.toContain(detail)
    expect(screen.queryByText('Pharmacy accepted this exact prescription version.')).toBeNull()
  })

  it('sends the version read again, under a new key, after Pharmacy found the prescription changed', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'This prescription changed since it was read; reload it and send it again',
      { code: 'PRESCRIPTION_SOURCE_VERSION_MISMATCH' }))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    setLists([prescription({ status: 'active', rowVersion: 4, instructions: 'Before meals' })], [])
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText(/^This prescription changed since it was loaded/)).toBeTruthy()

    api.acceptPrescription.mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText('Pharmacy accepted this exact prescription version.')).toBeTruthy()
    expect(api.acceptPrescription).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, RX, 4, 'Patient collecting today', expect.any(String))
    expect(api.acceptPrescription.mock.calls[1]![6]).not.toBe(api.acceptPrescription.mock.calls[0]![6])
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
    // Printing is a read, so it stays; nothing that changes the order is offered.
    expect(screen.getByRole('button', { name: 'Print prescription' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send to Pharmacy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull()
  })

  it('shows today’s message when the order cannot be read', async () => {
    api.records.mockRejectedValue(new HidApiError(503, 'Identity is unavailable'))
    open(orderPath(ENCOUNTER_ID, 'pharmacy', RX))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('Identity is unavailable')
  })
})

describe('A lab request’s page', () => {
  it('names the test, with its code under More details rather than a code line', async () => {
    await openOrder('laboratory', LAB)
    expect(savedValue('Test')).toEqual({ lead: 'Haemoglobin', more: 'Code: LOINC 718-7' })
    expect(screen.queryByText('Code', { selector: 'dt' })).toBeNull()
    expect(screen.queryByText('LOINC 718-7')).toBeNull()
  })

  it('names a test with no name by its code, with no More details', async () => {
    setLists([], [labRequest({ testDisplay: '  ' })])
    await openOrder('laboratory', LAB)
    expect(savedValue('Test')).toEqual({ lead: 'LOINC 718-7', more: undefined })
  })

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
    expect(screen.getByText('Lab request status')).toBeTruthy()
    expect(screen.getByText('New status: Activate and send to Lab')).toBeTruthy()
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
    // The page's own re-check before its first read, then one before each send.
    expect(api.lookupPatient).toHaveBeenCalledTimes(3)
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
    expect(await screen.findByText('9.8 g/dL')).toBeTruthy()
    expect(screen.getByText('Reference range: 12.0-15.5')).toBeTruthy()
    expect(screen.getByText('Result 1')).toBeTruthy()
    // The test leads with its name; its code waits under a closed "More details" (owner decision 33.4).
    const named = screen.getByText(/^Haemoglobin · accepted by Lab /)
    expect(named.textContent).toBe(`Haemoglobin · accepted by Lab ${formatWhen('2026-10-30T10:00:00.000Z')}`)
    expect(named.textContent).not.toContain('718-7')
    const details = named.parentElement!.querySelector(':scope > details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('More details: Haemoglobin')
    expect(details.querySelector(':scope > div')?.textContent).toBe('Code: LOINC 718-7')
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith(FACILITY_ID, LAB, 'direct-care')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh released results' }))
    await waitFor(() => expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(2))
  })

  it('names released results for a test with no name by its code, with no More details, and prints it by its code', async () => {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    api.labReleasedResultsForOrder.mockResolvedValueOnce({ workItemId: 'w1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, patientId: PATIENT_ID,
      acceptedAt: '2026-10-30T10:00:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: '' },
      results: [{ id: 'r1', executionId: 'x1', status: 'released', verificationStatus: 'verified', currentVersion: 1, currentReleasedVersion: 1, revisions: [
        { version: 1, resultType: 'numeric', numericValue: 9.8, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low', entrySource: 'manual',
          verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-10-30T11:00:00.000Z', releasedAt: '2026-10-30T11:30:00.000Z', correctionReason: null },
      ] }] })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    const named = await screen.findByText(/^LOINC 718-7 · accepted by Lab /)
    // In the app's own date format (formatWhen), as every released-results date is.
    expect(named.textContent).toBe(`LOINC 718-7 · accepted by Lab ${formatWhen('2026-10-30T10:00:00.000Z')}`)
    expect(named.parentElement!.querySelector(':scope > details')).toBeNull()
    // The printed result names the test the same way.
    let printed = ''
    vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print="lab-result"]')?.textContent ?? '' })
    fireEvent.click(screen.getByRole('button', { name: 'Print result' }))
    expect(printed).toContain('LOINC 718-7')
    act(() => { window.dispatchEvent(new Event('afterprint')) })
  })

  it('prints the released result as a lab result paper', async () => {
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
    let printed = ''
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print="lab-result"]')?.textContent ?? '' })
    await openOrder('laboratory', LAB)
    // No print until a result is read and shown.
    expect(screen.queryByRole('button', { name: 'Print result' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Print result' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
    for (const words of [FACILITY_NAME, PATIENT_NAME, PATIENT_HID, 'Laboratory result', 'Haemoglobin', '9.8 g/dL', '12.0-15.5', 'Low']) expect(printed).toContain(words)
    // Printing reads nothing more.
    expect(api.labReleasedResultsForOrder).toHaveBeenCalledTimes(1)
  })

  it('offers no result print when nothing is released', async () => {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    api.labReleasedResultsForOrder.mockResolvedValue({ workItemId: 'w1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, patientId: PATIENT_ID,
      acceptedAt: '2026-10-30T10:00:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results: [] })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    expect(await screen.findByText('No result released yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Print result' })).toBeNull()
  })

  it('prints a prescription with the patient, Health ID, the medicine and the prescriber', async () => {
    staff.permissions = [...READ_WRITE]
    // As production has them: the session's actor.id is the sign-in subject, the prescription carries the author's account.
    staff.signedIn = SIGNED_IN
    setLists([prescription({ status: 'active', rowVersion: 3, createdBy: SIGNED_IN.accountId, createdByMembershipId: SIGNED_IN.membershipId,
      startsOn: '2026-10-30', endsOn: '2026-11-05' })], [])
    let printed = ''
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print="prescription"]')?.textContent ?? '' })
    await openOrder('pharmacy', RX)
    const button = screen.getByRole('button', { name: 'Print prescription' })
    expect(button.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(button)
    expect(printSpy).toHaveBeenCalledTimes(1)
    for (const words of [FACILITY_NAME, PATIENT_NAME, PATIENT_HID, 'Amoxicillin 500 mg', 'By mouth · Twice daily · for 7 days', 'After meals', 'Demo Clinician', 'Licence number']) {
      expect(printed).toContain(words)
    }
    // The paper leaves the page once the print dialog closes.
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    expect(document.querySelector('[data-clinical-print]')).toBeNull()
  })

  it('leaves the prescriber’s name for handwriting when a colleague wrote the prescription', async () => {
    staff.permissions = [...READ_WRITE]
    staff.signedIn = SIGNED_IN
    setLists([prescription({ status: 'active', rowVersion: 3, createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId })], [])
    let printed = ''
    vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print="prescription"]')?.textContent ?? '' })
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Print prescription' }))
    expect(printed).toContain('Amoxicillin 500 mg')
    expect(printed).not.toContain('Demo Clinician')
    expect(document.querySelector('[data-clinical-print] .hid-clinical-paper-sign .hid-clinical-paper-line')?.textContent).toBe('')
  })

  it.each(['draft', 'on_hold', 'completed', 'cancelled', 'entered_in_error'])('offers no print for a prescription that is %s', async status => {
    staff.permissions = [...READ_WRITE]
    setLists([prescription({ status, rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    expect(screen.queryByRole('button', { name: 'Print prescription' })).toBeNull()
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
    expect((await screen.findByRole('alert')).textContent).toBe('The laboratory hasn’t accepted this request here yet, or your access to this patient doesn’t cover it.')
    expect(document.body.textContent).not.toContain('work item')
    api.labReleasedResultsForOrder.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'LAB_ACCESS_DENIED' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh released results' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('You can’t see this request’s lab results here.'))
    expect(document.body.textContent).not.toContain('LAB_ACCESS_DENIED')
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
    // Only the page's own re-check before its first read: the withdrawal makes none, as today.
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
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

  it('asks the clinician to have an order accepted for the wrong person ended there first, before marking it entered in error, as today', async () => {
    // Today's item 3 (C1) warning (staff/routes/__tests__/LabRequestRoute.test.tsx:232-248): the ordering side has no
    // "This isn't the order's patient"; its correction is Mark entered in error, and Demo Laboratory ends the order there.
    setLists([], [labRequest({ status: 'active', rowVersion: 5, orderRoute: route({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }) })],
      { crossFacilityOrders: true, wrongPatientReports: true })
    api.updateRecord.mockResolvedValue(labRequest({ status: 'entered_in_error', rowVersion: 6 }))
    await openOrder('laboratory', LAB)
    expect(screen.queryByRole('button', { name: /isn’t the order’s patient/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark entered in error' }))
    expect(screen.getByText('New status: Mark entered in error')).toBeTruthy()
    expect(screen.getByText('Changing it withdraws it from Demo Laboratory, or cancels it there if Demo Laboratory has accepted it; a cancelled '
      + 'order can’t be resumed there. If Demo Laboratory accepted it for someone who was not Patient One, ask Demo Laboratory to end it from '
      + 'its work list first: once you change this order, Demo Laboratory can no longer withdraw a result or dispensing it sent back.')).toBeTruthy()
    change('Reason for change', 'Ordered for the wrong patient')
    fireEvent.submit(field('Reason for change').closest('form')!)
    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', LAB,
      { expectedRowVersion: 5, changeReason: 'Ordered for the wrong patient', status: 'entered_in_error' }))
  })

  it('keeps the earlier change warning while the backend has no wrong-patient report (D15), as today', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 5, orderRoute: route({ effectiveState: 'accepted', acceptedAt: '2026-10-21T10:00:00.000Z' }) })],
      { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Mark entered in error' }))
    expect(screen.getByText('Changing it withdraws it from Demo Laboratory, or cancels it there if Demo Laboratory has accepted it; a cancelled '
      + 'order can’t be resumed there.')).toBeTruthy()
    expect(screen.queryByText(/end it from its work list/)).toBeNull()
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

  it('keeps a lab request the laboratory couldn’t complete open here, as today: still active, its changes offered with today’s warning, and no Send', async () => {
    // Today's D18 row (staff/routes/__tests__/LabRequestRoute.test.tsx:390-401): the request stays as it was in the EHR;
    // only the route ended. Demo Laboratory is fictional.
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send', 'lab.work-item.accept', 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 5, orderRoute: route({ effectiveState: 'cancelled', version: 4,
      acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'receiving_unable',
      notCompleted: { reason: 'supplies_unavailable', sampleTaken: true, resultRecorded: true } }) })], { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    expect(screen.getByText('Demo Laboratory says it has run out of what this test needs. Write a new lab request if Patient One still '
      + 'needs it. A sample was taken there: phone Demo Laboratory if it could be sent to another laboratory. A result was recorded '
      + 'there but not released: phone Demo Laboratory if you need to know more.')).toBeTruthy()
    // Open: today's changes for a routed active request (ROUTED_LAB_CHOICES), never this facility's Send to Lab or results.
    for (const name of ['Put on hold', 'Complete', 'Cancel order', 'Mark entered in error']) expect(screen.getByRole('button', { name })).toBeTruthy()
    for (const name of ['Send to Lab', 'View released results', 'Send to another laboratory']) expect(screen.queryByRole('button', { name })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    expect(screen.getByText('Demo Laboratory has already ended this order there, so changing it here changes nothing at Demo Laboratory.')).toBeTruthy()
  })

  it('offers Send to another laboratory again on a request the laboratory couldn’t complete, only when the EHR allows it', async () => {
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest({ status: 'active', rowVersion: 5, orderRoute: route({ effectiveState: 'cancelled', version: 4,
      acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'receiving_unable', resendAllowed: true }) })],
    { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    expect(screen.getByText('Write a new lab request if Patient One still needs it.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send to another laboratory' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Put on hold' })).toBeTruthy()
  })

  it('keeps a lab request the laboratory couldn’t complete in this consultation’s orders, still active, saying it ended there', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 5, orderRoute: route({ effectiveState: 'cancelled', version: 4,
      acceptedAt: '2026-10-21T10:00:00.000Z', endedAt: '2026-10-23T10:00:00.000Z', endedKind: 'receiving_unable',
      notCompleted: { reason: 'supplies_unavailable', sampleTaken: true, resultRecorded: true } }) })], { crossFacilityOrders: true })
    open(ENCOUNTER_ID)
    const list = await screen.findByRole('list', { name: 'Orders from this consultation' })
    const row = within(list).getByRole('link', { name: 'Laboratory · Haemoglobin' }).closest('li')!
    expect(within(row).getByText('Active')).toBeTruthy()
    expect(within(row).getByText(/^Accepted by Demo Laboratory on .+; ended on .+: Demo Laboratory couldn’t complete it\.$/)).toBeTruthy()
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

/**
 * Today's list says, under each order's row, where an order sent to another facility is and what became of it (the
 * OrderRoutePanel's heading and status, Clinical.tsx:1889-1893, OrderRoutes.tsx:384-387), so a clinician sees an order
 * refused, ended unfinished or reported for the wrong person without opening it. Read from the list's own answer.
 */
describe('Where each order stands, under its row in the orders list', () => {
  const ACCEPTED_AT = '2026-10-21T10:00:00.000Z'
  const ENDED_AT = '2026-10-22T10:00:00.000Z'
  /** The line for a route state this website does not know: where it went, and to check with it. */
  const UNKNOWN_STATE = 'Sent to Demo Laboratory. This page can’t show what became of it: contact Demo Laboratory to check.'

  beforeEach(() => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  })

  async function rowOf(name: string) {
    open(ENCOUNTER_ID)
    const list = await screen.findByRole('list', { name: 'Orders from this consultation' })
    const link = within(list).getByRole('link', { name })
    return { link, row: link.closest('li')! }
  }

  it('says where a lab request sent to another laboratory waits, and the row’s link is described by it', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    const { link, row } = await rowOf('Laboratory · Haemoglobin')
    expect(within(row).getByText('Sent to another laboratory')).toBeTruthy()
    const status = within(row).getByText(/^Sent to Demo Laboratory: waiting for it to accept, until .+\.$/)
    expect(status.className).toBe('hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-info')
    // The order's own status stays beside it, in words.
    expect(within(row).getByText('Active')).toBeTruthy()
    const described = document.getElementById(link.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe(`Sent to another laboratory${status.textContent}`)
    // No code in the row: not the reference, not a stored state.
    expect(row.textContent).not.toContain('9C1B2D3E')
    expect(row.textContent).not.toMatch(/Ref |lab_request|receiving_unable|effectiveState/)
    // From the list's answer: no route is read for it.
    expect(routes.routes).not.toHaveBeenCalled()
  })

  it.each([
    ['accepted', { effectiveState: 'accepted', acceptedAt: ACCEPTED_AT }, /^Accepted by Demo Laboratory on .+\.$/, 'positive'],
    ['refused', { effectiveState: 'declined', declineReason: 'test_not_offered' }, /^Declined by Demo Laboratory: This test isn’t offered\. Send it elsewhere\.$/, 'caution'],
    ['can’t complete', { effectiveState: 'cancelled', acceptedAt: ACCEPTED_AT, endedAt: ENDED_AT, endedKind: 'receiving_unable',
      notCompleted: { reason: 'sample_unusable', sampleTaken: true, resultRecorded: false } },
    /^Accepted by Demo Laboratory on .+; ended on .+: Demo Laboratory couldn’t complete it\.$/, 'caution'],
    ['results back', { effectiveState: 'completed', acceptedAt: ACCEPTED_AT, completedAt: ENDED_AT }, /^Results released by Demo Laboratory on .+\.$/, 'positive'],
    ['the wrong patient', { effectiveState: 'completed', acceptedAt: ACCEPTED_AT, completedAt: ENDED_AT, endedAt: ENDED_AT, endedKind: 'wrong_patient' },
      /^Demo Laboratory reports that the results it released belong to someone else, and has ended it\. Do not use them\.$/, 'caution'],
    ['withdrawn by the patient', { effectiveState: 'withdrawn', endedAt: ENDED_AT, endedKind: 'patient' }, /^Patient One stopped it in the Health ID app\.$/, 'neutral'],
    ['not accepted in time', { effectiveState: 'expired' }, /^Not accepted by Demo Laboratory within 7 days\. Send it elsewhere\.$/, 'caution'],
    ['accepted with nothing back in time', { effectiveState: 'expired', acceptedAt: ACCEPTED_AT },
      /^Accepted by Demo Laboratory on .+; nothing came back within 30 days\.$/, 'caution'],
  ])('says a lab request %s, in today’s words and tone', async (_name, state, words, tone) => {
    setLists([], [labRequest({ status: 'active', rowVersion: 3, orderRoute: route(state) })], { crossFacilityOrders: true })
    const { row } = await rowOf('Laboratory · Haemoglobin')
    expect(within(row).getByText('Sent to another laboratory')).toBeTruthy()
    expect(within(row).getByText(words).className).toBe(`hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-${tone}`)
  })

  it('says where a prescription sent to a pharmacy is: dispensed there', async () => {
    setLists([prescription({ status: 'active', rowVersion: 4, orderRoute: route({ kind: 'prescription', effectiveState: 'completed', acceptedAt: ACCEPTED_AT,
      completedAt: ENDED_AT, receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true } }) })], [], { crossFacilityOrders: true })
    const { row } = await rowOf('Pharmacy · Amoxicillin')
    expect(within(row).getByText('Sent to a pharmacy')).toBeTruthy()
    expect(within(row).getByText(/^Dispensed by Demo Pharmacy on .+\.$/)).toBeTruthy()
  })

  it('says nothing more for an order never sent elsewhere, one whose route the EHR did not send, or a malformed route', async () => {
    setLists([prescription({ orderRoute: null })], [labRequest({ orderRoute: { id: ROUTE, effectiveState: 'sent' } }),
      labRequest({ id: 'c0000000-0000-4000-8000-000000000002', testDisplay: 'Blood glucose' })], { crossFacilityOrders: true })
    const { link, row } = await rowOf('Pharmacy · Amoxicillin')
    expect(link.getAttribute('aria-describedby')).toBeNull()
    expect(row.querySelector('.hid-ehr-clinical-orders-row-route')).toBeNull()
    for (const name of ['Laboratory · Haemoglobin', 'Laboratory · Blood glucose']) {
      const lab = screen.getByRole('link', { name })
      expect(lab.getAttribute('aria-describedby')).toBeNull()
      expect(lab.closest('li')!.querySelector('.hid-ehr-clinical-orders-row-route')).toBeNull()
    }
    expect(screen.queryByText(/^Sent to /)).toBeNull()
  })

  it('says nothing of routes on today’s main backend, as today’s list (novu only)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'declined', declineReason: 'test_not_offered' }) })], { crossFacilityOrders: true })
    const { link, row } = await rowOf('Laboratory · Haemoglobin')
    expect(within(row).queryByText('Sent to another laboratory')).toBeNull()
    expect(screen.queryByText(/^Declined by /)).toBeNull()
    expect(link.getAttribute('aria-describedby')).toBeNull()
  })

  it('says where it went for a state this website does not know, and to check with it: no stored state on the row', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'paused_there' }) })], { crossFacilityOrders: true })
    const { row } = await rowOf('Laboratory · Haemoglobin')
    expect(within(row).getByText(UNKNOWN_STATE).className).toBe('hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-neutral')
    expect(row.textContent).not.toMatch(/paused/)
  })

  it('names the other facility in words when the EHR sent no name, for a state this website does not know', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'paused_there',
      receivingFacility: { id: LABORATORY_ID, name: null, available: true } }) })], { crossFacilityOrders: true })
    const { row } = await rowOf('Laboratory · Haemoglobin')
    expect(within(row).getByText('Sent to the other facility. This page can’t show what became of it: contact the other facility to check.')).toBeTruthy()
    expect(row.textContent).not.toMatch(/null|undefined|paused/)
  })

  it('says the same for a state this website does not know on the order’s page, beside Send to Lab', async () => {
    // Not a bare "Sent to Demo Laboratory.": the page also offers Send to Lab, so it must not read as still on its way there.
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'superseded' }) })], { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    expect(screen.getByRole('heading', { level: 2, name: 'Sent to another laboratory' })).toBeTruthy()
    expect(screen.getByText(UNKNOWN_STATE).className).toBe('hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-neutral')
    expect(screen.queryByText('Sent to Demo Laboratory.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send to Lab' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/superseded/)
  })

  it('says the same for an earlier route in a state this website does not know, in the order’s details', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route({ effectiveState: 'declined', declineReason: 'test_not_offered' }) })], { crossFacilityOrders: true })
    const attestation = { textVersion: 'v1', attestedByName: 'Demo Clinician', attestedAt: '2026-10-20T10:00:00.000Z', receivingFacilityName: 'Demo Laboratory' }
    routes.routes.mockResolvedValue({ items: [
      { ...route({ effectiveState: 'declined', declineReason: 'test_not_offered' }), attestation, events: [], results: [] },
      { ...route({ id: 'd0000000-0000-4000-8000-000000000002', effectiveState: 'paused_there' }), attestation, events: [], results: [] },
    ] })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Show details and results' }))
    expect(await screen.findByText(`Earlier: ${UNKNOWN_STATE}`)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/paused/)
  })

  it('draws the order page’s status line in the same tone as the row’s', async () => {
    setLists([], [labRequest({ status: 'active', rowVersion: 3, orderRoute: route({ effectiveState: 'declined', declineReason: 'test_not_offered' }) })], { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    expect(screen.getByText('Declined by Demo Laboratory: This test isn’t offered. Send it elsewhere.').className)
      .toBe('hid-ehr-clinical-orders-route-status hid-ehr-clinical-orders-tone-caution')
  })
})

/** A promise the test answers itself, once the call it stands for has been made. */
function deferred<T>() {
  let answer: (value: T) => void = () => {}
  const promise = new Promise<T>(resolve => { answer = resolve })
  return { promise, answer }
}

const UNAVAILABLE = () => new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })

/** The lab request form filled with today's fields, and the handling chosen. */
async function labForm(handling: 'draft' | 'active' | 'route' = 'draft') {
  open(`${ENCOUNTER_ID}/orders/new/laboratory`)
  await screen.findByRole('button', { name: 'Create lab request' })
  if (handling === 'route') await waitFor(() => expect(Array.from((field('Request handling') as unknown as HTMLSelectElement).options).map(option => option.value)).toContain('route'))
  change('Test code system', 'LOINC')
  change('Test code', '718-7')
  change('Test display', 'Haemoglobin')
  if (handling !== 'draft') fireEvent.change(field('Request handling'), { target: { value: handling } })
}

/**
 * Today's page says what a create came to beside the list, whatever its re-read finds (Clinical.tsx createRecord, :1453-1505,
 * createAndSend :1637-1673). The blue create page carries it to the saved order's page: it must be said there too when
 * that page cannot read the order, or does not find it, or a clinician may create the order again.
 */
describe('blockers: what a create said is shown even when the saved order’s page cannot show the order', () => {
  async function savePrescription() {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    change('Medication', 'Amoxicillin')
    change('Dose quantity', '500')
    change('Dose unit', 'mg')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
  }

  it('blocker: a saved prescription says it was saved when its page cannot be read, which reads the list afresh as today after a change', async () => {
    api.records.mockRejectedValue(UNAVAILABLE())
    await savePrescription()
    expect(await screen.findByText(`The change was saved, but the records could not be reloaded. ${SAID_UNAVAILABLE}`)).toBeTruthy()
    expect(screen.getByText('Clinical record saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledTimes(1)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true })
    expect(api.records).not.toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')
  })

  it('blocker: a saved prescription says it was saved when its page does not find it', async () => {
    setLists([], [])
    await savePrescription()
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('Clinical record saved.')).toBeTruthy()
  })

  it('blocker: "Do not create it again" stays on the page when the saved active lab request is not found there', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [])
    // The server's words name the saved request; the HTTP client keeps them as `detail`, never shown.
    api.createRecord.mockRejectedValue(new HidApiError(409, `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)`,
      { code: 'LAB_HANDOFF_REFUSED', detail: `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)` }))
    await labForm('active')
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('Lab request saved and active in the EHR, but Lab refused it, so the Laboratory does not have it. '
      + 'Do not create it again: once that is resolved, use Send to Lab on the request.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('LAB_TEST_UNKNOWN')
  })

  it('blocker: an active lab request Lab did not accept says so when its page cannot be read', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.createRecord.mockResolvedValue({ ...labRequest({ status: 'active' }), labHandoff: { state: 'failed', status: 409, code: 'LAB_TEST_UNKNOWN' } })
    await labForm('active')
    api.records.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByText('Lab request created in the EHR: its status is saved, but Lab refused it. Once that is resolved, '
      + 'use Send to Lab on the request. The list could not be reloaded; refresh it to see the request.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('LAB_TEST_UNKNOWN')
    // One read, said once: today's labWarning replaces loadRecords' own sentence (Clinical.tsx:1437, :1447-1448).
    expect(screen.queryByText(`The change was saved, but the records could not be reloaded. ${SAID_UNAVAILABLE}`)).toBeNull()
  })

  it('blocker: a lab request saved but not sent to another laboratory says so when its page cannot be read', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest()], { crossFacilityOrders: true })
    api.createRecord.mockResolvedValue(labRequest())
    routes.send.mockRejectedValue(new HidApiError(409, 'Not eligible', { code: 'ORDER_ROUTE_DESTINATION_INELIGIBLE' }))
    await labForm('route')
    change('Search for the laboratory', 'Demo')
    fireEvent.keyDown(field('Search for the laboratory'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Laboratory/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
    api.records.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(screen.getByRole('button', { name: 'Create and send to Demo Laboratory' }))
    await confirmPatient(`Send this lab request (Haemoglobin) for ${PATIENT_NAME} to Demo Laboratory?`, 'Send lab request')
    expect(await screen.findByText('Saved as a draft. Not sent: Demo Laboratory can’t receive this order on Health ID at the moment. Choose another laboratory. '
      + 'The list could not be reloaded; refresh it to see the lab requests.')).toBeTruthy()
    // One read, said once: today's createAndSend replaces loadRecords' own sentence (Clinical.tsx:1437, :1666-1667).
    expect(screen.queryByText(`The change was saved, but the records could not be reloaded. ${SAID_UNAVAILABLE}`)).toBeNull()
  })
})

/** The fresh reads of the lab requests list (the create page's, or the saved request's page's), counted. */
function freshLabReads() {
  return api.records.mock.calls.filter(call => call[3] === 'lab-requests' && (call[4] as { fresh?: boolean } | undefined)?.fresh === true).length
}

/** Submits the open form whose field this is (the create page's, or an order's change), whatever its button says. */
function submitWith(label: string) {
  fireEvent.submit(field(label).closest('form')!)
}

/**
 * Review of the blockers: today's page reads the list once after a create and says once what that read came to
 * (Clinical.tsx createRecord :1453-1505, labWarning :1447-1448, createAndSend :1659-1667). The saved request's page
 * reads it afresh, so the create page does not read it too when it can open the request.
 */
describe('review: after a create the list is read once, and what the read came to is said once', () => {
  async function sendElsewhere() {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest()], { crossFacilityOrders: true })
    api.createRecord.mockResolvedValue(labRequest())
    await labForm('route')
    change('Search for the laboratory', 'Demo')
    fireEvent.keyDown(field('Search for the laboratory'), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Laboratory/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
  }

  const UNANSWERED = 'Saved. Health ID did not answer the send, so it may or may not have gone to Demo Laboratory: check the row below before sending it again.'

  it('blocker: a send with no answer reads the list once, on the saved request’s page, which says it was reloaded', async () => {
    routes.send.mockRejectedValue(new HidApiError(503, 'Health ID is unavailable.', { code: 'UNAVAILABLE' }))
    await sendElsewhere()
    const before = freshLabReads()
    submitWith('Test code')
    await confirmPatient(`Send this lab request (Haemoglobin) for ${PATIENT_NAME} to Demo Laboratory?`, 'Send lab request')
    expect(await screen.findByText(`${UNANSWERED} The list was reloaded.`)).toBeTruthy()
    expect(freshLabReads() - before).toBe(1)
    expect(screen.queryByText(/could not be reloaded/)).toBeNull()
  })

  it('blocker: a send with no answer whose page cannot read the list says that once, not also that the list was reloaded', async () => {
    routes.send.mockRejectedValue(new HidApiError(503, 'Health ID is unavailable.', { code: 'UNAVAILABLE' }))
    await sendElsewhere()
    api.records.mockRejectedValue(UNAVAILABLE())
    submitWith('Test code')
    await confirmPatient(`Send this lab request (Haemoglobin) for ${PATIENT_NAME} to Demo Laboratory?`, 'Send lab request')
    expect(await screen.findByText(`${UNANSWERED} The list could not be reloaded; refresh it to see the lab requests.`)).toBeTruthy()
    expect(screen.queryByText(/The list was reloaded\./)).toBeNull()
    expect(screen.queryByText(`The change was saved, but the records could not be reloaded. ${SAID_UNAVAILABLE}`)).toBeNull()
  })

  it('blocker: an active request Lab did not accept is read once, by its page', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active' })])
    api.createRecord.mockResolvedValue({ ...labRequest({ status: 'active' }), labHandoff: { state: 'failed', status: 409, code: 'LAB_TEST_UNKNOWN' } })
    await labForm('active')
    const before = freshLabReads()
    submitWith('Test code')
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByText('Lab request created in the EHR: its status is saved, but Lab refused it. Once that is resolved, '
      + 'use Send to Lab on the request.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('LAB_TEST_UNKNOWN')
    expect(freshLabReads() - before).toBe(1)
  })

  it('format: on a saved request’s page that does not find it, the page’s heading comes before what the create said', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [])
    // The server's words name the saved request; the HTTP client keeps them as `detail`, never shown.
    api.createRecord.mockRejectedValue(new HidApiError(409, `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)`,
      { code: 'LAB_HANDOFF_REFUSED', detail: `Lab request ${LAB} is saved and active in the EHR, but Lab refused it (LAB_TEST_UNKNOWN)` }))
    await labForm('active')
    submitWith('Test code')
    await confirmPatient(SEND_LAB(), 'Send lab request')
    const heading = await screen.findByRole('heading', { level: 1, name: 'Record not found' })
    const said = screen.getByText(/^Lab request saved and active in the EHR, but Lab refused it/)
    expect(heading.compareDocumentPosition(said) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

/**
 * Review of the lock: two reads of an order can overlap (a withdrawal while a status change's read is out). Today's
 * page keeps only the latest read, and only it lifts the lock (Clinical.tsx:1417, :1426, :1435, :1440).
 */
describe('review: only the latest read of an order is kept, and only it lifts the lock', () => {
  /**
   * An active lab request sent to Demo Laboratory, put on hold (read A held), then withdrawn (read B held). Read A
   * answers it on hold and still sent (Cancel order offered); read B on hold and withdrawn, so this member, who may
   * send requests to Lab, is offered Resume and send to Lab instead.
   */
  async function holdThenWithdraw() {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send', 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    api.updateRecord.mockResolvedValue(labRequest({ status: 'on_hold', rowVersion: 3, orderRoute: route() }))
    routes.withdraw.mockResolvedValue({ route: route({ effectiveState: 'withdrawn' }) })
    await openOrder('laboratory', LAB)
    const readA = deferred<unknown>()
    const readB = deferred<unknown>()
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    change('Reason for change', 'Waiting for the patient')
    const reads = api.records.mock.calls.length
    api.records.mockImplementation(() => readA.promise)
    submitWith('Reason for change')
    expect(await screen.findByText('Lab request status updated.')).toBeTruthy()
    await waitFor(() => expect(api.records.mock.calls.length).toBe(reads + 1))
    api.records.mockImplementation(() => readB.promise)
    fireEvent.change(field('Withdraw it from Demo Laboratory'), { target: { value: 'patient_request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Withdrawn from Demo Laboratory. Patient One is told in the Health ID app.')).toBeTruthy()
    await waitFor(() => expect(api.records.mock.calls.length).toBe(reads + 2))
    const answerA = () => act(async () => { readA.answer({ items: [labRequest({ status: 'on_hold', rowVersion: 3, orderRoute: route() })], nextCursor: null, crossFacilityOrders: true }) })
    const answerB = () => act(async () => {
      readB.answer({ items: [labRequest({ status: 'on_hold', rowVersion: 4, orderRoute: route({ version: 2, effectiveState: 'withdrawn', resendAllowed: true }) })], nextCursor: null, crossFacilityOrders: true })
    })
    return { answerA, answerB }
  }

  it('gap: the first read to answer does not lift the lock while the later one is out', async () => {
    const { answerA, answerB } = await holdThenWithdraw()
    await answerA()
    const cancel = screen.getByRole('button', { name: 'Cancel order' })
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(cancel)
    expect(cancel.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(labelled('Reason for change'))).toBeNull()
    await answerB()
    expect(await screen.findByText('Withdrawn.')).toBeTruthy()
    const resume = screen.getByRole('button', { name: 'Resume and send to Lab' })
    expect(resume.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(resume)
    expect(resume.getAttribute('aria-expanded')).toBe('true')
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
  })

  it('gap: an older read that answers last does not replace the newer one', async () => {
    const { answerA, answerB } = await holdThenWithdraw()
    await answerB()
    expect(await screen.findByText('Withdrawn.')).toBeTruthy()
    await answerA()
    expect(screen.getByText('Withdrawn.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Resume and send to Lab' }).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('gaps: who may add an order, and the request handling the EHR refused', () => {
  it('gap: offers no create step, and the create page refuses, without the list’s read permission (today’s tab gate, Clinical.tsx:1853)', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.write', 'ehr.lab-request.read', 'ehr.lab-request.write']
    const first = open(ENCOUNTER_ID)
    await screen.findByRole('button', { name: 'New lab request' })
    expect(screen.queryByRole('button', { name: 'New prescription' })).toBeNull()
    first.unmount()
    staff.permissions = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.lab-request.write']
    const second = open(ENCOUNTER_ID)
    await screen.findByRole('button', { name: 'New prescription' })
    expect(screen.queryByRole('button', { name: 'New lab request' })).toBeNull()
    second.unmount()
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByLabelText(labelled('Test display'))).toBeNull()
  })

  it('gap: marks the request handling where it was chosen when the EHR refuses it (status), as today’s markRefused', async () => {
    api.createRecord.mockRejectedValue(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'status', messages: ['status must be one of the following values: draft, active'] }],
    }))
    await labForm()
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    const handling = field('Request handling')
    expect(handling.getAttribute('aria-invalid')).toBe('true')
    const described = (handling.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
    // At the field: a plain word, never the field's internal name or the validator's words.
    expect(described).toContain('Check this detail.')
    expect(document.body.textContent).not.toMatch(/Status must be|following values|request fields are invalid/)
  })
})

describe('gap: no change starts from an order while it is read again after a change (today’s disabled={recordsLoading})', () => {
  it('gap: the other changes do nothing while the order is read again, then the new ones are offered', async () => {
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    const read = deferred<unknown>()
    api.records.mockImplementation(() => read.promise)
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true }))
    // The page still shows the draft (version 1): Cancel order says it can't be used yet, stays focusable, and opens nothing.
    const cancel = screen.getByRole('button', { name: 'Cancel order' }) as HTMLButtonElement
    expect(cancel.getAttribute('aria-disabled')).toBe('true')
    expect(cancel.disabled).toBe(false)
    fireEvent.click(cancel)
    expect(cancel.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(labelled('Reason for change'))).toBeNull()
    await act(async () => { read.answer({ items: [prescription({ status: 'active', rowVersion: 2 })], nextCursor: null }) })
    const hold = await screen.findByRole('button', { name: 'Put on hold' })
    expect(hold.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(hold)
    expect(field('Reason for change')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
  })

  it('gap: a change already open is not sent while the order is read again after a withdrawal', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    routes.withdraw.mockResolvedValue({ route: route({ effectiveState: 'withdrawn' }) })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    change('Reason for change', 'Waiting for the patient')
    fireEvent.change(field('Withdraw it from Demo Laboratory'), { target: { value: 'patient_request' } })
    const read = deferred<unknown>()
    api.records.mockImplementation(() => read.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText('Withdrawn from Demo Laboratory. Patient One is told in the Health ID app.')).toBeTruthy()
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests', { cursor: undefined, fresh: true }))
    const submit = screen.getByRole('button', { name: 'Update status' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    // The page checked access once when it opened (#98); the change sends no check of its own.
    const checks = api.lookupPatient.mock.calls.length
    await act(async () => { fireEvent.submit(field('Reason for change').closest('form')!) })
    expect(api.lookupPatient).toHaveBeenCalledTimes(checks)
    expect(api.updateRecord).not.toHaveBeenCalled()
    await act(async () => {
      read.answer({ items: [labRequest({ status: 'active', rowVersion: 3, orderRoute: route({ effectiveState: 'withdrawn', resendAllowed: true }) })], nextCursor: null, crossFacilityOrders: true })
    })
    expect(await screen.findByText('Withdrawn.')).toBeTruthy()
  })
})

/** A select's options, as their visible text. */
function options(label: string) {
  return Array.from((field(label) as unknown as HTMLSelectElement).options).map(option => option.textContent)
}

// The prescribing form's allergy lines are triage's and a new consultation's (AllergyLines). Before 0124 (the allergy
// list answers 404, as in beforeEach) only the patient's own text is read, labelled as theirs, never "None recorded".
const ALLERGIES = 'Allergies reported by the patient: Penicillin (entered by the patient in their Health ID portal, not clinically verified).'
const NONE_REPORTED = `${NOTHING_REPORTED} Confirm allergies with the patient.`

/** No allergy line of any kind on the page. */
function noAllergyLines() {
  expect(document.body.textContent).not.toMatch(/Recorded allergies|Allergies reported by the patient|recorded by clinicians|not entered any allergies|allergies can’t be shown|allergies could not be loaded/)
}

/**
 * Hand-off 06, as the redesign settled it: the one-option "Patient *" and "Encounter *" selects are gone. The patient is
 * the banner (and is confirmed before saving), the consultation is the one in the address ("For this consultation"), and
 * neither is a field that could be blanked or sent.
 */
describe('Hand-off 06: the open patient and this consultation carry in on New lab request and New prescription', () => {
  it.each([
    ['laboratory', 'Add lab requests', 'Test display'],
    ['pharmacy', 'Add prescriptions', 'Medication'],
  ] as const)('06: New %s names the open patient in the banner and this consultation, with no Patient or Encounter field', async (kind, title, first) => {
    open(`${ENCOUNTER_ID}/orders/new/${kind}`)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(new RegExp(PATIENT_HID))).toBeTruthy()
    expect(screen.getByText('For this consultation')).toBeTruthy()
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
    await screen.findByRole('button', { name: 'Create lab request' })
    await act(async () => {})
    noAllergyLines()
    expect(api.allergies).not.toHaveBeenCalled()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('06: the lab request is raised on the encounter in the address, and no patient or encounter field is sent', async () => {
    api.createRecord.mockResolvedValue(labRequest())
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Create lab request' })
    change('Test code system', 'LOINC')
    change('Test code', '718-7')
    change('Test display', 'Haemoglobin')
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
    await screen.findByRole('button', { name: 'Save draft' })
    change('Medication', 'Amoxicillin')
    change('Dose quantity', '500')
    change('Dose unit', 'mg')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
    field('Instructions').focus()
    await act(async () => { fireEvent.submit(field('Instructions').closest('form')!) })
    await confirmPatient(SAVE_RX(), 'Save prescription')
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', expect.not.objectContaining({ encounter: expect.anything() }), expect.any(String))
  })

  it('06: the same values sent again after no answer are the same create (one Idempotency-Key)', async () => {
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Create lab request' })
    change('Test code system', 'LOINC')
    change('Test code', '718-7')
    change('Test display', 'Haemoglobin')
    api.createRecord.mockRejectedValueOnce(new Error('Network error'))
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect((await screen.findByRole('alert')).textContent).toBe('Record could not be saved.')
    expect(document.body.textContent).not.toContain('Network error')
    expect(screen.getByText('For this consultation')).toBeTruthy()
    api.createRecord.mockResolvedValueOnce(labRequest())
    fireEvent.click(screen.getByRole('button', { name: 'Create lab request' }))
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('06: after a save the page cannot name, the form starts again for this consultation', async () => {
    api.createRecord.mockResolvedValue({})
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const save = await screen.findByRole('button', { name: 'Create lab request' })
    change('Test code system', 'LOINC')
    change('Test code', '718-7')
    change('Test display', 'Haemoglobin')
    fireEvent.click(save)
    await confirmPatient(SAVE_LAB(), 'Save draft')
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(screen.getByText('For this consultation')).toBeTruthy()
    expect(field('Test code').value).toBe('')
  })

  it('06: New prescription says the recorded allergies above the form, and nothing while their read runs', async () => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    let answer: (value: unknown) => void = () => {}
    api.reportedHealthProfile.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save draft' })
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    noAllergyLines()
    // The read starts in an effect after the form is drawn: wait for it to be asked for before answering it.
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal)))
    await act(async () => { answer({ allergies: 'Penicillin', bloodGroup: null, genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null }) })
    const allergies = screen.getByText(ALLERGIES)
    // Between the patient banner and the form.
    expect(patientBanner().compareDocumentPosition(allergies) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(allergies.compareDocumentPosition(field('Medication')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['an answer with no allergies', () => api.reportedHealthProfile.mockResolvedValue({ allergies: null }), NONE_REPORTED],
    ['no profile', () => api.reportedHealthProfile.mockResolvedValue(null), NONE_REPORTED],
    ['an outage (503)', () => api.reportedHealthProfile.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })), ALLERGIES_UNREAD],
  ])('06: New prescription’s allergies after %s say so, as triage does, and never "None recorded"', async (_label, arrange, sentence) => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    arrange()
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText(sentence, { exact: false })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/None recorded|recorded by clinicians/)
  })

  it.each([
    ['a refusal (403)', new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' })],
    ['a route EHR does not serve (404)', new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })],
  ])('06: New prescription says the allergies can’t be shown after %s, never "none"', async (_label, refusal) => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.reportedHealthProfile.mockRejectedValue(refusal)
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save draft' })
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalled())
    expect(await screen.findByText(ALLERGIES_NOT_SHOWN)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/None recorded|: none\.|not entered any allergies/)
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
  })

  it('06: New prescription reads no allergies without ehr.note.read, as today’s chart, and says they can’t be shown', async () => {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    await screen.findByRole('button', { name: 'Save draft' })
    await act(async () => {})
    expect(api.allergies).not.toHaveBeenCalled()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(screen.getByText(ALLERGIES_NOT_SHOWN)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/None recorded|: none\./)
  })

  it('06: no form or allergies show without the write permission, under read-only access or for an emergency patient', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.lab-request.read']
    const refused = open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this order.')
    expect(screen.queryByLabelText(labelled('Test display'))).toBeNull()
    refused.unmount()
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.consentStatus.mockResolvedValue({ writeAllowed: false })
    const readOnly = open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Medication'))).toBeNull()
    noAllergyLines()
    readOnly.unmount()
    api.reportedHealthProfile.mockClear()
    staff.activePatient = activePatient('emergency')
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Medication'))).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('06: says it is checking access while the grant is asked about, with no form yet', async () => {
    api.consentStatus.mockReturnValue(new Promise(() => {}))
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    expect(await screen.findByText('Checking your access…')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Test display'))).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create lab request' })).toBeNull()
  })
})

describe('Keyboard and roles', () => {
  it('uses real buttons and links, and moves focus to the first problem', async () => {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    expect(save.getAttribute('type')).toBe('submit')
    expect(screen.getByRole('button', { name: 'Back to list' }).getAttribute('type')).toBe('button')
    await act(async () => { fireEvent.submit(save.closest('form')!) })
    expect(document.activeElement).toBe(field('Medication'))
  })
})

describe('parity: an order’s status form and its dialog say the warning', () => {
  const PHARMACY_NOT_TOLD = /^Pharmacy is not told of this change, so if this prescription was sent to Pharmacy you must contact the pharmacy\./

  it.each(['Put on hold', 'Cancel order', 'Mark entered in error'])('ties "Update status" to Pharmacy’s warning when "%s" is chosen (Clinical.tsx:617-620)', async name => {
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name }))
    const warning = screen.getByText(PHARMACY_NOT_TOLD)
    expect(warning.id).not.toBe('')
    expect(screen.getByRole('button', { name: 'Update status' }).getAttribute('aria-describedby')).toBe(warning.id)
  })

  it('ties a routed order’s change to what it does at the other facility', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3, orderRoute: route({ kind: 'prescription', effectiveState: 'accepted', acceptedAt: '2026-10-30T10:00:00.000Z', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true } }) })], [], { crossFacilityOrders: true })
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    const warning = screen.getByText(/^Changing it withdraws it from Demo Pharmacy, or cancels it there if Demo Pharmacy has accepted it/)
    expect(screen.getByRole('button', { name: 'Update status' }).getAttribute('aria-describedby')).toBe(warning.id)
    expect(screen.queryByText(PHARMACY_NOT_TOLD)).toBeNull()
  })

  it('"Cancel order?" says Pharmacy’s warning', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    change('Reason for change', 'Prescribed in error')
    fireEvent.submit(field('Reason for change').closest('form')!)
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel order?' })
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toMatch(PHARMACY_NOT_TOLD)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  it('a draft has no warning: its submit is described by nothing, and its dialog keeps the design’s sentence', async () => {
    setLists([prescription({ status: 'draft', rowVersion: 1 })], [])
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }))
    expect(screen.getByRole('button', { name: 'Update status' }).getAttribute('aria-describedby')).toBeNull()
    change('Reason for change', 'Prescribed in error')
    fireEvent.submit(field('Reason for change').closest('form')!)
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel order?' })
    expect(within(dialog).getByText('Check the details first. This changes the saved record; the change is kept in its history.')).toBeTruthy()
  })
})

/**
 * Classic keeps an order as last read when its read after a change fails, and says the change was saved but the records
 * could not be reloaded. The order's page keeps that, with "Try again" beside the sentence, as the visit page does.
 */
describe('"Try again" beside "The change was saved, but the records could not be reloaded." on an order’s page', () => {
  const sentence = () => screen.queryAllByRole('alert').find(alert => alert.textContent?.startsWith(RELOAD_FAILED)) ?? null
  const tryAgain = () => within(sentence()!).getByRole('button', { name: 'Try again' })

  /** Activates the draft prescription while EHR answers no read of it: the page says the change was saved. */
  async function activateUnread() {
    await openOrder('pharmacy', RX)
    const read = api.records.getMockImplementation()!
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    api.records.mockRejectedValue(UNAVAILABLE())
    submitWith('Reason for change')
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()).not.toBeNull())
    // EHR now holds it active; the page shows the draft it last read.
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    return read
  }

  it('is offered only beside that sentence, once, in its alert: never on opening, nor beside another failure', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // Pharmacy did not take it, and the order's read after that failed: the page says only that, in today's words.
    api.acceptPrescription.mockRejectedValueOnce(new HidApiError(409, 'Not eligible', { code: 'PHARMACY_PRESCRIPTION_NOT_ELIGIBLE' }))
    api.records.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    submitWith('Reason')
    expect(await screen.findByText('This prescription no longer matches what was sent (it was changed, put on hold or cancelled meanwhile), so Pharmacy '
      + 'did not accept it. The list could not be reloaded; refresh it to see the prescription.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // A status change whose read fails: the sentence, with Try again beside it.
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    change('Reason for change', 'Waiting for results')
    submitWith('Reason for change')
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()).not.toBeNull())
    expect(sentence()!.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}Try again`)
    expect(screen.getAllByRole('button', { name: 'Try again' })).toEqual([tryAgain()])
  })

  it('reads the order again fresh, without an access re-check: it shows its new status, the sentence goes, and focus goes to Actions', async () => {
    const read = await activateUnread()
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
    api.records.mockImplementation(read)
    const reads = api.records.mock.calls.length
    const checks = api.lookupPatient.mock.calls.length
    const button = tryAgain()
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(sentence()).toBeNull())
    expect(api.records.mock.calls.slice(reads)).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true }]])
    expect(api.lookupPatient.mock.calls.length).toBe(checks)
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.queryByText('Draft')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Put on hold' }).getAttribute('aria-disabled')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // What the change said stays said.
    expect(screen.getByText('Prescription status updated.')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Actions')
  })

  it('keeps the sentence, said anew, and the order as last read, when Try again fails too; a later one that succeeds clears it', async () => {
    const read = await activateUnread()
    const before = sentence()!.querySelector('p')!
    const button = tryAgain()
    button.focus()
    const reads = api.records.mock.calls.length
    fireEvent.click(button)
    await waitFor(() => expect(api.records.mock.calls.length).toBe(reads + 1))
    await waitFor(() => expect(button.getAttribute('aria-busy')).toBeNull())
    expect(screen.getAllByRole('alert').filter(alert => alert.textContent?.startsWith(RELOAD_FAILED))).toHaveLength(1)
    expect(sentence()!.querySelector('p')).not.toBe(before)
    expect(sentence()!.querySelector('p')!.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}`)
    expect(tryAgain()).toBe(button)
    expect(document.activeElement).toBe(button)
    expect(screen.getByText('Draft')).toBeTruthy()
    api.records.mockImplementation(read)
    fireEvent.click(button)
    await waitFor(() => expect(sentence()).toBeNull())
    expect(screen.getByText('Active')).toBeTruthy()
  })

  it('says it is busy while it reads, keeping focus, and a second press reads nothing more; no status change starts meanwhile', async () => {
    const read = await activateUnread()
    const held = deferred<void>()
    api.records.mockImplementation(async (...args: Parameters<typeof read>) => { await held.promise; return read(...args) })
    const button = tryAgain()
    button.focus()
    fireEvent.click(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true }))
    const reads = api.records.mock.calls.length
    fireEvent.click(button)
    await act(async () => {})
    expect(api.records.mock.calls.length).toBe(reads)
    // The sentence stays while it reads, and no change starts from the version shown.
    expect(sentence()).not.toBeNull()
    expect(document.activeElement).toBe(button)
    expect(screen.getByRole('button', { name: 'Cancel order' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => held.answer())
    await waitFor(() => expect(sentence()).toBeNull())
    expect(document.activeElement?.textContent).toBe('Actions')
  })

  it('leaves focus where it was moved while Try again reads: only focus on Try again, or on nothing, goes to Actions', async () => {
    const read = await activateUnread()
    const held = deferred<void>()
    api.records.mockImplementation(async (...args: Parameters<typeof read>) => { await held.promise; return read(...args) })
    const button = tryAgain()
    button.focus()
    fireEvent.click(button)
    const back = screen.getByRole('button', { name: 'Back to consultation' })
    back.focus()
    await act(async () => held.answer())
    await waitFor(() => expect(sentence()).toBeNull())
    expect(screen.getByText('Active')).toBeTruthy()
    expect(document.activeElement).toBe(back)
  })

  it('keeps the outcome of a change made while Try again reads: a later failure of that read does not bring the sentence back', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([], [labRequest({ status: 'active', rowVersion: 2, orderRoute: route() })], { crossFacilityOrders: true })
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    change('Reason for change', 'Waiting for the patient')
    api.records.mockRejectedValue(UNAVAILABLE())
    submitWith('Reason for change')
    expect(await screen.findByText('Lab request status updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()).not.toBeNull())
    const held = deferred<void>()
    api.records.mockImplementation(async () => { await held.promise; throw UNAVAILABLE() })
    fireEvent.click(tryAgain())
    const WITHDRAW_REFUSED = 'Your role at this facility can’t withdraw orders sent to other facilities.'
    // Meanwhile a withdrawal is refused: the page says that change's own outcome.
    routes.withdraw.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))
    fireEvent.change(field('Withdraw it from Demo Laboratory'), { target: { value: 'patient_request' } })
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(await screen.findByText(WITHDRAW_REFUSED)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Forbidden')
    expect(sentence()).toBeNull()
    await act(async () => held.answer())
    await act(async () => {})
    expect(sentence()).toBeNull()
    expect(screen.getByText(WITHDRAW_REFUSED)).toBeTruthy()
  })

  it('after a create whose order could not be read, reads it again and shows it, the create’s outcome still said', async () => {
    const read = api.records.getMockImplementation()!
    api.records.mockRejectedValue(UNAVAILABLE())
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    const save = await screen.findByRole('button', { name: 'Save draft' })
    change('Medication', 'Amoxicillin')
    change('Dose quantity', '500')
    change('Dose unit', 'mg')
    change('Frequency', 'Twice daily')
    change('Instructions', 'After meals')
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(), 'Save prescription')
    await waitFor(() => expect(sentence()?.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}Try again`))
    expect(screen.getAllByRole('button', { name: 'Try again' })).toEqual([tryAgain()])
    expect(screen.getByText('Clinical record saved.')).toBeTruthy()
    api.records.mockImplementation(read)
    const reads = api.records.mock.calls.length
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(tryAgain())
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
    expect(sentence()).toBeNull()
    expect(api.records.mock.calls.slice(reads)).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions', { cursor: undefined, fresh: true }]])
    expect(api.lookupPatient.mock.calls.length).toBe(checks)
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(screen.getByText('Clinical record saved.')).toBeTruthy()
  })
})


/**
 * The allergy warning at prescribing (hid-system#218 at 7fbb04aa; an EHR at 76283f57 where it differs): the check's
 * answer and the 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED in the EHR's own format, word for word. Every id, token, name and
 * date is fictional.
 */
const TOKEN_A = 'a'.repeat(64)
const TOKEN_B = 'b'.repeat(64)
const TOKEN_C = 'c'.repeat(64)
const ALLERGY_1 = 'a1240000-0000-4000-8000-000000000001'
const ALLERGY_2 = 'a1240000-0000-4000-8000-000000000002'
const ALLERGY_3 = 'a1240000-0000-4000-8000-000000000003'

const SEVERE_PENICILLIN = {
  source: 'recorded', allergyId: ALLERGY_1, allergyIds: [ALLERGY_1, ALLERGY_3], substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe',
  matchKind: 'same_class', className: 'penicillins', recordedHere: true, recordedOn: '2026-04-20T10:00:00.000Z',
  message: 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by clinicians (recorded at 2 facilities), most recently on 20 Apr 2026.',
}
const MILD_PENICILLIN = {
  source: 'recorded', allergyId: ALLERGY_2, allergyIds: [ALLERGY_2], substance: 'Penicillin', reaction: 'Rash', severity: 'mild',
  matchKind: 'same_class', className: 'penicillins', recordedHere: false, recordedOn: '2026-02-10T23:30:00.000Z',
  message: 'Penicillin allergy: mild (Rash). This medicine is one of the penicillins, the same group. Recorded by a clinician at another facility on 11 Feb 2026.',
}
/** A term the patient wrote in their Health ID portal (a brand of the same medicine). */
const AUGMENTIN_TERM = {
  source: 'patient_reported', substance: 'Augmentin', reaction: null, severity: null, matchKind: 'same_medicine',
  message: 'Patient-reported allergy: “Augmentin”. This medicine may be, or may contain, the same medicine. Entered by the patient in their Health ID portal, not checked by a clinician.',
}
/** A term the patient added later. */
const AMOXIL_TERM = {
  source: 'patient_reported', substance: 'Amoxil', reaction: null, severity: null, matchKind: 'same_medicine',
  message: 'Patient-reported allergy: “Amoxil”. This medicine may be, or may contain, the same medicine. Entered by the patient in their Health ID portal, not checked by a clinician.',
}

const REQUIRED_DETAIL = 'This medicine may match an allergy on the patient\'s record. Check the allergies and give a reason to go ahead.'
const CHANGED_DETAIL = 'The allergy warning changed since it was shown. Check the allergies again and give a reason to go ahead.'
const NOT_ACCEPTED_DETAIL = 'The reason to go ahead after the allergy warning was not accepted. Check the allergies and give a reason to go ahead.'
const MISSING = 'ALLERGY_ACKNOWLEDGEMENT_MISSING'
const REASON_MISSING = 'ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING'
const REASON_INVALID = 'ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'
const TOKEN_INVALID = 'ALLERGY_WARNING_TOKEN_INVALID'
const TOKEN_STALE = 'ALLERGY_WARNING_TOKEN_STALE'
/** The EHR's own sentence for each refused part (7fbb04aa): never shown, the code is read. */
const REJECTED_SENTENCES: Readonly<Record<string, string>> = {
  [MISSING]: 'Check the allergies and give a reason to go ahead.',
  [REASON_MISSING]: 'Give a reason to go ahead with this medicine.',
  [REASON_INVALID]: 'The reason must be 10 to 500 characters, with at least one word, and no control characters other than new lines.',
  [TOKEN_INVALID]: 'The allergy warning was not identified. Check the allergies again.',
  [TOKEN_STALE]: CHANGED_DETAIL,
}

/** The allergy check's answer: a token on every answer, a match or not. */
function checkAnswer(matches: readonly object[], warningToken: string) {
  return { matches, acknowledgementRequired: matches.length > 0, warningToken }
}

/**
 * The EHR's 409 at 7fbb04aa as the http client gives it: one errors entry per match, the token's, then one per refused
 * part (allergyAcknowledgement.rejected) with its code, the reason's before the token's.
 */
function rejectedRefusal(matches: readonly { message: string }[], token: string, codes: readonly string[]) {
  const detail = codes.includes(TOKEN_STALE) ? CHANGED_DETAIL : codes.length === 1 && codes[0] === MISSING ? REQUIRED_DETAIL : NOT_ACCEPTED_DETAIL
  return new HidApiError(409, detail, {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail,
    details: [...matches.map(match => ({ field: 'allergyAcknowledgement', messages: [match.message] })),
      { field: 'allergyAcknowledgement.warningToken', messages: [token] },
      ...codes.map(code => ({ field: 'allergyAcknowledgement.rejected', code, messages: [REJECTED_SENTENCES[code]] }))],
  })
}

/** The first warning (none sent), or, `changed`, a token for another warning (a stale one). */
function allergyRefused(matches: readonly { message: string }[], token: string, changed = false) {
  return rejectedRefusal(matches, token, [changed ? TOKEN_STALE : MISSING])
}

/** The same 409 from an EHR at 76283f57: no refused part named (only the detail, never read, says "changed"). */
function legacyRefused(matches: readonly { message: string }[], token: string, changed = false) {
  const detail = changed ? CHANGED_DETAIL : REQUIRED_DETAIL
  return new HidApiError(409, detail, {
    code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail,
    details: [...matches.map(match => ({ field: 'allergyAcknowledgement', messages: [match.message] })),
      { field: 'allergyAcknowledgement.warningToken', messages: [token] }],
  })
}

const REASON_LABEL = 'Why is it safe to go ahead?'
const GOOD_REASON = 'Tolerated amoxicillin in 2025 with no reaction; observe for 30 minutes.'
/** A reason written again, for a warning that changed since the first was read. */
const NEW_REASON = 'Checked the new allergy with the patient; first dose under observation.'
/** The EHR's 400 when it did not accept the acknowledgement (it does not say which part). */
const ACK_400 = () => new HidApiError(400, 'One or more request fields are invalid.', {
  code: 'VALIDATION_FAILED', details: [{ field: 'allergyAcknowledgement', messages: [] }],
})

function warningPanel(name: string) {
  return screen.getByRole('region', { name })
}

function lines(panel: HTMLElement) {
  return within(panel).getAllByRole('listitem').map(item => item.textContent)
}

function tickBox() {
  return screen.getByRole('checkbox', { name: /^I have checked (this allergy|these allergies) with the patient/ }) as HTMLInputElement
}

function ackReason() {
  return screen.getByRole('textbox', { name: REASON_LABEL }) as HTMLTextAreaElement
}

function giveReason(text: string) {
  fireEvent.change(ackReason(), { target: { value: text } })
}

/** Nothing the EHR said in its own words is on the screen. */
function noServerWords() {
  expect(document.body.textContent).not.toContain('Check the allergies')
  expect(document.body.textContent).not.toContain(TOKEN_A)
  expect(document.body.textContent).not.toContain(TOKEN_B)
  for (const sentence of Object.values(REJECTED_SENTENCES)) expect(document.body.textContent).not.toContain(sentence)
}

describe('Allergies on a new prescription (hid-system 0124)', () => {
  const recordedPenicillin = { id: 'a1240000-0000-4000-8000-000000000011', substance: 'Penicillin', reaction: 'Hives',
    severity: 'severe' as const, status: 'active' as const, rowVersion: '1', createdAt: null, enteredInErrorReason: null, recordedHere: true }
  const recordedLatex = { id: 'a1240000-0000-4000-8000-000000000012', substance: 'Latex', reaction: null,
    severity: 'unknown' as const, status: 'active' as const, rowVersion: '1', createdAt: null, enteredInErrorReason: null, recordedHere: false }
  const MEDICINE = 'Amoxicillin 500 mg'
  const SAVE_WARNED = (medicine = MEDICINE) => `${SAVE_RX(medicine)} It may match an allergy. Your reason for going ahead will be saved with it.`

  beforeEach(() => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.allergies.mockResolvedValue({ recorded: [recordedPenicillin, recordedLatex], patientReported: { allergies: 'Peanuts', updatedAt: null } })
  })

  async function form() {
    open(`${ENCOUNTER_ID}/orders/new/pharmacy`)
    return screen.findByRole('button', { name: 'Save draft' })
  }

  function fill(medicine = MEDICINE) {
    change('Medication', medicine)
    change('Frequency', 'Three times daily')
    change('Instructions', 'After meals')
  }

  const BODY = { medicationDisplay: MEDICINE, doseQuantity: undefined, doseUnit: undefined, routeCode: undefined,
    frequency: 'Three times daily', instructions: 'After meals', status: 'draft' }

  function sentBody(call: number) {
    return api.createRecord.mock.calls[call]![4] as Record<string, unknown>
  }

  /** Save draft over a warning, the patient confirmed: refused at the form, the tick and the reason each with its own error. */
  async function saveRefused({ tick, reason, count = 1 }: { tick: boolean; reason: string | null; count?: number }) {
    const calls = api.createRecord.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(ALLERGY_GO_AHEAD_ERROR))
    if (tick) {
      expect(screen.getByText(tickError(count))).toBeTruthy()
      expect(tickBox().getAttribute('aria-invalid')).toBe('true')
    } else {
      expect(screen.queryByText(tickError(count))).toBeNull()
      expect(tickBox().getAttribute('aria-invalid')).toBeNull()
    }
    for (const said of [ACK_REASON_SHORT, ACK_REASON_NO_WORD, ACK_REASON_LONG]) {
      if (said === reason) expect(screen.getByText(said)).toBeTruthy()
      else expect(screen.queryByText(said)).toBeNull()
    }
    expect(ackReason().getAttribute('aria-invalid')).toBe(reason ? 'true' : null)
    // The first answer refused takes focus, so its own error is read: the tick, else the reason.
    if (tick) expect(document.activeElement).toBe(tickBox())
    else if (reason) expect(document.activeElement).toBe(ackReason())
    expect(api.createRecord).toHaveBeenCalledTimes(calls)
  }

  it('shows the recorded allergies (the EHR’s order, most serious first) and the patient’s apart, and that no warning is not safe', async () => {
    await form()
    expect(await screen.findByText('Allergies recorded by clinicians: Penicillin (severe: Hives); Latex (severity not known).')).toBeTruthy()
    expect(screen.getByText('Allergies reported by the patient: Peanuts (entered by the patient in their Health ID portal, not clinically verified).')).toBeTruthy()
    expect(screen.getByText(NO_WARNING_NOT_SAFE)).toBeTruthy()
    expect(screen.queryByText(/^Recorded allergies/)).toBeNull()
  })

  it('warns before saving, titles a severe match, and saves only with the tick and a real reason, sending { reason, warningToken }', async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([MILD_PENICILLIN, AUGMENTIN_TERM, SEVERE_PENICILLIN], TOKEN_A))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    expect(api.allergyCheck).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: MEDICINE })
    expect(api.createRecord).not.toHaveBeenCalled()
    // The EHR's sentences whole, the most serious first; a grouped line is one line; nothing is added beside them.
    const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
    expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message, MILD_PENICILLIN.message, AUGMENTIN_TERM.message])
    expect(within(panel).queryByText('Severe')).toBeNull()
    expect(within(panel).queryByText(/Reaction:/)).toBeNull()
    expect(tickBox().checked).toBe(false)
    expect(screen.getByRole('checkbox', { name: tickLabel(MEDICINE, 3) })).toBeTruthy()
    expect(ackReason().tagName).toBe('TEXTAREA')
    expect(screen.getByText(ACK_REASON_HINT)).toBeTruthy()
    noServerWords()

    // The tick and the reason are each required, each with its own error; a reason needs 10 characters and a real word.
    await saveRefused({ tick: true, reason: ACK_REASON_SHORT, count: 3 })
    fireEvent.click(tickBox())
    await saveRefused({ tick: false, reason: ACK_REASON_SHORT, count: 3 })
    giveReason('ok')
    await saveRefused({ tick: false, reason: ACK_REASON_SHORT, count: 3 })
    giveReason('1234567890')
    await saveRefused({ tick: false, reason: ACK_REASON_NO_WORD, count: 3 })
    giveReason('ok ok ok ok ok')
    await saveRefused({ tick: false, reason: ACK_REASON_NO_WORD, count: 3 })
    giveReason(`Tolerated ${'x'.repeat(491)}`)
    await saveRefused({ tick: false, reason: ACK_REASON_LONG, count: 3 })
    fireEvent.click(tickBox())
    giveReason(`  ${GOOD_REASON}  `)
    await saveRefused({ tick: true, reason: null, count: 3 })

    fireEvent.click(tickBox())
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(sentBody(0)).toEqual({ ...BODY, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_A } })
    expect(api.allergyCheck).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { level: 1, name: 'Amoxicillin' })).toBeTruthy()
  })

  it('sends no acknowledgement when the check finds nothing, though its answer has a token', async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([], TOKEN_A))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(sentBody(0)).toEqual(BODY)
    expect('allergyAcknowledgement' in sentBody(0)).toBe(false)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
  })

  it('drops the warning, the tick, the reason and the token as soon as the medicine is edited, and checks the new one', async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    expect(await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })).toBeTruthy()
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    // Spaces round the name are the same medicine: the warning stays.
    change('Medication', `${MEDICINE} `)
    expect(tickBox().checked).toBe(true)
    // Another medicine: gone at once, before anything is saved.
    change('Medication', 'Paracetamol 500 mg')
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(screen.queryByRole('textbox', { name: REASON_LABEL })).toBeNull()
    // Back to the first medicine: nothing comes back; it is checked again.
    change('Medication', MEDICINE)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    change('Medication', 'Paracetamol 500 mg')
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([], TOKEN_C))
    fireEvent.click(save)
    await confirmPatient(SAVE_RX('Paracetamol 500 mg'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.allergyCheck).toHaveBeenCalledTimes(2)
    expect(api.allergyCheck).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Paracetamol 500 mg' })
    expect(sentBody(0)).toEqual({ ...BODY, medicationDisplay: 'Paracetamol 500 mg' })
  })

  it('never shows a late answer for a medicine since changed, and saves nothing on it', async () => {
    let answer: (value: unknown) => void = () => undefined
    api.allergyCheck.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await waitFor(() => expect(api.allergyCheck).toHaveBeenCalledTimes(1))
    // The prescriber changes the medicine while the first is still being checked; then its answer comes.
    change('Medication', 'Paracetamol 500 mg')
    await act(async () => { answer(checkAnswer([SEVERE_PENICILLIN], TOKEN_A)) })
    expect((await screen.findByRole('alert')).textContent).toBe(MEDICINE_CHANGED_ERROR)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    // Saved again, the new medicine is checked, and saved with no acknowledgement.
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([], TOKEN_C))
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_RX('Paracetamol 500 mg'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.allergyCheck).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Paracetamol 500 mg' })
    expect(sentBody(0)).toEqual({ ...BODY, medicationDisplay: 'Paracetamol 500 mg' })
  })

  it('on a 409 that says the warning changed since it was shown: the new warning, the box unticked, and the retry with the new token', async () => {
    api.allergyCheck
      .mockResolvedValueOnce(checkAnswer([MILD_PENICILLIN], TOKEN_A))
      .mockResolvedValueOnce(checkAnswer([MILD_PENICILLIN, SEVERE_PENICILLIN], TOKEN_B))
    api.createRecord.mockRejectedValueOnce(allergyRefused([MILD_PENICILLIN, SEVERE_PENICILLIN], TOKEN_B, true))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    expect(await screen.findByRole('region', { name: `Allergy warning for ${MEDICINE}` })).toBeTruthy()
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_CHANGED_ERROR)
    expect(sentBody(0).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_A })
    // The new warning (from the check run after it, for each line's severity), said to have changed; the box unticked.
    const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
    expect(within(panel).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message, MILD_PENICILLIN.message])
    expect(tickBox().checked).toBe(false)
    // The reason was written for the older warning: emptied, to be written for this one (Ola, bypass #3).
    expect(ackReason().value).toBe('')
    expect(api.allergyCheck).toHaveBeenCalledTimes(2)
    noServerWords()
    expect(document.body.textContent).not.toContain(CHANGED_DETAIL)
    // Unticked and with no reason, it is refused at the form; ticked again with a reason, it goes with the new token.
    await saveRefused({ tick: true, reason: ACK_REASON_SHORT, count: 2 })
    fireEvent.click(tickBox())
    giveReason(NEW_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: NEW_REASON, warningToken: TOKEN_B })
    // Another body is another create (the EHR's digest covers the acknowledgement).
    expect(api.createRecord.mock.calls[1]![5]).not.toBe(api.createRecord.mock.calls[0]![5])
    expect(api.allergyCheck).toHaveBeenCalledTimes(2)
  })

  it('on a 409 when the check could not be read: the EHR’s own sentences, the severe title from them, and their token', async () => {
    api.allergyCheck.mockRejectedValue(new HidApiError(503, 'Unavailable'))
    api.createRecord.mockRejectedValueOnce(allergyRefused([AUGMENTIN_TERM, SEVERE_PENICILLIN], TOKEN_B))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    expect('allergyAcknowledgement' in sentBody(0)).toBe(false)
    const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
    // In the EHR's order (a 409 alone gives nothing to order them by); not said to have changed (none was sent).
    expect(lines(panel)).toEqual([AUGMENTIN_TERM.message, SEVERE_PENICILLIN.message])
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    noServerWords()
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_B })
  })

  it('says on the reason when the EHR did not accept it, keeping the warning', async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'allergyAcknowledgement', messages: [] }],
    }))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ACK_REFUSED_ERROR)
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(ackReason().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })).toBeTruthy()
    expect(document.body.textContent).not.toContain('request fields are invalid')
  })

  it('saves as before when the EHR has no allergy check (404, before 0124), sending no acknowledgement', async () => {
    api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
    api.allergyCheck.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
    const save = await form()
    expect(await screen.findByText(`${NOTHING_REPORTED} Confirm allergies with the patient.`)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/None recorded|recorded by clinicians/)
    // The EHR checks nothing here, so the form does not say it does.
    expect(screen.queryByText(NO_WARNING_NOT_SAFE)).toBeNull()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(sentBody(0)).toEqual(BODY)
    expect('allergyAcknowledgement' in sentBody(0)).toBe(false)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
  })

  it('never shows a late 409 for a medicine since changed: nothing is shown or acknowledged, and the new medicine is checked', async () => {
    let refuse: (reason: unknown) => void = () => undefined
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([], TOKEN_A)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    api.createRecord.mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject }))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    // The prescriber changes the medicine while the save is out; then the EHR refuses it for the first medicine.
    change('Medication', 'Paracetamol 500 mg')
    await act(async () => { refuse(allergyRefused([SEVERE_PENICILLIN], TOKEN_B)) })
    expect((await screen.findByRole('alert')).textContent).toBe(MEDICINE_CHANGED_ERROR)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(document.body.textContent).not.toContain(`for ${MEDICINE}`)
    // Saved again: the new medicine is checked, and saved with no acknowledgement (no token of the old one).
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([], TOKEN_C))
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_RX('Paracetamol 500 mg'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(api.allergyCheck).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Paracetamol 500 mg' })
    expect(sentBody(1)).toEqual({ ...BODY, medicationDisplay: 'Paracetamol 500 mg' })
  })

  it('on a 409 with no token it can read, and no check after it: says the warning could not be loaded, drops the old one, and sends no old token', async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A)).mockRejectedValue(new HidApiError(503, 'Unavailable'))
    // The EHR's 409 with its sentences but no allergyAcknowledgement.warningToken entry.
    api.createRecord.mockRejectedValueOnce(new HidApiError(409, REQUIRED_DETAIL, {
      code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED', detail: REQUIRED_DETAIL,
      details: [{ field: 'allergyAcknowledgement', messages: [SEVERE_PENICILLIN.message] }],
    }))
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_WARNING_UNREAD)
    expect(sentBody(0).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_A })
    // The older warning, its tick, reason and token are gone: none of them can be sent again.
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    noServerWords()
    // The next save checks again (it fails) and goes with no acknowledgement, for the EHR to warn afresh.
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect('allergyAcknowledgement' in sentBody(1)).toBe(false)
  })

  it('a save over a warning that comes back with no id clears the form and the warning, ready for the next prescription', async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
    api.createRecord.mockResolvedValueOnce({})
    const save = await form()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(sentBody(0).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_A })
    expect(field('Medication').value).toBe('')
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(screen.queryByRole('textbox', { name: REASON_LABEL })).toBeNull()
    // The next prescription is checked afresh, and saved with no acknowledgement when nothing matches.
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([], TOKEN_C))
    fill('Paracetamol 500 mg')
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_RX('Paracetamol 500 mg'), 'Save prescription')
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(sentBody(1)).toEqual({ ...BODY, medicationDisplay: 'Paracetamol 500 mg' })
  })

  it('reads the allergies above the form again whenever a warning is shown, so they never miss one the warning names', async () => {
    api.allergies
      .mockResolvedValueOnce({ recorded: [recordedLatex], patientReported: { allergies: null, updatedAt: null } })
      .mockResolvedValueOnce({ recorded: [recordedPenicillin, recordedLatex], patientReported: { allergies: null, updatedAt: null } })
      .mockResolvedValueOnce({ recorded: [recordedPenicillin, recordedLatex], patientReported: { allergies: 'Augmentin', updatedAt: null } })
    api.allergyCheck
      .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
      .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B))
    api.createRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B, true))
    const save = await form()
    expect(await screen.findByText('Allergies recorded by clinicians: Latex (severity not known).')).toBeTruthy()
    fill()
    fireEvent.click(save)
    await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
    // The warning from the check: the allergy recorded since the form opened is in the lines too.
    await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })
    expect(await screen.findByText('Allergies recorded by clinicians: Penicillin (severe: Hives); Latex (severity not known).')).toBeTruthy()
    expect(api.allergies).toHaveBeenCalledTimes(2)
    // The warning from the EHR's 409: read again too.
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await confirmPatient(SAVE_WARNED(), 'Save prescription')
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_CHANGED_ERROR)
    expect(await screen.findByText('Allergies reported by the patient: Augmentin (entered by the patient in their Health ID portal, not clinically verified).')).toBeTruthy()
    expect(api.allergies).toHaveBeenCalledTimes(3)
  })

  describe('the part the EHR refused (7fbb04aa: allergyAcknowledgement.rejected, read by its code)', () => {
    /** The check's warning, ticked, with a reason, saved; the save refused with `refusal`. Answers the form's error. */
    async function saveOver(refusal: HidApiError) {
      api.createRecord.mockRejectedValueOnce(refusal)
      const save = await form()
      fill()
      fireEvent.click(save)
      await confirmPatient(SAVE_RX(MEDICINE), 'Save prescription')
      await screen.findByRole('region', { name: `Severe allergy warning for ${MEDICINE}` })
      fireEvent.click(tickBox())
      giveReason(GOOD_REASON)
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
      await confirmPatient(SAVE_WARNED(), 'Save prescription')
      await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
      expect(sentBody(0).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_A })
      return (await screen.findByRole('alert')).textContent
    }

    async function saveAgain(count: number) {
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
      await confirmPatient(SAVE_WARNED(), 'Save prescription')
      await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(count))
    }

    it.each([
      [REASON_INVALID, ACK_NOT_ACCEPTED],
      [REASON_MISSING, ACK_REASON_SHORT],
    ])('%s: the warning did not change, so it stays ticked with its token; the reason as written is marked and takes focus', async (code, said) => {
      api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
      expect(await saveOver(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_A, [code]))).toBe(ACK_REFUSED_ERROR)
      const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
      expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message])
      // Not "changed": the reason was refused, not the warning.
      expect(within(panel).queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
      expect(tickBox().checked).toBe(true)
      expect(ackReason().value).toBe(GOOD_REASON)
      expect(screen.getByText(said)).toBeTruthy()
      expect(ackReason().getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(ackReason())
      expect(tickBox().getAttribute('aria-invalid')).toBeNull()
      // Nothing is checked again: the warning shown is the EHR's current one.
      expect(api.allergyCheck).toHaveBeenCalledTimes(1)
      noServerWords()
      giveReason(NEW_REASON)
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: NEW_REASON, warningToken: TOKEN_A })
    })

    it(`${TOKEN_INVALID}: the warning stays, with the 409’s token, unticked; the reason stays, and the prescriber is asked to tick again`, async () => {
      api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
      expect(await saveOver(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_B, [TOKEN_INVALID]))).toBe(ALLERGY_TICK_AGAIN_ERROR)
      const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
      expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message])
      expect(within(panel).queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
      expect(tickBox().checked).toBe(false)
      expect(ackReason().value).toBe(GOOD_REASON)
      expect(ackReason().getAttribute('aria-invalid')).toBeNull()
      noServerWords()
      fireEvent.click(tickBox())
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_B })
    })

    it(`${TOKEN_INVALID} for the very warning ticked (the same token again): the box is unticked all the same`, async () => {
      // The page sends only a token it was given, so a refusal for it names the same warning: nothing but the refusal
      // itself unticks the box here.
      api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
      expect(await saveOver(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_A, [TOKEN_INVALID]))).toBe(ALLERGY_TICK_AGAIN_ERROR)
      expect(lines(warningPanel(`Severe allergy warning for ${MEDICINE}`))).toEqual([SEVERE_PENICILLIN.message])
      expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
      expect(tickBox().checked).toBe(false)
      expect(ackReason().value).toBe(GOOD_REASON)
      fireEvent.click(tickBox())
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: GOOD_REASON, warningToken: TOKEN_A })
    })

    it('a reason and a token refused together: unticked, the reason kept and marked, and both said', async () => {
      api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
      expect(await saveOver(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_B, [REASON_INVALID, TOKEN_INVALID]))).toBe(ALLERGY_TICK_AND_REASON_ERROR)
      expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
      expect(tickBox().checked).toBe(false)
      expect(ackReason().value).toBe(GOOD_REASON)
      expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
      expect(document.activeElement).toBe(ackReason())
      noServerWords()
      fireEvent.click(tickBox())
      giveReason(NEW_REASON)
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: NEW_REASON, warningToken: TOKEN_B })
    })

    it(`${TOKEN_STALE} wins over a reason refused with it: the new warning, said to have changed, unticked, and the reason emptied`, async () => {
      api.allergyCheck
        .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
        .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B))
      expect(await saveOver(rejectedRefusal([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B, [REASON_INVALID, TOKEN_STALE]))).toBe(ALLERGY_CHANGED_ERROR)
      const panel = warningPanel(`Severe allergy warning for ${MEDICINE}`)
      expect(within(panel).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
      expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message, AUGMENTIN_TERM.message])
      expect(tickBox().checked).toBe(false)
      expect(ackReason().value).toBe('')
      expect(screen.queryByText(ACK_NOT_ACCEPTED)).toBeNull()
      noServerWords()
      fireEvent.click(tickBox())
      giveReason(NEW_REASON)
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: NEW_REASON, warningToken: TOKEN_B })
    })

    it('from an EHR at 76283f57 (no refused part named): a refused save that carried a reason reads as changed, as before', async () => {
      api.allergyCheck
        .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_A))
        .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B))
      expect(await saveOver(legacyRefused([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B, true))).toBe(ALLERGY_CHANGED_ERROR)
      expect(within(warningPanel(`Severe allergy warning for ${MEDICINE}`)).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
      expect(tickBox().checked).toBe(false)
      expect(ackReason().value).toBe('')
      fireEvent.click(tickBox())
      giveReason(NEW_REASON)
      await saveAgain(2)
      expect(sentBody(1).allergyAcknowledgement).toEqual({ reason: NEW_REASON, warningToken: TOKEN_B })
    })
  })
})

describe('Allergies on Activate and Resume (hid-system 0124)', () => {
  const CHANGE = { expectedRowVersion: 1, changeReason: 'Treatment starts today', status: 'active' }

  function submitStatus() {
    fireEvent.submit(field('Reason for change').closest('form')!)
  }

  function patched(call: number) {
    return api.updateRecord.mock.calls[call]![5] as Record<string, unknown>
  }

  it('Activate: sent first with no acknowledgement; on the EHR’s 409 the warning, then the same change with the tick, a reason and its token', async () => {
    api.updateRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B))
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    // Not checked first: the EHR knows the reasons already given for this prescription; the check does not.
    expect(patched(0)).toEqual(CHANGE)
    expect(api.updateRecord.mock.invocationCallOrder[0]!).toBeLessThan(api.allergyCheck.mock.invocationCallOrder[0]!)
    // The check is run for the medicine the prescription holds, for the title and the order of the lines.
    expect(api.allergyCheck).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Amoxicillin' })
    const panel = warningPanel('Severe allergy warning for Amoxicillin')
    expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message])
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { level: 3 }))
    // The reason for the change and the reason to go ahead are apart.
    expect(field('Reason for change').value).toBe('Treatment starts today')
    expect(ackReason().value).toBe('')
    noServerWords()

    // Without the tick and a reason, nothing is sent; the tick takes focus, then the reason, each read with its error.
    submitStatus()
    await waitFor(() => expect(screen.getByText(tickError(1))).toBeTruthy())
    expect(screen.getByText(ACK_REASON_SHORT)).toBeTruthy()
    expect(document.activeElement).toBe(tickBox())
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
    giveReason('1234567890')
    fireEvent.click(tickBox())
    submitStatus()
    await waitFor(() => expect(screen.getByText(ACK_REASON_NO_WORD)).toBeTruthy())
    expect(screen.queryByText(tickError(1))).toBeNull()
    expect(document.activeElement).toBe(ackReason())
    expect(api.updateRecord).toHaveBeenCalledTimes(1)

    giveReason(GOOD_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(1)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
    expect(await screen.findByRole('button', { name: 'Put on hold' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
  })

  it('Activate after the patient added a term to their own text: warned for it, and warned again, unticked, when it changed before the retry', async () => {
    // The recorded allergy was acknowledged when the draft was saved; the patient wrote "Augmentin" since, then "Amoxil".
    api.updateRecord
      .mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B))
      .mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN, AUGMENTIN_TERM, AMOXIL_TERM], TOKEN_C, true))
    api.allergyCheck
      .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_B))
      .mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM, AMOXIL_TERM], TOKEN_C))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    const panel = await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message, AUGMENTIN_TERM.message])
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    submitStatus()
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_CHANGED_ERROR)
    expect(patched(1)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
    const changed = warningPanel('Severe allergy warning for Amoxicillin')
    expect(within(changed).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect(lines(changed)).toEqual([SEVERE_PENICILLIN.message, AUGMENTIN_TERM.message, AMOXIL_TERM.message])
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe('')
    expect(field('Reason for change').value).toBe('Treatment starts today')
    expect(document.body.textContent).not.toContain(CHANGED_DETAIL)
    fireEvent.click(tickBox())
    giveReason(NEW_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(2)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: NEW_REASON, warningToken: TOKEN_C } })
  })

  it('Resume (on hold): the warning from the 409 alone when the check fails, Pharmacy’s notice kept, then resumed with the reason', async () => {
    setLists([prescription({ status: 'on_hold', rowVersion: 4 })], [])
    api.updateRecord.mockRejectedValueOnce(allergyRefused([AUGMENTIN_TERM], TOKEN_B))
    api.allergyCheck.mockRejectedValue(new HidApiError(503, 'Unavailable'))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(screen.getByText(PHARMACY_NOT_TOLD)).toBeTruthy()
    change('Reason for change', 'Results are back')
    submitStatus()
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    expect(patched(0)).toEqual({ expectedRowVersion: 4, changeReason: 'Results are back', status: 'active' })
    // A patient-reported line is never "severe".
    expect(lines(warningPanel('Allergy warning for Amoxicillin'))).toEqual([AUGMENTIN_TERM.message])
    expect(screen.getByText(PHARMACY_NOT_TOLD)).toBeTruthy()
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    setLists([prescription({ status: 'active', rowVersion: 5 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(1)).toEqual({ expectedRowVersion: 4, changeReason: 'Results are back', status: 'active',
      allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
  })

  it('closing the form after the warning leaves the order as it was, and the form opened again has no warning', async () => {
    api.updateRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B))
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await openOrder('pharmacy', RX)
    const activate = screen.getByRole('button', { name: 'Activate' })
    fireEvent.click(activate)
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(activate)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Draft')).toBeTruthy()
    // Opened again: no warning, and the change is sent first with no acknowledgement.
    fireEvent.click(activate)
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledTimes(2))
    expect(patched(1)).toEqual(CHANGE)
  })

  it('says on the reason when the EHR did not accept it (400), keeping the warning, the tick and both reasons', async () => {
    api.updateRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B)).mockRejectedValueOnce(ACK_400())
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    submitStatus()
    expect((await screen.findByRole('alert')).textContent).toBe(ACK_REFUSED_ERROR)
    expect(patched(1)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
    // The reason is marked, with its own words, and takes focus; the tick has no error.
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(ackReason().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(ackReason())
    expect(tickBox().getAttribute('aria-invalid')).toBeNull()
    expect(tickBox().checked).toBe(true)
    expect(screen.getByRole('region', { name: 'Severe allergy warning for Amoxicillin' })).toBeTruthy()
    expect(field('Reason for change').value).toBe('Treatment starts today')
    expect(screen.getByText('Draft')).toBeTruthy()
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(document.body.textContent).not.toContain('Status could not be changed')
    noServerWords()
  })

  it('checks the medicine the prescription holds with its code, and sends again with that check’s token', async () => {
    setLists([prescription({ medicationCode: '723' })], [])
    api.updateRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_A))
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    // The EHR's token covers the medicine's text and code: a check without the code would give another token.
    expect(api.allergyCheck).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Amoxicillin', medicationCode: '723' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2, medicationCode: '723' })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(1)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
  })

  it('sends no acknowledgement with any other change, and checks nothing', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Put on hold' }))
    change('Reason for change', 'Waiting for results')
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(0)).toEqual({ expectedRowVersion: 3, changeReason: 'Waiting for results', status: 'on_hold' })
    expect(api.allergyCheck).not.toHaveBeenCalled()
  })

  /** Activate refused with the first warning (`first`), then sent again ticked with a reason and refused with `second`. */
  async function activateAgain(second: HidApiError, said: string, first = allergyRefused([SEVERE_PENICILLIN], TOKEN_B)) {
    api.updateRecord.mockRejectedValueOnce(first).mockRejectedValueOnce(second)
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    submitStatus()
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    submitStatus()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(said))
    expect(patched(1)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
  }

  it(`Activate refused for its reason alone (${REASON_INVALID}): the warning, the tick and both reasons stay, the reason is marked, and nothing is checked again`, async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await activateAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_B, [REASON_INVALID]), ACK_REFUSED_ERROR)
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(ackReason().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(ackReason())
    expect(tickBox().checked).toBe(true)
    expect(ackReason().value).toBe(GOOD_REASON)
    expect(field('Reason for change').value).toBe('Treatment starts today')
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    expect(api.allergyCheck).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Draft')).toBeTruthy()
    noServerWords()
    giveReason(NEW_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(2)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: NEW_REASON, warningToken: TOKEN_B } })
  })

  it(`Activate refused for its token (${TOKEN_INVALID}): the warning stays with the 409’s token, unticked, the reason kept; ticked again it goes`, async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_C))
    await activateAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_C, [TOKEN_INVALID]), ALLERGY_TICK_AGAIN_ERROR)
    expect(lines(warningPanel('Severe allergy warning for Amoxicillin'))).toEqual([SEVERE_PENICILLIN.message])
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe(GOOD_REASON)
    expect(ackReason().getAttribute('aria-invalid')).toBeNull()
    noServerWords()
    fireEvent.click(tickBox())
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(2)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_C } })
  })

  it(`Activate refused for its token (${TOKEN_INVALID}) with the same token as the warning ticked: unticked all the same`, async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await activateAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_B, [TOKEN_INVALID]), ALLERGY_TICK_AGAIN_ERROR)
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe(GOOD_REASON)
    fireEvent.click(tickBox())
    setLists([prescription({ status: 'active', rowVersion: 2 })], [])
    submitStatus()
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    expect(patched(2)).toEqual({ ...CHANGE, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
  })

  it(`Activate refused for its reason and its token (${REASON_MISSING} and ${TOKEN_INVALID}): unticked, the reason kept and marked, both said`, async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_C))
    await activateAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_C, [REASON_MISSING, TOKEN_INVALID]), ALLERGY_TICK_AND_REASON_ERROR)
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe(GOOD_REASON)
    expect(screen.getByText(ACK_REASON_SHORT)).toBeTruthy()
    expect(document.activeElement).toBe(ackReason())
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    noServerWords()
  })

  it('Activate on an EHR at 76283f57 (no refused part named): refused with a reason, it reads as changed, as before', async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_C))
    await activateAgain(legacyRefused([SEVERE_PENICILLIN, AUGMENTIN_TERM], TOKEN_C, true), ALLERGY_CHANGED_ERROR, legacyRefused([SEVERE_PENICILLIN], TOKEN_B))
    expect(within(warningPanel('Severe allergy warning for Amoxicillin')).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe('')
  })
})

describe('Allergies on sending a draft prescription to another pharmacy (hid-system 0124)', () => {
  const SENT = { expectedRowVersion: 1, receivingFacilityId: PHARMACY_ID, attestationTextVersion: 'order-route-prescription-attestation-v1' }

  beforeEach(() => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.order-route.send']
    setLists([prescription({ orderRoute: null })], [], { crossFacilityOrders: true })
  })

  async function sendForm() {
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    change('Search for the pharmacy', 'Demo Pharmacy')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Pharmacy/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /^I confirm that Patient One agreed/ }))
  }

  function sent(call: number) {
    return routes.send.mock.calls[call]![5] as Record<string, unknown>
  }

  it('on the EHR’s 409 for a term the patient added after the draft: the warning in the send form, then the same send, same key, with the reason', async () => {
    routes.send.mockRejectedValueOnce(allergyRefused([AUGMENTIN_TERM], TOKEN_B)).mockResolvedValueOnce({})
    api.allergyCheck.mockResolvedValue(checkAnswer([AUGMENTIN_TERM], TOKEN_B))
    await sendForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_GO_AHEAD_ERROR)
    // Sent first with no acknowledgement; the check comes after, for the medicine the prescription holds.
    expect(sent(0)).toEqual(SENT)
    expect(routes.send.mock.invocationCallOrder[0]!).toBeLessThan(api.allergyCheck.mock.invocationCallOrder[0]!)
    expect(api.allergyCheck).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { medicationDisplay: 'Amoxicillin' })
    const panel = warningPanel('Allergy warning for Amoxicillin')
    expect(lines(panel)).toEqual([AUGMENTIN_TERM.message])
    // The send form stays open; the order is not read again, and nothing says it was not sent "as it is".
    expect(screen.getByRole('button', { name: 'Send to Demo Pharmacy' })).toBeTruthy()
    expect(screen.queryByText(/could not be sent/)).toBeNull()
    noServerWords()

    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await waitFor(() => expect(screen.getByText(tickError(1))).toBeTruthy())
    expect(screen.getByText(ACK_REASON_SHORT)).toBeTruthy()
    expect(routes.send).toHaveBeenCalledTimes(1)

    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2, orderRoute: route({ kind: 'prescription', receivingFacility: { id: PHARMACY_ID, name: 'Demo Pharmacy', available: true } }) })], [], { crossFacilityOrders: true })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect(await screen.findByText('Prescription sent to Demo Pharmacy. It waits there until Demo Pharmacy accepts it, and Patient One is told in the Health ID app.')).toBeTruthy()
    expect(sent(1)).toEqual({ ...SENT, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
    // Nothing was written on the 409, and the send's digest leaves the acknowledgement out: the same send.
    expect(routes.send.mock.calls[1]![6]).toBe(routes.send.mock.calls[0]![6])
  })

  it('a send whose warning changed since it was shown: the new warning, unticked, and the newest token', async () => {
    routes.send
      .mockRejectedValueOnce(allergyRefused([MILD_PENICILLIN], TOKEN_A))
      .mockRejectedValueOnce(allergyRefused([MILD_PENICILLIN, SEVERE_PENICILLIN], TOKEN_B, true))
      .mockResolvedValueOnce({})
    api.allergyCheck
      .mockResolvedValueOnce(checkAnswer([MILD_PENICILLIN], TOKEN_A))
      .mockResolvedValueOnce(checkAnswer([MILD_PENICILLIN, SEVERE_PENICILLIN], TOKEN_B))
    await sendForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await screen.findByRole('region', { name: 'Allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ALLERGY_CHANGED_ERROR)
    expect(sent(1)).toEqual({ ...SENT, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_A } })
    const panel = warningPanel('Severe allergy warning for Amoxicillin')
    expect(within(panel).getByText(ALLERGY_WARNING_CHANGED)).toBeTruthy()
    expect(lines(panel)).toEqual([SEVERE_PENICILLIN.message, MILD_PENICILLIN.message])
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe('')
    fireEvent.click(tickBox())
    giveReason(NEW_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await waitFor(() => expect(routes.send).toHaveBeenCalledTimes(3))
    expect(sent(2)).toEqual({ ...SENT, allergyAcknowledgement: { reason: NEW_REASON, warningToken: TOKEN_B } })
    expect(new Set(routes.send.mock.calls.map(call => call[6])).size).toBe(1)
  })

  it('says on the reason when the EHR did not accept it (400): the send form, its warning and its key stay, and nothing is read again', async () => {
    routes.send.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B)).mockRejectedValueOnce(ACK_400())
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await sendForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    const reads = api.records.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ACK_REFUSED_ERROR)
    expect(sent(1)).toEqual({ ...SENT, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(ackReason().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(ackReason())
    // Still open, as it was: the form, the warning, the tick and the reason; the order is not read again.
    expect(screen.getByRole('button', { name: 'Send to Demo Pharmacy' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Severe allergy warning for Amoxicillin' })).toBeTruthy()
    expect(tickBox().checked).toBe(true)
    expect(ackReason().value).toBe(GOOD_REASON)
    expect(api.records.mock.calls.length).toBe(reads)
    expect(screen.queryByText(/could not be sent/)).toBeNull()
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(routes.send.mock.calls[1]![6]).toBe(routes.send.mock.calls[0]![6])
  })

  it('Cancel after the warning leaves the order as it was; the send opened again has no warning', async () => {
    routes.send.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B))
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await sendForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
    expect(routes.send).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Draft')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Send to a pharmacy' }))
    expect(screen.queryByRole('region', { name: /allergy warning/i })).toBeNull()
  })
  /** The send refused with the first warning, then sent again ticked with a reason and refused with `second`. */
  async function sendAgain(second: HidApiError, said: string) {
    routes.send.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B)).mockRejectedValueOnce(second).mockResolvedValueOnce({})
    await sendForm()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(said))
    expect(sent(1)).toEqual({ ...SENT, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_B } })
  }

  it(`a send refused for its reason alone (${REASON_INVALID}): the form, its warning, the tick and the key stay; the reason is marked`, async () => {
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await sendAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_B, [REASON_INVALID]), ACK_REFUSED_ERROR)
    expect(screen.getByText(ACK_NOT_ACCEPTED)).toBeTruthy()
    expect(ackReason().getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(ackReason())
    expect(tickBox().checked).toBe(true)
    expect(ackReason().value).toBe(GOOD_REASON)
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send to Demo Pharmacy' })).toBeTruthy()
    expect(api.allergyCheck).toHaveBeenCalledTimes(1)
    noServerWords()
    giveReason(NEW_REASON)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await waitFor(() => expect(routes.send).toHaveBeenCalledTimes(3))
    expect(sent(2)).toEqual({ ...SENT, allergyAcknowledgement: { reason: NEW_REASON, warningToken: TOKEN_B } })
    expect(new Set(routes.send.mock.calls.map(call => call[6])).size).toBe(1)
  })

  it(`a send refused for its token (${TOKEN_INVALID}): the warning stays with the 409’s token, unticked, the reason kept; ticked again, the same send goes`, async () => {
    api.allergyCheck.mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_B)).mockResolvedValueOnce(checkAnswer([SEVERE_PENICILLIN], TOKEN_C))
    await sendAgain(rejectedRefusal([SEVERE_PENICILLIN], TOKEN_C, [TOKEN_INVALID]), ALLERGY_TICK_AGAIN_ERROR)
    expect(lines(warningPanel('Severe allergy warning for Amoxicillin'))).toEqual([SEVERE_PENICILLIN.message])
    expect(screen.queryByText(ALLERGY_WARNING_CHANGED)).toBeNull()
    expect(tickBox().checked).toBe(false)
    expect(ackReason().value).toBe(GOOD_REASON)
    noServerWords()
    fireEvent.click(tickBox())
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }))
    await waitFor(() => expect(routes.send).toHaveBeenCalledTimes(3))
    expect(sent(2)).toEqual({ ...SENT, allergyAcknowledgement: { reason: GOOD_REASON, warningToken: TOKEN_C } })
    expect(new Set(routes.send.mock.calls.map(call => call[6])).size).toBe(1)
  })
})

describe('Reasons given to go ahead over an allergy warning, on a prescription’s page (hid-system#218 at 7fbb04aa)', () => {
  const PENICILLIN_ID = 'a1240000-0000-4000-8000-000000000021'
  const LATEX_ID = 'a1240000-0000-4000-8000-000000000022'
  /** A recorded allergy no longer on the patient's list (marked entered in error since, most likely). */
  const GONE_ID = 'a1240000-0000-4000-8000-000000000029'
  const PENICILLIN = { id: PENICILLIN_ID, substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe' as const, status: 'active' as const,
    rowVersion: '1', createdAt: null, enteredInErrorReason: null, recordedHere: false }
  const LATEX = { id: LATEX_ID, substance: 'Latex', reaction: null, severity: 'unknown' as const, status: 'active' as const,
    rowVersion: '1', createdAt: null, enteredInErrorReason: null, recordedHere: true }
  /**
   * Who gave a reason, as the EHR stores it: the account id (createdBy) and the membership at this facility
   * (createdByMembershipId). The signed-in member is the harness's actor: its session id ('staff-1') is the sign-in's
   * subject, not an account id, and its membership here is 'member-1'. "You" is said from the membership alone.
   */
  const SESSION_ID = 'staff-1'
  const MY_ACCOUNT = 'e0000000-0000-4000-8000-0000000000a1'
  const MY_MEMBERSHIP = 'member-1'
  const COLLEAGUE = 'e0000000-0000-4000-8000-0000000000c2'
  const COLLEAGUE_MEMBERSHIP = 'e0000000-0000-4000-8000-0000000000f2'
  const WHEN = '2026-11-10T09:00:00.000Z'

  function override(overrides: Record<string, unknown> = {}) {
    return {
      id: 'e1240000-0000-4000-8000-000000000001', stage: 'create', reason: 'Has taken amoxicillin since 2024 with no reaction',
      createdBy: MY_ACCOUNT, createdByMembershipId: MY_MEMBERSHIP, createdAt: WHEN, matchedRecordedAllergyIds: [PENICILLIN_ID],
      patientReportedMatched: false, patientReportedTerms: [], ...overrides,
    }
  }

  /** Each override's lines, in order. */
  function entries(panel: HTMLElement) {
    return within(panel).getAllByRole('listitem').map(item => [...item.querySelectorAll('p')].map(line => line.textContent))
  }

  beforeEach(() => {
    staff.permissions = [...READ_WRITE, 'ehr.note.read']
    api.allergies.mockResolvedValue({ recorded: [PENICILLIN, LATEX], patientReported: { allergies: 'Penicillin, Augmentin', updatedAt: null } })
  })

  it('shows one above the actions: by you, when, at which step, the reason as written, the allergy it covered by name, and the patient’s own words', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3,
      allergyAcknowledgements: [override({ patientReportedMatched: true, patientReportedTerms: ['penicillin'] })] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    expect(within(panel).getByRole('heading', { level: 3, name: 'Allergy warning overridden' })).toBeTruthy()
    await waitFor(() => expect(entries(panel)).toEqual([[
      `By you on ${formatWhen(WHEN)}, when it was prescribed.`,
      'Reason given: “Has taken amoxicillin since 2024 with no reaction”.',
      'Recorded allergy it covered: Penicillin (severe: Anaphylaxis).',
      'The patient’s own words it covered, from their Health ID portal: “penicillin”.',
    ]]))
    // In the Actions card, above its buttons, whatever the status.
    expect(panel.compareDocumentPosition(screen.getByRole('button', { name: 'Put on hold' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(api.allergies).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    // Ids are never shown.
    for (const id of [MY_ACCOUNT, MY_MEMBERSHIP, PENICILLIN_ID, 'e1240000-0000-4000-8000-000000000001']) expect(document.body.textContent).not.toContain(id)
  })

  it('shows several oldest first, as served, each with who and its step, and says plainly of an allergy no longer on the patient’s list', async () => {
    setLists([prescription({ status: 'active', rowVersion: 5, allergyAcknowledgements: [
      override({ id: 'e1240000-0000-4000-8000-000000000011', createdBy: COLLEAGUE, createdByMembershipId: COLLEAGUE_MEMBERSHIP, createdAt: '2026-11-08T08:00:00.000Z',
        matchedRecordedAllergyIds: [PENICILLIN_ID, GONE_ID] }),
      override({ id: 'e1240000-0000-4000-8000-000000000012', stage: 'activate', createdAt: '2026-11-09T10:30:00.000Z',
        reason: 'Checked the latex allergy with the patient; no latex in this medicine', matchedRecordedAllergyIds: [LATEX_ID] }),
      override({ id: 'e1240000-0000-4000-8000-000000000013', stage: 'resume', createdBy: COLLEAGUE, createdByMembershipId: COLLEAGUE_MEMBERSHIP, createdAt: '2026-11-10T07:15:00.000Z',
        reason: 'Patient took Augmentin last month with no reaction', matchedRecordedAllergyIds: [], patientReportedMatched: true,
        patientReportedTerms: ['augmentin', 'amoxil'] }),
    ] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warnings overridden' })
    await waitFor(() => expect(entries(panel)).toEqual([
      [`By a clinician at this facility on ${formatWhen('2026-11-08T08:00:00.000Z')}, when it was prescribed.`,
        'Reason given: “Has taken amoxicillin since 2024 with no reaction”.',
        'Recorded allergies it covered: Penicillin (severe: Anaphylaxis); 1 more recorded allergy no longer on the patient’s list (it may have been marked entered in error).'],
      [`By you on ${formatWhen('2026-11-09T10:30:00.000Z')}, when it was activated.`,
        'Reason given: “Checked the latex allergy with the patient; no latex in this medicine”.',
        'Recorded allergy it covered: Latex (severity not known).'],
      [`By a clinician at this facility on ${formatWhen('2026-11-10T07:15:00.000Z')}, when it was resumed.`,
        'Reason given: “Patient took Augmentin last month with no reaction”.',
        'The patient’s own words it covered, from their Health ID portal: “augmentin”, “amoxil”.'],
    ]))
    // One read of the allergies names them all.
    expect(api.allergies).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toContain(COLLEAGUE)
  })

  it('says “you” only for the signed-in member’s membership at this facility, never from the account or session id', async () => {
    setLists([prescription({ status: 'active', rowVersion: 4, allergyAcknowledgements: [
      // Given with this membership: you, whatever the account id.
      override({ id: 'e1240000-0000-4000-8000-000000000021', matchedRecordedAllergyIds: [], patientReportedMatched: true, patientReportedTerms: ['penicillin'] }),
      // An account id that happens to equal the session's id, with another membership: someone else.
      override({ id: 'e1240000-0000-4000-8000-000000000022', createdBy: SESSION_ID, createdByMembershipId: COLLEAGUE_MEMBERSHIP,
        matchedRecordedAllergyIds: [], patientReportedMatched: true, patientReportedTerms: ['penicillin'] }),
      // No membership said: never "you".
      override({ id: 'e1240000-0000-4000-8000-000000000023', createdByMembershipId: undefined,
        matchedRecordedAllergyIds: [], patientReportedMatched: true, patientReportedTerms: ['penicillin'] }),
    ] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warnings overridden' })
    expect(entries(panel).map(lines => lines[0])).toEqual([
      `By you on ${formatWhen(WHEN)}, when it was prescribed.`,
      `By a clinician at this facility on ${formatWhen(WHEN)}, when it was prescribed.`,
      `By a clinician at this facility on ${formatWhen(WHEN)}, when it was prescribed.`,
    ])
    for (const id of [MY_ACCOUNT, MY_MEMBERSHIP, COLLEAGUE_MEMBERSHIP]) expect(document.body.textContent).not.toContain(id)
  })

  it.each([
    ['create', 'when it was prescribed'],
    ['activate', 'when it was activated'],
    ['resume', 'when it was resumed'],
    ['send', 'when it was sent to a pharmacy'],
  ])('says the step %s in plain words', async (stage, words) => {
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [override({ stage, matchedRecordedAllergyIds: [GONE_ID] })] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    await waitFor(() => expect(entries(panel)[0]).toEqual([`By you on ${formatWhen(WHEN)}, ${words}.`,
      'Reason given: “Has taken amoxicillin since 2024 with no reaction”.',
      'Recorded allergy it covered: one no longer on the patient’s list (it may have been marked entered in error).']))
  })

  it.each([
    [[{ id: 'e1240000-0000-4000-8000-000000000031' }], 'Allergy warning overridden', 'An allergy warning override on this prescription can’t be shown here.'],
    [['x', { reason: 'Has taken amoxicillin since 2024 with no reaction' }], 'Allergy warnings overridden', '2 allergy warning overrides on this prescription can’t be shown here.'],
  ])('when no stored reason can be read, says one exists and can’t be shown, never “more”', async (stored, title, said) => {
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: stored })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: title })
    expect(within(panel).queryAllByRole('listitem')).toEqual([])
    expect([...panel.querySelectorAll('p')].map(line => line.textContent)).toEqual([said])
    expect(document.body.textContent).not.toMatch(/\bmore allergy warning/)
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('after the reasons it can show, counts those it can’t as “more”', async () => {
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [
      override({ matchedRecordedAllergyIds: [], patientReportedMatched: true, patientReportedTerms: ['penicillin'] }), { id: 'e1240000-0000-4000-8000-000000000032' },
    ] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warnings overridden' })
    expect(within(panel).getAllByRole('listitem')).toHaveLength(1)
    expect(within(panel).getByText('1 more allergy warning override can’t be shown here.')).toBeTruthy()
  })

  it('shows the reason as text, never as markup, with its own line breaks', async () => {
    const reason = 'Tolerated <b>amoxicillin</b> & penicillin V in 2024.\nFirst dose under observation.'
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [override({ reason, matchedRecordedAllergyIds: [], patientReportedMatched: true, patientReportedTerms: ['penicillin'] })] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    expect(panel.querySelector('b')).toBeNull()
    const line = [...panel.querySelectorAll('p')].find(item => item.textContent?.startsWith('Reason given'))!
    expect(line.textContent).toBe(`Reason given: “${reason}”.`)
    expect(line.className).toContain('hid-ehr-clinical-allergy-override-reason')
    // No allergy to name: the allergies are not read.
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('says the allergies it covered can’t be named without ehr.note.read, and reads none', async () => {
    staff.permissions = [...READ_WRITE]
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [override({ matchedRecordedAllergyIds: [PENICILLIN_ID, LATEX_ID] })] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    expect(entries(panel)[0]![2]).toBe('Recorded allergies it covered: 2 (their names can’t be shown here).')
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('says when the allergies it covered could not be loaded, and names them after Try again', async () => {
    api.allergies.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [override()] })], [])
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    await waitFor(() => expect(entries(panel)[0]![2]).toBe('Recorded allergy it covered: 1 (their names could not be loaded).'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(entries(panel)[0]![2]).toBe('Recorded allergy it covered: Penicillin (severe: Anaphylaxis).'))
    expect(api.allergies).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a draft', { status: 'draft' }, 'Activate'],
    ['an active one', { status: 'active', rowVersion: 2 }, 'Put on hold'],
  ])('says nothing about overrides on %s from an EHR without the allergy check (no allergyAcknowledgements)', async (_label, fields, action) => {
    // The website goes live before hid-system#218: no warning can have been overridden there, so no line on every page.
    setLists([prescription(fields)], [])
    await openOrder('pharmacy', RX)
    await act(async () => {})
    expect(screen.getByRole('button', { name: action })).toBeTruthy()
    expect(screen.queryByText(OVERRIDES_NOT_SHOWN)).toBeNull()
    expect(screen.queryByRole('region', { name: /overridden/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/overrid/i)
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it.each([
    ['a draft', { status: 'draft', allergyAcknowledgements: { items: [] } }, 'Activate'],
    ['an active one', { status: 'active', rowVersion: 2, allergyAcknowledgements: 'stored' }, 'Put on hold'],
  ])('says plainly on %s whose allergyAcknowledgements can’t be read that overrides can’t be shown, never that there are none', async (_label, fields, action) => {
    setLists([prescription(fields)], [])
    await openOrder('pharmacy', RX)
    await act(async () => {})
    const note = screen.getByText(OVERRIDES_NOT_SHOWN)
    // Above the actions, where the reasons would be.
    expect(note.compareDocumentPosition(screen.getByRole('button', { name: action })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('region', { name: /overridden/i })).toBeNull()
    expect(document.body.textContent).not.toMatch(/no reason|none given|no allergy warning|not overridden|no override/i)
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it('does not say it on a prescription that says none were given ([])', async () => {
    setLists([prescription({ allergyAcknowledgements: [] })], [])
    await openOrder('pharmacy', RX)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Activate' })).toBeTruthy()
    expect(screen.queryByText(OVERRIDES_NOT_SHOWN)).toBeNull()
    expect(document.body.textContent).not.toMatch(/overrid/i)
  })

  it('does not say it on a lab test, which has no allergy warning', async () => {
    setLists([], [labRequest()])
    await openOrder('laboratory', LAB)
    await act(async () => {})
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/overrid/i)
  })

  it.each([
    ['a draft, above Activate', { status: 'draft' }, 'Activate', {}],
    ['one on hold, above Resume', { status: 'on_hold' }, 'Resume', {}],
    ['a draft, above its send to another pharmacy', { status: 'draft', orderRoute: null }, 'Send to a pharmacy', { crossFacilityOrders: true }],
  ])('shows no allergy lines on %s any more (the interim lines are gone) when no reason was given ([]), and reads no allergies', async (_label, fields, action, extra) => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.note.read', 'ehr.order-route.send']
    setLists([prescription({ ...fields, allergyAcknowledgements: [] })], [], extra)
    await openOrder('pharmacy', RX)
    await act(async () => {})
    expect(screen.getByRole('button', { name: action })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /overridden/i })).toBeNull()
    expect(screen.queryByText(/^Allergies (recorded by clinicians|reported by the patient)/)).toBeNull()
    expect(screen.queryByText(NO_WARNING_NOT_SAFE)).toBeNull()
    expect(document.body.textContent).not.toMatch(/overrid/i)
    expect(api.allergies).not.toHaveBeenCalled()
  })

  it.each([
    ['a draft, above Activate', { status: 'draft' }, 'Activate', {}],
    ['one on hold, above Resume', { status: 'on_hold' }, 'Resume', {}],
    ['a draft, above its send to another pharmacy', { status: 'draft', orderRoute: null }, 'Send to a pharmacy', { crossFacilityOrders: true }],
  ])('shows a reason already given on %s, with the reason and the allergy it covered, before the button is pressed', async (_label, fields, action, extra) => {
    // The EHR may let the step go ahead with no new warning when this reason covers the allergies: whoever presses sees it first.
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.note.read', 'ehr.order-route.send']
    setLists([prescription({ ...fields, allergyAcknowledgements: [override()] })], [], extra)
    await openOrder('pharmacy', RX)
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    await waitFor(() => expect(entries(panel)).toEqual([[`By you on ${formatWhen(WHEN)}, when it was prescribed.`,
      'Reason given: “Has taken amoxicillin since 2024 with no reaction”.', 'Recorded allergy it covered: Penicillin (severe: Anaphylaxis).']]))
    expect(panel.compareDocumentPosition(screen.getByRole('button', { name: action })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Activate that the EHR lets go ahead with no new warning (a reason given already covers it): the reason stays shown above the actions', async () => {
    setLists([prescription({ allergyAcknowledgements: [override()] })], [])
    await openOrder('pharmacy', RX)
    const before = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    expect(before.compareDocumentPosition(screen.getByRole('button', { name: 'Activate' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    setLists([prescription({ status: 'active', rowVersion: 2, allergyAcknowledgements: [override()] })], [])
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    // No 409, so no warning, no check, and nothing acknowledged: the EHR's stored reason covered it.
    expect(screen.queryByRole('region', { name: /allergy warning for/i })).toBeNull()
    expect(api.allergyCheck).not.toHaveBeenCalled()
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
    expect(api.updateRecord.mock.calls[0]![5]).toEqual({ expectedRowVersion: 1, changeReason: 'Treatment starts today', status: 'active' })
    const after = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    await waitFor(() => expect(entries(after)).toEqual([[`By you on ${formatWhen(WHEN)}, when it was prescribed.`,
      'Reason given: “Has taken amoxicillin since 2024 with no reaction”.', 'Recorded allergy it covered: Penicillin (severe: Anaphylaxis).']]))
    expect(after.compareDocumentPosition(screen.getByRole('button', { name: 'Put on hold' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('after Activate with a reason, the prescription read again shows it, by you, when it was activated', async () => {
    setLists([prescription({ allergyAcknowledgements: [] })], [])
    api.updateRecord.mockRejectedValueOnce(allergyRefused([SEVERE_PENICILLIN], TOKEN_B))
    api.allergyCheck.mockResolvedValue(checkAnswer([SEVERE_PENICILLIN], TOKEN_B))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }))
    change('Reason for change', 'Treatment starts today')
    fireEvent.submit(field('Reason for change').closest('form')!)
    await screen.findByRole('region', { name: 'Severe allergy warning for Amoxicillin' })
    expect(screen.queryByRole('region', { name: /overridden/i })).toBeNull()
    fireEvent.click(tickBox())
    giveReason(GOOD_REASON)
    setLists([prescription({ status: 'active', rowVersion: 2,
      allergyAcknowledgements: [override({ stage: 'activate', reason: GOOD_REASON })] })], [])
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText('Prescription status updated.')).toBeTruthy()
    const panel = await screen.findByRole('region', { name: 'Allergy warning overridden' })
    await waitFor(() => expect(entries(panel)).toEqual([[`By you on ${formatWhen(WHEN)}, when it was activated.`,
      `Reason given: “${GOOD_REASON}”.`, 'Recorded allergy it covered: Penicillin (severe: Anaphylaxis).']]))
  })
})

describe('Visit rehearsal (11 Nov): a dose is shown as it was entered', () => {
  /** The value beside a label on the order's "Saved record". */
  function saved(label: string) {
    const term = Array.from(document.querySelectorAll('dt')).find(item => item.textContent === label)
    return term?.nextElementSibling?.textContent ?? null
  }

  // The EHR keeps a dose to four decimal places and answers it as text, as the rehearsal's prescriptions came back.
  it.each([
    ['4.0000', 'tablet(s)', '4tablet(s)'],
    ['1000.0000', 'mg', '1000mg'],
    ['0.5000', 'mL', '0.5mL'],
    ['2.5000', 'mg', '2.5mg'],
    ['.25', 'mg', '0.25mg'],
    [250, 'mg', '250mg'],
  ])('shows %s %s on the prescription’s page with no trailing zeros', async (doseQuantity, doseUnit, shown) => {
    setLists([prescription({ doseQuantity, doseUnit })], [])
    await openOrder('pharmacy', RX)
    expect(saved('Dose')).toBe(shown)
    expect(document.body.textContent).not.toMatch(/\d\.\d*0(?!\d)\s*(tablet|mg|mL)/)
  })

  it('prints the dose as entered on the prescription paper', async () => {
    setLists([prescription({ status: 'active', rowVersion: 3, medicationDisplay: 'Paracetamol', doseQuantity: '1000.0000', doseUnit: 'mg' })], [])
    let printed = ''
    vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print="prescription"]')?.textContent ?? '' })
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Print prescription' }))
    expect(printed).toContain('Paracetamol 1000 mg')
    expect(printed).not.toContain('1000.0000')
    act(() => { window.dispatchEvent(new Event('afterprint')) })
  })
})

describe('Visit rehearsal (11 Nov): after a send, the order shows it was sent and offers no second send', () => {
  const ACCEPTED_AT = '2026-11-11T12:40:00.000Z'
  // In the app's own format, in the machine's time zone, as the page writes it.
  const SENT_TO_PHARMACY = `Sent to Pharmacy. Accepted by the pharmacy on ${formatWhen(ACCEPTED_AT)}.`
  const SENT_TO_LAB = `Sent to Lab. Accepted by the lab on ${formatWhen(ACCEPTED_AT)}.`
  const HELD_BY_PHARMACY = `Sent to Pharmacy at version 3. Accepted by the pharmacy on ${formatWhen(ACCEPTED_AT)}. Later changes are not passed on.`

  function sendButtons(name: string) {
    return screen.queryAllByRole('button', { name })
  }

  async function changeStatus(action: string, reason: string, done: string) {
    fireEvent.click(screen.getByRole('button', { name: action }))
    change('Reason for change', reason)
    fireEvent.submit(field('Reason for change').closest('form')!)
    expect(await screen.findByText(done)).toBeTruthy()
  }

  it('Send to Pharmacy: says when the pharmacy accepted it, and offers no second send, at that version or a later one', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    // Pharmacy's work item, as the EHR passes it on (pharmacy-api projectWorkItem).
    api.acceptPrescription.mockResolvedValue({ id: 'pw-1', sourceEhrPrescriptionVersion: 3, status: 'accepted', acceptedAt: ACCEPTED_AT, dispensing: null })
    await openOrder('pharmacy', RX)
    expect(screen.queryByText(SENT_TO_PHARMACY)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)
    expect(await screen.findByText('Pharmacy accepted this exact prescription version.')).toBeTruthy()
    expect(screen.getByText(SENT_TO_PHARMACY)).toBeTruthy()
    expect(sendButtons('Send to Pharmacy')).toHaveLength(0)

    // Held, then resumed: a new version. Pharmacy holds one work item per prescription, ever, and refuses any other
    // version (pharmacy-api acceptPrescription: IDEMPOTENCY_CONFLICT), so the send is not offered again, and the line
    // names the version it holds.
    setLists([prescription({ status: 'on_hold', rowVersion: 4 })], [])
    await changeStatus('Put on hold', 'Waiting for results', 'Prescription status updated.')
    expect(await screen.findByText(HELD_BY_PHARMACY)).toBeTruthy()
    setLists([prescription({ status: 'active', rowVersion: 5 })], [])
    await changeStatus('Resume', 'Results back', 'Prescription status updated.')
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Put on hold' })).toHaveLength(1))
    expect(screen.getByText(HELD_BY_PHARMACY)).toBeTruthy()
    expect(sendButtons('Send to Pharmacy')).toHaveLength(0)
  })

  it('Send to Pharmacy: a send that failed shows nothing sent and keeps the send', async () => {
    staff.permissions = [...READ_WRITE, 'pharmacy.work-item.accept']
    setLists([prescription({ status: 'active', rowVersion: 3 })], [])
    api.acceptPrescription.mockRejectedValue(new HidApiError(409, 'Conflict', { code: 'IDEMPOTENCY_CONFLICT' }))
    await openOrder('pharmacy', RX)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Pharmacy' }))
    change('Reason', 'Patient collecting today')
    fireEvent.submit(field('Reason').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toMatch(/^Pharmacy already holds work for this prescription/)
    expect(screen.queryByText(/^Sent to Pharmacy/)).toBeNull()
    expect(sendButtons('Send to Pharmacy').length).toBeGreaterThan(0)
  })

  it('Send to Lab: says when the lab accepted it and offers no second send; a failed send keeps it', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 3 })])
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Lab' }))
    api.sendLabRequestToLab.mockRejectedValueOnce(new HidApiError(502, 'Bad gateway', { code: 'LAB_HANDOFF_UNCONFIRMED' }))
    fireEvent.click(sendButtons('Send to Lab')[1]!)
    expect((await screen.findByRole('alert')).textContent).toBe('Lab did not confirm that it accepted this request, so the Laboratory may not have it: send again.')
    expect(screen.queryByText(/^Sent to Lab/)).toBeNull()
    expect(sendButtons('Send to Lab')).toHaveLength(2)
    // Lab's work item (lab-api project).
    api.sendLabRequestToLab.mockResolvedValueOnce({ id: 'lw-1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, status: 'accepted', acceptedAt: ACCEPTED_AT })
    fireEvent.click(sendButtons('Send to Lab')[1]!)
    expect(await screen.findByText('Lab accepted this lab request at its current version.')).toBeTruthy()
    expect(screen.getByText(SENT_TO_LAB)).toBeTruthy()
    expect(sendButtons('Send to Lab')).toHaveLength(0)
  })

  it('Create active request and send to Lab: the saved request’s page shows it sent, with no Send to Lab', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    setLists([], [labRequest({ status: 'active', rowVersion: 1 })])
    api.createRecord.mockResolvedValue({ ...labRequest({ status: 'active', rowVersion: 1 }), labHandoff: { state: 'accepted' },
      labWorkItem: { id: 'lw-1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 1, status: 'accepted', acceptedAt: ACCEPTED_AT } })
    open(`${ENCOUNTER_ID}/orders/new/laboratory`)
    const create = await screen.findByRole('button', { name: 'Create lab request' })
    change('Test code system', 'LOINC')
    change('Test code', '718-7')
    change('Test display', 'Haemoglobin')
    fireEvent.change(field('Request handling'), { target: { value: 'active' } })
    fireEvent.click(create)
    await confirmPatient(SEND_LAB(), 'Send lab request')
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(screen.getByText(SENT_TO_LAB)).toBeTruthy()
    expect(sendButtons('Send to Lab')).toHaveLength(0)
  })

  it('Activate and send to Lab: once Lab accepted the activated version, it shows it sent, with no Send to Lab', async () => {
    staff.permissions = [...READ_WRITE, 'lab.work-item.accept']
    api.updateRecord.mockResolvedValue({ ...labRequest({ status: 'active', rowVersion: 2 }), labHandoff: { state: 'accepted' },
      labWorkItem: { id: 'lw-1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 2, status: 'accepted', acceptedAt: ACCEPTED_AT } })
    await openOrder('laboratory', LAB)
    setLists([], [labRequest({ status: 'active', rowVersion: 2 })])
    await changeStatus('Activate and send to Lab', 'Results needed today', 'Lab request activated and accepted by Lab.')
    expect(await screen.findByText(SENT_TO_LAB)).toBeTruthy()
    expect(sendButtons('Send to Lab')).toHaveLength(0)
  })
})

describe('Visit rehearsal (11 Nov): a released result in the app’s date format, its flag called out', () => {
  const revision = (abnormalFlag: string, overrides: Record<string, unknown> = {}) => ({
    version: 1, resultType: 'text', numericValue: null, textValue: 'Plasmodium falciparum seen (++)', unit: null, referenceRange: null, abnormalFlag,
    entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released', enteredAt: '2026-11-11T12:31:20.000Z',
    releasedAt: '2026-11-11T12:45:05.000Z', correctionReason: null, ...overrides,
  })
  const released = (...revisions: ReturnType<typeof revision>[]) => ({
    workItemId: 'w1', sourceEhrOrderId: LAB, sourceEhrOrderVersion: 3, patientId: PATIENT_ID, acceptedAt: '2026-11-11T12:20:00.000Z',
    test: { codeSystem: 'LOINC', code: '32700-7', name: 'Malaria parasites, blood film' },
    results: revisions.map((item, index) => ({ id: `r${index}`, executionId: `x${index}`, status: 'released', verificationStatus: 'verified',
      currentVersion: 1, currentReleasedVersion: 1, revisions: [item] })),
  })

  async function view(answer: ReturnType<typeof released>) {
    staff.permissions = [...READ_WRITE, 'lab.result.released.read']
    setLists([], [labRequest({ status: 'active', rowVersion: 3, testDisplay: 'Malaria parasites, blood film' })])
    api.labReleasedResultsForOrder.mockResolvedValue(answer)
    await openOrder('laboratory', LAB)
    fireEvent.click(screen.getByRole('button', { name: 'View released results' }))
    return screen.findByRole('heading', { name: 'Released results' }).then(() => waitFor(() => expect(screen.getAllByText(/^Result \d$/).length).toBeGreaterThan(0)))
  }

  it('says when it was entered, released and accepted in the app’s own format: day, month in words, 24-hour, no seconds', async () => {
    await view(released(revision('abnormal')))
    const text = document.body.textContent ?? ''
    // Built with the app's own formatter, so the test holds in any time zone (12:31Z is 18:01 in Kolkata, 12 Nov in Auckland).
    expect(text).toContain(`Entered ${formatWhen('2026-11-11T12:31:20.000Z')}`)
    expect(text).toContain(`Released ${formatWhen('2026-11-11T12:45:05.000Z')}`)
    expect(text).toContain(`accepted by Lab ${formatWhen('2026-11-11T12:20:00.000Z')}`)
    expect(formatWhen('2026-11-11T12:31:20.000Z')).toMatch(/^\d{1,2} [A-Z][a-z]{2} 2026, \d{2}:\d{2}$/)
    expect(text).not.toMatch(/11\/11\/2026|\d:\d{2}:\d{2}|\b(AM|PM)\b/)
  })

  it.each([['abnormal', 'Abnormal'], ['high', 'High'], ['low', 'Low'], ['critical_candidate', 'Possibly critical']])(
    'calls out the %s flag in a word with its icon, not in lower-case text', async (flag, word) => {
      await view(released(revision(flag)))
      const value = screen.getByText('Plasmodium falciparum seen (++)')
      const called = within(value).getByText(word)
      expect(called.querySelector('svg')).toBeTruthy()
      // Lab's critical_candidate is unconfirmed: never the bare word "Critical", as the printed result says it.
      expect(within(value).queryByText('Critical')).toBeNull()
      expect(value.textContent).not.toMatch(/·\s*(abnormal|high|low|critical candidate)\b/)
    })

  it('says a normal result is normal in words, and says nothing of a flag the lab did not set', async () => {
    await view(released(revision('normal', { textValue: 'No parasites seen' }), revision('unknown', { textValue: 'Film unreadable' })))
    expect(screen.getByText('No parasites seen · Normal')).toBeTruthy()
    expect(screen.getByText('Film unreadable').textContent).toBe('Film unreadable')
    expect(document.body.textContent).not.toMatch(/\bunknown\b/)
  })
})
