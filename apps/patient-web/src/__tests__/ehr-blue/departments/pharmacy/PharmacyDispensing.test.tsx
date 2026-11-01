import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { SAID_CHANGED, SAID_FIELDS_REFUSED, SAID_NOT_FOUND, SAID_REFUSED, SAID_UNAVAILABLE } from '../../../said'
import {
  accepted, ALL, AMOXICILLIN, confirmPatient, CREATE, deferred, DISPENSING_READ, dispensed, expectNoFullPatientIds, fillDispensing,
  METFORMIN, nowDispensed, otherActions, pickCard, PRESCRIPTIONS, pressDispense, READ, recorded, recordStatus, refusal, REVERSE,
  reversed, row, SALBUTAMOL, showTab, tick, Where,
} from './fixtures'

/**
 * Dispensing and reversing from a prescription's picking view (the owner's redesign: a checklist ticked at the shelf,
 * the quantity and label, one Dispense confirmed against the patient, then a done state with Next prescription; reversing
 * set apart under Other actions, also confirmed), on today's checks, requests and refusals (staff/routes/Operations.tsx
 * PharmacyAction): the reason of 8 characters, a positive quantity and a unit, the dispensing read again before it is
 * reversed at its current version, Pharmacy refusing work whose prescription changed, and each refusal said.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
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

const ACCESS_DENIED = 'Pharmacy access is not authorized'
const WORK_ITEM_VERSION_CONFLICT = 'Dispensing must bind to the exact accepted work-item version'
const DISPENSING_VERSION_CONFLICT = 'Reversal must bind to the exact dispensing version'
const REASON = 'Full course dispensed at counter'
/** A cream prescribed with no dose and no unit, as classic and the EHR allow; accepted after Amoxicillin. */
const CREAM: PharmacyWorkItem = { ...accepted, id: 'f6a7b8c9-work-item-6', acceptedAt: '2026-10-08T10:00:00.000Z',
  medication: { display: 'Hydrocortisone 1% cream' }, doseQuantity: null, doseUnit: null, routeCode: 'topical',
  frequency: 'Twice daily', instructions: 'Apply thinly to the rash' }

function working(permissions: string[]) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  working([READ, CREATE])
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
  api.dispense.mockResolvedValue({ id: 'dispensing-new' })
  api.dispensing.mockResolvedValue({ id: 'dispensing-2', version: 5 })
  api.reverseDispensing.mockResolvedValue({ id: 'reversal-1' })
})
afterEach(() => { expect([...strays]).toEqual([]) })

/** Opens a prescription from the queue's All tab. */
async function openRecord(name: string) {
  renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
  await screen.findByRole('button', { name: AMOXICILLIN, hidden: true }).catch(() => undefined)
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prescriptions' })).toBeNull())
  showTab('All')
  fireEvent.click(await screen.findByRole('button', { name }))
}

/** Ticks the checklist, fills the picking view and presses Dispense; the confirm sheet then asks. */
function dispenseWith(values: { quantity?: string; unit?: string; reason?: string }) {
  tick()
  const form = fillDispensing(values)
  pressDispense()
  return form
}

/** Opens Reverse dispensing, gives its reason and sends it (the confirm sheet then asks). */
function reverse(reason: string) {
  const toggle = within(otherActions()).queryByRole('button', { name: 'Reverse dispensing', expanded: false })
  if (toggle) fireEvent.click(toggle)
  const form = screen.getByRole('form', { name: 'Reverse dispensing' })
  fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: reason } })
  fireEvent.click(within(form).getByRole('button', { name: 'Reverse dispensing' }))
  return form
}

const back = () => screen.getByRole('button', { name: 'Back to prescriptions' })

