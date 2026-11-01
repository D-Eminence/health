import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem, staffApi } from '../api'
import { Pharmacy } from './Operations'
import { SAID_CHANGED, SAID_NOT_FOUND, SAID_REFUSED, SAID_UNAVAILABLE } from '../../__tests__/said'

/**
 * The provider Pharmacy page: the accepted-prescription work list, full
 * dispensing, and reversal of a dispensing. The server owns patient
 * authorization; these tests pin what the page sends, what it gates on the
 * facility membership's permissions, and what it shows for each outcome.
 */
type StaffApi = typeof staffApi

const api = vi.hoisted(() => ({
  pharmacyWorkItems: vi.fn<StaffApi['pharmacyWorkItems']>(),
  dispense: vi.fn<StaffApi['dispense']>(),
  dispensing: vi.fn<StaffApi['dispensing']>(),
  reverseDispensing: vi.fn<StaffApi['reverseDispensing']>(),
}))
/** The staff session the page sees; each test may change it before rendering. */
const staff = vi.hoisted(() => ({ ready: true, facilityId: 'facility-1' as string | null, permissions: [] as string[] }))

vi.mock('../App', () => ({
  useStaff: () => ({
    state: staff.ready
      ? { status: 'ready', session: { actor: { facility: staff.facilityId === null ? undefined : {
        id: staff.facilityId, membershipId: 'member-1', permissions: staff.permissions,
      } } } }
      : { status: 'loading', session: null },
  }),
}))
vi.mock('../api', () => ({ staffApi: api }))

const FACILITY = 'facility-1'
const FACILITY_2 = 'facility-2'
const WORK_ITEM_READ = 'pharmacy.work-item.read'
const DISPENSING_CREATE = 'pharmacy.dispensing.create'
const DISPENSING_READ = 'pharmacy.dispensing.read'
const DISPENSING_REVERSE = 'pharmacy.dispensing.reverse'
const ALL_PERMISSIONS = [WORK_ITEM_READ, DISPENSING_CREATE, DISPENSING_READ, DISPENSING_REVERSE]

const PATIENT_A = '5f1c2e9a-7b44-4d0e-9a3f-0c2d4e6f8a10'
const PATIENT_B = '8d3b6a21-1e5c-4f7a-b2d9-71c0e5a9b3c4'
const PATIENT_C = 'c2a7f0d8-3b19-4c6e-8e45-9f1d2b7c6e58'
const PATIENT_D = '3e9d1b70-6a2f-4c85-b1e4-5d7a0c9f2b36'

const AMOXICILLIN = 'Amoxicillin 500 mg capsule'
const METFORMIN = 'Metformin 850 mg tablet'
const SALBUTAMOL = 'Salbutamol 100 microgram inhaler'
const IBUPROFEN = 'Ibuprofen 400 mg tablet'

/** Problems as the pharmacy service and HTTP client report them. */
const ACCESS_DENIED = 'Pharmacy access is not authorized'
const WORK_ITEM_VERSION_CONFLICT = 'Dispensing must bind to the exact accepted work-item version'
const DISPENSING_VERSION_CONFLICT = 'Reversal must bind to the exact dispensing version'
const WORK_UNAVAILABLE = 'Pharmacy work is temporarily unavailable.'
// What the work list says once it holds as many items as the backend sends.
const WORK_LIST_CAP_NOTICE = 'This list can show only the 200 oldest accepted work items. Any item accepted after them is not shown and cannot be reached from this page: completing work or refreshing the list does not bring it into view. Contact your facility administrator about orders not listed here.'
const workUnavailable = () => new HidApiError(503, WORK_UNAVAILABLE, { code: 'PHARMACY_SERVICE_UNAVAILABLE' })

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
/** Accepted at the second facility. */
const otherFacilityItem: PharmacyWorkItem = {
  id: 'work-item-4', patientId: PATIENT_D, version: 2, acceptedAt: '2026-10-08T11:15:00.000Z',
  medication: { display: IBUPROFEN }, doseQuantity: 1, doseUnit: 'tablet', frequency: 'Every eight hours as needed',
  dispensing: null,
}
/** The accepted item as the work list reports it once a dispensing is recorded. */
const nowDispensed: PharmacyWorkItem = { ...accepted, version: 4, dispensing: { id: 'dispensing-9', reversed: false } }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(onResolve => { resolve = onResolve })
  return { promise, resolve }
}

