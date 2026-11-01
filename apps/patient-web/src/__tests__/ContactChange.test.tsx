import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientProfile } from '../api'
import { ProfilePage } from '../routes/Portal'
import { enterCode } from './codeBoxes'
import { described, json, openContactDetails, openSection, press, problem, profile, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

/**
 * The contact details on the profile (hid-1.0 parity B3, the lead's decisions), at the end of Bio-data with no heading
 * of their own (the owner's decision of 2026-10-28): a new email needs the current password and the 6-digit code sent
 * to it; a new phone needs the current password only, since production sends no SMS, and is then shown as not
 * verified. The verified email is told either way. A change that goes through ends with focus on its Change button.
 */
const CHANGES = '/identity/me/contact-changes'
const withContacts: PatientProfile = { ...profile, email: 'ada.example@example.com', phone: '+2348031234567', phoneVerified: true, hasPhoto: false }

/** Identity with the contact routes; the profile reads the new contact once a change went through. */
function gateway(answers: { start?: (body: unknown) => Response | undefined; verify?: (body: unknown) => Response } = {}): Handler {
  let current = withContacts
  let started = 0
  return (path, method, body) => {
    if (path === '/identity/me' && method === 'GET') return json(current)
    if (path === CHANGES && method === 'POST') {
      const sent = body as { channel: string; phone?: string }
      const answer = answers.start?.(body) ?? (sent.channel === 'phone' ? json({ phone: sent.phone, phoneVerified: false })
        : json({ changeId: `change-${++started}`, maskedContact: 'n•••@example.com', expiresInSeconds: 600, resendAfterSeconds: 60 }))
      if (answer.ok && sent.channel === 'phone') current = { ...current, phone: sent.phone ?? null, phoneVerified: false }
      return answer
    }
    if (/^\/identity\/me\/contact-changes\/change-\d+\/verify$/.test(path) && method === 'POST') {
      const answer = answers.verify?.(body) ?? json({ email: 'new.address@example.com' })
      if (answer.ok) current = { ...current, email: 'new.address@example.com' }
      return answer
    }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const card = async () => within(await openContactDetails())
const changes = (sent: Sent[]) => sent.filter(request => request.path.startsWith(CHANGES))
const type = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
/** Moves the page's clock on by `seconds` from now on (Date.now only: React's own timing is left alone). */
let ahead = 0
const realNow = Date.now.bind(Date)
const later = (seconds: number) => {
  if (!vi.isMockFunction(Date.now)) vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ahead)
  ahead += seconds * 1000
}
afterEach(() => { ahead = 0; if (vi.isMockFunction(Date.now)) vi.mocked(Date.now).mockRestore() })
/** Starts an email change to new.address@example.com, up to the code step. */
async function startChange() {
  await press((await card()).getByRole('button', { name: 'Change email address' }))
  type('New email address', 'new.address@example.com')
  type('Current password', 'Secret-pass-1')
  await press(screen.getByRole('button', { name: 'Send code' }))
  return screen.findByRole('textbox', { name: /Digit 1 of 6/ })
}

describe('Contact details', () => {
  it('shows the email and phone masked, with whether the phone is verified', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const shown = await card()
    expect(shown.getByText('a•••@example.com')).toBeTruthy()
    expect(shown.getByText(/\+234 •••• 4567/)).toBeTruthy()
    expect(shown.getByText('Verified')).toBeTruthy()
    expect(shown.queryByText('ada.example@example.com')).toBeNull()
    expect(shown.queryByText(/8031234567/)).toBeNull()
    expect(shown.getByRole('button', { name: 'Change email address' })).toBeTruthy()
    expect(shown.getByRole('button', { name: 'Change phone number' })).toBeTruthy()
  })

  it('says an email that was never verified is not, and then does not say the phone change is emailed to it', async () => {
    const unverified = { ...withContacts, emailVerified: false }
    const { sent } = renderPortal(<ProfilePage />, (path, method, body) => path === '/identity/me' && method === 'GET' ? json(unverified)
      : path === CHANGES && method === 'POST' ? json({ phone: (body as { phone: string }).phone, phoneVerified: false })
        : problem(404, 'NOT_FOUND', path), {}, { parityB3: true })
    const shown = await card()
    expect(shown.getByText('Email').nextElementSibling?.textContent).toBe('a•••@example.comNot verified')
    await press(shown.getByRole('button', { name: 'Change phone number' }))
    expect(screen.getByText(/Health ID can’t text it\s+yet, so it will show as not verified\.$/)).toBeTruthy()
    type('Phone number', '0805 555 1234')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    const notice = await screen.findByText(/Your phone number is now \+234 •••• 1234\./)
    expect(notice.textContent).toBe('Your phone number is now +234 •••• 1234. It shows as not verified.')
    expect(changes(sent)).toHaveLength(1)
  })

  it('shows no tag on a verified email', async () => {
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json({ ...withContacts, emailVerified: true })
      : problem(404, 'NOT_FOUND', path), {}, { parityB3: true })
    expect((await card()).getByText('Email').nextElementSibling?.textContent).toBe('a•••@example.com')
  })

  it('is not shown by an Identity that does not send the contacts', async () => {
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(profile) : problem(404, 'NOT_FOUND', path))
    const bio = await openSection('About you')
    expect(within(bio).getByText('Ada Example')).toBeTruthy()
    expect(document.getElementById('contact-details')).toBeNull()
    expect(screen.queryByRole('button', { name: /email address/ })).toBeNull()
  })

  it('is in Bio-data, after its rows, under no heading of its own', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const block = await openContactDetails()
    expect(screen.queryByRole('heading', { name: 'Contact details' })).toBeNull()
    expect(block.closest('#bio-data')).not.toBeNull()
    expect(block.querySelector('h2, h3')).toBeNull()
  })
})

