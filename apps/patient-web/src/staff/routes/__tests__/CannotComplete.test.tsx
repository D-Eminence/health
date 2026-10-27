import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory, Pharmacy } from '../Operations'
import { forgetReceiving, routeMoment } from '../../orderRoutes'
import { forgetCannotCompleteServed } from '../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { focusWhenShown } from '../../../__tests__/focusWhenShown'

/**
 * D18 (hid-system 0091; SPEC-FINAL §9.1, §10.3): "We can't complete this order" on the Laboratory and Pharmacy pages.
 * Dormant until the work list says `cannotComplete: true`; then offered on an accepted routed row below "This isn't the
 * order's patient", one form at a time, with the reasons of its kind, the identity statement, the phone and
 * critical-value statements where required, one key per identical request, the refusals in the row's or the list's
 * words when the list read again closes the form (also for item 3's form), the endings kept until each is closed, and the
 * row afterwards; and in "Correct an order that has ended" for an order found still open and accepted.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn(), createLabAccession: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))
const working = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1',
    name: 'Yaba Diagnostics', roles: ['lab'], permissions: working.permissions } } } } }),
}))

const LAB = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read', 'lab.order-route.receive']
const PHARMACY = ['pharmacy.work-item.read', 'pharmacy.dispensing.create', 'pharmacy.order-route.receive']
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const routeCard = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted',
  access: 'work', orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', version: 3, endedKind: null, ...overrides })
const PATIENT = { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' }
const labItem = (overrides: Record<string, unknown> = {}) => ({ id: 'w-routed', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
  version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: null, accessionNumber: null,
  acceptedAt: '2026-10-21T10:00:00.000Z', priority: 'routine', specimenStatuses: [], orderRoute: routeCard(), patient: PATIENT,
  ...overrides })
const local = { id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb', version: 1, status: 'accepted',
  testName: 'Malaria parasite', accessionId: null, accessionNumber: null, acceptedAt: '2026-10-21T09:00:00.000Z' }
const prescription = (overrides: Record<string, unknown> = {}) => ({ id: 'p1', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
  version: 1, acceptedAt: '2026-10-21T10:00:00.000Z', medication: { display: 'Amoxicillin 500 mg capsules' }, doseQuantity: 500,
  doseUnit: 'mg', routeCode: 'oral', frequency: 'Three times daily', instructions: null, dispensing: null, orderRoute: routeCard(),
  patient: PATIENT, ...overrides })
/** Today's answers (hid-system a3b1822): item 3's numeric versions, item 4's fields and D17's lateCorrection, no D18. */
const today = (...items: unknown[]) => ({ items, crossFacilityOrders: true, crossFacilityWork: true, receives: true,
  routesHere: { waiting: false, held: true }, lateCorrection: true })
const served = (...items: unknown[]) => ({ ...today(...items), cannotComplete: true })
const ENDED = { route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'receiving_unable' },
  reason: 'supplies_unavailable', readUntil: new Date(Date.now() - 1000).toISOString(), specimensCollected: 0, resultsRecorded: 0,
  criticalCandidates: 0, replayed: false }
const endedCard = (overrides: Record<string, unknown> = {}) => routeCard({ effectiveState: 'cancelled', access: 'read',
  endedKind: 'receiving_unable', version: 4, ...overrides })

/** An acceptance this many days ago: the reads kept after an ending never last past the order's 30 days (D18-2). */
const acceptedDaysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

const WP = 'This isn’t the order’s patient'
const CC = 'We can’t complete this order'
const NAMED = ': Haemoglobin, Ref 9C1B2D3E'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working.permissions = LAB
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true, receives: true })
  routes.cannotComplete.mockResolvedValue(ENDED)
  api.labWorkItems.mockResolvedValue(served(labItem(), local))
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  vi.unstubAllEnvs(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
// A request answered outside act, as a fetch's answer arrives, renders in one task and runs its effects in a later one.
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = undefined })

function row(text: string) { return screen.getByText(text).closest('.staff-list-item') as HTMLElement }
async function openLab() {
  render(<MemoryRouter><Laboratory /></MemoryRouter>)
  await screen.findByText('Haemoglobin')
  return row('Haemoglobin')
}
function form(within_: HTMLElement) { return within(within_).getByRole('form', { name: 'End this order: we can’t complete it' }) }
function fill(area: HTMLElement, { reason = 'Reagents or test kits have run out', confirm = true }: { reason?: string | null; confirm?: boolean } = {}) {
  if (reason) fireEvent.click(within(area).getByRole('radio', { name: reason }))
  if (confirm) fireEvent.click(within(area).getByRole('checkbox', { name: /^The person we accepted this/ }))
}
const submit = (area: HTMLElement) => fireEvent.click(within(area).getByRole('button', { name: 'End it: we can’t complete it' }))

