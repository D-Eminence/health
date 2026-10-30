import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, actionsCard, ALL, AMOXICILLIN, contextLine, CREATE, deferred, DISPENSING_READ, dispensed, expectNoFullPatientIds,
  METFORMIN, nowDispensed, READ, recorded, refusal, REVERSE, reversed, SALBUTAMOL,
} from './fixtures'

/**
 * Dispense quantity and Reverse dispensing on the blue Pharmacy record: the design's action buttons and inline forms,
 * on today's checks, requests and refusals (staff/routes/Operations.tsx PharmacyAction): the reason of 8 characters,
 * a positive quantity and a unit, the dispensing read again before it is reversed at its current version, Pharmacy
 * refusing work whose prescription changed, and each refusal said.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
const strays = vi.hoisted(() => new Set<string>())

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

const ACCESS_DENIED = 'Pharmacy access is not authorized'
const WORK_ITEM_VERSION_CONFLICT = 'Dispensing must bind to the exact accepted work-item version'
const DISPENSING_VERSION_CONFLICT = 'Reversal must bind to the exact dispensing version'
const REASON = 'Full course dispensed at counter'

function working(permissions: string[]) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
}

beforeEach(() => {
  vi.resetAllMocks()
  strays.clear()
  working([READ, CREATE])
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
  api.dispense.mockResolvedValue({ id: 'dispensing-new' })
  api.dispensing.mockResolvedValue({ id: 'dispensing-2', version: 5 })
  api.reverseDispensing.mockResolvedValue({ id: 'reversal-1' })
})
afterEach(() => { expect([...strays]).toEqual([]) })

async function openRecord(name: string) {
  renderDept(<Pharmacy />)
  fireEvent.click(await screen.findByRole('button', { name }))
  return actionsCard()
}

/** Opens Dispense quantity and returns its form. */
function openDispense() {
  const toggle = within(actionsCard()).getByRole('button', { name: 'Dispense quantity', expanded: false })
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  return screen.getByRole('form', { name: 'Dispense quantity' })
}

function fillDispensing(form: HTMLElement, values: { quantity?: string; unit?: string; reason?: string }) {
  if (values.quantity !== undefined) fireEvent.change(within(form).getByRole('spinbutton', { name: 'Units to dispense' }), { target: { value: values.quantity } })
  if (values.unit !== undefined) fireEvent.change(within(form).getByRole('textbox', { name: 'Unit' }), { target: { value: values.unit } })
  if (values.reason !== undefined) fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: values.reason } })
}

function submitDispensing(form: HTMLElement) {
  fireEvent.click(within(form).getByRole('button', { name: 'Dispense quantity' }))
}

/** Opens Reverse dispensing, gives its reason and sends it. */
function reverse(reason: string) {
  const toggle = within(actionsCard()).queryByRole('button', { name: 'Reverse dispensing', expanded: false })
  if (toggle) fireEvent.click(toggle)
  const form = screen.getByRole('form', { name: 'Reverse dispensing' })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: reason } })
  fireEvent.click(within(form).getByRole('button', { name: 'Reverse dispensing' }))
  return form
}

