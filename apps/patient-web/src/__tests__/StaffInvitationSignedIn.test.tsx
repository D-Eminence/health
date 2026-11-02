import { useEffect, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { BlueStaffInvitation } from '../ehr-blue/frame/auth/BlueStaffInvitation'
import { StaffInvitation } from '../staff/routes/StaffInvitation'

/**
 * Someone already signed in on their own product site opens the invitation link from the email. Identity opens no
 * invitation for a browser that carries a Health ID session (409 STAFF_INVITATION_REQUIRES_SIGN_OUT; on a product
 * site that is the site's own staff sign-in, its cookies being host-only). Existing staff accept signed in, on the
 * join page, with the link; someone else's sign-in on a shared computer can be ended first. Both invitation pages
 * (today's and the redesign's) do the same. Every account here is fictional.
 */
const invitations = vi.hoisted(() => ({ open: vi.fn(), accept: vi.fn() }))
const session = vi.hoisted(() => ({ logout: vi.fn() }))
vi.mock('../staff/api', () => ({ staffInvitationApi: invitations, staffApi: session }))
vi.mock('../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, name: 'local' }) }))
vi.mock('../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, name: 'local' }) }))
// The shared widget answers by itself only on localhost; on a product host this stand-in answers at once, and again
// after each attempt (a token is used once).
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange, resetKey }: { onTokenChange: (token: string | null) => void; resetKey?: number }) => {
    useEffect(() => { onTokenChange(`turnstile-token-${resetKey ?? 0}`) }, [onTokenChange, resetKey])
    return null
  },
}))

const INVITATION = '3f1d2c4b-0000-4000-8000-000000000003'
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE'
const LINK = `#${INVITATION}.${TOKEN}`
const SIGNED_IN = () => new HidApiError(409, 'Sign out of Health ID, or open the invitation in a private window',
  { code: 'STAFF_INVITATION_REQUIRES_SIGN_OUT' })

const PAGES: readonly (readonly [string, () => ReactElement])[] = [
  ['the redesign’s page', () => <BlueStaffInvitation />],
  ['today’s page', () => <StaffInvitation />],
]
const SITES = ['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com']

function openOn(hostname: string, page: () => ReactElement, hash = LINK) {
  window.history.replaceState(null, '', `/provider/invitation${hash}`)
  vi.stubGlobal('location', { ...window.location, hostname, pathname: '/provider/invitation', search: '', hash, replace: vi.fn() })
  render(<MemoryRouter initialEntries={[`/provider/invitation${hash}`]}><Routes>
    <Route path="/provider/invitation" element={page()} />
    <Route path="/provider/staff/join" element={<h1>Join page</h1>} />
  </Routes></MemoryRouter>)
}

async function selectContinue() {
  const button = await screen.findByRole('button', { name: 'Continue' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

beforeEach(() => { vi.clearAllMocks(); invitations.open.mockRejectedValue(SIGNED_IN()) })
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe.each(PAGES)('%s, for someone already signed in on the site', (_, page) => {
  it.each(SITES)('on %s, offers to accept signed in on the join page, with the link from the email', async hostname => {
    openOn(hostname, page)
    expect(screen.getByRole('heading', { name: 'Open your invitation' })).toBeTruthy()
    await selectContinue()
    expect(await screen.findByRole('heading', { name: 'You’re already signed in' })).toBeTruthy()
    expect(invitations.open).toHaveBeenCalledWith({ invitationId: INVITATION, token: TOKEN }, 'turnstile-token-0')
    expect(screen.getByRole('link', { name: 'Accept with my account' }).getAttribute('href')).toBe(`/provider/staff/join${LINK}`)
    expect(screen.getByRole('button', { name: 'Sign out first' })).toBeTruthy()
    expect(screen.getByText(/Someone is signed in to Health ID in this browser/).textContent).toBe('Someone is signed in to '
      + 'Health ID in this browser. If it’s you, accept the invitation with your account. If it’s someone else, or you don’t '
      + 'have a Health ID staff account yet, sign out first.')
    // Not the dead end it was: a refusal that offered no way to the join page.
    expect(screen.queryByText(/Sign out, or open the link in a private window/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(session.logout).not.toHaveBeenCalled()
  })

  it('with the email’s code instead of the link, the join page asks for the code again', async () => {
    openOn('ehr.healthidentitydirectory.com', page, '')
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'demo.doctor@example.test' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Invitation code' }), { target: { value: '123456' } })
    await selectContinue()
    expect(await screen.findByRole('heading', { name: 'You’re already signed in' })).toBeTruthy()
    expect(invitations.open).toHaveBeenCalledWith({ email: 'demo.doctor@example.test', code: '123456' }, 'turnstile-token-0')
    expect(screen.getByRole('link', { name: 'Accept with my account' }).getAttribute('href')).toBe('/provider/staff/join')
    expect(screen.getByText(/You’ll enter the code from the invitation email again\./)).toBeTruthy()
  })

  it('signs out first on a shared computer, then opens the invitation without an account', async () => {
    session.logout.mockResolvedValueOnce(undefined)
    openOn('lab.healthidentitydirectory.com', page)
    await selectContinue()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out first' }))
    expect(await screen.findByText('You’re signed out. Select Continue to open your invitation.')).toBeTruthy()
    expect(session.logout).toHaveBeenCalledTimes(1)
    // The link is still the one from the email; a new security check is made for the second try.
    invitations.open.mockResolvedValueOnce({ invitationId: INVITATION, facilityName: 'Demo Laboratory', roleCode: 'lab',
      inviterName: 'Demo Admin', inviteeName: 'Demo Scientist', email: 'demo.scientist@example.test', expiresAt: null,
      accountCase: 'new', linkRequired: false })
    await selectContinue()
    expect(await screen.findByRole('heading', { name: 'Choose a password' })).toBeTruthy()
    expect(invitations.open).toHaveBeenLastCalledWith({ invitationId: INVITATION, token: TOKEN }, 'turnstile-token-1')
  })

  it('says so when signing out fails, and still offers both ways on', async () => {
    session.logout.mockRejectedValueOnce(new Error('Sign-out could not be completed. Try again.'))
    openOn('pharmacy.healthidentitydirectory.com', page)
    await selectContinue()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out first' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/We couldn’t sign you out\. Try again, or open the invitation in a private window\.$/)
    expect(screen.getByRole('link', { name: 'Accept with my account' }).getAttribute('href')).toBe(`/provider/staff/join${LINK}`)
    expect((screen.getByRole('button', { name: 'Sign out first' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps every other refusal as it was: said in the page’s words, with the form to try again', async () => {
    invitations.open.mockRejectedValueOnce(new HidApiError(410, 'Expired', { code: 'STAFF_INVITATION_EXPIRED' }))
    openOn('ehr.healthidentitydirectory.com', page)
    await selectContinue()
    expect((await screen.findByRole('alert')).textContent).toMatch(/This invitation has expired\. Ask the facility to send it again\.$/)
    expect(screen.queryByRole('heading', { name: 'You’re already signed in' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