describe('dormant until the backend serves it (D18-13)', () => {
  it('offers nothing new against today’s answers, which carry item 3’s, item 4’s and D17’s signals but no cannotComplete', async () => {
    api.labWorkItems.mockResolvedValue(today(labItem(), local))
    const item = await openLab()
    await within(item).findByRole('button', { name: WP })
    // Item 3's button reads exactly as before: no hidden item name either.
    expect(within(item).getAllByRole('button').map(button => button.textContent)).toEqual(['Prepare accession', WP])
    expect(within(item).getByRole('button', { name: WP })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/can’t complete|couldn’t complete/)
    // Item 3's form keeps today's sentence.
    fireEvent.click(within(item).getByRole('button', { name: WP }))
    expect(within(item).getByText('If you can’t do the test, don’t use this either: phone General Hospital.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/can’t complete it|We can’t complete/)
    expect(routes.cannotComplete).not.toHaveBeenCalled()
  })

  it('reads only `cannotComplete: true` as served', async () => {
    api.labWorkItems.mockResolvedValue({ ...today(labItem()), cannotComplete: 'true' })
    const item = await openLab()
    await within(item).findByRole('button', { name: WP })
    expect(within(item).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
  })

  it('keeps today’s words on a Pharmacy row too', async () => {
    working.permissions = PHARMACY
    api.pharmacyWorkItems.mockResolvedValue(today(prescription()))
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    const item = (await screen.findByText('Amoxicillin 500 mg capsules')).closest('.staff-list-item') as HTMLElement
    expect(await within(item).findByRole('button', { name: WP })).toBeTruthy()
    expect(within(item).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
  })
})

describe('the button on a routed work row, once served', () => {
  it('sits below “This isn’t the order’s patient”, both naming the order they act on (WB14)', async () => {
    const item = await openLab()
    const wrong = await within(item).findByRole('button', { name: `${WP}${NAMED}` })
    const cannot = within(item).getByRole('button', { name: `${CC}${NAMED}` })
    expect(wrong.compareDocumentPosition(cannot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row('Malaria parasite').textContent).not.toMatch(/can’t complete|isn’t the order’s patient/)
  })

  it('is offered only on an accepted order the route still lets this facility work, to a member who receives', async () => {
    api.labWorkItems.mockResolvedValue(served(
      labItem(),
      labItem({ id: 'w-done', testName: 'Lipid profile', orderRoute: routeCard({ effectiveState: 'completed', version: 5 }) }),
      labItem({ id: 'w-lapsed', testName: 'Blood film', orderRoute: routeCard({ effectiveState: 'expired', access: 'read' }) }),
      labItem({ id: 'w-read', testName: 'Urea', orderRoute: routeCard({ access: 'read' }) }),
      labItem({ id: 'w-ended', testName: 'Sodium', orderRoute: endedCard() }),
      labItem({ id: 'w-old', testName: 'Creatinine', orderRoute: routeCard({ version: undefined }) })))
    await openLab()
    await within(row('Haemoglobin')).findByRole('button', { name: `${CC}${NAMED}` })
    const offered = (text: string) => within(row(text)).queryByRole('button', { name: new RegExp(`^${CC}`) }) !== null
    expect(offered('Haemoglobin')).toBe(true)
    // A completed order still offers item 3's report, not this (D18-1).
    expect(within(row('Lipid profile')).getByRole('button', { name: /^This isn’t the order’s patient/ })).toBeTruthy()
    expect(['Lipid profile', 'Blood film', 'Urea', 'Sodium', 'Creatinine'].filter(offered)).toEqual([])
  })

  it('is not offered without the receive permission', async () => {
    working.permissions = ['lab.work-item.read', 'lab.accession.create']
    const item = await openLab()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalled())
    expect(within(item).queryByRole('button', { name: /^This isn’t the order’s patient|^We can’t complete/ })).toBeNull()
  })

  it('opens one form at a time, with focus on its title, and Cancel returns focus to the button that opened it', async () => {
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    const opened = form(item)
    expect(document.activeElement).toBe(within(opened).getByText('End this order: we can’t complete it'))
    expect(within(item).queryByRole('button', { name: /^This isn’t the order’s patient/ })).toBeNull()
    fireEvent.click(within(opened).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(within(row('Haemoglobin')).getByRole('button', { name: `${CC}${NAMED}` })))
    // Item 3's form, once D18 is served here, says where the other action is (WB3), and hides it while open (WB2).
    fireEvent.click(within(row('Haemoglobin')).getByRole('button', { name: `${WP}${NAMED}` }))
    expect(within(row('Haemoglobin')).getByText('If you can’t complete it for another reason, don’t use this: press Cancel and '
      + 'use “We can’t complete this order” below.')).toBeTruthy()
    expect(within(row('Haemoglobin')).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
    fireEvent.click(within(row('Haemoglobin')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(within(row('Haemoglobin')).getByRole('button', { name: `${WP}${NAMED}` })))
  })

  // Cancel gives focus back in the commit that shows the button again: from a timer a task later, a check made as soon as
  // the button was shown found focus on the page.
  it.each([[CC], [WP]])('has focus on “%s” as soon as Cancel shows it again', async name => {
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${name}${NAMED}` }))
    const shown = focusWhenShown(() => within(item).queryByRole('button', { name: `${name}${NAMED}` }))
    fireEvent.click(within(item).getByRole('button', { name: 'Cancel' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})

describe('the laboratory’s form', () => {
  it('says first that it is not for the wrong person, then what will happen, and asks why, none chosen', async () => {
    api.labWorkItems.mockResolvedValue(served(labItem({ accessionId: 'acc-1', accessionNumber: 'ACC-1', specimenStatuses: ['collected'],
      acceptedAt: acceptedDaysAgo(6) })))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    const opened = form(item)
    const texts = [...opened.querySelectorAll('p')].map(paragraph => paragraph.textContent)
    expect(texts).toEqual([
      'Use this when you accepted this order but can’t finish it here: the test isn’t offered after all, something has run out '
        + 'or is out of service, the sample can’t be used, or Tunde Bello chose not to go ahead or left.',
      'If the person you accepted it for was not Tunde Bello, don’t use this: use “This isn’t the order’s patient”. If you '
        + 'couldn’t confirm who they were and think someone may have used Tunde Bello’s details, use it too.',
      'If you know before accepting an order that you can’t do it, decline it: General Hospital can then send it elsewhere. Once '
        + 'you have accepted it, General Hospital has to write a new order.',
      'If a sample can’t be used, record its rejection first, under Open accession: nothing more can be recorded once the order '
        + 'has ended.',
      'If a result on this order has been checked, release it instead, or correct it first if it is wrong: an order with a '
        + 'checked result can’t be ended here.',
      'What will happen'])
    expect([...opened.querySelectorAll('ul li')].map(entry => entry.textContent)).toEqual([
      'Nothing more can be recorded on this order. You can still read it for 7 days.',
      'Nothing you recorded on it is sent to General Hospital: results you have not released stay in your records only. Don’t '
        + 'discard a sample that can still be used until you have spoken to General Hospital.',
      'General Hospital sees on the order that you couldn’t complete it, and why. Health ID does not alert them: phone them if '
        + 'it is urgent.',
      'Tunde Bello is told in the Health ID app, if they use it. This can’t be undone.'])
    expect(within(opened).getByRole('group', { name: 'Why can’t you complete it?' })).toBeTruthy()
    const radios = within(opened).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(radio => radio.closest('label')!.textContent!.trim())).toEqual(['We don’t do this test after all',
      'Reagents or test kits have run out', 'The analyser or other equipment is out of service, or there is no power',
      'The sample can’t be used, and a new one can’t be recorded on this order', 'We couldn’t take a sample',
      'We can’t do it in time for its priority', 'The patient chose not to go ahead', 'The patient left, or didn’t come back',
      'Another reason'])
    expect(radios.some(radio => radio.checked)).toBe(false)
    expect(within(opened).getByRole('checkbox', { name: 'The person we accepted this order for was Tunde Bello, and we can’t '
      + 'complete it here.' })).toBeTruthy()
    // Routine, and no must-phone reason chosen: no phone statement yet.
    expect(within(opened).queryByRole('checkbox', { name: /We will phone/ })).toBeNull()
    expect(within(opened).queryByText(/collecting/)).toBeNull()
  })

  it('says when the reads kept end once the order’s 30 days end within the 7 (D18-2), and “up to” without its acceptance',
    async () => {
      const accepted = acceptedDaysAgo(28)
      api.labWorkItems.mockResolvedValue(served(labItem({ accessionId: 'acc-1', accessionNumber: 'ACC-1',
        specimenStatuses: ['received'], acceptedAt: accepted }), labItem({ id: 'w-2', testName: 'Urea', accessionId: 'acc-2',
        accessionNumber: 'ACC-2', acceptedAt: undefined, orderRoute: routeCard({ id: 'r-2', reference: 'AAAA1111' }) })))
      const item = await openLab()
      fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
      const ends = new Date(Date.parse(accepted) + 30 * 86_400_000).toISOString()
      expect(within(item).getByText(`Nothing more can be recorded on this order. You can still read it until ${routeMoment(ends)}, `
        + 'when its 30 days end.')).toBeTruthy()
      expect(within(item).queryByText(/read it for 7 days/)).toBeNull()
      fireEvent.click(within(row('Urea')).getByRole('button', { name: `${CC}: Urea, Ref AAAA1111` }))
      expect(within(row('Urea')).getByText('Nothing more can be recorded on this order. You can still read it for up to 7 days, and '
        + 'never after its 30 days end.')).toBeTruthy()
    })

  it('says a received sample can no longer be rejected, and that reads end at once without an accession', async () => {
    api.labWorkItems.mockResolvedValue(served(labItem({ specimenStatuses: ['received'] }), labItem({ id: 'w-2', testName: 'Urea',
      orderRoute: routeCard({ id: 'r-2', reference: 'AAAA1111' }) })))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    expect(within(item).getByText('This sample was already received, so its rejection can’t be recorded: the order’s ending '
      + 'records why.')).toBeTruthy()
    expect(within(item).queryByText(/record its rejection first/)).toBeNull()
    expect(within(item).getByText('Nothing more can be recorded on this order. You stop seeing Tunde Bello’s details on this order at once.')).toBeTruthy()
    fireEvent.click(within(row('Urea')).getByRole('button', { name: `${CC}: Urea, Ref AAAA1111` }))
    expect(within(row('Urea')).queryByText(/rejection/)).toBeNull()
  })

  it('needs a reason, the phone statement where required, and the identity statement before it sends anything', async () => {
    api.labWorkItems.mockResolvedValue(served(labItem({ priority: 'urgent' })))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    const opened = form(item)
    // An urgent request: the phone statement is required whatever the reason (D18-8).
    expect(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' })).toBeTruthy()
    submit(opened)
    expect(within(opened).getByText('Choose why you can’t complete it.')).toBeTruthy()
    expect(document.activeElement).toBe(within(opened).getByRole('radio', { name: 'We don’t do this test after all' }))
    fireEvent.click(within(opened).getByRole('radio', { name: 'Another reason' }))
    submit(opened)
    expect(within(opened).getByText('Tick the box to confirm that you will phone General Hospital now.')).toBeTruthy()
    expect(document.activeElement).toBe(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' }))
    fireEvent.click(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' }))
    submit(opened)
    expect(within(opened).getByText('Tick the box to confirm that the person was the order’s patient.')).toBeTruthy()
    expect(routes.cannotComplete).not.toHaveBeenCalled()
  })

  it('asks for the phone statement for “can’t do it in time” on a routine request, and only then', async () => {
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    const opened = form(item)
    fireEvent.click(within(opened).getByRole('radio', { name: 'We can’t do it in time for its priority' }))
    expect(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' })).toBeTruthy()
    fireEvent.click(within(opened).getByRole('radio', { name: 'Reagents or test kits have run out' }))
    expect(within(opened).queryByRole('checkbox', { name: /We will phone/ })).toBeNull()
  })

  it('sends the reason and the statement with one key, kept after no answer, and says what follows, until closed', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem(), local)).mockResolvedValue(served(local))
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(503, 'Down', { code: 'ORDER_ROUTE_UNAVAILABLE' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    expect(await within(item).findByText('Health ID did not answer, so it may or may not have ended. Press “End it: we can’t '
      + 'complete it” again: if it went through, Health ID says so.')).toBeTruthy()
    // No answer: the form stays, and the list is not read again.
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
    submit(form(row('Haemoglobin')))
    await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\./)
    expect(routes.cannotComplete).toHaveBeenCalledTimes(2)
    const [first, second] = routes.cannotComplete.mock.calls
    expect(first).toEqual(['facility-1', 'lab', { id: ROUTE_ID, version: 3 }, { reason: 'supplies_unavailable', confirmedPatient: true },
      expect.any(String)])
    expect(second![4]).toBe(first![4])
    const said = screen.getByText(/^Ended: Haemoglobin/).closest('.staff-notice') as HTMLElement
    expect(said.className).not.toContain('staff-danger')
    expect([...said.querySelectorAll('strong, p')].map(line => line.textContent)).toEqual([
      'Ended: Haemoglobin, reference 9C1B2D3E. General Hospital sees on the order that you couldn’t complete it, and why; Tunde '
        + 'Bello is told in the Health ID app, if they use it.',
      'Health ID does not alert General Hospital: phone them if it is urgent.',
      'It leaves your work list now: keep the reference 9C1B2D3E for General Hospital’s call.',
      'If you find out later that you accepted it for someone who was not Tunde Bello, use “Correct an order that has ended” '
        + 'with reference 9C1B2D3E.'])
    expect(document.activeElement).toBe(within(said).getByText(/^Ended: Haemoglobin/))
    await waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull())
    expect(screen.getByText('Malaria parasite')).toBeTruthy()
    fireEvent.click(within(said).getByRole('button', { name: 'Close: Haemoglobin, Ref 9C1B2D3E' }))
    expect(screen.queryByText(/^Ended: Haemoglobin/)).toBeNull()
  })

  // What follows takes focus in the same commit that shows it (an effect a task later let a check made as soon as it was
  // shown find focus on the page: health#16's CI, on the late form's equivalent).
  it('has focus on what follows as soon as it is shown', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem(), local)).mockResolvedValue(served(local))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    const shown = new Promise<{ message: Element; focused: Element | null }>(resolve => {
      const observer = new MutationObserver(() => {
        const message = [...document.querySelectorAll('strong')].find(element => element.textContent?.startsWith('Ended: Haemoglobin'))
        if (!message) return
        observer.disconnect()
        resolve({ message, focused: document.activeElement })
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    submit(form(item))
    const { message, focused } = await shown
    expect(focused).toBe(message)
  })

  it('takes a new key once a refusal settled the request', async () => {
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Ready', { code: 'ORDER_ROUTE_RESULT_READY' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    expect(await within(item).findByText('A checked result is waiting to be released on this order. Release it under Open '
      + 'accession or, if it is wrong, correct it there first. If you can’t, phone General Hospital.')).toBeTruthy()
    submit(form(item))
    await waitFor(() => expect(routes.cannotComplete).toHaveBeenCalledTimes(2))
    expect(routes.cannotComplete.mock.calls[1]![4]).not.toBe(routes.cannotComplete.mock.calls[0]![4])
  })

  it('reads the list again after 412 and keeps the form open at the order’s new version', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem())).mockResolvedValue(served(labItem({ orderRoute: routeCard({ version: 4 }) })))
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(412, 'Changed', { code: 'VERSION_CONFLICT' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    expect(await within(item).findByText('This order changed a moment ago. It has been reloaded: check and try again.')).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    submit(form(row('Haemoglobin')))
    await waitFor(() => expect(routes.cannotComplete).toHaveBeenCalledTimes(2))
    expect(routes.cannotComplete.mock.calls[1]![2]).toEqual({ id: ROUTE_ID, version: 4 })
  })

  // Asked for by a refusal, the statement takes focus in the commit that shows it, not in an effect a task later.
  it('has focus on the critical-value statement as soon as it is asked for', async () => {
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Critical', { code: 'ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    const shown = focusWhenShown(() => within(item).queryByRole('checkbox', { name: /about the possibly critical value/ }))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    submit(form(item))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('asks for the critical-value statement after Lab says a value is possibly critical, then sends it with a new key', async () => {
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Critical', { code: 'ORDER_ROUTE_CRITICAL_VALUE_NOT_TOLD' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    expect(await within(item).findByText('A result recorded on this order is marked as possibly critical. Phone General Hospital '
      + 'about it now, then tick the box and end the order again.')).toBeTruthy()
    const tick = within(item).getByRole('checkbox', { name: 'We have phoned General Hospital about the possibly critical value on this order.' })
    await waitFor(() => expect(document.activeElement).toBe(tick))
    submit(form(item))
    expect(within(item).getByText('Tick the box to confirm that you have phoned General Hospital about the possibly critical value.')).toBeTruthy()
    expect(routes.cannotComplete).toHaveBeenCalledTimes(1)
    fireEvent.click(tick)
    submit(form(item))
    await waitFor(() => expect(routes.cannotComplete).toHaveBeenCalledTimes(2))
    expect(routes.cannotComplete.mock.calls[1]![3]).toEqual({ reason: 'supplies_unavailable', confirmedPatient: true, criticalValueTold: true })
    expect(routes.cannotComplete.mock.calls[1]![4]).not.toBe(routes.cannotComplete.mock.calls[0]![4])
  })

  it('keeps two endings in a row, newest first, each closed on its own, with a sample and a result kept 7 days', async () => {
    const second = labItem({ id: 'w-2', testName: 'Urea', accessionId: 'acc-2', accessionNumber: 'ACC-2', specimenStatuses: ['received'],
      orderRoute: routeCard({ id: 'r-2', reference: 'AAAA1111' }) })
    api.labWorkItems.mockResolvedValueOnce(served(labItem(), second))
      .mockResolvedValueOnce(served(second))
      .mockResolvedValue(served(labItem({ id: 'w-2', testName: 'Urea', orderRoute: endedCard({ id: 'r-2', reference: 'AAAA1111' }) })))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    await screen.findByText(/^Ended: Haemoglobin/)
    await waitFor(() => expect(screen.queryByText('Haemoglobin')).toBeNull())
    routes.cannotComplete.mockResolvedValueOnce({ ...ENDED, route: { ...ENDED.route, id: 'r-2' }, reason: 'equipment_unavailable',
      readUntil: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(), specimensCollected: 1, resultsRecorded: 1 })
    fireEvent.click(within(row('Urea')).getByRole('button', { name: `${CC}: Urea, Ref AAAA1111` }))
    fill(form(row('Urea')), { reason: 'The analyser or other equipment is out of service, or there is no power' })
    submit(form(row('Urea')))
    await screen.findByText(/^Ended: Urea/)
    const entries = [...document.querySelectorAll('.staff-notice strong')].map(line => line.textContent).filter(line => line?.startsWith('Ended:'))
    expect(entries).toEqual([expect.stringMatching(/^Ended: Urea, reference AAAA1111\./), expect.stringMatching(/^Ended: Haemoglobin/)])
    const urea = screen.getByText(/^Ended: Urea/).closest('.staff-notice') as HTMLElement
    expect(urea.textContent).toContain('Keep the sample, stored as your procedure requires, until you have spoken to General '
      + 'Hospital: they may want it sent to another laboratory.')
    expect(urea.textContent).toContain('If any value was critical, tell Tunde Bello or General Hospital directly, following your '
      + 'laboratory’s procedure.')
    expect(urea.textContent).toMatch(/It stays on your work list, marked ended, until /)
    // The row stays, marked ended, with nothing more to record, and where to go if it was the wrong person (D17 served).
    expect(await within(row('Urea')).findByText('You ended this order: you couldn’t complete it. Nothing more can be recorded on it. '
      + 'If you accepted it for the wrong person, use “Correct an order that has ended” with reference AAAA1111.')).toBeTruthy()
    expect(within(row('Urea')).queryByRole('button', { name: /^We can’t|^This isn’t|Prepare accession/ })).toBeNull()
    fireEvent.click(within(urea).getByRole('button', { name: 'Close: Urea, Ref AAAA1111' }))
    expect(screen.queryByText(/^Ended: Urea/)).toBeNull()
    expect(screen.getByText(/^Ended: Haemoglobin/)).toBeTruthy()
  })

  it('adds to the cap notice that an order past it can be ended from the lookup', async () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ ...local, id: `w-${index}` }))
    api.labWorkItems.mockResolvedValue(served(...many))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    expect(await screen.findByText('To end one you can’t complete, find it by its reference under “Correct an order that has '
      + 'ended”.')).toBeTruthy()
  })

  it('says nothing new on the cap notice against today’s answers', async () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ ...local, id: `w-${index}` }))
    api.labWorkItems.mockResolvedValue(today(...many))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText(/^This list can show only the 200 oldest/)
    expect(screen.queryByText(/can’t complete/)).toBeNull()
  })
})

/**
 * A refusal after which the list read again no longer offers the form (D17's UX-2 for these forms; WB1): its words move
 * into the row, beside its first line, with focus there, or above the list when the row is gone. Item 3's row action keeps
 * its words the same way, whether or not D18 is served.
 */
describe('a refusal whose new list closes the form', () => {
  it('keeps “already ended” in the row, with focus on it', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem()))
      .mockResolvedValue(served(labItem({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'support', version: 4 }) })))
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    const said = await within(row('Haemoglobin')).findByRole('alert')
    expect(said.textContent).toBe('This order has already ended, so it can’t be ended here. If you accepted it for the wrong '
      + 'person, use “Correct an order that has ended” above the work list, with reference 9C1B2D3E.')
    expect(within(row('Haemoglobin')).queryByRole('form')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(said))
  })

  it('keeps “already gone back” in the row once the order reads completed', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem()))
      .mockResolvedValue(served(labItem({ orderRoute: routeCard({ effectiveState: 'completed', version: 5 }) })))
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Returned', { code: 'ORDER_ROUTE_ALREADY_RETURNED' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    const said = await within(row('Haemoglobin')).findByRole('alert')
    expect(said.textContent).toBe('A result has already gone back to General Hospital on this order, so it can’t be ended here. '
      + 'Phone General Hospital.')
    // Item 3's report is still offered on a completed order; this is not.
    expect(within(row('Haemoglobin')).getByRole('button', { name: `${WP}${NAMED}` })).toBeTruthy()
    expect(within(row('Haemoglobin')).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(said))
  })

  it('says it above the list, with focus there, when the row is gone', async () => {
    api.labWorkItems.mockResolvedValueOnce(served(labItem(), local)).mockResolvedValue(served(local))
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(404, 'Gone', { code: 'ORDER_ROUTE_NOT_FOUND' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    const said = await screen.findByText('This order was not found here. Refresh the list.')
    expect(said.getAttribute('role')).toBe('alert')
    expect(screen.queryByText('Haemoglobin')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(said))
  })

  it('keeps item 3’s refusal in the row too, on today’s backend', async () => {
    api.labWorkItems.mockResolvedValueOnce(today(labItem()))
      .mockResolvedValue(today(labItem({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed', version: 4 }) })))
    routes.reportWrongPatient.mockRejectedValueOnce(new HidApiError(409, 'Ended', { code: 'ORDER_ROUTE_ALREADY_ENDED' }))
    const item = await openLab()
    fireEvent.click(within(item).getByRole('button', { name: WP }))
    fireEvent.click(within(item).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(item).getByLabelText('What happened, for Health ID support'), { target: { value: 'Picked the wrong order' } })
    fireEvent.click(within(item).getByRole('checkbox', { name: 'The person I accepted this order for is not Tunde Bello.' }))
    fireEvent.click(within(item).getByRole('button', { name: 'End this order' }))
    const said = await within(row('Haemoglobin')).findByRole('alert')
    expect(said.textContent).toBe('This order has already ended, so it can’t be ended here. If a result or dispensing had gone '
      + 'back, use “Correct an order that has ended” above the work list, with reference 9C1B2D3E.')
    expect(within(row('Haemoglobin')).getByText('Cancelled by General Hospital: stop work.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(said))
  })

  it('leaves the words in the form while the new list still offers it', async () => {
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Reused', { code: 'IDEMPOTENCY_KEY_REUSED' }))
    const item = await openLab()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    const opened = form(row('Haemoglobin'))
    expect(within(opened).getByRole('alert').textContent).toBe('This was already sent with other details. The list has been '
      + 'refreshed: check whether the order has ended.')
    expect(within(row('Haemoglobin')).getAllByRole('alert')).toHaveLength(1)
  })
})

describe('at a pharmacy', () => {
  beforeEach(() => {
    working.permissions = PHARMACY
    api.pharmacyWorkItems.mockResolvedValue(served(prescription()))
  })
  async function openPharmacy() {
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    return (await screen.findByText('Amoxicillin 500 mg capsules')).closest('.staff-list-item') as HTMLElement
  }

  it('says the pharmacy’s words, the part-supply hint, its reasons and the collecting statement', async () => {
    const item = await openPharmacy()
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}: Amoxicillin 500 mg capsules, Ref 9C1B2D3E` }))
    const opened = form(item)
    expect(within(opened).getByText('Use this when you accepted this order but can’t finish it here: the medicine is out of stock '
      + 'or can’t be obtained, the prescription needs the prescriber’s review or a signed copy, or Tunde Bello chose not to go '
      + 'ahead or didn’t come back.')).toBeTruthy()
    expect(within(opened).getByText('If you handed over any of this medicine, phone General Hospital before you end the order and '
      + 'tell them how much: Health ID can’t record part of a dispensing.')).toBeTruthy()
    expect(within(opened).queryByText(/checked result|sample/)).toBeNull()
    expect([...opened.querySelectorAll('ul li')].map(entry => entry.textContent).slice(0, 2)).toEqual([
      'Nothing more can be recorded on this order. You stop seeing Tunde Bello’s details on this order at once.',
      'Nothing was dispensed on it.'])
    expect(within(opened).getAllByRole('radio').map(radio => radio.closest('label')!.textContent!.trim())).toEqual([
      'Out of stock, and we can’t get it in time', 'We can’t get this medicine at all',
      'It needs the prescriber’s review before it can be dispensed (dose, allergy, interaction or unclear)',
      'Controlled medicine: we need a signed or paper prescription', 'We can’t supply it when it is needed',
      'The patient chose not to go ahead', 'The patient didn’t come back to collect it', 'Another reason'])
    fireEvent.click(within(opened).getByRole('radio', { name: /^It needs the prescriber’s review/ }))
    fireEvent.click(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' }))
    fireEvent.click(within(opened).getByRole('checkbox', { name: 'The person we accepted this prescription for was Tunde Bello, or '
      + 'was collecting it for them, and we can’t complete it here.' }))
    routes.cannotComplete.mockResolvedValueOnce({ ...ENDED, reason: 'needs_prescriber_review' })
    submit(opened)
    const said = (await screen.findByText(/^Ended: Amoxicillin 500 mg capsules, reference 9C1B2D3E\./)).closest('.staff-notice') as HTMLElement
    expect(routes.cannotComplete).toHaveBeenCalledWith('facility-1', 'pharmacy', { id: ROUTE_ID, version: 3 },
      { reason: 'needs_prescriber_review', confirmedPatient: true }, expect.any(String))
    expect(said.textContent).toContain('Phone General Hospital now and tell the prescriber what needs review: Health ID does not pass it on.')
    expect(said.textContent).not.toMatch(/sample|critical/)
  })

  it('offers nothing on a dispensed or ended prescription', async () => {
    api.pharmacyWorkItems.mockResolvedValue(served(
      prescription({ id: 'p2', medication: { display: 'Paracetamol 500 mg tablets' }, dispensing: { id: 'd2', reversed: false },
        orderRoute: routeCard({ id: 'r-2', effectiveState: 'completed', version: 5 }) }),
      prescription({ id: 'p3', medication: { display: 'Ibuprofen 400 mg tablets' }, orderRoute: endedCard({ id: 'r-3' }) })))
    render(<MemoryRouter><Pharmacy /></MemoryRouter>)
    await screen.findByText('Paracetamol 500 mg tablets')
    expect(screen.queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
    const ended = screen.getByText('Ibuprofen 400 mg tablets').closest('.staff-list-item') as HTMLElement
    expect(within(ended).getByText(/^You ended this order: you couldn’t complete it\. Nothing more can be recorded on it\./)).toBeTruthy()
    expect(within(ended).queryByRole('button', { name: /Record full dispensing/ })).toBeNull()
  })
})

/** The Accepted panel closes when its order is ended from its row (WB15), and its item 3 form names where D18 is (WB3). */
describe('the Accepted panel, once served', () => {
  const incoming = { id: ROUTE_ID, reference: '9C1B2D3E', version: 1, effectiveState: 'sent', orderingFacilityName: 'General Hospital',
    orderer: { name: 'Dr Ade Okon', licenceBody: 'MDCN' }, test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' },
    priority: 'routine', specimenTypeCode: null, sentAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z',
    acceptLocked: false, attemptsLeft: 5 }
  const ACCEPTED = { route: { id: ROUTE_ID, version: 3, effectiveState: 'accepted' }, workItemId: 'w-routed', patient: PATIENT,
    clinicalInformation: null, orderer: { licenceBody: 'MDCN', licenceNumber: 'MDCN/12345' }, replayed: false }

  async function accept() {
    routes.incoming.mockResolvedValueOnce({ items: [incoming], crossFacilityOrders: true, crossFacilityWork: true, receives: true })
    routes.accept.mockResolvedValue(ACCEPTED)
    api.labWorkItems.mockResolvedValueOnce(served(local)).mockResolvedValue(served(labItem(), local))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    const area = (await screen.findByRole('heading', { name: 'Incoming (1)' })).closest('section')!
    fireEvent.click(within(area).getByRole('button', { name: 'Accept' }))
    fireEvent.change(within(area).getByLabelText(/^Patient’s Health ID/), { target: { value: 'HID-7KQ2M9' } })
    fireEvent.click(within(area).getByRole('button', { name: 'Accept order' }))
    await within(area).findByText('Accepted: Haemoglobin.')
    await screen.findByText('Haemoglobin', { selector: '.staff-list strong' })
    return area
  }

  it('says, in item 3’s form, where to end an order that can’t be completed', async () => {
    const area = await accept()
    fireEvent.click(within(area).getByRole('button', { name: WP }))
    expect(within(area).getByText('If you can’t complete it for another reason, don’t use this: close this and use “We can’t '
      + 'complete this order” on its row in the work list below.')).toBeTruthy()
  })

  it('closes once its order is ended from the row', async () => {
    const area = await accept()
    const item = screen.getByText('Haemoglobin', { selector: '.staff-list strong' }).closest('.staff-list-item') as HTMLElement
    fireEvent.click(await within(item).findByRole('button', { name: `${CC}${NAMED}` }))
    fill(form(item))
    submit(form(item))
    await screen.findByText(/^Ended: Haemoglobin/)
    await waitFor(() => expect(within(area).queryByText('Accepted: Haemoglobin.')).toBeNull())
  })
})

/**
 * "Correct an order that has ended" (D17's lookup): once D18 is served, an order found still open and accepted can be
 * ended there too, after its own read of the order (C8), for a row the work list can't show past its cap.
 */
describe('in “Correct an order that has ended”', () => {
  const open = { id: ROUTE_ID, reference: '9C1B2D3E', kind: 'lab_request', version: 3, effectiveState: 'accepted',
    orderingFacilityName: 'General Hospital', acceptedAt: acceptedDaysAgo(6), completedAt: null, endedAt: null,
    endedKind: null, returned: false, correction: 'open', correctableUntil: '2027-04-19T10:00:00.000Z', wrongPatient: null,
    details: { what: 'Haemoglobin', acceptedBy: 'Bola Ade', acceptedWith: 'health_id', returned: [] } }

  async function look(answer: unknown) {
    routes.findCorrectable.mockResolvedValue({ items: [open], lateCorrection: true })
    routes.get.mockResolvedValue({ id: ROUTE_ID, version: 3, patient: PATIENT, priority: 'stat' })
    api.labWorkItems.mockResolvedValue(answer)
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    const area = (await screen.findByText('Correct an order that has ended')).closest('details') as HTMLElement
    fireEvent.change(within(area).getByLabelText(/^Order reference/), { target: { value: '9c1b2d3e' } })
    fireEvent.click(within(area).getByRole('button', { name: 'Find' }))
    await within(area).findByText(/^Lab request from General Hospital/)
    return area
  }

  it('reads as before against today’s answers', async () => {
    const area = await look(today(local))
    expect(within(area).getByText('This order is still open. If you accepted it for the wrong person, report it here.')).toBeTruthy()
    expect(within(area).getAllByRole('button').map(button => button.textContent).filter(text => text !== 'Find')).toEqual([WP])
  })

  it('says it can be ended there, and ends it after its own read, with the request’s priority', async () => {
    const area = await look(served(local))
    expect(within(area).getByText('This order is still open. If you accepted it for the wrong person, report it here; if you can’t '
      + 'complete it, end it here.')).toBeTruthy()
    expect(within(area).getByRole('button', { name: `${WP}${NAMED}` })).toBeTruthy()
    fireEvent.click(within(area).getByRole('button', { name: `${CC}${NAMED}` }))
    const opened = await within(area).findByRole('form', { name: 'End this order: we can’t complete it' })
    expect(routes.get).toHaveBeenCalledWith('facility-1', 'lab', ROUTE_ID)
    expect(within(area).queryByRole('button', { name: /^This isn’t the order’s patient/ })).toBeNull()
    // Whether an accession was opened isn't known here.
    expect(within(opened).getByText('Nothing more can be recorded on this order. If you opened an accession on it, you can still '
      + 'read it for 7 days; otherwise you stop seeing Tunde Bello’s details on this order at once.')).toBeTruthy()
    // Stat: the phone statement is required.
    fill(opened, { reason: 'Another reason' })
    submit(opened)
    expect(within(opened).getByText('Tick the box to confirm that you will phone General Hospital now.')).toBeTruthy()
    fireEvent.click(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' }))
    routes.cannotComplete.mockResolvedValueOnce({ ...ENDED, reason: 'other' })
    submit(opened)
    const said = (await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\./)).closest('.staff-notice') as HTMLElement
    expect(routes.cannotComplete).toHaveBeenCalledWith('facility-1', 'lab', { id: ROUTE_ID, version: 3 },
      { reason: 'other', confirmedPatient: true }, expect.any(String))
    expect(said.textContent).toContain('This test was marked stat: phone General Hospital now, so they can write a new order.')
  })

  // Opened once its read is answered, the form takes focus in the commit that shows it, not in an effect a task later; Cancel
  // gives it back to the row's button in the commit that shows the button again, not from a timer.
  it('has focus on the form’s title as soon as it is shown after its read, and on the button as soon as Cancel shows it', async () => {
    const area = await look(served(local))
    const opened = focusWhenShown(() => within(area).queryByText('End this order: we can’t complete it'))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    fireEvent.click(within(area).getByRole('button', { name: `${CC}${NAMED}` }))
    const title = await opened
    expect(title.focused).toBe(title.element)
    const shown = focusWhenShown(() => within(area).queryByRole('button', { name: `${CC}${NAMED}` }))
    fireEvent.click(within(area).getByRole('button', { name: 'Cancel' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('says in item 3’s form there that the other action is on the row', async () => {
    const area = await look(served(local))
    fireEvent.click(within(area).getByRole('button', { name: `${WP}${NAMED}` }))
    expect(await within(area).findByText('If you can’t complete it for another reason, don’t use this: press Cancel and use “We '
      + 'can’t complete this order” on this order’s row.')).toBeTruthy()
  })

  it('keeps a refusal in the row when the order, found again, is no longer open', async () => {
    const area = await look(served(local))
    fireEvent.click(within(area).getByRole('button', { name: `${CC}${NAMED}` }))
    const opened = await within(area).findByRole('form', { name: 'End this order: we can’t complete it' })
    routes.findCorrectable.mockResolvedValue({ items: [{ ...open, version: 4, effectiveState: 'completed', completedAt: '2026-10-22T10:00:00.000Z',
      returned: true }], lateCorrection: true })
    routes.cannotComplete.mockRejectedValueOnce(new HidApiError(409, 'Returned', { code: 'ORDER_ROUTE_ALREADY_RETURNED' }))
    fill(opened, { reason: 'Another reason' })
    fireEvent.click(within(opened).getByRole('checkbox', { name: 'We will phone General Hospital about this now.' }))
    submit(opened)
    const said = await within(area).findByRole('alert')
    expect(said.textContent).toBe('A result has already gone back to General Hospital on this order, so it can’t be ended here. '
      + 'Phone General Hospital.')
    expect(within(area).queryByRole('form')).toBeNull()
    expect(within(area).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
  })

  it('drops from view the row of an order it couldn’t complete once it is withdrawn late (WB16)', async () => {
    const endedItem = labItem({ orderRoute: endedCard() })
    routes.findCorrectable.mockResolvedValue({ items: [{ ...open, version: 4, effectiveState: 'cancelled', endedAt: '2026-10-22T10:00:00.000Z',
      endedKind: 'receiving_unable', correction: 'correctable' }], lateCorrection: true })
    routes.correctWrongPatient.mockResolvedValue({ route: { id: ROUTE_ID, version: 5, effectiveState: 'cancelled', endedKind: 'receiving_unable' },
      late: true, endedKindBefore: 'receiving_unable', resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false,
      correctableUntil: null, replayed: false })
    api.labWorkItems.mockResolvedValue(served(endedItem, local))
    render(<MemoryRouter><Laboratory /></MemoryRouter>)
    await screen.findByText('Haemoglobin', { selector: '.staff-list strong' })
    // The area shows once Lab says it serves late correction, a read of its own that can land after the list.
    const area = (await screen.findByText('Correct an order that has ended')).closest('details') as HTMLElement
    fireEvent.change(within(area).getByLabelText(/^Order reference/), { target: { value: '9c1b2d3e' } })
    fireEvent.click(within(area).getByRole('button', { name: 'Find' }))
    expect(await within(area).findByText(/· you said you couldn’t complete it\.$/)).toBeTruthy()
    fireEvent.click(within(area).getByRole('button', { name: 'This wasn’t the order’s patient' }))
    const late = within(area).getByRole('form', { name: 'Withdraw what you recorded: accepted for the wrong person' })
    fireEvent.click(within(late).getByRole('radio', { name: 'The patient told us' }))
    fireEvent.click(within(late).getByRole('radio', { name: 'The person gave someone else’s Health ID or date of birth' }))
    fireEvent.change(within(late).getByLabelText('What happened, for Health ID support'), { target: { value: 'The patient says it was not them' } })
    fireEvent.click(within(late).getByRole('checkbox'))
    fireEvent.click(within(late).getByRole('button', { name: 'Withdraw it' }))
    await screen.findByText(/^Withdrawn: Haemoglobin/)
    await waitFor(() => expect(screen.queryByText('Haemoglobin', { selector: '.staff-list strong' })).toBeNull())
    expect(screen.getByText('Malaria parasite')).toBeTruthy()
  })
})
