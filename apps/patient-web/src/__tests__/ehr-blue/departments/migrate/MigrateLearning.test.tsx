import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Migrate } from '../../../../ehr-blue/departments/migrate/Migrate'
import { forgetReviewLearningServed, reviewLearningServed } from '../../../../readingLearningServed'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { paperReading } from './paperReadingPayload'

/**
 * Migrate learning, phase 1, on the page: dormant until an extraction says the backend takes it (reviewLearning: true),
 * then the optional one-tap reasons, the medicine form, the one optional missed box, seen items and a rejection's
 * optional reason. Owner decision Q43: nothing is ever required, and there is no page tick. Fictional data only.
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

/**
 * An IntersectionObserver the test drives: `show(element)` puts all of a card on screen; `show(element, part)` only that
 * part of it, filling `screenShare` of the screen (a card taller than the screen).
 */
const observed = new Map<Element, IntersectionObserverCallback>()
class FakeObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(element: Element) { observed.set(element, this.callback) }
  disconnect() { for (const [element, callback] of observed) if (callback === this.callback) observed.delete(element) }
  unobserve() {}
  takeRecords() { return [] }
}
function show(element: Element, part = 1, screenShare = 0.4) {
  const callback = observed.get(element)
  act(() => { callback?.([{ isIntersecting: true, target: element, intersectionRatio: part, intersectionRect: { height: 800 * screenShare },
    rootBounds: { height: 800 } } as unknown as IntersectionObserverEntry], {} as IntersectionObserver) })
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

/** Opens Patient One's document's reading, its extraction carrying the backend's flag or not. */
async function openReading(served: boolean) {
  api.ocrExtractions.mockResolvedValue({ items: [{ ...extraction, ...(served ? { reviewLearning: true } : {}) }] })
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
    expect(screen.queryByRole('group', { name: 'Why remove it?' })).toBeNull()
    expect(screen.queryByText(/I’ve checked this page/)).toBeNull()
    expect(screen.queryByLabelText('The reading missed…')).toBeNull()
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    expect(screen.getByLabelText('What the paper says')).toBeTruthy()
    expect(screen.queryByLabelText(/Medicine name/)).toBeNull()
    await save()
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as Record<string, unknown>
    for (const key of ['learning', 'reviewConfirmed', 'missedItems', 'removedItems', 'rejectionReasonCode']) expect(sent).not.toHaveProperty(key)
    expect((sent.rejectedFields as Array<Record<string, unknown>>)[0]).not.toHaveProperty('removalReason')
    for (const correction of sent.corrections as Array<Record<string, unknown>>) {
      expect(correction).not.toHaveProperty('changeReason'); expect(correction).not.toHaveProperty('fields')
    }
  })

  it('without the flag, Reject reading is its reason alone', async () => {
    await openReading(false)
    const details = document.getElementById('ocr-details') as HTMLDetailsElement
    await act(async () => { fireEvent.click(within(details).getByText('Details')) })
    await press(within(details).getByRole('button', { name: 'Reject reading' }))
    expect(screen.getByRole('form', { name: 'Reject reading' }).querySelectorAll('textarea, input, select')).toHaveLength(1)
  })
})

const reasons = (name: string) => within(screen.getByRole('group', { name }))
const pressedWords = (name: string) => reasons(name).getAllByRole('button').filter(button => button.getAttribute('aria-pressed') === 'true')
  .map(button => button.textContent)

