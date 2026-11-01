import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { SAID_NOT_FOUND, SAID_REFUSED, SAID_TRY_SHORTLY, SAID_UNAVAILABLE } from '../../../__tests__/said'
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
const signedIn = vi.hoisted(() => ({ actorId: 'staff-1' }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: signedIn.actorId, displayName: 'Ada Clinician', facility: {
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
/** What a publication OCR has not finished says when this page holds its key. */
const RESUME_HERE = 'OCR has not finished this publication. If it has stopped, Retry publication resumes it; if it is still running, OCR says so.'
/** What a final failed publication says, in place of OCR's stored failure code and summary, which are never shown. */
const PUBLICATION_FAILED = 'Nothing was added to the patient’s record.'
/**
 * What a failed publication OCR attempts again says instead: the owning service may have saved it before a timeout, or
 * may still be working on it, so the page claims nothing about the record.
 */
const PUBLICATION_UNFINISHED = 'Publishing to the patient’s record didn’t finish: it may have been added even so. Check the patient’s record before adding anything by hand.'
/** OCR's stored failure codes and summaries in these tests: none belongs on a screen. */
const SERVER_FAILURE_WORDS = /OWNING_SERVICE_UNAVAILABLE|EHR_SERVICE_UNAVAILABLE|ENCOUNTER_NOT_FOUND|temporarily unavailable|owning (clinical )?(service|domain)/i

beforeEach(() => {
  vi.clearAllMocks()
  signedIn.actorId = 'staff-1'
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
  // The card reads its history once shown. Wait for that read, so an answer a test sets next is for a later read.
  await waitFor(() => expect(screen.queryByText('Loading publication history…')).toBeNull())
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** The Idempotency-Key each publication request was sent with. */
const keys = () => api.publishOcrValidation.mock.calls.map(call => call[4] as unknown)

/** The page's clock moved on by `ms`, as if that long had passed. */
function letTimePass(ms: number) {
  const now = Date.now
  vi.spyOn(Date, 'now').mockImplementation(() => now.call(Date) + ms)
}

/** OCR's wait after a failed attempt (hid-system ocr.service.ts executePublication sets next_attempt_at 15 seconds on). */
const OCR_RETRY_WAIT = 15_000
const lostAnswer = () => new HidApiError(0, 'We could not reach the service. Check your connection and try again.', { code: 'NETWORK_ERROR' })

describe('publishing validated OCR evidence', () => {
  it('sends a key it holds, and sends it again when the same publication is pressed again after a refusal', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await openJob()
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await screen.findByRole('alert')
    // Nothing was recorded, so Publish is offered again: the same request, with the same key.
    api.publishOcrValidation.mockResolvedValueOnce(published)
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(api.publishOcrValidation).toHaveBeenCalledTimes(2))
    expect(api.publishOcrValidation.mock.calls[0]!.slice(0, 4)).toEqual(['facility-1', validation, 'confirmation-1', 'create_imported_clinical_note'])
    expect(typeof keys()[0]).toBe('string')
    expect(keys()[1]).toBe(keys()[0])
  })

  it('reads the publication history again after a refusal, and offers to retry a publication OCR will attempt again, with the same key', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect((await screen.findByRole('alert')).textContent).toContain(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR service is unavailable')

    const retry = await screen.findByRole('button', { name: 'Retry publication' })
    expect(api.ocrPublications).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
    expect(screen.getByText(/Attempt 1 of 3/)).toBeTruthy()
    // The failure in plain words, never OCR's stored summary or failure code (owner's rule: no server text or codes).
    // The owning service may have saved it before its answer was lost, so the page never says nothing was added.
    expect(screen.getByText(PUBLICATION_UNFINISHED)).toBeTruthy()
    expect(screen.queryByText(PUBLICATION_FAILED)).toBeNull()
    expect(document.body.textContent).not.toMatch(SERVER_FAILURE_WORDS)
    // Focus, lost with the Publish button, goes to the control that continues the work.
    await waitFor(() => expect(document.activeElement).toBe(retry))

    letTimePass(OCR_RETRY_WAIT)
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
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await screen.findByRole('button', { name: 'Retry publication' })

    await press(screen.getByRole('button', { name: 'Refresh status' }))
    letTimePass(OCR_RETRY_WAIT)
    api.publishOcrValidation.mockResolvedValueOnce(published)
    await press(await screen.findByRole('button', { name: 'Retry publication' }))
    await waitFor(() => expect(api.publishOcrValidation).toHaveBeenCalledTimes(2))
    expect(keys()[1]).toBe(keys()[0])
  })

  it('says when OCR has not yet allowed another attempt, and keeps the retry', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    const retry = await screen.findByRole('button', { name: 'Retry publication' })

    // OCR's clock decides: it can still answer that the attempt has not been started.
    letTimePass(OCR_RETRY_WAIT)
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'Publication is already processing or is not retryable',
      { code: 'OCR_PUBLICATION_IN_PROGRESS' }))
    await press(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'OCR did not start another attempt: one is still running, it is too soon after the last one, or no attempts remain.'))
    expect(screen.getByRole('button', { name: 'Retry publication' })).toBeTruthy()
    expect(screen.queryByText('Publication recorded.')).toBeNull()
  })

  // hid-system #60: OCR answers an owning service's refusal of its own workload identity as
  // 503 <SERVICE>_SERVICE_AUTH_UNAVAILABLE, stored as the retryable OWNING_SERVICE_UNAVAILABLE.
  it.each(['EHR', 'LAB', 'PHARMACY'])('says a failed connection between services (%s) plainly, and keeps the retry', async service => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(503, `${service} service refused the OCR service identity`,
      { code: `${service}_SERVICE_AUTH_UNAVAILABLE` }))
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_TRY_SHORTLY)
    expect(document.body.textContent).not.toContain('between Health ID services')
    expect(screen.queryByText(/refused the OCR service identity/)).toBeNull()
    expect(await screen.findByRole('button', { name: 'Retry publication' })).toBeTruthy()
  })

  // OCR finds a publication by facility, requesting account and key: only the requester can retry it.
  it('offers the retry only to the account that pressed Publish', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await screen.findByRole('button', { name: 'Retry publication' })

    signedIn.actorId = 'staff-2'
    await press(screen.getByRole('button', { name: 'Refresh status' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull())
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
    expect(screen.getByText(/can be retried only from the page where Publish was pressed/)).toBeTruthy()

    signedIn.actorId = 'staff-1'
    await press(screen.getByRole('button', { name: 'Refresh status' }))
    expect(await screen.findByRole('button', { name: 'Retry publication' })).toBeTruthy()
  })

  it('reloads the history when OCR answers that the review was published already, and offers nothing OCR would refuse', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'This validation already has a publication command',
      { code: 'OCR_ALREADY_PUBLISHED' }))
    await openJob()
    // Another request made the publication, and it failed: it is not this page's to retry.
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This review already has a publication request, shown below.'))
    await screen.findByText(/Attempt 1 of 3/)
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.getByText('It can be retried only from the page where Publish was pressed, before that page is reloaded or left.')).toBeTruthy()
  })

  it('does not say the history was reloaded when reading it again fails', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'This validation already has a publication command',
      { code: 'OCR_ALREADY_PUBLISHED' }))
    await openJob()
    api.ocrPublications.mockRejectedValue(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
      'This review already has a publication request.', SAID_UNAVAILABLE]))
      expect(document.body.textContent).not.toContain('The service could not complete the request.')
    // The history shown is out of date, and OCR would refuse Publish: neither is offered.
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
  })

  it('gives focus back to Publish, still shown, when a refused request\'s history cannot be read again', async () => {
    let refuse: (reason: unknown) => void = () => {}
    api.publishOcrValidation.mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject }))
    await openJob()
    api.ocrPublications.mockRejectedValue(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    // As in Chromium, focus leaves the disabled button while the request runs.
    const elsewhere = document.body.appendChild(document.createElement('button'))
    elsewhere.focus()
    elsewhere.remove()
    expect(document.activeElement).toBe(document.body)
    await act(async () => { refuse(new HidApiError(503, 'EHR service is unavailable', { code: 'EHR_SERVICE_UNAVAILABLE' })) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Publish as clinical note' })))
  })

  it('a failed publication found on opening the job, with no key on this page, cannot be retried from here and says so', async () => {
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    await openJob()
    expect(await screen.findByText('It can be retried only from the page where Publish was pressed, before that page is reloaded or left.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
  })

  // REQUEST_IN_PROGRESS: the owning service still has a request in flight under this key, so it may yet be added.
  it('a failed publication the owning service may still be working on claims nothing about the record', async () => {
    api.ocrPublications.mockResolvedValue({ items: [{ ...unavailableAt(1), failureCode: 'REQUEST_IN_PROGRESS',
      failureSummary: 'Owning service request is still in progress (REQUEST_IN_PROGRESS)' }] })
    await openJob()
    expect(await screen.findByText(PUBLICATION_UNFINISHED)).toBeTruthy()
    expect(screen.queryByText(PUBLICATION_FAILED)).toBeNull()
    expect(document.body.textContent).not.toMatch(/REQUEST_IN_PROGRESS|still in progress|Nothing was added/)
  })

  it('offers no retry once the attempts are used up', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(3)] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect(await screen.findByText('The publication attempt limit has been reached. It cannot be retried.')).toBeTruthy()
    // The last attempt may still have been saved, so it claims nothing about the record either.
    expect(screen.getByText(PUBLICATION_UNFINISHED)).toBeTruthy()
    expect(screen.queryByText(PUBLICATION_FAILED)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
  })

  // OCR answers the first request with the owning service's own refusal, and stores it under that code.
  const refusedByEhr = { ...publication, status: 'failed', attemptCount: 1, maxAttempts: 3,
    failureCode: 'ENCOUNTER_NOT_FOUND', failureSummary: 'Publication was rejected by the owning domain' }

  it('offers no retry for a publication the owning service refused', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(404, 'Encounter was not found', { code: 'ENCOUNTER_NOT_FOUND' }))
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [refusedByEhr] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(SAID_NOT_FOUND))
    expect(document.body.textContent).not.toContain('Encounter was not found')
    expect(await screen.findByText(PUBLICATION_FAILED)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(SERVER_FAILURE_WORDS)
    expect(screen.getByText('It cannot be retried.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
  })

  it('says a publication cannot be retried when OCR answers OCR_PUBLICATION_TERMINAL to the same request sent again', async () => {
    // The answer to the first request was lost, and the history could not be read again, so Publish is still shown.
    api.publishOcrValidation.mockRejectedValueOnce(lostAnswer())
    await openJob()
    api.ocrPublications.mockRejectedValueOnce(new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' }))
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await screen.findByText(SAID_UNAVAILABLE)

    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'Publication failed terminally and requires corrected validation evidence',
      { code: 'OCR_PUBLICATION_TERMINAL' }))
    api.ocrPublications.mockResolvedValue({ items: [refusedByEhr] })
    await press(screen.getByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This couldn’t be added to the patient’s record, and it can’t be tried again.'))
    expect(document.body.textContent).not.toMatch(/owning service|failed terminally|OCR_PUBLICATION_TERMINAL/)
    expect(keys()).toHaveLength(2)
    expect(keys()[1]).toBe(keys()[0])
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish as clinical note' })).toBeNull()
  })

  it('does not say a publication was recorded unless OCR answers that it was published', async () => {
    api.publishOcrValidation.mockResolvedValueOnce({ ...unavailableAt(1), status: 'processing' })
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [{ ...unavailableAt(1), status: 'processing', failureCode: null, failureSummary: null }] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect(await screen.findByText(RESUME_HERE)).toBeTruthy()
    expect(screen.queryByText('Publication recorded.')).toBeNull()
  })

  it('holds Retry publication for OCR\'s wait after a failure, sending nothing, and says how long is left', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(ehrUnavailable())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [unavailableAt(1)] })
    // The page's clock stands still, so the wait it says does not depend on how long the test takes.
    const start = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    const retry = await screen.findByRole('button', { name: 'Retry publication' })
    expect(screen.getByText('OCR allows another attempt about 15 seconds after a failure.')).toBeTruthy()

    // OCR would answer 409 OCR_PUBLICATION_IN_PROGRESS now: nothing is sent.
    await press(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'OCR allows another attempt about 15 seconds after a failure. Try again in 15 seconds.'))
    expect(api.publishOcrValidation).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(retry)

    clock.mockReturnValue(start + OCR_RETRY_WAIT - 1000)
    await press(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'OCR allows another attempt about 15 seconds after a failure. Try again in 1 second.'))
    expect(api.publishOcrValidation).toHaveBeenCalledTimes(1)

    clock.mockReturnValue(start + OCR_RETRY_WAIT)
    api.publishOcrValidation.mockResolvedValueOnce(published)
    api.ocrPublications.mockResolvedValue({ items: [published] })
    await press(retry)
    expect(await screen.findByText('Publication recorded.')).toBeTruthy()
    expect(keys()).toHaveLength(2)
    expect(keys()[1]).toBe(keys()[0])
  })

  // No worker takes a publication further: OCR resumes one left pending, or processing once its claim
  // expires, only when the request that started it is sent again with its key (ocr.service.ts executePublication).
  it.each([
    ['pending', 0, new HidApiError(500, 'The service could not complete the request.', { code: 'INTERNAL_SERVER_ERROR' })],
    ['processing', 1, new HidApiError(502, 'The service could not complete the request.', { code: 'BAD_GATEWAY' })],
  ])('offers to resume a publication left %s, with the same key', async (status, attemptCount, refusal) => {
    api.publishOcrValidation.mockRejectedValueOnce(refusal)
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [{ ...publication, status, attemptCount, maxAttempts: 3, failureCode: null, failureSummary: null }] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    const retry = await screen.findByRole('button', { name: 'Retry publication' })
    expect(screen.getByText(RESUME_HERE)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(retry))

    // Not a failure, so OCR has no wait: it takes the request at once, or says the attempt is still running.
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'Publication is already processing or is not retryable',
      { code: 'OCR_PUBLICATION_IN_PROGRESS' }))
    await press(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(
      'OCR did not start another attempt: one is still running, it is too soon after the last one, or no attempts remain.'))
    expect(keys()).toHaveLength(2)
    expect(keys()[1]).toBe(keys()[0])
    expect(screen.getByRole('button', { name: 'Retry publication' })).toBeTruthy()
  })

  it('a publication left processing, with no key on this page, says it can be resumed only from the page that requested it', async () => {
    api.ocrPublications.mockResolvedValue({ items: [{ ...publication, status: 'processing', attemptCount: 1, maxAttempts: 3 }] })
    await openJob()
    expect(screen.getByText('OCR has not finished this publication. Refresh the job status to see whether it has. If it has stopped, '
      + 'it can be resumed only from the page where Publish was pressed, before that page is reloaded or left.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
  })

  it('a publication left processing on its last attempt cannot be resumed, even from the page that requested it, and says so', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(502, 'The service could not complete the request.', { code: 'BAD_GATEWAY' }))
    await openJob()
    // OCR claims a publication again only while attempt_count < max_attempts (ocr.service.ts executePublication).
    api.ocrPublications.mockResolvedValue({ items: [{ ...publication, status: 'processing', attemptCount: 3, maxAttempts: 3 }] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect(await screen.findByText('OCR has not finished this publication. Refresh the job status to see whether it has. '
      + 'This is its last attempt: if it has stopped, it cannot be resumed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
    expect(screen.queryByText(/only from the page where Publish was pressed/)).toBeNull()
  })

  // Only a role that may publish, on a job whose source patient is confirmed now, can take a publication further.
  it.each([
    ['without ocr.publication.write', ['ocr.job.read'], job],
    ['with no current patient confirmation', ['ocr.job.read', 'ocr.publication.write'], { ...job, patientConfirmation: null }],
  ])('does not say where a publication can be taken further to a viewer %s', async (_name, granted, found) => {
    permissions.value = granted
    api.findOcrJob.mockResolvedValue({ job: found })
    api.ocrValidations.mockResolvedValue({ items: [validation, { ...validation, id: 'validation-2', version: 2 }] })
    api.ocrPublications.mockImplementation(async (_facilityId: string, validationId: string) => ({ items: [validationId === validation.id
      ? unavailableAt(1) : { ...publication, id: 'publication-2', validationId, status: 'processing', attemptCount: 1, maxAttempts: 3 }] }))
    await openJob()
    expect(await screen.findByText(/Attempt 1 of 3/)).toBeTruthy()
    expect(screen.getByText('OCR has not finished this publication. Refresh the job status to see whether it has.')).toBeTruthy()
    expect(screen.queryByText(/only from the page where Publish was pressed/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry publication' })).toBeNull()
  })

  it('says the publication was recorded when OCR published it but its answer was lost', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(lostAnswer())
    await openJob()
    api.ocrPublications.mockResolvedValue({ items: [published] })
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    expect(await screen.findByText('Publication recorded.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // The job is read again, as after any publication.
    await waitFor(() => expect(api.findOcrJob).toHaveBeenCalledTimes(2))
  })

  it('says once, after reading the history again, that the review already has a publication request', async () => {
    api.publishOcrValidation.mockRejectedValueOnce(new HidApiError(409, 'This validation already has a publication command',
      { code: 'OCR_ALREADY_PUBLISHED' }))
    await openJob()
    let answer: (value: unknown) => void = () => {}
    api.ocrPublications.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await press(await screen.findByRole('button', { name: 'Publish as clinical note' }))
    await waitFor(() => expect(api.ocrPublications).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { answer({ items: [unavailableAt(1)] }) })
    await waitFor(() => expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([
      'This review already has a publication request, shown below.']))
  })
})

/**
 * OCR-04. A publication showed only the raw ID of what it made. For Lab and
 * Pharmacy that ID is an imported-evidence record, which Lab and Pharmacy let
 * a role holding lab.import.read or pharmacy.import.read read
 * (GET /api/v1/lab/imports/:importId, GET /api/v1/pharmacy/imports/:importId).
 * Each read is audited, so the page reads it only when asked. Anything else is
 * named, never shown as an ID.
 */
describe('OCR-04: what a publication produced', () => {
  const IMPORT = 'b0000000-0000-4000-8000-0000000000aa'
  const producedBy = (targetDomain: string, targetOperation: string, targetResourceType: string, targetResourceId: string) => {
    api.ocrValidations.mockResolvedValue({ items: [{ ...validation, targetDomain }] })
    api.ocrPublications.mockResolvedValue({ items: [{ ...publication, targetDomain, targetOperation, status: 'published', attemptCount: 1,
      maxAttempts: 3, targetResourceType, targetResourceId }] })
  }
  const lab = () => producedBy('LAB', 'create_imported_lab_evidence', 'lab-imported-evidence', IMPORT)
  const pharmacy = () => producedBy('PHARMACY', 'create_imported_medication_evidence', 'pharmacy-imported-medication-evidence', IMPORT)

  it('reads imported lab evidence from Lab when asked, if the role may, and never shows its ID', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read']
    lab()
    api.labImport.mockResolvedValue({ id: IMPORT, status: 'accepted', externalLabName: 'Central Laboratory', observations: [
      { id: 'observation-1', ordinal: 1, testName: 'Haemoglobin', value: '12.1', unit: 'g/dL', referenceRange: '11.5-16.5', abnormalFlag: 'normal' },
      { id: 'observation-2', ordinal: 2, testName: 'Platelets', value: '95', unit: '10^9/L', abnormalFlag: 'low' },
    ] })
    await openJob()
    expect(await screen.findByText('Published as imported lab evidence in the patient\'s record.')).toBeTruthy()
    expect(api.labImport).not.toHaveBeenCalled()

    // A disclosure: its name stays, and aria-expanded says whether it is open.
    const view = screen.getByRole('button', { name: 'Imported lab evidence' })
    expect(view.getAttribute('aria-expanded')).toBe('false')
    await press(view)
    expect(await screen.findByText('Haemoglobin: 12.1 g/dL · reference 11.5-16.5')).toBeTruthy()
    expect(screen.getByText('Platelets: 95 10^9/L · flagged low')).toBeTruthy()
    expect(screen.getByText('Reported by Central Laboratory')).toBeTruthy()
    expect(screen.queryByText(/^Import status/)).toBeNull()
    expect(api.labImport).toHaveBeenCalledWith('facility-1', IMPORT)
    expect(screen.getByRole('button', { name: 'Imported lab evidence' })).toBe(view)
    expect(view.getAttribute('aria-expanded')).toBe('true')
    expect(document.body.textContent).not.toContain(IMPORT)

    // Each read is audited, and what was imported does not change: opening it again reads nothing.
    await press(view)
    expect(view.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Reported by Central Laboratory')).toBeNull()
    await press(view)
    expect(screen.getByText('Reported by Central Laboratory')).toBeTruthy()
    expect(screen.queryByText('Loading imported evidence…')).toBeNull()
    expect(api.labImport).toHaveBeenCalledTimes(1)
  })

  // A region added with its message may not be announced, so one is mounted with the disclosure throughout.
  it('says in one status region, there before the read, that the evidence is loading and then that it loaded', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read', 'pharmacy.import.read']
    lab()
    let answer: (value: unknown) => void = () => {}
    api.labImport.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await openJob()
    const view = await screen.findByRole('button', { name: 'Imported lab evidence' })
    const region = within(view.closest('.staff-stack') as HTMLElement).getByRole('status')
    expect(region.textContent).toBe('')
    await press(view)
    expect(region.textContent).toBe('Loading imported evidence…')
    await act(async () => { answer({ id: IMPORT, status: 'accepted', observations: [
      { id: 'observation-1', ordinal: 1, testName: 'Haemoglobin', value: '12.1', unit: 'g/dL', abnormalFlag: 'normal', status: 'reported' },
      { id: 'observation-2', ordinal: 2, testName: 'Platelets', value: '95', unit: '10^9/L', abnormalFlag: 'low', status: 'reported' },
    ] }) })
    expect(region.isConnected).toBe(true)
    expect(region.textContent).toBe('Imported lab evidence loaded: 2 observations.')
  })

  it('says imported medication evidence loaded in its status region', async () => {
    permissions.value = ['ocr.job.read', 'pharmacy.import.read']
    pharmacy()
    api.pharmacyImport.mockResolvedValue({ id: IMPORT, activityStatus: 'unknown', medicationText: 'Amoxicillin capsules' })
    await openJob()
    const view = await screen.findByRole('button', { name: 'Imported medication evidence' })
    const region = within(view.closest('.staff-stack') as HTMLElement).getByRole('status')
    await press(view)
    await screen.findByText('Amoxicillin capsules')
    expect(region.textContent).toBe('Imported medication evidence loaded.')
  })

  it('reads imported evidence again when opened after a read that failed', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read']
    lab()
    api.labImport.mockRejectedValueOnce(new HidApiError(503, 'Lab service is unavailable', { code: 'LAB_SERVICE_UNAVAILABLE' }))
    await openJob()
    const view = await screen.findByRole('button', { name: 'Imported lab evidence' })
    await press(view)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('Lab service is unavailable')
    await press(view)
    let answer: (value: unknown) => void = () => {}
    api.labImport.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await press(view)
    // The earlier refusal is not shown while the new read runs.
    expect(screen.getByText('Loading imported evidence…')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => { answer({ id: IMPORT, status: 'accepted', observations: [] }) })
    expect(api.labImport).toHaveBeenCalledTimes(2)
  })

  it('says an observation without a result by its name alone, and an import that is not accepted by its status', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read']
    lab()
    api.labImport.mockResolvedValue({ id: IMPORT, status: 'entered_in_error', observations: [
      { id: 'observation-1', ordinal: 1, testName: 'Culture', value: null, valueText: null, abnormalFlag: 'unknown', status: 'reported' },
    ] })
    await openJob()
    await press(await screen.findByRole('button', { name: 'Imported lab evidence' }))
    expect(await screen.findByText('Culture')).toBeTruthy()
    expect(screen.getByText('Import status: entered in error')).toBeTruthy()
  })

  it('names imported lab evidence without reading it when the role may not read Lab imports', async () => {
    lab()
    await openJob()
    expect(await screen.findByText('Published as imported lab evidence in the patient\'s record.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /imported lab evidence/ })).toBeNull()
    expect(document.body.textContent).not.toContain(IMPORT)
  })

  it('reads imported medication evidence from Pharmacy when asked, if the role may', async () => {
    permissions.value = ['ocr.job.read', 'pharmacy.import.read']
    pharmacy()
    api.pharmacyImport.mockResolvedValue({ id: IMPORT, activityStatus: 'unknown', medicationText: 'Amoxicillin capsules',
      strengthText: '500 mg', doseText: 'One capsule', frequencyText: 'Three times a day', historicalContext: 'Course finished in March' })
    await openJob()
    expect(await screen.findByText('Published as imported medication evidence in the patient\'s record.')).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Imported medication evidence' }))
    expect(await screen.findByText('Amoxicillin capsules')).toBeTruthy()
    expect(screen.getByText('500 mg · One capsule · Three times a day')).toBeTruthy()
    expect(screen.getByText('Course finished in March')).toBeTruthy()
    expect(api.pharmacyImport).toHaveBeenCalledWith('facility-1', IMPORT)
    expect(document.body.textContent).not.toContain(IMPORT)
  })

  it('says so when the imported evidence cannot be read', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read']
    lab()
    api.labImport.mockRejectedValue(new HidApiError(403, 'Lab access is not authorized', { code: 'LAB_ACCESS_DENIED' }))
    await openJob()
    await press(await screen.findByRole('button', { name: 'Imported lab evidence' }))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain('Lab access is not authorized')
  })

  // Lab's code for it is critical_candidate: the page says it as routed results do.
  it('says a possibly critical imported observation in plain words, never by Lab\'s flag code', async () => {
    permissions.value = ['ocr.job.read', 'lab.import.read']
    lab()
    api.labImport.mockResolvedValue({ id: IMPORT, status: 'accepted', observations: [
      { id: 'observation-1', ordinal: 1, testName: 'Potassium', value: '6.9', unit: 'mmol/L', abnormalFlag: 'critical_candidate' },
    ] })
    await openJob()
    await press(await screen.findByRole('button', { name: 'Imported lab evidence' }))
    expect(await screen.findByText('Potassium: 6.9 mmol/L · flagged possibly critical')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/critical_candidate|critical candidate/)
  })

  it.each([
    ['EHR', 'create_imported_clinical_note', 'clinical-note', 'Published as a clinical note in the patient\'s record.'],
    ['DOCUMENT_ONLY', 'retain_validated_document', 'document', 'Kept as a validated document in the patient\'s record.'],
  ])('names what a %s publication made, without its ID', async (domain, operation, type, label) => {
    producedBy(domain, operation, type, IMPORT)
    await openJob()
    expect(await screen.findByText(label)).toBeTruthy()
    expect(document.body.textContent).not.toContain(IMPORT)
  })
})

describe('a review names its owning domain in words', () => {
  it.each([
    ['EHR', 'Clinical note'],
    ['LAB', 'Historical lab evidence'],
    ['PHARMACY', 'Historical medication evidence'],
    ['DOCUMENT_ONLY', 'Validated document'],
  ])('a %s review reads "%s", and its Publish button says so, never OCR\'s code', async (targetDomain, words) => {
    api.ocrValidations.mockResolvedValue({ items: [{ ...validation, targetDomain }] })
    await openJob()
    expect(await screen.findByText(`Review 1 · ${words}`)).toBeTruthy()
    expect(screen.getByRole('button', { name: `Publish as ${words.toLowerCase()}` })).toBeTruthy()
    const review = screen.getByText(`Review 1 · ${words}`).closest('.staff-list-item')
    expect(review?.textContent).not.toMatch(/\b(EHR|LAB|PHARMACY|DOCUMENT[_ ]ONLY)\b/)
  })

  it('a rejected review reads "Not classified", never UNCLASSIFIED', async () => {
    api.ocrValidations.mockResolvedValue({ items: [{ ...validation, disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified' }] })
    await openJob()
    expect(await screen.findByText('Review 1 · Not classified')).toBeTruthy()
    expect(document.body.textContent).not.toContain('UNCLASSIFIED')
  })
})
