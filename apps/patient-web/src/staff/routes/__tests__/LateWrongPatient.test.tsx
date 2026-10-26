import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Pharmacy } from '../Operations'
import { forgetReceiving, lagosDay } from '../../orderRoutes'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.1, §10.3): "Correct an order that has ended" on the Laboratory and Pharmacy pages.
 * It shows only once the backend says it serves it (the work list's `lateCorrection: true`), only to a member holding the
 * receive permission, collapsed right after the work list's toolbar. Find reads the lookup only when pressed, with a
 * checked reference; each row says what this facility did on the order and what may be done now; an order still open is
 * read, then reported with item 3's own form; an ended one is withdrawn with the late form, whose words, request, key,
 * refusals and success are checked here.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(), findCorrectable: vi.fn(),
  correctWrongPatient: vi.fn() }))
const working = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1',
    name: 'Yaba Diagnostics', roles: ['lab'], permissions: working.permissions } } } } }),
}))

const LAB = ['lab.work-item.read', 'lab.accession.create', 'lab.order-route.receive', 'lab.result.entered-in-error']
const PHARMACY = ['pharmacy.work-item.read', 'pharmacy.order-route.receive', 'pharmacy.dispensing.reverse']
const TITLE = 'Correct an order that has ended'
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const local = { id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb', version: 1, status: 'accepted',
  testName: 'Malaria parasite', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T09:00:00.000Z' }
const list = (fields: Record<string, unknown> = {}) => ({ items: [local], crossFacilityOrders: true, crossFacilityWork: true,
  receives: true, routesHere: { waiting: false, held: true }, ...fields })

/** A lookup row as Lab answers it (C30): an order closed by support after a result went back, still correctable. */
const correctable = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '3F2A9C1B', kind: 'lab_request',
  version: 9, effectiveState: 'completed', orderingFacilityName: 'General Hospital', acceptedAt: '2026-06-01T09:00:00.000Z',
  completedAt: '2026-06-03T12:00:00.000Z', endedAt: '2026-06-20T08:00:00.000Z', endedKind: 'support', returned: true,
  correction: 'correctable', correctableUntil: '2026-11-28T09:00:00.000Z', wrongPatient: null,
  details: { what: 'Full blood count', acceptedBy: 'Ngozi Eze', acceptedWith: 'health_id',
    returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: false }] }, ...overrides })
const CORRECTED = { route: { id: ROUTE_ID, version: 11, effectiveState: 'completed', endedKind: 'support' }, late: true,
  endedKindBefore: 'support', resultsVoided: 1, resultReportsMarked: 1, dispensingReversed: false,
  correctableUntil: '2026-11-28T09:00:00.000Z', replayed: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working.permissions = LAB
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true, receives: true })
  api.labWorkItems.mockResolvedValue(list({ lateCorrection: true }))
  api.pharmacyWorkItems.mockResolvedValue({ ...list({ lateCorrection: true }), items: [] })
  routes.findCorrectable.mockResolvedValue({ items: [correctable()], lateCorrection: true })
  routes.correctWrongPatient.mockResolvedValue(CORRECTED)
  forgetReceiving(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => { vi.unstubAllEnvs(); forgetReceiving(); forgetLateCorrectionServed(); forgetWrongPatientServed() })

function section() { return screen.getByText(TITLE).closest('details') as HTMLElement }

async function find(reference = '3f2a9c1b') {
  const area = section()
  fireEvent.change(within(area).getByLabelText(/^Order reference/), { target: { value: reference } })
  fireEvent.click(within(area).getByRole('button', { name: 'Find' }))
}

async function openLab() {
  render(<MemoryRouter><Laboratory /></MemoryRouter>)
  await screen.findByText(TITLE)
  return section()
}

/** Fills the late form: how and when the facility found out, what happened, the note and the confirmation. */
function fill(form: HTMLElement, { by = 'The patient told us', on = '2026-06-15', note = 'The patient says it was not them',
  confirm = true }: { by?: string | null; on?: string; note?: string; confirm?: boolean } = {}) {
  if (by) fireEvent.click(within(form).getByRole('radio', { name: by }))
  fireEvent.change(within(form).getByLabelText(/^When did you find out\?/), { target: { value: on } })
  fireEvent.click(within(form).getByRole('radio', { name: 'The person gave someone else’s Health ID or date of birth' }))
  fireEvent.change(within(form).getByLabelText(/^What happened, for Health ID support/), { target: { value: note } })
  if (confirm) fireEvent.click(within(form).getByRole('checkbox'))
}

async function lateForm() {
  await openLab()
  await find()
  fireEvent.click(await screen.findByRole('button', { name: 'This wasn’t the order’s patient' }))
  return screen.getByRole('form', { name: 'Withdraw what you recorded: accepted for the wrong person' })
}