describe('the picking view', () => {
  it('leads with the drug, a checklist, the quantity and the label in plain words', async () => {
    await openRecord(AMOXICILLIN)
    const pick = pickCard()
    const checklist = within(pick).getByRole('group', { name: 'Checklist' })
    expect(within(checklist).getAllByRole('checkbox').map(box => box.closest('label')?.textContent)).toEqual([
      `Picked ${AMOXICILLIN}: the right medicine and strength`, 'Counted the quantity to hand over', 'Label written and checked with the patient'])
    expect(within(checklist).getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    expect(within(pick).getByText('On the label').nextElementSibling?.textContent).toBe('Take 1 capsule by mouth Three times daily. Take with food.\nFinish the course.')
    const form = screen.getByRole('form', { name: 'Dispense' })
    const quantity = within(form).getByRole('spinbutton', { name: 'Quantity to hand over' }) as HTMLInputElement
    expect(quantity.value).toBe('')
    expect(document.getElementById(quantity.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('The whole amount. Part of a dispensing can’t be recorded.')
    expect((within(form).getByRole('textbox', { name: 'Unit' }) as HTMLInputElement).value).toBe('capsule')
    expect((within(form).getByRole('textbox', { name: 'Reason' }) as HTMLTextAreaElement).value).toBe('Dispensed as prescribed.')
    expect(within(form).getByRole('button', { name: 'Dispense' }).getAttribute('type')).toBe('submit')
    // A form on this facility's own work does not name the patient to check.
    expect(form.textContent).not.toMatch(/Check that the person/)
  })

  it('says a dose that is missing on the label, and has the prescriber confirm it', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...accepted, frequency: null }] })
    await openRecord(AMOXICILLIN)
    expect(within(pickCard()).getByText(/^Can’t dispense: dose missing\. Ask the prescriber/)).toBeTruthy()
    expect(within(pickCard()).getByText('Dose and how often confirmed with the prescriber')).toBeTruthy()
  })

  it('labels a prescription saved with no dose and no unit from its route, how often and instructions', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, CREAM] })
    await openRecord(CREAM.medication.display)
    expect(within(pickCard()).getByText('On the label').nextElementSibling?.textContent).toBe('Apply on the skin Twice daily. Apply thinly to the rash.')
    expect(within(pickCard()).queryByText(/Can’t dispense/)).toBeNull()
    expect(within(pickCard()).getByText('Label written and checked with the patient')).toBeTruthy()
  })

  it('refuses until every step is ticked, at the checklist with focus on the first left, and sends nothing', async () => {
    await openRecord(AMOXICILLIN)
    tick(2)
    fillDispensing({ quantity: '21' })
    pressDispense()
    const checklist = within(pickCard()).getByRole('group', { name: 'Checklist' })
    expect(document.getElementById(checklist.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Tick each step once it’s done.')
    await waitFor(() => expect(document.activeElement).toBe(within(checklist).getAllByRole('checkbox')[2]))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
  })
})

