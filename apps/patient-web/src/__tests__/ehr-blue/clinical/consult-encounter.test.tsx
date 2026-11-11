import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_STATUS_UPDATED, RELOAD_FAILED, REVISION_RECORDED } from '../../../ehr-blue/clinical/consult/encounters'
import { CONFIRM_BODY } from '../../../ehr-blue/clinical/parts/Detail'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { TONE_OUTLINE } from '../../../kasuwa/ui'
import { COLLEAGUE, DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, FACILITY_NAME, PATIENT_HID, PATIENT_ID, SIGNED_IN, activePatient, allowedLookup, labelled, patientBanner, renderPage, type SignedIn } from './harness'
import { consultationLabel } from '../../../plainLabels'
import { SAID_CHANGED, SAID_FIELDS_REFUSED, SAID_REFUSED, SAID_UNAVAILABLE } from '../../said'

/**
 * Consultation, one encounter: the design's record page (Saved record, Available actions with the typed SIGN
 * dialog, History, Earlier versions) on today's encounter, note, diagnosis and
 * document calls, with every access re-check and refusal today has. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, signedIn: undefined as SignedIn | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: ({ encounter }: { encounter: { id: string } }) => <p>Connected orders for {encounter.id}</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ALL = [
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
  'ehr.document.read', 'ehr.document.write', 'ehr.vital.read',
]
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const OTHER = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed' }
const NOTE = {
  id: 'note-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:10:00.000Z',
  noteType: 'Consultation', title: 'Consultation note', status: 'draft', rowVersion: 2,
}
const REVISION = { id: 'rev-1', revisionNo: 1, content: 'History\nCough for three days.', changeReason: 'Initial draft', createdAt: '2026-10-30T08:10:00.000Z' }
const DIAGNOSIS = {
  id: 'dx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:20:00.000Z', codeSystem: 'ICD-10', code: 'B54',
  display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'provisional', notes: null, rowVersion: 1,
}
const VITAL = { id: 'vital-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:05:00.000Z', status: 'final', pulseBpm: 80 }
const DOCUMENT = {
  id: 'doc-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, fileName: 'referral-letter.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-30T08:30:00.000Z',
}
const READ_ONLY = 'You can view this record but not change it.'
const ENDED = 'Open the patient again to keep working.'
const STALE = new HidApiError(412, 'The record changed since it was read.', { code: 'PRECONDITION_FAILED' })
/** Today's warnings on a status change (staff/routes/Clinical.tsx:82 on main, :87 on Novu), every clause, saying consultation. */
const MAIN_WARNING = 'Cancelling this consultation also cancels its draft, active and on-hold prescriptions and lab requests; its notes, diagnoses, vitals, documents and completed orders are not changed. Marking it entered in error also marks entered in error its notes, diagnoses and vitals, its documents (other than rejected uploads), and its prescriptions and lab requests that are not cancelled, completed ones included. Pharmacy and the Laboratory are not told: contact the pharmacy or laboratory about any order sent to them.'
const NOVU_WARNING = 'Closing or cancelling this consultation does not change its lab requests or prescriptions. Change or cancel each one: one sent to another facility is then withdrawn there, or cancelled if that facility had accepted it.'
/** Today's refusal of a close the role may not make (staff/routes/Clinical.tsx:94-96), whole, in plain words. */
const RETRACTION_REFUSED = (change: string) => `You can’t ${change}: doing so would also change some of its records, and your role can’t change all of them. Nothing was changed. Ask a colleague whose role can change all of its records (usually a doctor or clinician) to make this change.`

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.facilityId = undefined
  staff.signedIn = undefined
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  records = { 'clinical-notes': [NOTE], diagnoses: [DIAGNOSIS], vitals: [VITAL], prescriptions: [], 'lab-requests': [] }
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER, OTHER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: records[kind] ?? [], nextCursor: null }))
  api.noteRevisions.mockResolvedValue([REVISION])
  api.documents.mockResolvedValue({ items: [DOCUMENT], nextCursor: null })
  api.updateRecord.mockResolvedValue({ ...NOTE, status: 'signed', rowVersion: 3 })
  api.addNoteRevision.mockResolvedValue({ ...REVISION, id: 'rev-2', revisionNo: 2 })
  api.updateEncounter.mockImplementation(async (_f: string, _p: string, _e: string, input: { status: string }) => ({ ...ENCOUNTER, status: input.status, rowVersion: 4 }))
  api.createRecord.mockResolvedValue({ id: 'dx-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
  api.updateDiagnosis.mockResolvedValue({ ...DIAGNOSIS, verificationStatus: 'confirmed', rowVersion: 2 })
  api.documentDownload.mockResolvedValue({ url: 'https://storage.example.test/doc-1?signature=x', expiresInSeconds: 60 })
  api.uploadDocument.mockResolvedValue('doc-2')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  // The note's content, once read (in the Note card, and in an earlier version too).
  expect((await screen.findAllByText('Cough for three days.', { exact: false })).length).toBeGreaterThan(0)
}

function card(title: string) {
  return screen.getByRole('heading', { level: 2, name: title }).closest('section') as HTMLElement
}

function actions() {
  return within(card('Actions'))
}

/** The line under the heading: status and time (the patient is in the sticky patient banner above it). */
function meta() {
  return screen.getByText(/^Started /).parentElement as HTMLElement
}

function dialog() {
  return screen.getByRole('alertdialog')
}

/** The open action's submit button (the action's own button toggles its form). */
function submitOf(name: string) {
  return actions().getAllByRole('button', { name }).find(button => button.getAttribute('type') === 'submit')!
}

const UNAVAILABLE = () => new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
/** The live actions behind More actions for an in-progress consultation with a draft note read (owner decision 1). */
const MENU = ['Complete consultation', 'Put on hold', 'Cancel consultation', 'Mark as entered in error', 'Mark note entered in error']

function history() {
  return within(card('History'))
}

/** The "More actions" menu button at the end of Actions. */
function moreButton() {
  return actions().getByRole('button', { name: /^More actions/ })
}

/** What More actions offers (the menu is opened, read and closed again). */
function menuLabels() {
  fireEvent.click(moreButton())
  const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent)
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  return labels
}

/** Chooses one of More actions' items, which opens its form in Actions. */
function chooseMore(label: string) {
  fireEvent.click(moreButton())
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
}

/** The Earlier versions card's summaries. */
function versionSummaries() {
  return Array.from(card('Earlier versions').querySelectorAll('summary')).map(summary => summary.textContent)
}

/** Opens "Sign note" in Available actions and gives today's reason. */
function openSign(reason = 'Reviewed with the patient') {
  fireEvent.click(actions().getByRole('button', { name: 'Sign note' }))
  fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: reason } })
}

/** The memory router's address (window.location never moves under MemoryRouter). */
function Address() {
  const location = useLocation()
  return <p data-testid="address">{`${location.pathname}${location.search}${location.hash}`}</p>
}

/** Today's OCR page stand-in: where it was opened, and what router state it was handed. */
function OcrPage() {
  const location = useLocation()
  return (
    <div data-testid="ocr-page">
      <p data-testid="ocr-path">{location.pathname}</p>
      <p data-testid="ocr-search">{location.search}</p>
      <p data-testid="ocr-state">{JSON.stringify(location.state)}</p>
    </div>
  )
}

