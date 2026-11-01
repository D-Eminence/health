import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { json, press, problem, renderPortal, type Handler } from './portalHarness'
import { enterCode } from './codeBoxes'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))
// Offered only where a test sets VITE_HID_GOOGLE_CLIENT_ID.
vi.mock('../GoogleButton', () => ({
  GoogleButton: ({ onCredential, disabled }: { onCredential: (token: string) => Promise<void>; disabled: boolean }) =>
    <button type="button" disabled={disabled} onClick={() => { void onCredential('google-id-token') }}>Sign up with Google</button>,
}))

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const BASE = '/identity/patient-enrollments'
const NIN = '12345678901'
const NAME = 'Amina Fixture Okafor'
const anonymous = { state: { status: 'anonymous', principal: null } } as const

/** Identity on staging-novu-ci-20261005: no holder step, and the start answers the name on the NIN record. */
function gateway(start: unknown, current?: unknown): Handler {
  return (path, method) => {
    if (path === `${BASE}/availability`) return json({ open: true })
    if (path === `${BASE}/current`) return current ? json(current) : problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === BASE && method === 'POST') return json(start)
    if (path === `${BASE}/contact` && method === 'POST') return json({ challengeId: 'challenge-1', expiresInSeconds: 600, resendAfterSeconds: 60 })
    if (path === `${BASE}/contact/verify` && method === 'POST') return json({ stage: 'set_password' })
    if (path === `${BASE}/activate` && method === 'POST') return json({ stage: 'active', hidCode: 'HID-ABCDEF23' })
    return problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}