describe('changing the email', () => {
  it('sends a code to the new address with the current password, then changes it with the six-digit code', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    const field = screen.getByRole('textbox', { name: 'New email address' })
    await waitFor(() => expect(document.activeElement).toBe(field))
    type('New email address', ' new.address@example.com ')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))

    expect(await screen.findByText(/We sent it to n•••@example\.com\. It works for 10 minutes\./)).toBeTruthy()
    const first = screen.getByRole('textbox', { name: /Digit 1 of 6/ })
    await waitFor(() => expect(document.activeElement).toBe(first))
    // The password is not kept once the code is sent.
    expect(screen.queryByLabelText('Current password')).toBeNull()
    await enterCode(first, '123456')

    expect(await screen.findByText(/Your email is now n•••@example\.com\. Use it to sign in and reset your password\. We told your old address\./))
      .toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change email address' })))
    expect(changes(sent)).toEqual([
      { path: CHANGES, method: 'POST', body: { channel: 'email', email: 'new.address@example.com', currentPassword: 'Secret-pass-1' } },
      { path: `${CHANGES}/change-1/verify`, method: 'POST', body: { code: '123456' } },
    ])
    // The profile is read again: the new address shows, masked.
    expect(await (await card()).findByText('n•••@example.com')).toBeTruthy()
  })

  it('says a wrong password, clears it and puts focus back in it, as Identity refuses it', async () => {
    renderPortal(<ProfilePage />, gateway({ start: () => problem(403, 'PASSWORD_INCORRECT', 'Password incorrect') }), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'new.address@example.com')
    type('Current password', 'wrong')
    await press(screen.getByRole('button', { name: 'Send code' }))
    const password = await screen.findByLabelText('Current password') as HTMLInputElement
    await waitFor(() => expect(password.value).toBe(''))
    await waitFor(() => expect(document.activeElement).toBe(password))
    expect(password.getAttribute('aria-invalid')).toBe('true')
    expect(described(password)).toContain('Wrong password. Enter the password you use to sign in.')
  })

  it.each([
    ['CONTACT_UNAVAILABLE', 409, 'That email address or phone number can’t be used.'],
    ['PASSWORD_REQUIRED', 409, 'Set a password first, then you can change these.'],
  ])('says %s plainly', async (code, status, message) => {
    renderPortal(<ProfilePage />, gateway({ start: () => problem(status, code, 'refused') }), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'taken@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect((await screen.findByText(message)).textContent).toBe(message)
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy()
  })

  it.each([
    ['in Identity\'s words where it says how long', problem(429, 'CONTACT_CHANGE_RATE_LIMITED', 'Too many incorrect passwords. Try again in 15 minutes.'),
      'Too many incorrect passwords. Try again in 15 minutes.'],
    ['plainly otherwise', problem(429, 'RATE_LIMITED', 'Too many requests'), 'Too many tries. Wait a few minutes, then try again.'],
  ])('says a rate limit %s', async (_label, answer, message) => {
    renderPortal(<ProfilePage />, gateway({ start: () => answer.clone() }), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'new.address@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(shownText(await screen.findByRole('alert'))).toBe(message)
  })

  it('refuses a wrong code on the code itself, and changes nothing', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway({ verify: () => problem(400, 'OTP_INVALID_OR_EXPIRED', 'Invalid code') }), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'new.address@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByRole('textbox', { name: /Digit 1 of 6/ }), '000000')
    const first = await screen.findByRole('textbox', { name: /Digit 1 of 6/ })
    await waitFor(() => expect(described(first)).toContain('That code is wrong or has expired.'))
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect((first as HTMLInputElement).value).toBe('')
    expect(changes(sent).filter(request => request.path.endsWith('/verify'))).toHaveLength(1)
    expect((await card()).getByText('a•••@example.com')).toBeTruthy()
  })

  it('checks the address before asking Identity, and offers a new code from the start', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'ADA.example@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('This is already your email address.')).toBeTruthy()
    type('New email address', 'not an email')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Enter an email address, like name@example.com.')).toBeTruthy()
    expect(changes(sent)).toEqual([])

    type('New email address', 'new.address@example.com')
    await press(screen.getByRole('button', { name: 'Send code' }))
    later(61)
    await press(await screen.findByRole('button', { name: 'Send a new code' }))
    // Back to the address, kept, with the password to enter again.
    const field = await screen.findByRole('textbox', { name: 'New email address' }) as HTMLInputElement
    expect(field.value).toBe('new.address@example.com')
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
  })
})

