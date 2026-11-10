import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Migrate, READING_LONG, STILL_READING, needsPatientAccess } from '../../../../ehr-blue/departments/migrate/Migrate'
import { OpenPagesProvider } from '../../../../ehr-blue/frame/pageContext'
import type { EhrBluePage } from '../../../../ehr-blue/frame/types'
import { STAFF_PAPER_NEEDS_ACCESS } from '../../../../paperRecordsWording'
import { migratePage } from '../../../../ehr-blue/departments/migrate/page'
import { DEMO_HOSPITAL_ID, DEMO_LABORATORY_ID, renderDept } from '../harness'
import { SAID_CHANGED, SAID_NOT_TURNED_ON, SAID_REFUSED, SAID_UNAVAILABLE } from '../../../said'
import { handwrittenPage, hardHandwrittenPage, medicinesPaper, paperReading, unreadablePage, unreadPaper } from './paperReadingPayload'
import { REVIEW_NOT_ALLOWED } from '../../../../ehr-blue/departments/migrate/ocrSteps'

/**
 * The blue Migrate page: today's Document OCR flow (staff/routes/Operations.tsx Ocr) in the design's list, new and
 * record views. Fictional data only.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(),
  createOcrJob: vi.fn(), retryOcrJob: vi.fn(), validateOcrJob: vi.fn(), confirmOcrPatient: vi.fn(), publishOcrValidation: vi.fn(),
  labImport: vi.fn(), pharmacyImport: vi.fn(), encounters: vi.fn(),
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
  const rendered = renderMigrate()
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  await press(button('Find job'))
  if (job) await screen.findByRole('heading', { name: 'Saved record' })
  else await screen.findByText('No OCR job for this document')
  return rendered
}

/** Lets `ms` of time pass on the page's clocks, one step of the page's 5 second reads at a time. */
async function wait(ms: number) {
  for (let left = ms; left > 0; left -= 5_000) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(5_000, left)) })
}

/** Runs a test on fake clocks that still move with real time, so the page's own waits for an answer still end. */
async function withFakeTimers(test: () => Promise<void>) {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try { await test() }
  finally { vi.useRealTimers() }
}

async function openAction(name: string) {
  const control = within(actionsCard()).getAllByRole('button', { name })[0]!
  await press(control)
  return control
}

const actionsCard = () => screen.getByRole('heading', { name: 'Available actions' }).closest('section') as HTMLElement
/** The check's item cards, in the order shown (a card's Why? is a disclosure, a group of its own, not a card). */
const cards = () => within(screen.getByRole('form', { name: 'Check and save' })).queryAllByRole('group').filter(group => group.tagName !== 'DETAILS')

/** No staffApi member outside these was called. */
function onlyCalled(...names: Array<keyof typeof api>) {
  for (const [name, fn] of Object.entries(api)) if (!names.includes(name as keyof typeof api)) expect(fn, name).not.toHaveBeenCalled()
}

describe('Migrate page entry', () => {
  it('is listed under Network & Services as Document OCR, at today\'s OCR address, for OCR job read, partial', () => {
    expect(migratePage).toMatchObject({ path: 'ocr', group: 'Network & Services', label: 'Document OCR', permission: 'ocr.job.read', status: 'partial' })
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
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('The service could not complete the request.')
    await waitFor(() => expect(focused()).toBe(button('Find job')))
    expect(screen.queryByText('No OCR job for this document')).toBeNull()
  })

  it('says plainly when the OCR module is not in service on this deployment', async () => {
    api.findOcrJob.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
    renderMigrate()
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    await press(button('Find job'))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_NOT_TURNED_ON)
    expect(document.body.textContent).not.toContain('deployment')
  })
})

describe('Migrate record view', () => {
  it('opens a found job as its record, with focus on its heading, Back to list, its saved record and actions', async () => {
    await findJob(awaiting)
    expect(screen.getAllByRole('heading', { level: 1 }).map(element => element.textContent)).toEqual(['Document ••••000001'])
    await waitFor(() => expect(focused()).toBe(document.getElementById('migrate-view-title')))
    expect(button('Back to list')).toBeTruthy()
    const record = heading('Saved record').closest('section') as HTMLElement
    expect(within(record).getByText('Ready to check')).toBeTruthy()
    expect(within(record).getByText('textract')).toBeTruthy()
    expect(within(record).getByText('Not confirmed')).toBeTruthy()
    expect(within(record).getByText('1 of 3')).toBeTruthy()
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Check and save', 'Reject reading'])
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

  it('shows only the summary line for an extraction with no text, never an empty block', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, confidence: 0.38, rawText: ' \n\t ' }] })
    await findJob(awaiting)
    const summary = await screen.findByText('Extraction 1 · textract · confidence 38%')
    // A plain line, not a disclosure that opens to nothing.
    expect(summary.tagName).toBe('P')
    expect(summary.closest('details')).toBeNull()
    const entry = summary.closest('.hid-ehr-dept-history')!
    expect(entry.querySelector('summary')).toBeNull()
    expect(entry.querySelector('pre')).toBeNull()
    expect(entry.querySelector('.hid-ehr-dept-history-detail')).toBeNull()
    expect(entry.textContent).toBe('Extraction 1 · textract · confidence 38%')
    expect(screen.queryByRole('region', { name: 'Extracted text, version 1', hidden: true })).toBeNull()
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
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain('OCR access is not authorized')
  })

  it('Back to list shows the job in the list, with focus on its name, and Quick view shows its facts', async () => {
    await findJob(validated)
    await press(button('Back to list'))
    const name = await screen.findByRole('button', { name: 'Document ••••000001' })
    await waitFor(() => expect(focused()).toBe(name))
    const row = name.closest('tr') as HTMLElement
    expect(within(row).getByText('Checked')).toBeTruthy()
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
    await waitFor(() => expect(within(heading('Saved record').closest('section') as HTMLElement).getByText('Checked')).toBeTruthy())
    await waitFor(() => expect(focused()).toBe(button('Refresh status')))
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
  })

  it('a refresh whose read fails goes back to the list, says why, and gives focus to Find job', async () => {
    await findJob(awaiting)
    api.findOcrJob.mockRejectedValue(unavailable())
    await press(button('Refresh status'))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('The service could not complete the request.')
    await waitFor(() => expect(focused()).toBe(button('Find job')))
  })
})

