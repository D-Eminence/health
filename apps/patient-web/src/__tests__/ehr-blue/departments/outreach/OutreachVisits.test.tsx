import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { DEMO_HOSPITAL_ID, renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { forgetOutreachVisitsServed, learnOutreachVisitsServed, outreachVisitsServed } from '../../../../ehr-blue/departments/outreach/outreachVisitsServed'
import { lagosToday, visitKindText } from '../../../../ehr-blue/departments/outreach/outreachParts'

/*
 * Outreach follow-up visits, member names and linking by Health ID (hid-system 0115, behind OUTREACH_VISITS_ENABLED).
 * Dormant until a case answer carries a numeric visitCount: until then every screen sends exactly today's requests and
 * says exactly today's words. Fictional data.
 */

const session = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext, DEMO_HOSPITAL_ID: hospital } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(session.permissions, { id: hospital, name: 'Demo Hospital', roles: ['outreach_officer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(), lookupPatient: vi.fn(),
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

const visitsApi = vi.hoisted(() => ({ listCaseVisits: vi.fn(), createCaseVisit: vi.fn(), previewLink: vi.fn(), linkByHealthId: vi.fn() }))
vi.mock('../../../../ehr-blue/departments/outreach/outreachVisitsApi', async original => ({
  ...await original<Record<string, unknown>>(),
  outreachVisitsApi: visitsApi,
}))

const ALL = ['outreach.campaign.read', 'outreach.registration.read', 'outreach.campaign.write', 'outreach.registration.write']
const MEMBERSHIP = 'membership-demo-1'
const CAMPAIGNS = [{ id: 'campaign-1', name: 'Demo screening week', status: 'active', services: ['registration'], startsAt: '2026-01-01T00:00:00.000Z', rowVersion: 1 }]

const CASE_ID = 'c0a5e000-0000-4000-8000-000000000001'
const baseCase = {
  id: CASE_ID, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Patient One', ageYears: 34, sex: 'female',
  temporaryPatientId: 'tmp_c0000000-0000-4000-8000-000000000001', createdAt: '2026-10-12T09:00:00.000Z', rowVersion: 3,
  phone: '+2348000000001', operationalNotes: null,
}
/** 0115's fields without visitCount: still not served. */
const withFieldsOnly = { ...baseCase, createdBy: { name: 'Officer Demo' }, campaignName: 'Demo screening week', nextFollowUpOn: '2025-11-12' }
const servedCase = { ...withFieldsOnly, visitCount: 2 }

const VISITS = [
  { id: 'v0000000-0000-4000-8000-000000000001', registrationCaseId: CASE_ID, kind: 'visit', occurredOn: '2025-10-01', followUpOn: null,
    referredTo: null, notes: null, recordedByMembershipId: MEMBERSHIP, createdAt: '2025-10-01T10:00:00.000Z' },
  { id: 'v0000000-0000-4000-8000-000000000002', registrationCaseId: CASE_ID, kind: 'referral', occurredOn: '2025-10-20', followUpOn: '2025-11-12',
    referredTo: 'Demo General Hospital', notes: 'Blood pressure high on two readings.', recordedByMembershipId: MEMBERSHIP, createdAt: '2025-10-20T10:00:00.000Z' },
]

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const HID = 'HID-ZDEMAAA2'
const PREVIEW = { patient: { fullName: 'Patient One Demo', dateOfBirth: '1992-03-04', healthIdLast4: 'AAA2' }, canLink: true }

let setItem: ReturnType<typeof vi.spyOn>
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  forgetOutreachVisitsServed()
  session.permissions = ALL
  api.outreachCampaigns.mockResolvedValue(CAMPAIGNS)
  api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) =>
    [{ id: `${campaignId}-member`, campaignId, membershipId: MEMBERSHIP, role: 'health_worker', createdAt: '2026-01-02T00:00:00.000Z', displayName: 'Officer Demo' }])
  api.outreachCases.mockResolvedValue([servedCase])
  api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow' }, patient: { patientId: PATIENT, hid: HID, fullName: 'Patient One Demo', dateOfBirth: '1992-03-04' } })
  visitsApi.listCaseVisits.mockResolvedValue(VISITS)
  visitsApi.createCaseVisit.mockImplementation(async (_f: string, _c: string, input: object) => ({ id: 'v-new', registrationCaseId: CASE_ID, ...input }))
  visitsApi.previewLink.mockResolvedValue(PREVIEW)
  visitsApi.linkByHealthId.mockResolvedValue({ ...servedCase, status: 'identity_resolved', rowVersion: 4 })
  setItem = vi.spyOn(Storage.prototype, 'setItem')
  fetchSpy = vi.fn(() => Promise.reject(new Error('No request leaves a test.')))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect([...unprovided]).toEqual([])
  expect(setItem).not.toHaveBeenCalled()
  expect(fetchSpy).not.toHaveBeenCalled()
  expect(document.cookie).toBe('')
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const casesList = () => screen.findByRole('list', { name: 'Registrations' })
const card = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name: new RegExp(`^${name}(?![0-9])`) })
async function openCase() {
  renderDept(<Outreach />)
  await press(card(await casesList(), 'Patient One'))
}
const visitsSection = () => screen.getByRole('heading', { name: 'Visits and follow-ups' }).closest('section') as HTMLElement
const visitForm = () => screen.getByRole('form', { name: 'Record a visit' }) as HTMLFormElement
const describedBy = (control: HTMLElement) => document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent
const NEW_WORDS = /Visits and follow-ups|Record a visit|Registered by|Next follow-up|No visits yet|Officer Demo|ends in/

