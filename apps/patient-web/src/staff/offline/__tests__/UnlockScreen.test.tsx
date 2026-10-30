import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { UnlockResult } from '@hid/offline'
import { fakeOffline } from './offlineFixture'

vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { UnlockScreen } = await import('../UnlockScreen')


/** Review item 6 (A12.8): each unlock refusal says its own reason; none is shown as a wrong password. */
type Refusal = Extract<UnlockResult, { ok: false }>['reason']
const SAID: Record<Refusal, RegExp> = {
  'wrong-credentials': /That password does not unlock this device/,
  'lease-expired': /The offline copy on this device has expired/,
  'clock-suspect': /clock looks wrong/,
  wiped: /cleared after too many wrong passwords/,
  'no-vault': /No offline copy is open on this tab\. Sign in online/,
}

describe('unlock refusals', () => {
  it.each(Object.keys(SAID) as Refusal[])('%s says its own reason', async reason => {
    const { runtime } = fakeOffline()
    vi.spyOn(runtime, 'unlockLocked').mockResolvedValue({ ok: false, reason })
    render(<UnlockScreen runtime={runtime} reason="idle" onUnlocked={vi.fn()} onSignOut={vi.fn(async () => undefined)} />)
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'a long enough password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(SAID[reason])
  })
})

describe('sign out from the unlock screen', () => {
  it('says why a sign-out failed instead of leaving the screen silently', async () => {
    const { runtime } = fakeOffline()
    render(<UnlockScreen runtime={runtime} reason="idle" onUnlocked={vi.fn()}
      onSignOut={() => Promise.reject(new Error('Sign-out could not be completed. Try again.'))} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Sign-out could not be completed. Try again.')
  })
})
