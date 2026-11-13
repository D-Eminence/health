import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../../harness'
import { CampaignSetup, CampaignTeam } from '../../../../../ehr-blue/departments/outreach/plan'
import { contactFrom } from '../../../../../ehr-blue/departments/outreach/plan/CampaignTeam'
import { packageFor } from '../../../../../ehr-blue/departments/outreach/screeningTemplates'

/*
 * A campaign's Team and Setup (owner decisions of 13 November 2026): invites with one key per person, changes and
 * removals against the version read, the plan's sections saved with If-Match. Fictional data only.
 */

const session = vi.hoisted(() => ({ roles: ['outreach_officer'] as string[] }))
vi.mock('../../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../../harness')
  return { useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.campaign.write'], { id: hospital, name: 'Demo Hospital', roles: session.roles })) }
})
const routes = await vi.hoisted(async () => (await import('./planTestKit')).campaignRoutes())
const api = vi.hoisted(() => ({ outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn() }))
vi.mock('../../../../../staff/api', () => ({ staffApi: api, outreachCampaignRequest: routes.request }))

const member = (memberId: string, name: string | null, roles: string[], extra: object = {}) => ({ memberId, name, phone: '+2348010000000', email: null, roles,
  siteId: 'site-1', station: 'register', status: 'accepted', invitedAt: '2026-11-10T09:00:00.000Z', joinedAt: '2026-11-10T09:00:00.000Z',
  registered: 12, screened: 3, rowVersion: 2, ...extra })
const TEAM = {
  members: [member('tm-1', 'Demo Coordinator', ['coordinator', 'clinician']), member('tm-2', 'Demo Registrar', ['registrar', 'vitals']),
    member('tm-3', null, ['data_checker'], { status: 'invited', phone: '+2348020000000', registered: 0, screened: 0, joinedAt: null })],
  you: { memberId: 'tm-1', roles: ['coordinator', 'clinician'], siteId: 'site-1', station: 'results' },
}
const PLAN = {
  campaignId: 'campaign-1', organisationName: 'Demo Health Volunteers', target: 300, focuses: ['hepatitis_b'], package: packageFor(['hepatitis_b']),
  sites: [{ id: 'site-1', name: 'Demo Town Hall', community: 'Demo', lga: 'Demo LGA', address: '1 Demo Road' }], stationMode: 'split',
  stations: ['register', 'tests', 'results'], partners: [], consent: { text: 'We will test for hepatitis B.', version: '2026-11-13', languages: ['en'] },
  kits: [{ id: 'kit-1', siteId: 'site-1', testId: 'hbsag', lot: 'HB-1', expiresOn: '2099-01-01', count: 100, used: 95 }], rowVersion: 4,
}

