import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { staffApi } from '../../../staff/api'
import type * as StaffApi from '../../../staff/api'
import { AttentionProvider } from '../../../ehr-blue/frame/attention'
import { AccessRequestsCard, LabWorkCard, PharmacyWorkCard } from '../../../ehr-blue/home/liveCards'
import { RoleDashboard } from '../../../ehr-blue/home/RoleDashboard'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'

/** Home's live cards with the staff API mocked: loading, empty, error and refusal states, in today's words. */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  return { ...actual, staffApi: { ...actual.staffApi, listAccessRequests: vi.fn(), labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn() } }
})
afterEach(() => { vi.clearAllMocks() })

const FACILITY_ID = '98d00002-0000-4000-8000-000000000001'
const pending = <T,>() => new Promise<T>(() => {})
const refused = (code: string, detail: string, status = 403) => new HidApiError(status, detail, { code })

function inRouter(children: ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>)
}

describe('Access requests card', () => {
  it('shows nothing, and reads nothing, without the permission to answer requests', () => {
    inRouter(<AttentionProvider facilityId={FACILITY_ID} permissions={[]}><AccessRequestsCard /></AttentionProvider>)
    expect(screen.queryByRole('heading', { name: 'Access requests' })).toBeNull()
    expect(staffApi.listAccessRequests).not.toHaveBeenCalled()
  })

  it('says it is loading, then counts the pending requests', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([
      { accessRequestId: 'a', status: 'pending' }, { accessRequestId: 'b', status: 'approved' },
    ] as Awaited<ReturnType<typeof staffApi.listAccessRequests>>)
    inRouter(<AttentionProvider facilityId={FACILITY_ID} permissions={['identity.consent.write']}><AccessRequestsCard /></AttentionProvider>)
    expect(screen.getByRole('status').textContent).toBe('Loading access requests')
    expect(await screen.findByText('1 pending request')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Review requests →' }).getAttribute('href')).toBe('/provider/requests')
  })

  it('says a refusal in today\'s words', async () => {
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(refused('PERMISSION_DENIED', 'Denied'))
    inRouter(<AttentionProvider facilityId={FACILITY_ID} permissions={['identity.consent.write']}><AccessRequestsCard /></AttentionProvider>)
    expect(await screen.findByText('Your role at this facility cannot list access requests. Ask an administrator to review your assignment.')).toBeDefined()
  })
})

describe('Laboratory and pharmacy work cards', () => {
  it('say they are loading', () => {
    vi.mocked(staffApi.labWorkItems).mockReturnValue(pending())
    inRouter(<LabWorkCard facilityId={FACILITY_ID} />)
    expect(screen.getByRole('status').textContent).toBe('Loading laboratory work')
  })

  it('say when there is no work', async () => {
    vi.mocked(staffApi.labWorkItems).mockResolvedValue({ items: [] })
    vi.mocked(staffApi.pharmacyWorkItems).mockResolvedValue({ items: [] })
    inRouter(<><LabWorkCard facilityId={FACILITY_ID} /><PharmacyWorkCard facilityId={FACILITY_ID} /></>)
    expect(await screen.findByText('No accepted lab work')).toBeDefined()
    expect(await screen.findByText('No accepted prescriptions')).toBeDefined()
  })

  it('list work with the patient masked until an accepted order names them', async () => {
    vi.mocked(staffApi.labWorkItems).mockResolvedValue({ items: [
      { id: 'w1', patientId: 'p-000000abc123', version: 1, status: 'in_progress', testName: 'Full blood count' },
    ] })
    inRouter(<LabWorkCard facilityId={FACILITY_ID} />)
    const item = (await screen.findByText('Full blood count')).closest('li')!
    expect(within(item).getByText('Patient ••••abc123 · in progress')).toBeDefined()
  })

  it('say a failure in today\'s words', async () => {
    vi.mocked(staffApi.pharmacyWorkItems).mockRejectedValue(refused('PERMISSION_DENIED', 'This membership cannot read pharmacy work.'))
    inRouter(<PharmacyWorkCard facilityId={FACILITY_ID} />)
    expect(await screen.findByText('Pharmacy work could not be loaded')).toBeDefined()
    expect(screen.getByText('This membership cannot read pharmacy work.')).toBeDefined()
  })
})

describe('A role\'s sample dashboard', () => {
  it('shows the design\'s dashboard for the role, as a sample, from the in-memory records', () => {
    inRouter(<RoleViewProvider><RoleDashboard role="Lab Scientist" /></RoleViewProvider>)
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Demo Lab Scientist' })).toBeDefined()
    expect(screen.getByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Activity in period' })).toBeDefined()
    expect(screen.getByText('Laboratory created')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Back to my dashboard' })).toBeDefined()
  })
})
