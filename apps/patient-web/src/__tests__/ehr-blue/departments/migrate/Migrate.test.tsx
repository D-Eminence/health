import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { migratePage } from '../../../../ehr-blue/departments/migrate/page'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, renderDept } from '../harness'

/**
 * The blue Migrate page: today's Document OCR flow (staff/routes/Operations.tsx Ocr) in the design's list, new and
 * record views. Fictional data only.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(),
  createOcrJob: vi.fn(), retryOcrJob: vi.fn(), validateOcrJob: vi.fn(), confirmOcrPatient: vi.fn(), publishOcrValidation: vi.fn(),
  labImport: vi.fn(), pharmacyImport: vi.fn(),
}))
const session = vi.hoisted(() => ({ permissions: [] as string[], lock: null as string | null, actorId: 'staff-demo-1',
  facilityId: '98d00002-0000-4000-8000-000000000001' }))

vi.mock('../../../../staff/api', () => ({ staffApi: api }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => {
      const context = staffContext(fakeFacility(session.permissions, { id: session.facilityId, name: 'Demo Hospital' }))
      return { ...context, lock: session.lock, state: { ...context.state, session: { actor: { ...context.state.session.actor, id: session.actorId } } } }
    },
  }
})

const ALL = ['ocr.job.read', 'ocr.job.write', 'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write']
/** Document OCR's refusal, at its address and on the page: no role holds the OCR work yet, so nobody is told to ask anyone. */
const OCR_REFUSAL = 'Reading scanned documents isn’t available at your facility yet.'
/** A permission's name, Identity's code or the old "membership needs … permission" words: none belongs on a screen. */
const PERMISSION_WORDS = /permission|membership|OCR job read|ocr\.job\.read/i
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const OTHER_DOCUMENT = 'd0000000-0000-4000-8000-0000000000b2'
const base = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 3,
  attemptCount: 1, maxAttempts: 3, patientConfirmation: null }
const awaiting = { ...base, status: 'awaiting_validation' }
const validated = { ...base, status: 'validated', version: 4 }
const rejected = { ...base, status: 'rejected', version: 4 }
const confirmed = { ...validated, version: 5, patientConfirmation: { id: 'confirmation-1', patientId: PATIENT, version: 1,
  method: 'source_document', confirmedAt: '2026-10-12T10:00:00.000Z' } }
const failed = { ...base, status: 'failed' }
const exhausted = { ...base, status: 'failed', attemptCount: 3 }
const queued = { ...base, status: 'queued', version: 4 }
const extraction = { id: 'extraction-1', jobId: base.id, version: 1, provider: 'textract', confidence: 0.92, rawText: 'Haemoglobin 12.1',
  structuredPayload: { title: 'Full blood count' }, createdAt: '2026-10-12T09:00:00.000Z' }
const validation = { id: 'validation-1', jobId: base.id, version: 1, disposition: 'validated', targetDomain: 'DOCUMENT_ONLY',
  candidateType: 'document_only', reason: 'Matches the source document', reviewedAt: '2026-10-12T09:30:00.000Z' }
const unavailable = () => new HidApiError(503, 'The service could not complete the request.', { code: 'SERVICE_UNAVAILABLE' })

beforeEach(() => {
  vi.clearAllMocks()
  session.permissions = ALL
  session.lock = null
  session.actorId = 'staff-demo-1'
  session.facilityId = DEMO_HOSPITAL_ID
  api.ocrExtractions.mockResolvedValue({ items: [extraction] })
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
})

function renderMigrate() {
  return renderDept(<Migrate />)
}

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const focused = () => document.activeElement
/** What describes a control, in order: a refused control's error first, then anything else that describes it. */
const descriptions = (control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent)
const heading = (name: string) => screen.getByRole('heading', { name })
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const statusRegion = () => {
  const region = document.getElementById('ocr-status')
  if (!region) throw new Error('Expected the status region to stay mounted.')
  return region
}

/** Finds a job by its document ID from the list view; with a job, its record opens. */
async function findJob(job: object | null) {
  api.findOcrJob.mockResolvedValue({ job })
  renderMigrate()
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  await press(button('Find job'))
  if (job) await screen.findByRole('heading', { name: 'Saved record' })
  else await screen.findByText('No OCR job for this document')
}

