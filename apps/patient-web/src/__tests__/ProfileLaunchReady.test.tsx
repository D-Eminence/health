import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import type { PatientProfile } from '../api'
import { countryLabel, genderLabel } from '../plainLabels'
import { CardFace } from '../routes/HealthIdCard'
import { AccountDeletionCard } from '../routes/AccountSafety'
import { ProfilePage } from '../routes/Portal'
import { SAY } from '../copy'
import { completionCard, described, json, openContactDetails, openSection, press, problem, profile, renderPortal, sectionToggle,
  shownText, type Handler, type Sent } from './portalHarness'

/**
 * The profile's launch-readiness fixes (the audit of 2 November 2026, ids PPS-04 to PPS-16 and HCS-05): focus after a
 * second tap on a busy button, placeholders while the completion and Insurance & hospital are read, a confirmation
 * before the Access PIN is removed and a way to check the PIN typed, "Sign in again" where a step needs a recent
 * sign-in, the phone without a "Not verified" badge, what a failed deletion confirmation means, the gender in words,
 * an accurate subtitle, a name for More, and a long name on the card.
 */

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

/** The shell's outlet: a wrapper with tabindex -1, which Chromium focuses when a tap lands on a disabled button in it. */
const OUTLET = 'portal-outlet'
const inOutlet = (ui: React.ReactElement) => <div data-testid={OUTLET} tabIndex={-1}>{ui}</div>
/** The second of two quick taps: it lands on the busy (disabled) button, and Chromium focuses the nearest focusable ancestor. */
const secondTap = () => act(() => { screen.getByTestId(OUTLET).focus() })

const withContacts: PatientProfile = { ...profile, email: 'ada.example@example.com', phone: '+2348031234567', phoneVerified: true, hasPhoto: false }
const type = (name: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const PIN = '/identity/me/access-pin'
const deletes = (sent: Sent[]) => sent.filter(request => request.path === PIN && request.method === 'DELETE')

describe('a second tap on a busy button (PPS-04)', () => {
  it('still takes focus to the code step once the code is sent', async () => {
    const answer = deferred()
    renderPortal(inOutlet(<ProfilePage />), (path, method) => {
      if (path === '/identity/me' && method === 'GET') return json(withContacts)
      if (path === '/identity/me/contact-changes' && method === 'POST') return answer.promise
      return problem(404, 'NOT_FOUND', `${method} ${path}`)
    }, {}, { parityB3: true })
    await press(within(await openContactDetails()).getByRole('button', { name: 'Change email address' }))
    type('New email address', 'new.address@example.com')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Send code' }))
    await secondTap()
    await act(async () => { answer.resolve(json({ changeId: 'chg-1', maskedContact: 'n•••@example.test', expiresInSeconds: 600, resendAfterSeconds: 60 }, 201)) })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Digit 1 of 6/ })))
  })

  it('still takes focus back to the PIN field when the save fails', async () => {
    const answer = deferred()
    renderPortal(inOutlet(<ProfilePage />), (path, method) => {
      if (path === '/identity/me') return json(profile)
      if (path === PIN && method === 'POST') return answer.promise
      return problem(404, 'NOT_FOUND', `${method} ${path}`)
    }, {}, { at: '/profile#access-pin' })
    await screen.findByLabelText('Set PIN')
    type('Set PIN', '1234')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await secondTap()
    await act(async () => { answer.resolve(problem(503, 'UPSTREAM_UNAVAILABLE', 'Identity is down')) })
    expect(shownText(await screen.findByRole('alert'))).toBe('Health ID isn’t available right now. Please try again in a few minutes.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Set PIN')))
  })

  it('leaves focus on a control the patient moved to meanwhile', async () => {
    const answer = deferred()
    renderPortal(inOutlet(<ProfilePage />), (path, method) => {
      if (path === '/identity/me') return json(profile)
      if (path === PIN && method === 'POST') return answer.promise
      return problem(404, 'NOT_FOUND', `${method} ${path}`)
    }, {}, { at: '/profile#access-pin' })
    await screen.findByLabelText('Set PIN')
    type('Set PIN', '1234')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    const elsewhere = sectionToggle('About you')
    act(() => { elsewhere.focus() })
    await act(async () => { answer.resolve(problem(503, 'UPSTREAM_UNAVAILABLE', 'Identity is down')) })
    await screen.findByRole('alert')
    expect(document.activeElement).toBe(elsewhere)
  })
})

