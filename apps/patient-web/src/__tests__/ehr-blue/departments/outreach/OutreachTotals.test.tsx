import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'

/*
 * The registration numbers count every registration, not only the newest 100 the list has loaded (owner, 14 Nov 2026:
 * "Registered 100" while the export held 138, and the numbers went down as people registered). They are read again
 * each time the list is, and a read that fails keeps the numbers read before. Fictional data only.
 */

vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: hospital, name: 'Demo Hospital', roles: ['outreach_officer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(),
}))
const unprovided = vi.hoisted(() => new Set<string>())
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, {
    get(target, property) {
      if (typeof property === 'string' && !(property in target)) unprovided.add(property)
      return Reflect.get(target, property)
    },
  }),
}))

const CAMPAIGN = { id: 'campaign-1', name: 'Demo screening week', status: 'active', services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 }
const OTHER = { ...CAMPAIGN, id: 'campaign-2', name: 'Demo follow-up' }

/** Registration n, older as n grows: every other one with health checks, every third with a Health ID. */
const row = (n: number, campaignId = 'campaign-1') => ({
  id: `c0a5e000-0000-4000-8000-${String(n).padStart(12, '0')}`, campaignId, status: 'identity_resolution_pending', fullName: `Person ${n}`,
  ageYears: 30, sex: 'female', createdAt: new Date(Date.UTC(2026, 10, 14, 12) - n * 60_000).toISOString(), rowVersion: 1,
  hasScreening: n % 2 === 0, healthId: n % 3 === 0 ? `HID-${String(n).padStart(6, '0')}` : null,
})
const rows = (from: number, to: number, campaignId?: string) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i, campaignId))

/** What the numbers' read of every registration (pages of 500) answers next; the list's own reads answer `list`. */
let everyone: () => Promise<{ items: ReturnType<typeof rows>; nextCursor: string | null }>
let list: () => Promise<{ items: ReturnType<typeof rows>; nextCursor: string | null }>

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN, OTHER])
  api.outreachCampaignMembers.mockResolvedValue([])
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  list = async () => ({ items: rows(1, 100), nextCursor: 'cursor-2' })
  everyone = async () => ({ items: rows(1, 138), nextCursor: null })
  api.outreachCasesPage.mockImplementation((_facility: string, query: { limit?: number }) => (query.limit === 500 ? everyone() : list()))
})

afterEach(() => {
  expect([...unprovided]).toEqual([])
})

const totalsReads = () => api.outreachCasesPage.mock.calls.filter(call => (call[1] as { limit?: number }).limit === 500)
const numbers = (name = 'Registration numbers') => screen.getByRole('region', { name }).textContent ?? ''