describe('dormant until the backend serves the late correction (D17-11)', () => {
  it('is absent against today’s answers, which carry item 3’s and item 4’s signals but no lateCorrection', async () => {
    api.labWorkItems.mockResolvedValue(list({ items: [local, { ...local, id: 'w-routed', testName: 'Haemoglobin',
      orderRoute: { id: 'r1', reference: '9C1B2D3E', effectiveState: 'accepted', access: 'work', orderingFacilityName: 'General Hospital',
        ordererName: 'Dr Ade Okon', version: 3, endedKind: null } }] }))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin')
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(document.body.textContent).not.toMatch(/Correct an order|withdraw what you recorded|wasn’t the order’s patient/i)
    expect(routes.findCorrectable).not.toHaveBeenCalled()
  })

  it('is absent for a member who does not receive orders from other facilities, even once served', async () => {
    working.permissions = ['lab.work-item.read', 'lab.accession.create']
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Malaria parasite')
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('shows, collapsed, right after the toolbar and before the list, once the work list says lateCorrection', async () => {
    const area = await openLab()
    expect(area.tagName).toBe('DETAILS')
    expect((area as HTMLDetailsElement).open).toBe(false)
    const refresh = screen.getByRole('button', { name: 'Refresh work' })
    expect(refresh.compareDocumentPosition(area) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(area.compareDocumentPosition(screen.getByText('Malaria parasite')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(area).getByText(/^If you find out after an order from another facility has ended/)).toBeTruthy()
    expect(within(area).getByText('8 characters, for example 3F2A9C1B.')).toBeTruthy()
  })

  it('shows at a facility that no longer receives, which may still hold past orders', async () => {
    api.labWorkItems.mockResolvedValue(list({ lateCorrection: true, receives: false, routesHere: { waiting: false, held: false } }))
    await openLab()
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('shows on the Pharmacy page too', async () => {
    working.permissions = PHARMACY
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    expect(await screen.findByText(TITLE)).toBeTruthy()
  })
})

describe('finding an ended order by its reference (C30)', () => {
  it('reads nothing until Find, and checks the reference first', async () => {
    const area = await openLab()
    fireEvent.change(within(area).getByLabelText(/^Order reference/), { target: { value: '3F2A' } })
    expect(routes.findCorrectable).not.toHaveBeenCalled()
    fireEvent.click(within(area).getByRole('button', { name: 'Find' }))
    expect(await within(area).findByText('The reference is the 8 characters shown with the order in the patient’s Health ID app, '
      + 'for example 3F2A9C1B.')).toBeTruthy()
    expect(routes.findCorrectable).not.toHaveBeenCalled()
    await find(' 3f2a9c1b ')
    await waitFor(() => expect(routes.findCorrectable).toHaveBeenCalledWith('facility-1', 'lab', '3F2A9C1B'))
  })

  it('says none was accepted here for items: [], and that it is not available yet for a 404 without a code (CT2)', async () => {
    routes.findCorrectable.mockResolvedValueOnce({ items: [], lateCorrection: true })
      .mockRejectedValueOnce(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    const area = await openLab()
    await find()
    expect(await within(area).findByText(/^No order with that reference was accepted here\. Check it with whoever gave it to you\.$/)).toBeTruthy()
    await find()
    expect(await within(area).findByText('Correcting an ended order isn’t available yet. Phone the ordering facility, and tell '
      + 'Health ID support.')).toBeTruthy()
    expect(within(area).queryByText(/^No order with that reference/)).toBeNull()
  })

  it.each([
    [new HidApiError(400, 'Bad', { code: 'ORDER_ROUTE_INVALID' }), 'The reference is the 8 characters shown with the order in the '
      + 'patient’s Health ID app, for example 3F2A9C1B.'],
    [new HidApiError(400, 'Bad', { code: 'VALIDATION_FAILED' }), /^The reference is the 8 characters/],
    [new HidApiError(403, 'No', { code: 'PERMISSION_DENIED' }), 'Your role can’t correct orders from other facilities.'],
    [new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }), 'Health ID has paused work on orders from '
      + 'other facilities, so this can’t be done now. Try again when it resumes.'],
    [new HidApiError(503, 'Down', { code: 'ORDER_ROUTE_UNAVAILABLE' }), 'Health ID did not answer. Try again.'],
    [new TypeError('Failed to fetch'), 'Health ID did not answer. Try again.'],
  ])('says a refused Find in its own words (%#)', async (error, words) => {
    routes.findCorrectable.mockRejectedValueOnce(error)
    const area = await openLab()
    await find()
    expect(await within(area).findByText(words)).toBeTruthy()
  })

  it('says, for an order it may still correct, what this facility did on it, never the patient (D17-8)', async () => {
    const area = await openLab()
    await find()
    const row = (await within(area).findByText(/^Lab request from General Hospital/)).closest('li') as HTMLElement
    expect(within(row).getByText('Lab request from General Hospital · Ref 3F2A9C1B · Full blood count · Accepted 1 Jun 2026 by '
      + 'Ngozi Eze, with their Health ID · closed by Health ID support.')).toBeTruthy()
    expect(within(row).getByText('1 result went back to General Hospital, on 3 Jun 2026.')).toBeTruthy()
    expect(within(row).getByText('You can withdraw it until 28 Nov 2026, 10:00.')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'This wasn’t the order’s patient' })).toBeTruthy()
    expect(row.textContent).not.toMatch(/Tunde|patient’s name|HID-/)
  })

  it('says each other state in its own words, with no action on reported or too-late orders', async () => {
    routes.findCorrectable.mockResolvedValueOnce({ lateCorrection: true, items: [
      correctable({ id: 'r-reported', reference: 'AAAA1111', correction: 'reported', correctableUntil: null, details: null,
        endedKind: 'wrong_patient', wrongPatient: { reportedAt: '2026-07-02T10:00:00.000Z', late: true } }),
      correctable({ id: 'r-late', reference: 'BBBB2222', correction: 'too_late', correctableUntil: '2026-05-01T09:00:00.000Z',
        details: null, endedKind: null, effectiveState: 'expired', completedAt: null, returned: false }),
      correctable({ id: 'r-two', reference: 'CCCC3333', details: { what: 'Lipid profile', acceptedBy: null,
        acceptedWith: 'date_of_birth', returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: true },
          { at: '2026-06-09T12:00:00.000Z', withdrawn: false }] }, endedKind: 'entered_in_error' }),
      correctable({ id: 'r-lapsed', reference: 'DDDD4444', effectiveState: 'expired', endedKind: null, endedAt: null,
        completedAt: null, returned: false, details: { what: 'Urea', acceptedBy: 'Ngozi Eze',
          acceptedWith: 'date_of_birth_with_reference', returned: [] } }),
    ] })
    const area = await openLab()
    await find()
    const row = async (reference: string) => (await within(area).findByText(new RegExp(`Ref ${reference}`))).closest('li') as HTMLElement
    const reported = await row('AAAA1111')
    expect(within(reported).getByText('You reported on 2 Jul 2026 that this order was accepted for the wrong person.')).toBeTruthy()
    expect(within(reported).queryByRole('button')).toBeNull()
    const late = await row('BBBB2222')
    expect(within(late).getByText('It is past 1 May 2026, 10:00, so it can’t be corrected here. Phone General Hospital, and tell '
      + 'Health ID support.')).toBeTruthy()
    expect(within(late).getByText(/· nothing was released within 30 days\.$/)).toBeTruthy()
    expect(within(late).queryByRole('button')).toBeNull()
    const two = await row('CCCC3333')
    expect(within(two).getByText(/· Accepted 1 Jun 2026, with date of birth only · General Hospital has since marked the order entered in error\.$/)).toBeTruthy()
    expect(within(two).getByText('2 results went back to General Hospital, on 3 Jun 2026 and 9 Jun 2026; 1 already withdrawn.')).toBeTruthy()
    const lapsed = await row('DDDD4444')
    expect(within(lapsed).getByText(/with date of birth and the order’s reference · nothing was released within 30 days\.$/)).toBeTruthy()
    expect(within(lapsed).getByText('Nothing you recorded went back to General Hospital.')).toBeTruthy()
  })
})

describe('an order found still open: item 3’s own form (CL5, S2)', () => {
  const open = () => correctable({ correction: 'open', effectiveState: 'accepted', endedKind: null, endedAt: null, completedAt: null,
    returned: false, correctableUntil: '2026-11-28T09:00:00.000Z', details: { what: 'Full blood count', acceptedBy: 'Ngozi Eze',
      acceptedWith: 'date_of_birth', returned: [] } })
  const ENDED = { route: { id: ROUTE_ID, version: 10, effectiveState: 'cancelled', endedKind: 'wrong_patient' }, resultsVoided: 0,
    resultReportsMarked: 0, dispensingReversed: false, replayed: false }

  it('reads the order, which names the patient, then reports it with item 3’s command at the lookup’s version', async () => {
    routes.findCorrectable.mockResolvedValue({ items: [open()], lateCorrection: true })
    routes.get.mockResolvedValue({ id: ROUTE_ID, version: 9, patient: { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: null,
      healthIdLast4: '7KQ2' } })
    routes.reportWrongPatient.mockResolvedValue(ENDED)
    const area = await openLab()
    await find()
    const row = (await within(area).findByText('This order is still open. If you accepted it for the wrong person, report it here.'))
      .closest('li') as HTMLElement
    expect(routes.get).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: 'This isn’t the order’s patient' }))
    const form = await within(row).findByRole('form', { name: 'End this order: accepted for the wrong person' })
    expect(routes.get).toHaveBeenCalledWith('facility-1', 'lab', ROUTE_ID)
    expect(within(form).getByText('Tunde Bello is the patient on this order. Use this only if the person you accepted it for is someone else.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(form).getByLabelText('What happened, for Health ID support'), { target: { value: 'Picked the wrong order' } })
    fireEvent.click(within(form).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello.' }))
    fireEvent.click(within(form).getByRole('button', { name: 'End this order' }))
    expect(await screen.findByText('Ended: Full blood count, reference 3F2A9C1B. Tunde Bello is told in the Health ID app.')).toBeTruthy()
    expect(routes.reportWrongPatient).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE_ID, version: 9 },
      { reason: 'wrong_order_chosen', note: 'Picked the wrong order' }, expect.any(String))
    expect(routes.correctWrongPatient).not.toHaveBeenCalled()
    // Accepted with a date of birth only: the message suggests the reference next time.
    expect(screen.getByText(/^Next time, ask for the order’s reference with the date of birth/)).toBeTruthy()
  })

  it('says when the order could not be read, and opens nothing', async () => {
    routes.findCorrectable.mockResolvedValue({ items: [open()], lateCorrection: true })
    routes.get.mockRejectedValue(new HidApiError(503, 'Down'))
    const area = await openLab()
    await find()
    fireEvent.click(await within(area).findByRole('button', { name: 'This isn’t the order’s patient' }))
    expect(await within(area).findByText('This order could not be read. Find it again, then try again.')).toBeTruthy()
    expect(within(area).queryByRole('form', { name: /^End this order/ })).toBeNull()
  })

  it('answers an ended order in item 3’s form by pointing to this section, once served (item 3’s refusal, CT10)', async () => {
    routes.findCorrectable.mockResolvedValue({ items: [open()], lateCorrection: true })
    routes.get.mockResolvedValue({ id: ROUTE_ID, version: 9, patient: { fullName: 'Tunde Bello', sex: null, dateOfBirth: null, healthIdLast4: null } })
    routes.reportWrongPatient.mockRejectedValue(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    const area = await openLab()
    await find()
    fireEvent.click(await within(area).findByRole('button', { name: 'This isn’t the order’s patient' }))
    const form = await within(area).findByRole('form', { name: 'End this order: accepted for the wrong person' })
    fireEvent.click(within(form).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(form).getByLabelText('What happened, for Health ID support'), { target: { value: 'Picked the wrong order' } })
    fireEvent.click(within(form).getByRole('checkbox'))
    fireEvent.click(within(form).getByRole('button', { name: 'End this order' }))
    expect(await within(area).findByText('This order has already ended, so it can’t be ended here. If a result or dispensing had '
      + 'gone back, use “Correct an order that has ended” above the work list, with reference 3F2A9C1B.')).toBeTruthy()
  })
})

