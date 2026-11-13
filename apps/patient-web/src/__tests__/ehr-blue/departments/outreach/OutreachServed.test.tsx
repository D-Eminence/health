import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'

/*
 * What Outreach serves, remembered for the session once seen: the area field and the longer notes (0118) stay for the
 * day's first registration and when the list can't be read, and the queued screen's Health ID line follows what is
 * known. Fictional data only.
 */

vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: ['outreach_volunteer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(),
  createOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const NAME = 'Kemi Balogun'
const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const pending = (id: string, extra: Record<string, unknown> = {}) => ({ id, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: NAME,
  ageYears: 30, sex: 'female', temporaryPatientId: `tmp_${id}`, createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1, ...extra })

beforeEach(() => {
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  vi.clearAllMocks()
  forgetOutreachServed()
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockResolvedValue([{ id: 'm-1', campaignId: 'campaign-1', membershipId: 'membership-demo-1', role: 'member', createdAt: '2026-11-01T00:00:00.000Z' }])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'member', people: [] })
})
afterEach(() => { setOutreachQueueStore(null) })

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

async function openNew() {
  const view = renderDept(<Outreach />)
  await press(await screen.findByRole('button', { name: 'New registration' }))
  await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
  return view
}

const areaBox = () => screen.queryByRole('textbox', { name: /Area, town or LGA/ })
const notesBox = () => screen.getByRole('textbox', { name: /Notes for the team/ }) as HTMLTextAreaElement

describe('health checks served, remembered for the session', () => {
  it('keeps the area field and 1000-character notes once seen, when the list is next empty', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', { hasScreening: false })])
    const first = await openNew()
    expect(areaBox()).toBeTruthy()
    first.unmount()
    // The day's first registration: nothing in the list says what Outreach serves.
    api.outreachCases.mockResolvedValue([])
    await openNew()
    expect(areaBox()).toBeTruthy()
    expect(notesBox().maxLength).toBe(1000)
  })

  it('keeps them when the list can’t be read (no signal)', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', { hasScreening: true })])
    const first = await openNew()
    expect(areaBox()).toBeTruthy()
    first.unmount()
    api.outreachCases.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await openNew()
    expect(areaBox()).toBeTruthy()
    expect(notesBox().maxLength).toBe(1000)
  })

  it('learns it from the registration just saved', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-new', { hasScreening: false }))
    await openNew()
    expect(areaBox()).toBeNull()
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: NAME } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await screen.findByText('Registration saved')
    await press(screen.getAllByRole('button', { name: 'Register another person' })[0]!)
    await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
    expect(areaBox()).toBeTruthy()
  })

  it('asks for no area while nothing says Outreach serves health checks', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1')])
    await openNew()
    expect(areaBox()).toBeNull()
    expect(notesBox().maxLength).toBe(280)
  })
})

describe('an area Outreach refuses', () => {
  it('says to shorten it, on the area field', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', { hasScreening: false })])
    api.createOutreachCase.mockRejectedValue(new HidApiError(422, 'Enter the area in 100 characters or fewer.', { code: 'OUTREACH_AREA_INVALID' }))
    await openNew()
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: NAME } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    fireEvent.change(areaBox()!, { target: { value: 'Ajegunle' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(areaBox()!.getAttribute('aria-invalid')).toBe('true'))
    const field = areaBox()!.closest('.hid-ehr-field') ?? areaBox()!.parentElement!.parentElement!
    expect(within(field as HTMLElement).getByText('Shorten the area, town or LGA.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Enter the area in 100 characters or fewer.')
  })
})

describe('the queued screen’s Health ID line', () => {
  async function queueOne() {
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: NAME } })
    fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await screen.findByRole('region', { name: 'Saved on this device' })
    return screen.getByRole('region', { name: 'Get a Health ID now' })
  }

  it('says the team can create it once sent, where Outreach makes Health IDs', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1', { healthId: null })])
    await openNew()
    const card = await queueOne()
    expect(card.textContent).toContain('Once this registration is sent, open it to create their Health ID.')
  })

  it('keeps “Your team can’t create it for them” where Outreach is known to make none', async () => {
    api.outreachCases.mockResolvedValue([pending('case-1')])
    await openNew()
    const card = await queueOne()
    expect(card.textContent).toContain('Your team can’t create it for them.')
    expect(card.textContent).not.toContain('Once this registration is sent')
  })
})