/** The encounter page with today's OCR route beside it. */
function renderWithOcr() {
  return render(
    <MemoryRouter initialEntries={[`/provider/clinical/${ENCOUNTER_ID}`]}>
      <Routes>
        <Route path="/provider/clinical/*" element={<ConsultWorkspace />} />
        <Route path="/provider/ocr" element={<OcrPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Consultation record', () => {
  it('shows the design’s record page on today’s encounter, note and diagnosis', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    await openEncounter()
    // The patient is named once, in the sticky banner over the page.
    expect(patientBanner().textContent).toContain(PATIENT_HID)
    expect(within(meta()).getByText('In progress')).toBeTruthy()
    expect(within(meta()).getByText(/^Started \d+ \w+ 2026, /)).toBeTruthy()
    const saved = within(card('Note'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values).toMatchObject({
      'Type of visit': 'Outpatient', Complaint: 'Fever for two days', Diagnosis: 'Malaria (fictional)', 'Note status': 'draft',
      Note: 'History\nCough for three days.',
    })
    // The note's actions; every other live action is behind one More actions menu at the card's end.
    expect(actions().getAllByRole('button').map(button => button.textContent?.replace('▾', ''))).toEqual(['Sign note', 'Add notes', 'More actions'])
    expect(moreButton().getAttribute('aria-haspopup')).toBe('menu')
    expect(menuLabels()).toEqual(MENU)
    // The orders are a card of their own now, after the diagnoses.
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
    expect(saved.getByRole('button', { name: 'Edit draft' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
    // Reads: the access re-check first; records with today's four arguments.
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes')
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1')
  })

  it('prints a discharge summary and the visit’s prescription from what the page read', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read', 'ehr.lab-request.read']
    // As production has them: the session's actor.id is the sign-in subject, the records carry the author's account.
    staff.signedIn = SIGNED_IN
    const byMe = { createdBy: SIGNED_IN.accountId, createdByMembershipId: SIGNED_IN.membershipId }
    records.prescriptions = [
      { id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', ...byMe, status: 'active',
        medicationDisplay: 'Artemether-lumefantrine', doseQuantity: '4', doseUnit: 'tablets', routeCode: 'oral', frequency: 'Twice a day', instructions: 'With food',
        startsOn: '2026-10-30', endsOn: '2026-11-01' },
      { id: 'rx-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:41:00.000Z', ...byMe, status: 'cancelled',
        medicationDisplay: 'Cancelled medicine', frequency: 'Daily', instructions: '' },
      { id: 'rx-3', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:42:00.000Z', ...byMe, status: 'draft',
        medicationDisplay: 'Draft medicine', frequency: 'Daily', instructions: '' },
      { id: 'rx-4', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:43:00.000Z', ...byMe, status: 'on_hold',
        medicationDisplay: 'Held medicine', frequency: 'Daily', instructions: '' },
      { id: 'rx-5', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:44:00.000Z', ...byMe, status: 'completed',
        medicationDisplay: 'Finished medicine', frequency: 'Once', instructions: '' },
    ]
    records['clinical-notes'] = [{ ...NOTE, ...byMe }]
    records['lab-requests'] = [{ id: 'lab-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:45:00.000Z', status: 'active', testDisplay: 'Malaria smear' }]
    const papers: Record<string, string> = {}
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {
      const paper = document.querySelector('[data-clinical-print]')
      if (paper) papers[paper.getAttribute('data-clinical-print')!] = paper.textContent ?? ''
    })
    await openEncounter()
    const printing = within(card('Print'))
    fireEvent.click(await printing.findByRole('button', { name: 'Print prescription' }))
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    fireEvent.click(printing.getByRole('button', { name: 'Print discharge summary' }))
    expect(printSpy).toHaveBeenCalledTimes(2)
    for (const words of [FACILITY_NAME, PATIENT_HID, 'Artemether-lumefantrine 4 tablets', 'By mouth · Twice a day · for 3 days', 'With food', 'Demo Clinician']) {
      expect(papers.prescription).toContain(words)
    }
    for (const left of ['Cancelled medicine', 'Draft medicine', 'Held medicine', 'Finished medicine']) expect(papers.prescription).not.toContain(left)
    for (const words of ['Discharge summary', PATIENT_HID, 'Fever for two days', 'Malaria (fictional)', 'This note is a draft and has not been signed.',
      'Cough for three days.', 'Malaria smear', 'Medicines on discharge', 'Artemether-lumefantrine', 'Follow-up', 'Demo Clinician']) {
      expect(papers.discharge).toContain(words)
    }
    for (const left of ['Cancelled medicine', 'Draft medicine', 'Finished medicine']) expect(papers.discharge).not.toContain(left)
    // A held medicine is listed apart, never as one to continue.
    expect(papers.discharge).toMatch(/Medicines on hold.*not to be taken unless a clinician says so.*Held medicine/)
    expect(papers.discharge?.indexOf('Held medicine')).toBeGreaterThan(papers.discharge?.indexOf('Medicines on hold') ?? -1)
  })

  it('leaves the clinician’s name blank when the person printing did not write the consultation note', async () => {
    staff.signedIn = SIGNED_IN
    records['clinical-notes'] = [{ ...NOTE, createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId }]
    let printed = ''
    vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print]')?.textContent ?? '' })
    await openEncounter()
    fireEvent.click(within(card('Print')).getByRole('button', { name: 'Print discharge summary' }))
    expect(printed).toContain('Cough for three days.')
    expect(printed).not.toContain('Demo Clinician')
    expect(document.querySelector('[data-clinical-print] .hid-clinical-paper-sign .hid-clinical-paper-line')?.textContent).toBe('')
  })

  it('names the prescriber by the membership at this facility when the session carries no account', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    staff.signedIn = { subject: SIGNED_IN.subject, sessionId: SIGNED_IN.sessionId, membershipId: SIGNED_IN.membershipId }
    const rx = { patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, status: 'active', frequency: 'Daily', instructions: '' }
    records.prescriptions = [
      { ...rx, id: 'rx-1', createdAt: '2026-10-30T08:40:00.000Z', medicationDisplay: 'Paracetamol', createdBy: SIGNED_IN.accountId, createdByMembershipId: SIGNED_IN.membershipId },
    ]
    const papers: string[] = []
    vi.spyOn(window, 'print').mockImplementation(() => { papers.push(document.querySelector('[data-clinical-print="prescription"]')?.textContent ?? '') })
    await openEncounter()
    fireEvent.click(await within(card('Print')).findByRole('button', { name: 'Print prescription' }))
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    expect(papers[0]).toContain('Demo Clinician')
    // A prescription written under a colleague's membership: the name is left for handwriting.
    records.prescriptions = [
      ...records.prescriptions,
      { ...rx, id: 'rx-2', createdAt: '2026-10-30T08:41:00.000Z', medicationDisplay: 'Ibuprofen', createdBy: COLLEAGUE.accountId, createdByMembershipId: COLLEAGUE.membershipId },
    ]
    cleanup()
    await openEncounter()
    fireEvent.click(await within(card('Print')).findByRole('button', { name: 'Print prescription' }))
    expect(papers[1]).toContain('Ibuprofen')
    expect(papers[1]).not.toContain('Demo Clinician')
  })

  it('says a part is not available to the user rather than that the visit has none', async () => {
    records.prescriptions = [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', status: 'active', medicationDisplay: 'Artemether-lumefantrine' }]
    let printed = ''
    vi.spyOn(window, 'print').mockImplementation(() => { printed = document.querySelector('[data-clinical-print]')?.textContent ?? '' })
    await openEncounter()
    fireEvent.click(within(card('Print')).getByRole('button', { name: 'Print discharge summary' }))
    // ALL carries no prescription or lab request read.
    expect(printed).toMatch(/Medicines on discharge\s*Not available to you\. Check the patient’s record\./)
    expect(printed).not.toContain('None active at this visit')
    expect(printed).not.toContain('Artemether-lumefantrine')
  })

  it('won’t print the discharge summary while a part failed to load, and says why', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'prescriptions') throw new HidApiError(503, 'Unavailable')
      return { items: records[kind] ?? [], nextCursor: null }
    })
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    await openEncounter()
    const button = within(card('Print')).getByRole('button', { name: 'Print discharge summary' })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'))
    expect(within(card('Print')).getByText(/can be printed once the visit’s diagnoses, note, tests and medicines have loaded/)).toBeTruthy()
    fireEvent.click(button)
    expect(printSpy).not.toHaveBeenCalled()
  })

  it('won’t print the discharge summary while a part is still loading', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) =>
      kind === 'prescriptions' ? new Promise(() => {}) : { items: records[kind] ?? [], nextCursor: null })
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    await openEncounter()
    const button = within(card('Print')).getByRole('button', { name: 'Print discharge summary' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(printSpy).not.toHaveBeenCalled()
  })

  it('says on the paper when the visit has more prescriptions than the first page', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read']
    records.prescriptions = [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', status: 'active', medicationDisplay: 'Artemether-lumefantrine' }]
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) =>
      ({ items: records[kind] ?? [], nextCursor: kind === 'prescriptions' ? 'next-page' : null }))
    const papers: Record<string, string> = {}
    vi.spyOn(window, 'print').mockImplementation(() => {
      const paper = document.querySelector('[data-clinical-print]')
      if (paper) papers[paper.getAttribute('data-clinical-print')!] = paper.textContent ?? ''
    })
    await openEncounter()
    fireEvent.click(await within(card('Print')).findByRole('button', { name: 'Print prescription' }))
    act(() => { window.dispatchEvent(new Event('afterprint')) })
    fireEvent.click(within(card('Print')).getByRole('button', { name: 'Print discharge summary' }))
    expect(papers.prescription).toContain('This visit has more prescriptions on later pages of the record')
    expect(papers.discharge).toContain('More are on later pages of the record')
  })

  it('offers only the discharge summary when the visit has no prescription to print', async () => {
    await openEncounter()
    const printing = within(card('Print'))
    expect(printing.getByRole('button', { name: 'Print discharge summary' })).toBeTruthy()
    expect(printing.queryByRole('button', { name: 'Print prescription' })).toBeNull()
  })

  it('lists the connected hospital history, each with its status, linking records that have their own page by ids only', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.read', 'ehr.lab-request.read']
    const observation = { ...NOTE, id: 'b1c6ef36-0000-4000-8000-000000000001', noteType: 'Nursing observation', title: 'Vitals', status: 'signed' }
    records['clinical-notes'] = [NOTE, observation]
    records.prescriptions = [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, medicationDisplay: 'Amoxicillin (fictional)', status: 'active' }]
    records['lab-requests'] = [{ id: 'lab-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, testDisplay: 'Malaria smear (fictional)', status: 'draft' }]
    await openEncounter()
    const history = within(card('History'))
    expect(history.getByText('Only records your role can see are listed.')).toBeTruthy()
    const row = (name: string) => history.getByText(name).closest('li') as HTMLElement
    const link = (name: string) => history.getByRole('link', { name }).getAttribute('href')
    expect(link(consultationLabel(OTHER))).toBe(`/provider/clinical/${OTHER.id}`)
    for (const label of ['Notes · Consultation note', 'Diagnoses · Malaria (fictional)', 'Documents · referral-letter.pdf']) {
      expect(history.getByText(label).tagName).toBe('SPAN')
    }
    expect(within(row('Notes · Consultation note')).getByText('Draft')).toBeTruthy()
    // A nursing observation is not a clinical note row: it links to its own page, as the nursing pages name it.
    expect(history.queryByText('Notes · Vitals')).toBeNull()
    expect(link(`Nursing observations · ${formatWhen(observation.createdAt)}`)).toBe(`/provider/nursing/${ENCOUNTER_ID}~${observation.id}`)
    expect(within(row(`Nursing observations · ${formatWhen(observation.createdAt)}`)).getByText('Signed')).toBeTruthy()
    expect(link(`Vitals · ${formatWhen(VITAL.createdAt)}`)).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-1`)
    expect(within(row(`Vitals · ${formatWhen(VITAL.createdAt)}`)).getByText('Final')).toBeTruthy()
    expect(link('Pharmacy · Amoxicillin (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/rx-1`)
    expect(link('Laboratory · Malaria smear (fictional)')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/lab-1`)
    for (const href of history.getAllByRole('link').map(item => item.getAttribute('href') ?? '')) {
      expect(href).not.toContain(PATIENT_HID)
      expect(href).not.toContain(PATIENT_ID)
    }
  })

  it('gap: vitals past the encounter’s first page are reached with the Vitals card’s record pages, as today’s Vitals tab, History following', async () => {
    const later = { ...VITAL, id: 'vital-2', createdAt: '2026-10-29T08:05:00.000Z', pulseBpm: 88 }
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string }) => {
      if (kind !== 'vitals') return { items: records[kind] ?? [], nextCursor: null }
      return page?.cursor === 'vitals-2' ? { items: [later], nextCursor: null } : { items: [VITAL], nextCursor: 'vitals-2' }
    })
    render(
      <MemoryRouter initialEntries={[`/provider/clinical/${ENCOUNTER_ID}`]}>
        <Address />
        <Routes><Route path="/provider/clinical/*" element={<ConsultWorkspace />} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    const pages = await within(card('Vitals')).findByRole('navigation', { name: 'Record pages' })
    expect(within(pages).getByText('Page 1')).toBeTruthy()
    expect(history().getByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })).toBeTruthy()
    // One pager for the list, as for Notes and Diagnoses: History has none of its own.
    expect(history().queryByRole('group', { name: 'Triage & Vitals' })).toBeNull()

    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    const link = await history().findByRole('link', { name: `Vitals · ${formatWhen(later.createdAt)}` })
    expect(link.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-2`)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { cursor: 'vitals-2', fresh: false })
    expect(within(pages).getByText('Page 2')).toBeTruthy()
    expect(history().queryByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })).toBeNull()
    // The page move never reaches the address (a navigation lands after the render that asked for it).
    await act(async () => {})
    expect(screen.getByTestId('address').textContent).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
  })

  it('shows no vitals pager while the encounter’s vitals fit on one page', async () => {
    await openEncounter()
    expect(history().getByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })).toBeTruthy()
    expect(within(card('Vitals')).queryByRole('navigation', { name: 'Record pages' })).toBeNull()
  })

  it('item 1: offers "Add notes" while the encounter already has a note, with today’s note type, title and content', async () => {
    api.createRecord.mockResolvedValue({ id: 'note-2', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z' })
    await openEncounter()
    // The draft is there and still offered for signing; a second note can be written beside it.
    expect(actions().getByRole('button', { name: 'Sign note' })).toBeTruthy()
    fireEvent.click(actions().getByRole('button', { name: 'Add notes' }))
    expect(actions().getByText('Notes are saved as drafts. Review a note, then sign it.')).toBeTruthy()
    const type = actions().getByLabelText(labelled('Note type')) as HTMLInputElement
    const title = actions().getByLabelText(labelled('Title')) as HTMLInputElement
    const content = actions().getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect([type.maxLength, type.placeholder, title.maxLength, content.maxLength]).toEqual([80, 'Consultation', 240, 100_000])
    fireEvent.click(actions().getByRole('button', { name: 'Save draft' }))
    expect(actions().getAllByText('Complete this field.')).toHaveLength(3)
    expect(api.createRecord).not.toHaveBeenCalled()
    fireEvent.change(type, { target: { value: ' Progress ' } })
    fireEvent.change(title, { target: { value: 'Evening review' } })
    fireEvent.change(content, { target: { value: 'Fever settling.' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(actions().getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Progress', title: 'Evening review', status: 'draft', content: 'Fever settling.',
    }, expect.any(String))
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    // Today's create reads the notes' first page again, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    expect(actions().getByRole('button', { name: 'Add notes' })).toBeTruthy()
  })

  it('item 1: still offers "Add notes" once the consultation note is entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    await openEncounter()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Mark note entered in error' })).toBeNull()
    expect(actions().getByRole('button', { name: 'Add notes' })).toBeTruthy()
  })

  it('leaves a refuted diagnosis out of the encounter’s Diagnosis, and badges it refuted', async () => {
    records.diagnoses = [
      { ...DIAGNOSIS, verificationStatus: 'refuted' },
      { ...DIAGNOSIS, id: 'dx-2', code: 'R50.9', display: 'Fever (fictional)', verificationStatus: 'confirmed' },
    ]
    await openEncounter()
    const saved = within(card('Note'))
    const values = Object.fromEntries(saved.getAllByRole('term').map(term => [term.textContent, term.nextElementSibling?.textContent]))
    expect(values.Diagnosis).toBe('Fever (fictional)')
    const history = within(card('History'))
    expect(within(history.getByText('Diagnoses · Malaria (fictional)').closest('li') as HTMLElement).getByText('Refuted')).toBeTruthy()
    expect(within(history.getByText('Diagnoses · Fever (fictional)').closest('li') as HTMLElement).getByText('Active')).toBeTruthy()
    expect(within(card('Diagnoses')).getByText('ICD-10 B54 · Active · Refuted')).toBeTruthy()
  })

  it('says the role grants no access to encounter records when it holds none of the record reads', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(screen.getByText('Your role at this facility can’t open visit records. Ask your facility administrator.')).toBeTruthy()
    expect(api.records).not.toHaveBeenCalled()
    expect(api.documents).not.toHaveBeenCalled()
  })

  it('does not say so when the role holds one record read', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    // In the Vitals card and in History.
    expect(await screen.findAllByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })).toHaveLength(2)
    expect(screen.queryByText('Your role at this facility can’t open visit records. Ask your facility administrator.')).toBeNull()
  })

  it('item 7: signs the consultation note under the clinician’s typed reason, only after SIGN is typed, after the access re-check', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Sign note' }))
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'ok' } })
    fireEvent.click(submitOf('Sign note'))
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Reviewed with the patient' } })
    fireEvent.click(submitOf('Sign note'))
    expect(within(dialog()).getByRole('heading', { name: 'Sign note?' })).toBeTruthy()
    expect(within(dialog()).getByText('Check the details first. This changes the saved record; the change is kept in its history.')).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign note' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'sign' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    expect(confirm.disabled).toBe(false)
    const checks = api.lookupPatient.mock.calls.length
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', rowVersion: 3 }]
    fireEvent.click(confirm)

    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Reviewed with the patient', status: 'signed' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    await waitFor(() => expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull())
    // "Amend signed note" needs the signed note's content, read again once its version changed.
    expect(await actions().findByRole('button', { name: 'Amend signed note' })).toBeTruthy()
  })

  it('keeps the draft when the sign dialog is cancelled, or closed with Escape', async () => {
    await openEncounter()
    openSign()
    const submit = () => submitOf('Sign note')
    fireEvent.click(submit())
    // Focus starts on Cancel, a real button.
    expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(submit()).toBeTruthy()
    await waitFor(() => expect(submit().getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(submit())
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
    expect(within(card('Note')).getByText('draft')).toBeTruthy()
  })

  it('offers no signing until the note’s content has been read', async () => {
    api.noteRevisions.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull()
  })

  it('words: says it is loading one consultation while the visit is read', async () => {
    api.encounter.mockReturnValue(new Promise(() => {}))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Loading consultation…')).toBeTruthy()
    expect(screen.queryByText('Loading consultations…')).toBeNull()
  })

  it('shows a note that cannot be read, and offers no signing', async () => {
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    expect(actions().queryByRole('button', { name: 'Sign note' })).toBeNull()
  })

  it('shows a stale sign in the form, as today', async () => {
    api.updateRecord.mockRejectedValueOnce(STALE)
    await openEncounter()
    openSign()
    fireEvent.click(submitOf('Sign note'))
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign note' }))
    expect((await actions().findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain('The record changed since it was read.')
  })

  it('item 7: edits the unsigned draft as a new revision under the clinician’s typed reason, prefilled with its content', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    const content = saved.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement
    expect(content.value).toBe('History\nCough for three days.')
    fireEvent.change(content, { target: { value: 'History\nCough for four days.' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(saved.getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Duration corrected' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'History\nCough for four days.' }, expect.any(String))
    expect(screen.getByRole('button', { name: 'Edit draft' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('amends a signed note with today’s checks, reusing the key on retry', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    const form = actions().getByRole('button', { name: 'Amend signed note', expanded: true }).parentElement!.parentElement!
    const save = () => actions().getAllByRole('button', { name: 'Amend signed note' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.change(within(form).getByLabelText(labelled('Reason')), { target: { value: 'ok' } })
    fireEvent.click(save())
    expect(actions().getByText('Enter the revised note content.')).toBeTruthy()
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()

    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Corrected: cough for four days.' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Duration corrected' } })
    api.addNoteRevision.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(save())
    expect((await actions().findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    fireEvent.click(save())
    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'note-1',
      { expectedRowVersion: 2, changeReason: 'Duration corrected', content: 'Corrected: cough for four days.' }, expect.any(String))
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('keeps every revision under "Earlier versions"', async () => {
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
      REVISION,
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    const versions = await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    const summaries = Array.from(versions.closest('section')!.querySelectorAll('summary')).map(summary => summary.textContent)
    // Each named by the status it was saved under: a never-signed note's are drafts.
    expect(summaries).toEqual([
      `${formatWhen('2026-10-30T08:10:00.000Z')} · Version 1 · Draft · Initial draft`,
      `${formatWhen('2026-10-30T09:00:00.000Z')} · Version 2 · Draft · Duration corrected`,
    ])
    // The latest revision is the note shown.
    expect(within(card('Note')).getByText('History\nCough for four days.', { normalizer: value => value })).toBeTruthy()
  })

  it('completes the encounter with a reason, re-checking access first', async () => {
    await openEncounter()
    chooseMore('Complete consultation')
    expect(actions().getByText(MAIN_WARNING)).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: '  ' } })
    const save = () => actions().getAllByRole('button', { name: 'Complete consultation' }).find(button => button.getAttribute('type') === 'submit')!
    fireEvent.click(save())
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.updateEncounter).not.toHaveBeenCalled()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    // EHR's encounter once changed, as the re-read after the change finds it.
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'completed', rowVersion: 4 })
    fireEvent.click(save())
    expect(await screen.findByText('Consultation updated.')).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID,
      { expectedRowVersion: 3, changeReason: 'Seen and treated', status: 'completed', endedAt: expect.any(String) })
    expect(within(meta()).getByText('Completed')).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Complete consultation' })).toBeNull()
    expect(menuLabels()).not.toContain('Complete consultation')
  })

  it('parity: shows today’s whole warning in each status form, and ties the submit to it', async () => {
    await openEncounter()
    for (const label of ['Complete consultation', 'Put on hold', 'Cancel consultation', 'Mark as entered in error']) {
      chooseMore(label)
      const warning = actions().getByText(MAIN_WARNING)
      expect(warning.id).not.toBe('')
      expect(submitOf(label).getAttribute('aria-describedby')).toBe(warning.id)
      fireEvent.click(actions().getByRole('button', { name: 'Cancel' }))
    }
  })

  it('parity: on Novu, shows today’s whole Novu warning, tied to the submit', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openEncounter()
    chooseMore('Cancel consultation')
    const warning = actions().getByText(NOVU_WARNING)
    expect(submitOf('Cancel consultation').getAttribute('aria-describedby')).toBe(warning.id)
    expect(actions().queryByText(MAIN_WARNING)).toBeNull()
  })

  it('parity: after a change whose answer carries no encounter, reads the encounter again after the access re-check, and sends the next change against it', async () => {
    api.updateEncounter.mockResolvedValue(undefined)
    await openEncounter()
    api.encounter.mockClear()
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 4 })
    chooseMore('Put on hold')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Waiting for results' } })
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(submitOf('Put on hold'))
    expect(await screen.findByText('Consultation updated.')).toBeTruthy()
    await waitFor(() => expect(within(meta()).getByText('On hold')).toBeTruthy())
    expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID)
    // A re-check before the change and another before the re-read, then the read.
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(api.updateEncounter.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    // The transitions are the current status's, and the next change is sent with the version read.
    expect(menuLabels()).toContain('Resume consultation')
    expect(menuLabels()).not.toContain('Put on hold')
    chooseMore('Resume consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Results are back' } })
    fireEvent.click(submitOf('Resume consultation'))
    await waitFor(() => expect(api.updateEncounter).toHaveBeenCalledTimes(2))
    expect(api.updateEncounter).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID,
      { expectedRowVersion: 4, changeReason: 'Results are back', status: 'in_progress' })
  })

  it('parity: reports a status change only once the encounter is read again, the form busy until then', async () => {
    api.updateEncounter.mockResolvedValue(undefined)
    await openEncounter()
    let reread!: (value: unknown) => void
    api.encounter.mockReturnValueOnce(new Promise(done => { reread = done }))
    const reads = api.encounter.mock.calls.length
    chooseMore('Put on hold')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Waiting for results' } })
    const submit = submitOf('Put on hold')
    fireEvent.click(submit)
    // The change is sent and the re-read asked for: until it answers, nothing is reported, the form stays open and busy,
    // and no stale change is offered as if done.
    await waitFor(() => expect(api.encounter).toHaveBeenCalledTimes(reads + 1))
    expect(api.updateEncounter).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(ENCOUNTER_STATUS_UPDATED)).toBeNull()
    expect(submit.isConnected).toBe(true)
    expect(submit.getAttribute('aria-busy')).toBe('true')
    // The same busy word as the note's status changes on this card.
    expect(submit.textContent).toBe('Updating…')
    await act(async () => reread({ ...ENCOUNTER, status: 'on_hold', rowVersion: 4 }))
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    expect(within(meta()).getByText('On hold')).toBeTruthy()
    expect(submit.isConnected).toBe(false)
  })

  it('parity: never lets an older re-read of the encounter replace a newer one', async () => {
    await openEncounter()
    let older!: (value: unknown) => void
    api.encounter
      .mockReturnValueOnce(new Promise(done => { older = done }))
      .mockResolvedValueOnce({ ...ENCOUNTER, status: 'completed', rowVersion: 5 })
    const reads = api.encounter.mock.calls.length
    chooseMore('Put on hold')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Waiting for results' } })
    fireEvent.click(submitOf('Put on hold'))
    await waitFor(() => expect(api.encounter).toHaveBeenCalledTimes(reads + 1))
    // While that re-read is out, another change is sent and refused as stale; its own read finds the encounter completed.
    api.updateEncounter.mockRejectedValueOnce(STALE)
    chooseMore('Complete consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    fireEvent.click(submitOf('Complete consultation'))
    await waitFor(() => expect(api.encounter).toHaveBeenCalledTimes(reads + 2))
    await waitFor(() => expect(within(meta()).getByText('Completed')).toBeTruthy())
    // The first re-read answers last, with what was true before: the page keeps the newer read.
    await act(async () => older({ ...ENCOUNTER, status: 'on_hold', rowVersion: 4 }))
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    expect(within(meta()).getByText('Completed')).toBeTruthy()
    expect(within(meta()).queryByText('On hold')).toBeNull()
  })

  it('parity: says when the re-read after a change fails, the change still reported', async () => {
    await openEncounter()
    api.encounter.mockRejectedValue(UNAVAILABLE())
    chooseMore('Put on hold')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Waiting for results' } })
    fireEvent.click(submitOf('Put on hold'))
    expect(await screen.findByText('Consultation updated.')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    // The change's own answer is still shown.
    expect(within(meta()).getByText('On hold')).toBeTruthy()
  })

  it('asks before cancelling the encounter (no typed word), and says when the role may not', async () => {
    api.updateEncounter.mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    await openEncounter()
    chooseMore('Cancel consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Booked in error' } })
    fireEvent.click(actions().getAllByRole('button', { name: 'Cancel consultation' }).find(button => button.getAttribute('type') === 'submit')!)
    expect(within(dialog()).getByRole('heading', { name: 'Cancel consultation?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel consultation' }))
    expect((await actions().findByRole('alert')).textContent).toBe(RETRACTION_REFUSED('cancel this consultation'))
  })

  it.each([
    ['Cancel consultation', 'cancelled', 'cancel this consultation'],
    ['Mark as entered in error', 'entered_in_error', 'mark this consultation entered in error'],
  ])('parity: a refused "%s" says why, whole, and changes and reads nothing, the form kept', async (label, status, change) => {
    api.updateEncounter.mockRejectedValue(new HidApiError(403, 'Cancelling or retracting this encounter changes records you may not write', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    await openEncounter()
    await act(async () => {})
    const reads = () => [api.encounter, api.encounters, api.records, api.documents, api.noteRevisions].map(read => read.mock.calls.length)
    const before = reads()
    chooseMore(label)
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Opened on the wrong patient' } })
    fireEvent.click(submitOf(label))
    fireEvent.click(within(dialog()).getByRole('button', { name: label }))
    // Today's refusal, whole (staff/routes/Clinical.tsx:94-96), in the form, and never the service's own words.
    expect((await actions().findByRole('alert')).textContent).toBe(RETRACTION_REFUSED(change))
    expect(document.body.textContent).not.toContain('records you may not write')
    expect(api.updateEncounter).toHaveBeenCalledTimes(1)
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, { expectedRowVersion: 3, changeReason: 'Opened on the wrong patient', status })
    // Not a stale consultation: nothing is read again, nothing is said to have changed, and it is as it was.
    expect(reads()).toEqual(before)
    expect(screen.queryByText(ENCOUNTER_STATUS_UPDATED)).toBeNull()
    expect(within(meta()).getByText('In progress')).toBeTruthy()
    // The form stays open with the reason, to be shown to a colleague or changed, and the change is still offered.
    expect((actions().getByLabelText(labelled('Reason for change')) as HTMLInputElement).value).toBe('Opened on the wrong patient')
    expect(submitOf(label).getAttribute('aria-busy')).toBeNull()
    expect(menuLabels()).toContain(label)
  })

  it.each([
    ['main', 'Cancel consultation', '', MAIN_WARNING],
    ['main', 'Mark as entered in error', '', MAIN_WARNING],
    ['Novu', 'Cancel consultation', 'novu-v1', NOVU_WARNING],
  ])('parity (%s): the dialog that sends "%s" says today’s whole warning, not only that the record changes', async (_backend, label, contract, warning) => {
    if (contract) vi.stubEnv('VITE_HID_BACKEND_CONTRACT', contract)
    await openEncounter()
    chooseMore(label)
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Booked in error' } })
    fireEvent.click(submitOf(label))
    const said = document.getElementById(dialog().getAttribute('aria-describedby')!)!
    expect(said.textContent).toBe(warning)
    expect(within(dialog()).queryByText(CONFIRM_BODY)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(api.updateEncounter).not.toHaveBeenCalled()
  })

  it('parity: the dialogs for changes that close no records keep the design’s sentence', async () => {
    await openEncounter()
    openSign()
    fireEvent.click(submitOf('Sign note'))
    expect(within(dialog()).getByText(CONFIRM_BODY)).toBeTruthy()
    expect(within(dialog()).queryByText(MAIN_WARNING)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    // The note's own entered in error changes only the note: the design's sentence too.
    chooseMore('Mark note entered in error')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Wrong patient' } })
    fireEvent.click(submitOf('Mark note entered in error'))
    expect(within(dialog()).getByText(CONFIRM_BODY)).toBeTruthy()
    expect(within(dialog()).queryByText(MAIN_WARNING)).toBeNull()
  })

  it('re-reads an encounter that changed meanwhile and says so', async () => {
    api.updateEncounter.mockRejectedValueOnce(STALE)
    await openEncounter()
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 5 })
    chooseMore('Complete consultation')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Seen and treated' } })
    // A pressed button takes focus (as in a browser); the change removes it with its form.
    act(() => { submitOf('Complete consultation').focus() })
    fireEvent.click(submitOf('Complete consultation'))
    expect((await screen.findByRole('alert')).textContent).toBe('Someone changed this consultation while you had it open. It now shows its current status; choose the change again if it’s still needed.')
    expect(within(meta()).getByText('On hold')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Actions')
    expect(menuLabels()).toContain('Resume consultation')
  })

  it('shows today’s read-only sentence and no changes under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openEncounter()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(actions().getByText('Nothing more to do here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit draft' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Add diagnoses' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Upload a document' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
  })

  it('shows the read-only emergency notice and reads nothing for an emergency patient', () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records).not.toHaveBeenCalled()
  })

  it('closes the patient when the re-check before a change is refused (403), and changes nothing', async () => {
    await openEncounter()
    openSign()
    fireEvent.click(submitOf('Sign note'))
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign note' }))
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText(ENDED)).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  it('shows "Record not found" for an encounter EHR does not return', async () => {
    api.encounter.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    renderPage(<ConsultWorkspace />, 'consult', '/e9999999-0000-4000-8000-000000000009')
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('This record doesn’t exist, or it belongs to another facility.')).toBeTruthy()
  })

  it('shows no Orders card to a role that may add orders but read none, at a real facility: it would be empty', async () => {
    staff.permissions = [...ALL, 'ehr.prescription.write', 'ehr.lab-request.write']
    await openEncounter()
    expect(screen.queryByRole('heading', { level: 2, name: 'Orders' })).toBeNull()
    expect(screen.queryByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeNull()
  })

  it('shows the Orders card to a role that reads lab requests only', async () => {
    staff.permissions = [...ALL, 'ehr.lab-request.read']
    await openEncounter()
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
  })

  it('keeps the Orders card at a demo facility, for its sample radiology and referral steps', async () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    api.encounter.mockResolvedValue({ ...ENCOUNTER, facilityId: DEMO_HOSPITAL_ID })
    await openEncounter()
    expect(within(card('Orders')).getByText(`Connected orders for ${ENCOUNTER_ID}`)).toBeTruthy()
  })

  it('mounts the orders pages under the encounter', async () => {
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}/orders/new`)
    expect(screen.getByText('Order pages part')).toBeTruthy()
  })
})

describe('Consultation record: diagnoses', () => {
  it('adds a diagnosis, and shows a refused field at its control with today’s sentence', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'display', messages: ['display must be shorter than or equal to 500 characters'] }],
    }))
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    expect(diagnoses.getByText('Malaria (fictional)')).toBeTruthy()
    expect(diagnoses.getByText('ICD-10 B54 · Active · Provisional')).toBeTruthy()
    // Today's "Add diagnoses" form, in its order and words (Clinical.tsx:561, 566).
    expect(diagnoses.getByRole('heading', { name: 'Add diagnoses' })).toBeTruthy()
    const form = diagnoses.getByRole('button', { name: 'Save record' }).closest('form') as HTMLFormElement
    expect(Array.from(form.querySelectorAll('label'), label => label.textContent?.replace(/\s*\*$/, ''))).toEqual(['Code system', 'Code', 'Diagnosis', 'Clinical status', 'Verification', 'Notes'])
    fireEvent.change(diagnoses.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Code')), { target: { value: 'R50.9' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Diagnosis')), { target: { value: 'Fever' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Save record' }))
    expect((await diagnoses.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(document.body.textContent).not.toContain('shorter than or equal to 500 characters')
    // The field is named as the form names it, never by the record's field name.
    expect(diagnoses.getByLabelText(labelled('Diagnosis')).getAttribute('aria-invalid')).toBe('true')
    expect(card('Diagnoses').textContent).not.toContain('Display')

    fireEvent.click(diagnoses.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses',
      { codeSystem: 'ICD-10', code: 'R50.9', display: 'Fever', clinicalStatus: 'active', verificationStatus: 'unconfirmed', notes: undefined }, expect.any(String))
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('changes a diagnosis, sending only what changed', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    fireEvent.change(diagnoses.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    // Today's sentence under the form (Clinical.tsx:696).
    expect(diagnoses.getByText('Every change is kept in the record history. A diagnosis marked entered in error accepts no further change here.')).toBeTruthy()
    fireEvent.click(diagnoses.getByRole('button', { name: 'Update diagnosis' }))
    expect(diagnoses.getByText('Change the clinical status, verification or notes before saving.')).toBeTruthy()
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
    const verification = diagnoses.getAllByLabelText(labelled('Verification')).find(control => (control as HTMLSelectElement).value === 'provisional')!
    fireEvent.change(verification, { target: { value: 'confirmed' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    expect(api.updateDiagnosis).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'dx-1',
      { expectedRowVersion: 1, changeReason: 'Smear positive', verificationStatus: 'confirmed' })
  })

  it('says when there are none, in today’s words', async () => {
    records.diagnoses = []
    await openEncounter()
    // Today's empty sentence (Clinical.tsx:1808).
    expect(await within(card('Diagnoses')).findByText('No diagnoses for this consultation.')).toBeTruthy()
  })

  it('offers no change for one entered in error', async () => {
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'entered_in_error' }]
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    // Today's warning badge (Clinical.tsx:1809), not the neutral tone of a status the shared map does not know.
    const badge = diagnoses.getByText('Entered in error')
    expect(badge.className).toContain(TONE_OUTLINE.warn)
    expect(badge.className).not.toContain(TONE_OUTLINE.neutral)
    expect(diagnoses.queryByRole('button', { name: 'Change this diagnosis' })).toBeNull()
  })

  it('says when each diagnosis was recorded, as today’s "Recorded" detail does', async () => {
    records.diagnoses = [DIAGNOSIS, { ...DIAGNOSIS, id: 'dx-2', display: 'Fever (fictional)', createdAt: undefined }]
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    const row = (name: string) => within(diagnoses.getByText(name).closest('li') as HTMLElement)
    expect(row('Malaria (fictional)').getByText(`Recorded: ${formatWhen('2026-10-30T08:20:00.000Z')}`)).toBeTruthy()
    // Today shows no "Recorded" line for a diagnosis without its time.
    expect(row('Fever (fictional)').queryByText(/^Recorded:/)).toBeNull()
  })

  it('offers today’s statuses only when changing a diagnosis, with no blank choice that would send an empty status', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    const change = within(diagnoses.getByText('Malaria (fictional)').closest('li') as HTMLElement)
    const values = (label: string) => Array.from((change.getByLabelText(labelled(label)) as HTMLSelectElement).options, option => option.value)
    expect(values('Clinical status')).toEqual(['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'])
    expect(values('Verification')).toEqual(['unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered_in_error'])
    // Each opens on the diagnosis's current value.
    expect((change.getByLabelText(labelled('Clinical status')) as HTMLSelectElement).value).toBe('active')
    expect((change.getByLabelText(labelled('Verification')) as HTMLSelectElement).value).toBe('provisional')
  })

  it('blocks "Update diagnosis" while the diagnoses are read again, so no stale row version is sent', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    const change = within(diagnoses.getByText('Malaria (fictional)').closest('li') as HTMLElement)
    fireEvent.change(change.getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(change.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    // A diagnosis added meanwhile reads the list again; that read is held.
    let release: ((page: { items: unknown[]; nextCursor: null }) => void) | null = null
    api.records.mockImplementation((_f: string, _p: string, _e: string, kind: string) => kind === 'diagnoses'
      ? new Promise(done => { release = done })
      : Promise.resolve({ items: records[kind] ?? [], nextCursor: null }))
    fireEvent.change(diagnoses.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Code')), { target: { value: 'R50.9' } })
    fireEvent.change(diagnoses.getByLabelText(labelled('Diagnosis')), { target: { value: 'Fever (fictional)' } })
    fireEvent.click(diagnoses.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(release).not.toBeNull())
    const update = change.getByRole('button', { name: 'Update diagnosis' }) as HTMLButtonElement
    // Today's disabled={recordsLoading} (Clinical.tsx:1828).
    expect(update.disabled).toBe(true)
    fireEvent.click(update)
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
    await act(async () => { release!({ items: [DIAGNOSIS], nextCursor: null }) })
    await waitFor(() => expect(update.disabled).toBe(false))
    expect(api.updateDiagnosis).not.toHaveBeenCalled()
  })
})

describe('Consultation record: documents', () => {
  it('opens a clean document after the access re-check, in a new tab with no opener', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    await openEncounter()
    const documents = within(card('Documents'))
    expect(documents.getByText('PDF document · 20 KB · Checked')).toBeTruthy()
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(documents.getByRole('button', { name: 'Open file referral-letter.pdf' }))
    await waitFor(() => expect(opened).toHaveBeenCalledWith('https://storage.example.test/doc-1?signature=x', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(FACILITY_ID, 'doc-1')
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('keeps "Open file" disabled until the scan is clean, and explains an unfinished upload', async () => {
    api.documents.mockResolvedValue({ items: [{ ...DOCUMENT, status: 'initiated', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const documents = within(card('Documents'))
    expect((documents.getByRole('button', { name: 'Open file referral-letter.pdf' }) as HTMLButtonElement).disabled).toBe(true)
    expect(documents.getByText('Upload not completed; only the person who started it can finish it. Upload the file again.')).toBeTruthy()
    expect(documents.queryByText(/scan:/)).toBeNull()
  })

  it('states each file’s type and size in plain words, never the media type, the scan code or KiB', async () => {
    api.documents.mockResolvedValue({ items: [
      { ...DOCUMENT, id: 'doc-2', fileName: 'empty-form.pdf', sizeBytes: 0 },
      { ...DOCUMENT, id: 'doc-3', fileName: 'chest-film.tiff', mediaType: 'image/tiff', sizeBytes: '1572864' },
      { ...DOCUMENT, id: 'doc-4', fileName: 'unsized-letter.pdf', sizeBytes: '' },
      { ...DOCUMENT, id: 'doc-5', fileName: 'wound.jpg', mediaType: 'image/jpeg', sizeBytes: 57344, scanStatus: 'pending' },
      { ...DOCUMENT, id: 'doc-6', fileName: 'notes.bin', mediaType: 'application/x-unknown', sizeBytes: 1024, scanStatus: 'infected' },
      { ...DOCUMENT, id: 'doc-7', fileName: 'odd.png', mediaType: 'image/png', sizeBytes: 2048, scanStatus: 'quarantine_review' },
    ], nextCursor: null })
    await openEncounter()
    const row = async (fileName: string) => ((await within(card('Documents')).findByText(fileName)).closest('li') as HTMLElement).textContent
    expect(await row('empty-form.pdf')).toContain('PDF document · 0 KB · Checked')
    expect(await row('chest-film.tiff')).toContain('TIFF image · 1.5 MB · Checked')
    expect(await row('unsized-letter.pdf')).toContain('PDF document · Size unknown · Checked')
    expect(await row('wound.jpg')).toContain('JPEG image · 56 KB · Being checked for viruses')
    expect(await row('notes.bin')).toContain('File · 1 KB · Blocked: virus found')
    expect(await row('odd.png')).toContain('PNG image · 2 KB')
    const shown = card('Documents').textContent ?? ''
    expect(shown).not.toMatch(/KiB|image\/|application\/|Check:|quarantine/)
  })

  it('refuses a file over 50 MB in plain words, and uploads nothing', async () => {
    await openEncounter()
    const documents = within(card('Documents'))
    const input = documents.getByLabelText(labelled('Clinical document')) as HTMLInputElement
    const large = new File(['%PDF-1.4'], 'large-scan.pdf', { type: 'application/pdf' })
    Object.defineProperty(large, 'size', { value: 52_428_801 })
    fireEvent.change(input, { target: { files: [large] } })
    fireEvent.click(documents.getByRole('button', { name: 'Upload document' }))
    expect(documents.getByText('Use a PDF, JPEG, PNG or TIFF file of up to 50 MB.')).toBeTruthy()
    expect(document.activeElement).toBe(input)
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('refuses a link that is not a signed https link', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'javascript:alert(1)', expiresInSeconds: 60 })
    await openEncounter()
    fireEvent.click(within(card('Documents')).getByRole('button', { name: 'Open file referral-letter.pdf' }))
    expect((await within(card('Documents')).findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(opened).not.toHaveBeenCalled()
  })

  it('says a source page deleted after 24 hours in its own sentence, and opens nothing (hid-system 0110)', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ outcome: 'source_deleted' })
    await openEncounter()
    fireEvent.click(within(card('Documents')).getByRole('button', { name: 'Open file referral-letter.pdf' }))
    expect((await within(card('Documents')).findByRole('alert')).textContent).toBe('Source page deleted after 24 hours')
    expect(opened).not.toHaveBeenCalled()
  })

  it('lists a document whose source page was deleted with that sentence, and offers no download or OCR', async () => {
    api.documents.mockResolvedValue({ items: [{ ...DOCUMENT, status: 'source_deleted' }], nextCursor: null })
    await openEncounter()
    const row = (await within(card('Documents')).findByText('referral-letter.pdf')).closest('li') as HTMLElement
    expect(within(row).getByText('Source page deleted after 24 hours')).toBeTruthy()
    expect(within(row).queryByRole('button', { name: /Open file/ })).toBeNull()
    expect(within(row).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(row.textContent).not.toMatch(/source deleted/i)
    expect(api.documentDownload).not.toHaveBeenCalled()
  })

  it('checks the file, then uploads it after the access re-check', async () => {
    await openEncounter()
    const documents = within(card('Documents'))
    const upload = documents.getByRole('button', { name: 'Upload document' })
    expect(upload.getAttribute('type')).toBe('submit')
    fireEvent.click(upload)
    expect(documents.getByText('Select a file first.')).toBeTruthy()
    const input = documents.getByLabelText(labelled('Clinical document')) as HTMLInputElement
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    fireEvent.click(upload)
    expect(documents.getByText('Use a PDF, JPEG, PNG or TIFF file of up to 50 MB.')).toBeTruthy()
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(upload)
    expect(await documents.findByText('Uploaded. It can be opened once the virus check is done.')).toBeTruthy()
    expect(api.uploadDocument).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, file)
    expect(api.documents).toHaveBeenCalledTimes(2)
  })

  it('shows the empty and failed states', async () => {
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    await openEncounter()
    expect(within(card('Documents')).getByText('No documents for this consultation.')).toBeTruthy()
  })

  it('item 3: links a clean document to today’s OCR page with the ids in router state only, as today', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    renderWithOcr()
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    const link = await within(card('Documents')).findByRole('link', { name: 'Extract with OCR' })
    // The address names no record, patient or facility: today's route, and the ids in router state.
    expect(link.getAttribute('href')).toBe('/provider/ocr')
    for (const id of ['doc-1', PATIENT_ID, PATIENT_HID, FACILITY_ID, 'staff-1']) expect(link.getAttribute('href')).not.toContain(id)
    fireEvent.click(link)
    expect(await screen.findByTestId('ocr-page')).toBeTruthy()
    expect(screen.getByTestId('ocr-path').textContent).toBe('/provider/ocr')
    expect(screen.getByTestId('ocr-search').textContent).toBe('')
    expect(JSON.parse(screen.getByTestId('ocr-state').textContent ?? 'null')).toEqual({
      ocrDocumentId: 'doc-1', ocrPatientId: PATIENT_ID, actorId: 'staff-1', facilityId: FACILITY_ID,
    })
  })

  it('item 3: offers no OCR link without ocr.job.read, nor for a document whose scan is not clean', async () => {
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'lab-scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    expect(within(card('Documents')).getByText('referral-letter.pdf')).toBeTruthy()
    expect(within(card('Documents')).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
  })

  it('item 3: links only the clean document when the role may read OCR jobs', async () => {
    staff.permissions = [...ALL, 'ocr.job.read']
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'lab-scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    await openEncounter()
    const documents = within(card('Documents'))
    expect(documents.getAllByRole('link', { name: 'Extract with OCR' })).toHaveLength(1)
    expect(within(documents.getByText('lab-scan.pdf').closest('li') as HTMLElement).queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
    expect(within(documents.getByText('referral-letter.pdf').closest('li') as HTMLElement).getByRole('link', { name: 'Extract with OCR' })).toBeTruthy()
  })

  it('shows a refused document list as an alert', async () => {
    api.documents.mockRejectedValue(new HidApiError(503, 'Documents are unavailable.', { code: 'UNAVAILABLE' }))
    await openEncounter()
    await act(async () => {})
    expect(within(card('Documents')).getByRole('alert').textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('Documents are unavailable.')
  })
})

describe('Consultation record: More actions, diagnoses with a note change, and versions (#62)', () => {
  it('offers a signed note’s "Amend signed note" with the menu, and "Resume consultation" for one on hold', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold' })
    await openEncounter()
    expect(actions().getAllByRole('button').map(button => button.textContent?.replace('▾', ''))).toEqual(['Amend signed note', 'Add notes', 'More actions'])
    expect(menuLabels()).toEqual(['Resume consultation', 'Cancel consultation', 'Mark as entered in error', 'Mark note entered in error'])
  })

  it('marks the consultation note entered in error from More actions, under a typed reason, with a plain confirm', async () => {
    await openEncounter()
    chooseMore('Mark note entered in error')
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().textContent).toContain('Mark note entered in error open')
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'ok' } })
    fireEvent.click(submitOf('Mark note entered in error'))
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: 'Wrong patient' } })
    fireEvent.click(submitOf('Mark note entered in error'))
    expect(within(dialog()).getByRole('heading', { name: 'Mark note entered in error?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/Type .* to confirm/)).toBeNull()
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark note entered in error' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', 'note-1',
      { expectedRowVersion: 2, changeReason: 'Wrong patient', status: 'entered_in_error' })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
  })

  it('"Cancel" closes a status change More actions opened, changing nothing, with focus back on the menu button', async () => {
    await openEncounter()
    chooseMore('Cancel consultation')
    expect(actions().getByText(MAIN_WARNING)).toBeTruthy()
    const cancel = actions().getByRole('button', { name: 'Cancel' })
    expect(cancel.getAttribute('type')).toBe('button')
    act(() => { cancel.focus() })
    fireEvent.click(cancel)
    expect(actions().queryByText(MAIN_WARNING)).toBeNull()
    expect(actions().queryByLabelText(labelled('Reason for change'))).toBeNull()
    expect(document.activeElement).toBe(moreButton())
    expect(moreButton().textContent).not.toContain('open')
    expect(api.updateEncounter).not.toHaveBeenCalled()
  })

  it('the note’s own actions toggle with their button and carry no "Cancel"', async () => {
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Add notes' }))
    expect(actions().queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.click(actions().getAllByRole('button', { name: 'Add notes' })[0]!)
    expect(actions().queryByRole('button', { name: 'Save draft' })).toBeNull()
  })

  it('offers no "Add notes" to a role that may write notes but not read them', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    await screen.findByRole('heading', { level: 2, name: 'Actions' })
    expect(actions().queryByRole('button', { name: 'Add notes' })).toBeNull()
  })

  it('"Edit draft" takes New consultation’s diagnosis fields; the diagnosis is saved after the revision, a retry sending only it, under the same key', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    expect(saved.getByText('Optional. Add its code to save it as this consultation’s diagnosis.')).toBeTruthy()
    expect((saved.getByLabelText(labelled('Code system')) as HTMLInputElement).placeholder).toBe('ICD-10')
    expect((saved.getByLabelText(labelled('Clinical status')) as HTMLSelectElement).value).toBe('active')
    expect((saved.getByLabelText(labelled('Verification')) as HTMLSelectElement).value).toBe('unconfirmed')
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    const save = () => saved.getByRole('button', { name: 'Save draft' })
    fireEvent.click(save())
    // New consultation's check: with a diagnosis, its code system and code are needed too.
    expect(saved.getAllByText('Complete this field.')).toHaveLength(2)
    expect(api.addNoteRevision).not.toHaveBeenCalled()
    fireEvent.change(saved.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(save())
    expect((await saved.findByRole('alert')).textContent).toContain(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    // The revision is in, and the page says so; each save re-checked access first.
    expect(screen.getByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'unconfirmed',
    }, expect.any(String))

    fireEvent.click(save())
    expect(await screen.findByText('A new note revision was recorded. Clinical record saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(2)
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
    // Today's create read: the diagnoses' first page, fresh.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true })
  })

  it('a draft form left after its revision was saved and its diagnosis refused reads the note again', async () => {
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    fireEvent.change(saved.getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(saved.getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(saved.getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    api.createRecord.mockRejectedValueOnce(UNAVAILABLE())
    fireEvent.click(saved.getByRole('button', { name: 'Save draft' }))
    expect((await saved.findByRole('alert')).textContent).toContain(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    expect(api.records).not.toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true })
    records['clinical-notes'] = [{ ...NOTE, rowVersion: 3 }]
    fireEvent.click(saved.getByRole('button', { name: 'Cancel editing' }))
    await waitFor(() => expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true }))
    // The revision was sent once, and nothing more is sent.
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(1)
  })

  it('"Amend signed note" takes the diagnosis fields too, and shows a refused diagnosis field at its control', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Smear positive (fictional).' } })
    fireEvent.change(actions().getByLabelText(labelled('Diagnosis')), { target: { value: 'Malaria (fictional)' } })
    fireEvent.change(actions().getByLabelText(labelled('Code system')), { target: { value: 'ICD-10' } })
    fireEvent.change(actions().getByLabelText(labelled('Code')), { target: { value: 'B54' } })
    fireEvent.change(actions().getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Result back' } })
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'code', messages: ['code must be shorter than or equal to 100 characters'] }],
    }))
    fireEvent.click(submitOf('Amend signed note'))
    expect(await actions().findByRole('alert')).toBeTruthy()
    expect(actions().getByLabelText(labelled('Code')).getAttribute('aria-invalid')).toBe('true')
    fireEvent.click(submitOf('Amend signed note'))
    expect(await screen.findByText('A new note revision was recorded. Clinical record saved.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'B54', display: 'Malaria (fictional)', clinicalStatus: 'active', verificationStatus: 'confirmed',
    }, expect.any(String))
  })

  it('offers no diagnosis fields with a draft edit to a role that may write diagnoses but not read them, and adds none', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.read')
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    const saved = within(card('Note'))
    for (const label of ['Diagnosis', 'Code system', 'Code', 'Clinical status', 'Verification']) expect(saved.queryByLabelText(labelled(label))).toBeNull()
    fireEvent.change(saved.getByLabelText(labelled('Reason for revision')), { target: { value: 'Assessment added' } })
    fireEvent.click(saved.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText(REVISION_RECORDED)).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledTimes(1)
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('offers no diagnosis fields with an amendment to a role that may write diagnoses but not read them', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.read')
    records['clinical-notes'] = [{ ...NOTE, status: 'signed' }]
    await openEncounter()
    fireEvent.click(actions().getByRole('button', { name: 'Amend signed note' }))
    expect(actions().getByLabelText(labelled('Amendment'))).toBeTruthy()
    for (const label of ['Diagnosis', 'Code system', 'Code', 'Clinical status', 'Verification']) expect(actions().queryByLabelText(labelled(label))).toBeNull()
    fireEvent.change(actions().getByLabelText(labelled('Amendment')), { target: { value: 'Smear positive (fictional).' } })
    fireEvent.change(actions().getByLabelText(labelled('Reason')), { target: { value: 'Result back' } })
    fireEvent.click(submitOf('Amend signed note'))
    expect(await screen.findByText(REVISION_RECORDED)).toBeTruthy()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('offers no diagnosis fields with a note change without ehr.diagnosis.write', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.write')
    await openEncounter()
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }))
    expect(within(card('Note')).queryByLabelText(labelled('Code system'))).toBeNull()
    expect(within(card('Note')).getByLabelText(labelled('Clinical note'))).toBeTruthy()
  })

  it('shows a signed note’s versions with one revision: the version it was signed as', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T08:40:00.000Z' }]
    await openEncounter()
    expect(versionSummaries()).toEqual([`${formatWhen('2026-10-30T08:40:00.000Z')} · Version 1 · Draft · Sign note`])
    expect(within(card('Earlier versions')).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('places the signed version among an amended note’s revisions, with the content signed', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'amended', signedAt: '2026-10-30T08:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      REVISION,
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Duration corrected', createdAt: '2026-10-30T09:00:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    // Each revision is named by the status it was saved under: a draft before signing, an amendment after.
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-30T08:10:00.000Z')} · Version 1 · Draft · Initial draft`,
      `${formatWhen('2026-10-30T08:40:00.000Z')} · Version 1 · Draft · Sign note`,
      `${formatWhen('2026-10-30T09:00:00.000Z')} · Version 2 · Amended · Duration corrected`,
    ])
    const signed = Array.from(card('Earlier versions').querySelectorAll('details'))[1]!
    expect(within(signed).getByText('History\nCough for three days.', { normalizer: value => value })).toBeTruthy()
  })

  it('names a signed note’s draft edits "Draft", not by the status the note has now', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'signed', signedAt: '2026-10-30T09:40:00.000Z' }]
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, createdAt: '2026-10-30T09:31:00.000Z', changeReason: 'Initial note' },
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Added plan', createdAt: '2026-10-30T09:35:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-30T09:31:00.000Z')} · Version 1 · Draft · Initial note`,
      `${formatWhen('2026-10-30T09:35:00.000Z')} · Version 2 · Draft · Added plan`,
      `${formatWhen('2026-10-30T09:40:00.000Z')} · Version 2 · Draft · Sign note`,
    ])
  })

  it('names a never-signed note’s revisions "Draft" once it is marked entered in error', async () => {
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error' }]
    api.noteRevisions.mockResolvedValue([
      { ...REVISION, createdAt: '2026-10-29T09:31:00.000Z', changeReason: 'Initial note' },
      { ...REVISION, id: 'rev-2', revisionNo: 2, content: 'History\nCough for four days.', changeReason: 'Added plan', createdAt: '2026-10-29T09:35:00.000Z' },
    ])
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Earlier versions' })
    // Both were saved while the note was a draft; only the note itself is now entered in error.
    expect(versionSummaries()).toEqual([
      `${formatWhen('2026-10-29T09:31:00.000Z')} · Version 1 · Draft · Initial note`,
      `${formatWhen('2026-10-29T09:35:00.000Z')} · Version 2 · Draft · Added plan`,
    ])
  })

  it('shows no versions card for a draft with one revision', async () => {
    await openEncounter()
    expect(screen.queryByRole('heading', { level: 2, name: 'Earlier versions' })).toBeNull()
  })

  it('shows each history list’s own failure, so a refused document list is not hidden by a failed vitals read', async () => {
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'vitals') throw new HidApiError(503, 'Vitals are unavailable.', { code: 'UNAVAILABLE' })
      return { items: records[kind] ?? [], nextCursor: null }
    })
    api.documents.mockRejectedValue(new HidApiError(403, 'Your role cannot read documents for this patient.', { code: 'PERMISSION_DENIED' }))
    await openEncounter()
    await waitFor(() => expect(history().getAllByRole('alert')).toHaveLength(2))
    expect(history().getAllByRole('alert').map(alert => alert.textContent)).toEqual([SAID_UNAVAILABLE, SAID_REFUSED])
    expect(document.body.textContent).not.toMatch(/Vitals are unavailable|Your role cannot read documents/)
  })

  it('says a failure two history lists share once', async () => {
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'vitals') throw UNAVAILABLE()
      return { items: records[kind] ?? [], nextCursor: null }
    })
    api.documents.mockRejectedValue(UNAVAILABLE())
    await openEncounter()
    await waitFor(() => expect(history().getByRole('alert').textContent).toBe(SAID_UNAVAILABLE))
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    expect(history().getAllByRole('alert')).toHaveLength(1)
  })
})

