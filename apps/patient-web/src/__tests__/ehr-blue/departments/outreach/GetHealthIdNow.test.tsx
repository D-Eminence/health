import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { forgetOutreachServed } from '../../../../ehr-blue/departments/outreach/outreachServed'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { QrCode } from '../../../../mfa/OtpauthQr'
import { patientSignUpHref } from '../../../../productSites'
import { LINKS_LATER } from '../../../../ehr-blue/departments/outreach/outreachGroup'

/*
 * "Get a Health ID now": after a registration is saved, on its case view, and while a registration waits on this device,
 * the patient sign-up as a QR code and a link, with nothing about the person in either. Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return {
    useStaff: () => staffContext(fakeFacility(['outreach.campaign.read', 'outreach.campaign.write', 'outreach.registration.read',
      'outreach.registration.write'], { id: '0e7c0000-0000-4000-8000-000000000001', name: 'Ajegunle Health Volunteers', roles: ['outreach_volunteer'] })),
  }
})

const api = vi.hoisted(() => ({
  outreachCampaigns: vi.fn(), outreachCampaignMembers: vi.fn(), outreachCases: vi.fn(), outreachCasesPage: vi.fn(), outreachScreening: vi.fn(), createOutreachCase: vi.fn(),
  linkExistingOutreachCase: vi.fn(), outreachCampaignGovernance: vi.fn(), outreachCampaignStaff: vi.fn(),
  outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn(), createUnverifiedOutreachHealthId: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const SIGN_UP = 'https://app.healthidentitydirectory.com/enroll'
const NAME = 'Kemi Balogun'
const PHONE = '08031234567'
const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const pending = (id: string) => ({ id, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: NAME, ageYears: 30, sex: 'female',
  phone: PHONE, temporaryPatientId: `tmp_${id}`, createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1 })

beforeEach(() => {
  // What Outreach serves is remembered for the session (outreachServed.ts): each test starts knowing nothing.
  forgetOutreachServed()
  // The list's first read (hid-system#247) is today's request; an Outreach before paging answers it with no cursor.
  api.outreachCasesPage.mockImplementation(async (facilityId: string) => ({ items: await api.outreachCases(facilityId), nextCursor: null }))
  vi.clearAllMocks()
  // Today's Outreach serves no health checks (0118): the section is not shown.
  api.outreachScreening.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'API_ROUTE_NOT_FOUND' }))
  setOutreachQueueStore(memoryQueueStore())
  api.outreachCampaigns.mockResolvedValue([CAMPAIGN])
  api.outreachCases.mockResolvedValue([])
  api.outreachCampaignGovernance.mockResolvedValue({ rule: 'campaign_admins', organiserStatus: 'unverified' })
  api.outreachCampaignMembers.mockResolvedValue([{ id: 'm-1', campaignId: 'campaign-1', membershipId: 'membership-demo-1', role: 'member', createdAt: '2026-11-01T00:00:00.000Z' }])
  api.outreachCampaignStaff.mockResolvedValue({ yourRole: 'member', people: [] })
  api.outreachInvitations.mockResolvedValue({ members: [], invitations: [] })
})
afterEach(() => { setOutreachQueueStore(null) })

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}

async function register(age = '30') {
  renderDept(<Outreach />)
  await press(await screen.findByRole('button', { name: 'New registration' }))
  await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
  fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: NAME } })
  fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: age } })
  fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: PHONE } })
  if (Number(age) < 18) {
    await press(screen.getByRole('radio', { name: /Their parent or guardian agreed for them/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /Parent or guardian’s name/ }), { target: { value: 'Tunde Balogun' } })
  } else {
    await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
  }
  await press(screen.getByRole('button', { name: 'Save registration' }))
}

const CANT_CREATE = 'They own their Health ID. Your team can’t create it for them.'
const OPEN_WHEN_SENT = 'Once this registration is sent, open it to create their Health ID.'

/** The panel's region, its link and its QR code, checked the same way wherever it is shown. */
function expectPanel(region: HTMLElement, { queued = false } = {}) {
  expect(within(region).getByRole('heading', { level: 2, name: 'Get a Health ID now' })).toBeTruthy()
  // The public sign-up needs an email address: said before anyone pulls out a phone.
  expect(region.textContent).toContain('If they have a phone with internet and an email address, they can get their own Health ID before they leave.')
  // No link that opens sign-up on the volunteer's own (signed-in) device: the person would type their password there.
  expect(within(region).queryByRole('link', { name: /sign-up/i })).toBeNull()
  expect(region.textContent).toContain('Don’t open sign-up on yours')
  const qr = within(region).getByRole('img', { name: 'QR code that opens the Health ID sign-up page' })
  // The QR code is drawn from exactly the sign-up address: the same modules as a QR code of that address alone.
  const reference = render(<QrCode text={SIGN_UP} label="reference" />)
  expect(qr.querySelector('path')!.getAttribute('d')).toBe(reference.container.querySelector('path')!.getAttribute('d'))
  reference.unmount()
  const steps = within(region).getAllByRole('listitem').map(item => item.textContent)
  expect(steps).toEqual([
    'Scan with their phone camera.',
    'They enter their name, email address and phone number, choose a password, and type in the code sent to their email.',
    'Their Health ID appears on screen. Write it on their slip.',
  ])
  // Waiting on this device, it is an outreach group's registration: once sent, the team can make the Health ID there.
  if (queued) {
    expect(region.textContent).toContain(OPEN_WHEN_SENT)
    expect(region.textContent).not.toContain('Your team can’t create it for them.')
  } else {
    expect(region.textContent).toContain(CANT_CREATE)
    expect(region.textContent).not.toContain(OPEN_WHEN_SENT)
  }
}

