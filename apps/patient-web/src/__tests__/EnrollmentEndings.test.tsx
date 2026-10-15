import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Enrollment } from '../routes/Enrollment'
import { json, press, problem, renderPortal, type Handler } from './portalHarness'

vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

afterEach(() => { vi.restoreAllMocks() })

const BASE = '/identity/patient-enrollments'
const NIN = '12345678901'
const PASSWORD = 'a-long-enough-password'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
const HOLDER_PROOF_REQUIRED = 'We could not confirm that this NIN is yours, so this registration can\'t be finished. Start again with your NIN, and prove it with a code or at a participating facility.'
const ENDED = 'This registration is no longer open on this device. It may have expired after 24 hours, been replaced by a newer registration for the same NIN, or ended when someone signed in or out in this browser.'

function gateway(start: Handler, post: Record<string, Handler>): Handler {
  return (path, method, body) => {
    if (path === `${BASE}/availability`) return json({ open: true, online: true, facility: true })
    if (path === `${BASE}/current`) return problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found')
    if (path === '/auth/google/onboarding') return problem(404, 'GOOGLE_ONBOARDING_NOT_FOUND', 'No Google sign-up is pending')
    if (path === BASE && method === 'POST') return start(path, method, body)
    const handler = method === 'POST' ? post[path.slice(BASE.length + 1)] : undefined
    return handler ? handler(path, method, body) : problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const startKeys = (headers: Array<{ path: string; method: string; headers: Headers }>) =>
  headers.filter(request => request.path === BASE && request.method === 'POST').map(request => request.headers.get('Idempotency-Key'))

async function submitNin() {
  fireEvent.change(await screen.findByLabelText('National Identification Number'), { target: { value: NIN } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await press(screen.getByRole('button', { name: 'Continue' }))
}
/** A same-key start may resume a registration at the password step (hid-system patient-enrollment.service.ts resume). */
async function toPassword() {
  await submitNin()
  fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
  await press(screen.getByRole('button', { name: 'Activate Health ID' }))
}

/**
 * Activation's answers since the NIN holder step (hid-system main f9dbaf0,
 * #84, ADR-062): 409 NIN_ALREADY_REGISTERED when the NIN was bound since the
 * proof (row 8), and 409 ENROLLMENT_HOLDER_PROOF_REQUIRED when the database
 * finds no valid holder proof, after which a same-key start would only resume
 * the dead registration (row 9).
 */
describe('activation refused after the holder proof', () => {
  it('leads to account recovery, sign-in and support with the reference on 409 NIN_ALREADY_REGISTERED', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ stage: 'set_password', requiredProfileFields: [] }), {
      activate: () => json({ type: 'about:blank', title: 'NIN_ALREADY_REGISTERED', status: 409, code: 'NIN_ALREADY_REGISTERED',
        detail: 'This NIN already has a Health ID. Use account recovery to sign in.', correlationId: 'corr-activation' }, 409) }), anonymous)
    await toPassword()
    const heading = await screen.findByRole('heading', { name: 'This NIN already has a Health ID' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    const outcome = heading.closest('section')!
    expect(within(outcome).getByRole('link', { name: 'Recover your account' }).getAttribute('href')).toBe('/recover')
    expect(within(outcome).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(outcome.textContent).toContain('quote this reference: corr-activation.')
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByLabelText('National Identification Number')).toBeNull()
  })

  it('starts again at the NIN step with a new key on 409 ENROLLMENT_HOLDER_PROOF_REQUIRED', async () => {
    const { headers } = renderPortal(<Enrollment />, gateway(() => json({ stage: 'set_password', requiredProfileFields: [] }), {
      activate: () => problem(409, 'ENROLLMENT_HOLDER_PROOF_REQUIRED', 'Prove that you hold this NIN before you set a password') }), anonymous)
    await toPassword()
    const nin = await screen.findByLabelText('National Identification Number')
    await waitFor(() => expect(document.activeElement).toBe(nin))
    expect((nin as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('alert').textContent).toBe(HOLDER_PROOF_REQUIRED)
    expect(screen.queryByLabelText('Password')).toBeNull()
    await submitNin()
    await screen.findByLabelText('Password')
    const keys = startKeys(headers)
    expect(keys).toHaveLength(2)
    expect(keys[1]).not.toBe(keys[0])
  })
})

/**
 * 404 ENROLLMENT_NOT_FOUND also follows a later proof of the same NIN
 * elsewhere, a deletion after NIN_ALREADY_REGISTERED, or the 24-hour expiry
 * (hid-system 0094), not only a sign-in or sign-out here (Health-id alignment
 * row 10).
 */
describe('a registration that is gone', () => {
  it('says why it may have ended without blaming only a sign-in here', async () => {
    renderPortal(<Enrollment />, gateway(() => json({ stage: 'verify_contact', requiredProfileFields: [] }), {
      contact: () => problem(404, 'ENROLLMENT_NOT_FOUND', 'No pending enrollment was found') }), anonymous)
    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348000000000' } })
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    await screen.findByLabelText('National Identification Number')
    expect(screen.getByRole('alert').textContent).toBe(`${ENDED} Enter your NIN to start again.`)
  })
})

describe('starting again after review', () => {
  it('does not carry the last registration\'s contact into the next one', async () => {
    let start = () => json({ stage: 'verify_contact', requiredProfileFields: [] })
    renderPortal(<Enrollment />, gateway(() => start(), {
      contact: () => json({ challengeId: 'contact-challenge', expiresInSeconds: 600, resendAfterSeconds: 60 }),
      'contact/verify': () => json({ stage: 'set_password', requiredProfileFields: [] }),
      activate: () => problem(409, 'ENROLLMENT_HOLDER_PROOF_REQUIRED', 'Prove that you hold this NIN before you set a password') }), anonymous)
    await submitNin()
    fireEvent.change(await screen.findByLabelText('Phone number'), { target: { value: '+2348011111111' } })
    await press(screen.getByRole('button', { name: 'Send verification code' }))
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } })
    await press(screen.getByRole('button', { name: 'Verify code' }))
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: PASSWORD } })
    await press(screen.getByRole('button', { name: 'Activate Health ID' }))
    await screen.findByLabelText('National Identification Number')
    start = () => json({ stage: 'verify_contact', requiredProfileFields: [] })
    await submitNin()
    expect((await screen.findByLabelText('Phone number') as HTMLInputElement).value).toBe('')
  })
})
