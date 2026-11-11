import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { forgetReviewLearningServed, reviewLearningServed } from '../../../../readingLearningServed'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { paperReading } from './paperReadingPayload'

/**
 * Migrate learning, phase 1, on the page: dormant until the extractions answer says the backend takes it, then the
 * reasons, the medicine form, page ticks, missed counts, seen items and a rejection's reason code. Fictional data only.
 */
const api = vi.hoisted(() => ({
  findOcrJob: vi.fn(), ocrExtractions: vi.fn(), ocrValidations: vi.fn(), ocrPublications: vi.fn(),
  createOcrJob: vi.fn(), retryOcrJob: vi.fn(), validateOcrJob: vi.fn(), confirmOcrPatient: vi.fn(), publishOcrValidation: vi.fn(),
  labImport: vi.fn(), pharmacyImport: vi.fn(), encounters: vi.fn(), lookupPatient: vi.fn(), documents: vi.fn(), consentStatus: vi.fn(),
}))
const session = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../../../../staff/api', () => ({ staffApi: api,
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: object }) => lookup.authorization.decision === 'allow' && !!lookup.patient }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => {
      const context = staffContext(fakeFacility(session.permissions, { id: '98d00002-0000-4000-8000-000000000001', name: 'Demo Hospital' }))
      return { ...context, lock: null, activePatient: null, setActivePatient: () => {},
        state: { ...context.state, session: { actor: { ...context.state.session.actor, id: 'staff-demo-1' } } } }
    },
  }
})

const ALL = ['ocr.job.read', 'ocr.job.write', 'ocr.validation.write', 'ocr.patient.confirm', 'ocr.publication.write']
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const DOCUMENT = 'd0000000-0000-4000-8000-000000000001'
const awaiting = { id: 'j0000000-0000-4000-8000-000000000001', documentId: DOCUMENT, patientId: PATIENT, provider: 'textract', version: 3,
  attemptCount: 1, maxAttempts: 3, patientConfirmation: null, status: 'awaiting_validation' }
const extraction = { id: 'extraction-1', jobId: awaiting.id, version: 1, provider: 'textract', confidence: 0.92, rawText: 'Amlodipine 5mg od',
  structuredPayload: paperReading(), createdAt: '2026-10-12T09:00:00.000Z' }
const METFORMIN = 'it-00000000000000a2'

/** An IntersectionObserver the test drives: `show(element)` puts a card on screen. */
const observed = new Map<Element, IntersectionObserverCallback>()
class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(element: Element) { observed.set(element, this.callback) }
  disconnect() { for (const [element, callback] of observed) if (callback === this.callback) observed.delete(element) }
  unobserve() {}
  takeRecords() { return [] }
}
function show(element: Element) {
  const callback = observed.get(element)
  act(() => { callback?.([{ isIntersecting: true, target: element } as unknown as IntersectionObserverEntry], {} as IntersectionObserver) })
}

beforeEach(() => {
  vi.clearAllMocks()
  forgetReviewLearningServed()
  observed.clear()
  session.permissions = ALL
  api.ocrValidations.mockResolvedValue({ items: [] })
  api.ocrPublications.mockResolvedValue({ items: [] })
  api.validateOcrJob.mockResolvedValue({ id: 'validation-1' })
})
afterEach(() => { vi.unstubAllGlobals() })

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/** Opens Patient One's document's reading, the extractions answering with or without the backend's flag. */
async function openReading(served: boolean) {
  api.ocrExtractions.mockResolvedValue({ items: [extraction], ...(served ? { reviewLearning: true } : {}) })
  api.findOcrJob.mockResolvedValue({ job: awaiting })
  renderDept(<Migrate />)
  fireEvent.change(screen.getByLabelText(/^Document ID/), { target: { value: DOCUMENT } })
  await press(screen.getByRole('button', { name: 'Find job' }))
  await screen.findByRole('heading', { name: 'Progress' })
  return within(await screen.findByRole('form', { name: 'Check and save' }))
}

