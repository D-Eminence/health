import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { PharmacyImport } from '../../../../staff/api'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import { accepted, AMOXICILLIN, CREATE, PATIENT_A, pickCard, PRESCRIPTIONS, READ, showTab, Where } from './fixtures'

/**
 * A prescription shows the medicines read from the patient's paper records ("Imported from paper (unverified)") before
 * it is dispensed, read only for a role holding pharmacy.import.read. All data is fictional.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), pharmacyImports: vi.fn() }))
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

const IMPORTS = 'pharmacy.import.read'
const CONSENT = 'The patient has not given consent for this facility to read their record.'

const medicine = (overrides: Partial<PharmacyImport> = {}): PharmacyImport => ({
  id: 'medicine-1', patientId: PATIENT_A, medicationText: 'Metformin', strengthText: '500 mg', doseText: '1 tablet',
  frequencyText: 'Twice daily', historicalContext: 'From a paper record, page 2.', ...overrides,
})

function working(permissions: string[]) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
}

async function openRecord() {
  renderDept(<><Pharmacy /><Where /></>, { route: PRESCRIPTIONS })
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prescriptions' })).toBeNull())
  showTab('All')
  fireEvent.click(await screen.findByRole('button', { name: AMOXICILLIN }))
  await screen.findByRole('heading', { name: 'Pick and hand over' })
}

const imported = () => screen.getByRole('region', { name: /Imported from paper \(unverified\)/ })

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  api.pharmacyWorkItems.mockResolvedValue({ items: [accepted] })
})
afterEach(() => { expect([...strays]).toEqual([]) })

describe('Pharmacy: imported from paper', () => {
  it('lists the patient’s medicines imported from paper, before the picking view', async () => {
    working([READ, CREATE, IMPORTS])
    api.pharmacyImports.mockResolvedValue({ items: [medicine()], nextCursor: null })
    await openRecord()
    expect(await within(imported()).findByText('Metformin')).toBeTruthy()
    expect(within(imported()).getByText('Strength: 500 mg · Dose: 1 tablet · How often: Twice daily')).toBeTruthy()
    expect(api.pharmacyImports).toHaveBeenCalledWith(DEMO_PHARMACY_ID, PATIENT_A, undefined, expect.any(AbortSignal))
    // Shown before Dispense, in reading order.
    expect(imported().compareDocumentPosition(pickCard()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says the patient has not given consent on 403 CONSENT_REQUIRED', async () => {
    working([READ, CREATE, IMPORTS])
    api.pharmacyImports.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    await openRecord()
    expect(await within(imported()).findByText(CONSENT)).toBeTruthy()
    // Dispensing is still offered.
    expect(within(pickCard()).getByRole('button', { name: 'Dispense' })).toBeTruthy()
  })

  it('is not shown, and nothing is read, without pharmacy.import.read', async () => {
    working([READ, CREATE])
    await openRecord()
    expect(screen.queryByRole('heading', { name: 'Imported from paper (unverified)' })).toBeNull()
    expect(api.pharmacyImports).not.toHaveBeenCalled()
  })

  it('reads the next page with the cursor on Show more', async () => {
    working([READ, CREATE, IMPORTS])
    api.pharmacyImports.mockResolvedValueOnce({ items: [medicine()], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [medicine({ id: 'medicine-2', medicationText: 'Lisinopril' })], nextCursor: null })
    await openRecord()
    fireEvent.click(await within(imported()).findByRole('button', { name: 'Show more' }))
    expect(await within(imported()).findByText('Lisinopril')).toBeTruthy()
    expect(api.pharmacyImports).toHaveBeenLastCalledWith(DEMO_PHARMACY_ID, PATIENT_A, 'cursor-1', expect.any(AbortSignal))
    expect(within(imported()).getByText('Metformin')).toBeTruthy()
  })
})
