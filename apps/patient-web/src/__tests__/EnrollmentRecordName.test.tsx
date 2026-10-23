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
    expect(screen.queryByRole('button', { name: 'Use a different NIN' })).toBeNull()
  })
})

describe('"Use a different NIN" under the name on the NIN record', () => {
  const OTHER_NIN = '10987654321'
  const OTHER_NAME = 'Bola Fixture Adeyemi'
  /** The start answers the name on the record of the NIN it was sent. */
  const byNin: Handler = (path, method, body) => path === BASE && method === 'POST'
    ? json({ stage: 'verify_contact', recordName: (body as { nin: string }).nin === NIN ? NAME : OTHER_NAME })
    : gateway({ stage: 'verify_contact' })(path, method, body)
  const startKeys = (headers: ReturnType<typeof renderPortal>['headers']) =>
    headers.filter(sent => sent.path === BASE && sent.method === 'POST').map(sent => sent.headers.get('Idempotency-Key'))

  it('goes back to an empty NIN step, and the same NIN resumes with its key while another NIN gets a new one', async () => {
    const { headers } = renderPortal(<Enrollment />, byNin, anonymous)
    await submitNin()
    await screen.findByLabelText('Phone number')
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+2348000000000' } })

    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    const ninField = await screen.findByLabelText('National Identification Number')
    expect((ninField as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(ninField)
    expect(verified()).toBeNull()
    expect(screen.queryByLabelText('Phone number')).toBeNull()
    expect(screen.queryByText(NAME, { exact: false })).toBeNull()

    // The same NIN again is the same registration: its key, so Identity resumes it with no new lookup.
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(NAME)
    // Nothing typed for it before the button is kept.
    expect((screen.getByLabelText('Phone number') as HTMLInputElement).value).toBe('')

    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    await submitNin(OTHER_NIN)
    await screen.findByLabelText('Phone number')
    expect(verified()?.textContent).toContain(OTHER_NAME)
    expect(screen.queryByText(NAME, { exact: false })).toBeNull()

    const [first, again, other] = startKeys(headers)
    expect(first).toBeTruthy()
    expect(again).toBe(first)
    expect(other).toBeTruthy()
    expect(other).not.toBe(first)
  })

  it('is offered at the code and password steps too, and asks Identity for nothing', async () => {
    const { sent } = renderPortal(<Enrollment />, gateway({ stage: 'verify_contact', recordName: NAME }), anonymous)
    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    await screen.findByLabelText('Verification code')
    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Verification code')).toBeNull()

    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    await press(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'a-long-enough-password' } })
    const before = sent.length
    await press(screen.getByRole('button', { name: 'Use a different NIN' }))
    expect((await screen.findByLabelText('National Identification Number') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Password')).toBeNull()
    // Going back cancels nothing: no request is sent for it.
    expect(sent.length).toBe(before)
  })
})
