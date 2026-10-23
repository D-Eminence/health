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

async function search(permissions: string[]) {
  mocks.principals.mockResolvedValue({ items: [principal], page: 1, pageSize: 25, total: 1 })
  render(<MemoryRouter><StepUpProvider><PrincipalsPage actor={actor(permissions)} /></StepUpProvider></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Search users'), { target: { value: 'ada' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  return (await screen.findByText('Ada Operator')).closest('tr')!
}

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
afterEach(() => { vi.unstubAllEnvs() })

describe('Users and roles on Novu', () => {
  it('offers the role, status and revoke-all commands Novu has, and none of the approval or session-review ones', async () => {
    const row = await search([...SUPER_ADMIN, 'platform.mfa.reset'])
    expect(within(row).getByText('Change account status')).toBeTruthy()
    expect(within(row).getByText('Change platform role')).toBeTruthy()
    expect(within(row).getByText('Revoke all sessions')).toBeTruthy()
    expect(within(row).queryByText('Request Super Admin elevation')).toBeNull()
    expect(within(row).queryByText('Request authenticator reset')).toBeNull()
    expect(within(row).queryByText('Review sessions')).toBeNull()
    expect(within(row).getByText('Super Admin is not granted from this console.')).toBeTruthy()
    expect(within(row).queryByText(/elevation request/)).toBeNull()
    await waitFor(() => expect(mocks.principals).toHaveBeenCalledTimes(1))
    expect(mocks.principalSessions).not.toHaveBeenCalled()
  })

  it('offers a support administrator only the revoke-all command', async () => {
    const row = await search(SUPPORT_ADMIN)
    expect(within(row).getByText('Revoke all sessions')).toBeTruthy()
    expect(within(row).queryByText('Review sessions')).toBeNull()
  })

  it('keeps the approval and session-review commands on the main backend', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    const row = await search([...SUPER_ADMIN, 'platform.mfa.reset'])
    expect(within(row).getByText('Request Super Admin elevation')).toBeTruthy()
    expect(within(row).getByText('Request authenticator reset')).toBeTruthy()
    expect(within(row).getByText('Review sessions')).toBeTruthy()
    expect(within(row).getByText(/granted only through an elevation request/)).toBeTruthy()
  })
})