async function fillLink(healthId = HID, reason = 'Same name, age and phone') {
  const form = screen.getByRole('form', { name: 'Link existing patient' })
  fireEvent.change(within(form).getByLabelText(/^Health ID/), { target: { value: healthId } })
  fireEvent.change(within(form).getByLabelText(/^How you know/), { target: { value: reason } })
  await press(within(form).getByRole('button', { name: 'Link existing patient' }))
  return form
}
const linkOpener = () => screen.getByRole('button', { name: 'Link existing patient', expanded: false })

describe('before the backend serves visits (dormant)', () => {
  it('sends only today’s requests and shows only today’s words, even with 0115’s other fields', async () => {
    api.outreachCases.mockResolvedValue([withFieldsOnly])
    await openCase()
    expect(outreachVisitsServed()).toBe(false)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Patient One')
    expect(document.body.textContent).not.toMatch(NEW_WORDS)
    expect(screen.queryByRole('button', { name: 'Record a visit' })).toBeNull()
    // The registration's facts are today's, in today's order.
    const registration = screen.getByRole('heading', { name: 'Registration' }).parentElement!.parentElement!.parentElement!.parentElement as HTMLElement
    expect(within(registration).getAllByRole('term').map(term => term.textContent))
      .toEqual(['Full name', 'Age', 'Sex', 'Phone number', 'Status', 'Temporary patient ID', 'Campaign', 'Created', 'Notes for the team'])
    for (const call of Object.values(visitsApi)) expect(call).not.toHaveBeenCalled()
  })

  it('links by today’s lookup and patient ID, never the preview', async () => {
    api.outreachCases.mockResolvedValue([baseCase])
    api.linkExistingOutreachCase.mockResolvedValue({ ...baseCase, status: 'identity_resolved', rowVersion: 4 })
    await openCase()
    await press(linkOpener())
    await fillLink()
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, HID))
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the link' })
    expect(sheet.textContent).toContain(`Health ID checked: ${HID}.`)
    await press(within(sheet).getByRole('button', { name: 'Link patient' }))
    await waitFor(() => expect(api.linkExistingOutreachCase).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, baseCase, PATIENT, 'Same name, age and phone'))
    expect(visitsApi.previewLink).not.toHaveBeenCalled()
    expect(visitsApi.linkByHealthId).not.toHaveBeenCalled()
  })

  it('shows campaign members as today does, and no follow-up date on the card', async () => {
    api.outreachCases.mockResolvedValue([withFieldsOnly])
    renderDept(<Outreach />)
    const list = await casesList()
    expect(list.textContent).not.toMatch(/Next follow-up/)
    await press(within(await screen.findByRole('list', { name: 'Campaigns' })).getByRole('button', { name: /^Demo screening week/ }))
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(await within(members).findByText('Team member')).toBeTruthy()
    expect(members.textContent).not.toContain('Officer Demo')
  })
})