/**
 * The list entry for one prescription, found by its medication display. The
 * entry has no role or accessible name of its own, so its list-item class is
 * the only stable container to scope assertions to.
 */
async function findItem(medication: string): Promise<HTMLElement> {
  const title = await screen.findByText(medication)
  const item = title.closest<HTMLElement>('.staff-list-item')
  if (!item) throw new Error(`No work-item entry for ${medication}`)
  return item
}

/**
 * What a work item's status region says. The region is mounted with the item,
 * empty, so that what is recorded later is announced (NEW-PEHR-ACTION-FOCUS).
 */
function confirmation(item: HTMLElement) {
  return within(item).getByRole('status').textContent
}

/**
 * The error a refused field is described by, or null while it is not marked
 * invalid: a value refused before sending is reported at its field (PEHR-04).
 */
function refusal(control: HTMLElement) {
  if (control.getAttribute('aria-invalid') !== 'true') return null
  return document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent ?? ''
}

/** The status messages on the page: a work item's region says nothing until something is recorded. */
function statusesSaying() {
  return screen.queryAllByRole('status').map(status => status.textContent).filter(Boolean)
}

function fillDispensing(item: HTMLElement, values: { quantity?: string; unit?: string; reason?: string }) {
  if (values.quantity !== undefined) fireEvent.change(within(item).getByRole('spinbutton', { name: 'Quantity dispensed' }), { target: { value: values.quantity } })
  if (values.unit !== undefined) fireEvent.change(within(item).getByRole('textbox', { name: 'Unit' }), { target: { value: values.unit } })
  if (values.reason !== undefined) fireEvent.change(within(item).getByRole('textbox', { name: 'Reason' }), { target: { value: values.reason } })
}

function fillReversal(item: HTMLElement, reason: string) {
  fireEvent.change(within(item).getByRole('textbox', { name: 'Reversal reason' }), { target: { value: reason } })
}

/**
 * Only the 6-character suffix of a patient ID may reach the page, in text or
 * in attributes: no full ID (with or without hyphens), no prefix, and no
 * suffix longer than the masked one.
 */
function expectNoFullPatientIds() {
  const markup = document.body.innerHTML
  for (const patientId of [PATIENT_A, PATIENT_B, PATIENT_C, PATIENT_D]) {
    expect(markup).not.toContain(patientId)
    expect(markup).not.toContain(patientId.replaceAll('-', ''))
    expect(markup).not.toContain(patientId.slice(0, 8))
    expect(markup).not.toContain(patientId.slice(-7))
  }
}

beforeEach(() => {
  // Reset (not just clear) so no queued once-implementation leaks between tests.
  vi.resetAllMocks()
  staff.ready = true
  staff.facilityId = FACILITY
  staff.permissions = [WORK_ITEM_READ]
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
  api.dispense.mockResolvedValue({ id: 'dispensing-new' })
  api.dispensing.mockResolvedValue({ id: 'dispensing-2', version: 5 })
  api.reverseDispensing.mockResolvedValue({ id: 'reversal-1' })
})

