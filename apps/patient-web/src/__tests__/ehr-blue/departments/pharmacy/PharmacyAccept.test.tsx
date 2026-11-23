import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackMessageForStatus, HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, ALL, AMOXICILLIN, dispensed, facts, METFORMIN, PRESCRIPTIONS, READ, recorded, reversed, row, SALBUTAMOL, showTab, Where,
} from './fixtures'

/**
 * hid-system ORD-4 (#303, Release B): a pharmacist accepts a prescription before dispensing. On a received item that is
 * not withdrawn, Accept leads and Dispense stays offered; "Accepted 10:52" or "Already accepted 10:52" (no name: this app
 * has no staff names read, SX-9); a refusal as not dispensable says why by its withdrawnReason and reloads; and with no
 * `pharmacyStep`, as today's backend answers, nothing of it shows. Fictional work at "Demo Pharmacy".
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn(),
  acceptPharmacyWorkItem: vi.fn() }))
const strays = vi.hoisted(() => new Set<string>())

const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: {},
}))

const ACCEPT = 'pharmacy.work-item.accept'
const ACCEPTANCE = { acceptedAt: '2026-11-20T09:52:00.000Z', acceptedByMembershipId: 'm0000000-0000-4000-8000-000000000001',
  acceptedWith: 'accept' as const }
/** Sent to Pharmacy by itself, not yet accepted by a pharmacist. */
const RECEIVED: PharmacyWorkItem = { ...accepted, version: 1, pharmacyStep: 'received', pharmacistAcceptance: null }
/** The same item once a pharmacist accepted it at 10:52 in Lagos. */
const NOW_ACCEPTED: PharmacyWorkItem = { ...RECEIVED, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE }
const ACCEPT_HEADING = 'Accept this prescription'

function working(permissions: string[]) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
}
function serverError(status: number, code: string, detail: string, withdrawnReason?: string) {
  return new HidApiError(status, fallbackMessageForStatus(status), { code, detail, withdrawnReason })
}

beforeEach(() => {
  // Only the clock is fixed, at noon in Lagos on the day of the acceptance, so "10:52" is today's time.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-20T11:00:00.000Z'))
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  working([...ALL, ACCEPT])
  api.pharmacyWorkItems.mockResolvedValue({ items: [RECEIVED, dispensed, reversed] })
})
afterEach(() => {
  vi.useRealTimers()
  expect([...strays]).toEqual([])
})

async function openList() {
  renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prescriptions' })).toBeNull())
  showTab('All')
}
async function openRecord(name: string) {
  await openList()
  fireEvent.click(await screen.findByRole('button', { name }))
}
const acceptButton = () => within(screen.getByRole('heading', { name: ACCEPT_HEADING }).closest('section') as HTMLElement)
  .getByRole('button', { name: /^(Accept|Saving…)$/ })
async function pressAccept() {
  await act(async () => { fireEvent.click(acceptButton()) })
}

describe('today’s answers, with no pharmacyStep', () => {
  it('render as before: no step, no Accept, the arrival still called Accepted', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
    await openList()
    for (const name of [AMOXICILLIN, METFORMIN, SALBUTAMOL]) {
      expect(within(row(name)).queryByText(/^Received/)).toBeNull()
      expect(within(row(name)).queryByText(/^Accepted \d{2}:\d{2}$/)).toBeNull()
    }
    expect(within(row(AMOXICILLIN)).getByText('To dispense')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(within(screen.getByRole('form', { name: 'Dispense' })).getByRole('button', { name: 'Dispense' })).toBeTruthy()
    expect(Object.keys(facts())).toContain('Accepted')
    expect(Object.keys(facts())).not.toContain('Received')
    expect(screen.getByText(/^Accepted \d+ Oct 2026/, { selector: 'p' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Received/)
  })
})

describe('the step on the list and the record', () => {
  it('says Received, or Accepted with the time, beside the status; never the acceptor’s id', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [RECEIVED, { ...NOW_ACCEPTED, id: 'b0000000-work-item-accepted',
      medication: { display: METFORMIN } }, { ...reversed, pharmacyStep: 'dispensing_reversed', pharmacistAcceptance: null }] })
    await openList()
    expect(within(row(AMOXICILLIN)).getByText('Received')).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('Accepted 10:52')).toBeTruthy()
    // A reversed item already says so on its status: nothing is added.
    expect(within(row(SALBUTAMOL)).queryByText('Dispensing reversed')).toBeNull()
    expect(document.body.innerHTML).not.toContain(ACCEPTANCE.acceptedByMembershipId)
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    const drug = screen.getByText('Pick', { selector: 'p' }).parentElement as HTMLElement
    expect(within(drug).getByText('Accepted 10:52')).toBeTruthy()
    expect(within(drug).getByText(/^Received \d+ Oct 2026/)).toBeTruthy()
    expect(Object.keys(facts())).toEqual(expect.arrayContaining(['Received', 'Accepted']))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
  })
})

