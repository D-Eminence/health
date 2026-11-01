import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { CHOOSE_FIRST } from '../../../ehr-blue/clinical/parts/chart'
import { PatientsWorkspace } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import { clinicalReturnPath } from '../../../ehr-blue/clinical/returnPaths'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup } from './harness'

/**
 * A clinical page reached by its address alone, as after signing in again: no open patient, no router state, nothing
 * handed over in memory. It opens no patient from the address and reads nothing until the person opens the patient
 * again through Find a patient (a fresh lookup on the server); then the page checks access on the server again before
 * it reads the record, and shows only a record of that patient and consultation. Everything is fictional.
 */

/** Every call made to staffApi and orderRoutesApi, whatever its name, so "nothing was read" means nothing at all. */
const calls = vi.hoisted(() => {
  const made: Record<string, Mock> = {}
  const recorder = (prefix: string) => new Proxy({}, {
    get: (_target, name) => typeof name === 'string' ? (made[`${prefix}.${name}`] ??= vi.fn()) : undefined,
  })
  return { made, staffApi: recorder('staffApi'), orderRoutesApi: recorder('orderRoutesApi') }
})
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({
  staffApi: calls.staffApi,
  orderRoutesApi: calls.orderRoutesApi,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({
  staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {}, staffSessionSignal: () => new AbortController().signal,
}))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))

const api = (name: string) => calls.staffApi[name as never] as Mock

const RX = 'b0000000-0000-4000-8000-000000000001'
const LAB = 'c0000000-0000-4000-8000-000000000001'
const OTHER_PATIENT = 'a0000000-0000-4000-8000-000000000002'
const OTHER_ENCOUNTER = 'e2222222-0000-4000-8000-000000000002'
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const PERMISSIONS = [
  'identity.patient.read', 'ehr.encounter.read', 'ehr.note.read', 'ehr.diagnosis.read', 'ehr.document.read', 'ehr.prescription.read', 'ehr.lab-request.read',
]
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const PRESCRIPTION = {
  id: RX, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z', medicationDisplay: 'Amoxicillin',
  doseQuantity: 500, doseUnit: 'mg', routeCode: 'oral', frequency: 'Twice daily', instructions: 'After meals', status: 'draft', rowVersion: 1,
}
const LAB_REQUEST = {
  id: LAB, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:05:00.000Z', testCodeSystem: 'LOINC', testCode: '718-7',
  testDisplay: 'Haemoglobin', priority: 'routine', specimenTypeCode: 'blood', clinicalInformation: 'Tired for two weeks', status: 'draft', rowVersion: 1,
}

let lists: Record<string, unknown[]>
/** Every address the app was at, with any router state, in order. */
let seen: string[]

beforeEach(() => {
  for (const fn of Object.values(calls.made)) fn.mockReset()
  staff.permissions = [...PERMISSIONS]
  staff.activePatient = null
  staff.setActivePatient.mockReset()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  seen = []
  lists = { prescriptions: [PRESCRIPTION], 'lab-requests': [LAB_REQUEST], 'clinical-notes': [], diagnoses: [], vitals: [] }
  api('lookupPatient').mockResolvedValue(allowedLookup)
  api('consentStatus').mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api('encounter').mockResolvedValue(ENCOUNTER)
  api('encounters').mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api('records').mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) => ({ items: lists[kind] ?? [], nextCursor: null }))
  api('documents').mockResolvedValue({ items: [], nextCursor: null })
  api('noteRevisions').mockResolvedValue([])
  api('reportedHealthProfile').mockResolvedValue(null)
  api('sharedWithMe').mockRejectedValue(NOT_FOUND)
  api('staffShareInvitations').mockRejectedValue(NOT_FOUND)
})

function Seen() {
  const location = useLocation()
  useEffect(() => {
    seen.push(`${location.pathname}${location.search}${location.hash}${location.state == null ? '' : ` ${JSON.stringify(location.state)}`}`)
  }, [location])
  return null
}

