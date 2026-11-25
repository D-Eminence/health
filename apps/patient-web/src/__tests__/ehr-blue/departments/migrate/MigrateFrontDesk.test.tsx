import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CHECK_NEEDS_CHECKER, Migrate, NO_DOCUMENT_OCR } from '../../../../ehr-blue/departments/migrate/Migrate'
import { migratePage } from '../../../../ehr-blue/departments/migrate/page'
import { pages as framePages } from '../../../../ehr-blue/frame/pages'
import { pageAllowed } from '../../../../ehr-blue/frame/pageAccess'
import { PAGE_GUIDES } from '../../../../ehr-blue/frame/pageGuides'
import type { StaffSession } from '../../../../staff/api'
import { OWN_DOCUMENTS_ONLY, STARTS_WITH_OTHERS, TEXT_WITH_CHECKERS, scanAccess } from '../../../../scanAccess'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'

/**
 * hid-system 0136 C1 / Q112 A on the blue Migrate page: the front desk scans paper records and starts readings (its
 * own uploads' documents and readings only, never what was read), and a doctor, who checks readings but no longer
 * starts them, is told who does instead of being offered a button that would only be refused. Fictional data only:
 * Patient One, HID-ZDEMAAA2, Demo Hospital.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), documents: vi.fn(), uploadDocument: vi.fn(), documentDownload: vi.fn(),
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), createOcrJob: vi.fn(), retryOcrJob: vi.fn(),
}))
const session = vi.hoisted(() => ({
  permissions: [] as string[],
  activePatient: null as null | { hid: string; purpose: 'direct-care'; lookup: { patient: { patientId: string; fullName: string } } },
  setActivePatient: vi.fn(),
}))

vi.mock('../../../../staff/api', () => ({
  staffApi: api,
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) => lookup.authorization.decision === 'allow' && !!lookup.patient,
}))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => ({ ...staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital' })),
      activePatient: session.activePatient, setActivePatient: session.setActivePatient }),
  }
})
vi.mock('../../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

/** The front desk's codes after 0136 (docs/INTERFACE_CONTRACT.md, "Permission keys before and after, per role"). */
const FRONT_DESK = ['identity.patient.read', 'ehr.encounter.read', 'ehr.document.write', 'ehr.document.read-own', 'ocr.job.write',
  'ocr.job.start', 'ocr.job.read-own', 'ehr.vital.read']
/** A role that follows and checks readings but may not start one: a doctor's codes from 0136 until 0150. */
const CHECKER = ['identity.patient.read', 'ehr.encounter.read', 'ehr.document.read', 'ehr.document.write', 'ocr.job.write', 'ocr.job.read',
  'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write']
/** A doctor's since hid-system 0150 (owner decision Q141 B): every OCR code, ocr.job.start again among them. */
const DOCTOR = [...CHECKER, 'ocr.job.start']
/** A permission's name, Identity's code or "unverified": none belongs on a staff screen. */
const SCREEN_WORDS_NOT_SAID = /permission|ocr\.job|ehr\.document|read-own|unverified/i

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'outpatient', status: 'in_progress',
  startedAt: '2026-10-12T09:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
const scan = { id: DOCUMENT, patientId: PATIENT, encounterId: ENCOUNTER, fileName: 'old-clinic-card.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', createdAt: '2026-10-12T09:30:00.000Z' }
const job = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 1,
  status: 'queued', attemptCount: 0, maxAttempts: 3, patientConfirmation: null }

beforeEach(() => {
  vi.clearAllMocks()
  session.permissions = FRONT_DESK
  session.activePatient = { hid: 'HID-ZDEMAAA2', purpose: 'direct-care', lookup: { patient: { patientId: PATIENT, fullName: 'Patient One' } } }
  api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow' }, patient: { patientId: PATIENT, fullName: 'Patient One' } })
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [encounter], nextCursor: null })
  api.documents.mockResolvedValue({ items: [scan], nextCursor: null })
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [] })
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const documentsCard = () => screen.getByRole('heading', { name: 'Patient documents' }).closest('section') as HTMLElement
const scanRow = () => screen.getByText('old-clinic-card.pdf').closest('tr') as HTMLElement

