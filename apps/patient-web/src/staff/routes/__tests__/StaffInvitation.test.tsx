import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { StaffInvitation } from '../StaffInvitation'
import { focusWhenShown } from '../../../__tests__/focusWhenShown'

/**
 * Joining a facility by invitation on the main site (Novu, P4b SPEC 8.2): the email's link carries the invitation in its
 * fragment, or the person types the email address and the code. The page proves it with Identity (Turnstile action
 * staff-invitation), says who invited whom to what, and, for a new account or one that works nowhere now, sets the
 * password. It signs nobody in.
 */
const api = vi.hoisted(() => ({ open: vi.fn(), accept: vi.fn() }))
vi.mock('../../api', () => ({ staffInvitationApi: api }))
vi.mock('../../../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test', supportContact: 'mailto:support@healthidentitydirectory.com' }) }))

const INVITATION = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const TOKEN = 'Abc_-0123456789abcdefghijklmnopqrstuvwxyzAB'
const opened = (overrides: Record<string, unknown> = {}) => ({ invitationId: INVITATION, facilityName: 'Ikeja Care',
  roleCode: 'nurse', inviterName: 'Bola Adewale', inviteeName: 'Ngozi Okafor', email: 'ngozi@ikejacare.example',
  expiresAt: '2026-11-01T09:30:00.000Z', accountCase: 'new', linkRequired: false, ...overrides })

function Where() {
  const location = useLocation()
  return <output data-testid="where">{location.pathname + location.hash}</output>
}

function open(address = '/provider/invitation') {
  window.history.replaceState(null, '', address)
  render(<MemoryRouter initialEntries={[address]}><Routes>
    <Route path="/provider/invitation" element={<StaffInvitation />} />
    <Route path="/provider/staff/join" element={<><h1>Join on the staff site</h1><Where /></>} />
    <Route path="/provider/sign-in" element={<h1>Staff sign-in</h1>} />
  </Routes></MemoryRouter>)
}

const linkAddress = `/provider/invitation#${INVITATION}.${TOKEN}`
const continueButton = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement

beforeEach(() => { api.open.mockReset(); api.accept.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

describe('opening an invitation', () => {
  it('takes the link out of the address at once, keeps it for a reload, and opens with it', async () => {
    api.open.mockResolvedValueOnce(opened())
    open(linkAddress)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/provider/invitation')
    expect((window.history.state as Record<string, unknown>).hidStaffInvitation).toEqual({ invitationId: INVITATION, token: TOKEN })
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    await screen.findByRole('heading', { name: 'Choose a password' })
    expect(api.open).toHaveBeenCalledWith({ invitationId: INVITATION, token: TOKEN }, 'local-turnstile-disabled')
  })

  it('still has the link after a reload, from the history entry', async () => {
    api.open.mockResolvedValueOnce(opened())
    open(linkAddress)
    cleanup()
    // The reload: the same history entry, without the fragment.
    render(<MemoryRouter initialEntries={['/provider/invitation']}><Routes>
      <Route path="/provider/invitation" element={<StaffInvitation />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    await screen.findByRole('heading', { name: 'Choose a password' })
    expect(api.open).toHaveBeenCalledWith({ invitationId: INVITATION, token: TOKEN }, 'local-turnstile-disabled')
  })

  it('asks for the email address and the code without a link, and sends them as Identity takes them', async () => {
    api.open.mockResolvedValueOnce(opened())
    open()
    expect(screen.getByRole('heading', { name: 'Enter your invitation code' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' Ngozi@IkejaCare.example ' } })
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '12a34' } })
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the email address the invitation was sent to, and the 6-digit '
      + 'code from the email.')
    expect(api.open).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } })
    fireEvent.click(continueButton())
    await screen.findByRole('heading', { name: 'Choose a password' })
    expect(api.open).toHaveBeenCalledWith({ email: 'ngozi@ikejacare.example', code: '123456' }, 'local-turnstile-disabled')
  })

  it('offers the code instead of the link, and back', async () => {
    open(linkAddress)
    fireEvent.click(screen.getByRole('button', { name: 'I have a code' }))
    expect(screen.getByLabelText('Invitation code')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use the link from the email' }))
    expect(screen.queryByLabelText('Invitation code')).toBeNull()
  })

  it.each([
    ['STAFF_INVITATION_CODE_INVALID', 401, 'That code doesn’t match. Check the email.'],
    ['STAFF_INVITATION_LOCKED', 429, 'This link has been tried too often. Ask the facility to send the invitation again.'],
    ['STAFF_INVITATION_SUPERSEDED', 410, 'A newer invitation was sent. Use the latest email.'],
    ['STAFF_INVITATION_EXPIRED', 410, 'This invitation has expired. Ask the facility to send it again.'],
    ['STAFF_INVITATION_WITHDRAWN', 410, 'This invitation is no longer available: the facility withdrew it, or can’t take new staff '
      + 'on Health ID right now. Ask the facility about it.'],
    ['STAFF_INVITATION_ALREADY_ACCEPTED', 409, 'This invitation has already been accepted. Sign in to use it.'],
    ['STAFF_INVITATION_REQUIRES_SIGN_OUT', 409, 'This browser is signed in to Health ID, for example as a patient. Sign out, or '
      + 'open the link in a private window.'],
    ['STAFF_INVITATIONS_UNAVAILABLE', 423, 'Joining is paused by Health ID. Try again later.'],
    ['STAFF_INVITATION_RATE_LIMITED', 429, 'Too many invitations have been opened from your network. Please try again in an hour.'],
    ['TURNSTILE_CONTEXT_MISMATCH', 403, 'The security check was made for another Health ID site. Open the link in the invitation '
      + 'email again.'],
    ['TURNSTILE_REJECTED', 403, 'The security check didn’t go through. Please complete it again, then retry.'],
    ['UPSTREAM_UNAVAILABLE', 503, 'Joining a facility is temporarily unavailable. Please try again in a few minutes.'],
  ])('says %s in its own words, and a new security check is needed', async (code, status, text) => {
    api.open.mockRejectedValueOnce(new HidApiError(status, 'Identity’s detail', { code }))
    open(linkAddress)
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(continueButton()).toBeTruthy()
  })

  it('says invitations aren’t available from an Identity without the route', async () => {
    api.open.mockRejectedValueOnce(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
    open(linkAddress)
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    expect(await screen.findByRole('heading', { name: 'Invitations aren’t available yet' })).toBeTruthy()
  })
})