describe('the late form (C29)', () => {
  it('says what it is for, and what will happen, in the laboratory’s words', async () => {
    const form = await lateForm()
    expect(document.activeElement).toBe(within(form).getByText('Withdraw what you recorded: accepted for the wrong person'))
    for (const words of [
      'This order has already ended. Use this only if the person you accepted it for was not its patient.',
      'If you just couldn’t do the test, don’t use this. If a result was wrong but it was the patient’s, don’t use this either: '
        + 'correct it under your laboratory’s procedure, and phone General Hospital.',
      'Every result you recorded on it is marked entered in error.',
      'The result that went back to General Hospital on 3 Jun 2026 is shown to General Hospital as not to be used, and no longer '
        + 'shows in the patient’s health record. Anything General Hospital wrote down from it stays until General Hospital corrects it.',
      'Health ID support reviews every report. This can’t be undone.',
      'We accepted this order for someone who was not its patient. I have checked our own records of it: who accepted it, the '
        + 'identity they were shown, and the specimen record.',
    ]) expect(within(form).getByText(words)).toBeTruthy()
    expect(within(form).getByText(/^The patient is told in the Health ID app\. General Hospital sees it on the order, but Health ID does not alert them: you must/)).toBeTruthy()
    // It had ended: nothing more ends it.
    expect(within(form).queryByText('The order is also ended as accepted for the wrong person.')).toBeNull()
    expect((within(form).getByLabelText(/^When did you find out\?/) as HTMLInputElement).value).toBe(lagosDay(new Date()))
    expect(within(form).getAllByRole('radio').map(radio => radio.closest('label')?.textContent?.trim())).toEqual([
      'The patient told us', 'The ordering facility told us', 'We found it ourselves', 'Health ID support told us', 'Another way',
      'I picked another patient’s order from the list', 'The person gave someone else’s Health ID or date of birth',
      'I think the person was pretending to be the patient', 'The person was not the patient for another reason'])
  })

  it('asks to confirm with the ordering facility first unless this facility found it itself (CL2)', async () => {
    const form = await lateForm()
    const warning = 'Before you withdraw it, confirm with General Hospital and against your own records. A result that is only '
      + 'unexpected is not a reason to use this.'
    expect(within(form).queryByText(warning)).toBeNull()
    fireEvent.click(within(form).getByRole('radio', { name: 'The patient told us' }))
    expect(within(form).getByText(warning)).toBeTruthy()
    fireEvent.click(within(form).getByRole('radio', { name: 'We found it ourselves' }))
    expect(within(form).queryByText(warning)).toBeNull()
  })

  it('needs how and when it was found, what happened, the note and the confirmation before it sends anything', async () => {
    const form = await lateForm()
    const withdraw = within(form).getByRole('button', { name: 'Withdraw it' })
    fireEvent.click(withdraw)
    expect(await within(form).findByText('Choose how you found out.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('radio', { name: 'The ordering facility told us' }))
    fireEvent.change(within(form).getByLabelText(/^When did you find out\?/), { target: { value: '2999-01-01' } })
    fireEvent.click(withdraw)
    expect(await within(form).findByText('Enter the day you found out: not after today, and not before the order was accepted (1 Jun 2026).')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText(/^When did you find out\?/), { target: { value: '2026-05-31' } })
    fireEvent.click(withdraw)
    expect(await within(form).findByText(/^Enter the day you found out/)).toBeTruthy()
    fireEvent.change(within(form).getByLabelText(/^When did you find out\?/), { target: { value: '2026-06-01' } })
    fireEvent.click(withdraw)
    expect(await within(form).findByText('Choose what happened.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(form).getByLabelText(/^What happened, for Health ID support/), { target: { value: '  short  ' } })
    fireEvent.click(withdraw)
    expect(await within(form).findByText('Describe what happened in 8 to 500 characters.')).toBeTruthy()
    fireEvent.change(within(form).getByLabelText(/^What happened, for Health ID support/), { target: { value: 'The clinic phoned us' } })
    fireEvent.click(withdraw)
    expect(await within(form).findByText('Tick the box to confirm that you checked your own records.')).toBeTruthy()
    expect(routes.correctWrongPatient).not.toHaveBeenCalled()
  })

  it('sends the request with one key, kept after no answer and renewed once the request changes', async () => {
    routes.correctWrongPatient.mockRejectedValueOnce(new HidApiError(503, 'Down', { code: 'ORDER_ROUTE_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(400, 'Bad', { code: 'ORDER_ROUTE_INVALID' }))
    const form = await lateForm()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    await waitFor(() => expect(routes.correctWrongPatient).toHaveBeenCalledTimes(1))
    expect(routes.correctWrongPatient).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE_ID, version: 9 },
      { reason: 'someone_elses_details', discoveredBy: 'patient', discoveredOn: '2026-06-15', note: 'The patient says it was not them' },
      expect.any(String))
    expect(await screen.findByText('Health ID did not answer, so it may or may not have been withdrawn. Press “Withdraw it” '
      + 'again: if it was, Health ID says so, and nothing is withdrawn twice.')).toBeTruthy()
    // No answer: the form stays open, the order is not found again, and the same request keeps its key.
    expect(routes.findCorrectable).toHaveBeenCalledTimes(1)
    const again = screen.getByRole('form', { name: 'Withdraw what you recorded: accepted for the wrong person' })
    expect(again).toBe(form)
    fireEvent.click(within(again).getByRole('button', { name: 'Withdraw it' }))
    await waitFor(() => expect(routes.correctWrongPatient).toHaveBeenCalledTimes(2))
    expect(routes.correctWrongPatient.mock.calls[1]![4]).toBe(routes.correctWrongPatient.mock.calls[0]![4])
    expect(await screen.findByText('Check what you entered: choose how and when you found out and what happened, and describe it '
      + 'for Health ID support in 8 to 500 characters. The date can’t be in the future or before the order was accepted.')).toBeTruthy()
    // A refusal settles it: the next request is a new one.
    fireEvent.click(within(again).getByRole('button', { name: 'Withdraw it' }))
    await waitFor(() => expect(routes.correctWrongPatient).toHaveBeenCalledTimes(3))
    expect(routes.correctWrongPatient.mock.calls[2]![4]).not.toBe(routes.correctWrongPatient.mock.calls[0]![4])
  })

  it('says what follows a withdrawal that went through though no answer came: the same request answers replayed', async () => {
    // As production answers once the withdrawal has committed: a new lookup would say reported, and close the form.
    routes.findCorrectable.mockResolvedValueOnce({ items: [correctable()], lateCorrection: true })
      .mockResolvedValue({ items: [correctable({ correction: 'reported', details: null,
        wrongPatient: { reportedAt: '2026-10-26T09:00:00.000Z', late: true } })], lateCorrection: true })
    routes.correctWrongPatient.mockRejectedValueOnce(new HidApiError(503, 'Down', { code: 'ORDER_ROUTE_UNAVAILABLE' }))
      .mockResolvedValueOnce({ ...CORRECTED, replayed: true })
    const form = await lateForm()
    fill(form)
    const withdraw = within(form).getByRole('button', { name: 'Withdraw it' })
    withdraw.focus()
    fireEvent.click(withdraw)
    const said = await within(form).findByRole('alert')
    expect(said.textContent).toBe('Health ID did not answer, so it may or may not have been withdrawn. Press “Withdraw it” again: '
      + 'if it was, Health ID says so, and nothing is withdrawn twice.')
    expect(document.activeElement).toBe(withdraw)
    fireEvent.click(withdraw)
    const first = await screen.findByText('Withdrawn: Full blood count, reference 3F2A9C1B. The patient is told in the Health ID app.')
    expect(routes.correctWrongPatient.mock.calls[1]![4]).toBe(routes.correctWrongPatient.mock.calls[0]![4])
    expect(screen.getByText('Phone General Hospital now: a result had gone back to them, and Health ID does not alert them. Ask '
      + 'them to correct anything they recorded from it, and to tell the patient.')).toBeTruthy()
    expect(document.activeElement).toBe(first)
    expect(routes.findCorrectable).toHaveBeenCalledTimes(1)
  })

  it('finds the order again after 412 and keeps the form open at its new version', async () => {
    routes.findCorrectable.mockResolvedValueOnce({ items: [correctable()], lateCorrection: true })
      .mockResolvedValue({ items: [correctable({ version: 10 })], lateCorrection: true })
    routes.correctWrongPatient.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'VERSION_CONFLICT' }))
    const form = await lateForm()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText('Something was recorded on this order a moment ago. It has been found again: check what will '
      + 'happen and try again.')).toBeTruthy()
    await waitFor(() => expect(routes.findCorrectable).toHaveBeenCalledTimes(2))
    fireEvent.click(within(screen.getByRole('form', { name: /^Withdraw what you recorded/ })).getByRole('button', { name: 'Withdraw it' }))
    await waitFor(() => expect(routes.correctWrongPatient).toHaveBeenCalledTimes(2))
    expect(routes.correctWrongPatient.mock.calls[1]![2]).toEqual({ id: ROUTE_ID, version: 10 })
  })

  it('says what follows a withdrawal where a result had gone back, until closed', async () => {
    const form = await lateForm()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    const first = await screen.findByText('Withdrawn: Full blood count, reference 3F2A9C1B. The patient is told in the Health ID app.')
    expect(document.activeElement).toBe(first)
    expect(screen.getByText('Phone General Hospital now: a result had gone back to them, and Health ID does not alert them. Ask '
      + 'them to correct anything they recorded from it, and to tell the patient.')).toBeTruthy()
    expect(screen.getByText('Follow your laboratory’s procedure for a misidentified specimen. If a value was critical and you can '
      + 'tell who the person was, tell them or their clinician.')).toBeTruthy()
    // The message stands above the toolbar; the found row is gone.
    expect(first.compareDocumentPosition(screen.getByRole('button', { name: 'Refresh work' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('form', { name: /^Withdraw what you recorded/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/^Withdrawn: Full blood count/)).toBeNull()
  })

  it.each([
    [new HidApiError(409, 'Late', { code: 'ORDER_ROUTE_CORRECTION_TOO_LATE' }), 'It is past 28 Nov 2026, 10:00, so it can’t be '
      + 'corrected here. Phone General Hospital, and tell Health ID support.'],
    [new HidApiError(409, 'Open', { code: 'ORDER_ROUTE_STILL_OPEN' }), 'This order is still open. If you accepted it for the wrong '
      + 'person, report it here.'],
    [new HidApiError(409, 'Reported', { code: 'ORDER_ROUTE_ALREADY_REPORTED' }), 'This order has already been reported as accepted '
      + 'for the wrong person. Find it again to see when.'],
    [new HidApiError(409, 'Not accepted', { code: 'ORDER_ROUTE_NOT_ACCEPTED' }), 'This order was never accepted here, so there is '
      + 'nothing to withdraw.'],
    [new HidApiError(429, 'Limit', { code: 'ORDER_ROUTE_CORRECTION_LIMIT', retryAt: '2026-10-27T09:14:03.218Z' }), 'You have '
      + 'reached the limit for withdrawing ended orders. You can withdraw more from 27 Oct 2026, 10:14. If many orders are '
      + 'affected, phone Health ID support now so that they can tell the ordering facilities.'],
    [new HidApiError(403, 'Permission', { code: 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED' }), 'Results were recorded on this '
      + 'order, and your role can’t mark results entered in error. Ask a laboratory scientist to withdraw it.'],
    [new HidApiError(400, 'Bad', { code: 'VALIDATION_FAILED' }), /^Check what you entered: choose how and when you found out/],
    [new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }), 'Health ID has paused work on orders from '
      + 'other facilities, so this can’t be done now. Try again when it resumes.'],
    [new HidApiError(404, 'Missing', { code: 'NOT_FOUND' }), 'Withdrawing an ended order isn’t available yet. Phone General '
      + 'Hospital, and tell Health ID support.'],
  ])('says a refused withdrawal in the laboratory’s words (%#)', async (error, words) => {
    routes.correctWrongPatient.mockRejectedValueOnce(error)
    const form = await lateForm()
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText(words)).toBeTruthy()
  })
})

/**
 * A refusal that makes the page find the order again, after which the row no longer allows the open form (UX-2): the
 * refusal stays said in the row (role="alert"), and focus moves to the row, as Cancel moves it to the row's button.
 */
describe('a refusal after which the order reads differently', () => {
  async function refuse(error: HidApiError, next: Record<string, unknown>[]) {
    routes.findCorrectable.mockResolvedValueOnce({ items: [correctable()], lateCorrection: true })
      .mockResolvedValueOnce({ items: next, lateCorrection: true })
    routes.correctWrongPatient.mockRejectedValueOnce(error)
    const form = await lateForm()
    fill(form)
    const withdraw = within(form).getByRole('button', { name: 'Withdraw it' })
    withdraw.focus()
    fireEvent.click(withdraw)
    await waitFor(() => expect(routes.findCorrectable).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: /^Withdraw what you recorded/ })).toBeNull())
  }
  const rowOf = (element: Element | null) => element?.closest('li') as HTMLElement

  it.each([
    ['past its date', new HidApiError(409, 'Late', { code: 'ORDER_ROUTE_CORRECTION_TOO_LATE' }),
      correctable({ correction: 'too_late', details: null, correctableUntil: '2026-10-20T09:00:00.000Z' }),
      'It is past 28 Nov 2026, 10:00, so it can’t be corrected here. Phone General Hospital, and tell Health ID support.'],
    ['still open', new HidApiError(409, 'Open', { code: 'ORDER_ROUTE_STILL_OPEN' }),
      correctable({ correction: 'open', effectiveState: 'accepted', endedKind: null, endedAt: null, completedAt: null }),
      'This order is still open. If you accepted it for the wrong person, report it here.'],
    ['a key used with other details', new HidApiError(409, 'Reused', { code: 'IDEMPOTENCY_KEY_REUSED' }),
      correctable({ correction: 'reported', details: null, wrongPatient: { reportedAt: '2026-10-26T09:00:00.000Z', late: true } }),
      'This report was already sent with other details. Find the order again and check whether it has been withdrawn.'],
  ])('keeps the refusal in the row and moves focus there: %s', async (_case, error, next, words) => {
    await refuse(error, [next])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(words)
    const row = rowOf(alert)
    expect(row).toBeTruthy()
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true))
    expect(document.activeElement?.tagName).toBe('STRONG')
  })

  it('says it at the section, and moves focus there, when the order is no longer found', async () => {
    await refuse(new HidApiError(404, 'Missing', { code: 'ORDER_ROUTE_NOT_FOUND' }), [])
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('This order was not found here. Find it again.')
    await waitFor(() => expect(document.activeElement).toBe(alert))
    expect(screen.getByText(/^No order with that reference was accepted here/)).toBeTruthy()
  })

  it('does so for item 3’s refusal in the open row’s form too', async () => {
    const open = correctable({ correction: 'open', effectiveState: 'accepted', endedKind: null, endedAt: null, completedAt: null,
      returned: false, details: { what: 'Full blood count', acceptedBy: 'Ngozi Eze', acceptedWith: 'health_id', returned: [] } })
    routes.findCorrectable.mockResolvedValueOnce({ items: [open], lateCorrection: true })
      .mockResolvedValueOnce({ items: [correctable({ endedKind: 'support' })], lateCorrection: true })
    routes.get.mockResolvedValue({ id: ROUTE_ID, version: 9, patient: { fullName: 'Tunde Bello', sex: null, dateOfBirth: null, healthIdLast4: null } })
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    const area = await openLab()
    await find()
    fireEvent.click(await within(area).findByRole('button', { name: 'This isn’t the order’s patient' }))
    const form = await within(area).findByRole('form', { name: 'End this order: accepted for the wrong person' })
    fireEvent.click(within(form).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(form).getByLabelText('What happened, for Health ID support'), { target: { value: 'Picked the wrong order' } })
    fireEvent.click(within(form).getByRole('checkbox'))
    fireEvent.click(within(form).getByRole('button', { name: 'End this order' }))
    await waitFor(() => expect(routes.findCorrectable).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'End this order: accepted for the wrong person' })).toBeNull())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/^This order has already ended, so it can’t be ended here\./)
    const row = rowOf(alert)
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true))
    expect(within(row).getByRole('button', { name: 'This wasn’t the order’s patient' })).toBeTruthy()
  })
})

