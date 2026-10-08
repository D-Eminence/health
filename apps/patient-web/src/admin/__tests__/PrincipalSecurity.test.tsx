import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, Principal } from '../api'
import { PrincipalsPage } from '../Principals'
import { ApprovalRequestForm, ExportPanel, PrincipalSessions } from '../PrincipalSecurity'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  api: {
    exportPrincipals: vi.fn(), stepUp: vi.fn(), requestSuperAdmin: vi.fn(), requestMfaReset: vi.fn(),
    principalSessions: vi.fn(), revokePrincipalSession: vi.fn(), principals: vi.fn(), command: vi.fn(),
  },
  saveFile: vi.fn(),
  keys: 0,
}))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => `key-${++mocks.keys}` }))
vi.mock('../download', () => ({ saveFile: mocks.saveFile }))

const problem = (status: number, code: string) => new HidApiError(status, 'Backend detail', { code })
const principal: Principal = { id: 'account-2', subject: 'staff:ada', email: 'ada@example.test', displayName: 'Ada Operator',
  status: 'active', createdAt: '2026-09-01T09:00:00.000Z', platformRoles: ['support_admin'], activeSessionCount: 1,
  memberships: [], version: 4 }

function open(element: ReactElement) {
  render(<MemoryRouter><StepUpProvider>{element}</StepUpProvider></MemoryRouter>)
}

async function confirmStepUp() {
  fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
}

beforeEach(() => { vi.clearAllMocks(); mocks.keys = 0 })

describe('principal export', () => {
  function fill(reason = 'Quarterly access review for audit') {
    fireEvent.change(screen.getByLabelText('Reason for this export'), { target: { value: reason } })
  }

  it('explains the restrictions and needs a reason and explicit confirmation before exporting', () => {
    open(<ExportPanel query="" />)
    expect(screen.getByText(/fresh authenticator confirmation \(step-up, valid 5 minutes\)/)).toBeTruthy()
    expect(screen.getByText(/At most 5,000 rows/)).toBeTruthy()
    expect(screen.getByText(/outside Health ID’s control/)).toBeTruthy()
    const exportButton = screen.getByRole('button', { name: 'Export CSV' })
    fill()
    expect(exportButton).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText(/I confirm this export is necessary/))
    expect(exportButton).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(/Only users matching the current search/)).toHaveProperty('disabled', true)
  })

  it('exports after the server-required step-up, saves the file and reports the row count', async () => {
    const blob = new Blob(['account_id\r\n'], { type: 'text/csv' })
    mocks.api.exportPrincipals.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ blob, rowCount: 12, rowLimit: 5000, truncated: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open(<ExportPanel query="clinic" />)
    fireEvent.click(screen.getByLabelText(/Only users matching the current search/))
    fireEvent.change(screen.getByLabelText('Account status'), { target: { value: 'active' } })
    fill()
    fireEvent.click(screen.getByLabelText(/I confirm this export is necessary/))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await confirmStepUp()
    expect(await screen.findByText('Exported 12 rows.')).toBeTruthy()
    expect(mocks.api.exportPrincipals.mock.calls).toEqual([
      [{ reason: 'Quarterly access review for audit', query: 'clinic', status: 'active' }],
      [{ reason: 'Quarterly access review for audit', query: 'clinic', status: 'active' }],
    ])
    expect(mocks.saveFile).toHaveBeenCalledTimes(1)
    expect(mocks.saveFile).toHaveBeenCalledWith(blob, expect.stringMatching(/^hid-principals-\d{4}-\d{2}-\d{2}\.csv$/))
    // The confirmation is per export.
    expect(screen.getByLabelText(/I confirm this export is necessary/)).toHaveProperty('checked', false)
  })

  it('says so when the browser could not read the server row count', async () => {
    mocks.api.exportPrincipals.mockResolvedValueOnce({ blob: new Blob([]), rowCount: null, rowLimit: null, truncated: null })
    open(<ExportPanel query="" />)
    fill()
    fireEvent.click(screen.getByLabelText(/I confirm this export is necessary/))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText(/did not share its row count with this browser; exports stop at 5,000 rows/)).toBeTruthy()
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledTimes(1))
  })

  it('shows the truncation warning from the backend headers', async () => {
    mocks.api.exportPrincipals.mockResolvedValueOnce({ blob: new Blob([]), rowCount: 5000, rowLimit: 5000, truncated: true })
    open(<ExportPanel query="" />)
    fill()
    fireEvent.click(screen.getByLabelText(/I confirm this export is necessary/))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText(/cut off at the 5,000-row limit/)).toBeTruthy()
  })

  it('explains a restricted export and saves nothing', async () => {
    mocks.api.exportPrincipals.mockRejectedValueOnce(problem(403, 'PERMISSION_DENIED'))
    open(<ExportPanel query="" />)
    fill()
    fireEvent.click(screen.getByLabelText(/I confirm this export is necessary/))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText('Exports are restricted to Super Admins with the export permission.')).toBeTruthy()
    expect(mocks.saveFile).not.toHaveBeenCalled()
  })
})