describe('asking for a new code', () => {
  it('says how long is left before Identity sends one, and keeps the code already sent', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await startChange()
    later(15)
    const resend = screen.getByRole('button', { name: 'Send a new code' })
    await press(resend)
    expect(await screen.findByText('You can get a new code in 45 seconds. The last code we sent still works.')).toBeTruthy()
    // Nothing asked of Identity, the step and focus stay, and the first code still changes the address.
    expect(document.activeElement).toBe(resend)
    expect(screen.queryByLabelText('Current password')).toBeNull()
    await enterCode(screen.getByRole('textbox', { name: /Digit 1 of 6/ }), '123456')
    expect(await screen.findByText(/Your email is now n•••@example\.com\./)).toBeTruthy()
    expect(changes(sent).map(request => request.path)).toEqual([CHANGES, `${CHANGES}/change-1/verify`])
  })

  it('sends a new one after the wait, and the code of the new one is the one checked', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await startChange()
    later(60)
    await press(screen.getByRole('button', { name: 'Send a new code' }))
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByRole('textbox', { name: /Digit 1 of 6/ }), '654321')
    expect(await screen.findByText(/Your email is now n•••@example\.com\./)).toBeTruthy()
    expect(changes(sent).map(request => request.path)).toEqual([CHANGES, CHANGES, `${CHANGES}/change-2/verify`])
  })

  it('goes back to the code already sent when Identity refuses a new one for now, in Identity\'s words', async () => {
    let refuse = false
    const { sent } = renderPortal(<ProfilePage />, gateway({
      start: () => refuse ? problem(429, 'CONTACT_CHANGE_RATE_LIMITED', 'Wait a moment before asking for another code.') : undefined,
    }), {}, { parityB3: true })
    await startChange()
    later(61)
    refuse = true
    await press(screen.getByRole('button', { name: 'Send a new code' }))
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(shownText(await screen.findByRole('alert')))
      .toBe('Wait a moment before asking for another code. The code we sent to n•••@example.com still works. Enter it here.')
    const first = screen.getByRole('textbox', { name: /Digit 1 of 6/ })
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(screen.queryByLabelText('Current password')).toBeNull()
    await enterCode(first, '123456')
    expect(await screen.findByText(/Your email is now n•••@example\.com\./)).toBeTruthy()
    expect(changes(sent).map(request => request.path)).toEqual([CHANGES, CHANGES, `${CHANGES}/change-1/verify`])
  })

  it.each<[string, () => Response, string]>([
    ['409 CONTACT_UNAVAILABLE', () => problem(409, 'CONTACT_UNAVAILABLE', 'refused'),
      'That email address or phone number can’t be used. The code we sent to n•••@example.com no longer works.'],
    ['422 CONTACT_CODE_UNDELIVERABLE', () => problem(422, 'CONTACT_CODE_UNDELIVERABLE', 'The code could not be sent to that address.'),
      'The code could not be sent to that address. The code we sent to n•••@example.com no longer works.'],
    ['a failure with no answer', () => { throw new TypeError('Failed to fetch') }, 'We could not reach the service. Check your connection and try again.'],
  ])('no longer offers the code already sent once a new one fails with %s, as Identity may have ended it', async (_label, answer, message) => {
    let next: (() => Response) | undefined
    const { sent } = renderPortal(<ProfilePage />, gateway({ start: () => next?.() }), {}, { parityB3: true })
    await startChange()
    later(61)
    await press(screen.getByRole('button', { name: 'Send a new code' }))
    expect(screen.getByRole('button', { name: 'Enter the code already sent' })).toBeTruthy()
    next = answer
    type('New email address', 'other.address@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Enter the code already sent' })).toBeNull()
    expect(screen.queryByText(/still works/)).toBeNull()

    // Identity counts that start toward its wait: the wait is said in its words, with no code offered.
    next = () => problem(429, 'CONTACT_CHANGE_RATE_LIMITED', 'Wait a moment before asking for another code.')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(shownText(screen.getByRole('alert'))).toBe('Wait a moment before asking for another code.'))
    expect(screen.queryByRole('textbox', { name: /Digit 1 of 6/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Enter the code already sent' })).toBeNull()
    expect(changes(sent).some(request => request.path.endsWith('/verify'))).toBe(false)
  })

  it('offers the code already sent from the address step, until it expires', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await startChange()
    later(61)
    await press(screen.getByRole('button', { name: 'Send a new code' }))
    await press(await screen.findByRole('button', { name: 'Enter the code already sent' }))
    const first = await screen.findByRole('textbox', { name: /Digit 1 of 6/ })
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(screen.getByText(/We sent it to n•••@example\.com\./)).toBeTruthy()

    later(600)
    await press(screen.getByRole('button', { name: 'Send a new code' }))
    await press(await screen.findByRole('button', { name: 'Enter the code already sent' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('The code we sent has expired. Send a new code.')
    expect(screen.queryByRole('button', { name: 'Enter the code already sent' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'New email address' })))
    expect(changes(sent)).toHaveLength(1)
  })

  it('goes back to Change on Cancel, with nothing sent', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    await press(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change email address' })))
    expect(changes(sent)).toEqual([])
  })
})

