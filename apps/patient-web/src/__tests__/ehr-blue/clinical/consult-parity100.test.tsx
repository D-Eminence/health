import { HidApiError } from '@hid/http'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { NOTES_ARE_DRAFTS, NO_COMPLAINT, NO_WRITE as CONSULT_NO_WRITE } from '../../../ehr-blue/clinical/consult/encounters'
import { KINDS } from '../../../ehr-blue/clinical/consult/orders/orders'
import { NO_CHANGES } from '../../../ehr-blue/clinical/consult/orders/words'
import { NO_VITALS } from '../../../ehr-blue/clinical/consult/Vitals'
import { ACCESS_ENDED, OPEN_EMERGENCY_SUMMARY } from '../../../ehr-blue/clinical/parts/chart'
import { TriageWorkspace } from '../../../ehr-blue/clinical/triage/TriageWorkspace'
import { NO_WRITE as TRIAGE_NO_WRITE } from '../../../ehr-blue/clinical/triage/records'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * The consultation's parity rows (docs/BLUE_EHR_PARITY_2026-11-01.md, group "consultation"), each as classic's
 * staff/routes/Clinical.tsx behaves and says it: the visit's Vitals card corrects a vital in place, a visit reads its
 * order and document lists only once their cards are in view, the write check is asked once for every workspace, a
 * visit opened from the list makes no lookup of its own, emergency access opens the read-only summary, and the start,
 * note, diagnosis and document words. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(),
  documents: vi.fn(), vitalCorrections: vi.fn(), reportedHealthProfile: vi.fn(), createRecord: vi.fn(), correctVital: vi.fn(),
  createEncounter: vi.fn(), allergies: vi.fn(),
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
const VITAL = {
  id: 'vital-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:05:00.000Z', status: 'final',
  systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 80, currentCorrectionNo: 0, rowVersion: '1',
}
const DOCUMENT = {
  id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: 20480, status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:10:00.000Z',
}

let vitals: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  staff.facilityId = undefined
  staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  vitals = [VITAL]
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'vitals' ? vitals : [], nextCursor: null }))
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.vitalCorrections.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockResolvedValue({ items: [] })
  api.correctVital.mockResolvedValue({ id: 'correction-1' })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The memory router's address. */
function Address() {
  const location = useLocation()
  return <p data-testid="address">{location.pathname}</p>
}