describe('two-person requests and session governance for a principal', () => {
  it('creates a Super Admin elevation request with one idempotency key across step-up', async () => {
    mocks.api.requestSuperAdmin.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ requestId: 'request-1', status: 'pending', expiresAt: '2026-10-09T12:00:00.000Z', version: 1, replayed: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open(<ApprovalRequestForm kind="super-admin" principal={principal} />)
    expect(screen.getByText(/never granted in one step/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason for this request'), { target: { value: 'Second on-call Super Admin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create elevation request' }))
    await confirmStepUp()
    expect(await screen.findByText(/Request created\. It waits for another Super Admin until/)).toBeTruthy()
    expect(mocks.api.requestSuperAdmin.mock.calls).toEqual([
      ['account-2', 'Second on-call Super Admin', 'key-1'], ['account-2', 'Second on-call Super Admin', 'key-1'],
    ])
  })

  it('explains an authenticator reset request and the refusals the backend can return', async () => {
    mocks.api.requestMfaReset.mockRejectedValueOnce(problem(409, 'MFA_NOT_ENROLLED'))
      .mockRejectedValueOnce(problem(409, 'APPROVAL_ALREADY_PENDING'))
    open(<ApprovalRequestForm kind="mfa-reset" principal={principal} />)
    expect(screen.getByText(/all of their sessions end/)).toBeTruthy()
    expect(screen.getByText(/Their password is not changed/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason for this request'), { target: { value: 'Authenticator lost while travelling' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create reset request' }))
    expect(await screen.findByText(/no authenticator to reset/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Create reset request' }))
    expect(await screen.findByText(/already pending/)).toBeTruthy()
  })

  it('revokes another account’s session as compromised with a reason and security warning', async () => {
    mocks.api.principalSessions.mockResolvedValue({ accountId: 'account-2', items: [{ sessionId: 'session-2', familyId: 'family-2',
      kind: 'platform', authenticationMethod: 'password', signedInAt: '2026-10-08T09:00:00.000Z',
      lastRefreshedAt: '2026-10-08T11:00:00.000Z', idleExpiresAt: '2026-10-08T11:15:00.000Z',
      absoluteExpiresAt: '2026-10-08T17:00:00.000Z', mfaVerifiedAt: '2026-10-08T09:00:00.000Z', mfaMethod: 'totp',
      lastStepUpAt: null, sourceIp: '198.51.100.4', current: false }] })
    mocks.api.revokePrincipalSession.mockResolvedValueOnce({ accountId: 'account-2', revokedCount: 1, replayed: false })
    open(<PrincipalSessions principal={principal} />)
    const details = screen.getByText('Review sessions').closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(await screen.findByText('198.51.100.4')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Sign-in from an unknown network' } })
    fireEvent.click(screen.getByLabelText('This session may be compromised'))
    expect(screen.getByText(/recorded as compromised in the security log/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke session' }))
    expect(await screen.findByText('Session revoked. That device must sign in again.')).toBeTruthy()
    expect(mocks.api.revokePrincipalSession).toHaveBeenCalledWith('account-2', 'session-2',
      { reason: 'Sign-in from an unknown network', compromised: true }, 'key-1')
  })
})

describe('principal actions by permission', () => {
  const superAdmin: AdminActor = { accountId: 'admin-1', subject: 'staff:1', displayName: 'Super', email: 's@example.test',
    platformRoles: ['platform_super_admin'], platformPermissions: ['platform.admin.access', 'platform.principal.read',
      'platform.role.manage', 'platform.mfa.reset', 'platform.session.revoke', 'platform.principal.export'] }

  it('offers two-person requests instead of a one-step Super Admin grant, and the export to exporters', async () => {
    mocks.api.principals.mockResolvedValueOnce({ items: [principal], page: 1, pageSize: 50, total: 1 })
    open(<PrincipalsPage actor={superAdmin} />)
    expect(screen.getByText('Export users (CSV)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const row = (await screen.findByText('Ada Operator')).closest('tr')!
    expect(within(row).getByText('Request Super Admin elevation')).toBeTruthy()
    expect(within(row).getByText('Request authenticator reset')).toBeTruthy()
    expect(within(row).getByText('Review sessions')).toBeTruthy()

    const roleSelect = within(row).getByLabelText('Role') as HTMLSelectElement
    expect([...roleSelect.options].map(option => option.value)).not.toContain('platform_super_admin')
    fireEvent.change(within(row).getByLabelText('Action'), { target: { value: 'revoke' } })
    expect([...(within(row).getByLabelText('Role') as HTMLSelectElement).options].map(option => option.value))
      .toContain('platform_super_admin')
  })

  it('shows view-only rows and no export to an administrator without those permissions', async () => {
    mocks.api.principals.mockResolvedValueOnce({ items: [principal], page: 1, pageSize: 50, total: 1 })
    open(<PrincipalsPage actor={{ ...superAdmin, platformRoles: ['support_admin'],
      platformPermissions: ['platform.admin.access', 'platform.principal.read'] }} />)
    expect(screen.queryByText('Export users (CSV)')).toBeNull()
    fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    const row = (await screen.findByText('Ada Operator')).closest('tr')!
    expect(within(row).getByText('View only')).toBeTruthy()
  })
})