/** The profile with every B3 read served, each answered by `reads`, and the profile itself served at once. */
function b3Gateway(reads: Partial<Record<string, () => Response | Promise<Response>>> = {}): Handler {
  return (path, method) => {
    const read = reads[`${method} ${path}`]
    if (read) return read()
    if (path === '/identity/me' && method === 'GET') return json({ ...withContacts, gender: 'female', state: 'Lagos' })
    if (path === '/identity/me/photo') return problem(404, 'PHOTO_NOT_FOUND', 'No photo')
    if (path === '/identity/me/profile-details') return json({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 1 })
    if (path === '/ehr/me/health-profile') return problem(404, 'NOT_FOUND', path)
    if (path === '/identity/me/emergency-contacts/availability') return json({ delivery: true, channels: ['sms', 'email'] })
    if (path === '/identity/me/emergency-contacts') return json([])
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const COMPLETION_LOADING = 'Loading your profile completion'

describe('while the completion and Insurance & hospital are first read (PPS-06)', () => {
  it('holds the completion card\'s place with a loading status, and Insurance & hospital\'s with its heading', async () => {
    const details = deferred()
    renderPortal(<ProfilePage />, b3Gateway({ 'GET /identity/me/profile-details': () => details.promise }), {}, { parityB3: true })
    await screen.findByRole('heading', { name: 'About you' })
    const loading = await screen.findByRole('status', { name: COMPLETION_LOADING })
    expect(loading.textContent).toContain(`${COMPLETION_LOADING}…`)
    expect(screen.queryByRole('heading', { name: /^(Finish your profile|Profile complete)$/ })).toBeNull()
    // Before About you, where the card will be: nothing below it moves much when it comes.
    expect(loading.compareDocumentPosition(sectionToggle('About you')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(described(sectionToggle('Insurance & hospital'))).toBe('Loading…')
    // Opened while it is read, it says so.
    const coverage = await openSection('Insurance & hospital')
    expect(within(coverage).getByRole('status', { name: 'Loading your insurance and hospital' })).toBeTruthy()

    await act(async () => { details.resolve(json({ hospitalCurrentlyUsing: 'Lagos General Hospital', hmoName: null, rowVersion: 1 })) })
    await completionCard()
    expect(screen.queryByRole('status', { name: COMPLETION_LOADING })).toBeNull()
    expect(sectionToggle('Insurance & hospital').getAttribute('aria-describedby')).toBeNull()
    expect((within(coverage).getByRole('combobox', { name: 'Hospital you use now' }) as HTMLInputElement).value).toBe('Lagos General Hospital')
  })

  it('shows a loading line in Insurance & hospital while Try again reads it', async () => {
    const second = deferred()
    // Failing until Try again (the client may ask again by itself before it gives up).
    let fail = true
    renderPortal(<ProfilePage />, b3Gateway({ 'GET /identity/me/profile-details': () => fail
      ? problem(500, 'INTERNAL', 'Down') : second.promise }), {}, { parityB3: true })
    const coverage = await openSection('Insurance & hospital')
    const retry = await within(coverage).findByRole('button', { name: 'Try again loading your insurance and hospital' })
    fail = false
    await press(retry)
    const loading = within(coverage).getByRole('status', { name: 'Loading your insurance and hospital' })
    // A first read's status is not inside a busy region (LoadingAnnounced.test.tsx).
    expect(loading.closest('[aria-busy="true"]')).toBeNull()
    await act(async () => { second.resolve(json({ hospitalCurrentlyUsing: null, hmoName: 'Hygeia', rowVersion: 1 })) })
    await waitFor(() => expect((within(coverage).getByRole('textbox', { name: 'HMO (health insurance) (optional)' }) as HTMLInputElement).value).toBe('Hygeia'))
  })

  it('holds no place where Identity does not serve the completion (before 0094)', async () => {
    const details = deferred()
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(profile)
      : path === '/identity/me/profile-details' ? details.promise : problem(404, 'NOT_FOUND', path), {}, { parityB3: true })
    await screen.findByRole('heading', { name: 'About you' })
    expect(screen.queryByRole('status', { name: COMPLETION_LOADING })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Insurance & hospital' })).toBeNull()
    await act(async () => { details.resolve(problem(404, 'NOT_FOUND', 'Not served')) })
  })
})

/** The profile with a PIN set, and DELETE /identity/me/access-pin answered by `remove`. */
function withPin(remove: () => Response | Promise<Response>) {
  let configured = true
  return renderPortal(<ProfilePage />, (path, method) => {
    if (path === '/identity/me') return json({ ...profile, accessPinConfigured: configured })
    if (path === PIN && method === 'DELETE') {
      const answer = remove()
      return Promise.resolve(answer).then(response => { if (response.ok) configured = false; return response })
    }
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }, {}, { at: '/profile#access-pin' })
}
const REMOVE_QUESTION = 'Remove your Access PIN?'

describe('removing the Access PIN (PPS-07)', () => {
  it('asks first, naming what it does, and Cancel keeps the PIN with focus back on Remove PIN', async () => {
    const { sent } = withPin(() => json({ revoked: true }))
    await press(await screen.findByRole('button', { name: 'Remove PIN' }))
    const sheet = within(await screen.findByRole('dialog', { name: REMOVE_QUESTION }))
    expect(sheet.getByText('Hospitals you gave this PIN to won’t be able to use it to open your records.')).toBeTruthy()
    expect(deletes(sent)).toEqual([])
    await press(sheet.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove PIN' })))
    expect(deletes(sent)).toEqual([])
    expect(screen.getByText('Set')).toBeTruthy()
  })

  it('removes it once confirmed, busy on the confirm button only, then says so with focus on the PIN\'s heading', async () => {
    const answer = deferred()
    const { sent } = withPin(() => answer.promise)
    await press(await screen.findByRole('button', { name: 'Remove PIN' }))
    const sheet = within(await screen.findByRole('dialog', { name: REMOVE_QUESTION }))
    await press(sheet.getByRole('button', { name: 'Remove PIN' }))
    expect(deletes(sent)).toHaveLength(1)
    expect(sheet.getByRole('button', { name: 'Removing…' }).getAttribute('aria-busy')).toBe('true')
    // Nothing is being saved: Save PIN is not busy.
    expect(screen.getByRole('button', { name: 'Save PIN' }).getAttribute('aria-busy')).toBeNull()
    await act(async () => { answer.resolve(json({ revoked: true })) })
    expect(await screen.findByText('PIN removed.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Access PIN' })))
    expect(deletes(sent)).toHaveLength(1)
  })

  it('closes the question on a refusal and says why, with focus on Remove PIN', async () => {
    withPin(() => problem(503, 'UPSTREAM_UNAVAILABLE', 'Down'))
    await press(await screen.findByRole('button', { name: 'Remove PIN' }))
    await press(within(await screen.findByRole('dialog', { name: REMOVE_QUESTION })).getByRole('button', { name: 'Remove PIN' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('Health ID isn’t available right now. Please try again in a few minutes.')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove PIN' })))
  })
})

describe('the Access PIN field (PPS-08)', () => {
  it('has a Show PIN toggle, as the other password fields have, so a mistyped PIN can be checked', async () => {
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json(profile) : problem(404, 'NOT_FOUND', path), {}, { at: '/profile#access-pin' })
    const input = await screen.findByLabelText('Set PIN') as HTMLInputElement
    const toggle = screen.getByRole('button', { name: 'Show PIN' })
    expect([input.type, toggle.getAttribute('aria-pressed'), toggle.getAttribute('aria-controls')]).toEqual(['password', 'false', 'access-pin-input'])
    fireEvent.change(input, { target: { value: '12a34' } })
    expect(input.value).toBe('1234')
    await press(toggle)
    expect([input.type, toggle.getAttribute('aria-pressed')]).toEqual(['text', 'true'])
    expect([input.inputMode, input.maxLength, input.autocomplete]).toEqual(['numeric', 8, 'new-password'])
    expect(described(input)).toContain('4 to 8 digits.')
  })
})

/** Where "Sign in again" went: the sign-in page, and the place to come back to. */
function SignInPage() {
  const { state } = useLocation()
  return <p>Sign-in page, back to {(state as { returnTo?: string } | null)?.returnTo ?? 'nowhere'}</p>
}
const signInRoutes = (page: React.ReactElement) => <Routes><Route path="/profile" element={page} /><Route path="/sign-in" element={<SignInPage />} /></Routes>
const RECENT = () => problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before changing this')

describe('a step that needs a recent sign-in (PPS-09)', () => {
  it('offers Sign in again with the Access PIN\'s refusal: it signs out and opens sign-in, to come back to the PIN', async () => {
    const signOut = vi.fn(async () => {})
    renderPortal(signInRoutes(<ProfilePage />), (path, method) => path === '/identity/me' ? json(profile)
      : path === PIN && method === 'POST' ? RECENT() : problem(404, 'NOT_FOUND', path), { signOut }, { at: '/profile#access-pin' })
    await screen.findByLabelText('Set PIN')
    type('Set PIN', '1234')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    const refusal = await screen.findByRole('alert')
    expect(shownText(refusal)).toContain(SAY.signInAgain)
    await press(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByText('Sign-in page, back to /profile#access-pin')).toBeTruthy()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('offers Sign in again with a contact change\'s refusal', async () => {
    const signOut = vi.fn(async () => {})
    renderPortal(signInRoutes(<ProfilePage />), (path, method) => path === '/identity/me' ? json(withContacts)
      : path === '/identity/me/contact-changes' && method === 'POST' ? RECENT() : problem(404, 'NOT_FOUND', path), { signOut }, { parityB3: true, at: '/profile' })
    await press(within(await openContactDetails()).getByRole('button', { name: 'Change phone number' }))
    type('Phone number', '0805 555 1234')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    expect(await screen.findByText(SAY.signInAgain)).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByText('Sign-in page, back to /profile#contact-details')).toBeTruthy()
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('offers Sign in again with Delete account\'s refusal, and its standing line says the rule once, as the PIN\'s does', async () => {
    const signOut = vi.fn(async () => {})
    renderPortal(signInRoutes(<AccountDeletionCard />), (path, method) => method === 'GET'
      ? json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }) : RECENT(), { signOut }, { at: '/profile' })
    expect(await screen.findByText('You must have signed in within the last 10 minutes to delete your account.')).toBeTruthy()
    expect(screen.queryByText(SAY.signInAgain)).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await press(screen.getByRole('button', { name: 'Continue to delete account' }))
    const refusal = await screen.findByRole('alert')
    expect(shownText(refusal)).toContain(SAY.signInAgain)
    expect(screen.getAllByText(SAY.signInAgain)).toHaveLength(1)
    await press(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByText('Sign-in page, back to /profile#account-deletion')).toBeTruthy()
  })

  it('says so when signing out fails, and stays', async () => {
    const signOut = vi.fn(async () => { throw new Error('offline') })
    renderPortal(signInRoutes(<ProfilePage />), (path, method) => path === '/identity/me' ? json(profile)
      : path === PIN && method === 'POST' ? RECENT() : problem(404, 'NOT_FOUND', path), { signOut }, { at: '/profile#access-pin' })
    await screen.findByLabelText('Set PIN')
    type('Set PIN', '1234')
    await press(screen.getByRole('button', { name: 'Save PIN' }))
    await screen.findByRole('alert')
    await press(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByText('We couldn’t sign you out. Please try again.')).toBeTruthy()
    expect(screen.queryByText(/Sign-in page/)).toBeNull()
  })
})

describe('the phone number (PPS-11, owner: no "Not verified" until phone checks exist)', () => {
  it('shows a phone that was not checked by text without a warning, and the step promises nothing for later', async () => {
    const { sent } = renderPortal(<ProfilePage />, (path, method, body) => path === '/identity/me' && method === 'GET'
      ? json({ ...withContacts, phoneVerified: false })
      : path === '/identity/me/contact-changes' && method === 'POST' ? json({ phone: (body as { phone: string }).phone, phoneVerified: false })
        : problem(404, 'NOT_FOUND', path), {}, { parityB3: true })
    const block = within(await openContactDetails())
    expect(block.getByText('Phone').nextElementSibling?.textContent).toBe('+234 •••• 4567')
    expect(block.queryByText('Not verified')).toBeNull()
    await press(block.getByRole('button', { name: 'Change phone number' }))
    const hint = described(screen.getByRole('textbox', { name: 'Phone number' }))
    expect(hint).toBe('Like 0801 234 5678. We’ll email your verified address to say it changed.')
    expect(hint).not.toMatch(/yet|not verified/)
    type('Phone number', '0805 555 1234')
    type('Current password', 'Secret-pass-1')
    await press(screen.getByRole('button', { name: 'Save phone number' }))
    const notice = await screen.findByText(/Your phone number is now \+234 •••• 1234\./)
    expect(notice.textContent).toBe('Your phone number is now +234 •••• 1234. We emailed you about the change.')
    expect(sent.filter(request => request.path === '/identity/me/contact-changes')).toHaveLength(1)
  })

  it('still says Verified for a phone Identity says was checked', async () => {
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json(withContacts) : problem(404, 'NOT_FOUND', path), {}, { parityB3: true })
    const block = within(await openContactDetails())
    expect(block.getByText('Phone').nextElementSibling?.textContent).toBe('+234 •••• 4567Verified')
  })
})

const noDeletion = { waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }
const started = { requestId: 'req-1', confirmationToken: 'A'.repeat(43), confirmationExpiresAt: '2026-10-08T10:10:00Z', waitingPeriodSeconds: 1_209_600 }

describe('a deletion confirmation that did not go through (PPS-12)', () => {
  async function confirmWith(confirm: () => Response | Promise<Response>, request: () => Response | Promise<Response> = () => json(started, 201)) {
    renderPortal(<AccountDeletionCard />, (path, method) => method === 'GET' ? json(noDeletion)
      : path.endsWith('/confirm') ? confirm() : request())
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    await press(screen.getByRole('button', { name: 'Continue to delete account' }))
    fireEvent.change(await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ }), { target: { value: 'DELETE MY ACCOUNT' } })
    await press(screen.getByRole('button', { name: 'Delete my account' }))
  }

  it('says the account wasn\'t deleted when Identity refused it', async () => {
    await confirmWith(() => problem(400, 'ACCOUNT_DELETION_CONFIRMATION_INVALID', 'The confirmation is not valid'))
    expect(shownText(await screen.findByRole('alert'))).toBe('Your account wasn’t deleted. Please start again.')
  })

  it('says the account wasn\'t deleted, and why, for a refusal it knows', async () => {
    await confirmWith(() => problem(403, 'PATIENT_RECENT_RECOVERY_HOLD', 'Recovered recently'))
    expect(shownText(await screen.findByRole('alert'))).toBe('Your account wasn’t deleted. For your safety, you can’t delete your account for 24 hours after you recover it.')
  })

  it('does not claim either way when the answer was lost or Identity failed: the status read again says', async () => {
    await confirmWith(() => problem(503, 'UPSTREAM_UNAVAILABLE', 'Down'))
    expect(shownText(await screen.findByRole('alert'))).toBe('We couldn’t confirm the deletion. Health ID isn’t available right now. Please try again in a few minutes.')
  })

  it('shows Continue and Delete my account busy while each runs', async () => {
    const request = deferred()
    const confirm = deferred()
    renderPortal(<AccountDeletionCard />, (path, method) => method === 'GET' ? json(noDeletion)
      : path.endsWith('/confirm') ? confirm.promise : request.promise)
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    const proceed = screen.getByRole('button', { name: 'Continue to delete account' })
    await press(proceed)
    expect([proceed.textContent, proceed.getAttribute('aria-busy')]).toEqual(['Starting…', 'true'])
    await act(async () => { request.resolve(json(started, 201)) })
    fireEvent.change(await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ }), { target: { value: 'DELETE MY ACCOUNT' } })
    const remove = screen.getByRole('button', { name: 'Delete my account' })
    await press(remove)
    expect([remove.textContent, remove.getAttribute('aria-busy')]).toEqual(['Deleting…', 'true'])
    // Keep my account is not busy: it is not what runs.
    expect(screen.getByRole('button', { name: 'Keep my account' }).getAttribute('aria-busy')).toBeNull()
    await act(async () => { confirm.resolve(json({ requestId: 'req-1', state: 'completed', scheduledFor: '2026-10-08T10:00:00Z', blockedReasonCode: null })) })
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
  })
})

describe('About you (PPS-13)', () => {
  const about = async (changes: Partial<PatientProfile>) => {
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json({ ...profile, ...changes }) : problem(404, 'NOT_FOUND', path))
    const bio = within(await openSection('About you'))
    return (term: string) => bio.getByText(term).nextElementSibling?.textContent
  }

  it('names the gender in words, never as the stored value', async () => {
    const value = await about({ gender: 'female' })
    expect(value('Gender')).toBe('Female')
  })

  it('names the country, never its two-letter code', async () => {
    const value = await about({ country: 'NG' })
    expect(value('Country')).toBe('Nigeria')
  })

  it.each([['NG', 'Nigeria'], ['gh', 'Ghana'], ['Nigeria', 'Nigeria'], ['', 'Not given'], [null, 'Not given']] as const)(
    'names the country %j as %j', (value, label) => {
      expect(countryLabel(value)).toBe(label)
    })

  it('says "Not given" for every detail not there, the date of birth too', async () => {
    const value = await about({ gender: 'unknown', dateOfBirth: null, state: null })
    expect([value('Gender'), value('Date of birth'), value('State')]).toEqual(['Not given', 'Not given', 'Not given'])
  })

  it.each([['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Not given'],
    ['', 'Not given'], [null, 'Not given'], [undefined, 'Not given'], ['FEMALE', 'Female'], ['prefer_not_to_say', 'Prefer not to say']] as const)(
    'labels %j as %j', (value, label) => {
      expect(genderLabel(value)).toBe(label)
    })
})

