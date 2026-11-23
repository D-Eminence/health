import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type * as StaffApi from '../../../staff/api'
import { staffApi, type PharmacyWorkItem } from '../../../staff/api'
import { BlueHome } from '../../../ehr-blue/home/BlueHome'
import { TodayCard } from '../../../ehr-blue/home/liveCards'
import { AttentionProvider } from '../../../ehr-blue/frame/attention'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'
import { DEMO_HOSPITAL, facility } from './blueHarness'

/**
 * Home's pharmacy work leaves out an item the prescribing team withdrew before it was dispensed (hid-system 0133,
 * pharmacy-api at 06f98040: `withdrawn: true` with `withdrawnReason`): it can never be dispensed, so it is not "to
 * dispense", in the Today rows or in the count. Every account, facility, patient and medicine here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, staffApi: { ...actual.staffApi, listAccessRequests: vi.fn(), labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() } }
})
const staff = vi.hoisted(() => ({ facility: undefined as unknown }))
vi.mock('../../../staff/App', async importOriginal => ({
  ...await importOriginal<object>(),
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-demo-1', displayName: 'Demo Pharmacist', roles: [], permissions: [],
      facility: staff.facility, facilities: [staff.facility] }, expiresAt: '2026-11-30T12:00:00.000Z' } },
    activePatient: null, lock: null,
  }),
}))
afterEach(() => { vi.clearAllMocks() })

const item = (id: string, display: string, extra: Partial<PharmacyWorkItem> = {}) => ({
  id, patientId: `p-0000${id}`, version: 1, acceptedAt: '2026-11-23T09:00:00Z', medication: { display }, ...extra,
}) as unknown as PharmacyWorkItem
const WORK = [
  item('aa01', 'Amoxicillin 500 mg capsule'),
  item('aa02', 'Paracetamol 1 g tablet', { withdrawn: true, withdrawnReason: 'changed' }),
  item('aa03', 'Metformin 500 mg tablet', { withdrawn: true }),
]

describe('Home leaves out pharmacy work withdrawn by the prescribing team (0133)', () => {
  it('Today lists the work still to dispense, and no withdrawn item', async () => {
    vi.mocked(staffApi.pharmacyWorkItems).mockResolvedValue({ items: WORK })
    render(<MemoryRouter><TodayCard facilityId={DEMO_HOSPITAL} lab={false} pharmacy /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Amoxicillin 500 mg capsule' })).toBeDefined()
    expect(screen.getAllByText('Pharmacy · to dispense')).toHaveLength(1)
    expect(screen.queryByText('Paracetamol 1 g tablet')).toBeNull()
    expect(screen.queryByText('Metformin 500 mg tablet')).toBeNull()
  })

  it('the demo hospital’s Home counts and lists only the work still to dispense', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([] as never)
    vi.mocked(staffApi.pharmacyWorkItems).mockResolvedValue({ items: WORK })
    const here = facility(DEMO_HOSPITAL, 'Demo Hospital', ['pharmacy.work-item.read'])
    staff.facility = here
    render(<MemoryRouter><RoleViewProvider><AttentionProvider facilityId={here.id} permissions={here.permissions}>
      <BlueHome />
    </AttentionProvider></RoleViewProvider></MemoryRouter>)
    const count = (await screen.findByText('To dispense')).closest('a')!
    expect(await within(count).findByText('1')).toBeDefined()
    expect(screen.getByText('Amoxicillin 500 mg capsule')).toBeDefined()
    expect(screen.getAllByText('Pharmacy · to dispense')).toHaveLength(1)
    expect(screen.queryByText('Paracetamol 1 g tablet')).toBeNull()
    expect(screen.queryByText('Metformin 500 mg tablet')).toBeNull()
  })
})