describe('registration numbers on Outreach', () => {
  it('counts every registration, not only the 100 loaded, and keeps them when a later read fails', async () => {
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Registrations' })
    await waitFor(() => expect(numbers()).toContain('Registered138'))
    expect(numbers()).toContain('Health checks done69')
    expect(numbers()).toContain('Health IDs made46')
    expect(numbers()).not.toContain('Counted from')
    expect(totalsReads()).toEqual([[expect.any(String), { limit: 500, before: undefined }]])

    // Refresh: the list is read again, and so are the numbers. That read fails: the numbers read before stay.
    everyone = async () => { throw new TypeError('Failed to fetch') }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    await waitFor(() => expect(totalsReads()).toHaveLength(2))
    await act(async () => { await Promise.resolve() })
    expect(numbers()).toContain('Registered138')
    expect(numbers()).toContain('Health checks done69')

    // The list's read fails too: nothing goes down, and the numbers are not read again.
    list = async () => { throw new TypeError('Failed to fetch') }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    await screen.findByText('Couldn’t refresh registrations')
    expect(totalsReads()).toHaveLength(2)
    expect(numbers()).toContain('Registered138')

    // Back to signal, with new people registered: the numbers go up.
    list = async () => ({ items: rows(1, 100), nextCursor: 'cursor-2' })
    everyone = async () => ({ items: rows(1, 141), nextCursor: null })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    await waitFor(() => expect(numbers()).toContain('Registered141'))
  })

  it('reads the numbers again when the list reads itself again (a search that finds nothing)', async () => {
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Registrations' })
    await waitFor(() => expect(numbers()).toContain('Registered138'))
    everyone = async () => ({ items: rows(1, 139), nextCursor: null })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Outreach' }), { target: { value: 'nobody here' } })
    await waitFor(() => expect(numbers()).toContain('Registered139'), { timeout: 3000 })
    expect(totalsReads()).toHaveLength(2)
  })

  it('runs one read of every registration at a time, keeps its numbers, and reads once more after list reads that came meanwhile', async () => {
    const waiting: Array<(answer: { items: ReturnType<typeof rows>; nextCursor: string | null }) => void> = []
    everyone = () => new Promise(resolve => { waiting.push(resolve) })
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Registrations' })
    await waitFor(() => expect(totalsReads()).toHaveLength(1))

    // The list is read again three times (a queue of registrations sending, Refresh) while that read is still running.
    for (let i = 0; i < 3; i += 1) await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh' })) })
    await act(async () => { await Promise.resolve() })
    expect(api.outreachCasesPage.mock.calls.filter(call => (call[1] as { limit?: number }).limit !== 500).length).toBeGreaterThanOrEqual(4)
    expect(totalsReads()).toHaveLength(1)
    expect(numbers()).toContain('Registered100')

    // It ends: its numbers are shown (not thrown away), and one more read starts, only one.
    await act(async () => { waiting.shift()!({ items: rows(1, 138), nextCursor: null }) })
    await waitFor(() => expect(numbers()).toContain('Registered138'))
    await waitFor(() => expect(totalsReads()).toHaveLength(2))
    await act(async () => { waiting.shift()!({ items: rows(1, 140), nextCursor: null }) })
    await waitFor(() => expect(numbers()).toContain('Registered140'))
    await act(async () => { await Promise.resolve() })
    expect(totalsReads()).toHaveLength(2)
    expect(waiting).toHaveLength(0)
  })

  it('counts what is loaded, and says so, until every registration is read', async () => {
    everyone = () => new Promise(() => {})
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Registrations' })
    expect(numbers()).toContain('Registered100')
    expect(numbers()).toContain('Counted from the 100 registrations loaded.')
  })

  it('reads nothing more when the list already has everyone', async () => {
    list = async () => ({ items: rows(1, 3), nextCursor: null })
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Registrations' })
    expect(numbers()).toContain('Registered3')
    expect(totalsReads()).toHaveLength(0)
  })

  it('counts a campaign’s own registrations on its page', async () => {
    list = async () => ({ items: [...rows(1, 100), ...rows(101, 110, 'campaign-2')], nextCursor: 'cursor-2' })
    api.outreachCasesPage.mockImplementation(async (_facility: string, query: { limit?: number; campaignId?: string }) => {
      if (query.campaignId) {
        return query.limit === 500
          ? { items: [...rows(1, 120), ...rows(121, 130, 'campaign-2')], nextCursor: null }
          : { items: rows(1, 100), nextCursor: 'campaign-cursor' }
      }
      return query.limit === 500 ? everyone() : list()
    })
    renderDept(<Outreach />)
    await press(within(await screen.findByRole('list', { name: 'Campaigns' })).getByRole('button', { name: /^Demo screening week/ }))
    await screen.findByRole('list', { name: 'Registrations in Demo screening week' })
    await waitFor(() => expect(numbers('Numbers for Demo screening week')).toContain('Registered120'))
    expect(numbers('Numbers for Demo screening week')).toContain('Health checks done60')
    expect(numbers('Numbers for Demo screening week')).not.toContain('Counted from')
    expect(api.outreachCasesPage).toHaveBeenCalledWith(expect.any(String), { limit: 500, before: undefined, campaignId: 'campaign-1' })
  })
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