describe('who is offered Accept', () => {
  it('a received item, to a member who may accept: Accept leads and Dispense stays offered', async () => {
    await openRecord(AMOXICILLIN)
    expect(acceptButton().textContent).toBe('Accept')
    expect(within(screen.getByRole('form', { name: 'Dispense' })).getByRole('button', { name: 'Dispense' })).toBeTruthy()
  })

  it('not without the right to accept', async () => {
    working([...ALL])
    await openRecord(AMOXICILLIN)
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
  })

  it('not on a withdrawn item, nor on one already accepted or dispensed', async () => {
    for (const item of [{ ...RECEIVED, withdrawn: true }, NOW_ACCEPTED, { ...RECEIVED, dispensing: { id: 'dispensing-9', reversed: false } }]) {
      api.pharmacyWorkItems.mockResolvedValue({ items: [item] })
      const view = renderDept(<><Pharmacy /><Where /></>, { route: `${PRESCRIPTIONS}/${encodeURIComponent(item.id)}` })
      await screen.findByText(/^(Received|Accepted) \d/, { selector: 'p' })
      expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
      view.unmount()
    }
  })
})

describe('pressing Accept', () => {
  it('201: "Accepted 10:52", then the list is read again and Accept goes', async () => {
    api.acceptPharmacyWorkItem.mockResolvedValue({ workItemId: RECEIVED.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false })
    await openRecord(AMOXICILLIN)
    api.pharmacyWorkItems.mockResolvedValue({ items: [NOW_ACCEPTED, dispensed, reversed] })
    await pressAccept()
    expect(api.acceptPharmacyWorkItem).toHaveBeenCalledTimes(1)
    expect(api.acceptPharmacyWorkItem).toHaveBeenCalledWith(DEMO_PHARMACY_ID, RECEIVED, expect.any(String))
    await waitFor(() => expect(recorded()).toBe('Accepted 10:52'))
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
  })

  it('200 alreadyAccepted: "Already accepted 10:52"', async () => {
    api.acceptPharmacyWorkItem.mockResolvedValue({ workItemId: RECEIVED.id, pharmacyStep: 'accepted',
      pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: 'dispensing' }, alreadyAccepted: true })
    await openRecord(AMOXICILLIN)
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe('Already accepted 10:52'))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
  })

  it('a retry of the same press sends the same Idempotency-Key', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValueOnce(new HidApiError(0, 'offline', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ workItemId: RECEIVED.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false })
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t reach Health ID. Check your internet connection and try again.')
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe('Accepted 10:52'))
    const keys = api.acceptPharmacyWorkItem.mock.calls.map(call => call[2])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it.each([
    ['changed', 'Changed or stopped by the prescribing team. It can no longer be dispensed here.', 'This prescription can no longer be dispensed here'],
    ['sent_elsewhere', 'Sent to another pharmacy by the prescribing team. It can no longer be dispensed here.',
      'This prescription was sent to another pharmacy, so it can no longer be dispensed here'],
  ])('409 not dispensable (%s): says why, by its reason, then reads the list again', async (reason, words, detail) => {
    api.acceptPharmacyWorkItem.mockRejectedValue(serverError(409, 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE', detail, reason))
    await openRecord(AMOXICILLIN)
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...RECEIVED, withdrawn: true }, dispensed, reversed] })
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe(`Not dispensable${words}`)
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(document.body.textContent).not.toContain(detail)
    expect(document.body.textContent).not.toContain('PHARMACY_PRESCRIPTION_NOT_DISPENSABLE')
  })

  it('409 not dispensable with no reason says what Dispense says', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValue(serverError(409, 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE', 'This prescription can no longer be dispensed here'))
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('Not dispensableThis prescription is no longer active as Pharmacy accepted '
      + 'it, or it could not be checked. A new prescription and handoff are needed.')
  })

  it('503 acceptance unavailable: its words as sent, and Accept stays to try again', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValue(serverError(503, 'PHARMACY_ACCEPTANCE_UNAVAILABLE', 'Accepting is not available right now. Please try again.'))
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('Accepting is not available right now. Please try again.')
    expect(acceptButton().textContent).toBe('Accept')
    expect(recorded()).toBe('')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('a refusal Dispense shares is said in Dispense’s words', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValue(serverError(409, 'PHARMACY_WORK_ITEM_ALREADY_DISPENSED', 'A full dispensing is already recorded'))
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('This prescription is already recorded as dispensed. Go back to '
      + 'Prescriptions and refresh the list before you hand anything over.')
  })
})
