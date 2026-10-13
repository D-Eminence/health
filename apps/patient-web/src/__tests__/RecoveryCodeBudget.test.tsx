import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Recovery } from '../routes/Recovery'
import { PrincipalRecovery } from '../routes/PrincipalRecovery'

const api = vi.hoisted(() => ({ recoveryStart: vi.fn(), recoveryVerify: vi.fn(), recoveryComplete: vi.fn() }))
const principal = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), complete: vi.fn() }))

vi.mock('../session', () => ({ useSession: () => ({ api }) }))
vi.mock('../recoveryApi', () => ({ createPrincipalRecoveryApi: () => principal }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

/**
 * hid-system #55 (identity otp.service.ts; INTERFACE_CONTRACT.md, recovery start
 * and verification). Within `resendAfterSeconds` a repeat start for the same
 * identifier answers the same challenge and sends nothing, so starting again
 * before then gets no new code. Wrong codes count against one budget per account:
 * by default the fifth within 15 minutes refuses every code, a correct one too,
 * for 15 minutes, and a start meanwhile sends no code. Every refusal is
 * 403 OTP_INVALID_OR_EXPIRED.
 */
const refused = () => new HidApiError(403, 'The verification code is invalid or expired', { code: 'OTP_INVALID_OR_EXPIRED' })
const BUDGET = /After 5 wrong codes within 15 minutes, every code is refused, even a correct one/

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers() })

const pages = [
  { name: 'patient', field: 'Email or Health ID', identifier: 'patient@example.test', same: /same email or Health ID/,
    different: 'Use a different email or Health ID',
    start: api.recoveryStart, verify: api.recoveryVerify, open: () => render(<MemoryRouter><Recovery /></MemoryRouter>) },
  { name: 'provider', field: 'Work email', identifier: 'clinician@example.test', same: /same work email/,
    different: 'Use a different work email',
    start: principal.start, verify: principal.verify, open: () => render(<MemoryRouter><PrincipalRecovery audience="staff" /></MemoryRouter>) },
] as const
const NEW_CODE = 'Start again for a new code'

async function toCode(page: (typeof pages)[number], resendAfterSeconds?: number) {
  page.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1', deliveryChannels: ['email', 'sms'], expiresInSeconds: 600,
    ...(resendAfterSeconds === undefined ? {} : { resendAfterSeconds }) })
  page.open()
  fireEvent.change(screen.getByLabelText(page.field), { target: { value: page.identifier } })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
  return screen.findByLabelText('Recovery code')
}

describe.each(pages)('$name password recovery', page => {
  it('says, once a code is refused, that a spent code budget refuses every code and sends none', async () => {
    const code = await toCode(page, 60)
    expect(screen.queryByText(BUDGET)).toBeNull()
    page.verify.mockRejectedValue(refused())
    fireEvent.change(code, { target: { value: '000000' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })
    const hint = await screen.findByText(BUDGET)
    expect(hint.textContent).toMatch(/no new code is sent/)
  })

  it('offers a new code only once one can be sent, announces it, and keeps the identifier', async () => {
    await toCode(page, 60)
    // Mounted throughout the wait, so what appears in it is announced.
    const region = screen.getByRole('status')
    expect(screen.queryByRole('button', { name: NEW_CODE })).toBeNull()
    await act(async () => { vi.advanceTimersByTime(59_000) })
    expect(screen.queryByRole('button', { name: NEW_CODE })).toBeNull()
    await act(async () => { vi.advanceTimersByTime(1_000) })
    const again = screen.getByRole('button', { name: NEW_CODE })
    expect(region.textContent).toMatch(page.same)
    expect(region.contains(again)).toBe(true)
    fireEvent.click(again)
    expect((await screen.findByLabelText(page.field) as HTMLInputElement).value).toBe(page.identifier)
  })

  // The wait holds back only a repeat for the same identifier (otp_start_cooldowns, migration 0081).
  it('offers at once a way back to correct the identifier', async () => {
    await toCode(page, 60)
    fireEvent.click(screen.getByRole('button', { name: page.different }))
    const field = await screen.findByLabelText(page.field) as HTMLInputElement
    expect(field.value).toBe(page.identifier)
    await waitFor(() => expect(document.activeElement).toBe(field))
  })

  it('offers a new code at once when the start names no wait', async () => {
    await toCode(page)
    expect(screen.getByRole('button', { name: NEW_CODE })).toBeTruthy()
  })
})
