import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrderedByMe } from '../../../ehr-blue/clinical/mine/OrderedByMe'
import { MY_ORDERS_REFUSALS, dayWords, earliestSince, hiddenText, sinceProblem } from '../../../ehr-blue/clinical/mine/myOrders'
import { lagosToday } from '../../../ehr-blue/departments/waiting/waitingRules'
import { readMyOrdersPage } from '../../../staff/api'
import { PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient } from './harness'

/**
 * "Ordered by me" (hid-system 0143, MY-1): the member's own lab requests and prescriptions, with ORD-3's progress words,
 * the patient's card (never the whole Health ID), the filters the backend takes, every refusal in plain words, and a
 * row that opens only for the patient open now. Every patient, facility and order here is fictional.
 */

const orders = vi.hoisted(() => ({ list: vi.fn() }))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => ({ ...await importOriginal<object>(), myOrdersApi: orders }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

/** A doctor: writes and reads both kinds of order. */
const BOTH = ['ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.prescription.read', 'ehr.prescription.write', 'ehr.encounter.read',
  'identity.patient.read']
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const LAB_ORDER = 'c0000000-0000-4000-8000-000000000001'
const RX_ORDER = 'b0000000-0000-4000-8000-000000000001'
const OTHER_PATIENT = 'a0000000-0000-4000-8000-000000000002'

function order(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'lab_request', orderId: LAB_ORDER, encounterId: ENCOUNTER,
    patient: { patientId: PATIENT_ID, fullName: PATIENT_NAME, sex: 'female', dateOfBirth: '1990-04-12', healthIdLast4: 'AAA2' },
    display: 'Full blood count', status: 'active', priority: 'urgent', createdAt: '2026-11-20T09:15:00.000Z',
    updatedAt: '2026-11-20T09:15:00.000Z', ownProgress: { status: 'received', receivedAt: '2026-11-20T09:40:00.000Z', collectedAt: null, lastResultAt: null },
    ...overrides,
  }
}
const prescription = (overrides: Record<string, unknown> = {}) => order({
  kind: 'prescription', orderId: RX_ORDER, display: 'Amoxicillin 500 mg capsule', priority: null,
  ownProgress: { status: 'dispensed', receivedAt: null, acceptedAt: null, dispensedAt: '2026-11-20T11:05:00.000Z', reversedAt: null }, ...overrides,
})
function page(items: unknown[], more: Record<string, unknown> = {}) {
  return readMyOrdersPage({ items, hiddenCount: 0, hiddenCountComplete: true, since: '2026-08-26', nextCursor: null, ...more })
}
const refused = (status: number, code: string, detail = 'Refused') => new HidApiError(status, detail, { code })

function Where() { return <output data-testid="where">{useLocation().pathname}</output> }
function open() {
  return render(<MemoryRouter initialEntries={['/provider/ordered-by-me']}><Where />
    <Routes><Route path="/provider/ordered-by-me" element={<OrderedByMe />} /><Route path="*" element={<p>Elsewhere</p>} /></Routes>
  </MemoryRouter>)
}
const call = (n: number) => orders.list.mock.calls[n]![1] as Record<string, unknown>
const list = () => screen.getByRole('list', { name: /Orders|Lab requests|Prescriptions/ })

/** House rules: no code, no internal id, no full Health ID, no "permission" or "unverified", no long dashes. */
function plainWords() {
  const text = document.body.textContent ?? ''
  expect(text).not.toMatch(/permission|unverified|[–—]|_/i)
  expect(text).not.toMatch(/[A-Z]{2,}_[A-Z]/)
  expect(document.body.innerHTML).not.toContain(PATIENT_HID)
  for (const id of [PATIENT_ID, OTHER_PATIENT, ENCOUNTER, LAB_ORDER, RX_ORDER]) expect(document.body.innerHTML).not.toContain(id)
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...BOTH]
  staff.activePatient = null
  orders.list.mockResolvedValue(page([order(), prescription()]))
})

