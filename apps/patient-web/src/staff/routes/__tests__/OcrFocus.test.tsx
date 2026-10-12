import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Ocr } from '../Operations'
import { useFocusOnPageChange } from '../../pageFocus'

/**
 * OCR-A11Y-01 (WCAG 2.4.3 Focus Order, 4.1.3 Status Messages). Each OCR step
 * removes the control that ran it, so focus fell to the page and nothing said
 * whether the step worked. Focus now moves to where the work continues, and the
 * status region, mounted throughout, says what happened. A field refused before
 * sending takes focus with its error tied to it; a refused request gives focus
 * back to the control that sent it, which was disabled while it ran.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(),
  createOcrJob: vi.fn(), retryOcrJob: vi.fn(), validateOcrJob: vi.fn(), confirmOcrPatient: vi.fn(), publishOcrValidation: vi.fn(),
}))
const permissions = vi.hoisted(() => ({ value: [] as string[] }))

vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: permissions.value,
    } } } },
  }),
}))

const ALL = ['ocr.job.read', 'ocr.job.write', 'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write']
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const base = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 3,
  attemptCount: 1, maxAttempts: 3, patientConfirmation: null }
const awaiting = { ...base, status: 'awaiting_validation' }
const validated = { ...base, status: 'validated', version: 4 }
const rejected = { ...base, status: 'rejected', version: 4 }
const confirmed = { ...validated, version: 5, patientConfirmation: { id: 'confirmation-1', patientId: PATIENT, version: 1,
  method: 'source_document', confirmedAt: '2026-10-12T10:00:00.000Z' } }
const failed = { ...base, status: 'failed' }
const queued = { ...base, status: 'queued', version: 4 }
const extraction = { id: 'extraction-1', jobId: base.id, version: 1, provider: 'textract', confidence: 0.92, rawText: 'Haemoglobin 12.1',
  structuredPayload: {}, createdAt: '2026-10-12T09:00:00.000Z' }
const validation = { id: 'validation-1', jobId: base.id, version: 1, disposition: 'validated', targetDomain: 'DOCUMENT_ONLY',
  candidateType: 'document_only', reason: 'Matches the source document', reviewedAt: '2026-10-12T09:30:00.000Z' }
const unavailable = () => new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' })

beforeEach(() => {
  vi.clearAllMocks()
  permissions.value = ALL
  api.ocrExtractions.mockResolvedValue({ items: [extraction] })
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

function renderOcr() {
  render(<MemoryRouter initialEntries={['/provider/ocr']}><Ocr /></MemoryRouter>)
}

async function findJob(job: object | null) {
  api.findOcrJob.mockResolvedValue({ job })
  renderOcr()
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
  if (job) await screen.findByRole('heading', { name: 'Job status' })
  else await screen.findByText('No OCR job exists for this document.')
}

/** Activates `button` as a keyboard user would: it has focus when pressed. */
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const focused = () => document.activeElement
const heading = (name: string) => screen.getByRole('heading', { name })

function statusRegion() {
  // The page's own status region; "Loading…" placeholders are separate.
  const region = document.getElementById('ocr-status')
  if (!region) throw new Error('Expected the OCR status region to stay mounted.')
  return region
}

