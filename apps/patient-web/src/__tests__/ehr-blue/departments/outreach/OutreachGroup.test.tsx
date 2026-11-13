import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'

/*
 * An outreach group's own Outreach (open sign-up on outreach., owner decisions of 11 November 2026): no Health ID check
 * before its campaigns go live (decision Q38), "This outreach group is paused" once paused, "Create your first
 * campaign", "Your team", the person's agreement before they are registered (told the group is an unverified
 * organiser), notes kept short, a campaign required, the duplicate hint, no Health ID linking, and the offline queue.
 * Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
const session = vi.hoisted(() => ({ roles: ['outreach_organiser'] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read',
      'outreach.registration.write'], { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: session.roles })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachScreening: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(),
  outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const MEMBERSHIP = 'membership-demo-1'
const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const pending = (id: string, fullName: string) => ({ id, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName, ageYears: 30, sex: 'female',
  temporaryPatientId: `tmp_${id}`, createdAt: '2026-11-11T09:00:00.000Z', rowVersion: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  // Today's Outreach serves no health checks (0118): the section is not shown.
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  session.roles = ['outreach_organiser']
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockResolvedValue([{ id: 'm-1', campaignId: 'campaign-1', membershipId: MEMBERSHIP, role: 'admin', createdAt: '2026-11-01T00:00:00.000Z' }])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'admin', people: [] })
  // As identity-api answers: who has joined, then the invitations still waiting.
  api.outreachInvitations.mockResolvedValue({
    members: [{ membershipId: 'b2000000-0000-4000-8000-000000000001', name: 'Bisi Adeyemi', email: 'bisi@example.test', roleCode: 'outreach_volunteer',
      status: 'active', joinedAt: '2026-11-10T09:00:00.000Z' }],
    invitations: [{ invitationId: 'b1000000-0000-4000-8000-000000000002', name: 'Tayo Ojo', email: 'tayo@example.test', status: 'pending',
      expiresAt: '2026-11-18T09:00:00.000Z', createdAt: '2026-11-11T09:00:00.000Z', acceptedAt: null }],
  })
})
afterEach(() => { setOutreachQueueStore(null) })

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}
const textbox = (name: RegExp | string) => screen.getByRole('textbox', { name }) as HTMLInputElement

async function openNewRegistration() {
  renderDept(<Outreach />)
  await press(await screen.findByRole('button', { name: 'New registration' }))
  await screen.findByRole('heading', { level: 1, name: 'New registration' })
  // The campaign is listed once the membership read says this member is in it.
  await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
}

function fillPerson(age = '30') {
  fireEvent.change(textbox(/Full name/), { target: { value: 'Kemi Balogun' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: age } })
}

describe('an outreach group’s Outreach', () => {
  it('says nothing of a Health ID check for a new (unverified) group, and asks Health ID nothing it does not need', async () => {
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Campaigns' })
    expect(api.outreachCampaignGovernance).toHaveBeenCalledWith(GROUP_ID)
    expect(document.body.textContent).not.toMatch(/Health ID check|checks every new outreach group|no campaign can be opened/)
    expect(screen.queryByText('This outreach group is paused')).toBeNull()
  })

  it('says a paused group is paused', async () => {
    api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'suspended' })
    const view = renderDept(<Outreach />)
    expect(await screen.findByText('This outreach group is paused')).toBeTruthy()
    view.unmount()
  })

  it('offers “Create your first campaign” when the group has none', async () => {
    api.outreachCampaigns.mockResolvedValue([])
    renderDept(<Outreach />)
    expect((await screen.findAllByText('Create your first campaign')).length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('A campaign is one outreach event or drive')
    await press(screen.getByRole('button', { name: 'Create your first campaign' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New campaign' })).toBeTruthy()
  })

  it('shows no limits and no prices anywhere', async () => {
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Campaigns' })
    expect(document.body.textContent).not.toMatch(/\d+ of \d+|limit|₦|price|subscription/i)
  })
})

describe('Your team', () => {
  it('lists the organiser’s invitations and invites a helper, the same key for the same helper sent again', async () => {
    api.createOutreachInvitation.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ invitationId: 'b1000000-0000-4000-8000-000000000009', expiresAt: null, deliveryOutcome: 'accepted', replayed: false })
    renderDept(<Outreach />)
    const team = await screen.findByRole('region', { name: 'Your team' })
    expect(await within(team).findByText('Bisi Adeyemi')).toBeTruthy()
    expect(within(within(team).getByRole('list', { name: 'Team members' })).getByText('Joined')).toBeTruthy()
    expect(within(within(team).getByRole('list', { name: 'Team invitations' })).getByText('Tayo Ojo')).toBeTruthy()
    expect(within(team).getByText('Waiting to accept')).toBeTruthy()
    fireEvent.change(within(team).getByRole('textbox', { name: /Their name/ }), { target: { value: 'Chinedu Eze' } })
    fireEvent.change(within(team).getByRole('textbox', { name: /Their email/ }), { target: { value: 'chinedu@example.test' } })
    await press(within(team).getByRole('button', { name: 'Send invitation' }))
    expect(await within(team).findByRole('alert')).toBeTruthy()
    await press(within(team).getByRole('button', { name: 'Send invitation' }))
    expect(await within(team).findByText('Invitation sent to Chinedu Eze. They join when they open the link in the email.')).toBeTruthy()
    const [first, second] = api.createOutreachInvitation.mock.calls
    expect(first![1]).toEqual({ name: 'Chinedu Eze', email: 'chinedu@example.test' })
    expect(second![2]).toBe(first![2])
  })

  it('says plainly when the person already has an invitation waiting (409, not replayed)', async () => {
    api.createOutreachInvitation.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_INVITATION_ALREADY_SENT' }))
    renderDept(<Outreach />)
    const team = await screen.findByRole('region', { name: 'Your team' })
    await within(team).findByText('Bisi Adeyemi')
    fireEvent.change(within(team).getByRole('textbox', { name: /Their name/ }), { target: { value: 'Tayo Ojo' } })
    fireEvent.change(within(team).getByRole('textbox', { name: /Their email/ }), { target: { value: 'tayo@example.test' } })
    await press(within(team).getByRole('button', { name: 'Send invitation' }))
    expect((await within(team).findByRole('alert')).textContent).toBe('This person already has an invitation waiting.')
    await waitFor(() => expect(api.outreachInvitations).toHaveBeenCalledTimes(2))
  })

  it('checks the helper’s name and email before sending anything', async () => {
    renderDept(<Outreach />)
    const team = await screen.findByRole('region', { name: 'Your team' })
    await press(within(team).getByRole('button', { name: 'Send invitation' }))
    expect(within(team).getByText(/Enter their name/)).toBeTruthy()
    expect(within(team).getByText(/Enter their email address/)).toBeTruthy()
    expect(api.createOutreachInvitation).not.toHaveBeenCalled()
  })

  it('is the organiser’s only: a helper sees no team and asks for none', async () => {
    session.roles = ['outreach_volunteer']
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Campaigns' })
    expect(screen.queryByRole('region', { name: 'Your team' })).toBeNull()
    expect(api.outreachInvitations).not.toHaveBeenCalled()
  })
})

describe('registering someone at an outreach group', () => {
  it('asks for their agreement first, with the notice in plain English, and sends it with the registration', async () => {
    api.createOutreachCase.mockResolvedValue({ ...pending('case-1', 'Kemi Balogun'), possibleDuplicate: false })
    await openNewRegistration()
    const notice = screen.getByRole('note', { name: 'Registration notice' })
    expect(notice.textContent).toContain('Ajegunle Health Volunteers is registering people at this event on Health ID Outreach.')
    expect(notice.textContent).toContain('Unverified organiser. Health ID has not checked who runs Ajegunle Health Volunteers.')
    expect(notice.textContent).toContain('deleted 1 year after the campaign closes')
    expect(notice.textContent).toContain('You can say no to being registered.')
    fillPerson()
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(screen.getByText('Choose how the person agreed.')).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('combobox', { name: /Language the notice was given in/ }), { target: { value: 'yo' } })
    expect(screen.getByText('You read the notice aloud in this language.')).toBeTruthy()
    await press(screen.getByRole('radio', { name: /I read it to them and they said yes/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalled())
    const [facility, input, command] = api.createOutreachCase.mock.calls[0]!
    expect(facility).toBe(GROUP_ID)
    expect(input).toMatchObject({ campaignId: 'campaign-1', fullName: 'Kemi Balogun', ageYears: 30,
      consent: { textVersion: 'outreach-notice-2026-11-14', language: 'yo', method: 'verbal_read_aloud' } })
    expect(input.consent.guardianName).toBeUndefined()
    expect(command.localCommandId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('needs a parent or guardian’s name for anyone under 18', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-2', 'Ada Child'))
    await openNewRegistration()
    fillPerson('9')
    await press(screen.getByRole('radio', { name: /Their parent or guardian agreed for them/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(screen.getByText('This person is under 18. Enter the name of the parent or guardian who agreed.')).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()
    fireEvent.change(textbox(/Parent or guardian’s name/), { target: { value: 'Ngozi Obi' } })
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalled())
    expect(api.createOutreachCase.mock.calls[0]![1].consent).toEqual({ textVersion: 'outreach-notice-2026-11-14', language: 'en',
      method: 'guardian', guardianName: 'Ngozi Obi' })
  })

  it('under 18, offers only “Their parent or guardian agreed for them”, so the record says who agreed', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-4', 'Ada Child'))
    await openNewRegistration()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    fillPerson('12')
    const self = screen.getByRole('radio', { name: /They read it themselves and agreed/ }) as HTMLInputElement
    const readAloud = screen.getByRole('radio', { name: /I read it to them and they said yes/ }) as HTMLInputElement
    const guardian = screen.getByRole('radio', { name: /Their parent or guardian agreed for them/ }) as HTMLInputElement
    expect(self.disabled).toBe(true)
    expect(readAloud.disabled).toBe(true)
    expect(guardian.checked).toBe(true)
    expect(screen.getAllByText('Not for anyone under 18.')).toHaveLength(2)
    fireEvent.change(textbox(/Parent or guardian’s name/), { target: { value: 'Ngozi Obi' } })
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalled())
    expect(api.createOutreachCase.mock.calls[0]![1].consent).toMatchObject({ method: 'guardian', guardianName: 'Ngozi Obi' })
  })

  it('keeps a parent or guardian’s name to 120 characters, as Outreach does', async () => {
    await openNewRegistration()
    const guardian = textbox(/Parent or guardian’s name/)
    expect(guardian.maxLength).toBe(120)
    fillPerson()
    await press(screen.getByRole('radio', { name: /Their parent or guardian agreed for them/ }))
    fireEvent.change(guardian, { target: { value: 'N'.repeat(121) } })
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(screen.getByText('Keep the name to 120 characters.')).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('keeps notes to 1000 characters, with health check results kept out of them', async () => {
    await openNewRegistration()
    expect(document.body.textContent).toContain('Health check results go in Health checks after you save, not here.')
    const notes = screen.getByRole('textbox', { name: /Notes for the team/ }) as HTMLTextAreaElement
    expect(notes.maxLength).toBe(1000)
    fireEvent.change(notes, { target: { value: 'x'.repeat(1001) } })
    fillPerson()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(screen.getByText('Keep notes to 1000 characters. Record health check results in Health checks, not in the notes.')).toBeTruthy()
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })

  it('says when the person may already be registered in this campaign, and never offers a Health ID link', async () => {
    api.createOutreachCase.mockResolvedValue({ ...pending('case-3', 'Kemi Balogun'), possibleDuplicate: true })
    await openNewRegistration()
    fillPerson()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(await screen.findByText('This may be someone already registered')).toBeTruthy()
    expect(screen.getByText('Their Health ID comes later')).toBeTruthy()
    expect(document.body.textContent).toContain('The person links their own Health ID to this registration later')
    expect(screen.queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  it('says Outreach’s refusal in plain words', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(422, 'x', { code: 'OUTREACH_CONSENT_GUARDIAN_REQUIRED' }))
    await openNewRegistration()
    fillPerson()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(await screen.findByText('This person is under 18. Enter the name of the parent or guardian who agreed.')).toBeTruthy()
  })

  it('never offers to save without the campaign when the campaign refuses: a group\'s registration needs its campaign', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_CAMPAIGN_CLOSED' }))
    await openNewRegistration()
    fillPerson()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Save without the campaign' })).toBeNull()
    expect(api.createOutreachCase).toHaveBeenCalledTimes(1)
  })
})

describe('the offline queue', () => {
  it('keeps a registration that could not be sent, with its command, and sends the same command when asked', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await openNewRegistration()
    fillPerson()
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
    await press(screen.getByRole('button', { name: 'Save registration' }))
    const queue = await screen.findByRole('region', { name: 'Saved on this device' })
    expect(within(queue).getByText('Kemi Balogun')).toBeTruthy()
    expect(within(queue).getByText('Waiting to send')).toBeTruthy()
    expect(document.body.textContent).toContain('No connection: Kemi Balogun’s registration is saved on this device.')
    const sent = api.createOutreachCase.mock.calls[0]!

    api.createOutreachCase.mockResolvedValueOnce(pending('case-4', 'Kemi Balogun'))
    await press(within(queue).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved on this device' })).toBeNull())
    const resent = api.createOutreachCase.mock.calls[1]!
    expect(resent[2]).toEqual(sent[2])
    expect(resent[1]).toEqual(sent[1])
  })

  it('shows a registration Health ID refused once sent, with what it said, until it is removed', async () => {
    const store = memoryQueueStore()
    await store.put({ localCommandId: 'c0000000-0000-4000-8000-000000000001', temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001',
      accountId: 'staff-demo-1', facilityId: GROUP_ID, savedAt: new Date().toISOString(), state: 'waiting',
      input: { campaignId: 'campaign-1', fullName: 'Ibrahim Musa', sex: 'male', ageYears: 61 } })
    setOutreachQueueStore(store)
    api.createOutreachCase.mockRejectedValue(new HidApiError(423, 'x', { code: 'OUTREACH_ORGANISER_SUSPENDED' }))
    renderDept(<Outreach />)
    const queue = await screen.findByRole('region', { name: 'Saved on this device' })
    expect(await within(queue).findByText('Not accepted')).toBeTruthy()
    expect(within(queue).getByText(/This outreach group has been paused by Health ID/)).toBeTruthy()
    await press(within(queue).getByRole('button', { name: 'Remove from this device' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved on this device' })).toBeNull())
    expect(await store.list()).toEqual([])
  })

  it('keeps a registration waiting when the session has ended (401), and sends it once signed in again', async () => {
    const store = memoryQueueStore()
    const entry = { localCommandId: 'c0000000-0000-4000-8000-000000000003', temporaryPatientId: 'tmp_c3', accountId: 'staff-demo-1',
      facilityId: GROUP_ID, savedAt: new Date().toISOString(), state: 'waiting' as const,
      input: { campaignId: 'campaign-1', fullName: 'Amaka Nwosu', sex: 'female', ageYears: 27 } }
    await store.put(entry)
    setOutreachQueueStore(store)
    api.createOutreachCase.mockRejectedValue(new HidApiError(401, 'x', { code: 'AUTHENTICATION_REQUIRED' }))
    const view = renderDept(<Outreach />)
    const queue = await screen.findByRole('region', { name: 'Saved on this device' })
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    await waitFor(async () => expect(await store.list()).toEqual([entry]))
    expect(within(queue).getByText('Waiting to send')).toBeTruthy()
    expect(within(queue).queryByText('Not accepted')).toBeNull()
    view.unmount()

    api.createOutreachCase.mockReset()
    api.createOutreachCase.mockResolvedValue(pending('case-5', 'Amaka Nwosu'))
    renderDept(<Outreach />)
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(api.createOutreachCase.mock.calls[0]![2]).toEqual({ localCommandId: entry.localCommandId, temporaryPatientId: entry.temporaryPatientId })
    await waitFor(async () => expect(await store.list()).toEqual([]))
  })

  it('never shows another account’s or another facility’s saved registrations', async () => {
    const store = memoryQueueStore()
    await store.put({ localCommandId: 'c0000000-0000-4000-8000-000000000002', temporaryPatientId: 'tmp_x', accountId: 'someone-else',
      facilityId: GROUP_ID, savedAt: new Date().toISOString(), state: 'waiting', input: { fullName: 'Not Mine', sex: 'male', ageYears: 40 } })
    setOutreachQueueStore(store)
    renderDept(<Outreach />)
    await screen.findByRole('list', { name: 'Campaigns' })
    expect(screen.queryByText('Not Mine')).toBeNull()
    expect(api.createOutreachCase).not.toHaveBeenCalled()
  })
})