describe('Dispense', () => {
  it('asks to confirm the patient, records the dispensing with the quantity, unit and trimmed reason, then reads the list again', async () => {
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [nowDispensed] })
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: '  Full seven-day course dispensed at the counter  ' })
    // Nothing is sent before the patient is confirmed.
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the patient' })
    expect(api.dispense).not.toHaveBeenCalled()
    expect(within(sheet).getByRole('region', { name: 'Patient: Patient ••••6f8a10' })).toBeTruthy()
    expect(within(sheet).getByText(`Dispense 21 capsule of ${AMOXICILLIN} to Patient ••••6f8a10?`)).toBeTruthy()
    expect(within(sheet).getByText('If this was a mistake, you can reverse the dispensing afterwards.')).toBeTruthy()
    await confirmPatient('Dispense')
    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 21, 'capsule', 'Full seven-day course dispensed at the counter')
    const busy = within(form).getByRole('button', { name: 'Saving…' })
    expect(busy.getAttribute('aria-disabled')).toBe('true')
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.hasAttribute('disabled')).toBe(false)
    // A second press while it is sent does nothing.
    fireEvent.click(busy)
    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()

    await act(async () => { recording.resolve({ id: 'dispensing-9' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    // The done state: what was handed to whom, with focus on it.
    const done = await screen.findByRole('heading', { name: 'Dispensed' })
    const handed = done.nextElementSibling as HTMLElement
    // The quantity and its unit are drawn apart (kasuwa Value), then what and to whom.
    expect([within(handed).getByText('21').textContent, within(handed).getByText('capsule').textContent]).toEqual(['21', 'capsule'])
    expect(handed.textContent).toMatch(new RegExp(`of ${AMOXICILLIN} handed to Patient ••••6f8a10\\.$`))
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(done))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID)
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expectNoFullPatientIds()
  })

  it('sends nothing when the patient is not confirmed, and keeps the form', async () => {
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Cancel')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
    expect(recorded()).toBe('')
  })

  it('offers the next prescription waiting from the done state', async () => {
    const second = { ...accepted, id: 'e1f2a3b4-work-item-5', acceptedAt: '2026-10-08T10:00:00.000Z', medication: { display: 'Ibuprofen 400 mg tablet' } }
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, second] })
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await screen.findByRole('heading', { name: 'Dispensed' })
    expect(screen.getByText('Next: Ibuprofen 400 mg tablet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next prescription' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ibuprofen 400 mg tablet' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe(`${PRESCRIPTIONS}/${second.id}`)
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${second.id}-title`))
  })

  it('offers a prescription saved with no dose and no unit as the next one', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, CREAM] })
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await screen.findByRole('heading', { name: 'Dispensed' })
    expect(screen.getByText(`Next: ${CREAM.medication.display}`)).toBeTruthy()
  })

  it('records the unit the pharmacist enters instead of the prescribed one', async () => {
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '1.5', unit: ' blister pack ', reason: 'Dispensed in original blister packs' })
    await confirmPatient('Dispense')
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 1.5, 'blister pack', 'Dispensed in original blister packs')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it('refuses a reason under 8 characters at its field, with focus there, and sends nothing', async () => {
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: '  Counter  ' })
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    expect(refusal(reason)).toBe('Enter a reason of at least 8 characters.')
    await waitFor(() => expect(document.activeElement).toBe(reason))
    expect(recorded()).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('checks the reason before the quantity, as today', async () => {
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '0', reason: 'short' })
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(refusal(within(form).getByRole('spinbutton', { name: 'Quantity to hand over' }))).toBeNull()
  })

  it('accepts a reason of exactly 8 characters once trimmed', async () => {
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: '  Complete  ' })
    await confirmPatient('Dispense')
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, accepted, 21, 'capsule', 'Complete')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it.each(['', '0', '-2'])('refuses a quantity of “%s” at its field and sends nothing', async quantity => {
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity, reason: REASON })
    const control = within(form).getByRole('spinbutton', { name: 'Quantity to hand over' })
    expect(refusal(control)).toBe('Enter a positive quantity and unit.')
    // Still described by its hint as well.
    expect(control.getAttribute('aria-describedby')).toContain(`pharmacy-quantity-${accepted.id}-hint`)
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('refuses a blank unit at its field and sends nothing', async () => {
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', unit: '   ', reason: REASON })
    expect(refusal(within(form).getByRole('textbox', { name: 'Unit' }))).toBe('Enter a positive quantity and unit.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('clears a field’s refusal once the form is sent again', async () => {
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: 'short' })
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).not.toBeNull()
    fillDispensing({ reason: REASON })
    pressDispense()
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBeNull()
    await confirmPatient('Dispense')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED, SAID_REFUSED],
    [409, 'PHARMACY_WORK_ITEM_ALREADY_DISPENSED', 'A full dispensing is already recorded for this work item; partial dispensing is not supported',
      'That didn’t work. Please try again.'],
    [412, 'PHARMACY_WORK_ITEM_VERSION_CONFLICT', WORK_ITEM_VERSION_CONFLICT, SAID_CHANGED],
  ])('says a %i refusal in the form’s error box, in plain words, with the retry line, and keeps the form', async (status, code, message, shown) => {
    api.dispense.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    expect((await within(form).findByRole('alert')).textContent).toBe(shown)
    expect(document.body.textContent).not.toContain(message)
    expect(within(form).getByText('Fix what’s marked, or try again with the same button. Nothing is saved until it says so.')).toBeTruthy()
    expect(recorded()).toBe('')
    expect(recordStatus()).toBe('To dispense')
    expect(within(form).getByRole('button', { name: 'Dispense' }).getAttribute('aria-disabled')).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expectNoFullPatientIds()
  })

  it.each([
    ['no message', { status: 0 }, 'That didn’t work. Please try again.'],
    ['work paused between facilities', new HidApiError(423, 'Paused', { code: 'CROSS_FACILITY_ORDERS_UNAVAILABLE' }),
      'Health ID has paused work on orders from other facilities. Try again later.'],
    ['a closed order', new HidApiError(409, 'Closed', { code: 'ORDER_ROUTE_CLOSED' }),
      'This order from another facility is closed: it was cancelled, or its time for work has ended, so nothing more can be recorded on it. Refresh the list.'],
  ])('says a refusal with %s plainly', async (_case, caught, text) => {
    api.dispense.mockRejectedValueOnce(caught)
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    expect((await within(form).findByRole('alert')).textContent).toBe(text)
  })

  it('names each field a 400 refused', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(400, 'Request validation failed', { code: 'VALIDATION_FAILED',
      details: [{ field: 'quantityUnit', messages: ['quantityUnit must be shorter than or equal to 80 characters'] }] }))
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    expect((await within(form).findByRole('alert')).textContent)
      .toBe(SAID_FIELDS_REFUSED)
      expect(document.body.textContent).not.toContain('Request validation failed')
  })

  it('marks work whose prescription changed as not dispensable, and offers no dispensing for it', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409,
      'The EHR prescription for this work item is no longer active at the version Pharmacy accepted; nothing was dispensed',
      { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    const said = await screen.findByRole('alert')
    expect(said.textContent).toBe('Not dispensableThis prescription is no longer active as Pharmacy accepted it, or it could not be checked. '
      + 'A new prescription and handoff are needed.')
    expect(recordStatus()).toBe('Not dispensable')
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Dispense' })).toBeNull()
    expect(recorded()).toBe('')
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    // The list says so too, while the work stays listed; other work is unchanged.
    fireEvent.click(back())
    showTab('All')
    expect(within(row(AMOXICILLIN)).getByText('Not dispensable')).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('Dispensed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(recordStatus()).toBe('Not dispensable')
    expect(screen.getByRole('alert').textContent).toMatch(/^Not dispensable/)
  })

  it('forgets that work was not dispensable once it has left the list, as today', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409, 'No', { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
      .mockResolvedValueOnce({ items: [accepted, dispensed] })
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await screen.findByRole('alert')
    fireEvent.click(back())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' }).getAttribute('aria-busy')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('button', { name: AMOXICILLIN })
    expect(within(row(AMOXICILLIN)).getByText('To dispense')).toBeTruthy()
  })

  it('dispenses against the work item as read again after a version conflict', async () => {
    const refreshed: PharmacyWorkItem = { ...accepted, version: 4 }
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValueOnce({ items: [{ ...refreshed, version: 5, dispensing: { id: 'dispensing-9', reversed: false } }] })
    api.dispense.mockRejectedValueOnce(new HidApiError(412, WORK_ITEM_VERSION_CONFLICT, { code: 'PHARMACY_WORK_ITEM_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'dispensing-9' })
    await openRecord(AMOXICILLIN)
    const form = dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    expect((await within(form).findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain(WORK_ITEM_VERSION_CONFLICT)
    // The picking view has no refresh of its own: back to the queue, read it again, and open the prescription again.
    fireEvent.click(back())
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refresh)
    await waitFor(() => expect(refresh.getAttribute('aria-busy')).toBeNull())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    expect(api.dispense).toHaveBeenNthCalledWith(1, DEMO_PHARMACY_ID, accepted, 21, 'capsule', REASON)
    expect(api.dispense).toHaveBeenNthCalledWith(2, DEMO_PHARMACY_ID, refreshed, 21, 'capsule', REASON)
  })

  it('keeps what was recorded when the read after it fails, and says the list may be out of date', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] })
      .mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' }))
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t refresh prescriptions')
    expect(alert.textContent).toContain(`${SAID_UNAVAILABLE} What is shown may be out of date.`)
    expect(document.body.textContent).not.toContain('Pharmacy work is temporarily unavailable.')
    expect(screen.getByRole('heading', { name: 'Dispensed' })).toBeTruthy()
    expect(api.dispense).toHaveBeenCalledTimes(1)
  })

  it('does not let an older, slower read overwrite the list read after a dispensing', async () => {
    const slow = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [nowDispensed] })
    renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
    await screen.findByRole('button', { name: AMOXICILLIN })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(3))
    await screen.findByRole('heading', { name: 'Dispensed' })
    await act(async () => { slow.resolve({ items: [accepted] }) })
    fireEvent.click(back())
    showTab('All')
    expect(within(row(AMOXICILLIN)).getByText('Dispensed')).toBeTruthy()
  })

  it('is not offered without pharmacy.dispensing.create', async () => {
    working([READ, DISPENSING_READ, REVERSE])
    await openRecord(AMOXICILLIN)
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(screen.getByText('You can’t dispense here')).toBeTruthy()
    expect(screen.getByText('Your role can see prescriptions but not dispense them. Ask a pharmacist.')).toBeTruthy()
  })
})

describe('Reverse dispensing', () => {
  beforeEach(() => { working([READ, DISPENSING_READ, REVERSE]) })

  it('is offered only on a dispensing still in effect, under Other actions', async () => {
    await openRecord(METFORMIN)
    const toggle = within(otherActions()).getByRole('button', { name: 'Reverse dispensing', expanded: false })
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-controls')).toBe(screen.getByRole('form', { name: 'Reverse dispensing' }).id)
    fireEvent.click(toggle)
    expect(screen.queryByRole('form')).toBeNull()
    fireEvent.click(back())
    for (const name of [AMOXICILLIN, SALBUTAMOL]) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(screen.queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
      fireEvent.click(back())
    }
  })

  it('asks to confirm, reads the dispensing again, reverses it at its current version, then reads the list again', async () => {
    const reversing = deferred<unknown>()
    api.reverseDispensing.mockReturnValueOnce(reversing.promise)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [dispensed] })
      .mockResolvedValueOnce({ items: [{ ...dispensed, version: 8, dispensing: { id: 'dispensing-2', reversed: true } }] })
    await openRecord(METFORMIN)
    const form = reverse('  Medication returned unopened by the patient  ')
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the patient' })
    expect(within(sheet).getByText(`Reverse the dispensing of ${METFORMIN} for Patient ••••a9b3c4?`)).toBeTruthy()
    expect(api.dispensing).not.toHaveBeenCalled()
    await confirmPatient('Reverse dispensing')
    await waitFor(() => expect(api.reverseDispensing).toHaveBeenCalledTimes(1))
    expect(api.dispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-2')
    expect(api.reverseDispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-2', 5, 'Medication returned unopened by the patient')
    expect(api.dispensing.mock.invocationCallOrder[0]).toBeLessThan(api.reverseDispensing.mock.invocationCallOrder[0] ?? -1)
    expect(within(form).getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
    await waitFor(() => expect(recordStatus()).toBe('Reversed'))
    expect(screen.queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${dispensed.id}-title`))
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('sends nothing when the reversal is not confirmed', async () => {
    await openRecord(METFORMIN)
    reverse('Medication returned unopened by the patient')
    await confirmPatient('Cancel')
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Reverse dispensing' })).toBeTruthy()
  })

  it('reads the dispensing on every try, so a retry after a version conflict uses its newer version', async () => {
    const reason = 'Medication returned unopened by the patient'
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-2', version: 5 }).mockResolvedValueOnce({ id: 'dispensing-2', version: 6 })
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(412, DISPENSING_VERSION_CONFLICT, { code: 'PHARMACY_DISPENSING_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'reversal-1' })
    await openRecord(METFORMIN)
    const form = reverse(reason)
    await confirmPatient('Reverse dispensing')
    expect((await within(form).findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain(DISPENSING_VERSION_CONFLICT)
    fireEvent.click(within(form).getByRole('button', { name: 'Reverse dispensing' }))
    await confirmPatient('Reverse dispensing')
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(1, DEMO_PHARMACY_ID, 'dispensing-2', 5, reason)
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(2, DEMO_PHARMACY_ID, 'dispensing-2', 6, reason)
  })

  it('refuses a reason under 8 characters at its field and reads nothing', async () => {
    await openRecord(METFORMIN)
    const form = reverse('   Recall   ')
    expect(refusal(within(form).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED, SAID_REFUSED],
    [404, 'PHARMACY_DISPENSING_NOT_FOUND', 'Dispensing was not found', SAID_NOT_FOUND],
  ])('does not reverse when the dispensing can’t be read (%i)', async (status, code, message, shown) => {
    api.dispensing.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    await openRecord(METFORMIN)
    const form = reverse('Medication returned unopened by the patient')
    await confirmPatient('Reverse dispensing')
    expect((await within(form).findByRole('alert')).textContent).toBe(shown)
    expect(document.body.textContent).not.toContain(message)
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(recordStatus()).toBe('Dispensed')
  })

  it.each([
    ['pharmacy.dispensing.read', [READ, CREATE, REVERSE]],
    ['pharmacy.dispensing.reverse', [READ, CREATE, DISPENSING_READ]],
  ])('is not offered without %s', async (_missing, permissions) => {
    working(permissions)
    await openRecord(METFORMIN)
    expect(screen.queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
  })

  it('clears what was recorded when a following reversal is refused', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockResolvedValueOnce({ items: [nowDispensed] })
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-9', version: 1 })
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(403, ACCESS_DENIED, { code: 'PHARMACY_ACCESS_DENIED' }))
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await waitFor(() => expect(recorded()).toBe('Dispensing recorded.'))
    await within(otherActions()).findByRole('button', { name: 'Reverse dispensing' })
    const reversal = reverse('Dispensed against the wrong prescription')
    await confirmPatient('Reverse dispensing')
    expect((await within(reversal).findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain(ACCESS_DENIED)
    expect(recorded()).toBe('')
    expect(api.reverseDispensing).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'dispensing-9', 1, 'Dispensed against the wrong prescription')
  })

  it('shows one form at a time', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed] })
    await openRecord(METFORMIN)
    fireEvent.click(within(otherActions()).getByRole('button', { name: 'Reverse dispensing', expanded: false }))
    expect(screen.getAllByRole('form').map(form => form.getAttribute('aria-label'))).toEqual(['Reverse dispensing'])
  })
})