describe('Migrate: following a document while it is read', () => {
  it('shows what was read in the record itself, without opening anything, and keeps the steps to check it', async () => {
    await findJob(awaiting)
    const read = (await screen.findByRole('heading', { name: 'What was read' })).closest('section') as HTMLElement
    expect(within(read).getByText('Title')).toBeTruthy()
    expect(within(read).getByText('Full blood count')).toBeTruthy()
    expect(within(read).getByText('Read with 92% confidence. Check it against the document.')).toBeTruthy()
    const text = within(read).getByRole('region', { name: 'Text read from the document' })
    expect(text.textContent).toBe('Haemoglobin 12.1')
    expect(text.getAttribute('tabindex')).toBe('0')
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Check and save', 'Reject reading'])
  })

  it('says in plain words what is happening to the document', async () => {
    await findJob(failed)
    expect(screen.getAllByText('Couldn’t read this document').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toContain('awaiting_validation')
  })

  it('reads a queued job again every 5 seconds, one read at a time, and stops once it is ready to check', async () => withFakeTimers(async () => {
    api.ocrExtractions.mockResolvedValue({ items: [] })
    await findJob(queued)
    expect(screen.getAllByText('Waiting to be read').length).toBeGreaterThan(0)
    expect(screen.getByText('The document is being read. This page updates by itself every few seconds.')).toBeTruthy()
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(4_800) })
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
    let answer: (value: unknown) => void = () => {}
    api.findOcrJob.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
    // No other read starts while one is waiting for its answer.
    await wait(15_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
    await act(async () => { answer({ job: { ...queued, status: 'processing' } }) })
    await waitFor(() => expect(screen.getAllByText('Reading the document').length).toBeGreaterThan(0))
    api.ocrExtractions.mockResolvedValue({ items: [extraction] })
    api.findOcrJob.mockResolvedValue({ job: { ...awaiting, version: 5 } })
    await wait(5_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(3)
    await screen.findByRole('heading', { name: 'What was read' })
    expect(statusRegion().textContent).toBe('The document has been read and is ready to check.')
    expect(screen.getAllByText('Ready to check').length).toBeGreaterThan(0)
    expect(screen.queryByText('The document is being read. This page updates by itself every few seconds.')).toBeNull()
    await wait(60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(3)
    expect(api.findOcrJob).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, DOCUMENT)
  }))

  it('a read that brings no change reads nothing else', async () => withFakeTimers(async () => {
    await findJob(queued)
    const evidence = api.ocrExtractions.mock.calls.length
    await wait(15_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(4)
    expect(api.ocrExtractions).toHaveBeenCalledTimes(evidence)
  }))

  it('stops reading the job again once the page is left', async () => withFakeTimers(async () => {
    const rendered = await findJob(queued)
    await wait(5_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
    rendered.unmount()
    await wait(60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
  }))

  it('stops reading the job again on going back to the list, and never reads from the list', async () => withFakeTimers(async () => {
    await findJob(queued)
    await press(button('Back to list'))
    await wait(60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
  }))

  it('reads nothing by itself when a document has no job', async () => withFakeTimers(async () => {
    await findJob(null)
    await wait(60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
  }))

  it('keeps reading a hard page past 3 minutes, every 15 seconds after the first minute, and stops once it is read', async () => withFakeTimers(async () => {
    await findJob(queued)
    await wait(30_000)
    expect(screen.getByText('The document is being read. This page updates by itself every few seconds.')).toBeTruthy()
    expect(screen.queryByText(READING_LONG)).toBeNull()
    api.findOcrJob.mockResolvedValue({ job: { ...queued, status: 'processing' } })
    await wait(40_000)
    await waitFor(() => expect(screen.getByText(READING_LONG)).toBeTruthy())
    await wait(5 * 60_000)
    const reads = api.findOcrJob.mock.calls.length
    await wait(60_000)
    // About one read every 15 seconds, still going after 6 minutes, with nothing said to have failed.
    expect(api.findOcrJob.mock.calls.length - reads).toBeGreaterThanOrEqual(3)
    expect(api.findOcrJob.mock.calls.length - reads).toBeLessThanOrEqual(5)
    expect(screen.getByText(READING_LONG)).toBeTruthy()
    expect(screen.queryByText(STILL_READING)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    api.ocrExtractions.mockResolvedValue({ items: [extraction] })
    api.findOcrJob.mockResolvedValue({ job: { ...awaiting, version: 5 } })
    await wait(15_000)
    await screen.findByRole('heading', { name: 'What was read' })
    expect(statusRegion().textContent).toBe('The document has been read and is ready to check.')
    expect(screen.queryByText(READING_LONG)).toBeNull()
    const done = api.findOcrJob.mock.calls.length
    await wait(5 * 60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(done)
  }))

  it('a job retried after a long read says what it always has in its first minute again', async () => withFakeTimers(async () => {
    await findJob(queued)
    await wait(70_000)
    await waitFor(() => expect(screen.getByText(READING_LONG)).toBeTruthy())
    api.findOcrJob.mockResolvedValue({ job: { ...failed, version: 5 } })
    await wait(15_000)
    await waitFor(() => expect(screen.queryByText(READING_LONG)).toBeNull())
    await openAction('Retry job')
    fireEvent.change(screen.getByLabelText(/^Retry reason/), { target: { value: 'The scan was replaced with a clearer copy' } })
    api.retryOcrJob.mockResolvedValue({ ...queued, version: 6, attemptCount: 2 })
    api.findOcrJob.mockResolvedValue({ job: { ...queued, version: 6, attemptCount: 2 } })
    await press(within(screen.getByRole('form', { name: 'Retry job' })).getByRole('button', { name: 'Retry job' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(screen.getByText('The document is being read. This page updates by itself every few seconds.')).toBeTruthy()
    expect(screen.queryByText(READING_LONG)).toBeNull()
    await wait(30_000)
    expect(screen.queryByText(READING_LONG)).toBeNull()
  }))

  it('after 20 minutes says it is still reading, and Check now reads it once and starts again', async () => withFakeTimers(async () => {
    await findJob(queued)
    await wait(20 * 60_000 + 30_000)
    expect(screen.getByText(STILL_READING)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    const reads = api.findOcrJob.mock.calls.length
    // About 12 reads in the first minute, then one every 15 seconds.
    expect(reads).toBeGreaterThan(70)
    expect(reads).toBeLessThan(95)
    await wait(5 * 60_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(reads)
    await press(button('Check now'))
    await waitFor(() => expect(api.findOcrJob).toHaveBeenCalledTimes(reads + 1))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(screen.queryByText(STILL_READING)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull()
    expect(screen.getByText(READING_LONG)).toBeTruthy()
    await wait(5_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(reads + 2)
  }))

  it('Refresh status also starts reading again after 20 minutes', async () => withFakeTimers(async () => {
    await findJob(queued)
    await wait(20 * 60_000 + 30_000)
    const reads = api.findOcrJob.mock.calls.length
    await press(button('Refresh status'))
    await waitFor(() => expect(api.findOcrJob).toHaveBeenCalledTimes(reads + 1))
    await waitFor(() => expect(screen.queryByText(STILL_READING)).toBeNull())
    await wait(5_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(reads + 2)
  }))

  it('stops when a read of the job fails, and says to use Refresh status', async () => withFakeTimers(async () => {
    await findJob(queued)
    api.findOcrJob.mockRejectedValue(unavailable())
    await wait(5_000)
    await waitFor(() => expect(screen.getByText('The document’s progress couldn’t be checked just now. Use Refresh status to try again.')).toBeTruthy())
    await wait(30_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
  }))
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
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('The service could not complete the request.')
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
    expect((await screen.findByRole('alert')).textContent).toBe('This document hasn’t finished its virus check yet. Try again once it has.')
    expect(document.body.textContent).not.toContain('The document is not virus scan clean')
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

describe('Migrate: a job refused for want of the patient’s OK (owner, 5 Nov 2026)', () => {
  const SENTENCE = 'To bring in this patient’s paper records, ask the patient to approve access, share their records with you, or enter their Access PIN.'
  const consentRequired = () => new HidApiError(403, 'Records processing consent is required', { code: 'OCR_RECORDS_PROCESSING_CONSENT_REQUIRED' })
  const notFound = () => new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })
  // External record access as the clinical registry has it (frame/pages.ts): live, for identity.consent.write.
  const REQUESTS: EhrBluePage = { path: 'requests/*', group: 'Clinical', label: 'Access requests', permission: 'identity.consent.write', status: 'live', element: <p>Access requests</p> }

  /** New document job, sent with a document that has no job, `refusal` answering the create. */
  async function refusedCreate(refusal: Error, open: readonly EhrBluePage[] | null = null) {
    api.findOcrJob.mockResolvedValue({ job: null })
    api.createOcrJob.mockRejectedValue(refusal)
    if (open) renderDept(<OpenPagesProvider value={open}><Migrate /></OpenPagesProvider>)
    else renderMigrate()
    await press(button('Create record'))
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    return screen.findByRole('alert')
  }

  it('is the decided sentence, word for word', () => {
    expect(STAFF_PAPER_NEEDS_ACCESS).toBe(SENTENCE)
  })

  it('says the sentence for OCR’s 403 OCR_RECORDS_PROCESSING_CONSENT_REQUIRED, never the service’s words, and stays in the form', async () => {
    expect((await refusedCreate(consentRequired())).textContent).toBe(SENTENCE)
    expect(document.body.textContent).not.toContain('Records processing consent is required')
    expect(screen.queryByRole('heading', { name: 'Saved record' })).toBeNull()
    await waitFor(() => expect(focused()).toBe(button('Save record')))
  })

  it('says the same for a 404 from making the job, which means the same before that answer ships', async () => {
    expect((await refusedCreate(notFound())).textContent).toBe(SENTENCE)
  })

  it('keeps other refusals as they were: another 403, a module that is off, and a lookup’s own 404', async () => {
    expect((await refusedCreate(new HidApiError(403, 'OCR access is not authorized', { code: 'OCR_ACCESS_DENIED' }))).textContent).not.toBe(SENTENCE)
    expect(needsPatientAccess(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))).toBe(false)
    expect(needsPatientAccess(new HidApiError(503, 'Down', { code: 'SERVICE_UNAVAILABLE' }))).toBe(false)
    expect(needsPatientAccess(new Error('offline'))).toBe(false)
    expect(needsPatientAccess(consentRequired())).toBe(true)
    expect(needsPatientAccess(notFound())).toBe(true)
  })

  it('a module that is off still says so', async () => {
    expect((await refusedCreate(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))).textContent).toBe(SAID_NOT_TURNED_ON)
  })

  it('a 404 from finding the document’s job is not read as wanting the patient’s OK, and nothing is made', async () => {
    api.findOcrJob.mockRejectedValue(notFound())
    renderMigrate()
    await press(button('Create record'))
    fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
    fireEvent.change(screen.getByLabelText(/^Patient ID/), { target: { value: PATIENT } })
    await press(button('Save record'))
    expect((await screen.findByRole('alert')).textContent).not.toBe(SENTENCE)
    expect(api.createOcrJob).not.toHaveBeenCalled()
  })

  it('links to asking the patient and to their Access PIN, each where this session may open it and its role may take it', async () => {
    session.permissions = [...ALL, 'identity.consent.write', 'identity.patient.read', 'identity.patient-access-pin.verify']
    await refusedCreate(consentRequired(), [REQUESTS])
    expect(screen.getByRole('link', { name: 'Ask the patient for access' }).getAttribute('href')).toBe('/provider/requests/new')
    expect(screen.getByRole('link', { name: 'Enter their Access PIN' }).getAttribute('href')).toBe('/provider/requests/pin')
  })

  it('offers only the steps the role may take, and no link where the page is not open here', async () => {
    session.permissions = [...ALL, 'identity.consent.write']
    const first = await refusedCreate(consentRequired(), [REQUESTS])
    expect(first.textContent).toBe(SENTENCE)
    expect(screen.getByRole('link', { name: 'Ask the patient for access' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Enter their Access PIN' })).toBeNull()
  })

  it('offers no link without the page, saying the sentence alone', async () => {
    session.permissions = [...ALL, 'identity.consent.write', 'identity.patient.read', 'identity.patient-access-pin.verify']
    await refusedCreate(consentRequired(), [])
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getByRole('alert').textContent).toBe(SENTENCE)
  })

  it('offers no link for another refusal', async () => {
    session.permissions = [...ALL, 'identity.consent.write', 'identity.patient.read', 'identity.patient-access-pin.verify']
    await refusedCreate(new HidApiError(409, 'The document is not virus scan clean', { code: 'OCR_DOCUMENT_NOT_READY' }), [REQUESTS])
    expect(screen.queryAllByRole('link')).toEqual([])
  })
})

describe('Migrate: each step moves focus to where the work continues and says what happened', () => {
  it('review (validated): opens the next step, confirming the source patient, with focus on it', async () => {
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('ocr-confirm-title')))
    expect(focused()?.getAttribute('aria-expanded')).toBe('true')
    expect(statusRegion().textContent).toBe('Review recorded. Confirm the source patient next.')
    const [, , input] = api.validateOcrJob.mock.calls[0]!
    // Not a paper reading: nothing to check item by item, so the document is kept with empty objects.
    expect(input).toEqual({ extractionId: 'extraction-1', disposition: 'validated', targetDomain: 'DOCUMENT_ONLY',
      candidateType: 'document_only', validatedPayload: {}, acceptedFields: {}, rejectedFields: [], corrections: [],
      reason: 'Checked against the scanned page' })
    expect(screen.getByRole('form', { name: 'Confirm source patient' })).toBeTruthy()
  })

  it('review (validated) to a chosen domain sends its candidate type', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: paperReading() }] })
    await findJob(awaiting)
    await openAction('Check and save')
    for (const card of cards().slice(0, 2)) await press(within(card).getByRole('button', { name: 'Keep' }))
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'LAB' } })
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![1]).toEqual(awaiting)
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ targetDomain: 'LAB', candidateType: 'lab_document',
      acceptedFields: { observations: [{ testName: 'Haemoglobin', value: '11.2', unit: 'g/dL', referenceRange: '12-16', abnormalFlag: 'low' }] } })
  })

  it('review (validated) without the confirmation permission: focus goes to the saved record, naming no next step', async () => {
    session.permissions = ALL.filter(permission => permission !== 'ocr.patient.confirm')
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Review recorded.')
  })

  it('review (rejected): sends UNCLASSIFIED, focus goes to the saved record and the rejection is said', async () => {
    await findJob(awaiting)
    await openAction('Reject reading')
    expect(screen.queryByLabelText('Save as')).toBeNull()
    expect(screen.getByRole('form', { name: 'Reject reading' }).querySelectorAll('textarea, input, select')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'The scan is unreadable' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: rejected })
    await press(within(screen.getByRole('form', { name: 'Reject reading' })).getByRole('button', { name: 'Reject reading' }))
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(statusRegion().textContent).toBe('Rejection recorded.')
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ disposition: 'rejected', targetDomain: 'UNCLASSIFIED', candidateType: 'unclassified' })
  })

  it('review: an item left undecided, then a short reason, take focus at their fields, and nothing is sent', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: paperReading() }] })
    await findJob(awaiting)
    await openAction('Check and save')
    const reason = screen.getByLabelText(/^Why you’re/)
    fireEvent.change(reason, { target: { value: 'short' } })
    const submit = within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' })
    await press(submit)
    const [first, second] = cards()
    await waitFor(() => expect(focused()).toBe(first))
    expect(first!.getAttribute('aria-invalid')).toBe('true')
    expect(descriptions(first!)).toEqual(['Choose Keep, Change or Remove for this item.'])
    await press(within(first!).getByRole('button', { name: 'Keep' }))
    await press(within(second!).getByRole('button', { name: 'Remove' }))
    expect(first!.getAttribute('aria-invalid')).toBeNull()
    await press(submit)
    await waitFor(() => expect(focused()).toBe(reason))
    expect(descriptions(reason)[0]).toBe('Write at least 8 characters.')
    expect(api.validateOcrJob).not.toHaveBeenCalled()
  })

  it('review: a refused review stays in its form, with focus back on its button and the reason kept', async () => {
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockRejectedValue(new HidApiError(409, 'The job changed since it was read', { code: 'OCR_JOB_VERSION_CONFLICT' }))
    const submit = within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' })
    await press(submit)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain('The job changed since it was read')
    await waitFor(() => expect(focused()).toBe(submit))
    expect((screen.getByLabelText(/^Why you’re/) as HTMLTextAreaElement).value).toBe('Checked against the scanned page')
    expect(statusRegion().textContent).toBe('')
  })

  it('a review whose reload then fails: says it was recorded, and gives focus to finding the job', async () => {
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockRejectedValue(unavailable())
    await press(within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(focused()).toBe(button('Find job')))
    expect(statusRegion().textContent).toBe('Review recorded.')
    expect(screen.getByRole('alert').textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('The service could not complete the request.')
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
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the scanned page' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    let answer: (value: unknown) => void = () => {}
    api.ocrExtractions.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    await press(within(screen.getByRole('form', { name: 'Check and save' })).getByRole('button', { name: 'Save' }))
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

describe('Migrate: what was read from a paper record, item by item', () => {
  const readSection = async () => (await screen.findByRole('heading', { name: 'What was read' })).closest('section') as HTMLElement

  it('shows the items by kind, careful checks first, who the paper is about, and keeps the steps to check it', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, rawText: 'Amlodipine 5mg od', structuredPayload: paperReading() }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('7 items read · 2 to check')).toBeTruthy()
    expect(within(read).getByText('Name on the paper').nextSibling?.textContent).toBe('Bisi Fictional')
    expect(within(read).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['Who the paper is about', 'Medicines', 'Diagnoses', 'Allergies', 'Lab results', 'Vitals', 'Notes'])
    const medicines = within(within(read).getByRole('region', { name: 'Medicines' })).getAllByRole('listitem')
    expect(medicines.map(row => row.querySelector('strong')?.textContent)).toEqual(['Metf?rmin 500 bd', 'Amlodipine 5mg od x 30/7'])
    expect(within(medicines[0]!).getByText('Check')).toBeTruthy()
    // A clean page says nothing more: no warning line, no Details, no confidence line.
    expect(read.querySelector('.hid-ehr-dept-notice-caution')).toBeNull()
    expect(within(read).queryByText('Details')).toBeNull()
    expect(within(read).queryByText(/confidence/)).toBeNull()
    // The reading's own parts never show as loose fields.
    expect(within(read).queryByText('Pages')).toBeNull()
    expect(within(read).queryByText('Contract')).toBeNull()
    // The items are what staff check: the scanned text is not shown beside them, open or closed (owner, 10 November).
    expect(within(read).queryByText('Scanned text (raw)')).toBeNull()
    expect(within(read).queryByRole('region', { name: 'Text read from the document', hidden: true })).toBeNull()
    expect(read.textContent).not.toContain('No text was read')
    // Nor in the Extractions history: its summary line alone.
    const summary = await screen.findByText('Extraction 1 · textract · confidence 92%')
    expect(summary.tagName).toBe('P')
    expect(screen.queryByRole('region', { name: 'Extracted text, version 1', hidden: true })).toBeNull()
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Check and save', 'Reject reading'])
  })

  it('says nothing about scanned text for a paper reading when no text was read', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, rawText: '  \n ', structuredPayload: paperReading() }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('7 items read · 2 to check')).toBeTruthy()
    expect(within(read).queryByText('Scanned text (raw)')).toBeNull()
    expect(within(read).queryByRole('region', { name: 'Text read from the document', hidden: true })).toBeNull()
    expect(read.textContent).not.toContain('No text was read')
  })

  it('still shows the scanned text, open, when a paper reading picked out no items', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: unreadPaper('ai_off') }] })
    await findJob(awaiting)
    const read = await readSection()
    const text = within(read).getByRole('region', { name: 'Text read from the document' })
    expect(text.textContent).toBe('Haemoglobin 12.1')
    expect(text.closest('details')).toBeNull()
    expect(screen.getByRole('region', { name: 'Extracted text, version 1', hidden: true }).textContent).toBe('Haemoglobin 12.1')
  })

  it('warns first when the page may not be fully read, in one line above the count', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, rawText: 'Ceftriaxone ? IV', structuredPayload: handwrittenPage() }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('1 item read · 1 to check')).toBeTruthy()
    const warning = within(read).getByText('Hard handwriting. Check the marked items.')
    // The reasons, what was left out and how sure the reading is wait under Details, closed; no other confidence line.
    const details = within(read).getByText('Details').closest('details')!
    expect(details.open).toBe(false)
    expect(within(details).getByText('Page 1 may not be fully read. Check the whole page against the paper and enter anything missing by hand.')).toBeTruthy()
    expect(within(details).getByText('Why: handwriting that is hard to read; some things the reader suggested could not be found on the page; some lines may have been missed.')).toBeTruthy()
    expect(within(details).getByText('Some things the reader suggested were left out because they could not be found on the page.')).toBeTruthy()
    expect(within(details).getByText('Read with 92% confidence. Check it against the document.')).toBeTruthy()
    expect(within(read).getAllByText(/confidence/)).toHaveLength(1)
    expect(within(read).getByText('No name or date of birth on the paper. Make sure this is the right patient.')).toBeTruthy()
    expect(within(read).queryByText(/Not found/)).toBeNull()
    // Above who the paper is about and the items.
    const items = within(read).getByRole('region', { name: 'Medicines' })
    expect(warning.compareDocumentPosition(within(read).getByText('Who the paper is about')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(warning.compareDocumentPosition(items) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const code of ['many_dropped', 'possible_missed_item']) expect(read.textContent).not.toContain(code)
  })

  it('says plainly when the items could not be picked out, and still shows the text', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: unreadPaper('ai_failed') }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('The items couldn’t be picked out automatically. Enter them by hand.')).toBeTruthy()
    expect(within(read).queryByText(/items read/)).toBeNull()
    expect(within(read).getByRole('region', { name: 'Text read from the document' }).textContent).toBe('Haemoglobin 12.1')
    expect(document.body.textContent).not.toContain('ai_failed')
  })

  it('shows only the text when a paper reading is not whole, and never breaks the page', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: paperReading({ items: [{ kind: 'medicine' }] }) }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).queryByText('Who the paper is about')).toBeNull()
    expect(within(read).queryByText('Contract')).toBeNull()
    expect(within(read).queryByText('Items')).toBeNull()
    expect(within(read).getByRole('note').textContent).toBe('The items couldn’t be picked out automatically. Enter them by hand.')
    expect(within(read).getByRole('region', { name: 'Text read from the document' }).textContent).toBe('Haemoglobin 12.1')
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Check and save', 'Reject reading'])
  })

  it('keeps showing named fields for an extraction that is not a paper reading', async () => {
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('Full blood count')).toBeTruthy()
    expect(within(read).queryByRole('note')).toBeNull()
    expect(within(read).queryByText('Who the paper is about')).toBeNull()
  })
})