describe('Get a Health ID now', () => {
  it('shows after a registration is saved, with the sign-up as a QR code and a link', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-1'))
    await register()
    expect(await screen.findByText('Registration saved')).toBeTruthy()
    expectPanel(screen.getByRole('region', { name: 'Get a Health ID now' }))
  })

  it('is on the case view opened later from the list', async () => {
    api.outreachCases.mockResolvedValue([pending('case-2')])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expectPanel(screen.getByRole('region', { name: 'Get a Health ID now' }))
  })

  it('is not shown once the registration is resolved', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-3'), status: 'resolved_existing_patient' }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: /^Linked/ }))
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
  })

  it('shows while a registration waits on this device for signal', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await register()
    await screen.findByRole('region', { name: 'Saved on this device' })
    expectPanel(screen.getByRole('region', { name: 'Get a Health ID now' }), { queued: true })
  })

  it('goes, with the note, once the registration waiting on this device is sent', async () => {
    api.createOutreachCase.mockRejectedValueOnce(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await register()
    const queue = await screen.findByRole('region', { name: 'Saved on this device' })
    expect(screen.getByRole('region', { name: 'Get a Health ID now' }).textContent).toContain(OPEN_WHEN_SENT)
    api.createOutreachCase.mockResolvedValueOnce(pending('case-sent'))
    await press(within(queue).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Saved on this device' })).toBeNull())
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
    expect(document.body.textContent).not.toContain(OPEN_WHEN_SENT)
  })

  it('carries nothing about the person: not their name, phone number, temporary ID or case', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-4'))
    await register()
    const region = await screen.findByRole('region', { name: 'Get a Health ID now' })
    const url = new URL(SIGN_UP)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    // The QR code is drawn from exactly the sign-up address (expectPanel), so it carries nothing about the person.
    expectPanel(region)
    for (const personal of [NAME, PHONE, 'tmp_case-4', 'case-4', 'campaign-1', GROUP_ID]) expect(SIGN_UP).not.toContain(personal)
  })
})