function sessionWith(permissions: readonly string[]): StaffSession {
  const current = { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', permissions }
  return { actor: { id: 'staff-demo-1', displayName: 'Demo Staff', roles: [], permissions: [], facilities: [current], facility: current },
    expiresAt: '2026-11-30T12:00:00.000Z' } as unknown as StaffSession
}

describe('who opens Scan paper records (the page registry)', () => {
  const standIn = framePages.find(page => page.path === 'ocr')!
  it.each([
    ['the front desk, following its own uploads’ readings', ['ocr.job.read-own'], true],
    ['staff following every reading', ['ocr.job.read'], true],
    ['staff who only upload documents', ['ehr.document.write', 'ehr.document.read-own', 'ocr.job.write', 'ocr.job.start'], false],
    ['staff with none of the scan codes', [], false],
  ] as const)('%s: %s', (_who, permissions, opens) => {
    expect(pageAllowed(migratePage, sessionWith(permissions))).toBe(opens)
    expect(pageAllowed(standIn, sessionWith(permissions))).toBe(opens)
  })
})

describe('scanAccess', () => {
  it('gives the front desk its own uploads, starting a reading, and never what was read', () => {
    expect(scanAccess(FRONT_DESK)).toEqual({ followsReadings: true, readsText: false, startsReadings: true,
      readsDocuments: true, ownDocumentsOnly: true, uploadsDocuments: true })
  })
  it('gives a doctor every reading, its text and starting a reading (0150)', () => {
    expect(scanAccess(DOCTOR)).toMatchObject({ followsReadings: true, readsText: true, startsReadings: true,
      readsDocuments: true, ownDocumentsOnly: false })
  })
  it('gives a role without ocr.job.start every reading and its text, but no start', () => {
    expect(scanAccess(CHECKER)).toMatchObject({ followsReadings: true, readsText: true, startsReadings: false,
      readsDocuments: true, ownDocumentsOnly: false })
  })
  it('lets the full code win over the "-own" one, and takes a check of one code as well as a list', () => {
    const both = ['ocr.job.read', 'ocr.job.read-own', 'ehr.document.read', 'ehr.document.read-own']
    expect(scanAccess(both)).toMatchObject({ readsText: true, ownDocumentsOnly: false })
    expect(scanAccess(code => both.includes(code))).toEqual(scanAccess(both))
  })
  it('starts no reading without ocr.job.start, nor without ocr.job.write', () => {
    expect(scanAccess(['ocr.job.read', 'ocr.job.write']).startsReadings).toBe(false)
    expect(scanAccess(['ocr.job.read-own', 'ocr.job.start']).startsReadings).toBe(false)
  })
})

describe('the front desk on Scan paper records', () => {
  it('opens the page with its own uploads, the upload form and Extract with OCR, in plain words', async () => {
    renderDept(<Migrate />)
    expect(await screen.findByText('old-clinic-card.pdf')).toBeTruthy()
    expect(screen.queryByText(NO_DOCUMENT_OCR)).toBeNull()
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(within(documentsCard()).getByText(OWN_DOCUMENTS_ONLY)).toBeTruthy()
    expect(within(documentsCard()).getByRole('button', { name: 'Upload document' })).toBeTruthy()
    expect(within(scanRow()).getByRole('button', { name: 'Extract with OCR' })).toBeTruthy()
    expect(screen.queryByText(STARTS_WITH_OTHERS)).toBeNull()
    expect(document.body.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  it('starts a reading from a scan and follows it, but never reads what was read, its checks or its publications', async () => {
    api.findOcrJob.mockResolvedValueOnce({ job: null }).mockResolvedValue({ job })
    api.createOcrJob.mockResolvedValue(job)
    renderDept(<Migrate />)
    await screen.findByText('old-clinic-card.pdf')
    await press(within(scanRow()).getByRole('button', { name: 'Extract with OCR' }))
    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeTruthy()
    expect(api.createOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT, PATIENT)
    expect(screen.getByText(TEXT_WITH_CHECKERS)).toBeTruthy()
    // The back way to its documents, which it reads (its own uploads).
    expect(screen.getByRole('button', { name: /Back to documents/ })).toBeTruthy()
    fireEvent.click(screen.getByText('Details'))
    expect(screen.queryByText('Extractions')).toBeNull()
    expect(api.ocrExtractions).not.toHaveBeenCalled()
    expect(api.ocrValidations).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  it('in New document job, says the visit has none of its own uploads, not that the visit has no documents', async () => {
    api.documents.mockResolvedValue({ items: [], nextCursor: null })
    renderDept(<Migrate />)
    await press(await screen.findByRole('button', { name: 'Create record' }))
    const form = screen.getByRole('form', { name: 'New document job' })
    expect(await within(form).findByText('You haven’t uploaded a document on this visit. Upload one in Patient documents first.')).toBeTruthy()
    expect(within(form).getByText(OWN_DOCUMENTS_ONLY)).toBeTruthy()
    expect(within(form).queryByText(/No documents on this visit yet/)).toBeNull()
    expect(form.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  it('in New document job, lists its own uploads under the same note', async () => {
    renderDept(<Migrate />)
    await press(await screen.findByRole('button', { name: 'Create record' }))
    const form = screen.getByRole('form', { name: 'New document job' })
    expect(await within(form).findByRole('radio', { name: 'old-clinic-card.pdf' })).toBeTruthy()
    expect(within(form).getByText(OWN_DOCUMENTS_ONLY)).toBeTruthy()
  })

  it('says who checks a reading that is ready, with no Check and save form and nothing read', async () => {
    api.findOcrJob.mockResolvedValue({ job: { ...job, status: 'awaiting_validation', version: 3, attemptCount: 1 } })
    renderDept(<Migrate />)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(screen.getByRole('button', { name: 'Find job' }))
    expect(await screen.findByText(CHECK_NEEDS_CHECKER)).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Check and save' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What was read' })).toBeNull()
    expect(api.ocrExtractions).not.toHaveBeenCalled()
  })
})

describe('a doctor since 0150, who starts readings and checks them', () => {
  beforeEach(() => { session.permissions = DOCTOR })

  it('is offered Create record and Extract with OCR, and no sentence about who starts readings', async () => {
    renderDept(<Migrate />)
    await screen.findByText('old-clinic-card.pdf')
    expect(screen.getByRole('button', { name: 'Create record' })).toBeTruthy()
    expect(within(scanRow()).getByRole('button', { name: 'Extract with OCR' })).toBeTruthy()
    expect(within(scanRow()).queryByRole('button', { name: 'Find its reading' })).toBeNull()
    expect(screen.queryByText(STARTS_WITH_OTHERS)).toBeNull()
    expect(document.body.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })
})

describe('a role that checks readings but does not start them', () => {
  beforeEach(() => { session.permissions = CHECKER })

  it('is offered no Create record and no Extract with OCR, and is told who starts readings', async () => {
    renderDept(<Migrate />)
    await screen.findByText('old-clinic-card.pdf')
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(within(scanRow()).queryByRole('button', { name: 'Extract with OCR' })).toBeNull()
    expect(within(scanRow()).getByRole('button', { name: 'Find its reading' })).toBeTruthy()
    // Once above the page, once under the documents it would start from.
    expect(screen.getAllByText(STARTS_WITH_OTHERS)).toHaveLength(2)
    expect(within(documentsCard()).queryByText(OWN_DOCUMENTS_ONLY)).toBeNull()
    expect(document.body.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  /** Consultation › Documents' "Find its reading": the document and its patient in router state, never in the address. */
  const handOver = () => render(<MemoryRouter initialEntries={[{ pathname: '/ehr/migrate',
    state: { ocrDocumentId: DOCUMENT, ocrPatientId: PATIENT, actorId: 'staff-demo-1', facilityId: DEMO_HOSPITAL_ID } }]}>
    <div className="hid-ehr"><Migrate /></div></MemoryRouter>)

  it('arriving from Find its reading, has the document’s reading looked up and opened, and never started', async () => {
    api.findOcrJob.mockResolvedValue({ job: { ...job, status: 'awaiting_validation', version: 3, attemptCount: 1 } })
    handOver()
    expect(await screen.findByRole('heading', { name: 'Progress' })).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
    expect(api.findOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
    expect(api.createOcrJob).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  it('arriving from Find its reading for a document with none yet, is told so and who starts readings', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    handOver()
    const result = await screen.findByText('No OCR job for this document')
    expect(result.closest('#ocr-find-result')?.textContent).toContain(STARTS_WITH_OTHERS)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(DOCUMENT)
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('gets the sentence, not Retry job, on a reading that failed', async () => {
    api.findOcrJob.mockResolvedValue({ job: { ...job, status: 'failed', attemptCount: 1 } })
    renderDept(<Migrate />)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(screen.getByRole('button', { name: 'Find job' }))
    const progress = (await screen.findByRole('heading', { name: 'Progress' })).closest('section') as HTMLElement
    await waitFor(() => expect(within(progress).getByText(STARTS_WITH_OTHERS)).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Retry job' })).toBeNull()
    expect(api.retryOcrJob).not.toHaveBeenCalled()
  })
})

describe('the words for each role (hid-system 0136)', () => {
  it('the Guide names who starts a reading and who checks it, instead of steps the front desk cannot take', () => {
    const steps = PAGE_GUIDES.ocr!.steps
    expect(steps.find(step => step.includes('Create record'))).toMatch(/^The front desk, doctors, nurses and clinicians start a reading/)
    expect(steps.find(step => step.includes('check what was read'))).toMatch(/^Doctors, nurses and clinicians check what was read/)
    expect(steps.some(step => step.includes('Find its reading'))).toBe(true)
    // Doctors start readings again since 0150 (Q141 B): the Guide no longer sends them to Find its reading.
    expect(steps.join(' ')).not.toMatch(/Doctors select Find its reading/)
    expect([...steps, ...(PAGE_GUIDES.ocr!.tips ?? [])].join(' ')).not.toMatch(SCREEN_WORDS_NOT_SAID)
  })

  it('refuses a role that follows no reading by saying who scans paper records here, not that it isn’t available yet', () => {
    session.permissions = ['identity.patient.read', 'ehr.encounter.read']
    renderDept(<Migrate />)
    expect(screen.getByRole('alert').textContent).toBe('Scanning paper records is done by the front desk, doctors, nurses and clinicians here.')
    expect(document.body.textContent).not.toMatch(/available at your facility yet/)
  })
})