describe('Pharmacy page access', () => {
  // Screens name no permission (the owner's rule): at a facility, what the role there doesn't include, in the blue
  // Pharmacy's words; before a facility is chosen there is no role yet, so it asks for one.
  const NO_PHARMACY_WORK = 'Your role at this facility doesn’t include pharmacy work. Ask your facility administrator.'
  const CHOOSE_FACILITY = 'Choose a facility under “Working at” first.'
  function expectUnavailable(sentence: string) {
    expect(screen.getByRole('heading', { name: 'Pharmacy unavailable' })).toBeTruthy()
    expect(screen.getByText(sentence)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/permission|membership|work-item|pharmacy\.work-item\.read/i)
    expect(screen.queryByRole('heading', { name: 'Pharmacy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh work' })).toBeNull()
    expect(api.pharmacyWorkItems).not.toHaveBeenCalled()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
  }

  it('shows the unavailable state and makes no API call without pharmacy work-item read permission', () => {
    staff.permissions = [DISPENSING_CREATE, DISPENSING_READ, DISPENSING_REVERSE]
    render(<Pharmacy />)

    expectUnavailable(NO_PHARMACY_WORK)
  })

  it.each([
    ['the staff session is not ready', () => { staff.ready = false }],
    ['no facility is active', () => { staff.facilityId = null }],
  ])('shows the unavailable state and makes no API call when %s', (_case, arrange) => {
    staff.permissions = ALL_PERMISSIONS
    arrange()
    render(<Pharmacy />)

    expectUnavailable(CHOOSE_FACILITY)
  })
})

describe('accepted prescription work list', () => {
  it('shows a loading status while the work list is pending', async () => {
    const load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(load.promise)
    render(<Pharmacy />)

    expect(screen.getByRole('heading', { name: 'Pharmacy' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    // Unavailable while the list is read, yet focusable (NEW-PEHR-ACTION-FOCUS).
    expect(screen.getByRole('button', { name: 'Refresh work' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(FACILITY)

    await act(async () => { load.resolve({ items: [accepted] }) })

    expect(await screen.findByText(AMOXICILLIN)).toBeTruthy()
    expect(statusesSaying()).toEqual([])
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
      .mockRejectedValueOnce(workUnavailable())
      .mockResolvedValueOnce({ items: [accepted] })
    render(<Pharmacy />)

    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain(WORK_UNAVAILABLE)
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))

    expect(await screen.findByText(AMOXICILLIN)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
  })

  it('shows a refused work-list load without any patient data', async () => {
    const message = 'You do not have permission to do that.'
    api.pharmacyWorkItems.mockRejectedValueOnce(new HidApiError(403, message, { code: 'PERMISSION_DENIED' }))
    render(<Pharmacy />)

    expect((await screen.findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain(message)
    for (const medication of [AMOXICILLIN, METFORMIN, SALBUTAMOL]) expect(screen.queryByText(medication)).toBeNull()
    expect(document.body.textContent).not.toContain('Patient ••••')
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expectNoFullPatientIds()
  })

  it('shows a generic load error when the rejection carries no message', async () => {
    // Not an Error instance, so there is no message the page could show.
    api.pharmacyWorkItems.mockRejectedValueOnce({ status: 0 })
    render(<Pharmacy />)

    expect((await screen.findByRole('alert')).textContent).toBe('Work could not be loaded.')
    expect(screen.queryByRole('heading', { name: 'No accepted prescriptions' })).toBeNull()
  })

  it('keeps the list on screen without a loading status while a refresh is pending', async () => {
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(reload.promise)
    render(<Pharmacy />)
    await findItem(AMOXICILLIN)

    const refresh = screen.getByRole('button', { name: 'Refresh work' })
    fireEvent.click(refresh)

    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(AMOXICILLIN)).toBeTruthy()
    expect(statusesSaying()).toEqual([])
    expect(screen.queryByText('Loading…')).toBeNull()

    await act(async () => { reload.resolve({ items: [accepted, dispensed] }) })

    expect(await screen.findByText(METFORMIN)).toBeTruthy()
    expect(refresh.hasAttribute('disabled')).toBe(false)
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('keeps the current list on screen when a later refresh fails', async () => {
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockRejectedValueOnce(workUnavailable())
    render(<Pharmacy />)
    await findItem(AMOXICILLIN)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))

    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain(WORK_UNAVAILABLE)
    expect(screen.getByText(AMOXICILLIN)).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('does not let an older, slower refresh overwrite a newer work list', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_CREATE]
    const slow = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ items: [nowDispensed] })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    // A manual refresh is still in flight when a dispensing triggers a newer reload.
    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))
    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))
    await waitFor(() => expect(within(item).getByText('Dispensed')).toBeTruthy())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(3)

    await act(async () => { slow.resolve({ items: [accepted] }) })

    expect(within(item).getByText('Dispensed')).toBeTruthy()
    expect(within(item).queryByText('Accepted')).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
  })

  it('lists each prescription with its medication, dose, frequency, masked patient and dispensing status', async () => {
    render(<Pharmacy />)

    const first = await findItem(AMOXICILLIN)
    expect(within(first).getByText('Patient ••••6f8a10 · 1 capsule · Three times daily')).toBeTruthy()
    expect(within(first).getByText('Accepted')).toBeTruthy()
    expect(within(first).queryByText('Dispensed')).toBeNull()
    expect(within(first).queryByText('Reversed')).toBeNull()

    const second = await findItem(METFORMIN)
    expect(within(second).getByText('Patient ••••a9b3c4 · 1 tablet · Twice daily with meals')).toBeTruthy()
    expect(within(second).getByText('Dispensed')).toBeTruthy()
    expect(within(second).queryByText('Accepted')).toBeNull()
    expect(within(second).queryByText('Reversed')).toBeNull()

    const third = await findItem(SALBUTAMOL)
    expect(within(third).getByText('Patient ••••7c6e58 · Dose not recorded · Frequency not recorded')).toBeTruthy()
    expect(within(third).getByText('Reversed')).toBeTruthy()
    expect(within(third).queryByText('Accepted')).toBeNull()
    expect(within(third).queryByText('Dispensed')).toBeNull()

    expectNoFullPatientIds()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(FACILITY)
  })

  it('never renders a full patient ID while the dispensing and reversal forms are shown', async () => {
    staff.permissions = ALL_PERMISSIONS
    render(<Pharmacy />)

    expect(within(await findItem(AMOXICILLIN)).getByRole('button', { name: 'Record full dispensing' })).toBeTruthy()
    expect(within(await findItem(METFORMIN)).getByRole('button', { name: 'Reverse dispensing' })).toBeTruthy()
    expectNoFullPatientIds()
  })
})