describe('Migrate learning, served', () => {
  it('offers why an item is removed as optional one-tap choices; saving works without one, and sends no reason', async () => {
    await openReading(true)
    expect(reviewLearningServed()).toBe(true)
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    const why = reasons('Why remove it?')
    expect(why.getAllByRole('button').map(button => button.textContent)).toEqual(['Not on the paper', 'Written twice', 'Not needed',
      'Can’t read it', 'Belongs to another patient'])
    expect(why.getAllByRole('button').every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true)
    // No required marker anywhere on the learning parts.
    expect(screen.getByRole('group', { name: 'Why remove it?' }).textContent).not.toContain('*')
    await save()
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as Record<string, unknown>
    expect(sent).not.toHaveProperty('removedItems')
    expect(sent).not.toHaveProperty('missedItems')
    expect(sent.rejectedFields).toEqual([expect.objectContaining({ itemId: 'it-00000000000000c1' })])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends the reason tapped; tapping it again clears it', async () => {
    await openReading(true)
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    await press(reasons('Why remove it?').getByRole('button', { name: 'Not needed' }))
    expect(pressedWords('Why remove it?')).toEqual(['Not needed'])
    await press(reasons('Why remove it?').getByRole('button', { name: 'Written twice' }))
    expect(pressedWords('Why remove it?')).toEqual(['Written twice'])
    await press(reasons('Why remove it?').getByRole('button', { name: 'Not needed' }))
    await press(reasons('Why remove it?').getByRole('button', { name: 'Not needed' }))
    expect(pressedWords('Why remove it?')).toEqual([])
    await press(reasons('Why remove it?').getByRole('button', { name: 'Written twice' }))
    await save()
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as { rejectedFields: Array<Record<string, unknown>>; removedItems: unknown }
    expect(sent.removedItems).toEqual([{ itemId: 'it-00000000000000c1', removalReason: 'duplicate' }])
    expect(sent.rejectedFields[0]).not.toHaveProperty('removalReason')
  })

  it('changes a medicine on its own form; why is optional', async () => {
    await openReading(true)
    await keepAll()
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    expect(reasons('Why change it?').getAllByRole('button').map(button => button.textContent)).toEqual(['AI misread the paper', 'Paper out of date'])
    expect(screen.queryByLabelText('What the paper says')).toBeNull()
    expect((screen.getByLabelText(/Medicine name/) as HTMLInputElement).value).toBe('Metformin')
    expect((screen.getByLabelText(/^Strength/) as HTMLInputElement).value).toBe('500 mg')
    expect((screen.getByLabelText(/^Dose/) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/^How often/) as HTMLInputElement).value).toBe('twice a day')
    fireEvent.change(screen.getByLabelText(/Medicine name/), { target: { value: '' } })
    await save()
    await waitFor(() => expect(focused()).toBe(screen.getByLabelText(/Medicine name/)))
    fireEvent.change(screen.getByLabelText(/Medicine name/), { target: { value: 'Metformin' } })
    fireEvent.change(screen.getByLabelText(/^Strength/), { target: { value: '850 mg' } })
    fireEvent.change(screen.getByLabelText('Save as'), { target: { value: 'PHARMACY' } })
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as { acceptedFields: { medications: Array<Record<string, unknown>> }; corrections: unknown[] }
    expect(sent.acceptedFields.medications.find(entry => entry.itemId === METFORMIN)).toMatchObject({ medicationText: 'Metformin',
      strengthText: '850 mg', frequencyText: 'twice a day' })
    expect(sent.corrections).toEqual([expect.objectContaining({ field: 'strengthText', newValue: '850 mg', fields: ['strength'] })])
    expect(sent.corrections[0]).not.toHaveProperty('changeReason')
  })

  it('has no page tick; one optional missed box, sent only when typed; every item seen makes the check complete', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openReading(true)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/I’ve checked this page/)).toBeNull()
    const box = screen.getByLabelText('The reading missed…') as HTMLInputElement
    fireEvent.change(box, { target: { value: '250' } })
    for (const element of Array.from(document.querySelectorAll('[data-item-id] > [role="group"]'))) show(element)
    await keepAll()
    await save()
    await waitFor(() => expect(focused()).toBe(box))
    expect(box.getAttribute('aria-invalid')).toBe('true')
    // Letters are never kept in the box.
    fireEvent.change(box, { target: { value: '3x' } })
    expect(box.value).toBe('3')
    await press(form().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as Record<string, unknown>
    expect(sent).toMatchObject({ reviewConfirmed: true, missedItems: 3 })
    for (const key of ['learning', 'itemsSeen', 'pagesChecked', 'removedItems']) expect(sent).not.toHaveProperty(key)
  })

  it('with nothing given, sends only what the page counted: not every item seen, and no missed total', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openReading(true)
    show(card('it-00000000000000d1'))
    await keepAll()
    await save()
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    const sent = api.validateOcrJob.mock.calls[0]![2] as Record<string, unknown>
    expect(sent.reviewConfirmed).toBe(false)
    for (const key of ['missedItems', 'removedItems', 'rejectionReasonCode']) expect(sent).not.toHaveProperty(key)
  })

  it.each([
    ['less than half the screen', 0.3, false],
    ['half the screen', 0.6, true],
  ])('a card taller than twice the screen, filling %s, counts as seen: %s', async (_, screenShare, complete) => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    await openReading(true)
    const tall = 'it-00000000000000d1'
    for (const element of Array.from(document.querySelectorAll('[data-item-id] > [role="group"]'))) {
      if (element !== card(tall)) show(element)
    }
    // Never half of it in view at once, as on a phone.
    show(card(tall), 0.25, screenShare)
    // Keep is pressed with the mouse here, so no card is touched or focused by it.
    for (const group of Array.from(document.querySelectorAll('[data-item-id] > [role="group"]'))) {
      const keep = within(group as HTMLElement).getByRole('button', { name: 'Keep' })
      if (keep.getAttribute('aria-pressed') !== 'true') await act(async () => { fireEvent.click(keep) })
    }
    fireEvent.change(form().getByLabelText(/^Why you’re/), { target: { value: 'Checked against the paper record' } })
    await act(async () => { fireEvent.click(form().getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ reviewConfirmed: complete })
    expect(api.validateOcrJob.mock.calls[0]![2]).not.toHaveProperty('missedItems')
  })

  it('Reject reading offers all eight reasons as optional one-tap choices, and rejects without one', async () => {
    await openReading(true)
    const details = document.getElementById('ocr-details') as HTMLDetailsElement
    await act(async () => { fireEvent.click(within(details).getByText('Details')) })
    await press(within(details).getByRole('button', { name: 'Reject reading' }))
    const reject = within(screen.getByRole('form', { name: 'Reject reading' }))
    expect(reasons('What’s wrong with it?').getAllByRole('button').map(button => button.textContent)).toEqual(['Wrong patient',
      'Not the document it was filed as', 'Can’t be read', 'Same document twice', 'Pages are missing', 'The reading is too wrong to correct',
      'Not a medical record', 'Something else'])
    fireEvent.change(reject.getByLabelText(/^Why you’re/), { target: { value: 'This is Patient One’s sister’s card' } })
    await press(reject.getByRole('button', { name: 'Reject reading' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![0]).toBe(DEMO_HOSPITAL_ID)
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ disposition: 'rejected' })
    for (const key of ['learning', 'rejectionReasonCode', 'reviewConfirmed', 'missedItems']) {
      expect(api.validateOcrJob.mock.calls[0]![2]).not.toHaveProperty(key)
    }
  })

  it('Reject reading sends the reason tapped', async () => {
    await openReading(true)
    const details = document.getElementById('ocr-details') as HTMLDetailsElement
    await act(async () => { fireEvent.click(within(details).getByText('Details')) })
    await press(within(details).getByRole('button', { name: 'Reject reading' }))
    const reject = within(screen.getByRole('form', { name: 'Reject reading' }))
    await press(reasons('What’s wrong with it?').getByRole('button', { name: 'Wrong patient' }))
    expect(pressedWords('What’s wrong with it?')).toEqual(['Wrong patient'])
    fireEvent.change(reject.getByLabelText(/^Why you’re/), { target: { value: 'This is Patient One’s sister’s card' } })
    await press(reject.getByRole('button', { name: 'Reject reading' }))
    await waitFor(() => expect(api.validateOcrJob).toHaveBeenCalled())
    expect(api.validateOcrJob.mock.calls[0]![2]).toMatchObject({ disposition: 'rejected', rejectionReasonCode: 'wrong_patient' })
  })

  it('shows no code, value or ID on screen', async () => {
    await openReading(true)
    await keepAll()
    await press(within(card('it-00000000000000c1')).getByRole('button', { name: 'Remove' }))
    await press(within(card(METFORMIN)).getByRole('button', { name: 'Change' }))
    const text = screen.getByRole('form', { name: 'Check and save' }).textContent ?? ''
    expect(text).not.toMatch(/not_on_paper|clinical_update|lab_result|it-0|reviewLearning|missedItems|reviewConfirmed/)
  })
})
