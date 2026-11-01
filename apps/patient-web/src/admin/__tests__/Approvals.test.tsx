import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { ApprovalsPage } from '../Approvals'
import type { AdminActor, ApprovalRequest } from '../api'
import { StepUpProvider } from '../StepUp'
import { ToastProvider } from '../../kasuwa/toast'

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
  render(<ToastProvider><StepUpProvider><ApprovalsPage actor={actor} /></StepUpProvider></ToastProvider>)
}

/** Presses a decision's button, then gives the reason in its confirmation and confirms (the confirm repeats the decision's name). */
function decide(button: string, reason = 'Confirmed with the requester by phone', scope: HTMLElement = document.body) {
  fireEvent.click(within(scope).getByRole('button', { name: button }))
  const sheet = screen.getByRole('dialog')
  fireEvent.change(within(sheet).getByLabelText('Reason for this change'), { target: { value: reason } })
  fireEvent.click(within(sheet).getByRole('button', { name: button }))
  return sheet
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
    expect(mocks.approvals).toHaveBeenCalledWith('pending', {}, expect.anything())
    expect(screen.getByText('For Chidi Operator · c@example.test')).toBeTruthy()
    decide('Approve')
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    expect(await screen.findByText('Approved. Chidi Operator is now a Super Admin.')).toBeTruthy()
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
    expect(await screen.findByText('Request rejected. Nothing changed.')).toBeTruthy()
    expect(mocks.decideApproval).toHaveBeenCalledTimes(1)
    expect(mocks.decideApproval).toHaveBeenCalledWith(expect.objectContaining({ id: 'request-1', version: 1 }), 'reject',
      'Not agreed with the security lead', 'decision-1')
  })

  it('shows the backend refusal when a requester tries to approve their own request', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request({ requestedBy: 'admin-b' })] })
    mocks.decideApproval.mockRejectedValueOnce(problem(403, 'SELF_APPROVAL_DENIED'))
    open()
    expect(await screen.findByText('You made this request, so another Super Admin must decide. You can cancel it.')).toBeTruthy()
    // The page does not decide this: the request is sent and the server refuses it.
    const sheet = decide('Approve')
    expect(await within(sheet).findByText(/cannot decide a request you made/)).toBeTruthy()
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

    decide('Cancel request', 'No longer needed now', cards[0]!)
    expect(await screen.findByText('Request cancelled. Nothing changed.')).toBeTruthy()
    expect(mocks.decideApproval).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'request-1' }), 'cancel',
      'No longer needed now', 'decision-1')

    const remaining = await screen.findByRole('article')
    const sheet = decide('Approve', 'Looks correct to me', remaining)
    expect(within(remaining).getByRole('dialog')).toBe(sheet)
    expect(await within(sheet).findByText(/enrolled authenticator is required/)).toBeTruthy()
  })

  it('shows expired requests as never carried out and maps an expiry found when deciding', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] })
      .mockResolvedValueOnce({ items: [request({ id: 'request-9', status: 'expired', action: 'mfa.reset', roleCode: null })] })
    mocks.decideApproval.mockRejectedValueOnce(problem(409, 'APPROVAL_EXPIRED'))
    open()
    await screen.findByRole('article')
    const sheet = decide('Reject')
    expect(await within(sheet).findByText(/expired after 24 hours and was not carried out/)).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Expired' }))
    expect(await screen.findByRole('heading', { name: 'Reset authenticator' })).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('expired', {}, expect.anything())
    expect(screen.getByText('Nobody decided within 24 hours, so nothing changed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
  })

  it('pages beyond the first page with the backend cursor, for the same status, with no cap', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()], nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ items: [request({ id: 'request-2', targetDisplayName: 'Dayo Second' })], nextCursor: 'cursor-page-3' })
      .mockResolvedValueOnce({ items: [request({ id: 'request-3', targetDisplayName: 'Efe Third' })], nextCursor: null })
    open()
    expect(await screen.findByText('1 requests, newest first. More below.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    expect(await screen.findByText('For Dayo Second · c@example.test')).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('pending', { cursor: 'cursor-page-2' }, expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    expect(await screen.findByText('For Efe Third · c@example.test')).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('pending', { cursor: 'cursor-page-3' }, expect.any(AbortSignal))
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByText('3 requests, newest first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more requests' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/200\+/)
  })

  it('starts again from the first page when the status changes, and explains a refused cursor', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()], nextCursor: 'cursor-pending' })
      .mockRejectedValueOnce(problem(400, 'ADMIN_INVALID_CURSOR'))
      .mockResolvedValueOnce({ items: [request({ id: 'request-7', status: 'approved', targetDisplayName: 'Gbenga Approved' })],
        nextCursor: null })
    open()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    expect(await screen.findByText(/list position is no longer valid\. Refresh the list to start again/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(await screen.findByText('For Gbenga Approved · c@example.test')).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('approved', {}, expect.anything())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Load more requests' })).toBeNull()
  })

  it('drops a page that arrives after the status changed, and cancels its request', async () => {
    let answer!: (page: unknown) => void
    mocks.approvals.mockResolvedValueOnce({ items: [request()], nextCursor: 'cursor-pending' })
      .mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
      .mockResolvedValueOnce({ items: [request({ id: 'request-7', status: 'approved', targetDisplayName: 'Gbenga Approved' })],
        nextCursor: null })
    open()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Approved' }))
    expect(await screen.findByText('For Gbenga Approved · c@example.test')).toBeTruthy()
    const signal = mocks.approvals.mock.calls[1]![2] as AbortSignal
    expect(signal.aborted).toBe(true)
    answer({ items: [request({ id: 'request-2', targetDisplayName: 'Pending Two' })], nextCursor: 'cursor-pending-3' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('For Pending Two · c@example.test')).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(1)
    expect(screen.getByText('1 requests, newest first')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Load more requests' })).toBeNull()
  })

  it('pages a refreshed list with its own cursor, never with a page loaded for the list before it', async () => {
    let answer!: (page: unknown) => void
    mocks.approvals.mockResolvedValueOnce({ items: [request()], nextCursor: 'cursor-old' })
      .mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
      .mockResolvedValueOnce({ items: [request({ id: 'request-0', targetDisplayName: 'Newest Request' }), request()],
        nextCursor: 'cursor-new' })
      .mockResolvedValueOnce({ items: [request({ id: 'request-2', targetDisplayName: 'Dayo Second' })], nextCursor: null })
    open()
    await screen.findByRole('article')
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('For Newest Request · c@example.test')).toBeTruthy()
    answer({ items: [request({ id: 'request-2', targetDisplayName: 'Dayo Second' })], nextCursor: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByText('For Dayo Second · c@example.test')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Load more requests' }))
    expect(await screen.findByText('For Dayo Second · c@example.test')).toBeTruthy()
    expect(mocks.approvals).toHaveBeenLastCalledWith('pending', { cursor: 'cursor-new' }, expect.any(AbortSignal))
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('tells an administrator who is not a Super Admin that the server decides eligibility', async () => {
    mocks.approvals.mockResolvedValueOnce({ items: [request()] })
    mocks.decideApproval.mockRejectedValueOnce(problem(403, 'APPROVER_INELIGIBLE'))
    open({ ...superAdmin, accountId: 'auditor-1', platformRoles: ['security_auditor'],
      platformPermissions: ['platform.admin.access', 'platform.audit.read'] })
    expect(await screen.findByText('Only a Super Admin who didn’t make the request can decide.')).toBeTruthy()
    const sheet = decide('Approve')
    expect(await within(sheet).findByText(/Only another active Super Admin with an enrolled authenticator/)).toBeTruthy()
  })
})
