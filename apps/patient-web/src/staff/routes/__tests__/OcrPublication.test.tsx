import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Ocr } from '../Operations'

/**
 * OCR keeps one publication per validation (hid-system ocr.service.ts
 * createPublication). A request with a new Idempotency-Key is refused with
 * 409 OCR_ALREADY_PUBLISHED once one exists, and a publication that failed
 * because its owning service was unavailable is attempted again only when the
 * request that started it is sent again with the same key, by the same account,
 * once OCR's wait after the failure has passed (409 OCR_PUBLICATION_IN_PROGRESS
 * before then), and only while attempts remain. Any other failure is final.
 *
 * The portal holds one key per publication request in memory, never in browser
 * storage: every press of Publish or Retry publication for the same request
 * sends it, and a refresh of the job keeps it. After a refusal the publication
 * history is read again, so the page shows what OCR recorded rather than a
 * Publish button OCR will refuse.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(), publishOcrValidation: vi.fn(),
  labImport: vi.fn(), pharmacyImport: vi.fn(),
}))
const permissions = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: permissions.value,
    } } } },
    lock: null,
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const job = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 5,
  status: 'validated', attemptCount: 1, maxAttempts: 3, patientConfirmation: { id: 'confirmation-1', patientId: PATIENT, version: 1,
    method: 'source_document', confirmedAt: '2026-10-12T10:00:00.000Z' } }
const validation = { id: 'validation-1', jobId: job.id, extractionId: 'extraction-1', version: 1, disposition: 'validated', targetDomain: 'EHR',
  candidateType: 'clinical_note', acceptedFields: {}, rejectedFields: [], corrections: [], reason: 'Matches the source document',
  reviewedAt: '2026-10-12T09:30:00.000Z' }
const publication = { id: 'publication-1', validationId: validation.id, validationVersion: 1, targetDomain: 'EHR',
  targetOperation: 'create_imported_clinical_note' }
/** A publication whose owning service was unavailable: OCR attempts it again for the request that started it. */
const unavailableAt = (attemptCount: number) => ({ ...publication, status: 'failed', attemptCount, maxAttempts: 3,
  failureCode: 'OWNING_SERVICE_UNAVAILABLE', failureSummary: 'Owning clinical service is temporarily unavailable (EHR_SERVICE_UNAVAILABLE)' })
const published = { ...publication, status: 'published', attemptCount: 2, maxAttempts: 3,
  targetResourceType: 'clinical-note', targetResourceId: 'note-1' }
// The first failure answers with the owning service's own refusal; OCR stores it as OWNING_SERVICE_UNAVAILABLE.
const ehrUnavailable = () => new HidApiError(503, 'EHR service is unavailable', { code: 'EHR_SERVICE_UNAVAILABLE' })