describe('learning that visits are served', () => {
  it('is learned only from a numeric visitCount, and stays learned', () => {
    learnOutreachVisitsServed([{ visitCount: '2' }, { visitCount: null }, {}])
    expect(outreachVisitsServed()).toBe(false)
    learnOutreachVisitsServed([{ visitCount: 0 }])
    expect(outreachVisitsServed()).toBe(true)
    learnOutreachVisitsServed([{}])
    expect(outreachVisitsServed()).toBe(true)
  })

  it('says each kind in words, never its code', () => {
    expect(visitKindText('visit')).toBe('Visit')
    expect(visitKindText('referral')).toBe('Referral')
    expect(visitKindText('follow_up')).toBe('Follow-up')
    expect(visitKindText('something_new')).toBe('Visit')
  })
})

describe('once served: the list and the case', () => {
  it('shows the next follow-up on the card, never the phone number', async () => {
    renderDept(<Outreach />)
    const list = await casesList()
    expect(await within(list).findByText('Next follow-up 12 Nov 2025')).toBeTruthy()
    expect(list.textContent).not.toContain('+2348000000001')
  })

  it('names who registered the case and its campaign, and lists its visits newest first in words', async () => {
    await openCase()
    expect(screen.getByText('Registered by Officer Demo')).toBeTruthy()
    expect(screen.getAllByText('Demo screening week').length).toBeGreaterThan(0)
    const section = visitsSection()
    const list = await within(section).findByRole('list', { name: 'Visits and follow-ups' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual([
      'Referral 20 Oct 2025Referred to Demo General HospitalNext follow-up 12 Nov 2025Blood pressure high on two readings.',
      'Visit 1 Oct 2025',
    ])
    expect(visitsApi.listCaseVisits).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE_ID)
    // Never an id, a kind's code, or who recorded it.
    expect(document.body.textContent).not.toMatch(/v0000000|membership-demo|follow_up|referral\b/)
  })

  it('says when there are no visits yet', async () => {
    visitsApi.listCaseVisits.mockResolvedValue([])
    await openCase()
    expect(await within(visitsSection()).findByText('No visits yet')).toBeTruthy()
    expect(within(visitsSection()).getByText('Visits, referrals and follow-ups recorded for this person show here.')).toBeTruthy()
  })

  it('says when visits cannot be loaded, and tries again', async () => {
    visitsApi.listCaseVisits.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'SERVICE_UNAVAILABLE' })).mockResolvedValue(VISITS)
    await openCase()
    const alert = await within(visitsSection()).findByText('Couldn’t load visits and follow-ups')
    expect(alert).toBeTruthy()
    expect(visitsSection().textContent).not.toMatch(/SERVICE_UNAVAILABLE|503/)
    await press(within(visitsSection()).getByRole('button', { name: 'Try again' }))
    expect(await within(visitsSection()).findByRole('list', { name: 'Visits and follow-ups' })).toBeTruthy()
    expect(visitsApi.listCaseVisits).toHaveBeenCalledTimes(2)
  })

  it('says a case that is gone in plain words', async () => {
    visitsApi.listCaseVisits.mockRejectedValue(new HidApiError(404, 'x', { code: 'OUTREACH_REGISTRATION_NOT_FOUND' }))
    await openCase()
    expect(await within(visitsSection()).findByText('This registration is no longer here. It may have been removed. Go back to the list.')).toBeTruthy()
    expect(visitsSection().textContent).not.toContain('OUTREACH_')
  })

  it('names campaign members by their staff name, and “Team member” when none is given', async () => {
    api.outreachCampaignMembers.mockImplementation(async (_facilityId: string, campaignId: string) => [
      { id: 'm1', campaignId, membershipId: MEMBERSHIP, role: 'health_worker', createdAt: '2026-01-02T00:00:00.000Z', displayName: 'Officer Demo' },
      { id: 'm2', campaignId, membershipId: 'membership-demo-9', role: 'enumerator', createdAt: '2026-01-02T00:00:00.000Z', displayName: null },
    ])
    renderDept(<Outreach />)
    await casesList()
    await waitFor(() => expect(outreachVisitsServed()).toBe(true))
    await press(within(await screen.findByRole('list', { name: 'Campaigns' })).getByRole('button', { name: /^Demo screening week/ }))
    const members = screen.getByRole('heading', { name: 'Members' }).closest('section') as HTMLElement
    expect(await within(members).findByText('Officer Demo')).toBeTruthy()
    expect(within(members).getByText('Team member')).toBeTruthy()
  })
})

