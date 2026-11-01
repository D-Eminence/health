import { useEffect, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { staffApi } from '../../../staff/api'
import type * as StaffApi from '../../../staff/api'
import { AttentionProvider, useReloadAccessRequests } from '../../../ehr-blue/frame/attention'
import { AttentionLines, TodayCard } from '../../../ehr-blue/home/liveCards'
import { RoleDashboard } from '../../../ehr-blue/home/RoleDashboard'
import { RoleViewProvider } from '../../../ehr-blue/frame/roleView'
import { SAID_REFUSED } from '../../said'

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

/** Asks for the read on mounting, as Home does when it opens. */
function AsHomeDoes() {
  const reload = useReloadAccessRequests()
  useEffect(() => { reload() }, [reload])
  return null
}

const Attention = ({ permissions }: { readonly permissions: readonly string[] }) => (
  <AttentionProvider facilityId={FACILITY_ID} permissions={permissions}><AsHomeDoes /><ul><AttentionLines activePatient={null} /></ul></AttentionProvider>
)

describe('Needs attention: access requests', () => {
  it('shows nothing, and reads nothing, without the permission to answer requests', () => {
    inRouter(<Attention permissions={[]} />)
    expect(screen.queryByText(/access request/)).toBeNull()
    expect(staffApi.listAccessRequests).not.toHaveBeenCalled()
  })

  it('says it is loading, then counts the pending requests and leads to them', async () => {
    vi.mocked(staffApi.listAccessRequests).mockResolvedValue([
      { accessRequestId: 'a', status: 'pending' }, { accessRequestId: 'b', status: 'approved' },
    ] as Awaited<ReturnType<typeof staffApi.listAccessRequests>>)
    inRouter(<Attention permissions={['identity.consent.write']} />)
    expect(screen.getByRole('status').textContent).toBe('Loading access requests')
    const link = await screen.findByRole('link', { name: '1 pending access request' })
    expect(link.getAttribute('href')).toBe('/provider/requests')
    expect(screen.getByText('Access request · waiting')).toBeDefined()
  })

  it('says a refusal in today\'s words', async () => {
    vi.mocked(staffApi.listAccessRequests).mockRejectedValue(refused('PERMISSION_DENIED', 'Denied'))
    inRouter(<Attention permissions={['identity.consent.write']} />)
    expect(await screen.findByText('Your role here can’t see access requests. Ask your facility administrator if you need to.')).toBeDefined()
  })
})

describe('Today: laboratory and pharmacy work', () => {
  it('says it is loading', () => {
    vi.mocked(staffApi.labWorkItems).mockReturnValue(pending())
    inRouter(<TodayCard facilityId={FACILITY_ID} lab pharmacy={false} />)
    expect(screen.getByRole('status').textContent).toBe('Loading today\'s work')
    expect(staffApi.pharmacyWorkItems).not.toHaveBeenCalled()
  })

  it('says when there is no work, and reads nothing for a role that does none', async () => {
    vi.mocked(staffApi.labWorkItems).mockResolvedValue({ items: [] })
    vi.mocked(staffApi.pharmacyWorkItems).mockResolvedValue({ items: [] })
    const { unmount } = inRouter(<TodayCard facilityId={FACILITY_ID} lab pharmacy />)
    expect(await screen.findByText('No accepted work yet')).toBeDefined()
    unmount()
    vi.clearAllMocks()
    inRouter(<TodayCard facilityId={FACILITY_ID} lab={false} pharmacy={false} />)
    expect(screen.getByText('Nothing scheduled for you')).toBeDefined()
    expect(staffApi.labWorkItems).not.toHaveBeenCalled()
  })

  it('lists work as the design does, naming no patient', async () => {
    vi.mocked(staffApi.labWorkItems).mockResolvedValue({ items: [
      { id: 'w1', patientId: 'p-000000abc123', version: 1, status: 'in_progress', testName: 'Full blood count' },
    ] })
    vi.mocked(staffApi.pharmacyWorkItems).mockResolvedValue({ items: [
      { id: 'x1', patientId: 'p-000000def456', version: 1, acceptedAt: '2026-10-29T09:00:00Z', medication: { display: 'Amoxicillin 500 mg capsule' } },
    ] })
    inRouter(<TodayCard facilityId={FACILITY_ID} lab pharmacy />)
    expect((await screen.findByRole('link', { name: 'Full blood count' })).getAttribute('href')).toBe('/provider/laboratory')
    expect(screen.getByText('Laboratory · in progress')).toBeDefined()
    expect(await screen.findByText('Pharmacy · to dispense')).toBeDefined()
    expect(document.body.textContent).not.toMatch(/abc123|def456/)
  })

  it('says a failure in today\'s words', async () => {
    vi.mocked(staffApi.pharmacyWorkItems).mockRejectedValue(refused('PERMISSION_DENIED', 'This membership cannot read pharmacy work.'))
    inRouter(<TodayCard facilityId={FACILITY_ID} lab={false} pharmacy />)
    expect(await screen.findByText('Pharmacy work could not be loaded')).toBeDefined()
    expect(screen.getByText(SAID_REFUSED)).toBeDefined()
    expect(document.body.textContent).not.toContain('This membership cannot read pharmacy work.')
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