/** The clinical workspaces as the frame mounts them under /provider, opened at one address with no router state. */
function openAt(address: string) {
  return render(
    <MemoryRouter initialEntries={[address]}>
      <Seen />
      <Routes>
        <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
        <Route path="/provider/patients/*" element={<PatientsWorkspace />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Lets every effect and promise the first render started run to its end. */
async function settle() {
  for (let round = 0; round < 5; round += 1) await act(async () => {})
}

function called(): string[] {
  return Object.entries(calls.made).filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name)
}

/** Nothing of the patient in any address, tab title or router state the app was at. */
function expectNothingIdentifying() {
  for (const value of [...seen, document.title]) {
    expect(value).not.toMatch(/HID-|ZDEMAAA2/i)
    expect(value).not.toContain(PATIENT_ID)
    expect(value).not.toContain(PATIENT_NAME)
  }
}

const ENCOUNTER_PAGE = `/provider/clinical/${ENCOUNTER_ID}`
const PRESCRIPTION_PAGE = `/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${RX}`
const LAB_REQUEST_PAGE = `/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB}`
const PATIENT_PAGE = '/provider/patients/open'

describe('A clinical page reached by its address alone', () => {
  it('is an address a sign-in may come back to, by record ids only; the open patient’s page is not', () => {
    for (const page of [ENCOUNTER_PAGE, PRESCRIPTION_PAGE, LAB_REQUEST_PAGE]) expect(clinicalReturnPath(page)).toBe(page)
    expect(clinicalReturnPath(PATIENT_PAGE)).toBeNull()
  })

  it.each([
    ['a consultation', ENCOUNTER_PAGE],
    ['a prescription', PRESCRIPTION_PAGE],
    ['a lab request', LAB_REQUEST_PAGE],
    ['the patient page', PATIENT_PAGE],
  ])('%s opens no patient and reads nothing: it asks for the patient first', async (_name, address) => {
    openAt(address)
    expect(await screen.findByText(CHOOSE_FIRST)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
    await settle()
    expect(called()).toEqual([])
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.queryByText(PATIENT_NAME)).toBeNull()
    expect(seen).toEqual([address])
    expectNothingIdentifying()
  })

  it.each([
    `/provider/clinical/${PATIENT_HID}`, `/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${PATIENT_HID}`,
    `/provider/clinical/${PATIENT_HID}/orders/laboratory/${LAB}`, `/provider/patients/${PATIENT_HID}`, `/provider/patients/open?hid=${PATIENT_HID}`,
  ])('opens nobody from a Health ID typed into the address, and would never come back to it: %s', async address => {
    openAt(address)
    await settle()
    expect(called()).toEqual([])
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.queryByText(PATIENT_NAME)).toBeNull()
    expect(clinicalReturnPath(address)).toBeNull()
  })

  it('leads back through Find a patient: the patient opens only by a fresh lookup of what was typed, and the page checks access again before it reads', async () => {
    openAt(PRESCRIPTION_PAGE)
    fireEvent.click(await screen.findByRole('link', { name: 'Find a patient' }))
    fireEvent.change(await screen.findByLabelText('Health ID'), { target: { value: 'hid-zdemaaa2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    // The lookup is of what was typed, at the working facility, for direct care: nothing came from the address.
    expect(api('lookupPatient').mock.calls[0]).toEqual([FACILITY_ID, PATIENT_HID, 'direct-care'])
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' })
    // The patient page checks access again before it reads this facility's visits.
    await waitFor(() => expect(api('encounters')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID))
    expect(api('lookupPatient')).toHaveBeenCalledTimes(2)
    expect(api('lookupPatient').mock.invocationCallOrder[1]!).toBeLessThan(api('encounters').mock.invocationCallOrder[0]!)
    // Nothing of the prescription was read on the way; the addresses named no patient.
    expect(api('records')).not.toHaveBeenCalled()
    expect(seen).toEqual([PRESCRIPTION_PAGE, '/provider/patients', PATIENT_PAGE])
    expectNothingIdentifying()
  })
})

describe('With the patient opened again, the page checks access on the server before it reads', () => {
  beforeEach(() => {
    staff.activePatient = activePatient()
  })

  it('a consultation: the re-check, then the encounter', async () => {
    openAt(ENCOUNTER_PAGE)
    await waitFor(() => expect(api('encounter')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID))
    expect(api('lookupPatient')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api('lookupPatient').mock.invocationCallOrder[0]!).toBeLessThan(api('encounter').mock.invocationCallOrder[0]!)
  })

  it.each([
    ['a prescription', PRESCRIPTION_PAGE, 'prescriptions', 'Amoxicillin'],
    ['a lab request', LAB_REQUEST_PAGE, 'lab-requests', 'Haemoglobin'],
  ])('%s: the re-check, then the order', async (_name, address, kind, title) => {
    openAt(address)
    expect(await screen.findByRole('heading', { level: 1, name: new RegExp(title) })).toBeTruthy()
    expect(api('records')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, kind)
    expect(api('lookupPatient')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api('lookupPatient').mock.invocationCallOrder[0]!).toBeLessThan(api('records').mock.invocationCallOrder[0]!)
  })

  it('the patient page: the re-check, then this facility’s visits', async () => {
    openAt(PATIENT_PAGE)
    await waitFor(() => expect(api('encounters')).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID))
    expect(api('lookupPatient').mock.invocationCallOrder[0]!).toBeLessThan(api('encounters').mock.invocationCallOrder[0]!)
  })

  it.each([
    ['a consultation', ENCOUNTER_PAGE, 'encounter'],
    ['a prescription', PRESCRIPTION_PAGE, 'records'],
    ['a lab request', LAB_REQUEST_PAGE, 'records'],
  ])('%s: a refused re-check closes the patient and reads nothing', async (_name, address, read) => {
    api('lookupPatient').mockResolvedValue(deniedLookup)
    openAt(address)
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    await settle()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api(read)).not.toHaveBeenCalled()
    expect(screen.queryByText(PATIENT_NAME)).toBeNull()
  })

  it.each([
    ['a prescription', PRESCRIPTION_PAGE, 'prescriptions', PRESCRIPTION],
    ['a lab request', LAB_REQUEST_PAGE, 'lab-requests', LAB_REQUEST],
  ])('%s of another patient or consultation is not shown under the open patient', async (_name, address, kind, order) => {
    for (const stranger of [{ ...order, patientId: OTHER_PATIENT }, { ...order, encounterId: OTHER_ENCOUNTER }]) {
      lists[kind] = [stranger]
      const view = openAt(address)
      expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
      view.unmount()
    }
  })
})