describe('Migrate: checking what was read, item by item, with no JSON on screen', () => {
  const VISIT = 'c0000000-0000-4000-8000-000000000001'
  const form = () => screen.getByRole('form', { name: 'Check and save' })
  const save = () => within(form()).getByRole('button', { name: 'Save' })
  const optionsOf = (control: HTMLElement) => Array.from(control.querySelectorAll('option')).map(option => option.textContent)
  const withReading = (payload: object = paperReading()) =>
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, rawText: 'Amlodipine 5mg od', structuredPayload: payload }] })

  it('shows each item as a card: one line as written, a Check mark with Why? when to check, careful ones first and undecided', async () => {
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    const shown = cards()
    expect(shown).toHaveLength(7)
    expect(shown.map(card => card.querySelector('strong')?.textContent)).toEqual(['Metf?rmin 500 bd', 'Allergic to penicillin - rash',
      'Amlodipine 5mg od x 30/7', 'HTN', 'Hb 11.2 g/dL', 'BP 150/95', 'Review in 2 weeks'])
    const [metformin] = shown
    // Each card is named by its reading.
    expect(metformin!.getAttribute('aria-labelledby')).toBe(metformin!.querySelector('strong')?.id)
    expect(within(metformin!).getByText('Check')).toBeTruthy()
    const why = within(metformin!).getByText('Why?').closest('details')!
    expect(why.open).toBe(false)
    expect(within(why).getByText('The handwriting was hard to read.')).toBeTruthy()
    // "Not chosen yet" and "Kept" repeat what the buttons show, so only a screen reader hears them.
    expect(within(metformin!).getByText('Not chosen yet').className).toBe('hid-ehr-sr-only')
    expect(within(shown[2]!).getByText('Kept').className).toBe('hid-ehr-sr-only')
    expect(within(shown[2]!).queryByText('Check')).toBeNull()
    expect(within(shown[2]!).queryByText('Why?')).toBeNull()
    expect(form().textContent).not.toMatch(/On the paper|Page 1|Check carefully|Clear/)
    expect(within(shown[2]!).getByRole('button', { name: 'Keep' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(form()).getByRole('note').textContent).toBe('2 items need your choice before you can save.')
    // No JSON anywhere: no box to type it in, no braces, no field named after it.
    expect(document.body.textContent).not.toMatch(/JSON|[{}[\]]/)
    expect(form().querySelectorAll('textarea')).toHaveLength(1)
    expect(screen.queryByLabelText('Reading')).toBeNull()
  })

  it('shows a hard handwritten page with no reader\'s "?", and Keep saves the clean reading it shows', async () => {
    withReading(hardHandwrittenPage())
    await findJob(awaiting)
    await openAction('Check and save')
    const shown = cards()
    expect(shown).toHaveLength(7)
    // Unsure words are dotted and said as "not sure"; parts that couldn't be read are grey words; crossed-out words struck through.
    expect(shown.map(card => card.querySelector('strong')?.textContent)).toEqual([
      'IV (not sure) Ampiclox (not sure) 500mg (not sure) 8hrly (not sure)',
      'IV (not sure) Gentamicin (not sure) 80mg (not sure) crossed out: Ceftriaxone 1g 12hrly (not sure)',
      'IV (not sure) Omeprazole (not sure) 40mg (not sure) daily (not sure)',
      'Dc Gentamicin (not sure) — Stopped',
      'Paracetamol 1g frequency couldn’t be read ? on paper',
      'Admit (not sure)',
      '21/8 (not sure) word couldn’t be read - Transfer to the ward',
    ])
    expect(shown[0]!.querySelector('.hid-ehr-dept-migrate-unsure')?.getAttribute('title')).toBe('not sure')
    expect(shown[1]!.querySelector('s')?.textContent).toBe('crossed out: Ceftriaxone 1g')
    // Each card keeps its Check mark; other readings and the cut-off word wait under its closed Why?.
    for (const card of shown) expect(within(card).getByText('Check')).toBeTruthy()
    const why = within(shown[2]!).getByText('Why?').closest('details')!
    expect(why.open).toBe(false)
    expect(within(why).getByText('Other possible reading: Quinine')).toBeTruthy()
    expect(within(within(shown[0]!).getByText('Why?').closest('details')!).getByText('Written as: Am…')).toBeTruthy()
    // What Keep saves is said in the same clean words, only where it differs from the line.
    expect(within(shown[1]!).getByText('Keep saves: Gentamicin 80mg 12hrly')).toBeTruthy()
    expect(within(shown[3]!).getByText('Keep saves: Dc Gentamicin (stopped)')).toBeTruthy()
    expect(within(shown[0]!).queryByText(/^Keep saves/)).toBeNull()
    expect(within(form()).queryAllByText(/^Keep saves/).map(line => line.textContent).join(' ')).not.toContain('?')
    // Outside Why? and words said only to a screen reader, the one "?" left is the one written on the paper.
    const seen = shown.map(card => {
      const copy = card.querySelector('strong')!.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.hid-ehr-sr-only').forEach(hidden => hidden.remove())
      return copy.textContent
    }).join(' ')
    expect(seen.match(/\?/g)).toHaveLength(1)
    for (const card of shown) await press(within(card).getByRole('button', { name: 'Keep' }))
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(save())
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const input = api.validateOcrJob.mock.calls[0]![2]
    expect((input.acceptedFields.items as Array<{ reading: string }>).map(item => item.reading)).toEqual([
      'IV Ampiclox 500mg 8hrly', 'Gentamicin 80mg 12hrly', 'IV Omeprazole 40mg daily', 'Dc Gentamicin (stopped)', 'Paracetamol 1g (? on paper)',
      'Admit', '21/8 - Transfer to the ward',
    ])
    expect(input.corrections).toEqual([])
  })

  it('Keep, Change and Remove become what OCR is sent: accepted, corrected and rejected', async () => {
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    const [metformin, allergy] = cards()
    await press(within(metformin!).getByRole('button', { name: 'Change' }))
    const typed = within(metformin!).getByLabelText('What the paper says') as HTMLInputElement
    expect(typed.value).toBe('Metformin 500 mg twice a day')
    fireEvent.change(typed, { target: { value: 'Metformin 850 mg twice a day' } })
    await press(within(allergy!).getByRole('button', { name: 'Remove' }))
    expect(within(allergy!).getByText('Removed: it won’t be saved')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(save())
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const input = api.validateOcrJob.mock.calls[0]![2]
    expect(input).toMatchObject({ targetDomain: 'DOCUMENT_ONLY', candidateType: 'document_only', reason: 'Checked against the paper record',
      corrections: [{ itemId: 'it-00000000000000a2', field: 'reading', oldValue: 'Metformin 500 mg twice a day', newValue: 'Metformin 850 mg twice a day' }],
      rejectedFields: [{ itemId: 'it-00000000000000c1', reading: 'Penicillin allergy', decision: 'removed' }] })
    expect(input.acceptedFields.items).toHaveLength(6)
    expect(input.validatedPayload.items).toEqual(input.acceptedFields.items)
  })

  it.each([
    ['a paper of two medicines, with the patient\'s visits readable', paperReading(), ['ehr.encounter.read'], ['Keep the document only', 'Clinical note', 'Past lab results', 'Past medicines']],
    ['a paper of two medicines, without', paperReading(), [], ['Keep the document only', 'Past lab results', 'Past medicines']],
    ['a paper of one medicine', handwrittenPage(), [], ['Keep the document only', 'Past medicines']],
  ])('offers Save as in plain words for %s', async (_, payload, extra, offered) => {
    session.permissions = [...ALL, ...extra]
    withReading(payload)
    await findJob(awaiting)
    await openAction('Check and save')
    expect(optionsOf(screen.getByLabelText('Save as'))).toEqual(offered)
  })

  it('a clinical note asks for the visit to attach it to, and sends it with the kept items as the note', async () => {
    session.permissions = [...ALL, 'ehr.encounter.read']
    api.encounters.mockResolvedValue({ items: [{ id: VISIT, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'ambulatory', status: 'finished',
      startedAt: '2026-03-02T09:00:00.000Z', chiefComplaint: 'Blood pressure review', rowVersion: 1 }], nextCursor: null })
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    for (const card of cards().slice(0, 2)) await press(within(card).getByRole('button', { name: 'Keep' }))
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'EHR' } })
    const visit = await screen.findByLabelText(/^Visit to attach the note to/)
    expect(api.encounters).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, PATIENT)
    expect(optionsOf(visit)[1]).toMatch(/^Outpatient visit · .+ · Blood pressure review$/)
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    await press(save())
    await waitFor(() => expect(focused()).toBe(visit))
    expect(descriptions(visit)[0]).toBe('Choose the visit to attach this note to.')
    fireEvent.change(visit, { target: { value: VISIT } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(save())
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ targetDomain: 'EHR', candidateType: 'clinical_note',
      acceptedFields: { encounterId: VISIT, noteType: 'Paper record', title: 'From a paper record', content: expect.stringContaining('- Amlodipine 5 mg once a day (page 1)') } })
  })

  it('Change on a lab result asks for the test and the result, and sends the typed test name', async () => {
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    for (const card of cards().slice(0, 2)) await press(within(card).getByRole('button', { name: 'Keep' }))
    const haemoglobin = cards()[4]!
    await press(within(haemoglobin).getByRole('button', { name: 'Change' }))
    expect(within(haemoglobin).queryByLabelText('What the paper says')).toBeNull()
    const test = within(haemoglobin).getByLabelText('Test') as HTMLInputElement
    const result = within(haemoglobin).getByLabelText('Result') as HTMLInputElement
    expect([test.value, result.value]).toEqual(['Haemoglobin', '11.2 g/dL'])
    fireEvent.change(test, { target: { value: 'Haematocrit' } })
    fireEvent.change(result, { target: { value: '34 %' } })
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'LAB' } })
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(save())
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const input = api.validateOcrJob.mock.calls[0]![2]
    expect(input.acceptedFields.observations).toEqual([{ testName: 'Haematocrit', valueText: '34 %', page: 2, itemId: 'it-00000000000000d1', reportedAtAsWritten: '01/03/2025' }])
    expect(input.corrections.map((item: { field: string }) => item.field)).toEqual(['test', 'result'])
  })

  it('past medicines sends every medicine kept, each its own entry, and says plainly when more than 50 are kept', async () => {
    withReading(medicinesPaper(51))
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'PHARMACY' } })
    expect(within(form()).getByRole('note').textContent).toBe('Only 50 medicines can be added at once. The first 50 on the paper are added. The rest stay with the document; add them in a clinical note.')
    await press(within(cards()[0]!).getByRole('button', { name: 'Remove' }))
    expect(within(form()).queryByRole('note')).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(save())
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const input = api.validateOcrJob.mock.calls[0]![2]
    expect(input).toMatchObject({ targetDomain: 'PHARMACY', candidateType: 'historical_medication_evidence' })
    expect(input.acceptedFields.medications).toHaveLength(50)
    expect(input.acceptedFields.medications[0]).toEqual({ itemId: 'it-0000000000000b01', page: 1, medicationText: 'Testamol 2', strengthText: '10 mg',
      frequencyText: 'once a day', historicalContext: 'From a paper record, page 1. As written: Testamol 2 10mg od' })
    expect(input.acceptedFields).not.toHaveProperty('medicationText')
  })

  it('offers only visits at this facility that still take a note, and reads older visits on request', async () => {
    session.permissions = [...ALL, 'ehr.encounter.read']
    const visit = (id: string, status: string, chiefComplaint: string, facilityId = DEMO_HOSPITAL_ID) => ({ id, patientId: PATIENT, facilityId,
      encounterType: 'ambulatory', status, startedAt: '2026-03-02T09:00:00.000Z', chiefComplaint, rowVersion: 1 })
    api.encounters.mockResolvedValueOnce({ items: [visit(VISIT, 'in_progress', 'Open visit'), visit('c0000000-0000-4000-8000-000000000002', 'cancelled', 'Cancelled visit'),
      visit('c0000000-0000-4000-8000-000000000003', 'entered_in_error', 'Wrong visit'),
      visit('c0000000-0000-4000-8000-000000000004', 'completed', 'Elsewhere', DEMO_LABORATORY_ID)], nextCursor: 'cursor-2' })
    api.encounters.mockResolvedValueOnce({ items: [visit('c0000000-0000-4000-8000-000000000005', 'completed', 'Older visit')], nextCursor: null })
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'EHR' } })
    const picker = await screen.findByLabelText(/^Visit to attach the note to/)
    expect(optionsOf(picker).slice(1).map(text => text?.split(' · ').at(-1))).toEqual(['Open visit'])
    await press(within(form()).getByRole('button', { name: 'Show older visits' }))
    await waitFor(() => expect(optionsOf(screen.getByLabelText(/^Visit to attach the note to/)).slice(1).map(text => text?.split(' · ').at(-1)))
      .toEqual(['Open visit', 'Older visit']))
    expect(api.encounters).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, PATIENT, { cursor: 'cursor-2' })
    expect(within(form()).queryByRole('button', { name: 'Show older visits' })).toBeNull()
  })

  it('says the patient has no visits when every visit is cancelled', async () => {
    session.permissions = [...ALL, 'ehr.encounter.read']
    api.encounters.mockResolvedValue({ items: [{ id: VISIT, patientId: PATIENT, facilityId: DEMO_HOSPITAL_ID, encounterType: 'ambulatory', status: 'cancelled',
      startedAt: '2026-03-02T09:00:00.000Z', chiefComplaint: 'Cancelled visit', rowVersion: 1 }], nextCursor: null })
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'EHR' } })
    expect(await within(form()).findByText('This patient has no visits yet, so a clinical note can’t be attached. Choose another way to save it.')).toBeTruthy()
    expect(screen.queryByLabelText(/^Visit to attach the note to/)).toBeNull()
  })

  it('a reading with no items offers only Keep the document only and Reject, without a Save as choice', async () => {
    withReading(unreadPaper('ai_failed'))
    await findJob(awaiting)
    await openAction('Check and save')
    expect(cards()).toHaveLength(0)
    expect(screen.queryByLabelText('Save as')).toBeNull()
    expect(within(form()).getByText('Keep the document only')).toBeTruthy()
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toContain('Reject reading')
  })

  it('names readings plainly when there are several, and checks the newest first', async () => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, id: 'extraction-1', version: 1 },
      { ...extraction, id: 'extraction-2', version: 2, structuredPayload: paperReading() }] })
    await findJob(awaiting)
    await openAction('Check and save')
    const reading = screen.getByLabelText('Reading') as HTMLSelectElement
    expect(optionsOf(reading)).toEqual(['Reading 1 of 2', 'Reading 2 of 2 (newest)'])
    expect(reading.value).toBe('extraction-2')
    expect(cards()).toHaveLength(7)
    fireEvent.change(reading, { target: { value: 'extraction-1' } })
    expect(cards()).toHaveLength(0)
  })

  it.each([
    ['an account that may read but not save a check', new HidApiError(403, 'Forbidden', { code: 'OCR_ACCESS_DENIED' }), REVIEW_NOT_ALLOWED],
    ['items OCR refuses for the domain', new HidApiError(400, 'Validated Lab candidate requires bounded imported observations', { code: 'OCR_INVALID_LAB_EVIDENCE' }),
      'This couldn’t be saved as past lab results. Check the items you kept, or choose Keep the document only.'],
  ])('says plainly when OCR refuses %s, never its code or words', async (_, refusal, words) => {
    withReading()
    await findJob(awaiting)
    await openAction('Check and save')
    for (const card of cards().slice(0, 2)) await press(within(card).getByRole('button', { name: 'Keep' }))
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'LAB' } })
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockRejectedValue(refusal)
    await press(save())
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(document.body.textContent).not.toMatch(/OCR_|Forbidden|bounded imported/)
  })
})

