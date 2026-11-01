import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, Principal } from '../api'
import { PrincipalsPage } from '../Principals'
import { ApprovalRequestForm, ExportPanel, PrincipalSessions } from '../PrincipalSecurity'
import { StepUpProvider } from '../StepUp'
import { ToastProvider } from '../../kasuwa/toast'

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
  memberships: [], version: 4, mfaEnrolled: true }

function open(element: ReactElement) {
  render(<ToastProvider><MemoryRouter><StepUpProvider>{element}</StepUpProvider></MemoryRouter></ToastProvider>)
}

async function confirmStepUp() {
  fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '123456' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
}

beforeEach(() => { vi.clearAllMocks(); mocks.keys = 0 })

describe('principal export', () => {
  /** The export is a drawer opened from the page's Export button. */
  function openExport(query: string) {
    open(<ExportPanel query={query} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    return within(screen.getByRole('dialog', { name: 'Export users (CSV)' }))
  }

  function fill(drawer: ReturnType<typeof openExport>, reason = 'Quarterly access review for audit') {
    fireEvent.change(drawer.getByLabelText('Reason for this export'), { target: { value: reason } })
  }

  const CONFIRM = /I need this export and will handle the file as policy requires/

  it('explains the restrictions and needs a reason and explicit confirmation before exporting', () => {
    const drawer = openExport('')
    expect(drawer.getByText(/Your reason and the row count go in the audit log/)).toBeTruthy()
    expect(drawer.getByText(/At most 5,000 rows/)).toBeTruthy()
    expect(drawer.getByText(/outside Health ID’s control/)).toBeTruthy()
    expect(drawer.getByText('Emails, names, status and roles. Never passwords or sessions.')).toBeTruthy()
    const exportButton = drawer.getByRole('button', { name: 'Export CSV' })
    expect(exportButton).toHaveProperty('disabled', true)
    fill(drawer)
    expect(exportButton).toHaveProperty('disabled', true)
    fireEvent.click(drawer.getByLabelText(CONFIRM))
    expect(exportButton).toHaveProperty('disabled', false)
    expect(drawer.getByLabelText(/Only users matching the search/)).toHaveProperty('disabled', true)
  })

  it('exports after the server-required step-up, saves the file and reports the row count', async () => {
    const blob = new Blob(['account_id\r\n'], { type: 'text/csv' })
    mocks.api.exportPrincipals.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ blob, rowCount: 12, rowLimit: 5000, truncated: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    const drawer = openExport('clinic')
    fireEvent.click(drawer.getByLabelText(/Only users matching the search “clinic”/))
    fireEvent.change(drawer.getByLabelText('Account status'), { target: { value: 'active' } })
    fill(drawer)
    fireEvent.click(drawer.getByLabelText(CONFIRM))
    fireEvent.click(drawer.getByRole('button', { name: 'Export CSV' }))
    await confirmStepUp()
    expect(await screen.findByText('Exported 12 users.')).toBeTruthy()
    expect(mocks.api.exportPrincipals.mock.calls).toEqual([
      [{ reason: 'Quarterly access review for audit', query: 'clinic', status: 'active' }],
      [{ reason: 'Quarterly access review for audit', query: 'clinic', status: 'active' }],
    ])
    expect(mocks.saveFile).toHaveBeenCalledTimes(1)
    expect(mocks.saveFile).toHaveBeenCalledWith(blob, expect.stringMatching(/^hid-principals-\d{4}-\d{2}-\d{2}\.csv$/))
    // The confirmation is per export: the drawer closed, and opened again it asks again.
    expect(screen.queryByRole('dialog', { name: 'Export users (CSV)' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(within(screen.getByRole('dialog', { name: 'Export users (CSV)' })).getByLabelText(CONFIRM)).toHaveProperty('checked', false)
  })

  it('says so when the browser could not read the server row count', async () => {
    mocks.api.exportPrincipals.mockResolvedValueOnce({ blob: new Blob([]), rowCount: null, rowLimit: null, truncated: null })
    const drawer = openExport('')
    fill(drawer)
    fireEvent.click(drawer.getByLabelText(CONFIRM))
    fireEvent.click(drawer.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByText('Export downloaded.')).toBeTruthy()
    expect(screen.queryByText(/Exported \d/)).toBeNull()
    await waitFor(() => expect(mocks.saveFile).toHaveBeenCalledTimes(1))
  })

  it('shows the truncation warning from the backend headers', async () => {
    mocks.api.exportPrincipals.mockResolvedValueOnce({ blob: new Blob([]), rowCount: 5000, rowLimit: 5000, truncated: true })
    const drawer = openExport('')
    fill(drawer)
    fireEvent.click(drawer.getByLabelText(CONFIRM))
    fireEvent.click(drawer.getByRole('button', { name: 'Export CSV' }))
    expect(await drawer.findByText('Downloaded, but cut off at 5,000 rows. Narrow the filter to export the rest.')).toBeTruthy()
    expect(mocks.saveFile).toHaveBeenCalledTimes(1)
  })

  it('explains a restricted export and saves nothing', async () => {
    mocks.api.exportPrincipals.mockRejectedValueOnce(problem(403, 'PERMISSION_DENIED'))
    const drawer = openExport('')
    fill(drawer)
    fireEvent.click(drawer.getByLabelText(CONFIRM))
    fireEvent.click(drawer.getByRole('button', { name: 'Export CSV' }))
    expect(await drawer.findByText('Only Super Admins with the export permission can export.')).toBeTruthy()
    expect(mocks.saveFile).not.toHaveBeenCalled()
  })
})

describe('two-person requests and session governance for a principal', () => {
  /** Opens a request's confirmation and gives the reason. */
  function request(button: string, reason: string) {
    fireEvent.click(screen.getByRole('button', { name: button }))
    const sheet = within(screen.getByRole('dialog'))
    fireEvent.change(sheet.getByLabelText('Reason for this change'), { target: { value: reason } })
    return sheet
  }

  it('creates a Super Admin elevation request with one idempotency key across step-up', async () => {
    mocks.api.requestSuperAdmin.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ requestId: 'request-1', status: 'pending', expiresAt: '2026-10-09T12:00:00.000Z', version: 1, replayed: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open(<ApprovalRequestForm kind="super-admin" principal={principal} />)
    const sheet = request('Request Super Admin', 'Second on-call Super Admin')
    expect(sheet.getByText(/A different Super Admin must approve this within 24 hours/)).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Send request' }))
    await confirmStepUp()
    expect(await screen.findByText(/Request sent\. It waits for a second Super Admin until/)).toBeTruthy()
    expect(mocks.api.requestSuperAdmin.mock.calls).toEqual([
      ['account-2', 'Second on-call Super Admin', 'key-1'], ['account-2', 'Second on-call Super Admin', 'key-1'],
    ])
  })

  it('explains an authenticator reset request and the refusals the backend can return', async () => {
    mocks.api.requestMfaReset.mockRejectedValueOnce(problem(409, 'MFA_NOT_ENROLLED'))
      .mockRejectedValueOnce(problem(409, 'APPROVAL_ALREADY_PENDING'))
    open(<ApprovalRequestForm kind="mfa-reset" principal={principal} />)
    const sheet = request('Request authenticator reset', 'Authenticator lost while travelling')
    expect(sheet.getByText(/they’re signed out everywhere/)).toBeTruthy()
    expect(sheet.getByText(/Their password stays the same/)).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Send request' }))
    expect(await sheet.findByText(/no authenticator to reset/)).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Send request' }))
    expect(await sheet.findByText(/already pending/)).toBeTruthy()
    expect(mocks.api.requestMfaReset.mock.calls).toEqual([
      ['account-2', 'Authenticator lost while travelling', 'key-1'], ['account-2', 'Authenticator lost while travelling', 'key-2'],
    ])
  })

  it('revokes another account’s session as compromised with a reason and security warning', async () => {
    mocks.api.principalSessions.mockResolvedValue({ accountId: 'account-2', items: [{ sessionId: 'session-2', familyId: 'family-2',
      kind: 'platform', authenticationMethod: 'password', signedInAt: '2026-10-08T09:00:00.000Z',
      lastRefreshedAt: '2026-10-08T11:00:00.000Z', idleExpiresAt: '2026-10-08T11:15:00.000Z',
      absoluteExpiresAt: '2026-10-08T17:00:00.000Z', mfaVerifiedAt: '2026-10-08T09:00:00.000Z', mfaMethod: 'totp',
      lastStepUpAt: null, sourceIp: '198.51.100.4', current: false }] })
    mocks.api.revokePrincipalSession.mockResolvedValueOnce({ accountId: 'account-2', revokedCount: 1, replayed: false })
    open(<PrincipalSessions principal={principal} />)
    // Sessions are read only when asked.
    expect(mocks.api.principalSessions).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Show sessions' }))
    expect(await screen.findByText(/198\.51\.100\.4/)).toBeTruthy()

    const sheet = request('Sign out', 'Sign-in from an unknown network')
    fireEvent.click(sheet.getByLabelText('This session may be compromised'))
    expect(sheet.getByText(/marked as compromised in the security log/)).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'End session' }))
    expect(await screen.findByText('Session ended for Ada Operator.')).toBeTruthy()
    expect(mocks.api.revokePrincipalSession).toHaveBeenCalledWith('account-2', 'session-2',
      { reason: 'Sign-in from an unknown network', compromised: true }, 'key-1')
  })
})

describe('principal actions by permission', () => {
  const superAdmin: AdminActor = { accountId: 'admin-1', subject: 'staff:1', displayName: 'Super', email: 's@example.test',
    platformRoles: ['platform_super_admin'], platformPermissions: ['platform.admin.access', 'platform.principal.read',
      'platform.role.manage', 'platform.mfa.reset', 'platform.session.revoke', 'platform.principal.export'] }

  async function openAccount() {
    fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'ada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open Ada Operator' }))
    return within(screen.getByRole('dialog', { name: 'Ada Operator' }))
  }

  it('offers two-person requests instead of a one-step Super Admin grant, and the export to exporters', async () => {
    mocks.api.principals.mockResolvedValueOnce({ items: [principal], page: 1, pageSize: 50, total: 1 })
    open(<PrincipalsPage actor={superAdmin} />)
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
    const drawer = await openAccount()
    expect(drawer.getByRole('button', { name: 'Request Super Admin' })).toBeTruthy()
    expect(drawer.getByRole('button', { name: 'Request authenticator reset' })).toBeTruthy()
    expect(drawer.getByRole('button', { name: 'Show sessions' })).toBeTruthy()

    fireEvent.click(drawer.getByRole('button', { name: 'Change roles' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Change platform roles' }))
    const roleSelect = sheet.getByLabelText('Role') as HTMLSelectElement
    expect([...roleSelect.options].map(option => option.value)).not.toContain('platform_super_admin')
    fireEvent.change(sheet.getByLabelText('Change'), { target: { value: 'revoke' } })
    expect([...(sheet.getByLabelText('Role') as HTMLSelectElement).options].map(option => option.value))
      .toContain('platform_super_admin')
  })

  it('shows view-only rows and no export to an administrator without those permissions', async () => {
    mocks.api.principals.mockResolvedValueOnce({ items: [principal], page: 1, pageSize: 50, total: 1 })
    open(<PrincipalsPage actor={{ ...superAdmin, platformRoles: ['support_admin'],
      platformPermissions: ['platform.admin.access', 'platform.principal.read'] }} />)
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
    const drawer = await openAccount()
    expect(drawer.getByText('Ada Operator', { selector: 'h2' })).toBeTruthy()
    expect(drawer.queryByRole('heading', { name: 'Actions' })).toBeNull()
    expect(drawer.queryAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Close'])
  })
})