function renderApp(entry: InitialEntry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Address />
      <Routes>
        <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
        <Route path="/provider/triage/*" element={<TriageWorkspace />} />
        <Route path="/provider/emergency/*" element={<p>Emergency summary page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openVisit() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
}

function card(title: string) {
  return within(screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement)
}

const readsOf = (kind: string) => api.records.mock.calls.filter(call => call[3] === kind)

describe('row 1b: the refusal of a change without write access is classic’s (Clinical.tsx:1492, :1676)', () => {
  it('says it in the order form, triage, nursing and the consultation alike', () => {
    const classic = 'Your access doesn’t allow changes to this patient’s records.'
    expect(NO_CHANGES).toBe(classic)
    expect(TRIAGE_NO_WRITE).toBe(classic)
    expect(CONSULT_NO_WRITE).toBe(classic)
  })
})

describe('rows 3 and 3b: the Vitals card on the consultation page', () => {
  it('says classic’s empty sentence, and the order lists say "encounter" too (row 5a)', async () => {
    expect(NO_VITALS).toBe('No vitals for this encounter.')
    expect(KINDS.pharmacy.empty).toBe('No prescriptions for this encounter.')
    expect(KINDS.laboratory.empty).toBe('No lab requests for this encounter.')
    vitals = []
    await openVisit()
    expect(await card('Vitals').findByText('No vitals for this encounter.')).toBeTruthy()
  })

  it('corrects a vital in place with classic’s "Correct these vitals" / "Close correction", after the re-check, then reads the vitals again', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write']
    await openVisit()
    const vitalsCard = card('Vitals')
    const open = await vitalsCard.findByRole('button', { name: 'Correct these vitals' })
    fireEvent.click(open)
    expect(open.textContent).toBe('Close correction')
    expect(open.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(open)
    expect(vitalsCard.queryByRole('button', { name: 'Save correction' })).toBeNull()
    fireEvent.click(open)
    const form = vitalsCard.getByRole('button', { name: 'Save correction' }).closest('form') as HTMLFormElement
    fireEvent.change(within(form).getByLabelText('Pulse (bpm)'), { target: { value: '92' } })
    fireEvent.change(within(form).getByLabelText(labelled('Reason for correction')), { target: { value: 'Repeat reading' } })
    const readsBefore = readsOf('vitals').length
    const checksBefore = api.lookupPatient.mock.calls.length
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(await vitalsCard.findByText('Vital correction saved.')).toBeTruthy()
    expect(api.correctVital).toHaveBeenCalledTimes(1)
    const [facility, patient, encounter, vital, body, key] = api.correctVital.mock.calls[0]!
    expect([facility, patient, encounter, vital]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vital-1'])
    expect(body).toEqual({ expectedRowVersion: 1, changeReason: 'Repeat reading', replacementValues: { systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 92 } })
    expect(typeof key).toBe('string')
    // The re-check before the save, then the vitals read again.
    expect(api.lookupPatient.mock.calls.length).toBe(checksBefore + 1)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.correctVital.mock.invocationCallOrder[0]!)
    await waitFor(() => expect(readsOf('vitals').length).toBeGreaterThan(readsBefore))
    expect(vitalsCard.queryByRole('button', { name: 'Save correction' })).toBeNull()
  })

  it('says classic’s RETRACTED_SINCE when a 412 refuses a vital now entered in error, and CHANGED_SINCE when it was only corrected', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write']
    const attempt = async () => {
      const vitalsCard = card('Vitals')
      fireEvent.click(await vitalsCard.findByRole('button', { name: 'Correct these vitals' }))
      const form = vitalsCard.getByRole('button', { name: 'Save correction' }).closest('form') as HTMLFormElement
      fireEvent.change(within(form).getByLabelText('Pulse (bpm)'), { target: { value: '92' } })
      fireEvent.change(within(form).getByLabelText(labelled('Reason for correction')), { target: { value: 'Repeat reading' } })
      fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    }
    api.correctVital.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'PRECONDITION_FAILED' }))
    await openVisit()
    // Entered in error since it was loaded: the 412's read again finds it so.
    vitals = [{ ...VITAL, status: 'entered_in_error', rowVersion: '2' }]
    await attempt()
    expect(await card('Vitals').findByText('These vitals were marked entered in error since they were loaded, so the correction was not saved. The list was reloaded.')).toBeTruthy()
    cleanup()
    staff.activePatient = activePatient()
    vitals = [VITAL]
    api.correctVital.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'PRECONDITION_FAILED' }))
    await openVisit()
    vitals = [{ ...VITAL, rowVersion: '2' }]
    await attempt()
    expect(await card('Vitals').findByText(/^These vitals changed since they were loaded, so the correction was not saved/)).toBeTruthy()
  })

  it('offers no correction without vitals write, under a read-only grant, or for vitals entered in error', async () => {
    await openVisit()
    await card('Vitals').findByText('120/80')
    expect(card('Vitals').queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    cleanup()
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write']
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openVisit()
    await screen.findByText('You can view this record but not change it.')
    expect(card('Vitals').queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    cleanup()
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    vitals = [{ ...VITAL, status: 'entered_in_error' }]
    await openVisit()
    await card('Vitals').findByText('Entered in error')
    expect(card('Vitals').queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
  })
})

/** An IntersectionObserver that reports nothing in view until the test says so; what it watches is kept in `watched`. */
function stubObserver() {
  const watched: { element: Element; callback: IntersectionObserverCallback; observer: IntersectionObserver }[] = []
  class Observer {
    constructor(readonly callback: IntersectionObserverCallback) {}
    observe(element: Element) { watched.push({ element, callback: this.callback, observer: this as unknown as IntersectionObserver }) }
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  return watched
}

const EVERY_LIST = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.note.read', 'ehr.diagnosis.read', 'ehr.prescription.read', 'ehr.lab-request.read', 'ehr.document.read']

describe('row 25: a visit reads each record list only once its card is in view', () => {
  it('reads the lab requests and documents when their card comes into view, not when the visit opens', async () => {
    const watched = stubObserver()
    staff.permissions = EVERY_LIST
    await openVisit()
    await card('Vitals').findByText('120/80')
    await act(async () => {})
    // The top of the page is read at once, the prescriptions "Print prescription" prints with it; the lab requests and
    // documents are not.
    expect(readsOf('vitals')).toHaveLength(1)
    expect(readsOf('clinical-notes')).toHaveLength(1)
    expect(readsOf('diagnoses')).toHaveLength(1)
    expect(readsOf('prescriptions')).toHaveLength(1)
    expect(readsOf('lab-requests')).toHaveLength(0)
    expect(api.documents).not.toHaveBeenCalled()
    const seen = (title: string) => {
      const section = screen.getByRole('heading', { level: 2, name: title }).closest('section')!
      const entry = watched.find(item => item.element.contains(section))!
      act(() => entry.callback([{ isIntersecting: true, target: entry.element } as IntersectionObserverEntry], entry.observer))
    }
    seen('Documents')
    await waitFor(() => expect(api.documents).toHaveBeenCalledTimes(1))
    expect(readsOf('lab-requests')).toHaveLength(0)
    seen('Orders')
    await waitFor(() => expect(readsOf('lab-requests')).toHaveLength(1))
    expect(readsOf('prescriptions')).toHaveLength(1)
  })

  it('offers both print actions before the Orders card is in view: the prescription at once, the discharge summary in one press', async () => {
    stubObserver()
    staff.permissions = EVERY_LIST
    const rx = { id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', status: 'active', medicationDisplay: 'Paracetamol', frequency: 'Daily' }
    const lab = { id: 'lab-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:45:00.000Z', status: 'active', testDisplay: 'Malaria smear' }
    let answerLabs: (page: { items: unknown[]; nextCursor: null }) => void = () => {}
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'lab-requests') return new Promise(resolve => { answerLabs = resolve })
      return { items: kind === 'vitals' ? vitals : kind === 'prescriptions' ? [rx] : [], nextCursor: null }
    })
    const papers: string[] = []
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      const paper = document.querySelector('[data-clinical-print]')
      papers.push(`${paper?.getAttribute('data-clinical-print')}: ${paper?.textContent ?? ''}`)
    })
    try {
      await openVisit()
      const actions = card('Actions')
      // "Print prescription" is there as the visit opens, with no scrolling.
      fireEvent.click(await actions.findByRole('button', { name: 'Print prescription' }))
      expect(printSpy).toHaveBeenCalledTimes(1)
      expect(papers[0]).toMatch(/^prescription: .*Paracetamol/)
      act(() => { window.dispatchEvent(new Event('afterprint')) })
      // "Print discharge summary" is not shown as unavailable, and no wait line shows before a press.
      const discharge = actions.getByRole('button', { name: 'Print discharge summary' })
      expect(discharge.getAttribute('aria-disabled')).toBeNull()
      expect(actions.queryByText(/can be printed once the visit’s diagnoses, note, tests and medicines have loaded/)).toBeNull()
      expect(readsOf('lab-requests')).toHaveLength(0)
      // One press reads the lab requests, says to wait, and prints once they are read, with no second press.
      fireEvent.click(discharge)
      await waitFor(() => expect(readsOf('lab-requests')).toHaveLength(1))
      expect(discharge.getAttribute('aria-disabled')).toBe('true')
      expect(actions.getByText(/can be printed once the visit’s diagnoses, note, tests and medicines have loaded/)).toBeTruthy()
      expect(printSpy).toHaveBeenCalledTimes(1)
      await act(async () => { answerLabs({ items: [lab], nextCursor: null }) })
      await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(2))
      expect(papers[1]).toMatch(/^discharge: .*Malaria smear.*Paracetamol/)
      expect(actions.queryByText(/can be printed once the visit’s diagnoses, note, tests and medicines have loaded/)).toBeNull()
      expect(discharge.getAttribute('aria-disabled')).toBeNull()
      act(() => { window.dispatchEvent(new Event('afterprint')) })
      // It printed once: nothing prints again on its own.
      await act(async () => {})
      expect(printSpy).toHaveBeenCalledTimes(2)
    } finally {
      printSpy.mockRestore()
    }
  })
})