describe('active facility', () => {
  it('drops the previous facility\'s work and uses the new facility for loading and dispensing', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_CREATE]
    const facility2Load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockReturnValueOnce(facility2Load.promise)
      .mockResolvedValueOnce({ items: [{ ...otherFacilityItem, version: 3, dispensing: { id: 'dispensing-12', reversed: false } }] })
    const { rerender } = render(<Pharmacy />)
    await findItem(AMOXICILLIN)

    staff.facilityId = FACILITY_2
    rerender(<Pharmacy />)

    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading…')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY_2)

    await act(async () => { facility2Load.resolve({ items: [otherFacilityItem] }) })
    const item = await findItem(IBUPROFEN)
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()

    fillDispensing(item, { quantity: '12', reason: 'Twelve tablets dispensed at the counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    expect(api.dispense).toHaveBeenCalledWith(FACILITY_2, otherFacilityItem, 12, 'tablet', 'Twelve tablets dispensed at the counter')
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(3))
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY_2)
  })

  it('ignores a late work-list response for the previous facility', async () => {
    const facility1Load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(facility1Load.promise).mockResolvedValueOnce({ items: [otherFacilityItem] })
    const { rerender } = render(<Pharmacy />)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(FACILITY)

    staff.facilityId = FACILITY_2
    rerender(<Pharmacy />)
    await findItem(IBUPROFEN)

    await act(async () => { facility1Load.resolve({ items: [accepted, dispensed] }) })

    expect(screen.getByText(IBUPROFEN)).toBeTruthy()
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.queryByText(METFORMIN)).toBeNull()
    expect(document.body.textContent).not.toContain('••••6f8a10')
    expect(document.body.textContent).not.toContain('••••a9b3c4')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY_2)
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
      .mockResolvedValueOnce({ items: [nowDispensed] })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: '  Full seven-day course dispensed at the counter  ' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 21, 'capsule', 'Full seven-day course dispensed at the counter')
    expect(within(item).getByRole('button', { name: 'Recording…' }).getAttribute('aria-disabled')).toBe('true')

    await act(async () => { recording.resolve({ id: 'dispensing-9' }) })

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    expect(within(item).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(within(item).getByText('Dispensed')).toBeTruthy())
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
    expectNoFullPatientIds()
  })

  it('records the unit the pharmacist enters instead of the prescribed dose unit', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '1.5', unit: ' blister pack ', reason: 'Dispensed in original blister packs' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 1.5, 'blister pack', 'Dispensed in original blister packs')
    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    await waitFor(() => expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2))
  })

  it('rejects a reason shorter than 8 characters without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    // Seven characters once trimmed: long enough for the browser's minlength, too short for the page.
    fillDispensing(item, { quantity: '21', reason: '  Counter  ' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(refusal(within(item).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(confirmation(item)).toBe('')
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('accepts a reason of exactly 8 characters once trimmed', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: '  Complete  ' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 21, 'capsule', 'Complete')
    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    expect(within(item).queryByRole('alert')).toBeNull()
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

    expect(refusal(within(item).getByRole('spinbutton', { name: 'Quantity dispensed' }))).toBe('Enter a positive quantity and unit.')
    expect(confirmation(item)).toBe('')
    expect(within(item).getByRole('button', { name: 'Record full dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('rejects a blank unit without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', unit: '   ', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect(refusal(within(item).getByRole('textbox', { name: 'Unit' }))).toBe('Enter a positive quantity and unit.')
    expect(confirmation(item)).toBe('')
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED, SAID_REFUSED],
    [409, 'PHARMACY_WORK_ITEM_ALREADY_DISPENSED', 'A full dispensing is already recorded for this work item; partial dispensing is not supported',
      'Pharmacy action could not be recorded.'],
    [412, 'PHARMACY_WORK_ITEM_VERSION_CONFLICT', WORK_ITEM_VERSION_CONFLICT, SAID_CHANGED],
  ])('shows a %i dispensing failure without a success notice, in plain words', async (status, code, message, shown) => {
    api.dispense.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(shown)
    expect(document.body.textContent).not.toContain(message)
    expect(within(item).queryByText('Dispensing recorded.')).toBeNull()
    expect(within(item).getByText('Accepted')).toBeTruthy()
    expect(within(item).getByRole('button', { name: 'Record full dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.dispense).toHaveBeenCalledWith(FACILITY, accepted, 21, 'capsule', 'Full course dispensed at counter')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expectNoFullPatientIds()
  })

  // hid-system #48 (migration 0080): Pharmacy dispenses only while the EHR prescription is
  // still active at the version it accepted. Work whose prescription changed stays listed as
  // accepted, and nothing in the list tells it apart until a dispensing is refused.
  it('marks work whose prescription changed as not dispensable, and offers no dispensing for it', async () => {
    api.dispense.mockRejectedValueOnce(new HidApiError(409,
      'The EHR prescription for this work item is no longer active at the version Pharmacy accepted; nothing was dispensed',
      { code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE' }))
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    const said = await within(item).findByRole('alert')
    // Pharmacy answers so too for a prescription it cannot read (INTERFACE_CONTRACT.md, dispensing; migration 0080:
    // one its owner cannot lock reads as missing), not only a changed one, and the answer does not tell them apart.
    expect(said.textContent).toBe('Not dispensable: the prescription is no longer active at the version Pharmacy accepted, or could not be checked; a new prescription and handoff are needed.')
    expect(within(item).getByText('Not dispensable')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(within(item).queryByText('Dispensing recorded.')).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    // The other work in the list is unchanged.
    expect(within(await findItem(METFORMIN)).queryByText('Not dispensable')).toBeNull()
  })

  it('shows a generic dispensing failure when the rejection carries no message', async () => {
    // Not an Error instance, so there is no message the page could show.
    api.dispense.mockRejectedValueOnce({ status: 0 })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe('Pharmacy action could not be recorded.')
    expect(confirmation(item)).toBe('')
  })

  it('dispenses against the refreshed work item when retrying after a version conflict', async () => {
    const reason = 'Full course dispensed at counter'
    const refreshed: PharmacyWorkItem = { ...accepted, version: 4 }
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockResolvedValueOnce({ items: [refreshed] })
      .mockResolvedValueOnce({ items: [{ ...refreshed, version: 5, dispensing: { id: 'dispensing-9', reversed: false } }] })
    api.dispense
      .mockRejectedValueOnce(new HidApiError(412, WORK_ITEM_VERSION_CONFLICT, { code: 'PHARMACY_WORK_ITEM_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'dispensing-9' })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))
    expect((await within(item).findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain(WORK_ITEM_VERSION_CONFLICT)

    const refresh = screen.getByRole('button', { name: 'Refresh work' })
    fireEvent.click(refresh)
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    await waitFor(() => expect(refresh.getAttribute('aria-disabled')).toBeNull())
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)

    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    expect(within(item).queryByRole('alert')).toBeNull()
    expect(api.dispense).toHaveBeenCalledTimes(2)
    expect(api.dispense).toHaveBeenNthCalledWith(1, FACILITY, accepted, 21, 'capsule', reason)
    // The second attempt carries the refreshed work-item version as its concurrency token.
    expect(api.dispense).toHaveBeenNthCalledWith(2, FACILITY, refreshed, 21, 'capsule', reason)
    await waitFor(() => expect(within(item).getByText('Dispensed')).toBeTruthy())
  })

  it('keeps the dispensing notice and the last loaded list when the follow-up reload fails', async () => {
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockRejectedValueOnce(workUnavailable())
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain(WORK_UNAVAILABLE)
    expect(within(item).queryByRole('alert')).toBeNull()
    expect(screen.getByText(AMOXICILLIN)).toBeTruthy()
    // The reload failed, so the page still shows the last list it loaded rather than guessing.
    expect(within(item).getByText('Accepted')).toBeTruthy()
    expect(api.dispense).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
  })

  it('does not offer dispensing without pharmacy.dispensing.create', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_READ, DISPENSING_REVERSE]
    render(<Pharmacy />)

    const item = await findItem(AMOXICILLIN)
    expect(within(item).getByText('Accepted')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(within(item).queryByRole('spinbutton', { name: 'Quantity dispensed' })).toBeNull()
    expect(within(item).queryByRole('textbox', { name: 'Reason' })).toBeNull()
    // Positive control: the same render still offers reversal where it applies.
    expect(within(await findItem(METFORMIN)).getByRole('button', { name: 'Reverse dispensing' })).toBeTruthy()
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
    // The re-read returns the same id it was asked for, as the service does, so
    // this pins the version only: current.id and item.dispensing.id are equal.
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
    expect(within(item).getByRole('button', { name: 'Recording…' }).getAttribute('aria-disabled')).toBe('true')

    await act(async () => { reversing.resolve({ id: 'reversal-1' }) })

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing reversal recorded.'))
    expect(within(item).queryByRole('alert')).toBeNull()
    await waitFor(() => expect(within(item).getByText('Reversed')).toBeTruthy())
    expect(within(item).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(FACILITY)
    expectNoFullPatientIds()
  })

  it('re-reads the dispensing on every attempt so a retry after a version conflict uses the newer version', async () => {
    const reason = 'Medication returned unopened by the patient'
    api.dispensing
      .mockResolvedValueOnce({ id: 'dispensing-2', version: 5 })
      .mockResolvedValueOnce({ id: 'dispensing-2', version: 6 })
    api.reverseDispensing
      .mockRejectedValueOnce(new HidApiError(412, DISPENSING_VERSION_CONFLICT, { code: 'PHARMACY_DISPENSING_VERSION_CONFLICT' }))
      .mockResolvedValueOnce({ id: 'reversal-1' })
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, reason)
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))
    expect((await within(item).findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain(DISPENSING_VERSION_CONFLICT)

    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing reversal recorded.'))
    expect(within(item).queryByRole('alert')).toBeNull()
    expect(api.dispensing).toHaveBeenCalledTimes(2)
    expect(api.dispensing).toHaveBeenNthCalledWith(1, FACILITY, 'dispensing-2')
    expect(api.dispensing).toHaveBeenNthCalledWith(2, FACILITY, 'dispensing-2')
    expect(api.reverseDispensing).toHaveBeenCalledTimes(2)
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(1, FACILITY, 'dispensing-2', 5, reason)
    expect(api.reverseDispensing).toHaveBeenNthCalledWith(2, FACILITY, 'dispensing-2', 6, reason)
  })

  it('rejects a reversal reason shorter than 8 characters without calling the API', async () => {
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, '   Recall   ')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect(refusal(within(item).getByRole('textbox', { name: 'Reversal reason' }))).toBe('Enter a reason of at least 8 characters.')
    expect(confirmation(item)).toBe('')
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('accepts a reversal reason of exactly 8 characters once trimmed', async () => {
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, ' Returned ')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    await waitFor(() => expect(confirmation(item)).toBe('Dispensing reversal recorded.'))
    expect(api.reverseDispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2', 5, 'Returned')
    expect(within(item).queryByRole('alert')).toBeNull()
  })

  it('shows a reversal failure without a success notice', async () => {
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(412, DISPENSING_VERSION_CONFLICT, { code: 'PHARMACY_DISPENSING_VERSION_CONFLICT' }))
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, 'Medication returned unopened by the patient')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(SAID_CHANGED)
    expect(document.body.textContent).not.toContain(DISPENSING_VERSION_CONFLICT)
    expect(within(item).queryByText('Dispensing reversal recorded.')).toBeNull()
    expect(within(item).getByText('Dispensed')).toBeTruthy()
    expect(within(item).getByRole('button', { name: 'Reverse dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.reverseDispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2', 5, 'Medication returned unopened by the patient')
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it.each([
    [403, 'PHARMACY_ACCESS_DENIED', ACCESS_DENIED, SAID_REFUSED],
    [404, 'PHARMACY_DISPENSING_NOT_FOUND', 'Dispensing was not found', SAID_NOT_FOUND],
  ])('does not attempt the reversal when the current dispensing cannot be read (%i)', async (status, code, message, shown) => {
    api.dispensing.mockRejectedValueOnce(new HidApiError(status, message, { code }))
    render(<Pharmacy />)
    const item = await findItem(METFORMIN)

    fillReversal(item, 'Medication returned unopened by the patient')
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(shown)
    expect(document.body.textContent).not.toContain(message)
    expect(within(item).queryByText('Dispensing reversal recorded.')).toBeNull()
    expect(within(item).getByText('Dispensed')).toBeTruthy()
    expect(within(item).getByRole('button', { name: 'Reverse dispensing' }).hasAttribute('disabled')).toBe(false)
    expect(api.dispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-2')
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expectNoFullPatientIds()
  })

  it('clears the dispensing notice when a following reversal fails', async () => {
    staff.permissions = ALL_PERMISSIONS
    const reason = 'Dispensed against the wrong prescription'
    api.pharmacyWorkItems
      .mockResolvedValueOnce({ items: [accepted] })
      .mockResolvedValueOnce({ items: [nowDispensed] })
    api.dispensing.mockResolvedValueOnce({ id: 'dispensing-9', version: 1 })
    api.reverseDispensing.mockRejectedValueOnce(new HidApiError(403, ACCESS_DENIED, { code: 'PHARMACY_ACCESS_DENIED' }))
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)

    fillDispensing(item, { quantity: '21', reason: 'Full course dispensed at counter' })
    fireEvent.click(within(item).getByRole('button', { name: 'Record full dispensing' }))
    await waitFor(() => expect(confirmation(item)).toBe('Dispensing recorded.'))
    await within(item).findByRole('button', { name: 'Reverse dispensing' })
    expectNoFullPatientIds()

    fillReversal(item, reason)
    fireEvent.click(within(item).getByRole('button', { name: 'Reverse dispensing' }))

    expect((await within(item).findByRole('alert')).textContent).toBe(SAID_REFUSED)
    expect(document.body.textContent).not.toContain(ACCESS_DENIED)
    expect(confirmation(item)).toBe('')
    expect(within(item).queryByText('Dispensing recorded.')).toBeNull()
    expect(api.dispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-9')
    expect(api.reverseDispensing).toHaveBeenCalledWith(FACILITY, 'dispensing-9', 1, reason)
    expectNoFullPatientIds()
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
    // Positive control: the same render still offers dispensing where it applies.
    expect(within(await findItem(AMOXICILLIN)).getByRole('button', { name: 'Record full dispensing' })).toBeTruthy()
  })

  it('shows a reversed prescription with its badge and offers neither dispensing nor reversal', async () => {
    staff.permissions = ALL_PERMISSIONS
    render(<Pharmacy />)

    const item = await findItem(SALBUTAMOL)
    expect(within(item).getByText('Reversed')).toBeTruthy()
    expect(within(item).queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(within(item).queryByRole('button', { name: 'Reverse dispensing' })).toBeNull()
    expect(within(item).queryByRole('textbox')).toBeNull()
    expect(within(item).queryByRole('spinbutton')).toBeNull()
    // Positive controls: with the same permissions the other items offer their forms.
    expect(within(await findItem(AMOXICILLIN)).getByRole('button', { name: 'Record full dispensing' })).toBeTruthy()
    expect(within(await findItem(METFORMIN)).getByRole('button', { name: 'Reverse dispensing' })).toBeTruthy()
  })
})

describe('what the dispensing card shows of the prescription (PHARM-01)', () => {
  it('shows the prescription’s instructions and route, which the work item carries, before dispensing', async () => {
    staff.permissions = [WORK_ITEM_READ, DISPENSING_CREATE]
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...accepted, routeCode: 'oral', instructions: 'Take with food.\nFinish the course.' }] })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)
    expect(within(item).getByText(/Route: oral/)).toBeTruthy()
    const instructions = within(item).getByText(/Take with food\./)
    expect(instructions.textContent).toBe('Take with food.\nFinish the course.')
    // Read before the form that records the dispensing.
    const form = within(item).getByRole('button', { name: 'Record full dispensing' }).closest('form')!
    expect(instructions.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says when no route was recorded', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...accepted, routeCode: null, instructions: 'Take with food.' }] })
    render(<Pharmacy />)
    const item = await findItem(AMOXICILLIN)
    expect(within(item).getByText(/Route not recorded/)).toBeTruthy()
  })
})

describe('the work list says when the backend cut it short', () => {
  // Pharmacy lists at most 200 work items, oldest accepted first, every one ever accepted
  // (work items are insert-only) and no further page (pharmacy.service.ts listWorkItems):
  // dispensing never makes room.
  const many = (count: number) => Array.from({ length: count }, (_, n) => ({ ...accepted, id: `work-item-${n}` }))

  it('says that newer items cannot be reached from this page, and whom to ask, when the list holds 200', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(200) })
    render(<Pharmacy />)
    expect((await screen.findByText(/oldest accepted work items/)).textContent).toBe(WORK_LIST_CAP_NOTICE)
    // hid-system #48: work whose prescription changed cannot be dispensed but stays listed.
    expect(screen.getByText(/whose prescription changed after Pharmacy accepted it/).textContent)
      .toBe('Work whose prescription changed after Pharmacy accepted it cannot be dispensed, but it stays listed and counts toward these 200.')
  })

  it('says nothing of the kind for a shorter list', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(199) })
    render(<Pharmacy />)
    await screen.findAllByText(AMOXICILLIN)
    expect(screen.queryByText(/oldest accepted work items/)).toBeNull()
    expect(screen.queryByText(/counts toward these 200/)).toBeNull()
  })
})
