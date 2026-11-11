import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { OutreachOrganiserSignUp } from '../../../ehr-blue/signup/OutreachOrganiserSignUp'
import { OutreachTerms } from '../../../ehr-blue/signup/OutreachTerms'
import { OutreachInvitation, readOutreachInvitationLink } from '../../../ehr-blue/signup/OutreachInvitation'

/*
 * "Start running outreach" (open sign-up on outreach., owner decisions of 11 November 2026): details and phone, the
 * emailed code, the organiser terms (2026-11-01: joint controller, a breach reported within 24 hours, free for now) and a
 * password. It fails safe while sign-up is off, and tells someone with a login to sign in and start a group with it.
 * Fictional data only.
 */

const api = vi.hoisted(() => ({ availability: vi.fn(), start: vi.fn(), verify: vi.fn(), activate: vi.fn(), acceptInvitation: vi.fn() }))
const staff = vi.hoisted(() => ({ acceptOutreachInvitationSignedIn: vi.fn() }))
vi.mock('../../../staff/api', () => ({ outreachOrganiserApi: api, staffApi: staff }))
vi.mock('../../../staff/env', async () => {
  const { ENVIRONMENT } = await import('./signupFakes')
  return { getEnvironment: () => ENVIRONMENT }
})
vi.mock('../../../Turnstile', async () => ({ Turnstile: (await import('./signupFakes')).FakeTurnstile }))

const CHALLENGE = 'c0de0000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  api.availability.mockResolvedValue({ open: true, termsVersion: '2026-11-01' })
  api.start.mockResolvedValue({ accepted: true, challengeId: CHALLENGE, expiresInSeconds: 600, resendAfterSeconds: 60 })
  api.verify.mockResolvedValue({ verified: true })
  api.activate.mockResolvedValue({ activated: true, organizationId: 'org-1', facilityId: 'f-1', accountId: 'a-1', reviewState: 'pending', expiresAt: '2026-11-11T10:00:00.000Z' })
})
afterEach(() => { vi.unstubAllGlobals() })

function open(path = '/provider/start-outreach') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/provider/start-outreach" element={<OutreachOrganiserSignUp />} />
    <Route path="/provider/outreach-terms" element={<OutreachTerms />} />
    <Route path="/provider/outreach-invitation" element={<OutreachInvitation />} />
  </Routes></MemoryRouter>)
}
async function press(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}
const type = (name: RegExp, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })

function details() {
  type(/Your full name/, 'Funke Ade')
  type(/^Email/, 'funke@example.test')
  type(/Phone number/, '0801 234 5678')
  type(/Group name/, 'Ajegunle Health Volunteers')
}

