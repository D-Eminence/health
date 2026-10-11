import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { Ocr } from '../Operations'

/**
 * Finding a clinical document's OCR job, and creating one. A job is offered for
 * creation only once a lookup has answered that none exists, so a failed lookup
 * (or none at all) cannot lead to a duplicate extraction of the same document.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(),
  createOcrJob: vi.fn(),
  ocrExtractions: vi.fn(),
  ocrValidations: vi.fn(),
  lookupPatient: vi.fn(),
  consentStatus: vi.fn(),
  encounters: vi.fn(),
  records: vi.fn(),
  documents: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const CREATE = { name: 'Create extraction job' }

function ShowState() {
  const state = useLocation().state as Record<string, unknown> | null
  return <output data-testid="handoff">{JSON.stringify(state)}</output>
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = ['ocr.job.read', 'ocr.job.write']
  staff.activePatient = null
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [] })
})

describe('creating an OCR job for a document', () => {
  it('is not offered before a lookup has answered', async () => {
    render(<MemoryRouter><Ocr /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    expect(screen.queryByRole('button', CREATE)).toBeNull()
  })

  it('is offered once a lookup answers that the document has no job', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    render(<MemoryRouter><Ocr /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    expect(await screen.findByText('No OCR job exists for this document.')).toBeTruthy()
    expect(screen.getByRole('button', CREATE)).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT)
  })

  it('is not offered when the lookup fails, since a job may already exist', async () => {
    api.findOcrJob.mockRejectedValue(new HidApiError(403, 'Request origin is not allowed', { code: 'ORIGIN_DENIED' }))
    render(<MemoryRouter><Ocr /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('button', CREATE)).toBeNull()
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('starts from the document and patient handed over by a clinical document', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    render(<MemoryRouter initialEntries={[{ pathname: '/provider/ocr', state: { ocrDocumentId: DOCUMENT, ocrPatientId: PATIENT } }]}><Ocr /></MemoryRouter>)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(DOCUMENT)
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    await screen.findByRole('button', CREATE)
    expect((screen.getByLabelText(/^Patient ID/) as HTMLInputElement).value).toBe(PATIENT)
  })
})

describe('a clinical document', () => {
  const document = (scanStatus: string, id = DOCUMENT) => ({ id, patientId: PATIENT, encounterId: 'e0000000-0000-4000-8000-000000000001',
    fileName: `${scanStatus}.pdf`, mediaType: 'application/pdf', sizeBytes: 2048, status: 'uploaded', scanStatus, createdAt: '2026-10-10T09:00:00.000Z' })

  beforeEach(() => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup: {
      patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
      authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false },
    } }
    api.lookupPatient.mockResolvedValue((staff.activePatient as { lookup: unknown }).lookup)
    api.consentStatus.mockResolvedValue({ allowed: true, writeAllowed: false })
    api.encounters.mockResolvedValue({ items: [{ id: 'e0000000-0000-4000-8000-000000000001', patientId: PATIENT, facilityId: 'facility-1',
      encounterType: 'outpatient', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    api.documents.mockResolvedValue({ items: [document('clean'), document('pending', 'd0000000-0000-4000-8000-000000000002')], nextCursor: null })
  })

  function openDocuments() {
    render(<MemoryRouter initialEntries={['/provider/clinical']}><Routes>
      <Route path="/provider/clinical" element={<Clinical />} />
      <Route path="/provider/ocr" element={<ShowState />} />
    </Routes></MemoryRouter>)
  }

  it('links a clean document to OCR, handing over its IDs outside the URL', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.document.read', 'ocr.job.read']
    openDocuments()
    await screen.findByText('clean.pdf')
    const links = screen.getAllByRole('link', { name: 'Extract with OCR' })
    expect(links).toHaveLength(1)
    expect(links[0]!.getAttribute('href')).toBe('/provider/ocr')
    fireEvent.click(links[0]!)
    await waitFor(() => expect(JSON.parse(screen.getByTestId('handoff').textContent!)).toEqual({ ocrDocumentId: DOCUMENT, ocrPatientId: PATIENT }))
  })

  it('offers no OCR link without OCR read permission', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.document.read']
    openDocuments()
    await screen.findByText('clean.pdf')
    expect(screen.queryByRole('link', { name: 'Extract with OCR' })).toBeNull()
  })
})