describe('once served: recording a visit', () => {
  async function openForm() {
    await openCase()
    await within(visitsSection()).findByRole('list', { name: 'Visits and follow-ups' })
    await press(within(visitsSection()).getByRole('button', { name: 'Record a visit' }))
    return visitForm()
  }

  it('opens with its first field focused, today in Lagos filled in, and Referred to only for a referral', async () => {
    const form = await openForm()
    const kind = within(form).getByLabelText(/^Type/) as HTMLSelectElement
    await waitFor(() => expect(document.activeElement).toBe(kind))
    expect([...kind.options].map(option => option.textContent)).toEqual(['Visit', 'Referral', 'Follow-up'])
    expect((within(form).getByLabelText(/^Date/) as HTMLInputElement).value).toBe(lagosToday())
    expect((within(form).getByLabelText(/^Date/) as HTMLInputElement).max).toBe(lagosToday())
    expect(within(form).queryByLabelText(/^Referred to/)).toBeNull()
    fireEvent.change(kind, { target: { value: 'referral' } })
    expect(within(form).getByLabelText(/^Referred to/)).toBeTruthy()
    expect(within(form).getByLabelText(/^Next follow-up date/)).toBeTruthy()
    expect(within(form).getByLabelText(/^Notes/)).toBeTruthy()
  })

  it('sends the visit with a key, says it was recorded, and reads the visits and the cases again', async () => {
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText(/^Type/), { target: { value: 'referral' } })
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '2025-10-30' } })
    fireEvent.change(within(form).getByLabelText(/^Next follow-up date/), { target: { value: '2025-11-20' } })
    fireEvent.change(within(form).getByLabelText(/^Referred to/), { target: { value: ' Demo Eye Clinic ' } })
    fireEvent.change(within(form).getByLabelText(/^Notes/), { target: { value: ' Needs glasses. ' } })
    const casesRead = api.outreachCases.mock.calls.length
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    await waitFor(() => expect(visitsApi.createCaseVisit).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE_ID,
      { kind: 'referral', occurredOn: '2025-10-30', followUpOn: '2025-11-20', referredTo: 'Demo Eye Clinic', notes: 'Needs glasses.' }, expect.any(String)))
    expect(await within(visitsSection()).findByText('Referral recorded.')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Record a visit' })).toBeNull()
    await waitFor(() => expect(visitsApi.listCaseVisits).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.outreachCases.mock.calls.length).toBeGreaterThan(casesRead))
    await waitFor(() => expect(document.activeElement).toBe(within(visitsSection()).getByRole('button', { name: 'Record a visit' })))
  })

  it('sends a visit sent again unchanged with the same key, and a changed one with a new key', async () => {
    visitsApi.createCaseVisit.mockRejectedValue(new HidApiError(0, 'x', { code: 'NETWORK_ERROR', retryable: true }))
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '2025-10-30' } })
    const save = within(form).getByRole('button', { name: 'Save visit' })
    await press(save)
    await waitFor(() => expect(visitsApi.createCaseVisit).toHaveBeenCalledTimes(1))
    expect(await within(form).findByText('Correct the issue or retry using the same button. No success is reported until saved.')).toBeTruthy()
    await press(save)
    await waitFor(() => expect(visitsApi.createCaseVisit).toHaveBeenCalledTimes(2))
    fireEvent.change(within(form).getByLabelText(/^Notes/), { target: { value: 'Seen at home.' } })
    await press(save)
    await waitFor(() => expect(visitsApi.createCaseVisit).toHaveBeenCalledTimes(3))
    const keys = visitsApi.createCaseVisit.mock.calls.map(call => call[3])
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('checks the dates before sending anything', async () => {
    const form = await openForm()
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '2025-10-30' } })
    fireEvent.change(within(form).getByLabelText(/^Next follow-up date/), { target: { value: '2025-10-30' } })
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    const followUp = within(form).getByLabelText(/^Next follow-up date/)
    await waitFor(() => expect(document.activeElement).toBe(followUp))
    expect(describedBy(followUp)).toBe('Choose a date after the date it happened, or leave this blank.')
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '2019-12-31' } })
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    expect(describedBy(within(form).getByLabelText(/^Date/))).toBe('Enter a date from 1 Jan 2020 onwards.')
    fireEvent.change(within(form).getByLabelText(/^Date/), { target: { value: '' } })
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    expect(describedBy(within(form).getByLabelText(/^Date/))).toBe('Enter the date it happened.')
    expect(visitsApi.createCaseVisit).not.toHaveBeenCalled()
  })

  it('says each field Outreach refused at that field, in plain words', async () => {
    visitsApi.createCaseVisit.mockRejectedValue(new HidApiError(400, 'x', { code: 'VALIDATION_FAILED',
      details: [{ field: 'notes', messages: ['notes must be shorter than or equal to 1000 characters'] }] }))
    const form = await openForm()
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    const notes = within(form).getByLabelText(/^Notes/)
    await waitFor(() => expect(describedBy(notes)).toBe('Use 1000 characters or fewer.'))
    expect(document.activeElement).toBe(notes)
    expect(form.textContent).not.toMatch(/VALIDATION|notes must/)
  })

  it('says a case that is gone when the visit is refused for it', async () => {
    visitsApi.createCaseVisit.mockRejectedValue(new HidApiError(404, 'x', { code: 'OUTREACH_REGISTRATION_NOT_FOUND' }))
    const form = await openForm()
    await press(within(form).getByRole('button', { name: 'Save visit' }))
    expect(await within(form).findByText('This registration is no longer here. It may have been removed. Go back to the list.')).toBeTruthy()
  })

  it('offers no Record a visit without registration write', async () => {
    session.permissions = ['outreach.campaign.read', 'outreach.registration.read']
    await openCase()
    await within(visitsSection()).findByRole('list', { name: 'Visits and follow-ups' })
    expect(screen.queryByRole('button', { name: 'Record a visit' })).toBeNull()
  })
})