beforeEach(() => {
  vi.clearAllMocks()
  permissions.value = ['ocr.job.read', 'ocr.publication.write']
  api.findOcrJob.mockResolvedValue({ job })
  api.ocrExtractions.mockResolvedValue({ items: [] })
  api.ocrValidations.mockResolvedValue({ items: [validation] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

async function openJob() {
  render(<MemoryRouter initialEntries={['/provider/ocr']}><Ocr /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
  await screen.findByRole('heading', { name: 'Review and publication history' })
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The Idempotency-Key each publication request was sent with. */
const keys = () => api.publishOcrValidation.mock.calls.map(call => call[4] as unknown)

describe('publishing validated OCR evidence', () => {
  it('sends a key it holds, and sends it again when the same publication is pressed again after a refusal', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await openJob()
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await screen.findByRole('alert')
    // Nothing was recorded, so Publish is offered again: the same request, with the same key.
    api.publishOcrValidation.mockResolvedValueOnce(published)
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await waitFor(() => expect(api.publishOcrValidation).toHaveBeenCalledTimes(2))
    expect(api.publishOcrValidation.mock.calls[0]!.slice(0, 4)).toEqual(['facility-1', validation, 'confirmation-1', 'create_imported_clinical_note'])
    expect(typeof keys()[0]).toBe('string')
    expect(keys()[1]).toBe(keys()[0])
  })

  it('reads the publication history again after a refusal, and offers to retry a publication OCR will attempt again, with the same key', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    expect((await screen.findByRole('alert')).textContent).toContain('EHR service is unavailable')

    const retry = await screen.findByRole('button', { name: 'Retry publication' })
    expect(api.ocrPublications).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Publish to EHR' })).toBeNull()
    expect(screen.getByText(/Attempt 1 of 3/)).toBeTruthy()
    expect(screen.getByText(/temporarily unavailable \(EHR_SERVICE_UNAVAILABLE\)/)).toBeTruthy()
    // Focus, lost with the Publish button, goes to the control that continues the work.
    await waitFor(() => expect(document.activeElement).toBe(retry))

    api.publishOcrValidation.mockResolvedValueOnce(published)
    api.ocrPublications.mockResolvedValue({ items: [published] })
    await press(retry)
    expect(await screen.findByText('Publication recorded.')).toBeTruthy()
    expect(keys()).toHaveLength(2)
    expect(keys()[1]).toBe(keys()[0])
  })

  it('keeps the key when the job is read again, so the retry still resumes the same publication', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await screen.findByRole('button', { name: 'Retry publication' })

    await press(screen.getByRole('button', { name: 'Refresh status' }))
    api.publishOcrValidation.mockResolvedValueOnce(published)
    await press(await screen.findByRole('button', { name: 'Retry publication' }))
    await waitFor(() => expect(api.publishOcrValidation).toHaveBeenCalledTimes(2))
    expect(keys()[1]).toBe(keys()[0])
  })

  it('says when OCR has not yet allowed another attempt, and keeps the retry', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    const retry = await screen.findByRole('button', { name: 'Retry publication' })

    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'Publication is already processing or is not retryable',
      { code: 'OCR_PUBLICATION_IN_PROGRESS' }))
    await press(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'OCR did not start another attempt: one is still running, or it is too soon after the last one.'))
    expect(screen.getByRole('button', { name: 'Retry publication' })).toBeTruthy()
    expect(screen.queryByText('Publication recorded.')).toBeNull()
  })

  it('reloads the history when OCR answers that the review was published already, and offers nothing OCR would refuse', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'This validation already has a publication command',
      { code: 'OCR_ALREADY_PUBLISHED' }))
    await openJob()
    // Another request made the publication, and it failed: it is not this page's to retry.
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This review already has a publication request, shown below.'))
    await screen.findByText(/Attempt 1 of 3/)
    expect(screen.queryByRole('button', { name: 'Publish to EHR' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.getByText('It can be retried only from the page where Publish was pressed, before that page is reloaded or left.')).toBeTruthy()
  })

  it('does not say the history was reloaded when reading it again fails', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'This validation already has a publication command',
      { code: 'OCR_ALREADY_PUBLISHED' }))
    await openJob()
    api.ocrPublications.mockRejectedValue(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
      'This review already has a publication request.', 'The service could not complete the request.']))
  })

  it('a failed publication found on opening the job, with no key on this page, cannot be retried from here and says so', async () => {
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await openJob()
    expect(await screen.findByText('It can be retried only from the page where Publish was pressed, before that page is reloaded or left.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish to EHR' })).toBeNull()
  })

  it('offers no retry once the attempts are used up', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(3)] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    expect(await screen.findByText('The publication attempt limit has been reached. It cannot be retried.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
  })

  it('offers no retry for a publication the owning service refused', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'Publication failed terminally and requires corrected validation evidence',
      { code: 'OCR_PUBLICATION_TERMINAL' }))
    api.ocrPublications.mockResolvedValue({ items: [] })
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [{ ...publication, status: 'failed', attemptCount: 1, maxAttempts: 3,
      failureCode: 'EHR_ENCOUNTER_NOT_FOUND', failureSummary: 'Publication was rejected by the owning domain' }] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The owning service refused this publication, so it cannot be retried.'))
    expect(await screen.findByText('Publication was rejected by the owning domain')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish to EHR' })).toBeNull()
  })

  it('does not say a publication was recorded unless OCR answers that it was published', async () => {
    api.publishOcrValidation.mockResolvedValueOnce({ ...unavailableAt(1), status: 'processing' })
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [{ ...unavailableAt(1), status: 'processing', failureCode: null, failureSummary: null }] })
    await press(await screen.findByRole('button', { name: 'Publish to EHR' }))
    expect(await screen.findByText('OCR has not finished this publication. Refresh the job status to see whether it has.')).toBeTruthy()
    expect(screen.queryByText('Publication recorded.')).toBeNull()
  })
})
