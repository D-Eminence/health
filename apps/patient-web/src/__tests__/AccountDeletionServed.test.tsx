import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AccountDeletionStatus, PatientNotification } from '../api'
import { AccountDeletionCard } from '../routes/AccountSafety'
import { ProfilePage } from '../routes/Portal'
import { NOTIFICATION_SUBJECTS, notificationTitle } from '../routes/notificationTitles'
import { accountDeletionServed, forgetAccountDeletionServed } from '../accountDeletionServed'
import { json, press, problem, profile, renderPortal, type Handler, type Sent } from './portalHarness'

const backend = vi.hoisted(() => ({ novu: true }))
vi.mock('../backendContract', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), usesNovuBackend: () => backend.novu,
}))
beforeEach(() => { backend.novu = true; forgetAccountDeletionServed() })

/**
 * Delete my account on Novu (hid-1.0 parity B5, hid-system 0096; contract b45-contract.md §3.1, §3.4): the profile shows
 * its last section only once its status read says it is served, and nothing (no card, no alert) where it answers 404, as today's
 * backend does. Requesting, the waiting period with its end date in WAT, cancelling during it, what is kept, the new
 * recovery-hold refusal, and the three inbox notices.
 */
const noRequest: AccountDeletionStatus = { waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }
const token = 'A'.repeat(43)
const notFound = (path: string) => problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`)
const deletionRequests = (sent: Sent[]) => sent.filter(request => request.path.includes('account-deletion'))
  .map(request => `${request.method} ${request.path}`)
const settled = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })

function held() {
  let release!: (response: Response) => void
  const promise = new Promise<Response>(resolve => { release = resolve })
  return { promise, release }
}

/**
 * The profile on Novu, opened at its Delete account (Settings is gone: the owner's decision of 2026-10-28): emergency
 * contacts not served, and the deletion routes as `deletion` answers.
 */
const settings = (deletion: Handler) => renderPortal(<ProfilePage />, (path, method, body) => path === '/identity/me'
  ? json(profile) : path.startsWith('/identity/me/account-deletion') ? deletion(path, method, body) : notFound(path),
{}, { at: '/profile#account-deletion' })

describe('account deletion on Novu', () => {
  it('shows nothing while the status is read, nor after it answers 404, and asks nothing else', async () => {
    const read = held()
    const { sent } = settings(() => read.promise)
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await waitFor(() => expect(deletionRequests(sent)).toEqual(['GET /identity/me/account-deletion']))
    expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
    expect(screen.queryByText('Checking your account…')).toBeNull()
    await act(async () => { read.release(notFound('/identity/me/account-deletion')) })
    await settled()
    expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(deletionRequests(sent)).toEqual(['GET /identity/me/account-deletion'])
    expect(accountDeletionServed()).toBe(false)
  })

  it('explains what is kept and closed, schedules the deletion with its end date in WAT, and cancels it in the waiting period', async () => {
    let status: AccountDeletionStatus = noRequest
    const { sent } = settings((path, method) => {
      if (path.endsWith('/account-deletion') && method === 'GET') return json(status)
      if (path.endsWith('/account-deletion')) {
        return json({ requestId: 'req-1', confirmationToken: token, confirmationExpiresAt: '2026-10-28T10:10:00Z', waitingPeriodSeconds: 1_209_600 }, 201)
      }
      if (path.endsWith('/confirm')) {
        status = { ...noRequest, request: { requestId: 'req-1', state: 'pending', requestedAt: '2026-10-28T10:00:00Z',
          confirmationExpiresAt: null, scheduledFor: '2026-11-11T10:00:00Z', blockedReasonCode: null, cancelledAt: null, cancellable: true } }
        return json({ requestId: 'req-1', state: 'pending', scheduledFor: '2026-11-11T10:00:00Z', blockedReasonCode: null })
      }
      status = { ...noRequest, request: { ...status.request!, state: 'cancelled', cancellable: false, cancelledAt: '2026-10-28T10:05:00Z' } }
      return json({ requestId: 'req-1', state: 'cancelled', replayed: false })
    })

    const title = await screen.findByRole('heading', { name: 'Delete account' })
    expect(accountDeletionServed()).toBe(true)
    // The profile's last section, opened by the link to it; each fact in one short line.
    expect(title.closest('.patient-card')?.id).toBe('account-deletion')
    expect(screen.getByText('Keeps your Health ID, your medical records and some security records.')).toBeTruthy()
    expect(screen.getByText('Cancels your sharing invitations and removes your emergency contacts.')).toBeTruthy()
    expect(screen.getByText('Emails you when it is scheduled and when it is done.')).toBeTruthy()
    expect(screen.getByText('Gives you 14 days to cancel. After that it can’t be undone.')).toBeTruthy()
    expect(screen.getByText('You must have signed in within the last 10 minutes.')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await press(screen.getByRole('button', { name: 'Continue to delete account' }))
    const phrase = await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })
    expect(screen.getByText('This confirmation expires at 28 Oct 2026, 11:10 WAT.')).toBeTruthy()
    fireEvent.change(phrase, { target: { value: ' delete my account ' } })
    await press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('11 Nov 2026, 11:00 WAT')).toBeTruthy()
    expect(screen.getByText('Until then you can cancel. After that it can’t be undone. Your Health ID and medical records are kept.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Delete account' })))
    await press(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(await screen.findByText('Account deletion cancelled. Your account stays open.')).toBeTruthy()

    // No body on the request: it needs only a recent sign-in (contract §3.1).
    expect(sent.filter(request => request.path.includes('account-deletion') && request.method === 'POST')).toEqual([
      { path: '/identity/me/account-deletion', method: 'POST', body: null },
      { path: '/identity/me/account-deletion/confirm', method: 'POST', body: { requestId: 'req-1', confirmationToken: token, confirmation: ' delete my account ' } },
      { path: '/identity/me/account-deletion/cancel', method: 'POST', body: { requestId: 'req-1' } },
    ])
  })

  it('says why deletion is not available just after the account was recovered, and opens no confirmation', async () => {
    renderPortal(<AccountDeletionCard />, (_path, method) => method === 'GET' ? json(noRequest)
      : problem(403, 'PATIENT_RECENT_RECOVERY_HOLD', 'Account deletion is paused after recovery.'))
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    const proceed = screen.getByRole('button', { name: 'Continue to delete account' })
    await press(proceed)
    expect((await screen.findByRole('alert')).textContent)
      .toBe('For your security, account deletion is not available for 24 hours after you recover your account.')
    expect(screen.queryByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(proceed))
  })

  it('asks for a fresh sign-in when the confirmation is refused for an old sign-in', async () => {
    renderPortal(<AccountDeletionCard />, (path, method) => method === 'GET' ? json(noRequest)
      : path.endsWith('/confirm') ? problem(403, 'PATIENT_RECENT_AUTH_REQUIRED', 'Sign in again before deleting your account')
        : json({ requestId: 'req-1', confirmationToken: token, confirmationExpiresAt: '2026-10-28T10:10:00Z', waitingPeriodSeconds: 1_209_600 }, 201))
    fireEvent.click(await screen.findByRole('checkbox', { name: /I understand/ }))
    await press(screen.getByRole('button', { name: 'Continue to delete account' }))
    fireEvent.change(await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ }), { target: { value: 'DELETE MY ACCOUNT' } })
    await press(screen.getByRole('button', { name: 'Delete my account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('sign in again, and return here within 10 minutes')
    expect(screen.queryByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })).toBeNull()
  })

  it('keeps Try again for another failure, and says it is not available when Try again finds it not served', async () => {
    let reads = 0
    // Not retryable, so the client gives up at once and the card shows the failure.
    renderPortal(<AccountDeletionCard />, path => ++reads === 1 ? json({ type: 'about:blank', title: 'Unavailable', status: 503,
      code: 'UPSTREAM_UNAVAILABLE', detail: 'This information is unavailable right now.', retryable: false }, 503) : notFound(path))
    expect(await screen.findByRole('heading', { name: 'Delete account' })).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Deleting your account is not available here right now.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Delete account' })))
    expect(screen.queryByRole('button', { name: 'Continue to delete account' })).toBeNull()
  })
})

describe('account deletion on hid-system main', () => {
  it('keeps its loading line and leaves out what only 0096 does; a 404 hides the card there too', async () => {
    backend.novu = false
    const read = held()
    const first = renderPortal(<AccountDeletionCard />, () => read.promise)
    expect(await screen.findByText('Checking your account…')).toBeTruthy()
    await act(async () => { read.release(json(noRequest)) })
    expect(await screen.findByRole('button', { name: 'Continue to delete account' })).toBeTruthy()
    expect(screen.queryByText(/Cancels your sharing invitations/)).toBeNull()
    expect(screen.queryByText(/Emails you/)).toBeNull()
    first.view.unmount()

    renderPortal(<AccountDeletionCard />, path => notFound(path))
    await settled()
    expect(screen.queryByRole('heading', { name: 'Delete account' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('account deletion inbox notices', () => {
  const notice = (code: string, metadata: Record<string, unknown>): PatientNotification => ({ id: 'n-1',
    notificationCode: code, resourceType: 'account-deletion', resourceId: 'req-1', metadata, readAt: null, createdAt: '2026-10-28T10:00:00Z' })

  it('titles each notice in the contract\'s words and files them under Account', () => {
    expect(notificationTitle(notice('ACCOUNT_DELETION_SCHEDULED', { scheduledFor: '2026-11-11T10:00:00Z' })))
      .toBe('Your Health ID account is scheduled for deletion')
    expect(notificationTitle(notice('ACCOUNT_DELETION_CANCELLED', {}))).toBe('Your Health ID account deletion was cancelled')
    expect(notificationTitle(notice('ACCOUNT_DELETION_BLOCKED', { reasonCode: 'LEGAL_HOLD' })))
      .toBe('Your Health ID account could not be deleted: see your profile')
    expect(NOTIFICATION_SUBJECTS['account-deletion']).toBe('Account')
  })
})
