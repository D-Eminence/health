import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { drugOf } from '../../../../ehr-blue/departments/pharmacy/drugForm'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { waitingText } from '../../../../ehr-blue/departments/pharmacy/PharmacyQueue'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { accepted, AMOXICILLIN, dispensed, PRESCRIPTIONS, READ, reversed, row, Where } from './fixtures'

/**
 * Pharmacy launch readiness: what the pharmacist picks from is never misread, and the queue says only what it knows, in
 * plain words. Kept apart from Pharmacy.test.tsx and PharmacyDetails.test.tsx, which other open work changes; the
 * harness is Pharmacy.test.tsx's. Every medicine, person and facility here is fictional.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
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
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: routes,
}))

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  session.facility = fakeFacility([READ], { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
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
function renderPage() {
  return renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
}

async function renderList() {
  renderPage()
  await screen.findByRole('button', { name: AMOXICILLIN })
}

/** The queue's tabs as they read, each label with its count when it has one. */
function tabTexts() {
  return within(screen.getByRole('navigation', { name: 'Show prescriptions' })).getAllByRole('button').map(button => button.textContent)
}

describe('a medicine with more than one strength', () => {
  it('is never split, so each strength stays beside the part it belongs to', () => {
    for (const display of ['Amoxicillin/Clavulanic acid 875 mg/125 mg film-coated tablets', 'Co-trimoxazole 800 mg/160 mg tablets',
      'Lisinopril 10 mg and hydrochlorothiazide 12.5 mg tablets', 'Ferrous sulphate 200 mg + folic acid 0.4 mg tablets'])
      expect(drugOf({ medication: { display }, doseUnit: 'tablet', routeCode: 'oral' })).toMatchObject({ name: display, strength: null })
    // One strength, with or without a volume, is still split as before.
    expect(drugOf({ medication: { display: 'Paracetamol 120 mg/5 ml syrup' }, doseUnit: 'ml', routeCode: 'oral' }))
      .toMatchObject({ name: 'Paracetamol syrup', strength: '120 mg/5 ml' })
    expect(drugOf({ medication: { display: 'Artemether/Lumefantrine 80/480 mg' }, doseUnit: 'tablet', routeCode: 'oral' }))
      .toMatchObject({ name: 'Artemether/Lumefantrine', strength: '80/480 mg' })
    // A name that is only a strength stays whole, so the card never shows an empty name.
    expect(drugOf({ medication: { display: '500 mg' }, doseUnit: 'tablet', routeCode: 'oral' })).toMatchObject({ name: '500 mg', strength: null })
  })
})

describe('the queue before it is read', () => {
  it('shows no count on its tabs while the list loads or when it could not be read, never “To dispense 0”', async () => {
    api.pharmacyWorkItems.mockRejectedValue(new HidApiError(503, 'Pharmacy work is temporarily unavailable.', { code: 'PHARMACY_SERVICE_UNAVAILABLE' }))
    renderPage()
    expect(tabTexts()).toEqual(['To dispense', 'Dispensed', 'All'])
    await screen.findByRole('button', { name: 'Try again' })
    expect(tabTexts()).toEqual(['To dispense', 'Dispensed', 'All'])
  })

  it('counts once the list is read', async () => {
    await renderList()
    expect(tabTexts()).toEqual(['To dispense1', 'Dispensed1', 'All3'])
  })
})

describe('how long a prescription has waited', () => {
  it('says it as a sentence on the card: “Waiting since 8 Oct”, never “Waiting 8 Oct” or “Waiting yesterday”', async () => {
    await renderList()
    expect(within(row(AMOXICILLIN)).getByText(/^Waiting since \d{1,2} [A-Z][a-z]{2}/)).toBeTruthy()
    const now = Date.parse('2026-11-03T12:00:00Z')
    expect(waitingText('2026-11-03T11:59:40Z', now)).toBe('Just accepted')
    expect(waitingText('2026-11-03T11:35:00Z', now)).toBe('Waiting 25 min')
    expect(waitingText('2026-11-03T09:00:00Z', now)).toBe('Waiting 3 h')
    // A wait of one or two days is said in days, never as "since yesterday": 47 hours back is the day before yesterday.
    expect(waitingText('2026-11-02T06:00:00Z', now)).toBe('Waiting 1 day')
    expect(waitingText('2026-11-01T13:00:00Z', now)).toBe('Waiting 2 days')
    expect(waitingText('2026-10-31T12:00:00Z', now)).toBe('Waiting 3 days')
    // Noon UTC is 8 or 9 Oct wherever the test runs.
    expect(waitingText('2026-10-08T12:00:00Z', now)).toMatch(/^Waiting since [89] Oct$/)
  })
})
