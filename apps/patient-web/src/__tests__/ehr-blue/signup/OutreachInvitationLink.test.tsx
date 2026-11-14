import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { NEEDS_LINK, OutreachInvitation } from '../../../ehr-blue/signup/OutreachInvitation'
import { outreachInviteLinkSignInEnabled } from '../../../ehr-blue/signup/outreachLinkSignIn'
import { security } from './signupFakes'

/*
 * Password-free joining by an outreach invitation link (passwordless plan, phase 1): with the build's switch on, the
 * first screen is two "Join" buttons that accept with the link alone and sign this phone in; a backend without
 * accept-link (404) gets today's password form with the same security check; off, the page is today's. Fictional data.
 */

const api = vi.hoisted(() => ({ acceptInvitation: vi.fn(), acceptInvitationByLink: vi.fn() }))
const staff = vi.hoisted(() => ({ acceptOutreachInvitationSignedIn: vi.fn() }))
const session = vi.hoisted(() => ({ announceStaffSessionChange: vi.fn() }))
vi.mock('../../../staff/api', () => ({ outreachOrganiserApi: api, staffApi: staff }))
vi.mock('../../../staff/session', () => session)
vi.mock('../../../staff/env', async () => {
  const { ENVIRONMENT } = await import('./signupFakes')
  return { getEnvironment: () => ENVIRONMENT }
})
vi.mock('../../../Turnstile', async () => ({ Turnstile: (await import('./signupFakes')).FakeTurnstile }))

const INVITATION = 'b1000000-0000-4000-8000-000000000001'
const TOKEN = 'A'.repeat(43)
const LINK = { invitationId: INVITATION, token: TOKEN }
const OWN = 'Join – this is my own phone (keep me signed in)'
const SHARED = 'Join on a shared phone (sign me out after 15 minutes)'
const HISTORY_KEY = 'hidOutreachInvitation'
const inDays = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  security.auto = true
  vi.stubEnv('VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN', 'true')
})
afterEach(() => {
  vi.unstubAllEnvs()
  window.history.replaceState(null, '', '/')
})

function render_() {
  return render(<MemoryRouter initialEntries={['/provider/outreach-invitation']}><Routes>
    <Route path="/provider/outreach-invitation" element={<OutreachInvitation />} />
  </Routes></MemoryRouter>)
}
/** The page as the invitation email's link opens it: the invitation in the fragment. */
function openLink() {
  window.history.replaceState(null, '', `/provider/outreach-invitation#${INVITATION}.${TOKEN}`)
  return render_()
}
async function press(name: string) {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}
const keptLink = () => (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY]

describe('the switch', () => {
  it.each([[undefined, false], ['', false], ['0', false], ['false', false], ['yes', false], ['1', true], ['true', true]])(
    'VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN=%j is %s', (value, on) => {
      vi.unstubAllEnvs()
      if (value !== undefined) vi.stubEnv('VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN', value)
      expect(outreachInviteLinkSignInEnabled()).toBe(on)
    })

  it('off, the page is today’s: the password form first, no "Join" buttons, nothing kept in the history entry', async () => {
    vi.stubEnv('VITE_HID_OUTREACH_INVITE_LINK_SIGN_IN', '')
    api.acceptInvitation.mockResolvedValue({ accepted: true, facilityId: 'f-1', membershipId: 'm-1', roleCode: 'outreach_volunteer' })
    openLink()
    expect(window.location.hash).toBe('')
    expect(keptLink()).toBeUndefined()
    expect(screen.getByRole('heading', { level: 1, name: 'Join an outreach group' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: OWN })).toBeNull()
    expect(screen.queryByRole('button', { name: SHARED })).toBeNull()
    expect(document.body.textContent).not.toContain('This phone will be signed in')
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'another long passphrase' } })
    fireEvent.change(screen.getByLabelText(/Type the password again/), { target: { value: 'another long passphrase' } })
    await press('Join the group')
    expect(api.acceptInvitation).toHaveBeenCalledWith(LINK, 'another long passphrase', 'token-0')
    expect(api.acceptInvitationByLink).not.toHaveBeenCalled()
    expect(session.announceStaffSessionChange).not.toHaveBeenCalled()
  })
})

