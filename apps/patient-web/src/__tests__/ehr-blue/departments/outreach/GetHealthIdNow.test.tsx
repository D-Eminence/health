import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { Outreach } from '../../../../ehr-blue/departments/outreach/Outreach'
import { memoryQueueStore, setOutreachQueueStore } from '../../../../ehr-blue/departments/outreach/offlineQueue'
import { QrCode } from '../../../../mfa/OtpauthQr'
import { patientSignUpHref } from '../../../../productSites'

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
  outreachInvitations: vi.fn(), createOutreachInvitation: vi.fn(),
}))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const SIGN_UP = 'https://app.healthidentitydirectory.com/enroll'
const NAME = 'Kemi Balogun'
const PHONE = '08031234567'
const CAMPAIGN = { id: 'campaign-1', name: 'Ajegunle health week', status: 'active', services: ['registration'], startsAt: '2026-11-01T00:00:00.000Z', rowVersion: 2 }
const pending = (id: string) => ({ id, campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: NAME, ageYears: 30, sex: 'female',
  phone: PHONE, temporaryPatientId: `tmp_${id}`, createdAt: '2026-11-14T09:00:00.000Z', rowVersion: 1 })

beforeEach(() => {
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

async function register() {
  renderDept(<Outreach />)
  await press(await screen.findByRole('button', { name: 'New registration' }))
  await waitFor(() => expect(screen.getByRole('option', { name: 'Ajegunle health week' })).toBeTruthy())
  fireEvent.change(screen.getByRole('textbox', { name: /Full name/ }), { target: { value: NAME } })
  fireEvent.change(screen.getByRole('spinbutton', { name: /Age in years/ }), { target: { value: '30' } })
  fireEvent.change(screen.getByRole('textbox', { name: /Phone number/ }), { target: { value: PHONE } })
  await press(screen.getByRole('radio', { name: /They read it themselves and agreed/ }))
  await press(screen.getByRole('button', { name: 'Save registration' }))
}

/** The panel's region, its link and its QR code, checked the same way wherever it is shown. */
function expectPanel(region: HTMLElement) {
  expect(within(region).getByRole('heading', { level: 2, name: 'Get a Health ID now' })).toBeTruthy()
  const link = within(region).getByRole('link', { name: 'Open sign-up on this phone' }) as HTMLAnchorElement
  expect(link.getAttribute('href')).toBe(SIGN_UP)
  expect(link.target).toBe('_blank')
  expect(link.rel).toContain('noopener')
  expect(link.getAttribute('aria-describedby')).toBeTruthy()
  expect(document.getElementById(link.getAttribute('aria-describedby')!)?.textContent).toBe('Opens in a new tab.')
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
  expect(region.textContent).toContain('They own their Health ID. Your team can’t create it for them.')
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
    expectPanel(screen.getByRole('region', { name: 'Get a Health ID now' }))
  })

  it('carries nothing about the person: not their name, phone number, temporary ID or case', async () => {
    api.createOutreachCase.mockResolvedValue(pending('case-4'))
    await register()
    const region = await screen.findByRole('region', { name: 'Get a Health ID now' })
    const href = within(region).getByRole('link', { name: 'Open sign-up on this phone' }).getAttribute('href')!
    const url = new URL(href)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    for (const personal of [NAME, 'Kemi', 'Balogun', PHONE, '8031234567', 'tmp_case-4', 'case-4', 'campaign-1', GROUP_ID]) {
      expect(decodeURIComponent(href)).not.toContain(personal)
    }
  })
})

describe('the sign-up as the fallback', () => {
  it('is a small “Or they can sign up on their own phone” where the team can create the Health ID', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-5'), healthId: null }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
    const summary = screen.getByText('Or they can sign up on their own phone')
    const details = summary.closest('details')!
    expect(within(details).getByRole('link', { name: 'Open sign-up on this phone', hidden: true }).getAttribute('href')).toBe(SIGN_UP)
    expect(details.textContent).not.toContain('Your team can’t create it for them.')
  })

  it('is not shown once the registration has a Health ID', async () => {
    api.outreachCases.mockResolvedValue([{ ...pending('case-6'), healthId: 'HID-ABC123' }])
    renderDept(<Outreach />)
    await press(await screen.findByRole('button', { name: new RegExp(NAME) }))
    await screen.findByRole('heading', { level: 1, name: NAME })
    expect(screen.queryByText('Or they can sign up on their own phone')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Get a Health ID now' })).toBeNull()
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