describe('the sign-up as the fallback', () => {
  it('is a small “Or, instead, they can sign up on their own phone” where the team can create the Health ID, saying to use one way only', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-5'), healthId: null }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
    const summary = screen.getByText('Or, instead, they can sign up on their own phone')
    const details = summary.closest('details')!
    expect(details.textContent).toContain('Use one way only: if they sign up on their phone, don’t press Create Health ID.')
    expect(within(details).queryByRole('link', { name: /sign-up/i, hidden: true })).toBeNull()
    expect(within(details).getByRole('img', { name: 'QR code that opens the Health ID sign-up page', hidden: true })).toBeTruthy()
    expect(details.textContent).not.toContain('Your team can’t create it for them.')
  })

  it('is not shown once the registration has a Health ID', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-6'), healthId: 'HID-ABC123' }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.queryByText(/they can sign up on their own phone/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
  })

  it('goes once a Health ID is made in this view, before the list is read again', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-7'), healthId: null }])
    api.createUnverifiedOutreachHealthId.mockResolvedValue({ healthId: 'HID-UNVER7', claimCode: 'K7Q-4MZ',
      registration: { ...pending('case-7'), healthId: 'HID-UNVER7' } })
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.getByText(/they can sign up on their own phone/)).toBeTruthy()
    const region = screen.getByRole('region', { name: 'Create Health ID' })
    await press(within(region).getByRole('checkbox', { name: /They want a Health ID/ }))
    await press(within(region).getByRole('radio', { name: /No email/ }))
    await press(within(region).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region).findByText('K7Q-4MZ')).toBeTruthy()
    expect(screen.queryByText(/they can sign up on their own phone/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
  })

  it('leaves out “use one way only” for under-18s, for whom Create Health ID is not offered', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-8'), ageYears: 15, healthId: null }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    const details = screen.getByText(/they can sign up on their own phone/).closest('details')!
    expect(details.textContent).not.toContain('Use one way only')
  })
})

const GUARDIAN_WORDS = 'A parent or guardian must agree. They can make it with them on their phone, now or later.'
const CHILD_STEP = 'They enter their name, email address and phone number, choose a password, and type in the code sent to their email.'

describe('under-18s and the sign-up QR code', () => {
  async function openCase(item: Record<string, unknown>) {
    api.outreachCases.mockResolvedValue([item])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
  }

  it('at 17, says a parent or guardian must agree instead of steps addressed to the child, and keeps the QR code', async () => {
    await openCase({ ...pending('case-17'), ageYears: 17 })
    const region = screen.getByRole('region', { name: 'Get a Health ID now' })
    expect(region.textContent).toContain(GUARDIAN_WORDS)
    expect(region.textContent).not.toContain(CHILD_STEP)
    expect(within(region).queryAllByRole('listitem')).toEqual([])
    expect(within(region).getByRole('img', { name: 'QR code that opens the Health ID sign-up page' })).toBeTruthy()
  })

  it('at 18, shows the steps as for any adult', async () => {
    await openCase({ ...pending('case-18'), ageYears: 18 })
    const region = screen.getByRole('region', { name: 'Get a Health ID now' })
    expect(region.textContent).not.toContain(GUARDIAN_WORDS)
    expect(region.textContent).toContain(CHILD_STEP)
  })

  it('at 17, under “Create Health ID” too, where it can’t be made here for them', async () => {
    await openCase({ ...pending('case-17b'), ageYears: 17, healthId: null })
    const details = screen.getByText(/they can sign up on their own phone/).closest('details')!
    expect(details.textContent).toContain(GUARDIAN_WORDS)
    expect(details.textContent).not.toContain(CHILD_STEP)
    expect(within(details).getByRole('img', { name: 'QR code that opens the Health ID sign-up page', hidden: true })).toBeTruthy()
  })

  it('at 17, while their registration waits on this device', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await register('17')
    await screen.findByRole('region', { name: 'Saved on this device' })
    const region = screen.getByRole('region', { name: 'Get a Health ID now' })
    expect(region.textContent).toContain(GUARDIAN_WORDS)
    expect(region.textContent).not.toContain(CHILD_STEP)
    // A Health ID can't be created at outreach for under-18s, so the team is not told to open it for that.
    expect(region.textContent).not.toContain(OPEN_WHEN_SENT)
  })

  it('at 18, while their registration waits on this device', async () => {
    api.createOutreachCase.mockRejectedValue(new HidApiError(0, 'Network', { code: 'NETWORK_ERROR' }))
    await register('18')
    await screen.findByRole('region', { name: 'Saved on this device' })
    const region = screen.getByRole('region', { name: 'Get a Health ID now' })
    expect(region.textContent).not.toContain(GUARDIAN_WORDS)
    expect(region.textContent).toContain(CHILD_STEP)
  })
})

