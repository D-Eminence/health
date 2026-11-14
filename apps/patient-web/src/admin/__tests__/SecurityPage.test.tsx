import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { MfaStatus, PlatformSessionInfo } from '../api'
import { SecurityPage } from '../SecurityPage'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  mfaStatus: vi.fn(), sessions: vi.fn(), regenerateRecoveryCodes: vi.fn(), revokeOwnSession: vi.fn(), stepUp: vi.fn(),
}))
vi.mock('../api', () => ({ adminApi: mocks, newIdempotencyKey: () => 'key-1' }))
vi.mock('../download', () => ({ saveFile: vi.fn() }))

const problem = (status: number, code: string) => new HidApiError(status, 'Backend detail', { code })

function status(overrides: Partial<MfaStatus> = {}): MfaStatus {
  return { enrolled: true, factorType: 'totp', activatedAt: '2026-10-01T09:00:00.000Z', lastUsedAt: '2026-10-08T11:00:00.000Z',
    recoveryCodesRemaining: 8, session: { mfaVerifiedAt: '2026-10-08T11:00:00.000Z', mfaMethod: 'totp', stepUpExpiresAt: null,
      idleExpiresAt: '2026-10-08T11:15:00.000Z', absoluteExpiresAt: '2026-10-08T19:00:00.000Z' }, ...overrides }
}

function session(id: string, current = false): PlatformSessionInfo {
  return { sessionId: id, familyId: `family-${id}`, kind: 'platform', authenticationMethod: 'password',
    signedInAt: '2026-10-08T09:00:00.000Z', lastRefreshedAt: '2026-10-08T11:00:00.000Z', idleExpiresAt: '2026-10-08T11:15:00.000Z',
    absoluteExpiresAt: '2026-10-08T17:00:00.000Z', mfaVerifiedAt: '2026-10-08T09:00:00.000Z', mfaMethod: 'totp',
    lastStepUpAt: null, sourceIp: '203.0.113.7', current }
}

function open(onSignOut = vi.fn()) {
  render(<StepUpProvider><SecurityPage onSignOut={onSignOut} /></StepUpProvider>)
  return onSignOut
}

beforeEach(() => { vi.clearAllMocks() })

describe('platform administrator security page', () => {
  it('shows the server-reported MFA state and warns after a recovery-code sign-in or with few codes left', async () => {
    mocks.mfaStatus.mockResolvedValueOnce(status({ recoveryCodesRemaining: 2,
      session: { ...status().session!, mfaMethod: 'recovery_code', stepUpExpiresAt: '2026-10-08T11:04:00.000Z' } }))
    mocks.sessions.mockResolvedValueOnce({ accountId: 'admin-1', items: [session('s1', true)] })
    open()
    expect(await screen.findByText('Authenticator app enrolled')).toBeTruthy()
    expect(screen.getByText(/Recovery code ·/)).toBeTruthy()
    expect(screen.getByText(/Valid until/)).toBeTruthy()
    expect(screen.getByText(/You signed in with a recovery\s+code/)).toBeTruthy()
    expect(screen.getByText(/Only 2 recovery codes are left/)).toBeTruthy()
  })

  it('creates new recovery codes only after the server-required step-up and shows them once', async () => {
    mocks.mfaStatus.mockResolvedValue(status())
    mocks.sessions.mockResolvedValue({ accountId: 'admin-1', items: [session('s1', true)] })
    mocks.regenerateRecoveryCodes.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ recoveryCodes: ['AAAAA-BBBBB', 'CCCCC-DDDDD'] })
    mocks.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T11:05:00.000Z' })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Create new recovery codes' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('AAAAA-BBBBB')).toBeTruthy()
    expect(mocks.regenerateRecoveryCodes).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByLabelText('I have stored these recovery codes somewhere safe'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText('AAAAA-BBBBB')).toBeNull())
    expect(mocks.mfaStatus).toHaveBeenCalledTimes(2)
  })

  it('lists sessions without token material, revokes another session and signs out the current one', async () => {
    mocks.mfaStatus.mockResolvedValue(status())
    mocks.sessions.mockResolvedValue({ accountId: 'admin-1', items: [session('s1', true), session('s2'), session('s3')] })
    mocks.revokeOwnSession.mockResolvedValue({ sessionId: 's2', revokedCount: 1 })
    const onSignOut = open()
    const table = await screen.findByRole('table')
    expect(within(table).getByText('This session')).toBeTruthy()
    expect(within(table).getAllByText('203.0.113.7')).toHaveLength(3)
    expect(table.textContent).not.toMatch(/jti|token|hash|secret/i)

    const rows = within(table).getAllByRole('row')
    fireEvent.click(within(rows[2]!).getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByText('Session revoked.')).toBeTruthy()
    expect(mocks.revokeOwnSession).toHaveBeenCalledWith('s2')

    fireEvent.click(within(await screen.findByRole('table')).getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('signs out every other session and reports a partial failure honestly', async () => {
    mocks.mfaStatus.mockResolvedValue(status())
    mocks.sessions.mockResolvedValue({ accountId: 'admin-1', items: [session('s1', true), session('s2'), session('s3')] })
    mocks.revokeOwnSession.mockResolvedValueOnce({ sessionId: 's2', revokedCount: 1 })
      .mockRejectedValueOnce(problem(503, 'ADMIN_COMMAND_UNAVAILABLE'))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out all other sessions' }))
    expect(await screen.findByText(/1 of 2 sessions were revoked\. The session could not be revoked\./)).toBeTruthy()
    expect(mocks.revokeOwnSession.mock.calls).toEqual([['s2'], ['s3']])
  })
})
