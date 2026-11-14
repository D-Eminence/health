import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { FacilityCheckCard, ReviewBanner } from '../ReviewBanner'
import { announceFacilityStaffChanged } from '../../staffAccess'

/**
 * Until Health ID support has checked a facility that signed itself up (Novu, P4b SPEC 8.4), every member sees what
 * stays locked for the facility's type, and that support's check signs them out once; the administrator is told to add
 * their own licence while none is saved. "Check again" reads the session afresh.
 */
const api = vi.hoisted(() => ({ read: vi.fn() }))
const workspace = vi.hoisted(() => ({ refresh: vi.fn(), facility: null as Record<string, unknown> | null }))
vi.mock('../../api', () => ({ facilityStaffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { id: 'staff-1', roles: [], permissions: [], facilities: [],
    facility: workspace.facility } } }, refresh: workspace.refresh, lock: null }),
}))

const ADMIN = ['workforce.manage', 'audit.read']
function at(organizationType: string | null, review = 'pending', permissions = ADMIN) {
  workspace.facility = { id: 'facility-1', membershipId: 'member-1', organizationId: 'org-1', name: 'Ikeja Care', roles: [],
    permissions, isPrimary: true, ...(organizationType ? { selfService: { review, organizationType } } : {}) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  api.read.mockResolvedValue({ administratorLicence: null, administratorLicenceBodies: ['MDCN', 'NMCN'] })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const banner = () => screen.getByRole('status')

describe('the review banner', () => {
  it.each([
    ['hospital', 'patient records, emergency access, the Laboratory and Pharmacy work lists and adding staff are locked', 'ehr'],
    ['clinic', 'patient records, emergency access, the Laboratory and Pharmacy work lists and adding staff are locked', 'ehr'],
    ['laboratory', 'patient records, the Laboratory workspace and adding staff are locked', 'lab'],
    ['pharmacy', 'patient records, the Pharmacy workspace and adding staff are locked', 'pharmacy'],
    ['other', 'patient records and adding staff are locked', 'ehr'],
  ])('says what stays locked at a %s, and where to sign in again', async (type, locked, site) => {
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com' })
    at(type, 'pending', [])
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(banner().textContent).toBe(`Health ID support is checking Ikeja Care. This usually takes up to one working day. Until `
      + `then, ${locked}. When the check is done you’ll be signed out once: sign in again at ${site}.healthidentitydirectory.com `
      + 'to use them.Check again')
    // A member who cannot manage staff is not asked for the administrator's licence.
    expect(api.read).not.toHaveBeenCalled()
  })

  it('names staging’s sites on staging, and none elsewhere', () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'staging.healthidentitydirectory.com' })
    at('pharmacy', 'pending', [])
    const { unmount } = render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(banner().textContent).toContain('sign in again at pharmacy.staging.healthidentitydirectory.com to use them.')
    unmount()
    vi.unstubAllGlobals()
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(banner().textContent).toContain('signed out once: sign in again to use them.')
  })

  it('asks the administrator for their licence while none is saved, and stops once it is', async () => {
    at('hospital')
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Staff page' })).toBeTruthy()
    expect(banner().textContent).toContain('To get clinical access yourself, add your licence on the Staff page.')
    expect(screen.getByRole('link', { name: 'Staff page' }).getAttribute('href')).toBe('/provider/staff')
    expect(api.read).toHaveBeenCalledWith('facility-1')
    // The Staff page saved it: the banner reads again.
    api.read.mockResolvedValue({ administratorLicence: { body: 'MDCN', numberHint: '2345', recordedAt: '2026-10-25T10:00:00Z' },
      administratorLicenceBodies: ['MDCN', 'NMCN'] })
    act(() => announceFacilityStaffChanged())
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Staff page' })).toBeNull())
    expect(api.read).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['support can give the type no clinical role', { administratorLicence: null, administratorLicenceBodies: [] }],
  ])('does not ask when %s', async (_, answer) => {
    api.read.mockResolvedValue(answer)
    at('other')
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Staff page' })).toBeNull()
  })

  it('does not ask when the Staff page can’t be read', async () => {
    api.read.mockRejectedValue(new HidApiError(503, 'Unavailable', { code: 'UPSTREAM_UNAVAILABLE' }))
    at('hospital')
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    await waitFor(() => expect(api.read).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: 'Staff page' })).toBeNull()
  })

  it('reads the session again on “Check again”', () => {
    at('laboratory', 'pending', [])
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(workspace.refresh).toHaveBeenCalledTimes(1)
  })

  it('reads a review state it does not know as still pending', () => {
    at('hospital', 'under_reconsideration', [])
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(banner().textContent).toMatch(/^Health ID support is checking Ikeja Care\./)
  })

  it.each([
    ['once support has checked the facility', () => at('hospital', 'reviewed')],
    ['at a governed facility', () => at(null)],
    ['on a main-v1 build', () => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1'); at('hospital') }],
  ])('is not shown %s', (_, setUp) => {
    setUp()
    render(<MemoryRouter><ReviewBanner /></MemoryRouter>)
    expect(screen.queryByRole('status')).toBeNull()
    expect(api.read).not.toHaveBeenCalled()
  })
})

describe('the Overview’s facility check', () => {
  it('is pending until support’s check', () => {
    at('hospital')
    render(<FacilityCheckCard facility={workspace.facility as never} />)
    expect(screen.getByRole('heading', { name: 'Facility check' })).toBeTruthy()
    expect(screen.getByText('Health ID support is checking Ikeja Care. This usually takes up to one working day.')).toBeTruthy()
    expect(screen.getByText('Pending')).toBeTruthy()
  })

  it('says “Done” the first time after it, then nothing', () => {
    at('pharmacy', 'reviewed')
    workspace.facility = { ...workspace.facility, id: 'facility-done' }
    const { unmount } = render(<FacilityCheckCard facility={workspace.facility as never} />)
    expect(screen.getByText('Health ID support has checked Ikeja Care, and it now has full access.')).toBeTruthy()
    expect(screen.getByText('Done')).toBeTruthy()
    unmount()
    render(<FacilityCheckCard facility={workspace.facility as never} />)
    expect(screen.queryByRole('heading', { name: 'Facility check' })).toBeNull()
  })

  it('is not shown at a governed facility', () => {
    at(null)
    render(<FacilityCheckCard facility={workspace.facility as never} />)
    expect(screen.queryByRole('heading', { name: 'Facility check' })).toBeNull()
  })
})