describe('Dispense quantity', () => {
  it('opens the design’s form under the actions, and closes it again from its button', async () => {
    await openRecord(AMOXICILLIN)
    expect(screen.queryByRole('form')).toBeNull()
    const form = openDispense()
    const toggle = within(actionsCard()).getByRole('button', { name: 'Dispense quantity', expanded: true })
    expect(toggle.getAttribute('aria-controls')).toBe(form.id)
    const quantity = within(form).getByRole('spinbutton', { name: 'Units to dispense' }) as HTMLInputElement
    expect(quantity.value).toBe('')
    expect(document.getElementById(quantity.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('The whole quantity handed over: Health ID can’t record part of a dispensing.')
    expect((within(form).getByRole('textbox', { name: 'Unit' }) as HTMLInputElement).value).toBe('capsule')
    expect(within(form).getByRole('textbox', { name: 'Reason' })).toBeTruthy()
    // A form on this facility's own work does not name the patient to check.
    expect(form.textContent).not.toMatch(/Check that the person/)
    fireEvent.click(toggle)
    expect(screen.queryByRole('form')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('records the dispensing with the quantity, unit and trimmed reason, then reads the list again', async () => {
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [nowDispensed] })
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: '  Full seven-day course dispensed at the counter  ' })
    submitDispensing(form)
    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 21, 'capsule', 'Full seven-day course dispensed at the counter')
    const busy = within(form).getByRole('button', { name: 'Saving…' })
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(busy.hasAttribute('disabled')).toBe(false)
    // A second press while it is sent does nothing.
    fireEvent.click(busy)
    expect(api.dispense).toHaveBeenCalledTimes(1)

    await act(async () => { recording.resolve({ id: 'dispensing-9' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    await waitFor(() => expect(within(contextLine()).getByText('dispensed')).toBeTruthy())
    expect(screen.queryByRole('form')).toBeNull()
    expect(within(actionsCard()).queryByRole('button', { name: 'Dispense quantity' })).toBeNull()
    expect(within(actionsCard()).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID)
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expectNoFullPatientIds()
  })

  it('records the unit the pharmacist enters instead of the prescribed one', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '1.5', unit: ' blister pack ', reason: 'Dispensed in original blister packs' })
    submitDispensing(form)
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 1.5, 'blister pack', 'Dispensed in original blister packs')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it('refuses a reason under 8 characters at its field, with focus there, and sends nothing', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: '  Counter  ' })
    submitDispensing(form)
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    expect(refusal(reason)).toBe('Enter a reason of at least 8 characters.')
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(recorded()).toBe('')
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('checks the reason before the quantity, as today', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '0', reason: 'short' })
    submitDispensing(form)
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(refusal(within(form).getByRole('spinbutton', { name: 'Units to dispense' }))).toBeNull()
  })

  it('accepts a reason of exactly 8 characters once trimmed', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: '  Complete  ' })
    submitDispensing(form)
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 21, 'capsule', 'Complete')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it.each(['', '0', '-2'])('refuses a quantity of “%s” at its field and sends nothing', async quantity => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity, reason: REASON })
    submitDispensing(form)
    const control = within(form).getByRole('spinbutton', { name: 'Units to dispense' })
    expect(refusal(control)).toBe('Enter a positive quantity and unit.')
    // Still described by its hint as well.
    expect(control.getAttribute('aria-describedby')).toContain(`pharmacy-quantity-${accepted.id}-hint`)
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('refuses a blank unit at its field and sends nothing', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', unit: '   ', reason: REASON })
    submitDispensing(form)
    expect(refusal(within(form).getByRole('textbox', { name: 'Unit' }))).toBe('Enter a positive quantity and unit.')
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('clears a field’s refusal once the form is sent again', async () => {
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: 'short' })
    submitDispensing(form)
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).not.toBeNull()
    fillDispensing(form, { reason: REASON })
    submitDispensing(form)
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBeNull()
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED],
    [409, 'PHARMACY_WORK_ITEM_ALREADY_DISPENSED', 'A full dispensing is already recorded for this work item; partial dispensing is not supported'],
    [412, 'PHARMACY_WORK_ITEM_VERSION_CONFLICT', WORK_ITEM_VERSION_CONFLICT],
  ])('says a %i refusal in the form’s error box, with the design’s retry line, and keeps the form', async (status, code, message) => {
    api.dispense.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    expect((await within(form).findByRole('alert')).textContent).toBe(message)
    expect(within(form).getByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    expect(recorded()).toBe('')
    expect(within(contextLine()).getByText('accepted')).toBeTruthy()
    expect(within(form).getByRole('button', { name: 'Dispense quantity' }).getAttribute('aria-disabled')).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expectNoFullPatientIds()
  })

  it.each([
    ['no message', { status: 0 }, 'This action could not be completed. Please retry.'],
    ['work paused between facilities', new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }),
      'Health ID has paused work on orders from other facilities. Try again later.'],
    ['a closed order', new HidApiError(409, 'Closed', { code: 'ORDER_ROUTE_CLOSED' }),
      'This order from another facility is closed: it was cancelled, or its time for work has ended, so nothing more can be recorded on it. Refresh the list.'],
  ])('says a refusal with %s plainly', async (_case, caught, text) => {
    api.dispense.mockRejectedValueOnce(caught)
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    expect((await within(form).findByRole('alert')).textContent).toBe(text)
  })

  it('names each field a 400 refused', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(400, 'Request validation failed', { code: 'VALIDATION_FAILED',
      details: [{ field: 'quantityUnit', messages: ['quantityUnit must be shorter than or equal to 80 characters'] }] }))
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    expect((await within(form).findByRole('alert')).textContent)
      .toBe('Request validation failed Quantity unit must be shorter than or equal to 80 characters.')
  })

  it('marks work whose prescription changed as not dispensable, and offers no dispensing for it', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409,
      'The EHR prescription for this work item is no longer active at the version Pharmacy accepted; nothing was dispensed',
      { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    const said = await within(actionsCard()).findByRole('alert')
    expect(said.textContent).toBe('Not dispensableThis prescription is no longer active as Pharmacy accepted it, or it could not be checked. '
      + 'A new prescription and handoff are needed.')
    expect(within(contextLine()).getByText('not dispensable')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(within(actionsCard()).queryByRole('button', { name: 'Dispense quantity' })).toBeNull()
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(recorded()).toBe('')
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    // The list says so too, while the work stays listed; other work is unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(within(screen.getByRole('button', { name: AMOXICILLIN }).closest('tr')!).getByText('not dispensable')).toBeTruthy()
    expect(within(screen.getByRole('button', { name: METFORMIN }).closest('tr')!).getByText('dispensed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(within(actionsCard()).getByText(/^Not dispensable/)).toBeTruthy()
  })

  it('forgets that work was not dispensable once it has left the list, as today', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409, 'No', { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
      .mockResolvedValueOnce({ items: [accepted, dispensed] })
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    await within(actionsCard()).findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    const row = (await screen.findByRole('button', { name: AMOXICILLIN })).closest('tr')!
    expect(within(row).getByText('accepted')).toBeTruthy()
  })

  it('dispenses against the work item as read again after a version conflict', async () => {
    const refreshed: PharmacyWorkItem = { ...accepted, version: 4 }
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValueOnce({ items: [{ ...refreshed, version: 5, dispensing: { id: 'dispensing-9', reversed: false } }] })
    api.dispense.mockRejectedValueOnce(new HidApiError(412, WORK_ITEM_VERSION_CONFLICT, { code: 'PHARMACY_WORK_ITEM_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'dispensing-9' })
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    expect((await within(form).findByRole('alert')).textContent).toBe(WORK_ITEM_VERSION_CONFLICT)
    const refresh = screen.getByRole('button', { name: 'Refresh list' })
    fireEvent.click(refresh)
    await waitFor(() => expect(refresh.getAttribute('aria-disabled')).toBeNull())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    // The form and what was typed stay while the record is read again.
    submitDispensing(screen.getByRole('form', { name: 'Dispense quantity' }))
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    expect(api.dispense).toHaveBeenNthCalledWith(1, DEMO_PHARMACY_ID, accepted, 21, 'capsule', REASON)
    expect(api.dispense).toHaveBeenNthCalledWith(2, DEMO_PHARMACY_ID, refreshed, 21, 'capsule', REASON)
  })

  it('keeps what was recorded, and the last list, when the read after it fails', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] })
      .mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' }))
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    expect(within(contextLine()).getByText('accepted')).toBeTruthy()
    expect(api.dispense).toHaveBeenCalledTimes(1)
  })

  it('does not let an older, slower read overwrite the list read after a dispensing', async () => {
    const slow = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [nowDispensed] })
    await openRecord(AMOXICILLIN)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    await waitFor(() => expect(within(contextLine()).getByText('dispensed')).toBeTruthy())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(3)
    await act(async () => { slow.resolve({ items: [accepted] }) })
    expect(within(contextLine()).getByText('dispensed')).toBeTruthy()
  })

  it('is not offered without pharmacy.dispensing.create', async () => {
    working([READ, DISPENSING_READ, REVERSE])
    await openRecord(AMOXICILLIN)
    expect(within(actionsCard()).queryByRole('button', { name: 'Dispense quantity' })).toBeNull()
    expect(within(actionsCard()).getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })
})