describe('a registration with a Health ID made at outreach', () => {
  async function openFromList(item: Record<string, unknown>) {
    api.outreachCases.mockResolvedValue([item])
    renderDept(<Outreach />)
    const card = (await screen.findByRole('button', { name: new RegExp(NAME) })).closest('li')!
    return card
  }
  async function openCard(card: HTMLElement) {
    await press(within(card).getByRole('button'))
    await screen.findByRole('heading', { level: 1, name: NAME })
  }

  it('says it has a Health ID, on its card and its case view, not that it comes later', async () => {
    const card = await openFromList({ ...pending('case-h1'), healthId: 'HID-ABC123', healthIdCreatedByOutreach: true })
    expect(card.textContent).toContain('Has a Health ID')
    expect(card.textContent).toContain('Health ID made: HID-ABC123')
    expect(card.textContent).not.toContain('Waiting to link')
    expect(card.textContent).not.toContain('They link their own Health ID later')
    await openCard(card)
    const main = document.body.textContent ?? ''
    expect(main).toContain('Has a Health ID')
    expect(main).toContain('Health ID made: HID-ABC123')
    expect(main).not.toContain(LINKS_LATER)
    expect(main).not.toContain('Their Health ID comes later')
    expect(main).not.toContain('Waiting to link')
  })

  it('says there is none yet, and to use Create Health ID, where Outreach makes them but this one has none', async () => {
    const card = await openFromList({ ...pending('case-h2'), healthId: null })
    expect(card.textContent).toContain('No Health ID yet')
    expect(card.textContent).not.toContain('They link their own Health ID later')
    await openCard(card)
    const main = document.body.textContent ?? ''
    expect(main).toContain('No Health ID yet')
    expect(main).toContain('If they want one, use Create Health ID below.')
    expect(main).not.toContain(LINKS_LATER)
  })

  it('keeps “links their own Health ID later” where Outreach makes none (no healthId on its reads)', async () => {
    const card = await openFromList(pending('case-h3'))
    expect(card.textContent).toContain('They link their own Health ID later')
    expect(card.textContent).not.toContain('Has a Health ID')
    await openCard(card)
    expect(document.body.textContent).toContain(LINKS_LATER)
    expect(document.body.textContent).not.toContain('No Health ID yet')
  })

  it('after saving, says the next steps are health checks then a Health ID, where Outreach makes them', async () => {
    api.createOutreachCase.mockResolvedValue({ ...pending('case-h4'), healthId: null })
    await register()
    const saved = (await screen.findByText('Registration saved')).closest('[role]')!
    expect(saved.textContent).toContain('Registration saved')
    expect(saved.textContent).toContain('Next: their health checks, then a Health ID if they want one.')
    expect(saved.textContent).not.toContain('They can link their own Health ID to it later.')
  })

  it('after saving, keeps the temporary record wording where Outreach makes none', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-h5'))
    await register()
    const saved = (await screen.findByText('Registration saved')).closest('[role]')!
    expect(saved.textContent).toContain('They have a temporary record. They can link their own Health ID to it later.')
  })
})

describe('patientSignUpHref', () => {
  it('is the main site’s /enroll of the deployment the host belongs to', () => {
    expect(patientSignUpHref('outreach.healthidentitydirectory.com')).toBe(SIGN_UP)
    expect(patientSignUpHref('ehr.healthidentitydirectory.com')).toBe(SIGN_UP)
    expect(patientSignUpHref('outreach.staging.healthidentitydirectory.com')).toBe('https://staging.healthidentitydirectory.com/enroll')
    expect(patientSignUpHref('localhost')).toBe(SIGN_UP)
  })
})
