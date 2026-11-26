import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { NursingWorkspace } from '../../../ehr-blue/clinical/nursing/NursingWorkspace'
import { ACCESS_ENDED } from '../../../ehr-blue/clinical/parts/chart'
import { NO_RECORD_ACCESS } from '../../../ehr-blue/clinical/triage/records'
import { TriageWorkspace } from '../../../ehr-blue/clinical/triage/TriageWorkspace'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, labelled } from './harness'

/**
 * The consultation's remaining parity rows (docs/BLUE_EHR_PARITY_2026-11-01.md), each as classic's
 * staff/routes/Clinical.tsx behaves: the access re-check on every visit load but the one opened from the list
 * (3.3-28), the Consultation, Triage & Vitals and Nursing observations pages opened by a role that can't read their
 * records saying so per card (3.3-50), and the Diagnoses card's badge and form (3.3-38, 3.3-39). Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(),
  documents: vi.fn(), vitalCorrections: vi.fn(), reportedHealthProfile: vi.fn(), createRecord: vi.fn(), allergies: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Connected orders</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const DIAGNOSIS = {
  id: 'dx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:20:00.000Z', codeSystem: 'ICD-10', code: 'B54',
  display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'provisional', rowVersion: 1,
}

let diagnoses: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  staff.facilityId = undefined
  staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  diagnoses = [DIAGNOSIS]
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'diagnoses' ? diagnoses : [], nextCursor: null }))
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.vitalCorrections.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockResolvedValue({ items: [] })
})

/** The memory router's address, and Back and Forward as the browser's buttons. */
function Browser() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <p data-testid="address">{location.pathname}</p>
      <button type="button" onClick={() => navigate(-1)}>Browser back</button>
      <button type="button" onClick={() => navigate(1)}>Browser forward</button>
    </>
  )
}

function renderApp(entry: InitialEntry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Browser />
      <Routes>
        <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
        <Route path="/provider/triage/*" element={<TriageWorkspace />} />
        <Route path="/provider/nursing/*" element={<NursingWorkspace />} />
      </Routes>
    </MemoryRouter>,
  )
}

const visitHeading = () => screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })

describe('row 3.3-28: every visit load re-checks access, but the one opened from the visit list', () => {
  it('checks again when the visit is reached by its address after a check passed elsewhere', async () => {
    // A check passes on the visit list (as after a save in another workspace)…
    renderApp('/provider/clinical')
    await screen.findByRole('link', { name: consultationLabel(ENCOUNTER) })
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    cleanup()
    // …and the visit, reached later by its address, checks again before it reads, as classic's every load (Clinical.tsx:1316).
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(await visitHeading()).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
    expect(api.lookupPatient.mock.invocationCallOrder[1]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
  })

  it('says classic’s "access ended" and closes the patient when access ended since a check passed, reading nothing', async () => {
    renderApp('/provider/clinical')
    await screen.findByRole('link', { name: consultationLabel(ENCOUNTER) })
    cleanup()
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'ACCESS_DENIED' }))
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText('Open the patient again to keep working.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounter).not.toHaveBeenCalled()
    expect(ACCESS_ENDED).toBe('Your access to this patient has ended. Open the patient again to keep working.')
  })

  it('uses the list’s check once: the same visit reached again through the browser’s history checks again', async () => {
    renderApp('/provider/clinical')
    fireEvent.click(await screen.findByRole('link', { name: consultationLabel(ENCOUNTER) }))
    expect(await visitHeading()).toBeTruthy()
    await act(async () => {})
    // Opened from the list: the list's check, no lookup of its own.
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    await screen.findByRole('link', { name: consultationLabel(ENCOUNTER) })
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Browser forward' }))
    expect(await visitHeading()).toBeTruthy()
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledTimes(3))
    expect(screen.getByTestId('address').textContent).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    // The pass rides in router state only, never in the address.
    expect(screen.getByTestId('address').textContent).not.toContain('pass')
    expect(screen.getByTestId('address').textContent).not.toContain(PATIENT_HID)
  })
})

describe('row 3.3-50: a page opened by a role that can’t read its records says so, and reads nothing', () => {
  it('Consultation: the visit list and a visit say the record pages’ sentence, with no read of the visits', async () => {
    staff.permissions = ['ehr.vital.read']
    renderApp('/provider/clinical')
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    cleanup()
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy()
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records).not.toHaveBeenCalled()
  })

  it('Consultation: still offers New consultation to a role that may start one, as classic’s encounter form', async () => {
    staff.permissions = ['ehr.encounter.write']
    renderApp('/provider/clinical')
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'New consultation' })).toBeTruthy()
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('Triage & Vitals and Nursing observations say the same sentence in their card', async () => {
    staff.permissions = ['ehr.encounter.read']
    renderApp('/provider/triage')
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy()
    cleanup()
    renderApp('/provider/nursing')
    expect(await screen.findByText(NO_RECORD_ACCESS)).toBeTruthy()
    expect(api.records).not.toHaveBeenCalled()
  })
})

describe('rows 3.3-38 and 3.3-39: the Diagnoses card', () => {
  const diagnosesCard = async () => {
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(await visitHeading()).toBeTruthy()
    return within(screen.getByRole('heading', { level: 2, name: 'Diagnoses' }).closest('section') as HTMLElement)
  }

  it('3.3-38: shows a badge only for a diagnosis entered in error, as classic (Clinical.tsx:1851); the detail line says the rest', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.diagnosis.read']
    diagnoses = [DIAGNOSIS, { ...DIAGNOSIS, id: 'dx-2', display: 'Typhoid (fictional)', verificationStatus: 'entered_in_error' },
      { ...DIAGNOSIS, id: 'dx-3', display: 'Anaemia (fictional)', clinicalStatus: 'resolved', verificationStatus: 'confirmed' }]
    const card = await diagnosesCard()
    const row = (name: string) => within(card.getByText(name).closest('li') as HTMLElement)
    expect(await card.findByText('Malaria (fictional)')).toBeTruthy()
    expect(row('Malaria (fictional)').getByText('Active · Provisional')).toBeTruthy()
    expect(row('Malaria (fictional)').queryByText('Active')).toBeNull()
    expect(row('Anaemia (fictional)').getByText('Resolved · Confirmed')).toBeTruthy()
    expect(row('Anaemia (fictional)').queryByText('Resolved')).toBeNull()
    expect(row('Typhoid (fictional)').getByText('Entered in error')).toBeTruthy()
  })

  it('3.3-39: labels the first field classic’s "Display", and its two status selects offer no blank choice', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.diagnosis.read', 'ehr.diagnosis.write']
    const card = await diagnosesCard()
    const form = (await card.findByRole('button', { name: 'Save record' })).closest('form') as HTMLFormElement
    expect(within(form).getByLabelText(labelled('Display'))).toBeTruthy()
    expect(within(form).queryByLabelText(labelled('Diagnosis'))).toBeNull()
    const options = (label: string) => Array.from((within(form).getByLabelText(labelled(label)) as HTMLSelectElement).options, option => option.textContent)
    expect(options('Clinical status')).not.toContain('Select…')
    expect(options('Verification')).not.toContain('Select…')
    expect((within(form).getByLabelText(labelled('Clinical status')) as HTMLSelectElement).value).toBe('active')
    expect((within(form).getByLabelText(labelled('Verification')) as HTMLSelectElement).value).toBe('unconfirmed')
  })
})