describe('while a dispensing or reversal is sent', () => {
  it('holds Back to prescriptions, so a refusal that comes after a press is still said in the record', async () => {
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    const way = back()
    expect(way.getAttribute('aria-disabled')).toBe('true')
    expect(way.hasAttribute('disabled')).toBe(false)
    way.focus()
    fireEvent.click(way)
    expect(screen.getByRole('heading', { level: 1, name: AMOXICILLIN })).toBeTruthy()
    expect(document.activeElement).toBe(way)
    await act(async () => { recording.reject(new HidApiError(403, ACCESS_DENIED, { code: 'PHARMACY_ACCESS_DENIED' })) })
    expect((await within(screen.getByRole('form', { name: 'Dispense' })).findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain(ACCESS_DENIED)
    expect(way.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(way)
    expect(await screen.findByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
  })

  it('holds Back to prescriptions during a reversal, so its success is announced', async () => {
    working([READ, DISPENSING_READ, REVERSE])
    const reversing = deferred<unknown>()
    api.reverseDispensing.mockReturnValueOnce(reversing.promise)
    await openRecord(METFORMIN)
    reverse('Medication returned unopened by the patient')
    await confirmPatient('Reverse dispensing')
    await waitFor(() => expect(api.reverseDispensing).toHaveBeenCalledTimes(1))
    fireEvent.click(back())
    expect(screen.getByRole('heading', { level: 1, name: METFORMIN })).toBeTruthy()
    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })
    await waitFor(() => expect(recorded()).toBe('Dispensing reversal recorded.'))
  })

  it('moves focus to what was done as the picking view goes, before the list is read again', async () => {
    const reread = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(reread.promise)
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-done`)
    await act(async () => { reread.resolve({ items: [nowDispensed] }) })
    expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-done`)
  })

  it('moves focus to the list’s heading when the record leaves the list as it is read again', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted, dispensed] }).mockResolvedValueOnce({ items: [dispensed] })
    await openRecord(AMOXICILLIN)
    dispenseWith({ quantity: '21', reason: REASON })
    await confirmPatient('Dispense')
    await screen.findByRole('heading', { level: 1, name: 'Prescriptions' })
    await waitFor(() => expect(document.activeElement?.id).toBe('pharmacy-heading'))
    expect(screen.getByTestId('where').textContent).toBe(PRESCRIPTIONS)
  })
})