const form = () => within(screen.getByRole('form', { name: 'Check and save' }))
const card = (itemId: string) => document.querySelector(`[data-item-id="${itemId}"] > [role="group"]`) as HTMLElement
const focused = () => document.activeElement

async function keepAll() {
  for (const group of Array.from(document.querySelectorAll('[data-item-id] > [role="group"]'))) {
    const keep = within(group as HTMLElement).getByRole('button', { name: 'Keep' })
    if (keep.getAttribute('aria-pressed') !== 'true') await press(keep)
  }
}

async function save() {
  fireEvent.change(form().getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
  await press(form().getByRole('button', { name: 'Save' }))
}

describe('Migrate learning, dormant', () => {
  it('without the backend’s flag: no reasons, ticks or counts, and today’s review is sent', async () => {
    await openReading(false)
    expect(reviewLearningServed()).toBeNull()
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    expect(screen.queryByLabelText(/Why remove it/)).toBeNull()
    expect(screen.queryByText('Pages you’ve checked')).toBeNull()
    expect(screen.queryByText('The reading missed a…')).toBeNull()
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('What the paper says')).toBeTruthy()
    expect(screen.queryByLabelText(/Medicine name/)).toBeNull()
    await save()
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as Record<string, unknown>
    expect(sent).not.toHaveProperty('learning')
    expect((sent.rejectedFields as Array<Record<string, unknown>>)[0]).not.toHaveProperty('removalReason')
  })

  it('without the flag, Reject reading is its reason alone', async () => {
    await openReading(false)
    const details = document.getElementById('ocr-details') as HTMLDetailsElement
    await act(async () => { fireEvent.click(within(details).getByText('Details')) })
    await press(within(details).getByRole('button', { name: 'Reject reading' }))
    expect(screen.getByRole('form', { name: 'Reject reading' }).querySelectorAll('textarea, input, select')).toHaveLength(1)
  })
})