describe('verifying an email that is not verified yet', () => {
  /** Identity with an email kept from hid-1.0, never confirmed: a code sent to it verifies it (hid-system 0094 as changed). */
  function unverifiedGateway(start: () => Response = () => json({ changeId: 'change-1', maskedContact: 'a•••@example.com',
    expiresInSeconds: 600, resendAfterSeconds: 60 })): Handler {
    let current: PatientProfile = { ...withContacts, emailVerified: false }
    return (path, method) => {
      if (path === '/identity/me' && method === 'GET') return json(current)
      if (path === CHANGES && method === 'POST') return start()
      if (path === `${CHANGES}/change-1/verify` && method === 'POST') { current = { ...current, emailVerified: true }; return json({ email: current.email }) }
      return problem(404, 'NOT_FOUND', `${method} ${path}`)
    }
  }

  it('offers Verify, sends a code to the address itself, and then says it is verified', async () => {
    const { sent } = renderPortal(<ProfilePage />, unverifiedGateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Verify email address' }))
    expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeTruthy()
    const field = screen.getByRole('textbox', { name: 'Email address' }) as HTMLInputElement
    expect(field.value).toBe('ada.example@example.com')
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(screen.getByText(/Enter it to verify this email\./)).toBeTruthy()
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByRole('textbox', { name: /Digit 1 of 6/ }), '123456')

    const notice = await screen.findByText(/Your email address is verified\./)
    expect(notice.textContent).toBe('Your email address is verified.')
    expect(changes(sent)).toEqual([
      { path: CHANGES, method: 'POST', body: { channel: 'email', email: 'ada.example@example.com', currentPassword: 'Secret-pass-1' } },
      { path: `${CHANGES}/change-1/verify`, method: 'POST', body: { code: '123456' } },
    ])
    // The profile is read again: verified, with nothing more to do.
    const shown = await card()
    await waitFor(() => expect(shown.getByText('Email').nextElementSibling?.textContent).toBe('a•••@example.com'))
    expect(shown.queryByRole('button', { name: 'Verify email address' })).toBeNull()
  })

  it('takes the same address through Change too, while it is not verified', async () => {
    const { sent } = renderPortal(<ProfilePage />, unverifiedGateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'ADA.example@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('textbox', { name: /Digit 1 of 6/ })).toBeTruthy()
    expect(screen.queryByText('This is already your email address.')).toBeNull()
    expect(changes(sent)).toHaveLength(1)
  })

  it('says the address is already verified when Identity answers CONTACT_UNCHANGED for it, and reads the profile again', async () => {
    const { sent } = renderPortal(<ProfilePage />, unverifiedGateway(() => problem(400, 'CONTACT_UNCHANGED', 'The new contact must be different.')), {},
      { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Verify email address' }))
    const reads = () => sent.filter(request => request.path === '/identity/me' && request.method === 'GET').length
    const before = reads()
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Your email address is already verified.')).toBeTruthy()
    expect(screen.queryByText('The new contact must be different.')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull()
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change email address' })))
  })

  it('is not offered for a verified email', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    expect((await card()).queryByRole('button', { name: 'Verify email address' })).toBeNull()
  })
})

describe('changing the phone', () => {
  it('changes it with the current password alone, as E.164, and then shows it as not verified', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change phone number' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Phone number' })))
    type('Phone number', '0805 555 1234')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))

    expect(await screen.findByText(/Your phone number is now \+234 •••• 1234\. It shows as not verified/)).toBeTruthy()
    // The form is gone: focus is on the Change button that started it.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change phone number' })))
    expect(changes(sent)).toEqual([{ path: CHANGES, method: 'POST', body: { channel: 'phone', phone: '+2348055551234', currentPassword: 'Secret-pass-1' } }])
    const shown = await card()
    // The profile is read again: the phone row says the new number, not verified.
    await waitFor(() => expect(shown.getByText('Phone').nextElementSibling?.textContent).toBe('+234 •••• 1234Not verified'))
    // No code is asked for: production sends no SMS.
    expect(screen.queryByRole('textbox', { name: /Digit 1 of 6/ })).toBeNull()
  })

  it('refuses a number that is not one, or the same number, before asking Identity', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change phone number' }))
    type('Phone number', '123')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    expect(await screen.findByText(/Enter a valid phone number for the country you chose/)).toBeTruthy()
    type('Phone number', '0803 123 4567')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    expect(await screen.findByText('This is already your phone number.')).toBeTruthy()
    expect(changes(sent)).toEqual([])
  })

  it('refuses a number another account holds without saying more', async () => {
    renderPortal(<ProfilePage />, gateway({ start: () => problem(409, 'CONTACT_UNAVAILABLE', 'refused') }), {}, { parityB3: true })
    await press((await card()).getByRole('button', { name: 'Change phone number' }))
    type('Phone number', '+44 7700 900123')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    const field = screen.getByRole('textbox', { name: 'Phone number' })
    await waitFor(() => expect(described(field)).toContain('That email address or phone number can’t be used.'))
    await waitFor(() => expect(document.activeElement).toBe(field))
  })
})
