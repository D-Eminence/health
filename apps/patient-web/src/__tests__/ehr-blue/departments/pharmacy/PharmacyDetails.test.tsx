import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PharmacyWorkItem } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { drugOf } from '../../../../ehr-blue/departments/pharmacy/drugForm'
import { durationText, prescribedQuantity, queueOrder } from '../../../../ehr-blue/departments/pharmacy/pharmacyText'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, AMOXICILLIN, confirmPatient, CREATE, dispensed, facts, fillDispensing, PATIENT, pickCard, PRESCRIPTIONS, pressDispense, READ,
  row, showTab, tick, Where,
} from './fixtures'

/**
 * The prescription details Pharmacy will send (proposed hid-system 0106 and 0107; none is served today): the patient on
 * this facility's own work, the priority, the strength and form the prescriber chose, how long it is for and how much to
 * hand over. Each is used when present; with none, every screen is as it is today (PharmacyDispensing.test.tsx and
 * Pharmacy.test.tsx hold today's screens). No request changes: the dispensing sends the quantity and unit the pharmacist
 * confirms, as before.
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

const REASON = 'Full course dispensed at counter'

const item = (id: string, display: string, acceptedAt: string, overrides: Partial<PharmacyWorkItem> = {}): PharmacyWorkItem => ({
  ...accepted, id, medication: { display }, acceptedAt, ...overrides,
})

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  session.facility = fakeFacility([READ, CREATE], { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
  api.dispense.mockResolvedValue({ id: 'dispensing-new' })
})
afterEach(() => { expect([...strays]).toEqual([]) })

async function renderQueue(items: PharmacyWorkItem[]) {
  api.pharmacyWorkItems.mockResolvedValue({ items })
  renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
  await screen.findByRole('list', { name: 'Prescriptions' })
}

async function openRecord(items: PharmacyWorkItem[], name: string) {
  await renderQueue(items)
  showTab('All')
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('heading', { name: 'Pick and hand over' })
}

const cardNames = () => within(screen.getByRole('list', { name: 'Prescriptions' })).getAllByRole('listitem')
  .map(card => within(card).getAllByRole('button')[0]!.getAttribute('aria-label'))

describe('with today\'s backend (none of the new fields)', () => {
  it('keeps first come, first served, marks no priority, and starts the dispensing form as before', async () => {
    const later = item('w-later', 'Paracetamol 500 mg tablet', '2026-10-08T10:00:00.000Z')
    await renderQueue([later, accepted])
    expect(cardNames()).toEqual([AMOXICILLIN, 'Paracetamol 500 mg tablet'])
    for (const card of within(screen.getByRole('list', { name: 'Prescriptions' })).getAllByRole('listitem')) {
      expect(card.textContent).not.toMatch(/Urgent|Stat|ASAP|Routine| for \d/)
    }
    fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN }))
    await screen.findByRole('heading', { name: 'Pick and hand over' })
    expect(Object.keys(facts())).toEqual(['Medicine', 'Dose', 'How often', 'Route', 'Instructions', 'Dispensed', 'Accepted'])
    const form = screen.getByRole('form', { name: 'Dispense' })
    expect((within(form).getByRole('spinbutton', { name: 'Quantity to hand over' }) as HTMLInputElement).value).toBe('')
    expect((within(form).getByRole('textbox', { name: 'Unit' }) as HTMLInputElement).value).toBe('capsule')
    // The patient is not named on this facility's own work, so there is no one to check against.
    expect(form.textContent).not.toMatch(/Check that the person/)
  })
})

describe('priority', () => {
  it('puts stat, then as soon as possible, then urgent first among what can be dispensed, and marks each', async () => {
    await renderQueue([
      item('w-routine', 'Routine medicine', '2026-10-08T07:00:00.000Z', { priority: 'routine' }),
      item('w-none', 'Unset medicine', '2026-10-08T07:30:00.000Z'),
      item('w-urgent', 'Urgent medicine', '2026-10-08T09:00:00.000Z', { priority: 'urgent' }),
      item('w-asap', 'Asap medicine', '2026-10-08T09:30:00.000Z', { priority: 'asap' }),
      item('w-stat', 'Stat medicine', '2026-10-08T10:00:00.000Z', { priority: 'stat' }),
    ])
    // Routine and unset keep first come, first served after the urgent ones.
    expect(cardNames()).toEqual(['Stat medicine', 'Asap medicine', 'Urgent medicine', 'Routine medicine', 'Unset medicine'])
    expect(within(row('Stat medicine')).getByText('Stat')).toBeTruthy()
    expect(within(row('Asap medicine')).getByText('ASAP')).toBeTruthy()
    expect(within(row('Urgent medicine')).getByText('Urgent')).toBeTruthy()
    // Routine is the usual case: no badge.
    expect(within(row('Routine medicine')).queryByText('Routine')).toBeNull()
  })

  it('reads a priority it does not know as routine', () => {
    const odd = item('w-odd', 'Odd medicine', '2026-10-08T07:00:00.000Z', { priority: 'constructor' })
    const urgent = item('w-urgent', 'Urgent medicine', '2026-10-08T09:00:00.000Z', { priority: 'URGENT' })
    const later = item('w-later', 'Later medicine', '2026-10-08T10:00:00.000Z')
    expect(queueOrder([later, odd, urgent], () => false).map(entry => entry.id)).toEqual(['w-urgent', 'w-odd', 'w-later'])
  })

  it('never puts an urgent prescription already dispensed ahead of work still to do', () => {
    const done = { ...dispensed, priority: 'stat' }
    const waiting = item('w-waiting', 'Waiting medicine', '2026-10-09T10:00:00.000Z')
    expect(queueOrder([done, waiting], () => false).map(entry => entry.id)).toEqual(['w-waiting', dispensed.id])
  })

  it('says the priority on the record, and finds it by search', async () => {
    await openRecord([item('w-urgent', 'Urgent medicine', '2026-10-08T09:00:00.000Z', { priority: 'urgent' })], 'Urgent medicine')
    expect(facts().Priority).toBe('Urgent')
    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    const search = await screen.findByRole('searchbox', { name: 'Search Pharmacy' })
    fireEvent.change(search, { target: { value: 'urgent' } })
    expect(cardNames()).toEqual(['Urgent medicine'])
  })
})

describe('strength and form', () => {
  it('prefers the strength and form the prescriber chose over the ones worked out from the name', async () => {
    await renderQueue([item('w-amox', 'Amoxicillin', '2026-10-08T09:00:00.000Z', { medication: { display: 'Amoxicillin', strength: '500 mg', doseForm: 'capsule' } }),
      item('w-para', 'Paracetamol', '2026-10-08T09:10:00.000Z', { medication: { display: 'Paracetamol', strength: '120 mg/5 ml', doseForm: 'liquid' }, doseUnit: 'tablet' })])
    expect(within(row('Amoxicillin')).getByText('500 mg · Capsule')).toBeTruthy()
    // "Liquid" from the prescriber, though the dose unit says tablet.
    expect(within(row('Paracetamol')).getByText('120 mg/5 ml · Liquid')).toBeTruthy()
  })

  it('works them out from the name, as today, when the prescriber chose none or a form not on the list', () => {
    expect(drugOf({ medication: { display: 'Salbutamol 100 mcg inhaler' }, doseUnit: 'puffs', routeCode: 'inhaled' }))
      .toEqual({ form: 'inhaler', name: 'Salbutamol inhaler', strength: '100 mcg' })
    expect(drugOf({ medication: { display: 'Metformin 500 mg tablets', strength: null, doseForm: 'suppository' }, doseUnit: null, routeCode: 'oral' }))
      .toEqual({ form: 'tablet', name: 'Metformin tablets', strength: '500 mg' })
    expect(drugOf({ medication: { display: 'Metformin 500 mg tablets', doseForm: 'constructor' }, doseUnit: null, routeCode: 'oral' }).form).toBe('tablet')
  })

  it('never hides a strength written in the name that differs from the prescriber\'s', () => {
    expect(drugOf({ medication: { display: 'Amoxicillin 250 mg capsules', strength: '500 mg' }, doseUnit: 'capsule', routeCode: 'oral' }))
      .toEqual({ form: 'capsule', name: 'Amoxicillin 250 mg capsules', strength: '500 mg' })
    expect(drugOf({ medication: { display: 'Amoxicillin 500mg capsules', strength: '500 MG' }, doseUnit: 'capsule', routeCode: 'oral' }))
      .toEqual({ form: 'capsule', name: 'Amoxicillin capsules', strength: '500 MG' })
  })
})

describe('how long, and how much to hand over', () => {
  const amoxicillin = item('w-amox', AMOXICILLIN, '2026-10-08T09:00:00.000Z', {
    duration: { value: 7, unit: 'day' }, quantityToDispense: 21, quantityUnit: 'capsules',
  })

  it('says how long the medicine is for on its card and its record', async () => {
    await openRecord([amoxicillin], AMOXICILLIN)
    expect(facts()['How long']).toBe('7 days')
    // The number and its unit, set apart by the layout as the dose is ("1capsule" in text).
    expect(facts()['Quantity to give']).toBe('21capsules')
    fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
    await screen.findByRole('list', { name: 'Prescriptions' })
    expect(row(AMOXICILLIN).textContent).toContain('Three times daily · for 7 days')
  })

  it('starts the dispensing form with the prescribed quantity, which the pharmacist confirms and may change', async () => {
    await openRecord([amoxicillin], AMOXICILLIN)
    const form = screen.getByRole('form', { name: 'Dispense' })
    const quantity = within(form).getByRole('spinbutton', { name: 'Quantity to hand over' }) as HTMLInputElement
    expect(quantity.value).toBe('21')
    expect((within(form).getByRole('textbox', { name: 'Unit' }) as HTMLInputElement).value).toBe('capsules')
    expect(document.getElementById(`pharmacy-quantity-${amoxicillin.id}-hint`)?.textContent)
      .toBe('Filled in from the prescription. Check it before you hand it over. The whole amount: part of a dispensing can’t be recorded.')
    // The pharmacist hands over less: what they enter is sent, in today's request.
    tick()
    fillDispensing({ quantity: '14', reason: REASON })
    pressDispense()
    await confirmPatient('Dispense')
    await waitFor(() => expect(api.dispense).toHaveBeenCalledTimes(1))
    expect(api.dispense).toHaveBeenCalledWith(DEMO_PHARMACY_ID, amoxicillin, 14, 'capsules', REASON)
  })

  it('leaves out what can\'t be said plainly', () => {
    expect(durationText({ duration: { value: 1, unit: 'week' } })).toBe('1 week')
    expect(durationText({ duration: { value: 3, unit: 'Month' } })).toBe('3 months')
    expect(durationText({ duration: { value: 7, unit: 'fortnight' } })).toBeNull()
    expect(durationText({ duration: { value: 7, unit: 'constructor' } })).toBeNull()
    expect(durationText({ duration: { value: 0, unit: 'day' } })).toBeNull()
    expect(durationText({ duration: { value: 2.5, unit: 'day' } })).toBeNull()
    expect(durationText({ duration: null })).toBeNull()
    expect(durationText({})).toBeNull()
    expect(prescribedQuantity({ quantityToDispense: 0, quantityUnit: 'tablets' })).toBeNull()
    expect(prescribedQuantity({ quantityToDispense: -2, quantityUnit: 'tablets' })).toBeNull()
    expect(prescribedQuantity({ quantityToDispense: 10, quantityUnit: ' ' })).toEqual({ quantity: 10, unit: null })
    expect(prescribedQuantity({})).toBeNull()
  })
})

describe('the patient on this facility\'s own work', () => {
  it('names the patient on the card and the record, and asks to check them before handing over', async () => {
    await renderQueue([{ ...accepted, patient: PATIENT }])
    expect(within(row(AMOXICILLIN)).getByText('Patient One')).toBeTruthy()
    expect(within(row(AMOXICILLIN)).getByText('Born 1 Jan 1990')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: AMOXICILLIN })) })
    await screen.findByRole('heading', { name: 'Pick and hand over' })
    expect(screen.getAllByText('Health ID ending AAA2').length).toBeGreaterThan(0)
    expect(within(pickCard()).getByText('Check that the person is Patient One, or is collecting for them, before you hand anything over.')).toBeTruthy()
  })
})