describe('joining by the invitation link alone (switch on)', () => {
  it('shows the new first screen, with "Join with my login" kept as the other way', () => {
    openLink()
    expect(screen.getByRole('heading', { level: 1, name: 'Join the outreach team' })).toBeTruthy()
    expect(document.body.textContent).toContain('Tap a button to accept. This phone will be signed in to Health ID Outreach. The link works once.')
    expect(screen.getByRole('button', { name: OWN })).toBeTruthy()
    expect(screen.getByRole('button', { name: SHARED })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join with my login' })).toBeTruthy()
    expect(screen.queryByLabelText(/^Password/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join the group' })).toBeNull()
    expect(document.querySelector('[data-turnstile-action="outreach-invitation"]')).toBeTruthy()
  })

  it('own phone: accepts with the link, signs in, says the phone stays signed in, and forgets the link', async () => {
    api.acceptInvitationByLink.mockResolvedValue({ accepted: true, signedIn: true, facilityId: 'f-1', membershipId: 'm-1',
      roleCode: 'outreach_volunteer', expiresAt: inDays(30), deviceTrust: 'own_device' })
    openLink()
    expect(keptLink()).toEqual(LINK)
    await press(OWN)
    expect(api.acceptInvitationByLink).toHaveBeenCalledWith(LINK, 'own', 'token-0')
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy()
    expect(document.body.textContent).toContain('This phone stays signed in for up to 30 days unless you sign out.')
    expect(screen.getByRole('link', { name: 'Open Outreach' }).getAttribute('href')).toBe('/provider/outreach')
    expect(session.announceStaffSessionChange).toHaveBeenCalledTimes(1)
    expect(keptLink()).toBeUndefined()
    expect(api.acceptInvitation).not.toHaveBeenCalled()
  })

  it('shared phone: accepts with "shared", and says nothing about staying signed in for a short session', async () => {
    api.acceptInvitationByLink.mockResolvedValue({ accepted: true, signedIn: true, facilityId: 'f-1', membershipId: 'm-1',
      roleCode: 'outreach_volunteer', expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), deviceTrust: 'standard' })
    openLink()
    await press(SHARED)
    expect(api.acceptInvitationByLink).toHaveBeenCalledWith(LINK, 'shared', 'token-0')
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('30 days')
    expect(session.announceStaffSessionChange).toHaveBeenCalledTimes(1)
  })

  it('own phone with a short session (the backend did not grant the long one): no 30-day line', async () => {
    api.acceptInvitationByLink.mockResolvedValue({ accepted: true, signedIn: true, facilityId: 'f-1', roleCode: 'outreach_volunteer',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), deviceTrust: 'own_device' })
    openLink()
    await press(OWN)
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re in.' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('30 days')
  })

  it.each(['NOT_FOUND', 'API_ROUTE_NOT_FOUND'])('a 404 %s falls back to the password form silently, with the same security check', async code => {
    api.acceptInvitationByLink.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code }))
    api.acceptInvitation.mockResolvedValue({ accepted: true, facilityId: 'f-1', membershipId: 'm-1', roleCode: 'outreach_volunteer' })
    openLink()
    await press(OWN)
    expect(await screen.findByRole('heading', { level: 1, name: 'Join an outreach group' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: OWN })).toBeNull()
    expect(screen.getByRole('button', { name: 'Join with my login' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'another long passphrase' } })
    fireEvent.change(screen.getByLabelText(/Type the password again/), { target: { value: 'another long passphrase' } })
    await press('Join the group')
    // The same token the link attempt carried: the 404 came before the security check was used.
    expect(api.acceptInvitation).toHaveBeenCalledWith(LINK, 'another long passphrase', 'token-0')
    expect(await screen.findByRole('heading', { level: 1, name: 'You have joined the outreach group' })).toBeTruthy()
    expect(keptLink()).toBeUndefined()
  })

  it('a 404 with another code is a refusal, not the fallback', async () => {
    api.acceptInvitationByLink.mockRejectedValue(new HidApiError(404, 'x', { code: 'OUTREACH_INVITATION_INVALID' }))
    openLink()
    await press(OWN)
    expect((await screen.findByRole('alert')).textContent).toContain('This invitation link is not right.')
    expect(screen.getByRole('button', { name: OWN })).toBeTruthy()
  })

  it('joined but not signed in: says to sign in, and how to set a password', async () => {
    api.acceptInvitationByLink.mockResolvedValue({ accepted: true, signedIn: false, facilityId: 'f-1', membershipId: 'm-1',
      roleCode: 'outreach_volunteer' })
    openLink()
    await press(OWN)
    expect(await screen.findByRole('heading', { level: 1, name: 'You’ve joined. Sign in to start.' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Set a password' }).getAttribute('href')).toMatch(/\/provider\/recover$/)
    // The shell has its own Sign in too: each goes to the staff sign-in.
    for (const link of screen.getAllByRole('link', { name: 'Sign in' })) expect(link.getAttribute('href')).toMatch(/\/provider\/sign-in$/)
    expect(session.announceStaffSessionChange).not.toHaveBeenCalled()
    expect(keptLink()).toBeUndefined()
  })

  it.each([
    ['OUTREACH_INVITATION_SIGN_IN_REQUIRED', 409, 'This email already has a Health ID login. Sign in with it, then open the invitation link again.'],
    ['OUTREACH_INVITATION_PATIENT_LOGIN', 409, 'This email is a patient’s Health ID login. It can’t help an outreach group yet. Ask the organiser to invite a different email.'],
    ['OUTREACH_PATIENT_LOGIN', 409, 'This email is a patient’s Health ID login. It can’t help an outreach group yet. Ask the organiser to invite a different email.'],
    ['OUTREACH_INVITATION_ALREADY_ACCEPTED', 409, 'This invitation has already been accepted. Sign in to start helping.'],
    ['OUTREACH_INVITATION_EXPIRED', 410, 'This invitation has expired. Ask the organiser to invite you again.'],
    ['OUTREACH_INVITATION_REQUIRES_SIGN_OUT', 409, 'You are signed in to Health ID. Accept with your login below, or sign out first.'],
    ['OUTREACH_INVITATION_RATE_LIMITED', 429, 'Too many tries from this network. Please wait an hour and try again.'],
    ['TURNSTILE_INVALID', 403, 'The security check didn’t work. Complete it again, then try again.'],
  ])('words %s as today, and asks for a new security check', async (code, status, words) => {
    api.acceptInvitationByLink.mockRejectedValue(new HidApiError(status, 'x', { code }))
    openLink()
    await press(OWN)
    expect((await screen.findByRole('alert')).textContent).toBe(words)
    expect(session.announceStaffSessionChange).not.toHaveBeenCalled()
    // Still the first screen, the link still kept; the next try carries a new token.
    expect(screen.getByRole('button', { name: SHARED })).toBeTruthy()
    expect(keptLink()).toEqual(LINK)
    await press(SHARED)
    expect(api.acceptInvitationByLink).toHaveBeenLastCalledWith(LINK, 'shared', 'token-1')
  })

  it('asks for the security check before sending anything', async () => {
    security.auto = false
    openLink()
    await press(OWN)
    expect(screen.getByRole('alert').textContent).toBe('Complete the security check, then try again.')
    expect(api.acceptInvitationByLink).not.toHaveBeenCalled()
  })

  it('keeps the link in the history entry, so a reload still has it', async () => {
    api.acceptInvitationByLink.mockResolvedValue({ accepted: true, signedIn: true, facilityId: 'f-1', roleCode: 'outreach_volunteer',
      expiresAt: inDays(30) })
    const first = openLink()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/provider/outreach-invitation')
    expect(keptLink()).toEqual(LINK)
    first.unmount()
    // The reload: the address no longer has the fragment, the history entry does.
    render_()
    expect(screen.getByRole('button', { name: OWN })).toBeTruthy()
    expect(document.body.textContent).not.toContain(NEEDS_LINK)
    await press(OWN)
    expect(api.acceptInvitationByLink).toHaveBeenCalledWith(LINK, 'own', 'token-0')
  })

  it('a kept value that is not a whole link is ignored', () => {
    window.history.replaceState({ [HISTORY_KEY]: { invitationId: INVITATION, token: 'short' } }, '', '/provider/outreach-invitation')
    render_()
    expect(document.body.textContent).toContain(NEEDS_LINK)
    expect(screen.queryByRole('button', { name: OWN })).toBeNull()
  })

  it('without the whole link, says to open the link again and offers nothing to send', () => {
    window.history.replaceState(null, '', '/provider/outreach-invitation')
    render_()
    expect(document.body.textContent).toContain(NEEDS_LINK)
    expect(screen.queryByRole('button', { name: OWN })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Join with my login' })).toBeNull()
  })

  it('"Join with my login" still accepts signed in, and forgets the link', async () => {
    staff.acceptOutreachInvitationSignedIn.mockResolvedValue({ accepted: true, facilityId: 'f-1', membershipId: 'm-1', roleCode: 'outreach_volunteer' })
    openLink()
    await press('Join with my login')
    expect(staff.acceptOutreachInvitationSignedIn).toHaveBeenCalledWith(LINK)
    expect(await screen.findByRole('heading', { level: 1, name: 'You have joined the outreach group' })).toBeTruthy()
    expect(keptLink()).toBeUndefined()
  })
})