describe('OCR-A11Y-01: focus and status after each OCR step', () => {
  it('keeps a status region mounted before any step, so its messages are announced', async () => {
    renderOcr()
    expect(statusRegion().getAttribute('role')).toBe('status')
    expect(statusRegion().textContent).toBe('')
  })

  it('create: moves focus to the job status and says the job was created', async () => {
    await findJob(null)
    api.createOcrJob.mockResolvedValue(queued)
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(screen.getByRole('button', { name: 'Create extraction job' }))
    await waitFor(() => expect(focused()).toBe(heading('Job status')))
    expect(statusRegion().textContent).toBe('Extraction job created.')
  })

  it('review (validated): moves focus to the next step, confirming the source patient, and says so', async () => {
    await findJob(awaiting)
    fireEvent.change(await screen.findByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(heading('Confirm source patient')))
    expect(statusRegion().textContent).toBe('Review recorded. Confirm the source patient next.')
  })

  it('review (validated) without the confirmation permission: moves focus to the job status, naming no next step', async () => {
    permissions.value = ALL.filter(permission => permission !== 'ocr.patient.confirm')
    await findJob(awaiting)
    fireEvent.change(await screen.findByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(heading('Job status')))
    expect(statusRegion().textContent).toBe('Review recorded.')
  })

  it('review (rejected): moves focus to the job status and says the rejection was recorded', async () => {
    await findJob(awaiting)
    fireEvent.change(await screen.findByLabelText(/^Review decision/), { target: { value: 'rejected' } })
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'The scan is unreadable' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: rejected })
    await press(screen.getByRole('button', { name: 'Reject extraction' }))
    await waitFor(() => expect(focused()).toBe(heading('Job status')))
    expect(statusRegion().textContent).toBe('Rejection recorded.')
  })

  it('confirm: moves focus to the review and publication history, where publishing continues', async () => {
    api.ocrValidations.mockResolvedValue({ items: [validation] })
    await findJob(validated)
    fireEvent.change(await screen.findByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    api.confirmOcrPatient.mockResolvedValue({ id: 'confirmation-1' })
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    await press(screen.getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(focused()).toBe(heading('Review and publication history')))
    expect(statusRegion().textContent).toBe('Source patient confirmed.')
  })

  it('publish: moves focus to the review and publication history and says the publication was recorded', async () => {
    api.ocrValidations.mockResolvedValue({ items: [validation] })
    await findJob(confirmed)
    const publish = await screen.findByRole('button', { name: 'Publish to DOCUMENT ONLY' })
    api.publishOcrValidation.mockResolvedValue({ id: 'publication-1', status: 'published' })
    api.ocrPublications.mockResolvedValue({ items: [{ id: 'publication-1', status: 'published', targetDomain: 'DOCUMENT_ONLY' }] })
    await press(publish)
    await waitFor(() => expect(focused()).toBe(heading('Review and publication history')))
    expect(statusRegion().textContent).toBe('Publication recorded.')
    expect(screen.queryByRole('button', { name: /^Publish to/ })).toBeNull()
  })

  it('a step whose reload then fails: says the step was recorded and gives focus back to finding the job', async () => {
    await findJob(awaiting)
    fireEvent.change(await screen.findByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockRejectedValue(unavailable())
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: 'Find job' })))
    expect(statusRegion().textContent).toBe('Review recorded.')
    expect(screen.getByRole('alert').textContent).toContain('could not complete')
  })
})

