import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { AdminActor } from '../api'
import { PrincipalsPage } from '../Principals'
import { StepUpProvider } from '../StepUp'

/**
 * Novu has account status, platform role and revoke-all-sessions commands, but
 * no two-person approvals and no list of an account's sessions.
 */
const mocks = vi.hoisted(() => ({ principals: vi.fn(), command: vi.fn(), principalSessions: vi.fn() }))
vi.mock('../api', () => ({ adminApi: mocks, newIdempotencyKey: () => 'key-1' }))

const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })
const SUPPORT_ADMIN = ['platform.admin.access', 'platform.principal.read', 'platform.session.revoke']
const SUPER_ADMIN = ['platform.admin.access', 'platform.principal.read', 'platform.principal.manage', 'platform.role.manage',
  'platform.session.revoke', 'platform.audit.read']
const principal = { id: 'account-2', subject: 'staff:ada', email: 'ada@example.test', displayName: 'Ada Operator', status: 'active',
  createdAt: '2026-09-01T09:00:00.000Z', platformRoles: [], activeSessionCount: 2, version: 2, memberships: [] }

/** Searches, then opens the account's drawer, where its actions are. */
async function search(permissions: string[], found = principal) {
  mocks.principals.mockResolvedValue({ items: [found], page: 1, pageSize: 25, total: 1 })
  render(<MemoryRouter><StepUpProvider><PrincipalsPage actor={actor(permissions)} /></StepUpProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: 'ada' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Open Ada Operator' }))
  return screen.getByRole('dialog', { name: 'Ada Operator' })
}

/** The role change's confirmation, opened from the drawer: what it says about Super Admin. */
function roleSheet(drawer: HTMLElement) {
  fireEvent.click(within(drawer).getByRole('button', { name: 'Change roles' }))
  return screen.getByRole('dialog', { name: 'Change platform roles' })
}

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
afterEach(() => { vi.unstubAllEnvs() })

describe('Users and roles on Novu', () => {
  it('offers the role, status and revoke-all commands Novu has, and none of the approval or session-review ones', async () => {
    const drawer = await search([...SUPER_ADMIN, 'platform.mfa.reset'])
    expect(within(drawer).getByRole('button', { name: 'Disable account' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Change roles' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Sign out everywhere' })).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Request Super Admin' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Request authenticator reset' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Show sessions' })).toBeNull()
    const sheet = roleSheet(drawer)
    expect(within(sheet).getByText('Super Admin can’t be given here.')).toBeTruthy()
    expect(within(sheet).queryByText(/second Super Admin approves/)).toBeNull()
    expect((within(sheet).getByLabelText('Role') as HTMLSelectElement).querySelector('option[value="platform_super_admin"]')).toBeNull()
    await waitFor(() => expect(mocks.principals).toHaveBeenCalledTimes(1))
    expect(mocks.principalSessions).not.toHaveBeenCalled()
  })

  it('offers a support administrator nothing for an account with no session to revoke', async () => {
    const drawer = await search(SUPPORT_ADMIN, { ...principal, activeSessionCount: 0 })
    expect(within(drawer).queryByRole('heading', { name: 'Actions' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Sign out everywhere' })).toBeNull()
  })

  it('offers a support administrator only the revoke-all command', async () => {
    const drawer = await search(SUPPORT_ADMIN)
    expect(within(drawer).getByRole('button', { name: 'Sign out everywhere' })).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Show sessions' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Change roles' })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: 'Disable account' })).toBeNull()
  })

  it('keeps the approval and session-review commands on the main backend', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const drawer = await search([...SUPER_ADMIN, 'platform.mfa.reset'])
    expect(within(drawer).getByRole('button', { name: 'Request Super Admin' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Request authenticator reset' })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Show sessions' })).toBeTruthy()
    expect(within(roleSheet(drawer)).getByText('Super Admin needs a request that a second Super Admin approves.')).toBeTruthy()
  })
})
