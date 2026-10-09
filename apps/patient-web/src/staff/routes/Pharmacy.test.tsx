import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../api'
import { Pharmacy } from './Operations'

/**
 * The provider Pharmacy page: the accepted-prescription work list, full
 * dispensing, and reversal of a dispensing. The server owns patient
 * authorization; these tests pin what the page sends, what it gates on the
 * facility membership's permissions, and what it shows for each outcome.
 */
const api = vi.hoisted(() => ({
  pharmacyWorkItems: vi.fn(),
  dispense: vi.fn(),
  dispensing: vi.fn(),
  reverseDispensing: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', membershipId: 'member-1', permissions: staff.permissions,
  } } } } }),
}))
vi.mock('../api', () => ({ staffApi: api }))

const FACILITY = 'facility-1'
const WORK_ITEM_READ = 'pharmacy.work-item.read'
const DISPENSING_CREATE = 'pharmacy.dispensing.create'
const DISPENSING_READ = 'pharmacy.dispensing.read'
const DISPENSING_REVERSE = 'pharmacy.dispensing.reverse'

const PATIENT_A = '5f1c2e9a-7b44-4d0e-9a3f-0c2d4e6f8a10'
const PATIENT_B = '8d3b6a21-1e5c-4f7a-b2d9-71c0e5a9b3c4'
const PATIENT_C = 'c2a7f0d8-3b19-4c6e-8e45-9f1d2b7c6e58'

const AMOXICILLIN = 'Amoxicillin 500 mg capsule'
const METFORMIN = 'Metformin 850 mg tablet'
const SALBUTAMOL = 'Salbutamol 100 microgram inhaler'

/** Accepted, not yet dispensed. */
const accepted: PharmacyWorkItem = {
  id: 'work-item-1', patientId: PATIENT_A, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
  medication: { display: AMOXICILLIN }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily',
  dispensing: null,
}
/** Fully dispensed and still in effect. */
const dispensed: PharmacyWorkItem = {
  id: 'work-item-2', patientId: PATIENT_B, version: 7, acceptedAt: '2026-10-07T14:05:00.000Z',
  medication: { display: METFORMIN }, doseQuantity: 1, doseUnit: 'tablet', frequency: 'Twice daily with meals',
  dispensing: { id: 'dispensing-2', reversed: false },
}
/** Dispensed then reversed; dose and frequency were never recorded on the order. */
const reversed: PharmacyWorkItem = {
  id: 'work-item-3', patientId: PATIENT_C, version: 9, acceptedAt: '2026-10-06T08:00:00.000Z',
  medication: { display: SALBUTAMOL }, doseQuantity: null, doseUnit: null,
  dispensing: { id: 'dispensing-3', reversed: true },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

/** The list entry for one prescription, found by its medication display. */
async function findItem(medication: string): Promise<HTMLElement> {
  const title = await screen.findByText(medication)
  const item = title.closest<HTMLElement>('.staff-list-item')
  if (!item) throw new Error(`No work-item entry for ${medication}`)
  return item
}

function fillDispensing(item: HTMLElement, values: { quantity?: string; unit?: string; reason?: string }) {
  if (values.quantity !== undefined) fireEvent.change(within(item).getByRole('spinbutton', { name: 'Quantity dispensed' }), { target: { value: values.quantity } })
  if (values.unit !== undefined) fireEvent.change(within(item).getByRole('textbox', { name: 'Unit' }), { target: { value: values.unit } })
  if (values.reason !== undefined) fireEvent.change(within(item).getByRole('textbox', { name: 'Reason' }), { target: { value: values.reason } })
}

function fillReversal(item: HTMLElement, reason: string) {
  fireEvent.change(within(item).getByRole('textbox', { name: 'Reversal reason' }), { target: { value: reason } })
}

beforeEach(() => {
  // Reset (not just clear) so no queued once-implementation leaks between tests.
  vi.resetAllMocks()
  staff.permissions = [WORK_ITEM_READ]
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
  api.dispense.mockResolvedValue({ id: 'dispensing-new' })
  api.dispensing.mockResolvedValue({ id: 'dispensing-2', version: 5 })
  api.reverseDispensing.mockResolvedValue({ id: 'reversal-1' })
})

describe('Pharmacy page access', () => {
  it('shows the unavailable state and makes no API call without pharmacy work-item read permission', () => {
    staff.permissions = [DISPENSING_CREATE, DISPENSING_READ, DISPENSING_REVERSE]
    render(<Pharmacy />)

    expect(screen.getByRole('heading', { name: 'Pharmacy unavailable' })).toBeTruthy()
    expect(screen.getByText('This facility membership needs pharmacy work-item read permission.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Pharmacy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh work' })).toBeNull()
    expect(api.pharmacyWorkItems).not.toHaveBeenCalled()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
  })
})