describe('what the invited person does next', () => {
  async function openWith(answer: Record<string, unknown>, address = linkAddress) {
    api.open.mockResolvedValueOnce(opened(answer))
    open(address)
    if (address !== linkAddress) {
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ngozi@ikejacare.example' } })
      fireEvent.change(screen.getByLabelText('Invitation code'), { target: { value: '123456' } })
    }
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    await waitFor(() => expect(api.open).toHaveBeenCalled())
  }

  it('says who invited them to what, sets a password for a new account, and sends them to their role’s site', async () => {
    api.accept.mockResolvedValueOnce({ accepted: true, facilityName: 'Ikeja Care', roleCode: 'nurse' })
    await openWith({})
    expect(await screen.findByText(/invited you to join/)).toBeTruthy()
    expect(screen.getByText(/invited you to join/).textContent).toMatch(/^Bola Adewale invited you to join Ikeja Care as a nurse\. The invitation expires on .+\.$/)
    expect(document.querySelector('input[autocomplete="username"]')?.getAttribute('value')).toBe('ngozi@ikejacare.example')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Choose a password of at least 12 characters.')
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-passwore' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The two passwords don’t match.')
    expect(api.accept).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-password' } })
    // Production: a nurse signs in on the EHR site.
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect(await screen.findByRole('heading', { name: 'You’ve joined Ikeja Care' })).toBeTruthy()
    expect(api.accept).toHaveBeenCalledWith('a-long-enough-password')
    expect(screen.getByText('You can now sign in at ehr.healthidentitydirectory.com with ngozi@ikejacare.example and your new '
      + 'password.')).toBeTruthy()
    expect(screen.getByText('Your facility administrator vouched for your licence; Health ID records it.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to staff sign-in' }).getAttribute('href')).toBe('https://ehr.healthidentitydirectory.com/provider/sign-in')
  })

  it.each([
    ['lab', 'lab.healthidentitydirectory.com', true],
    ['pharmacist', 'pharmacy.healthidentitydirectory.com', true],
    ['receptionist', 'ehr.healthidentitydirectory.com', false],
    ['doctor', 'ehr.healthidentitydirectory.com', true],
  ])('sends a %s to %s', async (role, host, vouched) => {
    api.accept.mockResolvedValueOnce({ accepted: true, facilityName: 'Ikeja Care', roleCode: role })
    await openWith({ roleCode: role })
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-password' } })
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com' })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect(await screen.findByText(`You can now sign in at ${host} with ngozi@ikejacare.example and your new password.`)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to staff sign-in' }).getAttribute('href')).toBe(`https://${host}/provider/sign-in`)
    expect(Boolean(screen.queryByText('Your facility administrator vouched for your licence; Health ID records it.'))).toBe(vouched)
  })

  it('outside production, sends them to this portal’s sign-in', async () => {
    api.accept.mockResolvedValueOnce({ accepted: true, facilityName: 'Ikeja Care', roleCode: 'nurse' })
    await openWith({})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect(await screen.findByText('You can now sign in to the Provider Portal with ngozi@ikejacare.example and your new password.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to staff sign-in' }).getAttribute('href')).toBe('/provider/sign-in')
  })

  it('says the account’s old password stops working when a dormant staff account sets a new one', async () => {
    await openWith({ accountCase: 'dormant_staff' })
    expect(await screen.findByRole('heading', { name: 'Set a new password' })).toBeTruthy()
    expect(screen.getByText(/isn’t active at any facility now/).textContent).toBe('Your Health ID staff account '
      + 'ngozi@ikejacare.example isn’t active at any facility now. Choose a new password of at least 12 characters to use it at '
      + 'Ikeja Care. Your old password will stop working.')
  })

  it('asks for the email’s link when a typed code opens a dormant account', async () => {
    await openWith({ accountCase: 'dormant_staff', linkRequired: true }, '/provider/invitation')
    expect(await screen.findByText('Open the link in the invitation email to set your new password.')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it.each([
    ['existing_staff', true, 'You already have a Health ID staff account. Sign in at the Provider Portal to accept. If you can’t '
      + 'sign in, reset your password there first.', `/provider/staff/join#${INVITATION}.${TOKEN}`],
    ['existing_staff', false, 'You already have a Health ID staff account. Sign in at the Provider Portal to accept. If you can’t '
      + 'sign in, reset your password there first. Then enter the code from the invitation email.', '/provider/staff/join'],
  ])('sends %s (link %s) to the join page on their own site', async (accountCase, link, text, href) => {
    await openWith({ accountCase }, link ? linkAddress : '/provider/invitation')
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in to accept' }).getAttribute('href')).toBe(href)
  })

  it('names the staff site in production for existing staff, and carries the link there', async () => {
    let answer!: (value: unknown) => void
    api.open.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    open(linkAddress)
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    vi.stubGlobal('location', { ...window.location, hostname: 'app.healthidentitydirectory.com' })
    answer(opened({ accountCase: 'existing_staff', roleCode: 'lab' }))
    expect(await screen.findByText('You already have a Health ID staff account. Sign in at lab.healthidentitydirectory.com to '
      + 'accept. If you can’t sign in, reset your password there first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in to accept' }).getAttribute('href'))
      .toBe(`https://lab.healthidentitydirectory.com/provider/staff/join#${INVITATION}.${TOKEN}`)
  })

  it.each([
    ['already_member', 'You already work at Ikeja Care on Health ID.'],
    ['patient_account', 'This email belongs to a Health ID patient account. Staff accounts need their own email: ask Ikeja Care to '
      + 'invite your work email.'],
    ['unavailable', 'This invitation can’t be accepted with this email’s account here. Contact Health ID support at '
      + 'support@healthidentitydirectory.com.'],
  ])('tells %s what to do instead', async (accountCase, text) => {
    await openWith({ accountCase })
    // The support address is a link inside the sentence: the sentence is read whole.
    expect((await screen.findByText((_, element) => element?.tagName === 'P' && element.textContent === text))).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('opens the invitation again when the password step has ended', async () => {
    api.accept.mockRejectedValueOnce(new HidApiError(401, 'Invalid', { code: 'STAFF_INVITATION_SESSION_INVALID' }))
    await openWith({})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This step has expired. Continue again to set your password.')
    expect(screen.getByRole('heading', { name: 'Open your invitation' })).toBeTruthy()
  })

  it.each([
    ['STAFF_INVITATION_PATIENT_ACCOUNT', 409, 'This email belongs to a Health ID patient account. Staff accounts need their own '
      + 'email: ask Ikeja Care to invite your work email.'],
    ['STAFF_INVITATION_ACCOUNT_CHANGED', 409, 'Your Health ID account changed while you were joining. Open the invitation again from '
      + 'the email.'],
    ['STAFF_INVITATION_WITHDRAWN', 410, 'This invitation is no longer available: Ikeja Care withdrew it, or can’t take new staff on '
      + 'Health ID right now. Ask the facility about it.'],
  ])('says a refused acceptance (%s) in its own words', async (code, status, text) => {
    api.accept.mockRejectedValueOnce(new HidApiError(status, 'Identity’s detail', { code }))
    await openWith({})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join Ikeja Care' }))
    expect((await screen.findByRole('alert')).textContent).toBe(text)
  })
})

describe('on a staff or admin site', () => {
  it('carries the link to the signed-in join page on a staff site', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.healthidentitydirectory.com', hash: `#${INVITATION}.${TOKEN}` })
    render(<MemoryRouter initialEntries={[linkAddress]}><Routes>
      <Route path="/provider/invitation" element={<StaffInvitation />} />
      <Route path="/provider/staff/join" element={<><h1>Join on the staff site</h1><Where /></>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Join on the staff site' })).toBeTruthy()
    expect(screen.getByTestId('where').textContent).toBe(`/provider/staff/join#${INVITATION}.${TOKEN}`)
    expect(api.open).not.toHaveBeenCalled()
  })

  it('links to the main site’s page from the admin site, without the link', () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'admin.healthidentitydirectory.com' })
    render(<MemoryRouter initialEntries={[linkAddress]}><Routes>
      <Route path="/provider/invitation" element={<StaffInvitation />} />
    </Routes></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Continue to the invitation page' }).getAttribute('href'))
      .toBe('https://app.healthidentitydirectory.com/provider/invitation')
  })
})

describe('focus as soon as it is shown', () => {
  // A request answered outside act, as a fetch's answer arrives, renders in one task and would run its effects in a later one.
  const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true })

  // The step's heading takes focus in the commit that shows it: from an effect a task later, a check made as soon as it
  // was shown found focus still where it was (health#16's CI, on another page).
  it('has focus on the opened invitation’s heading as soon as it is shown', async () => {
    let opens: (value: unknown) => void = () => {}
    api.open.mockReturnValueOnce(new Promise(resolve => { opens = resolve }))
    open(linkAddress)
    await waitFor(() => expect(continueButton().disabled).toBe(false))
    fireEvent.click(continueButton())
    const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Choose a password' }))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    opens(opened())
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