describe('at a pharmacy', () => {
  const prescription = (overrides: Record<string, unknown> = {}) => correctable({ kind: 'prescription',
    details: { what: 'Amoxicillin 500 mg capsules', acceptedBy: 'Bola Ade', acceptedWith: 'health_id',
      returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: false }] }, ...overrides })

  async function pharmacyForm(row: Record<string, unknown>) {
    working.permissions = PHARMACY
    routes.findCorrectable.mockResolvedValue({ items: [row], lateCorrection: true })
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    await screen.findByText(TITLE)
    await find()
    fireEvent.click(await screen.findByRole('button', { name: 'This wasn’t the order’s patient' }))
    return screen.getByRole('form', { name: 'Withdraw what you recorded: accepted for the wrong person' })
  }

  it('says the dispensing and the pharmacy’s words, and what follows when it had gone back', async () => {
    const form = await pharmacyForm(prescription())
    expect(screen.getByText('A dispensing went back to General Hospital on 3 Jun 2026.')).toBeTruthy()
    for (const words of [
      'Someone collecting for the patient with their agreement is not the wrong person: don’t use this for them.',
      'If you just couldn’t supply the medicine, don’t use this. If the dispensing was wrong but it was the patient’s, don’t use '
        + 'this either: follow your incident procedure, and phone General Hospital.',
      'The dispensing you recorded on 3 Jun 2026 is reversed in the record.',
      'We accepted this order for someone who was not its patient, and it was not collected for them. I have checked our own '
        + 'records of it: who accepted it, the identity they were shown, and the collection record.',
    ]) expect(within(form).getByText(words)).toBeTruthy()
    fireEvent.click(within(form).getByRole('radio', { name: 'Health ID support told us' }))
    expect(within(form).getByText('Before you withdraw it, confirm with General Hospital and against your own records.')).toBeTruthy()
    routes.correctWrongPatient.mockResolvedValueOnce({ ...CORRECTED, resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: true })
    fill(form, { by: null })
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText('Withdrawn: Amoxicillin 500 mg capsules, reference 3F2A9C1B. The patient is told in the Health '
      + 'ID app.')).toBeTruthy()
    expect(screen.getByText(/^Phone General Hospital now: a dispensing had gone back to them/)).toBeTruthy()
    expect(screen.getByText('Follow your pharmacy’s incident procedure. If you can tell who received the medicine, advise them to '
      + 'get medical advice.')).toBeTruthy()
    expect(routes.correctWrongPatient.mock.calls[0]![1]).toBe('pharmacy')
  })

  it('says a dispensing already reversed is still reported, and to phone, as the lookup said it had gone back (CT7)', async () => {
    const form = await pharmacyForm(prescription({ details: { what: 'Amoxicillin 500 mg capsules', acceptedBy: 'Bola Ade',
      acceptedWith: 'health_id', returned: [{ at: '2026-06-03T12:00:00.000Z', withdrawn: true }] } }))
    expect(screen.getByText('A dispensing went back to General Hospital on 3 Jun 2026, already reversed.')).toBeTruthy()
    expect(within(form).getByText('The dispensing you recorded was already reversed. The report is still made.')).toBeTruthy()
    routes.correctWrongPatient.mockResolvedValueOnce({ ...CORRECTED, resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false })
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText(/^Phone General Hospital now: a dispensing had gone back to them/)).toBeTruthy()
  })

  it('says nothing went back for a cancelled prescription, and to phone if the medicine is still needed (CT7)', async () => {
    const form = await pharmacyForm(prescription({ effectiveState: 'cancelled', endedKind: 'order_changed', completedAt: null,
      returned: false, details: { what: 'Amoxicillin 500 mg capsules', acceptedBy: 'Bola Ade', acceptedWith: 'health_id', returned: [] } }))
    expect(screen.getByText(/· cancelled by General Hospital\.$/)).toBeTruthy()
    expect(screen.getAllByText('Nothing was dispensed on it.').length).toBeGreaterThan(0)
    routes.correctWrongPatient.mockResolvedValueOnce({ ...CORRECTED, route: { ...CORRECTED.route, effectiveState: 'cancelled',
      endedKind: 'order_changed' }, endedKindBefore: 'order_changed', resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false })
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText('Nothing had gone back to General Hospital. Phone General Hospital if the patient still needs '
      + 'the medicine, so they can send a new order.')).toBeTruthy()
  })

  it('says a lapsed prescription ends too, and the pharmacy’s permission words', async () => {
    const form = await pharmacyForm(prescription({ effectiveState: 'expired', endedKind: null, endedAt: null, completedAt: null,
      returned: false, details: { what: 'Amoxicillin 500 mg capsules', acceptedBy: 'Bola Ade', acceptedWith: 'health_id', returned: [] } }))
    expect(screen.getByText(/· nothing was dispensed within 30 days\.$/)).toBeTruthy()
    expect(within(form).getByText('The order is also ended as accepted for the wrong person.')).toBeTruthy()
    routes.correctWrongPatient.mockRejectedValueOnce(new HidApiError(403, 'Permission', { code: 'ORDER_ROUTE_CORRECTION_PERMISSION_REQUIRED' }))
    fill(form)
    fireEvent.click(within(form).getByRole('button', { name: 'Withdraw it' }))
    expect(await screen.findByText('A dispensing was recorded on this order, and your role can’t reverse dispensings. Ask a '
      + 'pharmacist to withdraw it.')).toBeTruthy()
  })
})
