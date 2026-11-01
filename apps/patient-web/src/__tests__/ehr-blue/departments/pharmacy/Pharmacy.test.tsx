import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { pharmacyPage } from '../../../../ehr-blue/departments/pharmacy/page'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { dateText } from '../../../../ehr-blue/departments/parts/format'
import { DEMO_HOSPITAL_ID, DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, ALL, AMOXICILLIN, CREATE, deferred, dispensed, expectNoFullPatientIds, facts, IBUPROFEN, METFORMIN, otherActions,
  otherFacilityItem, pickCard, PRESCRIPTIONS, READ, recordStatus, reversed, row, SALBUTAMOL, showTab, Where,
} from './fixtures'

/**
 * Pharmacy's Prescriptions page (the owner's product menu): who may open it, the queue of cards with its tabs, loading,
 * empty, refused and cut-short states, its search and pages, opening a prescription's picking view by its address and
 * going back, and the working facility. Dispensing and work from other facilities have their own files.
 */
const session = vi.hoisted(() => ({ ready: true, facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), decline: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))
/** Any staffApi member the page reaches for besides the four it may use. */
const strays = vi.hoisted(() => new Set<string>())

const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => session.ready ? staffContext(session.facility) : { state: { status: 'loading' }, lock: null } }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: routes,
}))

function working(permissions: string[], overrides: Partial<FakeFacility> = {}) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'], ...overrides })
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  session.ready = true
  working([READ])
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed, reversed] })
})
afterEach(() => {
  expect([...strays]).toEqual([])
  // Nothing about the work reaches the address or the browser's storage.
  expect(window.location.hash).toBe('')
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
})

/** Prescriptions at its address, with the address shown beside it. */
function renderPage(route = PRESCRIPTIONS) {
  return renderDept(<><Pharmacy /><Where /></>, { route })
}

async function renderList() {
  renderPage()
  await screen.findByRole('button', { name: AMOXICILLIN })
}

describe('the page entry', () => {
  it('is listed live in the Pharmacy group for members who read pharmacy work, and says today’s refusal to others', () => {
    expect(pharmacyPage).toMatchObject({ path: 'pharmacy/prescriptions/*', group: 'Pharmacy', label: 'Prescriptions', permission: READ, status: 'live' })
    renderDept(<>{pharmacyPage.refusal}</>)
    expect(screen.getByRole('heading', { level: 1, name: 'Pharmacy unavailable' })).toBeTruthy()
    expect(screen.getByText('This facility membership needs pharmacy work-item read permission.')).toBeTruthy()
  })
})

describe('who may open Prescriptions', () => {
  function expectRefused() {
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.getByText('You can’t open Prescriptions here. Your role needs permission to see prescriptions.')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
    expect(api.pharmacyWorkItems).not.toHaveBeenCalled()
    expect(api.dispense).not.toHaveBeenCalled()
    expect(api.dispensing).not.toHaveBeenCalled()
    expect(api.reverseDispensing).not.toHaveBeenCalled()
    expect(routes.incoming).not.toHaveBeenCalled()
  }

  it('refuses a membership without pharmacy work-item read permission, and reads nothing', () => {
    working([CREATE, 'pharmacy.dispensing.read', 'pharmacy.dispensing.reverse'])
    renderPage()
    expectRefused()
  })

  it.each([
    ['the staff session is not ready', () => { session.ready = false }],
    ['no facility is active', () => { session.facility = undefined }],
  ])('refuses when %s', (_case, arrange) => {
    working(ALL)
    arrange()
    renderPage()
    expectRefused()
  })

  it('refuses a prescription opened by its address too, and reads nothing', () => {
    working([CREATE])
    renderPage(`${PRESCRIPTIONS}/${accepted.id}`)
    expectRefused()
  })
})

