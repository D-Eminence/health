import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
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

const verified = () => screen.queryByRole('region', { name: 'NIN verified' })

describe('the name on the NIN record, under "NIN verified"', () => {
  it('is shown once the NIN is checked, describes the contact field, and stays until activation', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact', recordName: NAME }), anonymous)
    await submitNin()

    const phone = await screen.findByLabelText('Phone number')
    const panel = verified()!
    expect(within(panel).getByText('NIN verified')).toBeTruthy()
    expect(panel.textContent).toContain(`Name on your NIN record: ${NAME}`)
    expect(panel.textContent).toContain('Check that this is your name before you continue.')
    // A screen reader user, whose focus lands on the field, hears the name too.
    expect(phone.getAttribute('aria-describedby')?.split(' ')).toContain('enroll-record-name')
    expect(document.getElementById('enroll-record-name')?.textContent).toBe(`Name on your NIN record: ${NAME}`)

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

  it('is not shown for a blank name', async () => {
    renderPortal(<Enrollment />, gateway({ stage: 'verify_contact', recordName: '   ' }), anonymous)
    await submitNin()
    await screen.findByLabelText('Phone number')
    expect(verified()).toBeNull()
  })
})