describe('accepted prescription work list', () => {
  it('shows a loading status while the work list is pending', async () => {
    const load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(load.promise)
    render(<Pharmacy />)

    expect(screen.getByRole('heading', { name: 'Pharmacy' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(screen.getByRole('button', { name: 'Refresh work' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(FACILITY)

    await act(async () => { load.resolve({ items: [accepted] }) })

    expect(await screen.findByText(AMOXICILLIN)).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh work' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows the empty state and reloads the work list from its Refresh action', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [accepted] })
    render(<Pharmacy />)

    expect(await screen.findByRole('heading', { name: 'No accepted prescriptions' })).toBeTruthy()
    expect(screen.getByText('Refresh to check for new work at this facility.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText(AMOXICILLIN)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenNthCalledWith(1, FACILITY)
    expect(api.pharmacyWorkItems).toHaveBeenNthCalledWith(2, FACILITY)
  })

  it('shows the load error and recovers when the work list is refreshed', async () => {
    api.pharmacyWorkItems
      .mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
      .mockResolvedValueOnce({ items: [accepted] })
    render(<Pharmacy />)

    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))

    expect(await screen.findByText(AMOXICILLIN)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
  })

  it('keeps the current list on screen when a later refresh fails', async () => {
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockRejectedValueOnce(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
    render(<Pharmacy />)
    await findItem(AMOXICILLIN)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Pharmacy work is temporarily unavailable.')
    expect(screen.getByText(AMOXICILLIN)).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('lists each prescription with its medication, dose, frequency, masked patient and dispensing status', async () => {
    render(<Pharmacy />)

    const first = await findItem(AMOXICILLIN)
    expect(within(first).getByText('Patient ••••6f8a10 · 1 capsule · Three times daily')).toBeTruthy()
    expect(within(first).getByText('Accepted')).toBeTruthy()

    const second = await findItem(METFORMIN)
    expect(within(second).getByText('Patient ••••a9b3c4 · 1 tablet · Twice daily with meals')).toBeTruthy()
    expect(within(second).getByText('Dispensed')).toBeTruthy()

    const third = await findItem(SALBUTAMOL)
    expect(within(third).getByText('Patient ••••7c6e58 · Dose not recorded · Frequency not recorded')).toBeTruthy()
    expect(within(third).getByText('Reversed')).toBeTruthy()

    // Only the masked suffix of a patient ID may reach the page, in text or attributes.
    const markup = document.body.innerHTML
    for (const patientId of [PATIENT_A, PATIENT_B, PATIENT_C]) {
      expect(markup).not.toContain(patientId)
      expect(markup).not.toContain(patientId.slice(0, 8))
    }
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(FACILITY)
  })
})

describe('full dispensing', () => {
  beforeEach(() => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_CREATE]
  })

  it('offers full dispensing only on prescriptions that have not been dispensed', async () => {
    render(<Pharmacy />)

    const open = await findItem(AMOXICILLIN)
    expect(within(open).getByRole('button', { name: 'Record full dispensing' })).toBeTruthy()
    expect((within(open).getByRole('textbox', { name: 'Unit' }) as HTMLInputElement).value).toBe('capsule')
    expect((within(open).getByRole('spinbutton', { name: 'Quantity dispensed' }) as HTMLInputElement).value).toBe('')

    for (const medication of [METFORMIN, SALBUTAMOL]) {
      const done = await findItem(medication)
      expect(within(done).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
      expect(within(done).queryByRole('spinbutton', { name: 'Quantity dispensed' })).toBeNull()
    }
  })

  it('records full dispensing with the entered quantity, unit and reason, then reloads the work list', async () => {
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockResolvedValueOnce({ items: [{ ...accepted, version: 4, dispensing: { id: 'dispensing-9', reversed: false } }] })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: '  Full seven-day course dispensed at the counter  ' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 21, 'capsule', 'Full seven-day course dispensed at the counter')
    expect(within(item).getByRole('button', { name: 'Recording…' }).hasAttribute('disabled')).toBe(true)

    await act(async () => { recording.resolve({ id: 'dispensing-9' }) })

    expect((await within(item).findByRole('status')).textContent).toBe('Dispensing recorded.')
    expect(within(item).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(within(item).getByText('Dispensed')).toBeTruthy())
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
  })

  it('records the unit the pharmacist enters instead of the prescribed dose unit', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '1.5', unit: ' blister pack ', reason: 'Dispensed in original blister packs' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 1.5, 'blister pack', 'Dispensed in original blister packs')
    expect((await within(item).findByRole('status')).textContent).toBe('Dispensing recorded.')
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
  })

  it('rejects a reason shorter than 8 characters without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    // Seven characters once trimmed: long enough for the browser's minlength, too short for the page.
    fillDispensing(item, { quantity: '21', reason: '  Counter  ' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(within(item).getByRole('alert').textContent).toBe('Enter a reason of at least 8 characters.')
    expect(within(item).queryByRole('status')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it.each(['0', '-2'])('rejects a quantity of %s without calling the API', async quantity => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity, reason: 'Full course dispensed at counter' })
    // Submit the form directly: the input's min attribute would stop a browser
    // first, and this checks the page's own guard behind it.
    const form = within(item).getByRole('button', { name: 'Record full dispensing' }).closest('form')
    if (!form) throw new Error('Dispensing form not found')
    fireEvent.submit(form)

    expect(within(item).getByRole('alert').textContent).toBe('Enter a positive quantity and unit.')
    expect(within(item).queryByRole('status')).toBeNull()
    expect(within(item).getByRole('button', { name: 'Record full dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('rejects a blank unit without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', unit: '   ', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(within(item).getByRole('alert').textContent).toBe('Enter a positive quantity and unit.')
    expect(within(item).queryByRole('status')).toBeNull()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', 'Patient authorization is required to dispense this prescription.'],
    [409, 'CONFLICT', 'This prescription was changed by another user. Refresh and try again.'],
  ])('shows a %i dispensing failure without a success notice', async (status, code, message) => {
    api.dispense.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(message)
    expect(within(item).queryByText('Dispensing recorded.')).toBeNull()
    expect(within(item).getByText('Accepted')).toBeTruthy()
    expect(within(item).getByRole('button', { name: 'Record full dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 21, 'capsule', 'Full course dispensed at counter')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('does not offer dispensing without pharmacy.dispensing.create', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_READ, DISPENSING_REVERSE]
    render(<Pharmacy />)

    const item = await findItem(AMOXICILLIN)
    expect(within(item).getByText('Accepted')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(within(item).queryByRole('spinbutton', { name: 'Quantity dispensed' })).toBeNull()
    expect(within(item).queryByRole('textbox', { name: 'Reason' })).toBeNull()
  })
})

describe('dispensing reversal', () => {
  beforeEach(() => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_READ, DISPENSING_REVERSE]
  })

  it('offers reversal only on a dispensed prescription that has not been reversed', async () => {
    render(<Pharmacy />)

    const item = await findItem(METFORMIN)
    expect(within(item).getByRole('button', { name: 'Reverse dispensing' })).toBeTruthy()
    expect(within(item).getByRole('textbox', { name: 'Reversal reason' })).toBeTruthy()

    for (const medication of [AMOXICILLIN, SALBUTAMOL]) {
      const other = await findItem(medication)
      expect(within(other).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
      expect(within(other).queryByRole('textbox', { name: 'Reversal reason' })).toBeNull()
    }
  })

  it('re-reads the dispensing, reverses it at its current version, then reloads the work list', async () => {
    const reversing = deferred<unknown>()
    api.reverseDispensing.mockReturnValueOnce(reversing.promise)
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [dispensed] })
      .mockResolvedValueOnce({ items: [{ ...dispensed, version: 8, dispensing: { id: 'dispensing-2', reversed: true } }] })
    // The work list carries no dispensing version; the page must use the one it re-reads.
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-2', version: 5 })
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, '  Medication returned unopened by the patient  ')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    await waitFor(() => expect(api.reverseDispensing).toHaveBeenCalledTimes(1))
    expect(api.dispensing).toHaveBeenCalledTimes(1)
    expect(api.dispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2')
    expect(api.reverseDispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2', 5, 'Medication returned unopened by the patient')
    // The re-read happens first; -1 makes a missing reversal call fail the comparison.
    expect(api.dispensing.mock.invocationCallOrder[0]).toBeLessThan(api.reverseDispensing.mock.invocationCallOrder[0] ?? -1)
    expect(within(item).getByRole('button', { name: 'Recording…' }).hasAttribute('disabled')).toBe(true)

    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })

    expect((await within(item).findByRole('status')).textContent).toBe('Dispensing reversal recorded.')
    expect(within(item).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(within(item).getByText('Reversed')).toBeTruthy())
    expect(within(item).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
  })

  it('rejects a reversal reason shorter than 8 characters without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, '   Recall   ')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect(within(item).getByRole('alert').textContent).toBe('Enter a reason of at least 8 characters.')
    expect(within(item).queryByRole('status')).toBeNull()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('shows a reversal failure without a success notice', async () => {
    const message = 'The dispensing was changed by another user. Refresh and try again.'
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(409, message, { code: 'CONFLICT' }))
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, 'Medication returned unopened by the patient')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(message)
    expect(within(item).queryByText('Dispensing reversal recorded.')).toBeNull()
    expect(within(item).getByText('Dispensed')).toBeTruthy()
    expect(within(item).getByRole('button', { name: 'Reverse dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.reverseDispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2', 5, 'Medication returned unopened by the patient')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('does not attempt the reversal when the current dispensing cannot be read', async () => {
    const message = 'Patient authorization is required to view this dispensing.'
    api.dispensing.mockRejectedValueOnce(new HidApiError(403, message, { code: 'PHARMACY_ACCESS_DENIED' }))
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, 'Medication returned unopened by the patient')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(message)
    expect(within(item).queryByText('Dispensing reversal recorded.')).toBeNull()
    expect(api.dispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2')
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['pharmacy.dispensing.read', [WORK_ITEM_READ, DISPENSING_CREATE, DISPENSING_REVERSE]],
    ['pharmacy.dispensing.reverse', [WORK_ITEM_READ, DISPENSING_CREATE, DISPENSING_READ]],
  ])('does not offer reversal without %s', async (_missing, permissions) => {
    staff.permissions = permissions
    render(<Pharmacy />)

    const item = await findItem(METFORMIN)
    expect(within(item).getByText('Dispensed')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    expect(within(item).queryByRole('textbox', { name: 'Reversal reason' })).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
  })

  it('shows a reversed prescription with its badge and offers neither dispensing nor reversal', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_CREATE, DISPENSING_READ, DISPENSING_REVERSE]
    render(<Pharmacy />)

    const item = await findItem(SALBUTAMOL)
    expect(within(item).getByText('Reversed')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    expect(within(item).queryByRole('textbox')).toBeNull()
    expect(within(item).queryByRole('spinbutton')).toBeNull()
  })
})
