import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackMessageForStatus, HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, ALL, AMOXICILLIN, dispensed, facts, METFORMIN, PRESCRIPTIONS, recorded, reversed, row, SALBUTAMOL, showTab, Where,
} from './fixtures'

/**
 * hid-system ORD-4 (#303, Release B): a pharmacist accepts a prescription before dispensing. On a received item that is
 * not withdrawn, Accept leads and Dispense stays offered; "Accepted by <name> 10:52" or "Already accepted by <name> 10:52",
 * the name read from SX-9 only when there is an acceptance to show, and "Accepted 10:52" with no id when it can't be; a
 * refusal as not dispensable says why by its withdrawnReason and reloads; and with no `pharmacyStep`, as today's backend
 * answers, nothing of it shows and nothing more is asked. Fictional people and work at "Demo Pharmacy".
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn(),
  acceptPharmacyWorkItem: vi.fn(), facilityStaffNames: vi.fn() }))
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
const PHARMACIST = 'Bola Fictional'
const TITLE = `pharmacy-${RECEIVED.id}-title`
function names(staff: Array<{ membershipId: string; name: string | null; current: boolean }>) {
  return { facilityId: DEMO_PHARMACY_ID, staff, complete: true }
}
const NAMED = names([{ membershipId: ACCEPTANCE.acceptedByMembershipId, name: PHARMACIST, current: true }])
const ACCEPTED_ANSWER = { workItemId: RECEIVED.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false }

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
  api.facilityStaffNames.mockResolvedValue(NAMED)
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
    // Nothing new is asked of today's backend.
    expect(api.facilityStaffNames).not.toHaveBeenCalled()
    expect(api.acceptPharmacyWorkItem).not.toHaveBeenCalled()
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
    // The list names no one, so it asks no one's name.
    expect(api.facilityStaffNames).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    const drug = screen.getByText('Pick', { selector: 'p' }).parentElement as HTMLElement
    expect(await within(drug).findByText(`Accepted by ${PHARMACIST} 10:52`)).toBeTruthy()
    expect(api.facilityStaffNames).toHaveBeenCalledTimes(1)
    expect(api.facilityStaffNames).toHaveBeenCalledWith(DEMO_PHARMACY_ID, [ACCEPTANCE.acceptedByMembershipId])
    expect(document.body.innerHTML).not.toContain(ACCEPTANCE.acceptedByMembershipId)
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
  it('201: "Accepted by <name> 10:52", then the list is read again, Accept goes and focus is on the title', async () => {
    api.acceptPharmacyWorkItem.mockResolvedValue(ACCEPTED_ANSWER)
    await openRecord(AMOXICILLIN)
    // A received item has no acceptance to show: no name is asked.
    expect(api.facilityStaffNames).not.toHaveBeenCalled()
    api.pharmacyWorkItems.mockResolvedValue({ items: [NOW_ACCEPTED, dispensed, reversed] })
    await pressAccept()
    expect(api.acceptPharmacyWorkItem).toHaveBeenCalledTimes(1)
    expect(api.acceptPharmacyWorkItem).toHaveBeenCalledWith(DEMO_PHARMACY_ID, RECEIVED, expect.any(String))
    await waitFor(() => expect(recorded()).toBe(`Accepted by ${PHARMACIST} 10:52`))
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
    // The reloaded item shows the same acceptance by name, and the name was asked once for the page.
    const drug = screen.getByText('Pick', { selector: 'p' }).parentElement as HTMLElement
    expect(await within(drug).findByText(`Accepted by ${PHARMACIST} 10:52`)).toBeTruthy()
    expect(api.facilityStaffNames).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement?.id).toBe(TITLE))
    expect(document.body.innerHTML).not.toContain(ACCEPTANCE.acceptedByMembershipId)
  })

  it('a name that can’t be read, or has no row: "Accepted 10:52", with no id', async () => {
    for (const failing of [true, false]) {
      if (failing) api.facilityStaffNames.mockRejectedValue(serverError(503, 'IDENTITY_SERVICE_UNAVAILABLE', 'Down'))
      else api.facilityStaffNames.mockResolvedValue(names([]))
      api.pharmacyWorkItems.mockResolvedValue({ items: [RECEIVED, dispensed, reversed] })
      api.acceptPharmacyWorkItem.mockResolvedValue(ACCEPTED_ANSWER)
      const view = renderDept(<><Pharmacy /><Where /></>, { route: `${PRESCRIPTIONS}/${encodeURIComponent(RECEIVED.id)}` })
      await screen.findByRole('heading', { name: ACCEPT_HEADING })
      await pressAccept()
      await waitFor(() => expect(recorded()).toBe('Accepted 10:52'))
      expect(document.body.innerHTML).not.toContain(ACCEPTANCE.acceptedByMembershipId)
      expect(document.body.textContent).not.toMatch(/Accepted by/)
      view.unmount()
    }
  })

  it('a member with no name (a deleted login) is "a former staff member"', async () => {
    api.facilityStaffNames.mockResolvedValue(names([{ membershipId: ACCEPTANCE.acceptedByMembershipId, name: null, current: false }]))
    api.acceptPharmacyWorkItem.mockResolvedValue(ACCEPTED_ANSWER)
    await openRecord(AMOXICILLIN)
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe('Accepted by a former staff member 10:52'))
    expect(document.body.innerHTML).not.toContain(ACCEPTANCE.acceptedByMembershipId)
  })

  it('200 alreadyAccepted: "Already accepted 10:52"', async () => {
    api.acceptPharmacyWorkItem.mockResolvedValue({ workItemId: RECEIVED.id, pharmacyStep: 'accepted',
      pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: 'dispensing' }, alreadyAccepted: true })
    await openRecord(AMOXICILLIN)
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe(`Already accepted by ${PHARMACIST} 10:52`))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
  })

  it('a retry of the same press sends the same Idempotency-Key', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValueOnce(new HidApiError(0, 'offline', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ workItemId: RECEIVED.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false })
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('We couldn’t reach Health ID. Check your internet connection and try again.')
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe(`Accepted by ${PHARMACIST} 10:52`))
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
    expect((await screen.findByRole('alert')).textContent).toBe('Not dispensableThis prescription is no longer active as Pharmacy received '
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

  it('a new press after a final outcome sends a new Idempotency-Key', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValueOnce(serverError(503, 'PHARMACY_ACCEPTANCE_UNAVAILABLE', 'Accepting is not available right now. Please try again.'))
      .mockResolvedValueOnce(ACCEPTED_ANSWER)
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('Accepting is not available right now. Please try again.')
    await pressAccept()
    await waitFor(() => expect(recorded()).toBe(`Accepted by ${PHARMACIST} 10:52`))
    const keys = api.acceptPharmacyWorkItem.mock.calls.map(call => call[2])
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it.each([
    ['403', serverError(403, 'PERMISSION_DENIED', 'Required Pharmacy permission is missing'),
      'Your role here can’t accept prescriptions. Ask a pharmacist to accept it.'],
    ['404', serverError(404, 'PHARMACY_WORK_ITEM_NOT_FOUND', 'Pharmacy work item was not found'),
      'This prescription is no longer on your list. Go back to Prescriptions and refresh the list.'],
    ['409 key', serverError(409, 'IDEMPOTENCY_CONFLICT', 'Prescription acceptance conflicts with existing Pharmacy work'),
      'This may already be recorded. Go back to Prescriptions and refresh the list to check.'],
    ['412', serverError(412, 'PHARMACY_WORK_ITEM_VERSION_CONFLICT', 'Dispensing must bind to the exact accepted work-item version'),
      'This prescription changed after you opened it, and it may already be accepted. Go back to Prescriptions, refresh the list and open it again.'],
  ])('%s: its own plain sentence, with no retry note', async (_, refusal, words) => {
    api.acceptPharmacyWorkItem.mockRejectedValue(refusal)
    await openRecord(AMOXICILLIN)
    await pressAccept()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(words)
    expect(screen.queryByText(/Try again with the same button/)).toBeNull()
    expect(document.body.textContent).not.toMatch(/permission/i)
    expect(document.body.textContent).not.toContain(refusal.detail ?? 'none')
  })

  it('an answer that can’t be read: may already be recorded, and the list is read again', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValue(new HidApiError(502, 'Prescriptions could not be read. Please try again.',
      { code: 'INVALID_RESPONSE', retryable: false }))
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('This may already be recorded. Refresh the list to check.')
    expect(screen.queryByText(/Try again with the same button/)).toBeNull()
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
  })

  it('a refusal Dispense shares is said in Dispense’s words', async () => {
    api.acceptPharmacyWorkItem.mockRejectedValue(serverError(409, 'PHARMACY_WORK_ITEM_ALREADY_DISPENSED', 'A full dispensing is already recorded'))
    await openRecord(AMOXICILLIN)
    await pressAccept()
    expect((await screen.findByRole('alert')).textContent).toBe('This prescription is already recorded as dispensed. Go back to '
      + 'Prescriptions and refresh the list before you hand anything over.')
  })
})

describe('a withdrawn item (ORD-2)', () => {
  it.each([
    ['changed', 'Changed or stopped by the prescribing team'],
    ['sent_elsewhere', 'Sent to another pharmacy by the prescribing team'],
  ])('%s: says why on the list and the record, and offers neither Accept nor Dispense', async (reason, words) => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...RECEIVED, withdrawn: true, withdrawnReason: reason }, dispensed, reversed] })
    await openList()
    expect(within(row(AMOXICILLIN)).getByText(words)).toBeTruthy()
    expect(within(row(AMOXICILLIN)).getByText('Not dispensable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(screen.queryByRole('heading', { name: ACCEPT_HEADING })).toBeNull()
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(`Not dispensable${words}. It can no longer be dispensed here.`)
    expect(document.body.textContent).not.toContain('sent_elsewhere')
    expect(api.facilityStaffNames).not.toHaveBeenCalled()
  })
})
