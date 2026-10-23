import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { json, press, problem, renderPortal, type Handler } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

afterEach(() => { vi.restoreAllMocks() })

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
  fireEvent.change(await screen.findByLabelText('National Identification Number'), { target: { value: nin } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}

const CHECK = 'Check that this is your name before you continue. If it is not, the NIN you typed may be wrong. '
  + 'Check it on your NIN slip or in the NIMC app, then select Use a different NIN. For help, contact Health ID support.'
const verified = () => screen.queryByText('NIN verified')?.closest<HTMLElement>('.patient-inline-success') ?? null

describe('the name on the NIN record, under "NIN verified"', () => {
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
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    expect(verified()?.textContent).toContain(NAME)
    await press(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    expect(verified()?.textContent).toContain(NAME)

    await press(screen.getByRole('button', { name: 'Activate Health ID' }))
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
    await press(screen.getByRole('button', { name: 'Send verification code' }))
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
  const STOP = 'Check that this is your name before you continue. If it is not, stop here: the NIN you typed may be wrong. '
    + 'Check it on your NIN slip or in the NIMC app. This registration closes by itself within 24 hours, and you can then start '
    + 'again with the right NIN. For help sooner, contact Health ID support.'
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
    const ninField = await screen.findByLabelText('National Identification Number')
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
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    await screen.findByLabelText('Verification code')
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Verification code')).toBeNull()

    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    await press(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    const before = sent.length
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Password')).toBeNull()
    // Going back cancels nothing: the only request is the read of the registration.
    expect(sent.slice(before).map(request => `${request.method} ${request.path}`)).toEqual([`GET ${BASE}/current`])
  })

  it('is offered without the name too, as after a reload more than 15 minutes after the start', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact' }, { stage: 'verify_contact' }), anonymous)
    await screen.findByLabelText('Phone number')
    expect(verified()).toBeNull()
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
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
  const SOON = new Date(Date.now() + 20 * 60 * 1000).toISOString()
  const PAST = new Date(Date.now() - 60 * 1000).toISOString()
  const at = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const TIED = (until: string) => `You continued with Google for this registration, so a different NIN can be used here only after ${until}. `
    + 'If the name is not yours, stop here and come back then.'
  /** The page's own reads say one thing; GET .../current, read when the button is pressed, says `current`. */
  function pressedWith(shown: unknown, current: () => Response): Handler {
    let pressed = false
    return (path, method, body) => {
      if (path === `${BASE}/current`) { if (pressed) return current(); pressed = true; return json(shown) }
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
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
    expect(verified()?.textContent).toContain(NAME)
  })

  it('keeps the registration when Identity says it is tied to Google but not until when', async () => {
    const tied = { stage: 'verify_contact', googleOnboardingRequired: true }
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => json(tied)), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText('You continued with Google for this registration, so a different NIN can be used here only once that '
      + 'Google sign-up ends, 30 minutes after you continued. If the name is not yours, stop here and come back then.')).toBeTruthy()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
  })

  it('goes back to the NIN step once the Google sign-up has ended, and that step does not wait for Google', async () => {
    const ended = { stage: 'verify_contact', googleOnboardingRequired: true, googleOnboardingExpiresAt: PAST }
    const { sent } = renderPortal(<Enrollment />, pressedWith(ended, () => json(ended)), anonymous)
    await screen.findByLabelText('Phone number')
    expect(screen.getByText('Reconnect the Google account used to start this enrollment.')).toBeTruthy()
    await press(button()!)
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('Reconnect the Google account used to start this enrollment.')).toBeNull()
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(screen.queryByText('Reconnect Google before continuing.')).toBeNull()
    expect(sent.filter(request => request.path === BASE && request.method === 'POST')).toHaveLength(1)
  })

  it('keeps the registration when the check fails, and says so', async () => {
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => problem(503, 'SERVICE_UNAVAILABLE', 'Unavailable')), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByText('We could not check this registration just now, so you are still on it. Try again.')).toBeTruthy()
    expect(screen.getByLabelText('Phone number')).toBeTruthy()
    expect(button()).toBeTruthy()
  })

  it('goes back to the NIN step, saying so, when the registration has already ended', async () => {
    renderPortal(<Enrollment />, pressedWith({ stage: 'verify_contact' }, () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')), anonymous)
    await screen.findByLabelText('Phone number')
    await press(button()!)
    expect(await screen.findByLabelText('National Identification Number')).toBeTruthy()
    expect(screen.getByText(/This registration is no longer open on this device/)).toBeTruthy()
  })
})