describe('rows 3.3-5, 3.3-6 and 3.3-28: one write check, and no extra lookup when a visit opens from the list', () => {
  it('asks consentStatus once for the open patient, whichever workspace is opened next', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write']
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    const link = await screen.findByRole('link', { name: 'Record vitals' })
    expect(api.consentStatus).toHaveBeenCalledTimes(1)
    fireEvent.click(link)
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe('/provider/triage/new'))
    await act(async () => {})
    expect(api.consentStatus).toHaveBeenCalledTimes(1)
  })

  it('reuses the list’s access check when a visit is opened from it; every save still checks', async () => {
    renderApp('/provider/clinical')
    const row = await screen.findByRole('link', { name: consultationLabel(ENCOUNTER) })
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    fireEvent.click(row)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    await act(async () => {})
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
  })

  it('still checks first when the visit is reached by its address, and says classic’s words when access ended', async () => {
    expect(ACCESS_ENDED).toBe('Your access to this patient has ended. Open the patient again to keep working.')
    await openVisit()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
  })
})

describe('rows 3.3-8 and 3.3-29: emergency access opens the read-only emergency summary', () => {
  it('takes a role that may open the summary straight there from the chart, with no extra click', async () => {
    staff.permissions = ['ehr.encounter.read', 'identity.break-glass.write']
    staff.activePatient = activePatient('emergency')
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Emergency summary page')).toBeTruthy()
    expect(screen.getByTestId('address').textContent).toBe('/provider/emergency/summary')
    expect(api.encounter).not.toHaveBeenCalled()
  })

  it('links to it in classic’s words for a role that may not open it here', async () => {
    staff.permissions = ['ehr.encounter.read']
    staff.activePatient = activePatient('emergency')
    renderApp(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(OPEN_EMERGENCY_SUMMARY).toBe('Open read-only emergency summary →')
    expect(await screen.findByRole('link', { name: 'Open read-only emergency summary →' })).toBeTruthy()
    expect(screen.queryByText('Open the emergency summary')).toBeNull()
  })
})

describe('rows 3.3-30 and 3.3-31: the list and starting a visit', () => {
  it('says classic’s words for a visit with no complaint', async () => {
    expect(NO_COMPLAINT).toBe('No chief complaint provided')
    api.encounters.mockResolvedValue({ items: [{ ...ENCOUNTER, chiefComplaint: null }], nextCursor: null })
    renderApp('/provider/clinical')
    expect((await screen.findAllByText('No chief complaint provided')).length).toBeGreaterThan(0)
  })

  it('offers the note saved in the same press only with ehr.note.read as well as ehr.note.write', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.write']
    renderApp('/provider/clinical/new')
    expect(await screen.findByRole('button', { name: 'Start consultation' })).toBeTruthy()
    expect(screen.queryByLabelText('History')).toBeNull()
    expect(screen.queryByText(NOTES_ARE_DRAFTS)).toBeNull()
    cleanup()
    staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write']
    staff.activePatient = activePatient()
    renderApp('/provider/clinical/new')
    expect(await screen.findByLabelText('History')).toBeTruthy()
    // Classic's draft hint (row 3.3-34).
    expect(screen.getByText('Notes are saved as drafts. Signing needs its own reviewed action.')).toBeTruthy()
  })
})