describe('OCR-A11Y-01: validation failures keep focus at the refused field', () => {
  it('review: a short reason takes focus, marked invalid and described by its error, and nothing is sent', async () => {
    await findJob(awaiting)
    const reason = await screen.findByLabelText(/^Review reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    const described = document.getElementById(reason.getAttribute('aria-describedby') ?? '')
    expect(described?.textContent).toBe('Enter a review reason of at least 8 characters.')
    expect(api.validateOcrJob).not.toHaveBeenCalled()
  })

  it('review: a payload that is not JSON takes focus with its error, and nothing is sent', async () => {
    await findJob(awaiting)
    const payload = await screen.findByLabelText(/^Reviewed payload/)
    fireEvent.change(payload, { target: { value: '{not json' } })
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(payload))
    expect(payload.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(payload.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Reviewed payload must be valid JSON.')
    expect(api.validateOcrJob).not.toHaveBeenCalled()
    // The value typed is kept.
    expect((payload as HTMLTextAreaElement).value).toBe('{not json')
  })

  it('review: the error clears from the field once it is corrected and sent', async () => {
    await findJob(awaiting)
    const reason = await screen.findByLabelText(/^Review reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(reason.getAttribute('aria-invalid')).toBe('true'))
    fireEvent.change(reason, { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockRejectedValue(unavailable())
    await press(screen.getByRole('button', { name: 'Validate extraction' }))
    await screen.findByRole('alert')
    expect(reason.getAttribute('aria-invalid')).toBeNull()
  })

  it('confirm: a short reason takes focus with its error, and nothing is sent', async () => {
    await findJob(validated)
    const reason = await screen.findByLabelText(/^Confirmation reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    await press(screen.getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(focused()).toBe(reason))
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a patient confirmation reason of at least 8 characters.')
    expect(api.confirmOcrPatient).not.toHaveBeenCalled()
  })

  it('confirm: an empty patient ID takes focus with its error, and nothing is sent', async () => {
    await findJob(validated)
    const patient = await screen.findByLabelText(/^Canonical patient ID/)
    fireEvent.change(patient, { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    await press(screen.getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(focused()).toBe(patient))
    expect(document.getElementById(patient.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter the canonical patient ID.')
    expect(api.confirmOcrPatient).not.toHaveBeenCalled()
  })

  it('find: an empty document ID takes focus with its error', async () => {
    renderOcr()
    const documentId = screen.getByLabelText(/^Document ID/)
    await press(screen.getByRole('button', { name: 'Find job' }))
    await waitFor(() => expect(focused()).toBe(documentId))
    expect(document.getElementById(documentId.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a document ID.')
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })
})

describe('OCR-A11Y-01: a refused request gives focus back to the control that sent it', () => {
  it('review', async () => {
    await findJob(awaiting)
    fireEvent.change(await screen.findByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockRejectedValue(unavailable())
    const submit = screen.getByRole('button', { name: 'Validate extraction' })
    await press(submit)
    expect((await screen.findByRole('alert')).textContent).toContain('could not complete')
    await waitFor(() => expect(focused()).toBe(submit))
    expect((screen.getByLabelText(/^Review reason/) as HTMLTextAreaElement).value).toBe('Checked against the scanned page')
    expect(statusRegion().textContent).toBe('')
  })

  it('confirm', async () => {
    await findJob(validated)
    fireEvent.change(await screen.findByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    api.confirmOcrPatient.mockRejectedValue(unavailable())
    const submit = screen.getByRole('button', { name: 'Confirm source patient' })
    await press(submit)
    await screen.findByRole('alert')
    await waitFor(() => expect(focused()).toBe(submit))
  })

  it('publish', async () => {
    api.ocrValidations.mockResolvedValue({ items: [validation] })
    await findJob(confirmed)
    const publish = await screen.findByRole('button', { name: 'Publish to DOCUMENT ONLY' })
    api.publishOcrValidation.mockRejectedValue(unavailable())
    await press(publish)
    await screen.findByRole('alert')
    await waitFor(() => expect(focused()).toBe(screen.getByRole('button', { name: 'Publish to DOCUMENT ONLY' })))
  })

  it('create', async () => {
    await findJob(null)
    api.createOcrJob.mockRejectedValue(unavailable())
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    const create = screen.getByRole('button', { name: 'Create extraction job' })
    await press(create)
    await screen.findByRole('alert')
    await waitFor(() => expect(focused()).toBe(create))
  })

  it('find', async () => {
    api.findOcrJob.mockRejectedValue(unavailable())
    renderOcr()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    const find = screen.getByRole('button', { name: 'Find job' })
    await press(find)
    await screen.findByRole('alert')
    await waitFor(() => expect(focused()).toBe(find))
  })
})

describe('OCR-A11Y-01: retrying a failed job', () => {
  it('moves focus to the job status and says the retry was requested', async () => {
    await findJob(failed)
    fireEvent.change(screen.getByLabelText(/^Retry reason/), { target: { value: 'The scan was replaced with a clearer copy' } })
    api.retryOcrJob.mockResolvedValue(queued)
    await press(screen.getByRole('button', { name: 'Retry job' }))
    await waitFor(() => expect(focused()).toBe(heading('Job status')))
    expect(statusRegion().textContent).toBe('Retry requested.')
    expect(screen.queryByLabelText(/^Retry reason/)).toBeNull()
  })

  it('keeps a refused retry in the retry form, with focus back on Retry job', async () => {
    await findJob(failed)
    fireEvent.change(screen.getByLabelText(/^Retry reason/), { target: { value: 'The scan was replaced with a clearer copy' } })
    api.retryOcrJob.mockRejectedValue(unavailable())
    const retry = screen.getByRole('button', { name: 'Retry job' })
    await press(retry)
    const alert = await screen.findByRole('alert')
    expect(retry.closest('form')?.contains(alert)).toBe(true)
    await waitFor(() => expect(focused()).toBe(retry))
  })

  it('a short retry reason takes focus with its error, and nothing is sent', async () => {
    await findJob(failed)
    const reason = screen.getByLabelText(/^Retry reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    await press(screen.getByRole('button', { name: 'Retry job' }))
    await waitFor(() => expect(focused()).toBe(reason))
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a reason of at least 8 characters.')
    expect(api.retryOcrJob).not.toHaveBeenCalled()
  })
})

describe('OCR-A11Y-01: arriving at OCR by Back, Forward or a document\'s Extract with OCR', () => {
  // The browser's own Back and Forward buttons, outside the page.
  let go: (delta: number) => void = () => {}
  function History() {
    const navigate = useNavigate()
    go = delta => { void navigate(delta) }
    return null
  }
  async function traverse(delta: number) { await act(async () => { go(delta) }) }
  function Elsewhere() {
    const navigate = useNavigate()
    return <><h1>Clinical record</h1><button type="button" onClick={() => navigate('/provider/ocr', {
      state: { ocrDocumentId: DOCUMENT, ocrPatientId: PATIENT, actorId: 'staff-1', facilityId: 'facility-1' } })}>Extract with OCR</button></>
  }
  /** The workspace's main region, as the staff App's shell lays it out. */
  function Workspace() {
    const main = useRef<HTMLElement>(null)
    useFocusOnPageChange(main)
    return <main ref={main}><Outlet /></main>
  }
  function renderWithHistory(entries: string[], index: number) {
    render(<MemoryRouter initialEntries={entries} initialIndex={index}><History /><Routes><Route element={<Workspace />}>
      <Route path="/provider/ocr" element={<Ocr />} /><Route path="/provider/clinical" element={<Elsewhere />} />
    </Route></Routes></MemoryRouter>)
  }

  it('moves focus to the page heading when a document\'s Extract with OCR opens it', async () => {
    renderWithHistory(['/provider/clinical'], 0)
    await press(screen.getByRole('button', { name: 'Extract with OCR' }))
    await waitFor(() => expect(focused()).toBe(heading('Document OCR')))
  })

  it('moves focus to the page heading on Back and on Forward', async () => {
    renderWithHistory(['/provider/clinical', '/provider/ocr'], 0)
    // On the previous page, a control inside it has focus when the browser goes Forward.
    screen.getByRole('button', { name: 'Extract with OCR' }).focus()
    await traverse(1)
    await waitFor(() => expect(focused()).toBe(heading('Document OCR')))
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    screen.getByLabelText(/^Document ID/).focus()
    await traverse(-1)
    screen.getByRole('button', { name: 'Extract with OCR' }).focus()
    await traverse(1)
    await waitFor(() => expect(focused()).toBe(heading('Document OCR')))
  })

  it('leaves focus alone when the page is the first one opened', async () => {
    renderWithHistory(['/provider/ocr'], 0)
    expect(focused()).toBe(document.body)
  })

  it('does not bring back an earlier step\'s message on returning', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queued)
    renderWithHistory(['/provider/clinical', '/provider/ocr'], 1)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.click(screen.getByRole('button', { name: 'Find job' }))
    fireEvent.change(await screen.findByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(screen.getByRole('button', { name: 'Create extraction job' }))
    await waitFor(() => expect(statusRegion().textContent).toBe('Extraction job created.'))
    await traverse(-1)
    await traverse(1)
    await waitFor(() => expect(focused()).toBe(heading('Document OCR')))
    expect(statusRegion().textContent).toBe('')
  })
})
