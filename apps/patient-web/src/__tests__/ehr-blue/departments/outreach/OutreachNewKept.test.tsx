import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { NEW_REGISTRATION_KEPT } from '../../../../ehr-blue/departments/outreach/OutreachNew'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { forgetOutreachTab, keepNewRegistration, keptNewRegistration, NEW_REGISTRATION_KEEP_MS } from '../../../../ehr-blue/departments/outreach/tabMemory'

/*
 * A New registration half typed at an outreach group is kept for the tab (sessionStorage, tabMemory.ts), so a reload,
 * or a tab the phone closed in the background mid-form, loses nothing: everything typed, the language, how the person
 * agreed and the guardian's name come back when New registration is opened again on the same account and facility. It
 * goes once the registration is saved (kept on this device or sent), on Cancel or Back, on sign-out, and an hour after
 * it was last changed. Never in localStorage. Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
const ACCOUNT = 'staff-demo-1'
const KEY = `hid-outreach:new-registration:${ACCOUNT}:${GROUP_ID}`
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.registration.read', 'outreach.registration.write'],
      { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: ['outreach_volunteer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(),
  outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const campaign = (id: string, name: string) => ({ id, name, status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 })
const CAMPAIGNS = [campaign('campaign-1', 'Ajegunle health week'), campaign('campaign-2', 'Ajegunle eye day')]
const member = (campaignId: string) => [{ id: `m-${campaignId}`, campaignId, membershipId: 'membership-demo-1', role: 'member', createdAt: '2026-11-01T00:00:00.000Z' }]
const created = { id: 'case-1', campaignId: 'campaign-2', status: 'identity_resolution_pending', fullName: 'Kemi Balogun', ageYears: 30, sex: 'female',
  temporaryPatientId: 'tmp_case-1', createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1 }

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  forgetOutreachServed()
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  vi.clearAllMocks()
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCampaigns.mockResolvedValue(CAMPAIGNS)
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => member(campaignId))
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'member', people: [] })
  api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
})
afterEach(() => {
  setOutreachQueueStore(null)
  // Nothing about the person ever goes in localStorage.
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/Kemi|Balogun|Bola|0803/)
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}
const textbox = (name: RegExp | string) => screen.getByRole('textbox', { name }) as HTMLInputElement
const ageBox = () => screen.getByRole('spinbutton', { name: /Age in years/ }) as HTMLInputElement
const select = (name: RegExp | string) => screen.getByRole('combobox', { name }) as HTMLSelectElement
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement

async function openNewRegistration() {
  renderDept(<Outreach />)
  await press(await screen.findByRole('button', { name: 'New registration' }))
  await screen.findByRole('heading', { level: 1, name: 'New registration' })
  await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle eye day' })).toBeTruthy())
}
/** The page goes and comes back in the same tab: what React held is lost, the tab's own storage is not. */
async function reloadAndReopen() {
  cleanup()
  await openNewRegistration()
}
function typeAge(age: string) {
  fireEvent.change(ageBox(), { target: { value: age } })
  fireEvent.blur(ageBox())
}
async function typeEverything(age = '30') {
  fireEvent.change(select(/Language the notice was given in/), { target: { value: 'yo' } })
  await press(radio(/They read it themselves and agreed/))
  fireEvent.change(textbox(/Full name/), { target: { value: 'Kemi Balogun' } })
  fireEvent.change(select(/^Sex/), { target: { value: 'female' } })
  typeAge(age)
  fireEvent.change(textbox(/Phone number/), { target: { value: '0803 123 4567' } })
  fireEvent.change(select(/^Campaign/), { target: { value: 'campaign-2' } })
  fireEvent.change(textbox(/Notes for the team/), { target: { value: 'Met at the market' } })
}
const keptKeys = () => Object.keys(sessionStorage).filter(key => key.includes('new-registration:'))