describe('Reverse dispensing', () => {
  beforeEach(() => { working([READ, DISPENSING_READ, REVERSE]) })

  it('is offered only on a dispensing still in effect', async () => {
    await openRecord(METFORMIN)
    expect(within(actionsCard()).getByRole('button', { name: 'Reverse dispensing', expanded: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    for (const name of [AMOXICILLIN, SALBUTAMOL]) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(within(actionsCard()).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    }
  })

  it('reads the dispensing again, reverses it at its current version, then reads the list again', async () => {
    const reversing = deferred<unknown>()
    api.reverseDispensing.mockReturnValueOnce(reversing.promise)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [dispensed] })
      .mockResolvedValueOnce({ items: [{ ...dispensed, version: 8, dispensing: { id: 'dispensing-2', reversed: true } }] })
    await openRecord(METFORMIN)
    const form = reverse('  Medication returned unopened by the patient  ')
    await waitFor(() => expect(api.reverseDispensing).toHaveBeenCalledTimes(1))
    expect(api.dispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-2')
    expect(api.reverseDispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-2', 5, 'Medication returned unopened by the patient')
    expect(api.dispensing.mock.invocationCallOrder[0]).toBeLessThan(api.reverseDispensing.mock.invocationCallOrder[0] ?? -1)
    expect(within(form).getByRole('button', { name: 'Saving…' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
    await waitFor(() => expect(within(contextLine()).getByText('reversed')).toBeTruthy())
    expect(within(actionsCard()).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${dispensed.id}-title`))
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('reads the dispensing on every try, so a retry after a version conflict uses its newer version', async () => {
    const reason = 'Medication returned unopened by the patient'
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-2', version: 5 }).mockResolvedValueOnce({ id: 'dispensing-2', version: 6 })
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(412, DISPENSING_VERSION_CONFLICT, { code: 'PHARMACY_DISPENSING_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'reversal-1' })
    await openRecord(METFORMIN)
    const form = reverse(reason)
    expect((await within(form).findByRole('alert')).textContent).toBe(DISPENSING_VERSION_CONFLICT)
    fireEvent.click(within(form).getByRole('button', { name: 'Reverse dispensing' }))
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(1, DEMO_PHARMACY_ID, 'dispensing-2', 5, reason)
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(2, DEMO_PHARMACY_ID, 'dispensing-2', 6, reason)
  })

  it('refuses a reason under 8 characters at its field and reads nothing', async () => {
    await openRecord(METFORMIN)
    const form = reverse('   Recall   ')
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED],
    [404, 'PHARMACY_DISPENSING_NOT_FOUND', 'Dispensing was not found'],
  ])('does not reverse when the dispensing can’t be read (%i)', async (status, code, message) => {
    api.dispensing.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    await openRecord(METFORMIN)
    const form = reverse('Medication returned unopened by the patient')
    expect((await within(form).findByRole('alert')).textContent).toBe(message)
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(within(contextLine()).getByText('dispensed')).toBeTruthy()
  })

  it.each([
    ['pharmacy.dispensing.read', [READ, CREATE, REVERSE]],
    ['pharmacy.dispensing.reverse', [READ, CREATE, DISPENSING_READ]],
  ])('is not offered without %s', async (_missing, permissions) => {
    working(permissions)
    await openRecord(METFORMIN)
    expect(within(actionsCard()).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
  })

  it('clears what was recorded when a following reversal is refused', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [nowDispensed] })
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-9', version: 1 })
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(403, ACCESS_DENIED, { code: 'PHARMACY_ACCESS_DENIED' }))
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    await within(actionsCard()).findByRole('button', { name: 'Reverse dispensing' })
    const reversal = reverse('Dispensed against the wrong prescription')
    expect((await within(reversal).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    expect(recorded()).toBe('')
    expect(api.reverseDispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-9', 1, 'Dispensed against the wrong prescription')
  })

  it('shows one form at a time: opening one closes the other', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed] })
    await openRecord(METFORMIN)
    fireEvent.click(within(actionsCard()).getByRole('button', { name: 'Reverse dispensing', expanded: false }))
    expect(screen.getAllByRole('form').map(form => form.getAttribute('aria-label'))).toEqual(['Reverse dispensing'])
  })
})

describe('while a dispensing or reversal is sent', () => {
  it('holds Back to list, so a refusal that comes after a press is still said in the record', async () => {
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    const back = screen.getByRole('button', { name: 'Back to list' })
    expect(back.getAttribute('aria-disabled')).toBe('true')
    expect(back.hasAttribute('disabled')).toBe(false)
    back.focus()
    fireEvent.click(back)
    expect(screen.getByRole('heading', { level: 1, name: AMOXICILLIN })).toBeTruthy()
    expect(document.activeElement).toBe(back)
    await act(async () => { recording.reject(new HidApiError(403, ACCESS_DENIED, { code: 'PHARMACY_ACCESS_DENIED' })) })
    expect((await within(screen.getByRole('form', { name: 'Dispense quantity' })).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    expect(back.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(back)
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy' })).toBeTruthy()
  })

  it('holds Back to list during a reversal, so its success is announced', async () => {
    working([READ, DISPENSING_READ, REVERSE])
    const reversing = deferred<unknown>()
    api.reverseDispensing.mockReturnValueOnce(reversing.promise)
    await openRecord(METFORMIN)
    reverse('Medication returned unopened by the patient')
    await waitFor(() => expect(api.reverseDispensing).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1, name: METFORMIN })).toBeTruthy()
    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
  })

  it('moves focus to the title as the form goes, before the list is read again', async () => {
    const reread = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(reread.promise)
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    within(form).getByRole('button', { name: 'Dispense quantity' }).focus()
    submitDispensing(form)
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`)
    await act(async () => { reread.resolve({ items: [nowDispensed] }) })
    expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`)
  })

  it('moves focus to the list’s heading when the record leaves the list as it is read again', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
    await openRecord(AMOXICILLIN)
    const form = openDispense()
    fillDispensing(form, { quantity: '21', reason: REASON })
    submitDispensing(form)
    await screen.findByRole('heading', { level: 1, name: 'Pharmacy' })
    expect(document.activeElement?.id).toBe('pharmacy-heading')
  })
})
