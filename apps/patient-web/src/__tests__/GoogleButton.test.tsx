import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { GoogleButton } from '../GoogleButton'
import { SignIn } from '../routes/SignIn'
import { Enrollment } from '../routes/Enrollment'
import { json, renderPortal } from './portalHarness'

/**
 * PA-11. The Google button was 'disabled' by pointer-events and opacity on its
 * host and aria-disabled on a plain div, which assistive technology ignores: the
 * Google button inside stayed in the tab order, could be pressed from the
 * keyboard, and its credential was then dropped without a word, and nothing said
 * why it was unavailable. It is now inert while disabled, and says why. A
 * credential re-renders the button, taking away the one that was used; focus
 * left on the page returns to the button's region.
 */
vi.mock('../Turnstile', () => ({
  Turnstile: ({ onTokenChange }: { onTokenChange: (token: string | null) => void }) =>
    <button type="button" onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

let respond: ((result: { credential?: string }) => void) | undefined
beforeEach(() => {
  vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
  respond = undefined
  window.google = { accounts: { id: {
    initialize: vi.fn(options => { respond = options.callback }),
    renderButton: vi.fn(host => {
      const button = document.createElement('div')
      button.setAttribute('role', 'button')
      button.tabIndex = 0
      button.textContent = 'Sign in with Google'
      host.appendChild(button)
    }),
  } } }
})
afterEach(() => { vi.unstubAllEnvs(); delete window.google })

const nonce = () => json({ nonce: 'n'.repeat(43) })
const googleButton = () => screen.findByRole('button', { name: 'Sign in with Google' })
const REASON = 'Complete the security check to continue with Google.'

describe('the Google button', () => {
  it('is inert while disabled, and says why', async () => {
    function Checked() {
      const [checked, setChecked] = useState(false)
      return <><button type="button" onClick={() => setChecked(true)}>Complete check</button>
        <GoogleButton text="signin_with" disabled={!checked} disabledReason={REASON} onCredential={vi.fn()} /></>
    }
    const { view } = renderPortal(<Checked />, nonce)
    await waitFor(() => expect(window.google!.accounts.id.renderButton).toHaveBeenCalled())
    const host = view.container.querySelector('.patient-google > div')!
    expect(host.hasAttribute('inert')).toBe(true)
    expect(screen.getByText(REASON)).toBeTruthy()
    expect(view.container.querySelector('[aria-disabled]')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    expect(host.hasAttribute('inert')).toBe(false)
    expect(screen.queryByText(REASON)).toBeNull()
  })

  it('returns focus to its region when the button that was used is rendered again', async () => {
    const onCredential = vi.fn(async () => undefined)
    const { view } = renderPortal(<GoogleButton text="signin_with" disabled={false} onCredential={onCredential} />, nonce)
    const used = await googleButton()
    used.focus()
    await act(async () => { respond!({ credential: 'id-token' }) })
    expect(onCredential).toHaveBeenCalledWith('id-token')
    await waitFor(() => expect(window.google!.accounts.id.renderButton).toHaveBeenCalledTimes(2))
    expect(used.isConnected).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(view.container.querySelector('.patient-google')))
    // A named group, so focus landing there says where it is.
    expect(screen.getByRole('group', { name: 'Google sign-in' })).toBe(document.activeElement)
  })

  it.each([
    ['signin_with', 'Google sign-in'],
    ['signup_with', 'Google sign-up'],
    ['continue_with', 'Continue with Google'],
  ] as const)('names its region for what the button does (%s)', async (text, name) => {
    renderPortal(<GoogleButton text={text} disabled={false} onCredential={vi.fn()} />, nonce)
    expect(await screen.findByRole('group', { name })).toBeTruthy()
  })
})

describe('where the Google button is offered', () => {
  it('sign-in says the security check comes first, until it is complete', async () => {
    renderPortal(<SignIn />, nonce, { state: { status: 'anonymous', principal: null } })
    expect(await screen.findByText(REASON)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    expect(screen.queryByText(REASON)).toBeNull()
  })

  it('enrollment says the security check comes first, until it is complete', async () => {
    renderPortal(<Enrollment />, path => path.endsWith('/auth/google/nonce') ? nonce() : json({ status: 404, code: 'NOT_FOUND', detail: 'None' }, 404),
      { state: { status: 'anonymous', principal: null } })
    expect(await screen.findByText(REASON)).toBeTruthy()
    const checks = screen.getAllByRole('button', { name: 'Complete check' })
    fireEvent.click(checks[checks.length - 1]!)
    expect(screen.queryByText(REASON)).toBeNull()
  })
})
