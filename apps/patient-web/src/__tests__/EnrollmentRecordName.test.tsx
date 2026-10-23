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

async function submitNin() {
  fireEvent.change(await screen.findByLabelText('National Identification Number'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}

const CHECK = 'Check that this is your name before you continue. If it is not, stop here: the NIN you typed may be wrong. '
  + 'Check it on your NIN slip or in the NIMC app. This registration closes by itself within 24 hours, and you can then start '
  + 'again with the right NIN. For help sooner, contact Health ID support.'
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
