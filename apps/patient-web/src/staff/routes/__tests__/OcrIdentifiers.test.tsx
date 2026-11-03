import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ocr } from '../Operations'

/**
 * EHR-FORMS-01. OCR takes document and patient IDs only as version 4 UUIDs
 * (hid-system ocr-api find-ocr-job.dto.ts, create-ocr-job.dto.ts and
 * confirm-ocr-patient.dto.ts, @IsUUID('4')). An ID in any other form is refused
 * at its field, which takes focus, before anything is sent.
 */
const api = vi.hoisted(() => ({ findOcrJob: vi.fn(), createOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(),
  confirmOcrPatient: vi.fn(), ocrPublications: vi.fn() }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ocr.job.read', 'ocr.job.write', 'ocr.patient.confirm'],
    } } } },
    lock: null,
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const job = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: null, status: 'validated',
  provider: 'textract', version: 4, patientConfirmation: null }
const described = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent

beforeEach(() => {
  vi.clearAllMocks()
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

function renderOcr() { render(<MemoryRouter><Ocr /></MemoryRouter>) }

describe('OCR identifiers', () => {
  it.each(['document-1', 'D0000000-0000-1000-8000-000000000001', `${DOCUMENT} `.repeat(2)])('refuses the document ID %s before finding a job', async value => {
    renderOcr()
    const field = screen.getByLabelText(/^Document ID/)
    fireEvent.change(field, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(described(field)).toMatch(/UUID/)
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })

  it('finds a job by a UUID document ID, trimmed', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    renderOcr()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: ` ${DOCUMENT} ` } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    await waitFor(() => expect(api.findOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT))
  })

  it('refuses a patient ID that is not a UUID before creating a job', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    renderOcr()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    const patient = await screen.findByLabelText(/^Patient ID/)
    fireEvent.change(patient, { target: { value: 'HID-ABCDEF23' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create extraction job' }))
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(patient.getAttribute('aria-invalid')).toBe('true')
    expect(described(patient)).toMatch(/UUID/)
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('creates a job for a UUID patient ID', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue({ ...job, status: 'queued', patientId: PATIENT })
    renderOcr()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    fireEvent.change(await screen.findByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Create extraction job' }))
    await waitFor(() => expect(api.createOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT, PATIENT))
  })

  it('refuses a canonical patient ID that is not a UUID before confirming the source patient', async () => {
    api.findOcrJob.mockResolvedValue({ job })
    renderOcr()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    const patient = await screen.findByLabelText(/^Canonical patient ID/)
    fireEvent.change(patient, { target: { value: 'patient-1' } })
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(document.activeElement).toBe(patient))
    expect(described(patient)).toMatch(/UUID/)
    expect(api.confirmOcrPatient).not.toHaveBeenCalled()
  })
})