describe('the queue', () => {
  it('has one heading, the search, Paper prescription by permission, and opens on what is waiting', async () => {
    working([READ, 'pharmacy.walk-in.create'])
    await renderList()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Prescriptions'])
    expect(screen.getByRole('searchbox', { name: 'Search Pharmacy' }).getAttribute('placeholder')).toBe('Search by drug or patient')
    expect(screen.getByRole('link', { name: 'Paper prescription' }).getAttribute('href')).toBe(`${PRESCRIPTIONS}/paper`)
    const tabs = screen.getByRole('navigation', { name: 'Show prescriptions' })
    expect(within(tabs).getAllByRole('button').map(tab => [tab.textContent, tab.getAttribute('aria-pressed')]))
      .toEqual([['To dispense1', 'true'], ['Dispensed1', 'false'], ['All3', 'false']])
    const list = screen.getByRole('list', { name: 'Prescriptions' })
    expect(within(list).getAllByRole('button').map(card => card.getAttribute('aria-label'))).toEqual([AMOXICILLIN])
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    expect(api.pharmacyWorkItems).toHaveBeenCalledWith(DEMO_PHARMACY_ID)
  })

  it('offers no Paper prescription without pharmacy.walk-in.create', async () => {
    await renderList()
    expect(screen.queryByRole('link', { name: 'Paper prescription' })).toBeNull()
  })

  it('shows each prescription with its medicine, dose and how often with units, masked patient and status in words', async () => {
    await renderList()
    showTab('All')
    const first = row(AMOXICILLIN)
    expect(within(first).getByText('Patient ••••6f8a10')).toBeTruthy()
    expect(within(first).getByText('500 mg · Capsule')).toBeTruthy()
    expect(first.textContent).toContain('1 capsule · Three times daily')
    expect(within(first).getByText('To dispense')).toBeTruthy()
    expect(within(first).getByTitle(`Accepted ${dateText(accepted.acceptedAt)}`)).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('Dispensed')).toBeTruthy()
    expect(within(row(METFORMIN)).getByText('Patient ••••a9b3c4')).toBeTruthy()
    const third = row(SALBUTAMOL)
    expect(within(third).getByText('Reversed')).toBeTruthy()
    expect(within(third).getByText('Dose not recorded')).toBeTruthy()
    expect(within(third).getByText('How often not recorded')).toBeTruthy()
    // Done work is never marked as missing its dose.
    expect(within(third).queryByText('Can’t dispense: dose missing')).toBeNull()
    expect(document.body.textContent).not.toMatch(/From |Synced/)
    expectNoFullPatientIds()
  })

  it('marks work still to dispense whose dose or how often is missing', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [{ ...accepted, frequency: null }] })
    await renderList()
    expect(within(row(AMOXICILLIN)).getByText('Can’t dispense: dose missing')).toBeTruthy()
  })

  it('makes each card one real button named by its medicine and described by the rest', async () => {
    await renderList()
    const open = screen.getByRole('button', { name: AMOXICILLIN })
    expect(open.tagName).toBe('BUTTON')
    expect(open.getAttribute('type')).toBe('button')
    expect(open.getAttribute('tabindex')).toBeNull()
    expect(document.getElementById(open.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Three times daily')
  })

  it('shows a loading state while the list is read, with Refresh busy but focusable', async () => {
    const load = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(load.promise)
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading prescriptions' })).toBeTruthy()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.getAttribute('aria-busy')).toBe('true')
    expect(refresh.hasAttribute('disabled')).toBe(false)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Nothing waiting to dispense')).toBeNull()
    // A second press while it reads does nothing.
    fireEvent.click(refresh)
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
    await act(async () => { load.resolve({ items: [accepted] }) })
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading prescriptions' })).toBeNull()
    expect(refresh.getAttribute('aria-busy')).toBeNull()
  })

  it('says when there are no prescriptions, and finds new ones on Refresh', async () => {
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [accepted] })
    renderPage()
    expect(await screen.findByText('Nothing waiting to dispense')).toBeTruthy()
    expect(screen.getByText('New prescriptions show here as soon as Pharmacy accepts them.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Prescriptions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(2)
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID)
  })

  it('says a refused read in an error box, without any patient data, and recovers on Try again', async () => {
    api.pharmacyWorkItems.mockRejectedValueOnce(new HidApiError(403, 'You do not have permission to do that.', { code: 'PERMISSION_DENIED' }))
      .mockResolvedValueOnce({ items: [accepted] })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Couldn’t load prescriptions')).toBeTruthy()
    expect(within(alert).getByText('You do not have permission to do that.')).toBeTruthy()
    expect(screen.queryByText('Nothing waiting to dispense')).toBeNull()
    expect(document.body.textContent).not.toContain('Patient ••••')
    expectNoFullPatientIds()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each([
    ['a rejection with no message', { status: 0 }, 'Prescriptions could not be loaded. Please retry.'],
    ['Pharmacy switched off on this deployment', new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }),
      'This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.'],
    ['a fault between Health ID services', new HidApiError(503, 'Upstream', { code: 'PHARMACY_SERVICE_AUTH_UNAVAILABLE' }),
      'A connection between Health ID services failed; retry in about 15 seconds.'],
  ])('says %s plainly', async (_case, refusal, text) => {
    api.pharmacyWorkItems.mockRejectedValueOnce(refusal)
    renderPage()
    expect(within(await screen.findByRole('alert')).getByText(text)).toBeTruthy()
  })

  it('keeps the list on screen while it is read again, and when that read fails', async () => {
    const reload = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(reload.promise)
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading prescriptions' })).toBeNull()
    await act(async () => { reload.reject(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' })) })
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Couldn’t refresh prescriptions')).toBeTruthy()
    expect(alert.textContent).toContain('Pharmacy work is temporarily unavailable. What is shown may be out of date.')
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
  })
})

describe('the list cut short at 200', () => {
  const many = (count: number) => Array.from({ length: count }, (_, n) => ({ ...accepted, id: `${String(n).padStart(8, '0')}-w` }))

  it('says newer work can’t be reached here, and that work Pharmacy won’t dispense still counts', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(200) })
    renderPage()
    expect(await screen.findByText(/^This list can show only the 200 oldest accepted work items\./)).toBeTruthy()
    expect(screen.getByText(/^Work whose prescription changed after Pharmacy accepted it can’t be/).textContent?.replace(/\s+/g, ' '))
      .toBe('Work whose prescription changed after Pharmacy accepted it can’t be dispensed, but it stays listed and counts toward these 200.')
  })

  it('says nothing of it for a shorter list', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(199) })
    renderPage()
    await screen.findAllByRole('button', { name: AMOXICILLIN })
    expect(screen.queryByText(/oldest accepted work items/)).toBeNull()
    expect(screen.queryByText(/counts toward these 200/)).toBeNull()
  })

  it('shows 50 records a page', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: many(120) })
    renderPage()
    await screen.findAllByRole('button', { name: AMOXICILLIN })
    const pages = screen.getByRole('navigation', { name: 'Record pages' })
    expect(within(pages).getByText('Page 1 of 3')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: AMOXICILLIN })).toHaveLength(50)
    expect(within(pages).getByRole('button', { name: 'Previous page' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(within(pages).getByText('Page 3 of 3')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: AMOXICILLIN })).toHaveLength(20)
    expect(within(pages).getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(within(pages).getByRole('button', { name: 'Previous page' }))
    expect(within(pages).getByText('Page 2 of 3')).toBeTruthy()
  })
})