describe('Ordered by me', () => {
  it('lists each order with its status, priority, progress words and the patient card, and reads once on opening', async () => {
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Ordered by me' })).toBeDefined()
    expect(screen.getByText('Loading your orders…')).toBeDefined()
    const lab = await screen.findByRole('listitem', { name: 'Full blood count' })
    expect(within(lab).getByText('Lab request')).toBeDefined()
    expect(within(lab).getByText('Active')).toBeDefined()
    expect(within(lab).getByText('Urgent')).toBeDefined()
    expect(within(lab).getByText(/^Received/)).toBeDefined()
    expect(within(lab).getByText(PATIENT_NAME)).toBeDefined()
    expect(within(lab).getByText('Female · Born 12 Apr 1990')).toBeDefined()
    expect(within(lab).getByLabelText('Health ID ending AAA2').textContent).toBe('•••• AAA2')
    const rx = screen.getByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(rx).getByText('Prescription')).toBeDefined()
    expect(within(rx).getByText(/^Dispensed/)).toBeDefined()
    expect(screen.getByText('Showing the last 90 days and everything still open.')).toBeDefined()
    expect(orders.list).toHaveBeenCalledTimes(1)
    expect(orders.list.mock.calls[0]![0]).toBe('facility-demo-hospital')
    // The first read sends no day, so the backend's 90 days apply.
    expect(call(0)).toEqual({ kind: 'all', openOnly: false, limit: 25 })
    plainWords()
  })

  it('offers All, Lab and Prescriptions only to a member who holds both, and sends the kind and Open only', async () => {
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    const tabs = screen.getByRole('navigation', { name: 'Show' })
    expect(within(tabs).getAllByRole('button').map(button => button.textContent)).toEqual(['All', 'Lab', 'Prescriptions'])
    orders.list.mockResolvedValueOnce(page([prescription()]))
    fireEvent.click(within(tabs).getByRole('button', { name: 'Prescriptions' }))
    expect(await screen.findByRole('list', { name: 'Prescriptions' })).toBeDefined()
    expect(call(1)).toMatchObject({ kind: 'prescription', openOnly: false })
    orders.list.mockResolvedValueOnce(page([]))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open only' }))
    expect(await screen.findByText('No open orders')).toBeDefined()
    expect(call(2)).toMatchObject({ kind: 'prescription', openOnly: true })
    expect(call(2)).not.toHaveProperty('cursor')
    expect(screen.getByText('Showing every order that is still open.')).toBeDefined()
  })

  // The overseer (hid-system#258, 26 Nov 2026), following Ola's clinical view: the page and its tabs follow what the
  // member can order (write), each kind with its read too, as the backend lists by read.
  it.each([
    ['prescriptions', ['ehr.lab-request.read', 'ehr.prescription.read', 'ehr.prescription.write'], 'prescription', 'Prescriptions'],
    ['lab tests', ['ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.prescription.read'], 'lab', 'Lab requests'],
    ['prescriptions, with lab write but no lab read', ['ehr.lab-request.write', 'ehr.prescription.read', 'ehr.prescription.write'], 'prescription', 'Prescriptions'],
  ])('shows a member who orders %s only that kind, with no tabs, and asks for that kind only', async (_who, permissions, kind, name) => {
    staff.permissions = [...permissions, 'ehr.encounter.read', 'identity.patient.read']
    orders.list.mockResolvedValue(page(kind === 'lab' ? [order()] : [prescription()]))
    open()
    expect(await screen.findByRole('list', { name })).toBeDefined()
    expect(screen.queryByRole('navigation', { name: 'Show' })).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name })).toBeDefined()
    expect(call(0)).toEqual({ kind, openOnly: false, limit: 25 })
    orders.list.mockResolvedValueOnce(page([]))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Open only' }))
    await waitFor(() => expect(orders.list).toHaveBeenCalledTimes(2))
    expect(call(1)).toEqual({ kind, openOnly: true, limit: 25 })
    plainWords()
  })

  it.each([
    ['neither kind', ['ehr.encounter.read', 'identity.patient.read']],
    ['lab requests only (laboratory staff)', ['ehr.lab-request.read']],
    ['prescriptions only (pharmacy staff)', ['ehr.prescription.read']],
    ['both kinds without ordering either', ['ehr.lab-request.read', 'ehr.prescription.read']],
    ['nothing, though they may order', ['ehr.lab-request.write', 'ehr.prescription.write']],
  ])('says who the page is for, and reads nothing, for a member who reads %s', async (_who, permissions) => {
    staff.permissions = [...permissions]
    open()
    expect(screen.getByText('Ordered by me shows the tests and medicines you ordered here. It is for staff who order them.')).toBeDefined()
    await act(async () => {})
    expect(orders.list).not.toHaveBeenCalled()
    plainWords()
  })

  it('looks further back from a day chosen, checked before it is sent', async () => {
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }))
    const day = screen.getByLabelText('Show orders from')
    const today = lagosToday()
    fireEvent.change(day, { target: { value: '2001-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    expect(await screen.findByText('You can look back up to 2 years. Choose a later date.')).toBeDefined()
    fireEvent.change(day, { target: { value: '2999-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    expect(await screen.findByText('Choose a day that is today or earlier.')).toBeDefined()
    expect(orders.list).toHaveBeenCalledTimes(1)

    const chosen = earliestSince(today)
    orders.list.mockResolvedValueOnce(page([order()], { since: chosen }))
    fireEvent.change(day, { target: { value: chosen } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    await waitFor(() => expect(orders.list).toHaveBeenCalledTimes(2))
    expect(call(1)).toEqual({ kind: 'all', openOnly: false, limit: 25, since: chosen })
    expect(await screen.findByText(/^Showing orders from \d{1,2} [A-Z][a-z]{2} \d{4} and everything still open\.$/)).toBeDefined()
  })

  it('says a day the backend refuses at the date picker', async () => {
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }))
    orders.list.mockRejectedValueOnce(refused(400, 'MY_ORDERS_SINCE_TOO_OLD', 'You can look back up to 2 years. Choose a later date.'))
    fireEvent.change(screen.getByLabelText('Show orders from'), { target: { value: lagosToday() } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    expect(await screen.findByText('You can look back up to 2 years. Choose a later date.')).toBeDefined()
    expect(screen.getByLabelText('Show orders from')).toBeDefined()
    plainWords()
  })

  it('goes back to the list it last showed when the backend refuses a day, so Cancel leaves rows and true words', async () => {
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    const today = lagosToday()
    const earliest = earliestSince(today)

    // A day the backend takes, then a later one it refuses (its clock is a day behind the device's, say).
    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }))
    orders.list.mockResolvedValueOnce(page([order()], { since: earliest }))
    fireEvent.change(screen.getByLabelText('Show orders from'), { target: { value: earliest } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    expect(await screen.findByText(/^Showing orders from /)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Look further back' }))
    orders.list.mockRejectedValueOnce(refused(400, 'VALIDATION_FAILED', 'since must not be in the future'))
    orders.list.mockResolvedValueOnce(page([order()], { since: earliest }))
    fireEvent.change(screen.getByLabelText('Show orders from'), { target: { value: today } })
    fireEvent.click(screen.getByRole('button', { name: 'Show orders' }))
    expect(await screen.findByText('Choose a day that is today or earlier.')).toBeDefined()
    await waitFor(() => expect(orders.list).toHaveBeenCalledTimes(4))
    expect(call(2)).toMatchObject({ since: today })
    expect(call(3)).toEqual({ kind: 'all', openOnly: false, limit: 25, since: earliest })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('listitem', { name: 'Full blood count' })).toBeDefined()
    expect(screen.getByText(`Showing orders from ${dayWords(earliest)} and everything still open.`)).toBeDefined()

    // The day it took is refused in turn (now too far back): the backend's own 90 days are read and said.
    orders.list.mockRejectedValueOnce(refused(400, 'MY_ORDERS_SINCE_TOO_OLD'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('You can look back up to 2 years. Choose a later date.')).toBeDefined()
    await waitFor(() => expect(orders.list).toHaveBeenCalledTimes(6))
    expect(call(5)).toEqual({ kind: 'all', openOnly: false, limit: 25 })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('listitem', { name: 'Full blood count' })).toBeDefined()
    expect(screen.getByText('Showing the last 90 days and everything still open.')).toBeDefined()
    plainWords()
  })

  it('reads again only when a filter changes: the tab already chosen reads nothing', async () => {
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Show' })).getByRole('button', { name: 'All' }))
    await act(async () => {})
    expect(orders.list).toHaveBeenCalledTimes(1)
  })

  it('says when each order was made in Lagos time, as its progress is', async () => {
    open()
    const lab = await screen.findByRole('listitem', { name: 'Full blood count' })
    // createdAt 09:15 UTC is 10:15 in Lagos.
    expect(within(lab).getByText('20 Nov 2026, 10:15')).toBeDefined()
  })

  it('drops an answer that comes after the member moved on to another tab', async () => {
    let first!: (value: unknown) => void
    orders.list.mockReturnValueOnce(new Promise(resolve => { first = resolve }))
    open()
    orders.list.mockResolvedValueOnce(page([prescription()], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Show' })).getByRole('button', { name: 'Prescriptions' }))
    expect(await screen.findByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })).toBeDefined()
    await act(async () => { first(page([order()])) })
    expect(screen.queryByRole('listitem', { name: 'Full blood count' })).toBeNull()

    // A Load more still reading when the tab changes is dropped too.
    let more!: (value: unknown) => void
    orders.list.mockReturnValueOnce(new Promise(resolve => { more = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    orders.list.mockResolvedValueOnce(page([order()]))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Show' })).getByRole('button', { name: 'Lab' }))
    expect(await screen.findByRole('list', { name: 'Lab requests' })).toBeDefined()
    await act(async () => { more(page([prescription({ orderId: 'b0000000-0000-4000-8000-000000000002', display: 'Paracetamol 500 mg tablet' })])) })
    expect(screen.queryByRole('listitem', { name: 'Paracetamol 500 mg tablet' })).toBeNull()
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1)
  })

  it('reads the next page once when Load more is pressed twice', async () => {
    orders.list.mockResolvedValueOnce(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    let next!: (value: unknown) => void
    orders.list.mockReturnValueOnce(new Promise(resolve => { next = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(orders.list).toHaveBeenCalledTimes(2)
    await act(async () => { next(page([prescription()])) })
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
  })

  it('holds Load more while Refresh reads', async () => {
    orders.list.mockResolvedValueOnce(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    let fresh!: (value: unknown) => void
    orders.list.mockReturnValueOnce(new Promise(resolve => { fresh = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByRole('button', { name: 'Load more' }).matches(':disabled')).toBe(true)
    await act(async () => { fresh(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA2' })) })
    expect(screen.getByRole('button', { name: 'Load more' }).matches(':disabled')).toBe(false)
  })

  it('offers Load more while a cursor is set, also after a short or empty page, and adds what it reads', async () => {
    orders.list.mockResolvedValueOnce(page([], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    open()
    const more = await screen.findByRole('button', { name: 'Load more' })
    // An empty page with a cursor is not the end of the list.
    expect(screen.queryByText('No orders')).toBeNull()
    orders.list.mockResolvedValueOnce(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA2' }))
    fireEvent.click(more)
    expect(await screen.findByRole('listitem', { name: 'Full blood count' })).toBeDefined()
    expect(call(1)).toEqual({ kind: 'all', openOnly: false, limit: 25, cursor: 'cursorAAAAAAAAAAAAAA1' })
    orders.list.mockResolvedValueOnce(page([prescription()]))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })).toBeDefined()
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
  })

  it('starts again from the top when the list changed under its cursor, and says so', async () => {
    orders.list.mockResolvedValueOnce(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    orders.list.mockRejectedValueOnce(refused(400, 'INVALID_CURSOR', 'Pagination cursor is invalid'))
    orders.list.mockResolvedValueOnce(page([prescription(), order()]))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Your orders changed. Showing them again from the start.')).toBeDefined()
    expect(call(2)).not.toHaveProperty('cursor')
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
    plainWords()
  })

  it('keeps the rows and says so when more could not be loaded', async () => {
    orders.list.mockResolvedValueOnce(page([order()], { nextCursor: 'cursorAAAAAAAAAAAAAA1' }))
    open()
    await screen.findByRole('listitem', { name: 'Full blood count' })
    orders.list.mockRejectedValueOnce(refused(503, 'MY_ORDERS_UNAVAILABLE'))
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('More orders could not be loaded. Your orders cannot be listed right now. Please try again.')).toBeDefined()
    expect(screen.getByRole('listitem', { name: 'Full blood count' })).toBeDefined()
  })

  it.each([
    [1, true, '1 more order is for a patient whose records you can no longer open.'],
    [3, true, '3 more orders are for patients whose records you can no longer open.'],
    [1, false, 'At least 1 more order is for a patient whose records you can no longer open.'],
    [20000, false, 'At least 20000 more orders are for patients whose records you can no longer open.'],
  ])('counts %i hidden orders (complete: %s)', async (count, complete, words) => {
    orders.list.mockResolvedValueOnce(page([], { hiddenCount: count, hiddenCountComplete: complete }))
    open()
    expect(await screen.findByText(words)).toBeDefined()
    expect(screen.getByText('No orders')).toBeDefined()
    expect(hiddenText(0, true)).toBe('')
  })

  it.each([
    [400, 'MY_ORDERS_SINCE_TOO_OLD', 'You can look back up to 2 years. Choose a later date.', true],
    // With no day chosen, a refused request is not about a day: it never tells the member to choose one.
    [400, 'VALIDATION_FAILED', 'The list could not be shown as asked. Reload the page and try again.', true],
    [400, 'INVALID_CURSOR', 'Your orders changed. Showing them again from the start.', true],
    [400, 'PURPOSE_OF_USE_REQUIRED', 'Ordered by me is for patient care only. Reload the page and try again.', true],
    [403, 'PERMISSION_DENIED', 'Ordered by me shows the tests and medicines you ordered here. It is for staff who order them.', false],
    [403, 'MY_ORDERS_NOT_PERMITTED', 'Your staff account at this facility is not active right now, so your orders cannot be listed. Ask your facility administrator.', false],
    [503, 'MY_ORDERS_UNAVAILABLE', 'Your orders cannot be listed right now. Please try again.', true],
  ])('says %i %s in plain words', async (status, code, words, retry) => {
    orders.list.mockRejectedValueOnce(refused(status, code, 'Required permission is missing'))
    open()
    expect(await screen.findByText(words)).toBeDefined()
    expect(!!screen.queryByRole('button', { name: 'Try again' })).toBe(retry)
    expect(document.body.textContent).not.toContain(code)
    plainWords()
    if (retry) {
      orders.list.mockResolvedValueOnce(page([order()]))
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
      expect(await screen.findByRole('listitem', { name: 'Full blood count' })).toBeDefined()
    }
  })

  it('has plain words for every refusal code the route answers', () => {
    expect(Object.keys(MY_ORDERS_REFUSALS).sort()).toEqual(expect.arrayContaining(['INVALID_CURSOR', 'MY_ORDERS_SINCE_TOO_OLD',
      'MY_ORDERS_UNAVAILABLE', 'PERMISSION_DENIED', 'PURPOSE_OF_USE_REQUIRED', 'VALIDATION_FAILED']))
    for (const words of Object.values(MY_ORDERS_REFUSALS)) expect(words).not.toMatch(/permission|unverified|[–—]|[A-Z]{2,}_/i)
  })

  it.each([
    ['lab_request', { status: 'not_received', receivedAt: null }, null],
    ['lab_request', { status: 'unknown' }, 'Progress not available right now'],
    ['lab_request', { status: 'sample_collected', collectedAt: '2026-11-20T08:30:00.000Z' }, /^Sample taken/],
    ['lab_request', { status: 'some_results_ready', lastResultAt: '2026-11-20T10:05:00.000Z' }, /^Some results ready/],
    ['lab_request', { status: 'results_ready', lastResultAt: '2026-11-20T10:05:00.000Z' }, /^Results ready/],
    ['prescription', { status: 'accepted', acceptedAt: '2026-11-20T09:52:00.000Z', receivedAt: '2026-11-20T09:40:00.000Z' }, /^Accepted/],
    ['prescription', { status: 'accepted', acceptedAt: null, receivedAt: '2026-11-20T09:40:00.000Z' }, /^Received/],
    ['prescription', { status: 'dispensing_reversed', reversedAt: '2026-11-20T12:00:00.000Z' }, /^Dispensing reversed/],
    ['prescription', { status: 'withdrawn' }, 'Changed or stopped by the prescribing team'],
    ['prescription', { status: 'sent_elsewhere' }, 'Sent to another pharmacy by the prescribing team'],
    ['prescription', { status: 'results_ready' }, 'Progress not available right now'],
  ])('says %s progress %j in ORD-3’s words', async (kind, ownProgress, words) => {
    const item = kind === 'lab_request' ? order({ ownProgress }) : prescription({ ownProgress })
    orders.list.mockResolvedValueOnce(page([item]))
    open()
    const row = await screen.findByRole('listitem', { name: kind === 'lab_request' ? 'Full blood count' : 'Amoxicillin 500 mg capsule' })
    if (words === null) expect(within(row).queryByText('Progress')).toBeNull()
    else expect(within(row).getByText(words)).toBeDefined()
  })

  it('names the pharmacy a prescription was sent to, from its route', async () => {
    const route = {
      id: 'r0000000-0000-4000-8000-000000000001', version: 1, kind: 'prescription', state: 'sent', effectiveState: 'sent',
      receivingFacility: { id: 'f0000000-0000-4000-8000-000000000009', name: 'Demo Pharmacy' }, respondBy: '2026-11-27T09:00:00.000Z',
      acceptLocked: false, resendAllowed: false, sentAt: '2026-11-20T09:00:00.000Z',
    }
    orders.list.mockResolvedValueOnce(page([prescription({ ownProgress: { status: 'sent_elsewhere' }, orderRoute: route })]))
    open()
    const row = await screen.findByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(row).getByText('Sent to Demo Pharmacy by the prescribing team')).toBeDefined()
  })

  it('opens an order only for the patient open now, and otherwise points to Patients', async () => {
    orders.list.mockResolvedValue(page([order(), prescription({ patient: { patientId: OTHER_PATIENT, fullName: 'Patient Two', sex: null,
      dateOfBirth: null, healthIdLast4: null } })]))
    staff.activePatient = activePatient('direct-care')
    open()
    const lab = await screen.findByRole('listitem', { name: 'Full blood count' })
    const link = within(lab).getByRole('link', { name: 'Open the lab request →' })
    expect(link.getAttribute('href')).toBe('/provider/clinical')
    const rx = screen.getByRole('listitem', { name: 'Amoxicillin 500 mg capsule' })
    expect(within(rx).queryByRole('link', { name: /Open the/ })).toBeNull()
    expect(rx.textContent).toContain('To see it, open Patient Two’s record from Patients, then select Open the prescription here.')
    expect(within(rx).getByRole('link', { name: 'Patients' }).getAttribute('href')).toBe('/provider/patients')
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/provider/clinical')
    plainWords()
  })

  it('does not open an order under emergency access', async () => {
    staff.activePatient = activePatient('emergency')
    open()
    const lab = await screen.findByRole('listitem', { name: 'Full blood count' })
    expect(within(lab).queryByRole('link', { name: /Open the/ })).toBeNull()
  })
})

describe('the answer, read defensively', () => {
  it('drops rows without their ids, keeps the Health ID to 4 characters, and counts from 0', () => {
    const read = readMyOrdersPage({
      items: [order(), { ...order(), orderId: '' }, { ...order(), patient: null }, { ...order(), kind: 'imaging' },
        order({ orderId: RX_ORDER, patient: { patientId: PATIENT_ID, fullName: PATIENT_NAME, healthIdLast4: 'HID-ZDEMAAA2' } })],
      hiddenCount: -4, nextCursor: '',
    })
    expect(read.items.map(item => item.orderId)).toEqual([LAB_ORDER, RX_ORDER])
    expect(read.items[1]!.patient.healthIdLast4).toBe('AAA2')
    expect(read).toMatchObject({ hiddenCount: 0, hiddenCountComplete: true, nextCursor: null, since: '' })
    expect(readMyOrdersPage({ items: [], hiddenCount: 7.6, hiddenCountComplete: false })).toMatchObject({ hiddenCount: 7, hiddenCountComplete: false })
    expect(readMyOrdersPage(null)).toMatchObject({ items: [], hiddenCount: 0 })
  })

  it('checks a day before it is sent', () => {
    expect(sinceProblem('', '2026-11-25')).toBe('Choose the day to show orders from.')
    expect(sinceProblem('2026-11-26', '2026-11-25')).toBe('Choose a day that is today or earlier.')
    expect(sinceProblem('2024-11-24', '2026-11-25')).toBe('You can look back up to 2 years. Choose a later date.')
    expect(sinceProblem('2024-11-25', '2026-11-25')).toBe('')
    expect(earliestSince('2028-02-29')).toBe('2026-02-28')
  })
})