async function submitNin(nin = NIN) {
  fireEvent.change(await screen.findByLabelText('National Identification Number (NIN)'), { target: { value: nin } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}

const CHECK = 'Not your name? The NIN you typed may be wrong. Check your NIN slip or the NIMC app, then use a different NIN.'
/** The panel headed "NIN checked" (RecordName.tsx), or null. */
const verified = () => screen.queryByText('NIN checked')?.parentElement ?? null

describe('the name on the NIN record, under "NIN checked"', () => {
  it('is shown once the NIN is checked, describes the contact field, and stays until activation', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact', recordName: NAME }), anonymous)
    await submitNin()

    const phone = await screen.findByLabelText('Phone number')
    const panel = verified()!
    expect(panel.textContent).toContain(`Name on your NIN record: ${NAME}`)
    expect(panel.textContent).toContain(CHECK)
    // A screen reader user, whose focus lands on the field, hears the name and what to do about it.
    expect(phone.getAttribute('aria-describedby')?.split(' ')).toContain('enroll-record-name')
    expect(document.getElementById('enroll-record-name')?.textContent).toBe(`Name on your NIN record: ${NAME}${CHECK}`)

    fireEvent.change(phone, { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Code')
    expect(verified()?.textContent).toContain(NAME)
    await enterCode(screen.getByLabelText('Code'), '123456')
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    expect(verified()?.textContent).toContain(NAME)

    await press(screen.getByRole('button', { name: 'Get my Health ID' }))
    expect(await screen.findByText('HID-ABCDEF23')).toBeTruthy()
    expect(verified()).toBeNull()
    expect(screen.queryByText(NAME, { exact: false })).toBeNull()
  })

  it('is shown again after a reload of a pending registration', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact' }, { stage: 'set_password', recordName: NAME }), anonymous)
    await screen.findByLabelText('Password')
    expect(verified()?.textContent).toContain(`Name on your NIN record: ${NAME}`)
  })

  it('is not shown by an Identity that sends no name', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact' }), anonymous)
    await submitNin()
    const phone = await screen.findByLabelText('Phone number')
    expect(verified()).toBeNull()
    expect(phone.getAttribute('aria-describedby') ?? '').not.toContain('enroll-record-name')
  })

  it("reads the contact field's own error before the name", async () => {
    const handler = gateway({ stage: 'verify_contact', recordName: NAME })
    renderPortal(<Enrollment />, (path, method, body) => path === `${BASE}/contact` && method === 'POST'
      ? problem(409, 'CONTACT_ALREADY_REGISTERED', 'This contact is already associated with a Health ID')
      : handler(path, method, body), anonymous)
    await submitNin()
    const phone = await screen.findByLabelText('Phone number')
    fireEvent.change(phone, { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByText('This contact is already associated with a Health ID')
    const described = phone.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(described).toContain('enroll-error')
    expect(described.indexOf('enroll-error')).toBeLessThan(described.indexOf('enroll-record-name'))
  })

  it('is not shown for a blank name', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact', recordName: '   ' }), anonymous)
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()).toBeNull()
  })
})

describe('"Use a different NIN" at the contact, code and password steps', () => {
  const OTHER_NIN = '10987654321'
  const OTHER_NAME = 'Bola Fixture Adeyemi'
  const UNKNOWN_NIN = '19999999999'
  const STOP = 'Not your name? Stop here and check your NIN slip or the NIMC app. This sign-up closes by itself within 24 hours. Then start again with the right NIN.'
  const names: Record<string, string> = { [NIN]: NAME, [OTHER_NIN]: OTHER_NAME }
  const button = () => screen.queryByRole('button', { name: 'Use a different NIN' })
  type Headers = ReturnType<typeof renderPortal>['headers']

  /**
   * Identity at ec2b351: a start for a NIN pending under another key is refused
   * (409 NIN_ALREADY_REGISTERED), and one under its own key resumes. A NIN the
   * registry does not know is refused (422) and leaves nothing pending. GET
   * .../current answers the registration the last successful start set the
   * cookie to.
   */
  function identity(headers: () => Headers): Handler {
    const pending = new Map<string, string>()
    let latest: unknown = null
    return (path, method, body) => {
      if (path === `${BASE}/current`) return latest ? json(latest) : problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
      if (path !== BASE || method !== 'POST') return gateway({ stage: 'verify_contact' })(path, method, body)
      const nin = (body as { nin: string }).nin
      const key = headers().at(-1)?.headers.get('Idempotency-Key') ?? ''
      if (!names[nin]) return problem(422, 'NIN_NOT_VERIFIED', 'The NIN could not be verified')
      const held = pending.get(nin)
      if (held && held !== key) return problem(409, 'NIN_ALREADY_REGISTERED', 'This identity already has a Health ID or a pending enrollment')
      pending.set(nin, key)
      latest = { stage: 'verify_contact', recordName: names[nin] }
      return json(latest)
    }
  }
  function renderIdentity() {
    let sentHeaders: Headers = []
    const view = renderPortal(<Enrollment />, identity(() => sentHeaders), anonymous)
    sentHeaders = view.headers
    return view
  }
  const startKeys = (headers: Headers) =>
    headers.filter(sent => sent.path === BASE && sent.method === 'POST').map(sent => sent.headers.get('Idempotency-Key'))

  it('goes back to an empty NIN step, and the same NIN again resumes its registration with its key', async () => {
    const { headers } = renderIdentity()
    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })

    await press(button()!)
    const ninField = await screen.findByLabelText('National Identification Number (NIN)')
    expect((ninField as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(ninField)
    expect(verified()).toBeNull()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(screen.queryByText(NAME, { exact: false })).toBeNull()

    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(NAME)
    // Nothing typed before the button is kept.
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('')
    const [first, again] = startKeys(headers)
    expect(first).toBeTruthy()
    expect(again).toBe(first)
  })

  it('resumes the first NIN with its own key after another NIN was started in between', async () => {
    const { headers } = renderIdentity()
    await submitNin()
    await screen.findByLabelText('Phone number')
    await press(button()!)
    await submitNin(OTHER_NIN)
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(OTHER_NAME)
    expect(screen.queryByText(NAME, { exact: false })).toBeNull()

    await press(button()!)
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(NAME)
    expect(screen.queryByText('This identity already has a Health ID or a pending enrollment')).toBeNull()
    const [first, other, back] = startKeys(headers)
    expect(other).not.toBe(first)
    expect(back).toBe(first)
  })

  it('resumes the first NIN with its own key after another NIN was refused in between', async () => {
    const { headers } = renderIdentity()
    await submitNin()
    await screen.findByLabelText('Phone number')
    await press(button()!)
    await submitNin(UNKNOWN_NIN)
    expect(await screen.findByText('The NIN could not be verified')).toBeTruthy()
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(NAME)
    const [first, refused, back] = startKeys(headers)
    expect(refused).not.toBe(first)
    expect(back).toBe(first)
  })

  it('is offered at the code and password steps too, and only reads the registration before leaving it', async () => {
    const { sent } = renderIdentity()
    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('Code')
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Code')).toBeNull()

    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send code' }))
    await enterCode(await screen.findByLabelText('Code'), '123456')
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    const before = sent.length
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Password')).toBeNull()
    // Going back cancels nothing: the only request is the read of the registration.
    expect(sent.slice(before).map(request => `${request.method} ${request.path}`)).toEqual([`GET ${BASE}/current`])
  })

  it('is offered without the name too, as after a reload more than 15 minutes after the start', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact' }, { stage: 'verify_contact' }), anonymous)
    await screen.findByLabelText('Phone number')
    expect(verified()).toBeNull()
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe('')
  })

  it.each([
    ['closed', () => json({ open: false })],
    ['not known', () => problem(503, 'SERVICE_UNAVAILABLE', 'Unavailable')],
  ])('is not offered while registration is %s: the advice is to stop and let this registration close', async (_, availability) => {
    const handler = gateway({ stage: 'verify_contact' }, { stage: 'verify_contact', recordName: NAME })
    renderPortal(<Enrollment />, (path, method, body) => path === `${BASE}/availability` ? availability() : handler(path, method, body), anonymous)
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(`Name on your NIN record: ${NAME}`)
    expect(document.getElementById('enroll-record-name')?.textContent).toBe(`Name on your NIN record: ${NAME}${STOP}`)
    expect(button()).toBeNull()
  })

  it.each([
    ['closed', () => json({ open: false })],
    ['not known', () => problem(503, 'SERVICE_UNAVAILABLE', 'Unavailable')],
  ])('is not offered without the name either while registration is %s', async (_, availability) => {
    const handler = gateway({ stage: 'verify_contact' }, { stage: 'verify_contact' })
    renderPortal(<Enrollment />, (path, method, body) => path === `${BASE}/availability` ? availability() : handler(path, method, body), anonymous)
    await screen.findByLabelText('Phone number')
    expect(button()).toBeNull()
  })

  // Identity ties a Google sign-up to one registration only, for 30 minutes (0059): another NIN's start
  // carrying it would be refused (404 GOOGLE_ONBOARDING_NOT_FOUND) after its paid lookup. The button asks
  // Identity when it is pressed, so a sign-up tied in another tab, or by an answer this page lost, counts too.
  /** The registration's expiry, fixed at its first start. */
  const EXPIRES = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
  /** On a whole minute, so the time said is exactly this one. */
  const SOON = new Date(Math.floor((Date.now() + 20 * 60 * 1000) / 60_000) * 60_000).toISOString()
  const PAST = new Date(Date.now() - 60 * 1000).toISOString()
  const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const TIED = (until: string) => `You continued with Google for this sign-up, so a different NIN can be used here only after ${until}. `
    + 'If the name is not yours, stop here and come back then.'
  const TIED_UNNAMED = (until: string) => `You continued with Google for this sign-up, so a different NIN can be used here only ${until}. `
    + 'If you meant to use a different NIN, stop here and come back then.'
  const PENDING = 'Google confirmed your account for this sign-up.'
  /**
   * The page's own reads say one thing; GET .../current, read when the button is pressed, says `current`.
   * GET auth/google/onboarding answers `onboarding`, or 404 (no Google sign-up pending in this browser).
   */
  function pressedWith(shown: unknown, current: () => Response, onboarding?: unknown): Handler {
    let pressed = false
    return (path, method, body) => {
      if (path === `${BASE}/current`) { if (pressed) return current(); pressed = true; return json(shown) }
      if (path === '/auth/google/onboarding' && onboarding) return json(onboarding)
      return gateway({ stage: 'verify_contact' })(path, method, body)
    }
  }

  it.each([
    ['tied to this registration by the page', { stage: 'verify_contact', recordName: NAME, googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }],
    ['tied since, in another tab', { stage: 'verify_contact', recordName: NAME }],
  ])('keeps the registration while a Google sign-up is %s, and says until when', async (_, shown) => {
    const tied = { stage: 'verify_contact', recordName: NAME, googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }
    renderPortal(<Enrollment />, pressedWith(shown, () => json(tied)), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText(TIED(at(SOON)))).toBeTruthy()
    expect(screen.getByLabelText('Phone number')).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(verified()?.textContent).toContain(NAME)
  })

  it('keeps the name it shows while the registration is tied, though Identity no longer sends it 15 minutes after the start', async () => {
    const tied = { stage: 'verify_contact', expiresAt: EXPIRES, googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact', expiresAt: EXPIRES, recordName: NAME }, () => json(tied)), anonymous)
    const phone = await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText(TIED(at(SOON)))).toBeTruthy()
    expect(verified()?.textContent).toContain(NAME)
    expect(phone.getAttribute('aria-describedby')?.split(' ')).toContain('enroll-record-name')
  })

  it.each([
    ['keeps', 30, true],
    ['keeps', 4_000, true],
    ['drops', 6_000, false],
  ])('%s the start answer\'s name when a later read of the registration differs in expiry by %i ms', async (_, gap, kept) => {
    // The start answer computes the expiry just after the insert; later reads return the row's, a little earlier.
    const row = Date.parse(EXPIRES)
    const tied = { stage: 'verify_contact', expiresAt: EXPIRES, googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }
    let started = false
    renderPortal(<Enrollment />, (path, method, body) => {
      if (path === `${BASE}/current`) return started ? json(tied) : problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
      if (path === BASE && method === 'POST') {
        started = true
        return json({ stage: 'verify_contact', recordName: NAME, expiresAt: new Date(row + gap).toISOString() })
      }
      return gateway({ stage: 'verify_contact' })(path, method, body)
    }, anonymous)
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(NAME)
    await press(button()!)
    expect(await screen.findByText(kept ? TIED(at(SOON)) : TIED_UNNAMED(`after ${at(SOON)}`))).toBeTruthy()
    expect(Boolean(verified()?.textContent?.includes(NAME))).toBe(kept)
  })

  it('drops the name it shows when Identity answers for another registration, started since in another tab', async () => {
    const other = { stage: 'set_password', expiresAt: new Date(Date.parse(EXPIRES) + 10 * 60 * 1000).toISOString(),
      googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact', expiresAt: EXPIRES, recordName: NAME }, () => json(other)), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText(TIED_UNNAMED(`after ${at(SOON)}`))).toBeTruthy()
    expect(screen.queryByText(NAME)).toBeNull()
    expect(verified()).toBeNull()
  })

  it('keeps the name it shows after Continue with Google, which reads the registration again', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'google-client')
    const tied = { stage: 'verify_contact', expiresAt: EXPIRES, googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }
    let reads = 0
    renderPortal(<Enrollment />, (path, method, body) => {
      if (path === `${BASE}/current`) return json(++reads === 1 ? { stage: 'verify_contact', expiresAt: EXPIRES, recordName: NAME } : tied)
      if (path === '/auth/oidc/exchange') return json({ stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY', expiresAt: SOON })
      if (path === `${BASE}/google` && method === 'POST') return json({ bound: true })
      return gateway({ stage: 'verify_contact' })(path, method, body)
    }, anonymous)
    await screen.findByLabelText('Phone number')
    const google = within(screen.getByRole('region', { name: 'Sign up with Google' }))
    fireEvent.click(google.getByRole('button', { name: 'Complete check' }))
    await press(google.getByRole('button', { name: 'Sign up with Google' }))
    expect(await screen.findByText(PENDING)).toBeTruthy()
    expect(reads).toBe(2)
    expect(verified()?.textContent).toContain(NAME)
    await press(button()!)
    expect(await screen.findByText(TIED(at(SOON)))).toBeTruthy()
  })

  it('says the time a press is let through, rounded up from an expiry within a minute', async () => {
    const minute = Math.floor((Date.now() + 20 * 60 * 1000) / 60_000) * 60_000
    const tied = { stage: 'verify_contact', recordName: NAME, googleOnboardingRequired: true,
      googleOnboardingExpiresAt: new Date(minute + 30_000).toISOString() }
    renderPortal(<Enrollment />, pressedWith(tied, () => json(tied)), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText(TIED(at(new Date(minute + 60_000).toISOString())))).toBeTruthy()
  })

  it('keeps the registration when Identity says it is tied to Google but not until when, with no name to check', async () => {
    const tied = { stage: 'verify_contact', googleOnboardingRequired: true }
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => json(tied)), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText(TIED_UNNAMED('once that Google sign-up ends, 30 minutes after you continued'))).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(verified()).toBeNull()
  })

  it.each([
    ['tied to Google', { googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }],
    ['not tied to Google', {}],
  ])('shows the Health ID of a registration activated meanwhile and %s, with no message', async (_, google) => {
    const shown = { stage: 'set_password', recordName: NAME, ...google }
    renderPortal(<Enrollment />, pressedWith(shown, () => json({ stage: 'active', hidCode: 'HID-ABCDEF23', ...google })), anonymous)
    await screen.findByLabelText(/^Password/)
    await press(button()!)
    expect(await screen.findByRole('heading', { name: 'Your Health ID is ready' })).toBeTruthy()
    expect(screen.getByText('HID-ABCDEF23')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('National Identification Number (NIN)')).toBeNull()
    expect(screen.queryByText(NAME)).toBeNull()
  })

  it.each([
    ['this page knew was tied', { googleOnboardingRequired: true, googleOnboardingExpiresAt: SOON }],
    ['tied since, in another tab', {}],
  ])('forgets the Google sign-up %s once it has ended, as it leaves', async (_, google) => {
    const shown = { stage: 'verify_contact', recordName: NAME, ...google }
    const ended = { stage: 'verify_contact', googleOnboardingRequired: true, googleOnboardingExpiresAt: PAST }
    renderPortal(<Enrollment />, pressedWith(shown, () => json(ended), { stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY', expiresAt: SOON }), anonymous)
    await screen.findByLabelText('Phone number')
    expect(screen.getByText(PENDING)).toBeTruthy()
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText(PENDING)).toBeNull()
    expect(screen.queryByText('Connect again the Google account you used to start this sign-up.')).toBeNull()
  })

  it('keeps a Google sign-up pending in this browser that is not tied to the registration left', async () => {
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact', recordName: NAME }, () => json({ stage: 'verify_contact' }),
      { stage: 'GOOGLE_AUTHENTICATED_PENDING_IDENTITY', expiresAt: SOON }), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByLabelText('National Identification Number (NIN)')).toBeTruthy()
    expect(screen.getByText(PENDING)).toBeTruthy()
  })

  it('goes back to the NIN step once the Google sign-up has ended, and that step does not wait for Google', async () => {
    const ended = { stage: 'verify_contact', googleOnboardingRequired: true, googleOnboardingExpiresAt: PAST }
    const { sent } = renderPortal(<Enrollment />, pressedWith(ended, () => json(ended)), anonymous)
    await screen.findByLabelText('Phone number')
    expect(screen.getByText('Connect again the Google account you used to start this sign-up.')).toBeTruthy()
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number (NIN)') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Connect again the Google account you used to start this sign-up.')).toBeNull()
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(screen.queryByText('Reconnect Google before continuing.')).toBeNull()
    expect(sent.filter(request => request.path === BASE && request.method === 'POST')).toHaveLength(1)
  })

  it('keeps the registration when the check fails, and says so', async () => {
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => problem(503, 'SERVICE_UNAVAILABLE', 'Unavailable')), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText('We couldn’t check this sign-up just now, so you are still on it. Try again.')).toBeTruthy()
    expect(screen.getByLabelText('Phone number')).toBeTruthy()
    expect(button()).toBeTruthy()
  })

  it('goes back to the NIN step, saying so, when the registration has already ended', async () => {
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByLabelText('National Identification Number (NIN)')).toBeTruthy()
    expect(screen.getByText(/This sign-up is no longer open on this device/)).toBeTruthy()
  })
})
