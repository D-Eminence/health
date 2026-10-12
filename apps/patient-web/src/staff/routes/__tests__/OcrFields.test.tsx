import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ocr } from '../Operations'

/**
 * What the OCR page's fields say to assistive technology, and what they let a
 * keyboard user reach: OCR-A11Y-06, NEW-OCR-CREATE-DISABLED,
 * NEW-OCR-RAWTEXT-SCROLL and NEW-OCR-REVIEW-HINT.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(), createOcrJob: vi.fn(),
}))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ocr.job.read', 'ocr.job.write', 'ocr.validation.write'],
    } } } },
    lock: null,
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const awaiting = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 3,
  status: 'awaiting_validation', attemptCount: 1, maxAttempts: 3, patientConfirmation: null }
const extraction = { id: 'extraction-1', version: 1, provider: 'textract', confidence: 0.92, rawText: 'Haemoglobin 12.1', structuredPayload: {} }

beforeEach(() => {
  vi.clearAllMocks()
  api.ocrExtractions.mockResolvedValue({ items: [extraction] })
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

async function findJob(job: object | null) {
  api.findOcrJob.mockResolvedValue({ job })
  render(<MemoryRouter initialEntries={['/provider/ocr']}><Ocr /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
  if (job) await screen.findByRole('heading', { name: 'Job status' })
  else await screen.findByText('No OCR job exists for this document.')
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The texts of the elements `control` is described by, in order. */
function descriptions(control: HTMLElement) {
  return (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? `(missing #${id})`)
}

describe('creating an extraction job', () => {
  it('OCR-A11Y-06: Patient ID is required to assistive technology, as its asterisk shows', async () => {
    await findJob(null)
    const patient = screen.getByLabelText(/^Patient ID/) as HTMLInputElement
    expect(patient.required || patient.getAttribute('aria-required') === 'true').toBe(true)
  })

  it('NEW-OCR-CREATE-DISABLED: Create extraction job stays available, and an empty Patient ID is refused at the field', async () => {
    await findJob(null)
    const create = screen.getByRole('button', { name: 'Create extraction job' }) as HTMLButtonElement
    expect(create.disabled).toBe(false)

    await press(create)
    const patient = screen.getByLabelText(/^Patient ID/)
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(patient.getAttribute('aria-invalid')).toBe('true')
    expect(patient.getAttribute('aria-describedby')).toBe('ocr-patient-error')
    expect(document.getElementById('ocr-patient-error')?.textContent).toBe('Enter the patient ID.')
    expect(api.createOcrJob).not.toHaveBeenCalled()

    // Typing clears the refusal; the job is created once the ID is given.
    fireEvent.change(patient, { target: { value: PATIENT } })
    expect(patient.getAttribute('aria-invalid')).toBeNull()
    expect(document.getElementById('ocr-patient-error')).toBeNull()
    api.createOcrJob.mockResolvedValue({ ...awaiting, status: 'queued' })
    await press(create)
    await waitFor(() => expect(api.createOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT, PATIENT))
  })
})

/**
 * EHR-FORMS-01 (OCR part). OCR takes document and patient IDs only as UUID v4
 * (hid-system find-ocr-job.dto.ts, create-ocr-job.dto.ts and
 * confirm-ocr-patient.dto.ts: IsUUID('4')), and answers anything else with a
 * generic 400 that names no field. The page says so at the field instead.
 */
describe('OCR IDs are UUIDs', () => {
  it('a document ID that is not a UUID is refused at its field, and nothing is sent', async () => {
    render(<MemoryRouter initialEntries={['/provider/ocr']}><Ocr /></MemoryRouter>)
    const documentId = screen.getByLabelText(/^Document ID/)
    fireEvent.change(documentId, { target: { value: ' DOC-2024-0001 ' } })
    await press(screen.getByRole('button', { name: 'Find job' }))
    await waitFor(() => expect(document.activeElement).toBe(documentId))
    expect(documentId.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(documentId)).toEqual(['Enter a valid document ID (a UUID).'])
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })

  it('a patient ID that is not a UUID is refused at its field, and no job is created', async () => {
    await findJob(null)
    const patient = screen.getByLabelText(/^Patient ID/)
    fireEvent.change(patient, { target: { value: 'HID-ABCDEF' } })
    await press(screen.getByRole('button', { name: 'Create extraction job' }))
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(patient.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(patient)).toEqual(['Enter a valid patient ID (a UUID).'])
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('takes an upper-case UUID, as OCR does', async () => {
    render(<MemoryRouter initialEntries={['/provider/ocr']}><Ocr /></MemoryRouter>)
    api.findOcrJob.mockResolvedValue({ job: null })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT.toUpperCase() } })
    await press(screen.getByRole('button', { name: 'Find job' }))
    await waitFor(() => expect(api.findOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT.toUpperCase()))
  })
})

describe('reviewing an extraction', () => {
  it('NEW-OCR-RAWTEXT-SCROLL: the extracted text, which scrolls, is a named region a keyboard can reach', async () => {
    await findJob(awaiting)
    const region = await screen.findByRole('region', { name: 'Extracted text, version 1', hidden: true })
    expect(region.tabIndex).toBe(0)
    expect(region.textContent).toBe('Haemoglobin 12.1')
  })

  it('NEW-OCR-REVIEW-HINT: what each owning domain requires describes the reviewed payload and the accepted fields', async () => {
    await findJob(awaiting)
    for (const label of [/^Reviewed payload/, /^Accepted fields/]) {
      const field = await screen.findByLabelText(label)
      expect(descriptions(field).some(text => text.includes('EHR requires encounterId'))).toBe(true)
    }
  })

  it('NEW-OCR-REVIEW-HINT: a refused field is described by its error and still by what the domains require', async () => {
    await findJob(awaiting)
    const accepted = await screen.findByLabelText(/^Accepted fields/)
    fireEvent.change(accepted, { target: { value: '{not json' } })
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(accepted.getAttribute('aria-invalid')).toBe('true'))
    const texts = descriptions(accepted)
    expect(texts[0]).toBe('Accepted fields must be valid JSON.')
    expect(texts.some(text => text.includes('EHR requires encounterId'))).toBe(true)
  })
})