describe('row 3.3-39: adding a diagnosis', () => {
  it('saves with classic’s "Save record", and an empty required field says the browser’s own message', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.diagnosis.read', 'ehr.diagnosis.write']
    await openVisit()
    const diagnoses = card('Diagnoses')
    const save = await diagnoses.findByRole('button', { name: 'Save record' })
    expect(diagnoses.queryByRole('button', { name: 'Add diagnosis' })).toBeNull()
    fireEvent.click(save)
    const display = diagnoses.getByLabelText(labelled('Diagnosis')) as HTMLInputElement
    expect(display.validationMessage).not.toBe('')
    expect(diagnoses.getAllByText(display.validationMessage).length).toBe(3)
    expect(diagnoses.queryByText('Complete this field.')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
  })
})

describe('rows 3.3-40 and 3.3-41: the documents', () => {
  it('lists each document with no extra status badge, and says classic’s empty sentence', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.document.read']
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'unfinished.pdf', status: 'initiated', scanStatus: 'pending' }], nextCursor: null })
    await openVisit()
    const documents = card('Documents')
    const row = (await documents.findByText('referral-letter.pdf')).closest('li') as HTMLElement
    expect(within(row).queryByText('Available')).toBeNull()
    const unfinished = (documents.getByText('unfinished.pdf')).closest('li') as HTMLElement
    expect(within(unfinished).getByText('Upload not completed; only the person who started it can finish it. Upload the file again.')).toBeTruthy()
    expect(within(unfinished).queryByText('Initiated')).toBeNull()
    cleanup()
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    await openVisit()
    expect(await card('Documents').findByText('No documents for this encounter.')).toBeTruthy()
  })

  it('says classic’s note and refusal on the upload', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.document.read', 'ehr.document.write']
    await openVisit()
    const documents = card('Documents')
    expect(await documents.findByText('Files are scanned before download becomes available.')).toBeTruthy()
    const input = documents.getByLabelText(labelled('Clinical document')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['GIF89a'], 'photo.gif', { type: 'image/gif' })] } })
    fireEvent.click(documents.getByRole('button', { name: 'Upload document' }))
    expect(documents.getByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
  })
})