beforeEach(() => {
  vi.clearAllMocks()
  routes.reset()
  session.roles = ['outreach_officer']
  routes.on(call => (call.method === 'GET' && call.path.endsWith('/team') ? TEAM : undefined))
  routes.on(call => (call.method === 'GET' && call.path.endsWith('/plan') ? PLAN : undefined))
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

describe('the team', () => {
  it('shows each member as a card with roles in words, site, station, invite status and counts', async () => {
    renderDept(<CampaignTeam campaignId="campaign-1" />)
    const list = await screen.findByRole('list', { name: 'Team members' })
    const registrar = within(list).getByText('Demo Registrar').closest('li') as HTMLElement
    expect(registrar.textContent).toContain('Registrar and Vital signs')
    expect(registrar.textContent).toContain('Demo Town Hall · Registration')
    expect(registrar.textContent).toContain('Registered12')
    expect(within(list).getByText('+2348020000000').closest('li')?.textContent).toContain('Invite sent')
    expect(screen.getByText('2 joined · 1 invite waiting')).toBeTruthy()
  })

  it('invites by phone with several roles, keeping one key for the same person sent again', async () => {
    let sent = 0
    routes.on(call => {
      if (call.method !== 'POST') return undefined
      sent += 1
      return sent === 1 ? new HidApiError(0, 'Network down', { code: 'NETWORK_ERROR' }) : { ...TEAM.members[2], memberId: 'tm-9' }
    })
    renderDept(<CampaignTeam campaignId="campaign-1" />)
    await press(await screen.findByRole('button', { name: 'Invite' }))
    const sheet = screen.getByRole('dialog', { name: 'Invite to the team' })
    await press(within(sheet).getByRole('button', { name: 'Send invitation' }))
    expect(within(sheet).getByText(/Enter a phone number like 08012345678/)).toBeTruthy()
    expect(routes.of('POST', '/team')).toEqual([])
    fireEvent.change(within(sheet).getByLabelText(/^Phone or email/), { target: { value: '0803 123 4567' } })
    fireEvent.click(within(sheet).getByLabelText('Tester'))
    fireEvent.click(within(sheet).getByLabelText('Counsellor'))
    await press(within(sheet).getByRole('button', { name: 'Send invitation' }))
    expect(within(sheet).getByRole('alert')).toBeTruthy()
    await press(within(sheet).getByRole('button', { name: 'Send invitation' }))
    const [first, second] = routes.of('POST', '/campaigns/campaign-1/team')
    expect(first?.body).toEqual({ phone: '08031234567', roles: ['registrar', 'tester', 'counsellor'], siteId: 'site-1', station: 'register' })
    expect(first?.headers?.['Idempotency-Key']).toBeTruthy()
    expect(second?.headers?.['Idempotency-Key']).toBe(first?.headers?.['Idempotency-Key'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('changes roles and removes a member against the version read, removing only once confirmed', async () => {
    routes.on(call => (call.method === 'PATCH' ? { ...TEAM.members[1], roles: ['registrar'], rowVersion: 3 } : call.method === 'DELETE' ? null : undefined))
    renderDept(<CampaignTeam campaignId="campaign-1" />)
    await press(await screen.findByRole('button', { name: 'Change roles for Demo Registrar' }))
    const sheet = screen.getByRole('dialog', { name: 'Change roles for Demo Registrar' })
    fireEvent.click(within(sheet).getByLabelText('Vital signs'))
    await press(within(sheet).getByRole('button', { name: 'Save' }))
    expect(routes.of('PATCH', '/team/tm-2')).toEqual([expect.objectContaining({ body: { roles: ['registrar'], siteId: 'site-1', station: 'register' },
      headers: { 'If-Match': '"2"' } })])
    await press(screen.getByRole('button', { name: 'Remove Demo Registrar' }))
    const confirm = await screen.findByRole('dialog', { name: 'Remove Demo Registrar from the team?' })
    expect(confirm.textContent).toContain('still count')
    await press(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(routes.of('DELETE', '/team/tm-2')).toEqual([])
    await press(screen.getByRole('button', { name: 'Remove Demo Registrar' }))
    await press(within(await screen.findByRole('dialog', { name: 'Remove Demo Registrar from the team?' })).getByRole('button', { name: 'Remove' }))
    expect(routes.of('DELETE', '/team/tm-2')).toEqual([expect.objectContaining({ headers: { 'If-Match': '"2"' } })])
  })

  it('offers a member who isn’t a coordinator nothing to change', async () => {
    routes.reset()
    routes.on(call => (call.method === 'GET' && call.path.endsWith('/team') ? { ...TEAM, you: { ...TEAM.you, roles: ['registrar'] } } : undefined))
    renderDept(<CampaignTeam campaignId="campaign-1" />)
    await screen.findByRole('list', { name: 'Team members' })
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  })

  it('keeps an outreach group organiser’s email invitations where campaign teams aren’t served yet', async () => {
    routes.reset()
    session.roles = ['outreach_organiser']
    api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
    renderDept(<CampaignTeam campaignId="campaign-1" embedded />)
    expect(await screen.findByRole('region', { name: 'Your team' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Their email/ })).toBeTruthy()
  })

  it('reads a phone or email as Outreach takes it', () => {
    expect(contactFrom(' Name@Example.TEST ')).toEqual({ email: 'name@example.test' })
    expect(contactFrom('+234 803 123 4567')).toEqual({ phone: '+2348031234567' })
    expect(contactFrom('12345')).toBeNull()
  })
})

describe('the setup', () => {
  it('shows each section, with kits used and left, and saves a section against the version read', async () => {
    routes.on(call => (call.method === 'PUT' ? { ...(call.body as object), campaignId: 'campaign-1', rowVersion: 5 } : undefined))
    renderDept(<CampaignSetup campaignId="campaign-1" />)
    expect(await screen.findByText('Demo Town Hall')).toBeTruthy()
    expect(screen.getByText('5 left')).toBeTruthy()
    expect(screen.getByText(/95 used of 100/)).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Edit sites' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit sites' })
    await press(within(sheet).getByRole('button', { name: 'Add another site' }))
    fireEvent.change(within(sheet).getAllByLabelText(/^Place name/)[1]!, { target: { value: 'Demo Church Hall' } })
    await press(within(sheet).getByRole('button', { name: 'Save' }))
    const [save] = routes.of('PUT', '/campaigns/campaign-1/plan')
    expect(save?.headers).toEqual({ 'If-Match': '"4"' })
    expect((save?.body as { sites: Array<{ name: string }> }).sites.map(site => site.name)).toEqual(['Demo Town Hall', 'Demo Church Hall'])
    expect((save?.body as { kits: unknown[] }).kits).toHaveLength(1)
  })

  it('says a plan changed since in words and reads it again', async () => {
    routes.on(call => (call.method === 'PUT' ? new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }) : undefined))
    renderDept(<CampaignSetup campaignId="campaign-1" />)
    await press(await screen.findByRole('button', { name: 'Edit campaign' }))
    const sheet = screen.getByRole('dialog', { name: 'Edit campaign' })
    const reads = routes.of('GET', '/plan').length
    await press(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).getByText('Someone changed this just now. It has been read again: check it, then try again.')).toBeTruthy()
    expect(routes.of('GET', '/plan').length).toBe(reads + 1)
  })

  it('says nothing inside another page where Outreach doesn’t serve plans yet', async () => {
    routes.reset()
    const view = renderDept(<CampaignSetup campaignId="campaign-1" embedded />)
    await waitFor(() => expect(routes.calls.length).toBeGreaterThan(0))
    await act(async () => {})
    expect(view.container.textContent).toBe('')
  })
})
