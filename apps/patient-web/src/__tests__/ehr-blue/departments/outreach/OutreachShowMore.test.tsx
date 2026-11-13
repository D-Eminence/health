import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'

/*
 * "Show more" on the registration lists (hid-system#247): the first read is the list's own request, the newest 100; a
 * paging Outreach sends X-Next-Cursor when older ones are left, and "Show more" adds the next 100 under them. An
 * Outreach before paging sends no cursor, and nothing more is offered. Fictional data only.
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

/** Registration n, older as n grows. */
const row = (n: number, campaignId = 'campaign-1') => ({
  id: `c0a5e000-0000-4000-8000-${String(n).padStart(12, '0')}`, campaignId, status: 'identity_resolution_pending', fullName: `Person ${n}`,
  ageYears: 30, sex: 'female', createdAt: new Date(Date.UTC(2026, 10, 14, 12) - n * 60_000).toISOString(), rowVersion: 1,
})
const rows = (from: number, to: number, campaignId?: string) => Array.from({ length: to - from + 1 }, (_, i) => row(from + i, campaignId))

let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN, OTHER])
  api.outreachCampaignMembers.mockResolvedValue([])
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})

afterEach(() => {
  expect([...unprovided]).toEqual([])
  expect(setItem).not.toHaveBeenCalled()
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

const casesList = () => screen.findByRole('list', { name: 'Registrations' })
const showMore = () => screen.queryByRole('button', { name: /^(Show more|Loading more…)$/ })
const allTab = () => screen.getByRole('button', { name: /^All\d/ })

describe('Show more on the registration list', () => {
  it('asks for the list as before, and offers nothing more when Outreach sends no cursor (an Outreach before paging)', async () => {
    api.outreachCasesPage.mockResolvedValue({ items: rows(1, 3), nextCursor: null })
    renderDept(<Outreach />)
    expect(within(await casesList()).getAllByRole('button')).toHaveLength(3)
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(1)
    expect(api.outreachCasesPage).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, {})
    expect(showMore()).toBeNull()
  })

  it('adds the next 100 under the list while a cursor is sent, keeps focus on Show more, then says everyone is shown', async () => {
    api.outreachCasesPage
      .mockResolvedValueOnce({ items: rows(1, 2), nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: rows(3, 4), nextCursor: 'cursor-3' })
      .mockResolvedValueOnce({ items: rows(5, 5), nextCursor: null })
    renderDept(<Outreach />)
    await casesList()
    await press(allTab())
    expect(within(await casesList()).getAllByRole('button')).toHaveLength(2)

    await press(showMore()!)
    expect(api.outreachCasesPage).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { limit: 100, before: 'cursor-2' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Registrations' })).getAllByRole('button')).toHaveLength(4))
    expect(document.activeElement).toBe(showMore())
    expect(screen.getByText('More registrations added below.')).toBeTruthy()
    expect(allTab().textContent).toContain('4')

    await press(showMore()!)
    expect(api.outreachCasesPage).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { limit: 100, before: 'cursor-3' })
    await waitFor(() => expect(showMore()).toBeNull())
    const names = within(screen.getByRole('list', { name: 'Registrations' })).getAllByRole('button').map(button => button.textContent?.match(/^Person \d+/)?.[0])
    expect(names).toEqual(['Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5'])
    const end = screen.getByText('All 5 registrations are shown.')
    await waitFor(() => expect(document.activeElement).toBe(end))
  })

  it('says when more could not be loaded, keeps focus on the button, and tries again', async () => {
    api.outreachCasesPage
      .mockResolvedValueOnce({ items: rows(1, 2), nextCursor: 'cursor-2' })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ items: rows(3, 3), nextCursor: null })
    renderDept(<Outreach />)
    await casesList()
    await press(allTab())
    await press(showMore()!)
    expect(await screen.findAllByText('Couldn’t load more. Try again.')).not.toHaveLength(0)
    expect(document.activeElement).toBe(showMore())
    expect(within(screen.getByRole('list', { name: 'Registrations' })).getAllByRole('button')).toHaveLength(2)
    await press(showMore()!)
    expect(api.outreachCasesPage).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { limit: 100, before: 'cursor-2' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Registrations' })).getAllByRole('button')).toHaveLength(3))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryAllByText('Couldn’t load more. Try again.').filter(node => node.closest('[role="status"]') === null)).toHaveLength(0)
  })

  it('keeps the search filtering what is loaded, older rows included, and says it looks only at those', async () => {
    api.outreachCasesPage
      .mockResolvedValueOnce({ items: rows(1, 2), nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: [{ ...row(3), fullName: 'Zainab Older' }], nextCursor: 'cursor-3' })
    renderDept(<Outreach />)
    await casesList()
    await press(allTab())
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Outreach' }), { target: { value: 'zainab' } })
    expect(screen.getByText('Search looks only at the registrations shown here. Show more to search older ones.')).toBeTruthy()
    expect(screen.getByText('No matching registrations')).toBeTruthy()
    await press(showMore()!)
    const list = await casesList()
    expect(within(list).getAllByRole('button').map(button => button.textContent?.match(/^Zainab Older/)?.[0])).toEqual(['Zainab Older'])
  })

  it('opens an older registration added by Show more', async () => {
    api.outreachCasesPage
      .mockResolvedValueOnce({ items: rows(1, 1), nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: rows(2, 2), nextCursor: 'cursor-3' })
    renderDept(<Outreach />)
    await casesList()
    await press(showMore()!)
    await press(within(await casesList()).getByRole('button', { name: /^Person 2/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Person 2')
    expect(screen.queryByText('Record not found')).toBeNull()
  })

  it('reads a campaign’s registrations by campaign, keeps only its own, and pages them with its campaign', async () => {
    api.outreachCasesPage.mockImplementation(async (_facility: string, query: { campaignId?: string; before?: string }) => {
      if (!query.campaignId) return { items: [row(1), row(2, 'campaign-2')], nextCursor: null }
      // An Outreach before paging would send every campaign's; only this campaign's are shown.
      if (!query.before) return { items: [row(1), row(2, 'campaign-2'), row(3)], nextCursor: 'campaign-cursor' }
      return { items: [row(4)], nextCursor: null }
    })
    renderDept(<Outreach />)
    await press(within(await screen.findByRole('list', { name: 'Campaigns' })).getByRole('button', { name: /^Demo screening week/ }))
    const list = await screen.findByRole('list', { name: 'Registrations in Demo screening week' })
    expect(api.outreachCasesPage).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, { campaignId: 'campaign-1' })
    expect(within(list).getAllByRole('button').map(button => button.textContent?.match(/^Person \d+/)?.[0])).toEqual(['Person 1', 'Person 3'])
    await press(showMore()!)
    expect(api.outreachCasesPage).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, { limit: 100, before: 'campaign-cursor', campaignId: 'campaign-1' })
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Registrations in Demo screening week' })).getAllByRole('button')).toHaveLength(3))
    expect(screen.getByText('All 3 registrations are shown.')).toBeTruthy()

    // A registration opened here goes back to the campaign.
    await press(within(screen.getByRole('list', { name: 'Registrations in Demo screening week' })).getByRole('button', { name: /^Person 4/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Person 4')
    await press(screen.getAllByRole('button', { name: 'Back to list' })[0]!)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Demo screening week')
  })
})