describe('Migrate: a handwritten page with lines that couldn’t be read, shown clean', () => {
  const readSection = async () => (await screen.findByRole('heading', { name: 'What was read' })).closest('section') as HTMLElement
  const form = () => screen.getByRole('form', { name: 'Check and save' })
  beforeEach(() => {
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, confidence: 0.31, rawText: 'Ceftriaxone ? IV', structuredPayload: unreadablePage() }] })
  })

  it('reads in seconds: one status line, one line per item read, one line for what couldn’t be read, no card for it', async () => {
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('Hard handwriting. Check the marked items.')).toBeTruthy()
    expect(within(read).getByText('Details').closest('details')!.open).toBe(false)
    expect(within(read).getByText('1 item read · 1 to check')).toBeTruthy()
    expect(within(read).getByText('No name or date of birth on the paper. Make sure this is the right patient.')).toBeTruthy()
    const medicines = within(within(read).getByRole('region', { name: 'Medicines' }))
    expect(medicines.getAllByRole('listitem').map(row => row.querySelector('strong')?.textContent)).toEqual(['Ceftriaxone ? IV'])
    expect(medicines.getByText('5 lines couldn’t be read. Check the paper.')).toBeTruthy()
    const notes = within(within(read).getByRole('region', { name: 'Notes' }))
    expect(notes.queryAllByRole('listitem')).toHaveLength(0)
    expect(notes.getByText('4 lines couldn’t be read. Check the paper.')).toBeTruthy()
    // Outside the closed Details and the scrolling text: no "[unreadable]", no long sentence, no "As written".
    const shown = read.cloneNode(true) as HTMLElement
    for (const hidden of shown.querySelectorAll('details, pre')) hidden.remove()
    expect(shown.textContent).not.toMatch(/\[unreadable\]|As written|Not found|Possibly ceftriaxone|confidence|Why:/i)
  })

  it('checks only the line that was read, and saves the unreadable lines as removed, never kept', async () => {
    await findJob(awaiting)
    await openAction('Check and save')
    const shown = cards()
    expect(shown.map(card => card.querySelector('strong')?.textContent)).toEqual(['Ceftriaxone ? IV'])
    // What Keep saves is not the line as written, so the card shows it: nothing is saved that wasn't seen.
    expect(within(shown[0]!).getByText('Keep saves: Possibly ceftriaxone IV; dose and frequency unreadable')).toBeTruthy()
    expect(within(form()).getByText('9 lines couldn’t be read. Check the paper.')).toBeTruthy()
    expect(within(form()).getByRole('note').textContent).toBe('1 item needs your choice before you can save.')
    await press(within(shown[0]!).getByRole('button', { name: 'Keep' }))
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'PHARMACY' } })
    fireEvent.change(screen.getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
    api.findOcrJob.mockResolvedValue({ job: validated })
    await press(within(form()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const input = api.validateOcrJob.mock.calls[0]![2]
    expect(input.acceptedFields.items.map((item: { itemId: string }) => item.itemId)).toEqual(['it-00000000000000a3'])
    expect(input.acceptedFields.medications.map((entry: { itemId: string }) => entry.itemId)).toEqual(['it-00000000000000a3'])
    expect(input.rejectedFields).toHaveLength(9)
    expect(input.rejectedFields.every((field: { decision: string }) => field.decision === 'removed')).toBe(true)
    // What was saved is what the card showed.
    const savedText = input.acceptedFields.medications[0].medicationText as string
    expect(input.acceptedFields.items[0].reading).toBe(savedText)
    expect(shown[0]!.textContent).toContain(savedText)
  })

  it('a page where no line could be read has no cards: it says so and offers the document only', async () => {
    const page = unreadablePage()
    api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, structuredPayload: { ...page, items: page.items.slice(1),
      reading: { ...page.reading, itemCount: page.items.length - 1 } } }] })
    await findJob(awaiting)
    const read = await readSection()
    expect(within(read).getByText('0 items read')).toBeTruthy()
    await openAction('Check and save')
    expect(cards()).toHaveLength(0)
    expect(within(form()).getByText('No items were picked out to check one by one. You can keep the document only, or reject this reading.')).toBeTruthy()
    expect(within(form()).getByText('9 lines couldn’t be read. Check the paper.')).toBeTruthy()
    expect(within(form()).queryByRole('note')).toBeNull()
    expect(within(form()).queryByLabelText('Save as')).toBeNull()
  })
})