describe('once served: linking by Health ID', () => {
  async function openLink() {
    await openCase()
    await press(linkOpener())
  }

  it('previews the person by name, date of birth and the last four of the Health ID, then links by the Health ID', async () => {
    await openLink()
    await fillLink(' hid-zdemaaa2 ')
    await waitFor(() => expect(visitsApi.previewLink).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, CASE_ID, HID))
    const sheet = await screen.findByRole('dialog', { name: 'Confirm the link' })
    expect(sheet.textContent).toContain('Link this registration to the Health ID record of Patient One Demo, born 4 Mar 1992? Check it is the same person. Their Health ID ends in AAA2.')
    expect(sheet.textContent).not.toContain(HID)
    await press(within(sheet).getByRole('button', { name: 'Link patient' }))
    await waitFor(() => expect(visitsApi.linkByHealthId).toHaveBeenCalledWith(DEMO_HOSPITAL_ID, servedCase, HID, 'Same name, age and phone', expect.any(String)))
    expect(await screen.findByRole('heading', { name: 'Patient linked' })).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(api.linkExistingOutreachCase).not.toHaveBeenCalled()
  })

  it('says plainly when the person must share their record first, and offers no Link', async () => {
    visitsApi.previewLink.mockResolvedValue({ ...PREVIEW, canLink: false })
    await openLink()
    const form = await fillLink()
    const field = within(form).getByLabelText(/^Health ID/)
    await waitFor(() => expect(describedBy(field)).toBe('To link this registration, the person needs to share their record with your facility for care. A PIN only lets you view their record, not link it.'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link patient' })).toBeNull()
    expect(visitsApi.linkByHealthId).not.toHaveBeenCalled()
  })

  it.each([
    [new HidApiError(404, 'x', { code: 'OUTREACH_HEALTH_ID_NOT_FOUND' }), 'No one has this Health ID. Check it with them and try again.'],
    [new HidApiError(403, 'x', { code: 'OUTREACH_PATIENT_ACCESS_REQUIRED' }), 'You can’t open this person’s record yet. Ask them to share their record with you, or approve your access request.'],
    [new HidApiError(429, 'x', { code: 'OUTREACH_HEALTH_ID_LIMIT' }), 'You’ve checked a lot of Health IDs in the last hour. Try again later.'],
  ])('says a refused preview at the Health ID field in plain words (%#)', async (refusal, words) => {
    visitsApi.previewLink.mockRejectedValue(refusal)
    await openLink()
    const form = await fillLink()
    await waitFor(() => expect(describedBy(within(form).getByLabelText(/^Health ID/))).toBe(words))
    expect(document.body.textContent).not.toMatch(/OUTREACH_|429|403/)
  })

  it.each([
    [new HidApiError(409, 'x', { code: 'OUTREACH_REGISTRATION_ALREADY_RESOLVED' }), 'This registration has already been linked or closed. The case has been read again.'],
    [new HidApiError(412, 'x', { code: 'VERSION_CONFLICT' }), 'Someone changed this registration just now. It has been read again: check it, then try again.'],
  ])('reads the case again after a link refused as already resolved or out of date (%#)', async (refusal, words) => {
    visitsApi.linkByHealthId.mockRejectedValue(refusal)
    await openLink()
    await fillLink()
    await press(within(await screen.findByRole('dialog', { name: 'Confirm the link' })).getByRole('button', { name: 'Link patient' }))
    expect(await screen.findByText(words)).toBeTruthy()
    await waitFor(() => expect(api.outreachCases).toHaveBeenCalledTimes(2))
    expect(document.body.textContent).not.toMatch(/OUTREACH_|VERSION_CONFLICT/)
  })

  it('sends a link sent again after a lost answer with the same key, and a new key once the link is settled', async () => {
    visitsApi.linkByHealthId
      .mockRejectedValueOnce(new HidApiError(0, 'x', { code: 'NETWORK_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_REGISTRATION_ALREADY_RESOLVED' }))
    await openLink()
    const linkOnce = async () => {
      await fillLink()
      await press(within(await screen.findByRole('dialog', { name: 'Confirm the link' })).getByRole('button', { name: 'Link patient' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    }
    await linkOnce()
    await waitFor(() => expect(visitsApi.linkByHealthId).toHaveBeenCalledTimes(1))
    await linkOnce()
    await waitFor(() => expect(visitsApi.linkByHealthId).toHaveBeenCalledTimes(2))
    await linkOnce()
    await waitFor(() => expect(visitsApi.linkByHealthId).toHaveBeenCalledTimes(3))
    const keys = visitsApi.linkByHealthId.mock.calls.map(call => call[4] as string)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('says a link refused for want of a share for care at the Health ID field', async () => {
    visitsApi.linkByHealthId.mockRejectedValue(new HidApiError(403, 'x', { code: 'OUTREACH_PATIENT_ACCESS_REQUIRED' }))
    await openLink()
    const form = await fillLink()
    await press(within(await screen.findByRole('dialog', { name: 'Confirm the link' })).getByRole('button', { name: 'Link patient' }))
    await waitFor(() => expect(describedBy(within(form).getByLabelText(/^Health ID/)))
      .toBe('To link this registration, the person needs to share their record with your facility for care. A PIN only lets you view their record, not link it.'))
  })
})