async function openAction(name: string) {
  const control = within(actionsCard()).getAllByRole('button', { name })[0]!
  await press(control)
  return control
}

const actionsCard = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement

/** No staffApi member outside these was called. */
function onlyCalled(...names: Array<keyof typeof api>) {
  for (const [name, fn] of Object.entries(api)) if (!names.includes(name as keyof typeof api)) expect(fn, name).not.toHaveBeenCalled()
}

describe('Migrate page entry', () => {
  it('is listed under Network & Services as Document OCR, at today\'s OCR address, for OCR job read, live', () => {
    expect(migratePage).toMatchObject({ path: 'ocr', group: 'Network & Services', label: 'Document OCR', permission: 'ocr.job.read', status: 'live' })
  })

  it('refuses at its address in plain words that name no permission', () => {
    renderDept(<>{migratePage.refusal}</>)
    expect(screen.getByRole('heading', { level: 1, name: 'Document OCR unavailable' })).toBeTruthy()
    expect(screen.getByText(OCR_REFUSAL)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(PERMISSION_WORDS)
  })

  it('refuses a membership without OCR job read, even with document read and write, in plain words, and reads nothing', () => {
    session.permissions = ['ehr.document.read', 'ehr.document.write', 'ocr.job.write']
    renderMigrate()
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document OCR'])
    expect(screen.getAllByRole('alert').map(alert => alert.textContent)).toEqual([OCR_REFUSAL])
    expect(document.body.textContent).not.toMatch(PERMISSION_WORDS)
    expect(screen.queryByRole('button', { name: 'Find job' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Patient documents' })).toBeNull()
    onlyCalled()
  })

  it('a membership with OCR job read only has OCR and no Patient documents', () => {
    session.permissions = ['ocr.job.read']
    renderMigrate()
    expect(button('Find job')).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search Document OCR' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Patient documents' })).toBeNull()
    onlyCalled()
  })

  it('a membership with OCR job read and document read has both', () => {
    session.permissions = ['ocr.job.read', 'ehr.document.read']
    renderMigrate()
    expect(button('Find job')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Patient documents' })).toBeTruthy()
    expect(screen.getByText('No patient open')).toBeTruthy()
    onlyCalled()
  })
})

describe('Migrate list view', () => {
  it('shows one h1, the migration notice, Find document job, and the list with its columns empty', () => {
    renderMigrate()
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document OCR'])
    // The owner took the migration notice out: the list says what it holds in its search hint.
    expect(screen.queryByText('Project migration is not available yet')).toBeNull()
    expect(heading('Find document job')).toBeTruthy()
    // The search is described by its hint, which says what the list holds.
    expect(descriptions(screen.getByRole('searchbox', { name: 'Search Document OCR' })))
      .toEqual(['OCR has no facility-wide job list: jobs you find or create here are listed until you leave this page.'])
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Find a job by its document ID, or create one when you have the appropriate permission.')).toBeTruthy()
    expect(button('Create record')).toBeTruthy()
    expect(statusRegion().getAttribute('role')).toBe('status')
    expect(statusRegion().textContent).toBe('')
    onlyCalled()
  })

  it('offers Create record only to a membership that writes OCR jobs', () => {
    session.permissions = ['ocr.job.read']
    renderMigrate()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('an empty document ID takes focus with its error, and nothing is sent', async () => {
    renderMigrate()
    const field = screen.getByLabelText(/^Document ID/)
    await press(button('Find job'))
    await waitFor(() => expect(focused()).toBe(field))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Complete this field.')
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })

  it('a document ID that is not a UUID is refused at its field', async () => {
    renderMigrate()
    const field = screen.getByLabelText(/^Document ID/)
    fireEvent.change(field, { target: { value: 'HID-ZDEMAAA2' } })
    await press(button('Find job'))
    await waitFor(() => expect(focused()).toBe(field))
    expect(document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a valid document ID (a UUID).')
    expect(api.findOcrJob).not.toHaveBeenCalled()
  })

  it('announces that a document has no job in a region mounted before the answer, with Create record outside it', async () => {
    api.findOcrJob.mockResolvedValue({ job: null })
    renderMigrate()
    const region = document.getElementById('ocr-find-result')!
    expect(region.getAttribute('role')).toBe('status')
    expect(region.textContent).toBe('')
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    await waitFor(() => expect(region.textContent).toBe('No OCR job for this documentDocument ••••000001 has no extraction job yet. Create one for a verified patient document.'))
    expect(region.isConnected).toBe(true)
    expect(within(region).queryByRole('button')).toBeNull()
    expect(document.getElementById('ocr-create-start')).toBeTruthy()
  })

  it('says when a document has no job, keeps focus on Find job, and offers to create one', async () => {
    await findJob(null)
    expect(api.findOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
    expect(screen.getByText('Document ••••000001 has no extraction job yet. Create one for a verified patient document.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(button('Find job')))
    expect(screen.getAllByRole('button', { name: 'Create record' })).toHaveLength(2)
  })

  it('without OCR job write, a document with no job offers nothing to create', async () => {
    session.permissions = ['ocr.job.read']
    await findJob(null)
    expect(screen.getByText('Document ••••000001 has no extraction job yet.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('says a refused lookup, and gives focus back to Find job', async () => {
    api.findOcrJob.mockRejectedValue(unavailable())
    renderMigrate()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    expect((await screen.findByRole('alert')).textContent).toBe('The service could not complete the request.')
    await waitFor(() => expect(focused()).toBe(button('Find job')))
    expect(screen.queryByText('No OCR job for this document')).toBeNull()
  })

  it('says plainly when the OCR module is not in service on this deployment', async () => {
    api.findOcrJob.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
    renderMigrate()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    expect((await screen.findByRole('alert')).textContent).toBe('This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.')
  })
})

describe('Migrate record view', () => {
  it('opens a found job as its record, with focus on its heading, Back to list, its saved record and actions', async () => {
    await findJob(awaiting)
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document ••••000001'])
    await waitFor(() => expect(focused()).toBe(document.getElementById('migrate-view-title')))
    expect(button('Back to list')).toBeTruthy()
    const record = heading('Saved record').closest('section') as HTMLElement
    expect(within(record).getByText('awaiting validation')).toBeTruthy()
    expect(within(record).getByText('textract')).toBeTruthy()
    expect(within(record).getByText('Not confirmed')).toBeTruthy()
    expect(within(record).getByText('1 of 3')).toBeTruthy()
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Validate extraction', 'Reject extraction'])
    expect(await screen.findByText('Extraction 1 · textract · confidence 92%')).toBeTruthy()
    expect(document.body.textContent).not.toContain(DOCUMENT)
    expect(document.body.textContent).not.toContain(PATIENT)
  })

  it('keeps the extracted text in a disclosure the keyboard can scroll', async () => {
    await findJob(awaiting)
    const summary = await screen.findByText('Extraction 1 · textract · confidence 92%')
    expect(summary.tagName).toBe('SUMMARY')
    const text = screen.getByRole('region', { name: 'Extracted text, version 1', hidden: true })
    expect(text.getAttribute('tabindex')).toBe('0')
    expect(text.textContent).toBe('Haemoglobin 12.1')
  })

  it('says when no extraction is available yet, and loading before that', async () => {
    let answer: (value: unknown) => void = () => {}
    api.ocrExtractions.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await findJob(queued)
    expect(screen.getByText('Loading extractions…')).toBeTruthy()
    await act(async () => { answer({ items: [] }) })
    expect(screen.getByText('No extraction is available yet.')).toBeTruthy()
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status'])
  })

  it('offers no step to a role without the step permissions, and says so', async () => {
    session.permissions = ['ocr.job.read']
    await findJob(awaiting)
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status'])
    session.permissions = ['ocr.job.read']
  })

  it('says when the review evidence cannot be loaded', async () => {
    api.ocrValidations.mockRejectedValue(new HidApiError(403, 'OCR access is not authorized', { code: 'OCR_ACCESS_DENIED' }))
    await findJob(awaiting)
    expect((await screen.findByRole('alert')).textContent).toBe('OCR access is not authorized')
  })

  it('Back to list shows the job in the list, with focus on its name, and Quick view shows its facts', async () => {
    await findJob(validated)
    await press(button('Back to list'))
    const name = await screen.findByRole('button', { name: 'Document ••••000001' })
    await waitFor(() => expect(focused()).toBe(name))
    const row = name.closest('tr') as HTMLElement
    expect(within(row).getByText('validated')).toBeTruthy()
    expect(within(row).getByText('Patient ••••000001')).toBeTruthy()
    expect(within(row).getByText('Job ••••000001')).toBeTruthy()
    await press(within(row).getByRole('button', { name: 'Quick view' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: 'Document ••••000001' })).toBeTruthy()
    expect(within(drawer).getByText('Not confirmed')).toBeTruthy()
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    await press(within(drawer).getByRole('button', { name: 'Open full record' }))
    expect(await screen.findByText(/^Confirmed /)).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Quick view closes with Escape, giving focus back to the button that opened it', async () => {
    await findJob(validated)
    await press(button('Back to list'))
    const quickView = within(screen.getByRole('button', { name: 'Document ••••000001' }).closest('tr') as HTMLElement).getByRole('button', { name: 'Quick view' })
    await press(quickView)
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    await act(async () => { fireEvent.keyDown(drawer, { key: 'Escape' }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(focused()).toBe(quickView))
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
  })

  it('Open reads the job again, and a search filters the jobs listed', async () => {
    await findJob(validated)
    await press(button('Back to list'))
    api.findOcrJob.mockResolvedValue({ job: { ...base, id: 'j0000000-0000-4000-8000-0000000000b2', documentId: OTHER_DOCUMENT, status: 'queued' } })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: OTHER_DOCUMENT } })
    await press(button('Find job'))
    await screen.findByRole('heading', { name: 'Saved record' })
    await press(button('Back to list'))
    expect(screen.getAllByRole('row')).toHaveLength(3)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Document OCR' }), { target: { value: 'queued' } })
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Document ••••0000b2' })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Document OCR' }), { target: { value: 'nothing like it' } })
    expect(screen.getByText('Change your search.')).toBeTruthy()
    await press(button('Clear search'))
    expect(screen.getAllByRole('row')).toHaveLength(3)
    api.findOcrJob.mockResolvedValue({ job: validated })
    const open = within(screen.getByRole('button', { name: 'Document ••••000001' }).closest('tr') as HTMLElement).getByRole('button', { name: /^Open/ })
    await press(open)
    await screen.findByRole('heading', { name: 'Saved record' })
    expect(api.findOcrJob).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
  })

  it('Refresh status reads the job again and keeps focus on it', async () => {
    await findJob(awaiting)
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(button('Refresh status'))
    await waitFor(() => expect(within(heading('Saved record').closest('section') as HTMLElement).getByText('validated')).toBeTruthy())
    await waitFor(() => expect(focused()).toBe(button('Refresh status')))
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
  })

  it('a refresh whose read fails goes back to the list, says why, and gives focus to Find job', async () => {
    await findJob(awaiting)
    api.findOcrJob.mockRejectedValue(unavailable())
    await press(button('Refresh status'))
    expect((await screen.findByRole('alert')).textContent).toBe('The service could not complete the request.')
    await waitFor(() => expect(focused()).toBe(button('Find job')))
  })
})

describe('Migrate: creating a job (New document job)', () => {
  async function openNew() {
    renderMigrate()
    await press(button('Create record'))
    await waitFor(() => expect(focused()).toBe(document.getElementById('migrate-view-title')))
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['New document job'])
  }

  it('refuses empty and malformed IDs at their fields, sending nothing', async () => {
    await openNew()
    await press(button('Save record'))
    const documentField = screen.getByLabelText(/^Document ID/)
    await waitFor(() => expect(focused()).toBe(documentField))
    expect(document.getElementById(documentField.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Complete this field.')
    fireEvent.change(documentField, { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: 'HID-ZDEMAAA2' } })
    await press(button('Save record'))
    const patientField = screen.getByLabelText(/^Patient ID/)
    await waitFor(() => expect(focused()).toBe(patientField))
    expect(document.getElementById(patientField.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a valid patient ID (a UUID).')
    onlyCalled()
  })

  it('checks the document has no job first, creates it, opens it and says so', async () => {
    await openNew()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queued)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Extraction job created.')
    expect(api.findOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
    expect(api.createOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT, PATIENT)
    expect(api.findOcrJob.mock.invocationCallOrder[0]!).toBeLessThan(api.createOcrJob.mock.invocationCallOrder[0]!)
  })

  it('opens the job a document already has, and creates no other', async () => {
    await openNew()
    api.findOcrJob.mockResolvedValue({ job: validated })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    await waitFor(() => expect(statusRegion().textContent).toBe('This document already has an OCR job, so no new job was created.'))
    expect(api.createOcrJob).not.toHaveBeenCalled()
    expect(heading('Saved record')).toBeTruthy()
  })

  it('creates nothing when the document cannot be checked first', async () => {
    await openNew()
    api.findOcrJob.mockRejectedValue(unavailable())
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    expect((await screen.findByRole('alert')).textContent).toBe('The service could not complete the request.')
    expect(api.createOcrJob).not.toHaveBeenCalled()
    await waitFor(() => expect(focused()).toBe(button('Save record')))
  })

  it('a refused create stays in the form, says why, and gives focus back to Save record', async () => {
    await openNew()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockRejectedValue(new HidApiError(409, 'The document is not virus scan clean', { code: 'OCR_DOCUMENT_NOT_READY' }))
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    expect((await screen.findByRole('alert')).textContent).toBe('The document is not virus scan clean')
    expect(screen.getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(button('Save record')))
  })

  it('keeps one status region mounted across the list, new and record views, so what it says is announced', async () => {
    await openNew()
    const region = statusRegion()
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockResolvedValue(queued)
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    await waitFor(() => expect(region.textContent).toBe('Extraction job created.'))
    expect(statusRegion()).toBe(region)
    expect(region.isConnected).toBe(true)
  })

  it('Create record from a document with no job carries its ID into the form', async () => {
    await findJob(null)
    await press(screen.getAllByRole('button', { name: 'Create record' })[1]!)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(DOCUMENT)
    await press(button('Back to list'))
    await waitFor(() => expect(focused()).toBe(heading('Find document job')))
  })
})

describe('Migrate: each step moves focus to where the work continues and says what happened', () => {
  it('review (validated): opens the next step, confirming the source patient, with focus on it', async () => {
    await findJob(awaiting)
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('ocr-confirm-title')))
    expect(focused()?.getAttribute('aria-expanded')).toBe('true')
    expect(statusRegion().textContent).toBe('Review recorded. Confirm the source patient next.')
    const [, , input] = api.validateOcrJob.mock.calls[0]!
    expect(input).toMatchObject({ extractionId: 'extraction-1', disposition: 'validated', targetDomain: 'DOCUMENT_ONLY',
      candidateType: 'document_only', validatedPayload: { title: 'Full blood count' }, acceptedFields: {}, rejectedFields: [], corrections: [],
      reason: 'Checked against the scanned page' })
    expect(screen.getByRole('form', { name: 'Confirm source patient' })).toBeTruthy()
  })

  it('review (validated) to a chosen domain sends its candidate type', async () => {
    await findJob(awaiting)
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText('Owning domain'), { target: { value: 'LAB' } })
    fireEvent.change(screen.getByLabelText(/^Accepted fields/), { target: { value: '{"observations":[]}' } })
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![1]).toEqual(awaiting)
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ targetDomain: 'LAB', candidateType: 'lab_document', acceptedFields: { observations: [] } })
  })

  it('review (validated) without the confirmation permission: focus goes to the saved record, naming no next step', async () => {
    session.permissions = ALL.filter(permission => permission !== 'ocr.patient.confirm')
    await findJob(awaiting)
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Review recorded.')
  })

  it('review (rejected): sends UNCLASSIFIED, focus goes to the saved record and the rejection is said', async () => {
    await findJob(awaiting)
    await openAction('Reject extraction')
    expect(screen.queryByLabelText('Owning domain')).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'The scan is unreadable' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: rejected })
    await press(within(screen.getByRole('form', { name: 'Reject extraction' })).getByRole('button', { name: 'Reject extraction' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Rejection recorded.')
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified' })
  })

  it('review: a short reason and a payload that is not JSON take focus at their fields, and nothing is sent', async () => {
    await findJob(awaiting)
    await openAction('Validate extraction')
    const reason = screen.getByLabelText(/^Review reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    const submit = within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(reason))
    expect(document.getElementById(reason.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter a review reason of at least 8 characters.')
    const payload = screen.getByLabelText(/^Reviewed payload/)
    fireEvent.change(payload, { target: { value: '{not json' } })
    fireEvent.change(reason, { target: { value: 'Checked against the scanned page' } })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(payload))
    const [describedFirstBy, then] = (payload.getAttribute('aria-describedby') ?? '').split(' ')
    expect(document.getElementById(describedFirstBy ?? '')?.textContent).toBe('Reviewed payload must be valid JSON.')
    expect(then).toBe('ocr-review-requirements')
    fireEvent.change(payload, { target: { value: '[]' } })
    await press(submit)
    await waitFor(() => expect(descriptions(payload)[0]).toBe('Reviewed payload must be a JSON object.'))
    fireEvent.change(payload, { target: { value: '{}' } })
    const corrections = screen.getByLabelText(/^Corrections/)
    fireEvent.change(corrections, { target: { value: '[1]' } })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(corrections))
    expect(corrections.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(corrections)).toEqual(['Corrections must be a JSON array of objects.'])
    // The payload, no longer refused, is described only by what the owning domains require.
    expect(payload.getAttribute('aria-invalid')).toBeNull()
    expect(payload.getAttribute('aria-describedby')).toBe('ocr-review-requirements')
    expect(api.validateOcrJob).not.toHaveBeenCalled()
  })

  it('review: a refused review stays in its form, with focus back on its button and the reason kept', async () => {
    await findJob(awaiting)
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockRejectedValue(new HidApiError(409, 'The job changed since it was read', { code: 'OCR_JOB_VERSION_CONFLICT' }))
    const submit = within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' })
    await press(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('The job changed since it was read')
    await waitFor(() => expect(focused()).toBe(submit))
    expect((screen.getByLabelText(/^Review reason/) as HTMLTextAreaElement).value).toBe('Checked against the scanned page')
    expect(statusRegion().textContent).toBe('')
  })

  it('a review whose reload then fails: says it was recorded, and gives focus to finding the job', async () => {
    await findJob(awaiting)
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockRejectedValue(unavailable())
    await press(within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' }))
    await waitFor(() => expect(focused()).toBe(button('Find job')))
    expect(statusRegion().textContent).toBe('Review recorded.')
    expect(screen.getByRole('alert').textContent).toBe('The service could not complete the request.')
  })

  it('confirm: moves focus to the review and publication history', async () => {
    api.ocrValidations.mockResolvedValue({ items: [validation] })
    await findJob(validated)
    await openAction('Confirm source patient')
    expect((screen.getByLabelText(/^Canonical patient ID/) as HTMLInputElement).value).toBe(PATIENT)
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    api.confirmOcrPatient.mockResolvedValue({ id: 'confirmation-1' })
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    await press(within(screen.getByRole('form', { name: 'Confirm source patient' })).getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(focused()).toBe(heading('Review and publication history')))
    expect(statusRegion().textContent).toBe('Source patient confirmed.')
    expect(api.confirmOcrPatient).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, validated, PATIENT, 'Name and date of birth match', expect.any(String))
  })

  it('confirm: refuses an empty or malformed patient ID and a short reason at their fields', async () => {
    await findJob(validated)
    await openAction('Confirm source patient')
    const patient = screen.getByLabelText(/^Canonical patient ID/)
    const submit = within(screen.getByRole('form', { name: 'Confirm source patient' })).getByRole('button', { name: 'Confirm source patient' })
    fireEvent.change(patient, { target: { value: '' } })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(patient))
    expect(descriptions(patient)).toEqual(['Complete this field.'])
    fireEvent.change(patient, { target: { value: 'HID-ZDEMAAA2' } })
    await press(submit)
    await waitFor(() => expect(descriptions(patient)).toEqual(['Enter a valid canonical patient ID (a UUID).']))
    fireEvent.change(patient, { target: { value: PATIENT } })
    const reason = screen.getByLabelText(/^Confirmation reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(reason))
    expect(descriptions(reason)).toEqual(['Enter a patient confirmation reason of at least 8 characters.'])
    expect(reason.getAttribute('aria-invalid')).toBe('true')
    expect(patient.getAttribute('aria-describedby')).toBeNull()
    expect(api.confirmOcrPatient).not.toHaveBeenCalled()
  })

  it('confirm: a retry of the same confirmation reuses its key; a different one takes a new key', async () => {
    await findJob(validated)
    await openAction('Confirm source patient')
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    api.confirmOcrPatient.mockRejectedValue(unavailable())
    const submit = within(screen.getByRole('form', { name: 'Confirm source patient' })).getByRole('button', { name: 'Confirm source patient' })
    await press(submit)
    await screen.findByRole('alert')
    await waitFor(() => expect(focused()).toBe(submit))
    await press(submit)
    await waitFor(() => expect(api.confirmOcrPatient).toHaveBeenCalledTimes(2))
    expect(api.confirmOcrPatient.mock.calls[1]![4]).toBe(api.confirmOcrPatient.mock.calls[0]![4])
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name, date of birth and address match' } })
    await press(submit)
    await waitFor(() => expect(api.confirmOcrPatient).toHaveBeenCalledTimes(3))
    expect(api.confirmOcrPatient.mock.calls[2]![4]).not.toBe(api.confirmOcrPatient.mock.calls[0]![4])
  })

  it('confirm: a job confirmed already is read again, and says so', async () => {
    api.ocrValidations.mockResolvedValue({ items: [validation] })
    await findJob(validated)
    await openAction('Confirm source patient')
    fireEvent.change(screen.getByLabelText(/^Confirmation reason/), { target: { value: 'Name and date of birth match' } })
    api.confirmOcrPatient.mockRejectedValue(new HidApiError(409, 'Already confirmed', { code: 'OCR_PATIENT_ALREADY_CONFIRMED' }))
    api.findOcrJob.mockResolvedValue({ job: confirmed })
    await press(within(screen.getByRole('form', { name: 'Confirm source patient' })).getByRole('button', { name: 'Confirm source patient' }))
    await waitFor(() => expect(statusRegion().textContent).toBe('The source patient of this job was already confirmed, so the job was reloaded.'))
    await waitFor(() => expect(focused()).toBe(heading('Review and publication history')))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retry: a failed job with attempts left is retried with a reason, and the retry is said', async () => {
    await findJob(failed)
    const disclosure = await openAction('Retry job')
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(screen.getByLabelText(/^Retry reason/), { target: { value: 'The scan was replaced with a clearer copy' } })
    api.retryOcrJob.mockResolvedValue(queued)
    await press(within(screen.getByRole('form', { name: 'Retry job' })).getByRole('button', { name: 'Retry job' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Retry requested.')
    expect(api.retryOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, failed, 'The scan was replaced with a clearer copy')
    expect(screen.queryByLabelText(/^Retry reason/)).toBeNull()
  })

  it('retry: a short reason takes focus with its error; a refused retry stays in its form', async () => {
    await findJob(failed)
    await openAction('Retry job')
    const reason = screen.getByLabelText(/^Retry reason/)
    fireEvent.change(reason, { target: { value: 'short' } })
    const submit = within(screen.getByRole('form', { name: 'Retry job' })).getByRole('button', { name: 'Retry job' })
    await press(submit)
    await waitFor(() => expect(focused()).toBe(reason))
    expect(descriptions(reason)).toEqual(['Enter a reason of at least 8 characters.'])
    expect(api.retryOcrJob).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: 'The scan was replaced with a clearer copy' } })
    api.retryOcrJob.mockRejectedValue(unavailable())
    await press(submit)
    const alert = await screen.findByRole('alert')
    expect(submit.closest('form')?.contains(alert)).toBe(true)
    await waitFor(() => expect(focused()).toBe(submit))
  })

  it('retry: a job at its attempt limit offers no retry, and says why', async () => {
    await findJob(exhausted)
    expect(screen.getByText('The extraction attempt limit has been reached. This job cannot be retried.')).toBeTruthy()
    expect(within(actionsCard()).queryByRole('button', { name: 'Retry job' })).toBeNull()
  })

  it('action buttons are disclosures: Enter or Space on the focused button opens and closes its form', async () => {
    await findJob(failed)
    const disclosure = within(actionsCard()).getByRole('button', { name: 'Retry job' })
    expect(disclosure.tagName).toBe('BUTTON')
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    await press(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    await press(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(/^Retry reason/)).toBeNull()
  })

  it('a step that finishes while the workspace is locked takes focus, and says so, once it opens again', async () => {
    const view = renderMigrate()
    api.findOcrJob.mockResolvedValue({ job: awaiting })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    await screen.findByRole('heading', { name: 'Saved record' })
    await openAction('Validate extraction')
    fireEvent.change(screen.getByLabelText(/^Review reason/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    let answer: (value: unknown) => void = () => {}
    api.ocrExtractions.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await press(within(screen.getByRole('form', { name: 'Validate extraction' })).getByRole('button', { name: 'Validate extraction' }))
    await screen.findByRole('form', { name: 'Confirm source patient' })
    session.lock = 'away'
    view.rerender(<MemoryRouter><div className="hid-ehr"><Migrate /></div></MemoryRouter>)
    await act(async () => { answer({ items: [extraction] }) })
    expect(statusRegion().textContent).toBe('')
    session.lock = null
    view.rerender(<MemoryRouter><div className="hid-ehr"><Migrate /></div></MemoryRouter>)
    await waitFor(() => expect(focused()).toBe(document.getElementById('ocr-confirm-title')))
    expect(statusRegion().textContent).toBe('Review recorded. Confirm the source patient next.')
  })

})

describe('Migrate: facility, account and hand-over', () => {
  it('a job is not shown at another facility: changing facility goes back to an empty list', async () => {
    const view = renderMigrate()
    api.findOcrJob.mockResolvedValue({ job: validated })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    await screen.findByRole('heading', { name: 'Saved record' })
    session.facilityId = DEMO_LABORATORY_ID
    view.rerender(<MemoryRouter><div className="hid-ehr"><Migrate /></div></MemoryRouter>)
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull())
    expect(screen.getByRole('heading', { level: 1, name: 'Document OCR' })).toBeTruthy()
    expect(screen.getByText('No matching records')).toBeTruthy()
    onlyCalled('findOcrJob', 'ocrExtractions', 'ocrValidations')
  })

  it('the jobs listed belong to the account that read them', async () => {
    const view = renderMigrate()
    api.findOcrJob.mockResolvedValue({ job: validated })
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    await screen.findByRole('heading', { name: 'Saved record' })
    await press(button('Back to list'))
    expect(screen.getByRole('button', { name: 'Document ••••000001' })).toBeTruthy()
    session.actorId = 'staff-demo-2'
    view.rerender(<MemoryRouter><div className="hid-ehr"><Migrate /></div></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Document ••••000001' })).toBeNull()
  })

  function Where() {
    const location = useLocation()
    return <p data-testid="history-state">{JSON.stringify(location.state)}</p>
  }
  const handOver = (actorId: string, facilityId: string) => render(<MemoryRouter initialEntries={[{ pathname: '/ehr/migrate',
    state: { ocrDocumentId: DOCUMENT, ocrPatientId: PATIENT, actorId, facilityId } }]}><div className="hid-ehr"><Migrate /><Where /></div></MemoryRouter>)

  it('takes a document handed over in router state by the same account and facility, once, and clears it from history', async () => {
    handOver('staff-demo-1', DEMO_HOSPITAL_ID)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe(DOCUMENT)
    await waitFor(() => expect(screen.getByTestId('history-state').textContent).toBe('null'))
    await press(button('Create record'))
    expect((screen.getByLabelText(/^Patient ID/) as HTMLInputElement).value).toBe(PATIENT)
  })

  it('ignores a hand-over made by another account or at another facility', async () => {
    handOver('staff-demo-2', DEMO_HOSPITAL_ID)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe('')
    await waitFor(() => expect(screen.getByTestId('history-state').textContent).toBe('null'))
  })

  it('ignores a hand-over made at another facility', () => {
    handOver('staff-demo-1', DEMO_LABORATORY_ID)
    expect((screen.getByLabelText(/^Document ID/) as HTMLInputElement).value).toBe('')
  })
})