describe('Migrate: Read again', () => {
  const newer = { ...queued, id: 'j0000000-0000-4000-8000-000000000002', version: 1 }
  const readAgain = () => within(screen.getByRole('heading', { name: 'What was read' }).closest('section') as HTMLElement).getByRole('button', { name: 'Read again' })

  it('is offered on a reading OCR has finished, to an account that may send documents for reading, beside what was read', async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    expect(readAgain()).toBeTruthy()
    // The actions card keeps its own buttons.
    expect(within(actionsCard()).getAllByRole('button').map(control => control.textContent)).toEqual(['Refresh status', 'Check and save', 'Reject reading'])
  })

  it.each([['validated', validated], ['confirmed for the patient', confirmed]])(
    'is not offered once the reading is checked (%s), so it is never saved into the record twice', async (_, job) => {
      await findJob(job)
      await screen.findByRole('heading', { name: 'What was read' })
      expect(screen.queryByRole('button', { name: 'Read again' })).toBeNull()
    })

  it.each([['failed', failed], ['rejected', rejected]])('is offered on a reading that %s, as nothing of it was saved', async (_, job) => {
    api.ocrExtractions.mockResolvedValue({ items: [extraction] })
    await findJob(job)
    await screen.findByRole('heading', { name: 'What was read' })
    expect(readAgain()).toBeTruthy()
  })

  it('says the new reading is ready when OCR answers with another job that is already read', async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    api.createOcrJob.mockResolvedValue({ ...awaiting, id: newer.id })
    await press(readAgain())
    await waitFor(() => expect(statusRegion().textContent).toBe('The document has been read and is ready to check.'))
    expect(api.ocrExtractions).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, newer.id)
  })

  it('is not offered without OCR job write, nor while the document is still being read', async () => {
    session.permissions = ['ocr.job.read']
    const { unmount } = await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    expect(screen.queryByRole('button', { name: 'Read again' })).toBeNull()
    unmount()
    session.permissions = ALL
    await findJob({ ...queued, status: 'processing' })
    await screen.findByRole('heading', { name: 'What was read' })
    expect(screen.queryByRole('button', { name: 'Read again' })).toBeNull()
  })

  it('sends the document for reading again with a fresh key, shows the new job, says so and reads it again by itself', async () => withFakeTimers(async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    api.createOcrJob.mockResolvedValue(newer)
    api.ocrExtractions.mockResolvedValue({ items: [] })
    await press(readAgain())
    await waitFor(() => expect(statusRegion().textContent).toBe('Reading the document again. This page updates by itself when it’s ready.'))
    expect(api.createOcrJob).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, DOCUMENT, PATIENT, expect.stringMatching(/^[0-9a-f-]{36}$/))
    expect(api.findOcrJob).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(focused()).toBe(heading('Saved record')))
    expect(screen.getAllByText('Waiting to be read').length).toBeGreaterThan(0)
    expect(api.ocrExtractions).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, newer.id)
    // The new job is read again by itself, as after Create.
    api.findOcrJob.mockResolvedValue({ job: { ...newer, status: 'awaiting_validation', version: 2 } })
    await wait(5_000)
    expect(api.findOcrJob).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(statusRegion().textContent).toBe('The document has been read and is ready to check.'))
  }))

  it('says when this is already the newest reading, and shows nothing new', async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    api.createOcrJob.mockResolvedValue(awaiting)
    const control = readAgain()
    await press(control)
    await waitFor(() => expect(statusRegion().textContent).toBe('This is already the newest reading.'))
    expect(api.ocrExtractions).toHaveBeenCalledTimes(1)
    expect(focused()).toBe(control)
  })

  it('a press after an answer that was lost sends the same key; the next press after an answer takes a new one', async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    api.createOcrJob.mockRejectedValueOnce(unavailable())
    await press(readAgain())
    expect((await screen.findByRole('alert')).textContent).not.toMatch(/SERVICE_UNAVAILABLE/)
    await waitFor(() => expect(focused()).toBe(readAgain()))
    api.createOcrJob.mockResolvedValue(awaiting)
    await press(readAgain())
    await waitFor(() => expect(statusRegion().textContent).toBe('This is already the newest reading.'))
    await press(readAgain())
    await waitFor(() => expect(api.createOcrJob).toHaveBeenCalledTimes(3))
    const keys = api.createOcrJob.mock.calls.map(call => call[3])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[1])
  })

  it('says plainly when the patient’s OK is needed, in the record', async () => {
    await findJob(awaiting)
    await screen.findByRole('heading', { name: 'What was read' })
    api.createOcrJob.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'OCR_RECORDS_PROCESSING_CONSENT_REQUIRED' }))
    await press(readAgain())
    expect((await screen.findByRole('alert')).textContent).toBe(STAFF_PAPER_NEEDS_ACCESS)
    expect(heading('Saved record')).toBeTruthy()
  })
})