describe('Migrate learning, served', () => {
  it('asks why an item is removed, with focus at the reason, and sends the reason chosen', async () => {
    await openReading(true)
    expect(reviewLearningServed()).toBe(true)
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    const why = screen.getByLabelText(/Why remove it/) as HTMLSelectElement
    expect(Array.from(why.options).map(option => option.textContent)).toEqual(['Choose a reason', 'Not on the paper', 'Written twice',
      'Not needed', 'Can’t read it', 'Belongs to another patient'])
    await save()
    await waitFor(() => expect(focused()).toBe(why))
    expect(document.getElementById(why.getAttribute('aria-describedby')!.split(' ')[0]!)?.textContent).toBe('Choose why you’re removing it.')
    expect(api.validateOcrJob).not.toHaveBeenCalled()
    fireEvent.change(why, { target: { value: 'written_twice' } })
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as { rejectedFields: Array<Record<string, unknown>> }
    expect(sent.rejectedFields).toEqual([expect.objectContaining({ itemId: 'it-00000000000000c1', removalReason: 'written_twice' })])
  })

  it('changes a medicine on its own form, asking why first', async () => {
    await openReading(true)
    await keepAll()
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    const why = screen.getByLabelText(/Why change it/) as HTMLSelectElement
    expect(Array.from(why.options).map(option => option.textContent)).toEqual(['Choose a reason', 'AI misread the paper', 'Paper out of date'])
    expect(screen.queryByLabelText('What the paper says')).toBeNull()
    expect((screen.getByLabelText(/Medicine name/) as HTMLInputElement).value).toBe('Metformin')
    expect((screen.getByLabelText(/^Strength/) as HTMLInputElement).value).toBe('500 mg')
    expect((screen.getByLabelText(/^Dose/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^How often/) as HTMLInputElement).value).toBe('twice a day')
    fireEvent.change(screen.getByLabelText(/Medicine name/), { target: { value: '' } })
    await save()
    await waitFor(() => expect(focused()).toBe(why))
    fireEvent.change(why, { target: { value: 'ai_misread' } })
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(focused()).toBe(screen.getByLabelText(/Medicine name/)))
    fireEvent.change(screen.getByLabelText(/Medicine name/), { target: { value: 'Metformin' } })
    fireEvent.change(screen.getByLabelText(/^Strength/), { target: { value: '850 mg' } })
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'PHARMACY' } })
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as { acceptedFields: { medications: Array<Record<string, unknown>> }; corrections: unknown[] }
    expect(sent.acceptedFields.medications.find(entry => entry.itemId === METFORMIN)).toMatchObject({ medicationText: 'Metformin',
      strengthText: '850 mg', frequencyText: 'twice a day' })
    expect(sent.corrections).toEqual([expect.objectContaining({ field: 'strengthText', newValue: '850 mg', changeReason: 'ai_misread' })])
  })

  it('ticks pages, counts what was missed, and sends the cards seen on screen or touched', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openReading(true)
    const pages = within(screen.getByRole('group', { name: 'Pages you’ve checked' }))
    expect(pages.getAllByRole('checkbox').map(box => box.closest('label')?.textContent)).toEqual([
      'I’ve checked page 1 · 3 items read from it', 'I’ve checked page 2 · 4 items read from it'])
    await press(pages.getByRole('checkbox', { name: /I’ve checked page 2/ }))
    const missed = within(screen.getByRole('group', { name: 'The reading missed a…' }))
    fireEvent.change(missed.getByLabelText('Medicine'), { target: { value: '1' } })
    fireEvent.change(missed.getByLabelText('Lab result'), { target: { value: 'x' } })
    show(card('it-00000000000000d1'))
    await keepAll()
    await save()
    const labBox = missed.getByLabelText('Lab result')
    await waitFor(() => expect(focused()).toBe(labBox))
    expect(labBox.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(labBox, { target: { value: '' } })
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as { learning: { itemsSeen: string[]; pagesChecked: number[]; missedItems: object } }
    expect(sent.learning.pagesChecked).toEqual([2])
    expect(sent.learning.missedItems).toEqual({ medicine: 1, allergy: 0, diagnosis: 0, lab_result: 0, other: 0 })
    // The lab result was on screen; the two medicines to check were pressed; nothing else was seen.
    expect(new Set(sent.learning.itemsSeen)).toEqual(new Set(['it-00000000000000d1', 'it-00000000000000a2', 'it-00000000000000c1']))
  })

  it('Reject reading asks what is wrong, with focus there, then sends its code', async () => {
    await openReading(true)
    const details = document.getElementById('ocr-details') as HTMLDetailsElement
    await act(async () => { fireEvent.click(within(details).getByText('Details')) })
    await press(within(details).getByRole('button', { name: 'Reject reading' }))
    const reject = within(screen.getByRole('form', { name: 'Reject reading' }))
    const what = reject.getByLabelText(/What’s wrong with it/) as HTMLSelectElement
    expect(Array.from(what.options).map(option => option.textContent)).toEqual(['Choose a reason', 'Wrong patient', 'Not a medical record',
      'Can’t be read', 'Same document twice', 'Something else'])
    fireEvent.change(reject.getByLabelText(/^Why you’re/), { target: { value: 'This is Patient One’s sister’s card' } })
    await press(reject.getByRole('button', { name: 'Reject reading' }))
    await waitFor(() => expect(focused()).toBe(what))
    expect(api.validateOcrJob).not.toHaveBeenCalled()
    fireEvent.change(what, { target: { value: 'wrong_patient' } })
    await press(reject.getByRole('button', { name: 'Reject reading' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![0]).toBe(DEMO_HOSPITAL_ID)
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ disposition: 'rejected', learning: { rejectionReason: 'wrong_patient' } })
  })

  it('shows no code, value or ID on screen', async () => {
    await openReading(true)
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    const text = screen.getByRole('form', { name: 'Check and save' }).textContent ?? ''
    expect(text).not.toMatch(/not_on_paper|ai_misread|lab_result|it-0|reviewLearning|missedItems/)
  })
})
