import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Recovery } from '../routes/Recovery'
import { PrincipalRecovery } from '../routes/PrincipalRecovery'
import { enterCode } from './codeBoxes'

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
    start: api.recoveryStart, verify: api.recoveryVerify, open: () => render(<MemoryRouter><Recovery /></MemoryRouter>),
    // Six boxes (CodeBoxes.tsx): the sixth digit sends the code.
    send: (code: HTMLElement, value: string) => enterCode(code, value) },
  { name: 'provider', field: 'Work email', identifier: 'clinician@example.test', same: /same work email/,
    different: 'Use a different work email',
    start: principal.start, verify: principal.verify, open: () => render(<MemoryRouter><PrincipalRecovery audience="staff" /></MemoryRouter>),
    send: async (code: HTMLElement, value: string) => {
      fireEvent.change(code, { target: { value } })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })
    } },
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
    await page.send(code, '000000')
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

  // A start for the same identifier while its budget is spent sends no code (otp.service.ts start
  // answers it like an unknown identifier), so the note on why none arrives is kept for it.
  it.each([
    ['as it was entered', (identifier: string) => identifier],
    ['in other case and spacing', (identifier: string) => `  ${identifier.toUpperCase()} `],
  ])('keeps the budget note when starting again at once with the same identifier, %s', async (_case, again) => {
    const code = await toCode(page, 60)
    page.verify.mockRejectedValue(refused())
    await page.send(code, '000000')
    await screen.findByText(BUDGET)
    fireEvent.click(screen.getByRole('button', { name: page.different }))
    fireEvent.change(await screen.findByLabelText(page.field), { target: { value: again(page.identifier) } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
    await screen.findByLabelText('Recovery code')
    expect(page.start).toHaveBeenCalledTimes(2)
    expect(screen.getByText(BUDGET)).toBeTruthy()
  })

  it('does not carry the budget note to a code started for another identifier', async () => {
    const code = await toCode(page, 60)
    page.verify.mockRejectedValue(refused())
    await page.send(code, '000000')
    await screen.findByText(BUDGET)
    fireEvent.click(screen.getByRole('button', { name: page.different }))
    fireEvent.change(await screen.findByLabelText(page.field), { target: { value: `other.${page.identifier}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
    await screen.findByLabelText('Recovery code')
    expect(screen.queryByText(BUDGET)).toBeNull()
  })

  // A code accepted shows the budget was not spent: starting again then says nothing of it.
  it('does not carry the budget note past a code that was accepted', async () => {
    const code = await toCode(page, 60)
    page.verify.mockRejectedValueOnce(refused())
    await page.send(code, '000000')
    await screen.findByText(BUDGET)
    page.verify.mockResolvedValueOnce({ verified: true, challengeId: 'challenge-1', verificationToken: 'token-1' })
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: '123456' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })
    await screen.findByLabelText('New password')
    fireEvent.click(screen.getByRole('button', { name: page.different }))
    await screen.findByLabelText(page.field)
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' })) })
    await screen.findByLabelText('Recovery code')
    expect(screen.queryByText(BUDGET)).toBeNull()
  })

  // The wait holds back a repeat for the same identifier (otp_start_cooldowns, migration 0081), and
  // a start for the same account's other identifier too (see below); any other is not held back.
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

/**
 * A start for the same account's other identifier (its email after its Health ID, or the reverse)
 * while the first start's wait runs sends no code: since hid-system #55 otp.service.ts start answers
 * it with a new random challengeId, so the code already sent is not accepted under it; before #55
 * the wait was the account's, and the start answered the same challenge.
 */
describe('patient password recovery and the same account\'s other identifier', () => {
  const OTHER = /^The same account's other email or Health ID will not get a new code until a new code is offered here/
  const patient = pages[0]

  it('says during the wait that the same account\'s other email or Health ID will not get a new code', async () => {
    await toCode(patient, 60)
    const said = screen.getByText(OTHER)
    expect(said.textContent).toMatch(/using it before then may stop the code already sent from being accepted\.$/)
    // It describes the way back to another identifier, which is offered beside it.
    const different = screen.getByRole('button', { name: patient.different })
    expect(different.getAttribute('aria-describedby')).toBe(said.id)
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(screen.queryByText(OTHER)).toBeNull()
    expect(different.hasAttribute('aria-describedby')).toBe(false)
  })

  it('says nothing of a wait when the start names none', async () => {
    await toCode(patient)
    expect(screen.queryByText(OTHER)).toBeNull()
  })
})