describe('Start running outreach', () => {
  it('signs a group up: details, the emailed code, the terms, then a password', async () => {
    open()
    expect(await screen.findByRole('heading', { level: 2, name: 'Your details' })).toBeTruthy()
    details()
    type(/CAC or IT number/, 'it 123456')
    await press('Send me a code')
    expect(api.start).toHaveBeenCalledWith({ organiserName: 'Funke Ade', email: 'funke@example.test', phone: '0801 234 5678',
      groupName: 'Ajegunle Health Volunteers', kind: 'group', registrationNumber: 'IT123456', turnstileToken: expect.any(String) })

    expect(await screen.findByRole('heading', { level: 2, name: 'Check your email' })).toBeTruthy()
    type(/Code from the email/, '123456')
    await press('Confirm email')
    expect(api.verify).toHaveBeenCalledWith(CHALLENGE, '123456')

    expect(await screen.findByRole('heading', { level: 2, name: 'Organiser terms' })).toBeTruthy()
    const terms = document.body.textContent ?? ''
    expect(terms).toContain('joint controllers')
    expect(terms).toContain('within 24 hours')
    expect(terms).toContain('It is free for now.')
    await press('Accept and continue')
    expect(screen.getByText('Tick the box to accept the organiser terms.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: /accept the organiser terms/ })) })
    await press('Accept and continue')

    expect(await screen.findByRole('heading', { level: 2, name: 'Set a password' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long fictional passphrase' } })
    fireEvent.change(screen.getByLabelText(/Type the password again/), { target: { value: 'a long fictional passphrase' } })
    await press('Create my outreach group')
    expect(api.activate).toHaveBeenCalledWith({ termsVersion: '2026-11-01', password: 'a long fictional passphrase' })
    expect(await screen.findByRole('heading', { level: 1, name: 'Your outreach group is ready' })).toBeTruthy()
    expect(document.body.textContent).toContain('Health ID checks your group once')
    expect(screen.getByRole('link', { name: 'Open Outreach' }).getAttribute('href')).toBe('/provider/outreach')
  })

  it('checks the details before sending anything', async () => {
    open()
    await screen.findByRole('heading', { level: 2, name: 'Your details' })
    type(/Group name/, '!')
    await press('Send me a code')
    expect(screen.getByText('Enter your full name.')).toBeTruthy()
    expect(screen.getByText(/Enter an email address you can open now/)).toBeTruthy()
    expect(screen.getByText(/Enter a phone number we can call/)).toBeTruthy()
    expect(screen.getByText(/Enter your group’s name/)).toBeTruthy()
    expect(api.start).not.toHaveBeenCalled()
  })

  it('tells someone whose email already has a login to sign in and use “Start an outreach group”', async () => {
    api.start.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_ORGANISER_EMAIL_REGISTERED' }))
    open()
    await screen.findByRole('heading', { level: 2, name: 'Your details' })
    details()
    await press('Send me a code')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('This email already has a Health ID login. Sign in with it, then choose “Start an outreach group”.')
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/provider/sign-in')
  })

  it('says a reserved group name in plain words', async () => {
    api.start.mockRejectedValue(new HidApiError(422, 'x', { code: 'OUTREACH_ORGANISER_NAME_RESERVED' }))
    open()
    await screen.findByRole('heading', { level: 2, name: 'Your details' })
    details()
    await press('Send me a code')
    expect((await screen.findByRole('alert')).textContent).toMatch(/sounds like a hospital, a ministry/)
  })

  it('closes, with nothing to send, when the switch goes off mid-way (423)', async () => {
    api.verify.mockRejectedValue(new HidApiError(423, 'x', { code: 'OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE' }))
    open()
    await screen.findByRole('heading', { level: 2, name: 'Your details' })
    details()
    await press('Send me a code')
    type(/Code from the email/, '123456')
    await press('Confirm email')
    expect(await screen.findByText('Signing up to run outreach isn’t open at the moment. Please try again later.')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('on another product site, sends the person to Health ID Outreach’s sign-up', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'ehr.healthidentitydirectory.com' })
    open()
    expect(screen.getByRole('link', { name: 'Continue to Health ID Outreach' }).getAttribute('href'))
      .toBe('https://outreach.healthidentitydirectory.com/provider/enroll')
    expect(api.availability).not.toHaveBeenCalled()
  })
})

describe('the organiser terms page', () => {
  it('says the terms in plain English, with the registration notice', async () => {
    open('/provider/outreach-terms')
    expect(screen.getByRole('heading', { level: 1, name: 'Organiser terms for Health ID Outreach' })).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Version 2026-11-01')
    expect(text).toContain('joint controllers')
    expect(text).toContain('Tell Health ID support within 24 hours')
    expect(text).toContain('free for now')
    expect(text).toContain('deleted automatically')
    expect(text).toContain('Each person links their own Health ID later')
    expect(text).not.toMatch(/limit|per day|₦/i)
  })
})

describe('an outreach invitation', () => {
  it('reads the link’s invitation from the address once', () => {
    const token = 'A'.repeat(43)
    expect(readOutreachInvitationLink(`#b1000000-0000-4000-8000-000000000001.${token}`))
      .toEqual({ invitationId: 'b1000000-0000-4000-8000-000000000001', token })
    expect(readOutreachInvitationLink('#nonsense')).toBeNull()
  })

  it('lets a new helper join with a password, using the email and code without the link', async () => {
    api.acceptInvitation.mockResolvedValue({ accepted: true, facilityId: 'f-1', facilityName: 'Ajegunle Health Volunteers', roleCode: 'outreach_volunteer' })
    open('/provider/outreach-invitation')
    type(/Email the invitation was sent to/, 'bisi@example.test')
    type(/Code from the email/, '482913')
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'another long passphrase' } })
    fireEvent.change(screen.getByLabelText(/Type the password again/), { target: { value: 'another long passphrase' } })
    await press('Join the group')
    expect(api.acceptInvitation).toHaveBeenCalledWith({ email: 'bisi@example.test', code: '482913' }, 'another long passphrase', expect.any(String))
    expect(await screen.findByRole('heading', { level: 1, name: 'You have joined Ajegunle Health Volunteers' })).toBeTruthy()
  })

  it('tells someone with a login to accept with it', async () => {
    api.acceptInvitation.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_INVITATION_SIGN_IN_REQUIRED' }))
    open('/provider/outreach-invitation')
    type(/Email the invitation was sent to/, 'bisi@example.test')
    type(/Code from the email/, '482913')
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'another long passphrase' } })
    fireEvent.change(screen.getByLabelText(/Type the password again/), { target: { value: 'another long passphrase' } })
    await press('Join the group')
    expect((await screen.findByRole('alert')).textContent).toContain('This email already has a Health ID login.')
  })
})
