import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { LabImport, LabWorkItem } from '../../../../staff/api'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * A lab request shows the patient's lab results imported from paper ("Lab results imported from paper (unverified)"), read only
 * for a role holding lab.import.read. All data is fictional.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), labAccession: vi.fn(), labExecutions: vi.fn(), labImports: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn() }))
const unprovided = vi.hoisted(() => new Set<string>())
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))

const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => {
  const watched = <T extends object>(target: T) => new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string' && !(property in object)) unprovided.add(property)
      return Reflect.get(object, property)
    },
  })
  return { staffApi: watched(api), orderRoutesApi: watched(routes) }
})

const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const WORK = ['lab.work-item.read']
const IMPORTS = [...WORK, 'lab.import.read']
const CONSENT = 'The patient has not given consent for this facility to read their record.'

const workItem: LabWorkItem = {
  id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z',
}
const labImport = (overrides: Partial<LabImport> = {}): LabImport => ({
  id: 'lab-import-1', patientId: PATIENT, status: 'accepted', externalLabName: 'Demo Diagnostics', reportedAt: '2024-02-14',
  observations: [{ id: 'obs-1', ordinal: 1, testName: 'Haemoglobin', value: '11.2', unit: 'g/dL' }], ...overrides,
})

function as(permissions: string[]) {
  session.facility = fakeFacility(permissions)
}

async function openRequest() {
  renderDept(<Laboratory />, { route: '/provider/laboratory/work/work-item-1' })
  await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })
}

const imported = () => screen.getByRole('region', { name: 'Lab results imported from paper (unverified)' })

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.clearAllMocks()
  unprovided.clear()
  api.labWorkItems.mockResolvedValue({ items: [workItem] })
  api.labExecutions.mockResolvedValue({ items: [] })
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  expect([...unprovided]).toEqual([])
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('Laboratory: imported from paper', () => {
  it('lists the patient’s lab results imported from paper on the request', async () => {
    as(IMPORTS)
    api.labImports.mockResolvedValue({ items: [labImport()], nextCursor: null })
    await openRequest()
    expect(await within(imported()).findByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(within(imported()).getByText('Haemoglobin: 11.2 g/dL')).toBeTruthy()
    expect(api.labImports).toHaveBeenCalledWith(DEMO_LABORATORY_ID, PATIENT, undefined, expect.any(AbortSignal))
  })

  it('says the patient has not given consent on 403 CONSENT_REQUIRED', async () => {
    as(IMPORTS)
    api.labImports.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    await openRequest()
    expect(await within(imported()).findByText(CONSENT)).toBeTruthy()
  })

  it('is not shown, and nothing is read, without lab.import.read', async () => {
    as(WORK)
    await openRequest()
    expect(screen.queryByRole('heading', { name: 'Lab results imported from paper (unverified)' })).toBeNull()
    expect(api.labImports).not.toHaveBeenCalled()
  })

  it('reads the next page with the cursor on Show more', async () => {
    as(IMPORTS)
    api.labImports.mockResolvedValueOnce({ items: [labImport()], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [labImport({ id: 'lab-import-2', reportedAt: '2023-05-01' })], nextCursor: null })
    await openRequest()
    fireEvent.click(await within(imported()).findByRole('button', { name: 'Show more' }))
    expect(await within(imported()).findByText('Report date: 1 May 2023')).toBeTruthy()
    await waitFor(() => expect(api.labImports).toHaveBeenLastCalledWith(DEMO_LABORATORY_ID, PATIENT, 'cursor-1', expect.any(AbortSignal)))
    expect(within(imported()).queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})
