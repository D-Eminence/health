import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AccountDeletionStatus, PatientNotification } from '../api'
import { AccountDeletionCard } from '../routes/AccountSafety'
import { ProfilePage } from '../routes/Portal'
import { NOTIFICATION_SUBJECTS, notificationTitle } from '../routes/notificationTitles'
import { accountDeletionServed, forgetAccountDeletionServed } from '../accountDeletionServed'
import { json, press, problem, profile, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

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
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeTruthy()
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

    // The status is read before its words show: wait for them, not the heading, which can show first.
    expect(await screen.findByText('This signs you out everywhere and removes your Access PIN, share invites, emergency contacts and the access you gave. Your Health ID and medical records are kept. You have 14 days to change your mind; after that, it can’t be undone.')).toBeTruthy()
    const title = screen.getByRole('heading', { name: 'Delete account' })
    expect(accountDeletionServed()).toBe(true)
    // The profile's last section, under More, which the link to it opens; what it needs first, in one short sentence.
    expect(title.closest('section')?.id).toBe('account-deletion')
    expect(title.closest('details')?.open).toBe(true)
    expect(screen.getByText('For your safety, sign out, sign in again, then come back within 10 minutes.')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: /I understand/ }))
    await press(screen.getByRole('button', { name: 'Continue to delete account' }))
    const phrase = await screen.findByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })
    expect(screen.getByText('Finish before 28 Oct 2026, 11:10 WAT.')).toBeTruthy()
    fireEvent.change(phrase, { target: { value: ' delete my account ' } })
    await press(screen.getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByText('11 Nov 2026, 11:00 WAT')).toBeTruthy()
    expect(screen.getByText('11 Nov 2026, 11:00 WAT').parentElement?.textContent).toBe('Your account will be deleted on 11 Nov 2026, 11:00 WAT. You can cancel until then.')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Delete account' })))
    await press(screen.getByRole('button', { name: 'Cancel deletion' }))
    expect(await screen.findByText('Deletion cancelled. Your account stays open.')).toBeTruthy()

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
    expect(shownText(await screen.findByRole('alert')))
      .toBe('For your safety, you can’t delete your account for 24 hours after you recover it.')
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
    expect((await screen.findByRole('alert')).textContent).toContain('sign out, sign in again, then come back within 10 minutes')
    expect(screen.queryByRole('textbox', { name: /Type DELETE MY ACCOUNT/ })).toBeNull()
  })

  it('keeps Try again for another failure, and says it is not available when Try again finds it not served', async () => {
    let reads = 0
    // Not retryable, so the client gives up at once and the card shows the failure.
    renderPortal(<AccountDeletionCard />, path => ++reads === 1 ? json({ type: 'about:blank', title: 'Unavailable', status: 503,
      code: 'UPSTREAM_UNAVAILABLE', detail: 'This information is unavailable right now.', retryable: false }, 503) : notFound(path))
    expect(await screen.findByRole('heading', { name: 'Delete account' })).toBeTruthy()
    await press(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('You can’t delete your account here right now.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Delete account' })))
    expect(screen.queryByRole('button', { name: 'Continue to delete account' })).toBeNull()
  })
})

describe('account deletion on hid-system main', () => {
  it('keeps its loading line and leaves out what only 0096 does; a 404 hides the card there too', async () => {
    backend.novu = false
    const read = held()
    const first = renderPortal(<AccountDeletionCard />, () => read.promise)
    expect((await screen.findByText('Checking your account…')).closest('[role="status"]')).not.toBeNull()
    await act(async () => { read.release(json(noRequest)) })
    expect(await screen.findByRole('button', { name: 'Continue to delete account' })).toBeTruthy()
    expect(screen.getByText('This signs you out everywhere and removes your Access PIN and the access you gave. Your Health ID and medical records are kept. You have 14 days to change your mind; after that, it can’t be undone.')).toBeTruthy()
    expect(screen.queryByText(/share invites/)).toBeNull()
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

  // The redesign says them in the portal's plain words (copy.ts); each still names what happened and where to look.
  it('titles each notice in plain words and files them under Account', () => {
    expect(notificationTitle(notice('ACCOUNT_DELETION_SCHEDULED', { scheduledFor: '2026-11-11T10:00:00Z' })))
      .toBe('Your Health ID account is set to be deleted')
    expect(notificationTitle(notice('ACCOUNT_DELETION_CANCELLED', {}))).toBe('You cancelled deleting your Health ID account')
    expect(notificationTitle(notice('ACCOUNT_DELETION_BLOCKED', { reasonCode: 'LEGAL_HOLD' })))
      .toBe('Your Health ID account couldn’t be deleted. See your profile')
    expect(NOTIFICATION_SUBJECTS['account-deletion']).toBe('Account')
  })
})