describe('the search', () => {
  it('filters what is loaded, sends nothing, and says when nothing matches', async () => {
    await renderList()
    showTab('All')
    const search = screen.getByRole('searchbox', { name: 'Search Pharmacy' })
    fireEvent.change(search, { target: { value: 'metformin twice' } })
    expect(screen.getByRole('button', { name: METFORMIN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
    fireEvent.change(search, { target: { value: 'reversed' } })
    expect(screen.getByRole('button', { name: SALBUTAMOL })).toBeTruthy()
    expect(screen.queryByRole('button', { name: METFORMIN })).toBeNull()
    fireEvent.change(search, { target: { value: 'warfarin' } })
    expect(screen.getByText('No matching prescriptions')).toBeTruthy()
    expect(screen.getByText('Check the spelling, or search by another drug or patient name.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((search as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: AMOXICILLIN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })
})

describe('the picking view', () => {
  it('opens from its card at its own address, focus on its title, and goes back to the list with focus on the card', async () => {
    await renderList()
    const card = screen.getByRole('button', { name: AMOXICILLIN })
    card.focus()
    fireEvent.click(card)
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual([AMOXICILLIN])
    await waitFor(() => expect(document.activeElement?.id).toBe(`pharmacy-${accepted.id}-title`))
    // Only the prescription's id is in the address, never anything about the patient.
    expect(screen.getByTestId('where').textContent).toBe(`${PRESCRIPTIONS}/${accepted.id}`)
    // The list is hidden while the record is open: one view at a time.
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Prescriptions' })).toBeNull()
    // Who it is for, in the same place on every record.
    expect(screen.getByRole('region', { name: 'Patient: Patient ••••6f8a10' }).textContent).toContain('Health ID not sent')
    expect(recordStatus()).toBe('To dispense')
    expect(facts()).toEqual({ Medicine: AMOXICILLIN, Dose: '1capsule', 'How often': 'Three times daily', Route: 'oral',
      Instructions: 'Take with food.\nFinish the course.', Dispensed: 'No', Accepted: dateText(accepted.acceptedAt) })
    // This member can't dispense or reverse: nothing is offered, and the record says why.
    expect(screen.getByText('You can’t dispense here')).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Other actions' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Prescription' })).toBeNull()
    expect(screen.getByTestId('where').textContent).toBe(PRESCRIPTIONS)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: AMOXICILLIN })))
    expect(api.pharmacyWorkItems).toHaveBeenCalledTimes(1)
  })

  it('opens straight from its address, as a shared link or a refresh would', async () => {
    renderPage(`${PRESCRIPTIONS}/${accepted.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: AMOXICILLIN })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe(PRESCRIPTIONS)
  })

  it('says what is missing on a record with no dose, frequency or route', async () => {
    await renderList()
    showTab('All')
    fireEvent.click(screen.getByRole('button', { name: SALBUTAMOL }))
    expect(facts()).toMatchObject({ Medicine: SALBUTAMOL, Dose: 'Not recorded', 'How often': 'Not recorded', Route: 'Not recorded', Dispensed: 'Reversed' })
    expect(facts()).not.toHaveProperty('Instructions')
    expect(recordStatus()).toBe('Reversed')
    expect(screen.getByText('This dispensing was reversed. A new prescription is needed to dispense it again.')).toBeTruthy()
  })

  it('offers Dispense on accepted work and Reverse dispensing on a dispensing still in effect, by permission', async () => {
    working(ALL)
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(within(pickCard()).getByRole('button', { name: 'Dispense' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Other actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    showTab('All')
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(within(otherActions()).getAllByRole('button').map(button => button.textContent)).toEqual(['Reverse dispensing'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    fireEvent.click(screen.getByRole('button', { name: SALBUTAMOL }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Other actions' })).toBeNull()
    expectNoFullPatientIds()
  })

  it('goes back to the list, focus on its heading, when its address names work the list doesn’t hold', async () => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [dispensed] })
    renderPage(`${PRESCRIPTIONS}/${accepted.id}`)
    await screen.findByText('Nothing waiting to dispense')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(PRESCRIPTIONS))
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    await waitFor(() => expect(document.activeElement?.id).toBe('pharmacy-heading'))
  })
})

describe('payment first', () => {
  const settings = { wherePaid: 'cashier', methods: ['cash'], payBefore: { pharmacy: true, lab: false }, allowDeferredFor: [], hmos: [],
    dayCloseBy: 'facility', tills: [], version: 1 }
  const owed = { ...accepted, bill: { billId: 'bill-1', status: 'unpaid', dueKobo: 250_000, receiptNumber: null } } as PharmacyWorkItem
  const paid = { id: 'bill-1', number: 'B-0001', status: 'paid', dueKobo: 0, receiptNumber: 'R-0001' }

  it('waits for payment where it comes first: no Dispense until the bill is paid, then the picking view', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValue({ items: [owed] })
    commerceApi.paymentSettings = vi.fn(async () => ({ ok: true, data: settings }))
    const bill = vi.fn(async () => ({ ok: false, notAvailable: true }))
    commerceApi.bill = bill
    await renderList()
    expect(within(row(AMOXICILLIN)).getByText(/Unpaid/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(await screen.findByRole('heading', { name: 'Payment first' })).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Dispense' })).toBeNull()
    expect(screen.getByText('Ask the patient to pay at the cashier with this bill number. Then check again.')).toBeTruthy()
    bill.mockResolvedValueOnce({ ok: true, data: paid } as never)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByRole('form', { name: 'Dispense' })).toBeTruthy()
    expect(screen.getByText('Paid, receipt R-0001. You can go on.')).toBeTruthy()
    expect(bill).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID, 'bill-1')
    expect(api.dispense).not.toHaveBeenCalled()
  })

  it('gates nothing where payments aren’t set up (404)', async () => {
    working(ALL)
    api.pharmacyWorkItems.mockResolvedValue({ items: [owed] })
    await renderList()
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    expect(screen.getByRole('form', { name: 'Dispense' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Payment first' })).toBeNull()
  })
})

describe('the working facility', () => {
  it('drops the previous facility’s work, its open record, and reads the new one', async () => {
    const second = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [accepted] }).mockReturnValueOnce(second.promise)
    const view = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: AMOXICILLIN }))
    working([READ], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', membershipId: 'membership-demo-2' })
    view.rerender(<MemoryRouter><div className="hid-ehr"><Pharmacy /><Where /></div></MemoryRouter>)
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Loading prescriptions' })).toBeTruthy()
    expect(api.pharmacyWorkItems).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID)
    await act(async () => { second.resolve({ items: [otherFacilityItem] }) })
    expect(await screen.findByRole('button', { name: IBUPROFEN })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AMOXICILLIN })).toBeNull()
  })

  it('ignores a late answer for the previous facility', async () => {
    const first = deferred<{ items: PharmacyWorkItem[] }>()
    api.pharmacyWorkItems.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ items: [otherFacilityItem] })
    const view = renderPage()
    working([READ], { id: DEMO_HOSPITAL_ID, name: 'Demo Hospital', membershipId: 'membership-demo-2' })
    view.rerender(<MemoryRouter><div className="hid-ehr"><Pharmacy /><Where /></div></MemoryRouter>)
    await screen.findByRole('button', { name: IBUPROFEN })
    await act(async () => { first.resolve({ items: [accepted, dispensed] }) })
    expect(screen.queryByText(AMOXICILLIN)).toBeNull()
    expect(screen.queryByText(METFORMIN)).toBeNull()
    expect(document.body.textContent).not.toContain('••••6f8a10')
  })
})