describe('a New registration half typed, at an outreach group', () => {
  it('comes back after a reload with everything typed, the language and how they agreed, and is saved as typed', async () => {
    await openNewRegistration()
    await typeEverything()
    expect(keptKeys()).toEqual([KEY])

    await reloadAndReopen()
    expect(screen.getByText(NEW_REGISTRATION_KEPT)).toBeTruthy()
    expect(textbox(/Full name/).value).toBe('Kemi Balogun')
    expect(select(/^Sex/).value).toBe('female')
    expect(ageBox().value).toBe('30')
    expect(textbox(/Phone number/).value).toBe('0803 123 4567')
    expect(select(/^Campaign/).value).toBe('campaign-2')
    expect(textbox(/Notes for the team/).value).toBe('Met at the market')
    expect(select(/Language the notice was given in/).value).toBe('yo')
    expect(radio(/They read it themselves and agreed/).checked).toBe(true)

    api.createOutreachCase.mockResolvedValueOnce(created)
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(api.createOutreachCase.mock.calls[0]![1]).toMatchObject({ fullName: 'Kemi Balogun', sex: 'female', ageYears: 30, phone: '0803 123 4567',
      campaignId: 'campaign-2', operationalNotes: 'Met at the market', consent: { language: 'yo', method: 'self_ticked' } })
    // Saved: nothing of it is kept, and the form opens empty next time.
    expect(await screen.findByText('Registration saved')).toBeTruthy()
    expect(keptKeys()).toEqual([])
  })

  it('keeps the parent or guardian for someone under 18, and the volunteer’s own choice comes back if the age is corrected (Q76)', async () => {
    await openNewRegistration()
    await typeEverything('15')
    fireEvent.change(textbox(/Parent or guardian’s name/), { target: { value: 'Bola Balogun' } })
    expect(radio(/Their parent or guardian agreed for them/).checked).toBe(true)

    await reloadAndReopen()
    expect(textbox(/Parent or guardian’s name/).value).toBe('Bola Balogun')
    expect(ageBox().value).toBe('15')
    // Under 18: only a parent or guardian can agree, as before the reload.
    expect(radio(/Their parent or guardian agreed for them/).checked).toBe(true)
    expect(radio(/They read it themselves and agreed/).disabled).toBe(true)
    expect(radio(/I read it to them and they said yes/).disabled).toBe(true)

    // The age corrected to an adult's: the volunteer's own choice before the reload comes back.
    typeAge('35')
    expect(radio(/They read it themselves and agreed/).checked).toBe(true)
    expect(radio(/They read it themselves and agreed/).disabled).toBe(false)
  })

  it('puts a kept campaign back once the campaigns are listed', async () => {
    await openNewRegistration()
    await typeEverything()
    // The reload's read of the campaigns' members is slow: the campaigns are listed only once it answers.
    const waiting: Array<() => void> = []
    api.outreachCampaignMembers.mockImplementation((_facilityId: string, campaignId: string) =>
      new Promise(resolve => { waiting.push(() => resolve(member(campaignId))) }))

    cleanup()
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: 'New registration' }))
    await screen.findByRole('heading', { level: 1, name: 'New registration' })
    expect(screen.queryByRole('option', { name: 'Ajegunle eye day' })).toBeNull()
    // A field typed meanwhile keeps the campaign not yet listed.
    fireEvent.change(textbox(/Full name/), { target: { value: 'Kemi A. Balogun' } })
    expect(JSON.parse(sessionStorage.getItem(KEY)!).fields).toMatchObject({ fullName: 'Kemi A. Balogun', campaignId: 'campaign-2' })

    await act(async () => { waiting.forEach(answer => answer()) })
    await waitFor(() => expect(select(/^Campaign/).value).toBe('campaign-2'))
  })

  it('goes on Cancel and on Back to list: the form opens empty again', async () => {
    for (const leave of ['Cancel', 'Back to list']) {
      await openNewRegistration()
      await typeEverything()
      expect(keptKeys()).toEqual([KEY])
      await press(screen.getByRole('button', { name: leave }))
      expect(keptKeys()).toEqual([])

      await reloadAndReopen()
      expect(screen.queryByText(NEW_REGISTRATION_KEPT)).toBeNull()
      expect(textbox(/Full name/).value).toBe('')
      expect(select(/Language the notice was given in/).value).toBe('en')
      expect(radio(/I read it to them and they said yes/).checked).toBe(true)
      cleanup()
    }
  })

  it('goes as soon as the registration is kept on this device while it is saving, so a reload can’t save the person twice', async () => {
    let answer: (value: unknown) => void = () => undefined
    api.createOutreachCase.mockImplementationOnce(() => new Promise(resolve => { answer = resolve }))
    await openNewRegistration()
    await typeEverything()
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(api.createOutreachCase).toHaveBeenCalledTimes(1))
    expect(keptKeys()).toEqual([])
    await act(async () => { answer(created) })
    expect(await screen.findByText('Registration saved')).toBeTruthy()
    expect(keptKeys()).toEqual([])
  })

  it('goes once a registration with no signal is kept on this device', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await openNewRegistration()
    await typeEverything()
    await press(screen.getByRole('button', { name: 'Save registration' }))
    expect(await screen.findByRole('region', { name: 'Saved on this device' })).toBeTruthy()
    expect(keptKeys()).toEqual([])
  })

  it('is kept again when Health ID sends the registration back to correct, everything typed still on the form', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(422, 'Unprocessable', { code: 'VALIDATION_FAILED' }))
    await openNewRegistration()
    await typeEverything()
    await press(screen.getByRole('button', { name: 'Save registration' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save registration' })).toBeTruthy())
    await waitFor(() => expect(keptKeys()).toEqual([KEY]))
    await reloadAndReopen()
    expect(textbox(/Full name/).value).toBe('Kemi Balogun')
  })

  it('keeps nothing when nothing is typed', async () => {
    await openNewRegistration()
    await reloadAndReopen()
    expect(keptKeys()).toEqual([])
    expect(screen.queryByText(NEW_REGISTRATION_KEPT)).toBeNull()
  })

  it('never comes back for another account or facility, or an hour after it was last changed', async () => {
    const draft = { fields: { fullName: 'Kemi Balogun' }, language: 'en', chosenMethod: 'verbal_read_aloud' }
    keepNewRegistration('someone-else', GROUP_ID, draft)
    keepNewRegistration(ACCOUNT, 'another-group', draft)
    await openNewRegistration()
    expect(textbox(/Full name/).value).toBe('')
    cleanup()

    const now = Date.now()
    keepNewRegistration(ACCOUNT, GROUP_ID, draft, now - NEW_REGISTRATION_KEEP_MS - 1)
    expect(keptNewRegistration(ACCOUNT, GROUP_ID, now)).toBeNull()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    keepNewRegistration(ACCOUNT, GROUP_ID, draft, now - NEW_REGISTRATION_KEEP_MS - 1)
    await openNewRegistration()
    expect(textbox(/Full name/).value).toBe('')
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('is removed on sign-out with everything else outreach kept for this tab', async () => {
    await openNewRegistration()
    await typeEverything()
    expect(keptKeys()).toEqual([KEY])
    forgetOutreachTab()
    expect(keptKeys()).toEqual([])
  })
})