describe('Consultation record: "Try again" after a change made in a card whose list could not be read again', () => {
  const sentence = () => screen.queryAllByRole('alert').find(alert => alert.textContent?.startsWith(RELOAD_FAILED)) ?? null

  it('reads the diagnoses again, the page shown, fresh, after a diagnosis change, and the diagnosis shows what EHR now holds', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    const row = within(diagnoses.getByText('Malaria (fictional)').closest('li') as HTMLElement)
    fireEvent.change(row.getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    const read = api.records.getMockImplementation()!
    api.records.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(row.getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()?.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}Try again`))
    expect(within(card('Diagnoses')).getByText('ICD-10 B54 · Active · Provisional')).toBeTruthy()
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'confirmed', rowVersion: 2 }]
    api.records.mockImplementation(read)
    const reads = api.records.mock.calls.length
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(within(sentence()!).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(sentence()).toBeNull())
    expect(api.records.mock.calls.slice(reads)).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'diagnoses', { cursor: undefined, fresh: true }]])
    expect(api.lookupPatient.mock.calls.length).toBe(checks)
    expect(within(card('Diagnoses')).getByText('ICD-10 B54 · Active · Confirmed')).toBeTruthy()
    expect(screen.getByText('Diagnosis updated.')).toBeTruthy()
  })

  it('reads the notes again after a note marked entered in error in the Notes card, and the note shows its new status', async () => {
    await openEncounter()
    const row = () => within(within(card('Notes')).getByText('Consultation note').closest('li') as HTMLElement)
    fireEvent.click(row().getByRole('button', { name: 'Review note content' }))
    expect(await row().findByText('Cough for three days.', { exact: false })).toBeTruthy()
    fireEvent.click(row().getByRole('button', { name: 'Mark entered in error' }))
    fireEvent.change(row().getByLabelText(labelled('Reason for change')), { target: { value: 'Written on the wrong visit' } })
    const read = api.records.getMockImplementation()!
    api.records.mockRejectedValue(UNAVAILABLE())
    api.updateRecord.mockResolvedValue({ ...NOTE, status: 'entered_in_error', rowVersion: 3 })
    fireEvent.click(row().getAllByRole('button', { name: 'Mark entered in error' }).find(button => button.getAttribute('type') === 'submit')!)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()).not.toBeNull())
    expect(row().getByText('Draft')).toBeTruthy()
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error', rowVersion: 3 }]
    api.records.mockImplementation(read)
    const reads = api.records.mock.calls.length
    fireEvent.click(within(sentence()!).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(sentence()).toBeNull())
    expect(api.records.mock.calls.slice(reads)).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { cursor: undefined, fresh: true }]])
    expect(row().getByText('Entered in error')).toBeTruthy()
  })

  it('after two cards’ lists fail to be read again in turn, reads both again, and each shows what EHR now holds', async () => {
    await openEncounter()
    // The Notes card: a note marked entered in error, its list not read again.
    const row = () => within(within(card('Notes')).getByText('Consultation note').closest('li') as HTMLElement)
    fireEvent.click(row().getByRole('button', { name: 'Review note content' }))
    expect(await row().findByText('Cough for three days.', { exact: false })).toBeTruthy()
    fireEvent.click(row().getByRole('button', { name: 'Mark entered in error' }))
    fireEvent.change(row().getByLabelText(labelled('Reason for change')), { target: { value: 'Written on the wrong visit' } })
    const read = api.records.getMockImplementation()!
    api.records.mockRejectedValue(UNAVAILABLE())
    api.updateRecord.mockResolvedValue({ ...NOTE, status: 'entered_in_error', rowVersion: 3 })
    fireEvent.click(row().getAllByRole('button', { name: 'Mark entered in error' }).find(button => button.getAttribute('type') === 'submit')!)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    await waitFor(() => expect(sentence()).not.toBeNull())
    records['clinical-notes'] = [{ ...NOTE, status: 'entered_in_error', rowVersion: 3 }]
    // Then the Diagnoses card: a diagnosis changed, its list not read again either.
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    const dx = within(diagnoses.getByText('Malaria (fictional)').closest('li') as HTMLElement)
    fireEvent.change(dx.getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(dx.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    const failed = api.records.mock.calls.length
    fireEvent.click(dx.getByRole('button', { name: 'Update diagnosis' }))
    expect(await screen.findByText('Diagnosis updated.')).toBeTruthy()
    await waitFor(() => expect(api.records.mock.calls.length).toBe(failed + 1))
    await act(async () => {})
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(1)
    expect(row().getByText('Draft')).toBeTruthy()
    records.diagnoses = [{ ...DIAGNOSIS, verificationStatus: 'confirmed', rowVersion: 2 }]
    api.records.mockImplementation(read)
    const reads = api.records.mock.calls.length
    fireEvent.click(within(sentence()!).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(sentence()).toBeNull())
    expect(api.records.mock.calls.slice(reads).map(call => call[3]).sort()).toEqual(['clinical-notes', 'diagnoses'])
    expect(row().getByText('Entered in error')).toBeTruthy()
    expect(within(card('Diagnoses')).getByText('ICD-10 B54 · Active · Confirmed')).toBeTruthy()
  })

  it('keeps the outcome of a change made while Try again reads: a later failure of that read does not bring the sentence back', async () => {
    await openEncounter()
    const diagnoses = within(card('Diagnoses'))
    fireEvent.click(diagnoses.getByRole('button', { name: 'Change this diagnosis' }))
    const row = within(diagnoses.getByText('Malaria (fictional)').closest('li') as HTMLElement)
    fireEvent.change(row.getByLabelText(labelled('Verification')), { target: { value: 'confirmed' } })
    fireEvent.change(row.getByLabelText(labelled('Reason for change')), { target: { value: 'Smear positive' } })
    const read = api.records.getMockImplementation()!
    api.records.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(row.getByRole('button', { name: 'Update diagnosis' }))
    await waitFor(() => expect(sentence()).not.toBeNull())
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    api.records.mockImplementation(async (...args: Parameters<typeof read>) => {
      if (args[3] === 'diagnoses') { await held; throw UNAVAILABLE() }
      return read(...args)
    })
    fireEvent.click(within(sentence()!).getByRole('button', { name: 'Try again' }))
    // Meanwhile a note is added: the page says that change's own outcome.
    fireEvent.click(actions().getByRole('button', { name: 'Add notes' }))
    fireEvent.change(actions().getByLabelText(labelled('Note type')), { target: { value: 'Progress' } })
    fireEvent.change(actions().getByLabelText(labelled('Title')), { target: { value: 'Evening review' } })
    fireEvent.change(actions().getByLabelText(labelled('Clinical note')), { target: { value: 'Fever settling.' } })
    fireEvent.click(actions().getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Clinical record saved.')).toBeTruthy()
    expect(sentence()).toBeNull()
    await act(async () => release())
    await act(async () => {})
    expect(sentence()).toBeNull()
    expect(screen.getByText('Clinical record saved.')).toBeTruthy()
  })

  it('in the Documents card, after an upload whose list could not be read again, reads the documents again and focus goes to the file field', async () => {
    await openEncounter()
    const documents = () => within(card('Documents'))
    const input = documents().getByLabelText(labelled('Clinical document')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    api.documents.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(documents().getByRole('button', { name: 'Upload document' }))
    expect(await documents().findByText('Uploaded. It can be opened once the virus check is done.')).toBeTruthy()
    await waitFor(() => expect(sentence()?.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}Try again`))
    // The sentence and its Try again are the card's own, as before, and the only ones on the page.
    expect(card('Documents').contains(sentence())).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Try again' })).toEqual([within(sentence()!).getByRole('button', { name: 'Try again' })])
    expect(documents().queryByText('scan.pdf')).toBeNull()
    api.documents.mockResolvedValue({ items: [DOCUMENT, { ...DOCUMENT, id: 'doc-2', fileName: 'scan.pdf', scanStatus: 'pending' }], nextCursor: null })
    const reads = api.documents.mock.calls.length
    const checks = api.lookupPatient.mock.calls.length
    const button = within(sentence()!).getByRole('button', { name: 'Try again' })
    button.focus()
    fireEvent.click(button)
    await waitFor(() => expect(sentence()).toBeNull())
    expect(api.documents.mock.calls.length).toBe(reads + 1)
    expect(api.lookupPatient.mock.calls.length).toBe(checks)
    expect(documents().getByText('scan.pdf')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(document.activeElement).toBe(documents().getByLabelText(labelled('Clinical document')))
  })

  it('in the Documents card, keeps the sentence when Try again fails, said anew, and offers no Try again beside another failure', async () => {
    await openEncounter()
    const documents = () => within(card('Documents'))
    const input = documents().getByLabelText(labelled('Clinical document')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    api.documents.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(documents().getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(sentence()).not.toBeNull())
    const before = sentence()!.querySelector('p')!
    const button = within(sentence()!).getByRole('button', { name: 'Try again' })
    fireEvent.click(button)
    await waitFor(() => expect(sentence()!.querySelector('p')).not.toBe(before))
    expect(sentence()!.querySelector('p')!.textContent).toBe(`${RELOAD_FAILED} ${SAID_UNAVAILABLE}`)
    expect(within(sentence()!).getByRole('button', { name: 'Try again' })).toBe(button)
    // An upload refused outright says only why, with no Try again.
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    api.uploadDocument.mockRejectedValue(new HidApiError(503, 'Uploads are paused.', { code: 'UNAVAILABLE' }))
    fireEvent.click(documents().getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(documents().getByRole('alert').textContent).toBe(SAID_UNAVAILABLE))
    expect(document.body.textContent).not.toContain('Uploads are paused')
    expect(sentence()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('in the Documents card, keeps the outcome of an upload made while Try again reads', async () => {
    await openEncounter()
    const documents = () => within(card('Documents'))
    const input = documents().getByLabelText(labelled('Clinical document')) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    api.documents.mockRejectedValue(UNAVAILABLE())
    fireEvent.click(documents().getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(sentence()).not.toBeNull())
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    api.documents.mockImplementation(async () => { await held; throw UNAVAILABLE() })
    fireEvent.click(within(sentence()!).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.documents).toHaveBeenCalledTimes(3))
    fireEvent.change(input, { target: { files: [new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })] } })
    api.uploadDocument.mockRejectedValue(new HidApiError(503, 'Uploads are paused.', { code: 'UNAVAILABLE' }))
    fireEvent.click(documents().getByRole('button', { name: 'Upload document' }))
    await waitFor(() => expect(documents().getByRole('alert').textContent).toBe(SAID_UNAVAILABLE))
    await act(async () => release())
    await act(async () => {})
    expect(documents().getByRole('alert').textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('Uploads are paused')
    expect(sentence()).toBeNull()
  })
})
