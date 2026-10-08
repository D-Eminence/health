import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ApprovalsPage } from '../Approvals'
import type { AdminActor, ApprovalRequest } from '../api'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({ approvals: vi.fn(), decideApproval: vi.fn(), stepUp: vi.fn(), keys: 0 }))
vi.mock('../api', () => ({
  adminApi: { approvals: mocks.approvals, decideApproval: mocks.decideApproval, stepUp: mocks.stepUp },
  newIdempotencyKey: () => `decision-${++mocks.keys}`,
}))

const problem = (status: number, code: string) => new HidApiError(status, 'Backend detail', { code })

const superAdmin: AdminActor = { accountId: 'admin-b', subject: 'staff:b', displayName: 'Bola Admin', email: 'b@example.test',
  platformRoles: ['platform_super_admin'], platformPermissions: ['platform.admin.access', 'platform.role.manage', 'platform.mfa.reset'] }

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return { id: 'request-1', action: 'platform_role.grant', roleCode: 'platform_super_admin', targetAccountId: 'account-c',
    targetEmail: 'c@example.test', targetDisplayName: 'Chidi Operator', reason: 'Second on-call Super Admin',
    status: 'pending', requestedBy: 'admin-a', requestedAt: '2026-10-08T10:00:00.000Z', expiresAt: '2026-10-09T10:00:00.000Z',
    decidedBy: null, decidedAt: null, decisionReason: null, executedAt: null, version: 1, ...overrides }
}

function open(actor: AdminActor = superAdmin) {
  render(<StepUpProvider><ApprovalsPage actor={actor} /></StepUpProvider>)
}

function decide(button: string, reason = 'Confirmed with the requester by phone') {
  fireEvent.change(screen.getByLabelText('Reason for your decision'), { target: { value: reason } })
  fireEvent.click(screen.getByRole('button', { name: button }))
}

beforeEach(() => { vi.clearAllMocks(); mocks.keys = 0 })

describe('two-person approvals', () => {
  it('lists pending requests and approves one after a server-required step-up, exactly once', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] })
      .mockResolvedValueOnce({ items: [] })
    mocks.decideApproval.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ requestId: 'request-1', status: 'approved', action: 'platform_role.grant',
        targetAccountId: 'account-c', executed: true, version: 2, replayed: false })
    mocks.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open()

    expect(await screen.findByRole('heading', { name: 'Grant Super Admin' })).toBeTruthy()
    expect(mocks.approvals).toHaveBeenCalledWith('pending', expect.anything())
    expect(screen.getByText('Chidi Operator')).toBeTruthy()
    decide('Approve')
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    expect(await screen.findByText('Approved and carried out. Chidi Operator is now a Super Admin.')).toBeTruthy()
    const decision = expect.objectContaining({ id: 'request-1', version: 1 })
    expect(mocks.decideApproval.mock.calls).toEqual([
      [decision, 'approve', 'Confirmed with the requester by phone', 'decision-1'],
      [decision, 'approve', 'Confirmed with the requester by phone', 'decision-1'],
    ])
    await waitFor(() => expect(mocks.approvals).toHaveBeenCalledTimes(2))
  })

  it('sends exactly the decision of the button pressed', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] }).mockResolvedValueOnce({ items: [] })
    mocks.decideApproval.mockResolvedValueOnce({ requestId: 'request-1', status: 'rejected', action: 'platform_role.grant',
      targetAccountId: 'account-c', executed: false, version: 2, replayed: false })
    open()
    await screen.findByRole('article')
    decide('Reject', 'Not agreed with the security lead')
    expect(await screen.findByText('Request rejected. Nothing was changed.')).toBeTruthy()
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1)
    expect(mocks.decideApproval).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-1', version: 1 }), 'reject',
      'Not agreed with the security lead', 'decision-1')
  })

  it('shows the backend refusal when a requester tries to approve their own request', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request({ requestedBy: 'admin-b' })] })
    mocks.decideApproval.mockRejectedValueOnce(problem(403, 'SELF_APPROVAL_DENIED'))
    open()
    expect(await screen.findByText(/You made this request\. A different Super Admin must approve/)).toBeTruthy()
    // The page does not decide this: the request is sent and the server refuses it.
    decide('Approve')
    expect(await screen.findByText(/cannot decide a request you made/)).toBeTruthy()
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1)
  })

  it('lets only the requester cancel, and explains an administrator without enough MFA', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request({ requestedBy: 'admin-b' }), request({ id: 'request-2', version: 3 })] })
    mocks.decideApproval.mockResolvedValueOnce({ requestId: 'request-1', status: 'cancelled', action: 'platform_role.grant',
      targetAccountId: 'account-c', executed: false, version: 2, replayed: false })
      .mockRejectedValueOnce(problem(403, 'MFA_REQUIRED'))
    mocks.approvals.mockResolvedValueOnce({ items: [request({ id: 'request-2', version: 3 })] })
    open()
    const cards = await screen.findAllByRole('article')
    expect(within(cards[0]!).getByRole('button', { name: 'Cancel request' })).toBeTruthy()
    expect(within(cards[1]!).queryByRole('button', { name: 'Cancel request' })).toBeNull()

    fireEvent.change(within(cards[0]!).getByLabelText('Reason for your decision'), { target: { value: 'No longer needed now' } })
    fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Cancel request' }))
    expect(await screen.findByText('Request cancelled. Nothing was changed.')).toBeTruthy()
    expect(mocks.decideApproval).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'request-1' }), 'cancel',
      'No longer needed now', 'decision-1')

    const remaining = await screen.findByRole('article')
    fireEvent.change(within(remaining).getByLabelText('Reason for your decision'), { target: { value: 'Looks correct to me' } })
    fireEvent.click(within(remaining).getByRole('button', { name: 'Approve' }))
    expect(await within(remaining).findByText(/enrolled authenticator is required/)).toBeTruthy()
  })

  it('shows expired requests as never carried out and maps an expiry found when deciding', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] })
      .mockResolvedValueOnce({ items: [request({ id: 'request-9', status: 'expired', action: 'mfa.reset', roleCode: null })] })
    mocks.decideApproval.mockRejectedValueOnce(problem(409, 'APPROVAL_EXPIRED'))
    open()
    await screen.findByRole('article')
    decide('Reject')
    expect(await screen.findByText(/expired after 24 hours and was not carried out/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(await screen.findByRole('heading', { name: 'Reset authenticator' })).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('expired', expect.anything())
    expect(screen.getByText(/expired 24 hours after it was made and was\s+never carried out/)).toBeTruthy()
    expect(screen.queryByLabelText('Reason for your decision')).toBeNull()
  })

  it('tells an administrator who is not a Super Admin that the server decides eligibility', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] })
    mocks.decideApproval.mockRejectedValueOnce(problem(403, 'APPROVER_INELIGIBLE'))
    open({ ...superAdmin, accountId: 'auditor-1', platformRoles: ['security_auditor'],
      platformPermissions: ['platform.admin.access', 'platform.audit.read'] })
    expect(await screen.findByText(/Only a Super Admin other than the requester and the affected\s+administrator can decide/)).toBeTruthy()
    decide('Approve')
    expect(await screen.findByText(/Only another active Super Admin with an enrolled authenticator/)).toBeTruthy()
  })
})
