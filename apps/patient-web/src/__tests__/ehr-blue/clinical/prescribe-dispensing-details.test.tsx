import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EncounterOrderPages, orderPath } from '../../../ehr-blue/clinical/consult/orders'
import { PRESCRIPTION_ROUTING_HINT } from '../../../ehr-blue/clinical/consult/orders/words'
import { ChartProvider } from '../../../ehr-blue/clinical/parts/chart'
import { Workspace } from '../../../ehr-blue/clinical/parts/Workspace'
import {
  DETAILS_NOT_TAKEN, DURATION_NUMBER_TEXT, DURATION_PAIR, PRIORITY_HINT, QUANTITY_HINT, QUANTITY_NUMBER_TEXT, QUANTITY_PAIR, ROUTED_DETAILS_NOT_SENT,
  STRENGTH_HINT, checkDetails, detailLines, detailsBody, takesDispensingDetails,
} from '../../../ehr-blue/prescriptionDetails'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { SAID_FIELDS_REFUSED } from '../../said'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, renderPage, type SignedIn } from './harness'

/**
 * The prescribe form's dispensing details (hid-system 0125): strength, form, how long for, quantity to dispense and
 * priority. Shown and sent only once the prescriptions list says `dispensingDetails: true`; otherwise the form and
 * its request are today's. Everything is fictional (Patient One at Demo Hospital).
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
const READ_WRITE = ['ehr.encounter.read', 'ehr.prescription.read', 'ehr.prescription.write']
const DETAIL_LABELS = ['Strength', 'Form', 'How long for', 'Days, weeks or months', 'Quantity to dispense', 'Quantity unit', 'Priority']

function prescription(overrides: Record<string, unknown> = {}) {
  return {
    id: RX, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z', medicationDisplay: 'Amoxicillin',
    doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Three times a day', instructions: 'After meals', status: 'draft', rowVersion: 1,
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

let listExtra: Record<string, unknown> = {}
let items: unknown[] = []

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
  listExtra = {}
  items = [prescription()]
  api.records.mockImplementation(async () => ({ items, nextCursor: null, ...listExtra }))
  api.createRecord.mockResolvedValue(prescription())
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
  api.allergyCheck.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
})

function Consult() {
  return (
    <Workspace path="consult">
      <ChartProvider>
        <Routes>
          <Route path=":recordId/orders/*" element={<EncounterOrderPages />} />
        </Routes>
      </ChartProvider>
    </Workspace>
  )
}

function field(label: string) {
  return screen.getByLabelText(labelled(label)) as HTMLInputElement
}

function change(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}

function options(label: string) {
  return Array.from((field(label) as unknown as HTMLSelectElement).options).map(option => option.textContent)
}

async function form() {
  renderPage(<Consult />, 'consult', `/${ENCOUNTER_ID}/orders/new/pharmacy`)
  expect(await screen.findByRole('heading', { level: 1, name: 'Add prescriptions' })).toBeTruthy()
  // The form reads this consultation's prescriptions list once, to learn whether the EHR takes the details.
  await waitFor(() => expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions'))
  return screen.getByRole('button', { name: 'Save draft' })
}

function fillToday() {
  change('Medication', 'Amoxicillin')
  change('Dose quantity', '500')
  change('Dose unit', 'mg')
  change('Frequency', 'Three times a day')
  change('Instructions', 'After meals')
}

async function confirmAndSave() {
  const sheet = await screen.findByRole('dialog', { name: 'Confirm the patient' })
  expect(within(sheet).getByText(`Save this prescription of Amoxicillin for ${PATIENT_NAME}?`)).toBeTruthy()
  fireEvent.click(within(sheet).getByRole('button', { name: 'Save prescription' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Confirm the patient' })).toBeNull())
}

const TODAY_BODY = {
  medicationDisplay: 'Amoxicillin', doseQuantity: 500, doseUnit: 'mg', routeCode: undefined, frequency: 'Three times a day',
  instructions: 'After meals', status: 'draft',
}

describe('Prescribe form, before the EHR takes the dispensing details', () => {
  for (const [name, extra] of [['absent', {}], ['false', { dispensingDetails: false }], ['not exactly true', { dispensingDetails: 'true' }]] as const) {
    it(`shows none of the details and sends today's body when the list's flag is ${name}`, async () => {
      listExtra = extra
      const save = await form()
      for (const label of DETAIL_LABELS) expect(screen.queryByLabelText(labelled(label))).toBeNull()
      for (const hint of [STRENGTH_HINT, QUANTITY_HINT, PRIORITY_HINT]) expect(screen.queryByText(hint)).toBeNull()
      fillToday()
      fireEvent.click(save)
      await confirmAndSave()
      await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
      expect(api.createRecord.mock.calls[0]![4]).toStrictEqual(TODAY_BODY)
      expect(Object.keys(api.createRecord.mock.calls[0]![4] as object)).toEqual(Object.keys(TODAY_BODY))
    })
  }

  it('keeps today’s form when the list cannot be read', async () => {
    api.records.mockRejectedValue(new Error('Network error'))
    const save = await form()
    for (const label of DETAIL_LABELS) expect(screen.queryByLabelText(labelled(label))).toBeNull()
    fillToday()
    fireEvent.click(save)
    await confirmAndSave()
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![4]).toStrictEqual(TODAY_BODY)
  })
})

describe('Prescribe form, once the list says dispensingDetails: true', () => {
  beforeEach(() => { listExtra = { dispensingDetails: true } })

  it('shows the five details in plain words, with their choices, hints and limits', async () => {
    await form()
    expect(await screen.findByLabelText(labelled('Strength'))).toBeTruthy()
    for (const label of DETAIL_LABELS) {
      expect(field(label)).toBeTruthy()
      expect(field(label).required).toBe(false)
    }
    expect(field('Strength').maxLength).toBe(80)
    expect(field('Strength').placeholder).toBe('500 mg')
    expect(field('Quantity unit').maxLength).toBe(80)
    expect(field('How long for').inputMode).toBe('numeric')
    expect(field('Quantity to dispense').inputMode).toBe('decimal')
    expect(options('Form')).toEqual(['Select…', 'Tablet', 'Capsule', 'Liquid', 'Injection', 'Cream', 'Inhaler', 'Drops', 'Other'])
    expect(options('Days, weeks or months')).toEqual(['Select…', 'Days', 'Weeks', 'Months'])
    expect(options('Priority')).toEqual(['Select…', 'Routine', 'Urgent', 'As soon as possible', 'Stat'])
    expect(screen.getByText(STRENGTH_HINT)).toBeTruthy()
    expect(screen.getByText(QUANTITY_HINT)).toBeTruthy()
    expect(screen.getByText(PRIORITY_HINT)).toBeTruthy()
    // It is this facility's Pharmacy that sees the priority: a pharmacy at another facility does not (ROUTED_DETAILS_NOT_SENT).
    expect(PRIORITY_HINT).toBe('This facility’s Pharmacy sees this on the prescription. It does not alert them, so phone if it cannot wait.')
    // The instructions stay last.
    const labels = Array.from(document.querySelectorAll('form label')).map(label => label.textContent?.replace(/\s*\*$/, ''))
    expect(labels.at(-1)).toBe('Instructions')
  })

  it('sends the details by the EHR’s names, only those given', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    change('Strength', ' 500 mg ')
    change('Form', 'capsule')
    change('How long for', '7')
    change('Days, weeks or months', 'day')
    change('Quantity to dispense', '21')
    change('Quantity unit', 'capsules')
    change('Priority', 'urgent')
    fireEvent.click(save)
    await confirmAndSave()
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![4]).toStrictEqual({
      ...TODAY_BODY, priority: 'urgent', strength: '500 mg', doseForm: 'capsule', durationUnit: 'day', quantityUnit: 'capsules',
      durationValue: 7, quantityToDispense: 21,
    })
  })

  it('sends today’s body when the details are left blank', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    fireEvent.click(save)
    await confirmAndSave()
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![4]).toStrictEqual(TODAY_BODY)
  })

  it('checks the details as the EHR does, in plain words, and sends nothing until they pass', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    change('How long for', '7')
    fireEvent.click(save)
    expect(await screen.findByText(DURATION_PAIR)).toBeTruthy()
    expect(field('Days, weeks or months').getAttribute('aria-invalid')).toBe('true')
    change('Days, weeks or months', 'week')
    change('How long for', '3651')
    change('Quantity unit', 'capsules')
    fireEvent.click(save)
    expect(await screen.findByText(DURATION_NUMBER_TEXT)).toBeTruthy()
    expect(screen.getByText(QUANTITY_PAIR)).toBeTruthy()
    expect(field('Quantity to dispense').getAttribute('aria-invalid')).toBe('true')
    change('How long for', '2')
    change('Quantity to dispense', '0')
    fireEvent.click(save)
    expect(await screen.findByText(QUANTITY_NUMBER_TEXT)).toBeTruthy()
    change('Quantity to dispense', '2.12345')
    fireEvent.click(save)
    expect(await screen.findByText(QUANTITY_NUMBER_TEXT)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    // ".5" is written "0.5" as it is typed, as the dose is.
    change('Quantity to dispense', '.5')
    expect(field('Quantity to dispense').value).toBe('0.5')
    fireEvent.click(save)
    await confirmAndSave()
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(1))
    expect(api.createRecord.mock.calls[0]![4]).toMatchObject({ durationValue: 2, durationUnit: 'week', quantityToDispense: 0.5, quantityUnit: 'capsules' })
  })

  it('marks a detail the EHR refused at its field, in plain words', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    change('Strength', '500 mg')
    api.createRecord.mockRejectedValue(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'strength', messages: ['strength must be shorter than or equal to 80 characters'] }],
    }))
    fireEvent.click(save)
    await confirmAndSave()
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(field('Strength').getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Use 80 characters or fewer.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('shorter than or equal')
  })

  it('says an incomplete pair the EHR refused in plain words, without its code', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    api.createRecord.mockRejectedValue(new HidApiError(400, 'Duration value and unit must be supplied together', { code: 'DURATION_INCOMPLETE' }))
    fireEvent.click(save)
    await confirmAndSave()
    expect((await screen.findByRole('alert')).textContent).toBe(DURATION_PAIR)
    expect(document.body.textContent).not.toContain('DURATION_INCOMPLETE')
    expect(document.body.textContent).not.toContain('supplied together')
  })

  it('takes the details off the form when the EHR no longer takes them, and then saves today’s body', async () => {
    const save = await form()
    await screen.findByLabelText(labelled('Strength'))
    fillToday()
    change('Priority', 'urgent')
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'priority', messages: ['property priority should not exist'] }],
    }))
    fireEvent.click(save)
    await confirmAndSave()
    expect((await screen.findByRole('alert')).textContent).toBe(DETAILS_NOT_TAKEN)
    expect(document.body.textContent).not.toContain('should not exist')
    for (const label of DETAIL_LABELS) expect(screen.queryByLabelText(labelled(label))).toBeNull()
    fireEvent.click(save)
    await confirmAndSave()
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(api.createRecord.mock.calls[1]![4]).toStrictEqual(TODAY_BODY)
  })
})

describe('A prescription’s page', () => {
  async function openRx() {
    renderPage(<Consult />, 'consult', `/${orderPath(ENCOUNTER_ID, 'pharmacy', RX)}`)
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Amoxicillin')
  }

  function savedValue(label: string) {
    return (screen.getByText(label, { selector: 'dt' }).nextElementSibling as HTMLElement).textContent
  }

  it('shows the details the EHR answered', async () => {
    items = [prescription({ strength: '500 mg', doseForm: 'capsule', durationValue: 7, durationUnit: 'day', quantityToDispense: 21, quantityUnit: 'capsules', priority: 'urgent' })]
    listExtra = { dispensingDetails: true }
    await openRx()
    expect(savedValue('Strength')).toBe('500 mg')
    expect(savedValue('Form')).toBe('Capsule')
    expect(savedValue('How long for')).toBe('7 days')
    expect(savedValue('Quantity to dispense')).toBe('21 capsules')
    expect(savedValue('Priority')).toBe('Urgent')
  })

  it('shows none of those lines for a prescription without them', async () => {
    await openRx()
    for (const label of ['Strength', 'Form', 'How long for', 'Quantity to dispense', 'Priority']) {
      expect(screen.queryByText(label, { selector: 'dt' })).toBeNull()
    }
  })
})

describe('Sending a prescription to a pharmacy at another facility', () => {
  const ALL_DETAILS = { strength: '500 mg', doseForm: 'capsule', durationValue: 7, durationUnit: 'day', quantityToDispense: 21, quantityUnit: 'capsules', priority: 'urgent' }

  beforeEach(() => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = [...READ_WRITE, 'ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.order-route.send']
    listExtra = { dispensingDetails: true, crossFacilityOrders: true }
    routes.attestation.mockImplementation(async (_facility: string, kind: string) => ({
      kind, version: `order-route-${kind}-attestation-v1`, text: 'I confirm that {patient} agreed that {orderingFacility} sends this to {receivingFacility}.',
    }))
    routes.destinations.mockResolvedValue({ items: [
      { facilityId: 'f0000000-0000-4000-8000-0000000000a1', facilityName: 'Demo Pharmacy', organizationName: null, registeredAddress: null, newOnHealthId: false },
    ] })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function openSend(kind: 'pharmacy' | 'laboratory', id: string, action: string, search: string) {
    renderPage(<Consult />, 'consult', `/${orderPath(ENCOUNTER_ID, kind, id)}`)
    await screen.findByRole('heading', { level: 1 })
    fireEvent.click(await screen.findByRole('button', { name: action }))
    expect(await screen.findByLabelText(labelled(search))).toBeTruthy()
  }

  it('says first that the pharmacy there will not see the details this prescription carries, and ties Send to it', async () => {
    items = [prescription({ orderRoute: null, ...ALL_DETAILS })]
    await openSend('pharmacy', RX, 'Send to a pharmacy', 'Search for the pharmacy')
    const note = screen.getByText(ROUTED_DETAILS_NOT_SENT)
    expect(note.className).toContain('hid-ehr-clinical-orders-notice')
    expect(ROUTED_DETAILS_NOT_SENT).toBe('A pharmacy at another facility will not see the strength, form, how long for, quantity to dispense or priority. '
      + 'Write them in the instructions.')
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-describedby')).toBe(note.id)
    // It stays while the pharmacy is chosen, up to Send.
    change('Search for the pharmacy', 'Demo Pharmacy')
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('radio', { name: /^Demo Pharmacy/ }))
    expect(screen.getByRole('button', { name: 'Send to Demo Pharmacy' }).getAttribute('aria-describedby')).toBe(note.id)
    expect(screen.getByText(ROUTED_DETAILS_NOT_SENT)).toBe(note)
  })

  it('says so for a prescription carrying one detail only', async () => {
    items = [prescription({ orderRoute: null, priority: 'stat' })]
    await openSend('pharmacy', RX, 'Send to a pharmacy', 'Search for the pharmacy')
    expect(screen.getByText(ROUTED_DETAILS_NOT_SENT)).toBeTruthy()
  })

  it('says nothing of the details for a prescription without them', async () => {
    items = [prescription({ orderRoute: null })]
    await openSend('pharmacy', RX, 'Send to a pharmacy', 'Search for the pharmacy')
    expect(screen.queryByText(ROUTED_DETAILS_NOT_SENT)).toBeNull()
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('aria-describedby')).toBe(false)
  })

  it('says nothing of them for a lab request, though it has a priority', async () => {
    items = [labRequest({ orderRoute: null, priority: 'urgent' })]
    await openSend('laboratory', LAB, 'Send to another laboratory', 'Search for the laboratory')
    expect(screen.queryByText(ROUTED_DETAILS_NOT_SENT)).toBeNull()
  })

  it('chooses no pharmacy while prescribing: the prescription is sent elsewhere from its own page, where it says so', async () => {
    await form()
    await screen.findByLabelText(labelled('Strength'))
    change('Strength', '500 mg')
    change('Priority', 'urgent')
    expect(screen.getByText(PRESCRIPTION_ROUTING_HINT)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Search for the pharmacy'))).toBeNull()
    expect(screen.queryByText(ROUTED_DETAILS_NOT_SENT)).toBeNull()
  })
})

describe('prescriptionDetails', () => {
  it('reads the flag only as an explicit true', () => {
    expect(takesDispensingDetails({ items: [], dispensingDetails: true })).toBe(true)
    for (const answer of [null, undefined, {}, { dispensingDetails: false }, { dispensingDetails: 'true' }, { items: [{ dispensingDetails: true }] }]) {
      expect(takesDispensingDetails(answer)).toBe(false)
    }
  })

  it('checks and sends nothing while the EHR does not take them', () => {
    const values = { durationValue: 'x', quantityToDispense: '-1', priority: 'urgent' }
    expect(checkDetails(values, false)).toEqual({})
    expect(detailsBody(values, false)).toEqual({})
  })

  it('keeps the EHR’s limits', () => {
    expect(checkDetails({ durationValue: '1', durationUnit: 'day' }, true)).toEqual({})
    expect(checkDetails({ durationValue: '3650', durationUnit: 'day' }, true)).toEqual({})
    expect(checkDetails({ durationValue: '0', durationUnit: 'day' }, true)).toEqual({ durationValue: DURATION_NUMBER_TEXT })
    expect(checkDetails({ durationValue: '1.5', durationUnit: 'day' }, true)).toEqual({ durationValue: DURATION_NUMBER_TEXT })
    expect(checkDetails({ durationUnit: 'day' }, true)).toEqual({ durationValue: DURATION_PAIR })
    expect(checkDetails({ quantityToDispense: '99999999.9999', quantityUnit: 'tablets' }, true)).toEqual({})
    expect(checkDetails({ quantityToDispense: '0.0001', quantityUnit: 'mL' }, true)).toEqual({})
    expect(checkDetails({ quantityToDispense: '100000000', quantityUnit: 'tablets' }, true)).toEqual({ quantityToDispense: QUANTITY_NUMBER_TEXT })
    expect(checkDetails({ quantityToDispense: '0.0000', quantityUnit: 'tablets' }, true)).toEqual({ quantityToDispense: QUANTITY_NUMBER_TEXT })
    expect(checkDetails({ quantityToDispense: '21' }, true)).toEqual({ quantityUnit: QUANTITY_PAIR })
  })

  it('says a saved duration in words', () => {
    expect(detailLines({ durationValue: 1, durationUnit: 'week' })).toEqual([{ label: 'How long for', value: '1 week' }])
    expect(detailLines({ durationValue: 3, durationUnit: 'month' })).toEqual([{ label: 'How long for', value: '3 months' }])
    expect(detailLines({ quantityToDispense: '2.5', quantityUnit: 'mL' })).toEqual([{ label: 'Quantity to dispense', value: '2.5 mL' }])
    expect(detailLines({ priority: 'stat' })).toEqual([{ label: 'Priority', value: 'Stat' }])
    expect(detailLines({})).toEqual([])
  })
})
