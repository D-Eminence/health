import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Ocr } from '../Operations'

/**
 * OCR allows one patient confirmation per job version: its outbox event is keyed
 * by the job version, so a second confirmation is refused with
 * 409 OCR_PATIENT_ALREADY_CONFIRMED (hid-system ocr.service.ts confirmPatient).
 * A retry of the same confirmation reuses its idempotency key, which OCR
 * answers with the confirmation it recorded; and when the job turns out to be
 * confirmed already, the page reloads the job instead of leaving a dead form.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), confirmOcrPatient: vi.fn(), ocrPublications: vi.fn(),
}))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ocr.job.read', 'ocr.patient.confirm'],
    } } } },
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const job = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, status: 'validated',
  provider: 'textract', version: 4, patientConfirmation: null }
const confirmed = { ...job, patientConfirmation: { id: 'confirmation-1', patientId: PATIENT, version: 1,
  method: 'source_document', confirmedAt: '2026-10-11T10:00:00.000Z' } }

beforeEach(() => {
  vi.clearAllMocks()
  api.findOcrJob.mockResolvedValue({ job })
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

async function confirmationForm() {
  render(<MemoryRouter><Ocr /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
  const button = await screen.findByRole('button', { name: 'Confirm source patient' })
  fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match the referral' } })
  return button
}

describe('confirming the source patient of an OCR job', () => {
  it('reuses the submission key when the same confirmation is retried', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(503, 'Service unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    const button = await confirmationForm()

    fireEvent.click(button)
    expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable')
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    fireEvent.click(button)

    await waitFor(() => expect(api.confirmOcrPatient).toHaveBeenCalledTimes(2))
    const [first, second] = api.confirmOcrPatient.mock.calls
    expect(first!.slice(0, 4)).toEqual(['facility-1', job, PATIENT, 'Name and date of birth match the referral'])
    expect(typeof first![4]).toBe('string')
    expect(second![4]).toBe(first![4])
  })

  it('uses a new key once the confirmation changes', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(503, 'Service unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    const button = await confirmationForm()
    fireEvent.click(button)
    await screen.findByRole('alert')

    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Matched against the referral letter' } })
    fireEvent.click(button)
    await waitFor(() => expect(api.confirmOcrPatient).toHaveBeenCalledTimes(2))
    expect(api.confirmOcrPatient.mock.calls[1]![4]).not.toBe(api.confirmOcrPatient.mock.calls[0]![4])
  })

  it('reloads the job and says so when the job was confirmed already', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(409, 'This OCR job version already has a patient confirmation',
      { code: 'OCR_PATIENT_ALREADY_CONFIRMED' }))
    const button = await confirmationForm()
    api.findOcrJob.mockClear()
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    fireEvent.click(button)

    expect(await screen.findByText(/already confirmed, so the job was reloaded/)).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenCalledWith('facility-1', DOCUMENT)
    expect(screen.queryByRole('button', { name: 'Confirm source patient' })).toBeNull()
    expect(screen.getByText(/Source patient confirmed/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not claim the job was reloaded when the reload fails', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(409, 'This OCR job version already has a patient confirmation',
      { code: 'OCR_PATIENT_ALREADY_CONFIRMED' }))
    const button = await confirmationForm()
    api.findOcrJob.mockRejectedValue(new HidApiError(503, 'Service unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(button)

    expect((await screen.findByRole('alert')).textContent).toContain('Service unavailable')
    expect(screen.queryByText(/so the job was reloaded/)).toBeNull()
  })

  it('clears the reload notice once another document is entered', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(409, 'This OCR job version already has a patient confirmation',
      { code: 'OCR_PATIENT_ALREADY_CONFIRMED' }))
    const button = await confirmationForm()
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    fireEvent.click(button)
    await screen.findByText(/so the job was reloaded/)

    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: 'd0000000-0000-4000-8000-000000000002' } })
    expect(screen.queryByText(/so the job was reloaded/)).toBeNull()
  })

  it('keeps any other refusal on the form', async () => {
    api.confirmOcrPatient.mockRejectedValueOnce(new HidApiError(409, 'Confirmed patient does not match the canonical source document patient',
      { code: 'OCR_PATIENT_MISMATCH' }))
    const button = await confirmationForm()
    api.findOcrJob.mockClear()
    fireEvent.click(button)

    expect((await screen.findByRole('alert')).textContent).toContain('does not match')
    expect(api.findOcrJob).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm source patient' })).toBeTruthy()
  })

  // Focus cannot move to a field it is on already, so a refusal made from Enter there is an alert, new each time.
  it('says a patient ID refused from Enter in its field as an alert', async () => {
    await confirmationForm()
    const patient = screen.getByLabelText(/^Canonical patient ID/)
    fireEvent.change(patient, { target: { value: 'HID-ABCDEF' } })
    patient.focus()
    await act(async () => { fireEvent.submit(patient.closest('form')!) })
    const first = await screen.findByRole('alert')
    expect(first.textContent).toBe('Enter a valid canonical patient ID (a UUID).')
    expect(patient.getAttribute('aria-describedby')).toBe('ocr-confirm-patient-error')
    await act(async () => { fireEvent.submit(patient.closest('form')!) })
    await waitFor(() => expect(screen.getByRole('alert')).not.toBe(first))
    expect(api.confirmOcrPatient).not.toHaveBeenCalled()
  })
})