describe('the profile\'s opening line (PPS-14)', () => {
  it('says what the page holds, not that hospitals see all of it', async () => {
    renderPortal(<ProfilePage />, path => path === '/identity/me' ? json(profile) : problem(404, 'NOT_FOUND', path))
    expect(await screen.findByText('Your details, how you sign in, and your Access PIN.')).toBeTruthy()
    expect(screen.queryByText(/What a hospital sees/)).toBeNull()
  })
})

describe('More (PPS-16)', () => {
  it('is named for what it holds, Delete account, while it is closed', async () => {
    renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' ? json(profile)
      : path === '/identity/me/account-deletion' && method === 'GET' ? json(noDeletion) : problem(404, 'NOT_FOUND', path))
    const summary = await screen.findByText(/^More/, { selector: 'summary' })
    await waitFor(() => expect((summary.closest('details') as HTMLDetailsElement).hidden).toBe(false))
    expect(summary.textContent).toBe('More: delete your account')
    // The visible word stays "More"; the rest is for assistive technology.
    const visible = summary.cloneNode(true) as HTMLElement
    for (const hidden of visible.querySelectorAll('.patient-visually-hidden')) hidden.remove()
    expect(visible.textContent).toBe('More')
  })
})

describe('a long name on the card (HCS-05)', () => {
  const LONG = 'Chiamaka Oluwafunmilayo Nwachukwu-Adeyemi'
  const card = (name: string) => render(<CardFace name={name} hid={<span>HID-ABC234</span>} verified facts={[]} allergies={[]} face={null} still />)

  it('wraps to two lines rather than cutting it off, with the NIN mark outside the wrapped text, and a smaller size', () => {
    card(LONG)
    const name = screen.getByText(LONG)
    const mark = screen.getByLabelText('NIN verified')
    expect(name.className).toMatch(/\bline-clamp-2\b/)
    expect(name.className).toContain('[overflow-wrap:anywhere]')
    expect(name.closest('.truncate')).toBeNull()
    expect(name.contains(mark)).toBe(false)
    expect(mark.closest('.truncate, .line-clamp-2')).toBeNull()
    expect(name.className).toContain('text-[2.8cqw]')
  })

  it('keeps the usual size for a name that fits on one line', () => {
    card('Ada Example')
    const name = screen.getByText('Ada Example')
    expect(name.className).toContain('text-[3.2cqw]')
    expect(name.closest('.truncate')).toBeNull()
    expect(name.contains(screen.getByLabelText('NIN verified'))).toBe(false)
  })
})
