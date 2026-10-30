import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { LockReason, OfflineRuntime, UnlockResult } from '@hid/offline'
import { Button, Field, PasswordInput } from '@hid/ui'
import { BrandLogo } from '../../BrandLogo'
import { SIGN_IN, UNLOCK } from './copy'

type Refusal = Extract<UnlockResult, { ok: false }>['reason']
/** Each refusal in its own words (A12.8): a refusal is never shown as a wrong password unless it is one. */
const REFUSALS: Readonly<Record<Refusal, string>> = {
  'wrong-credentials': UNLOCK.wrong,
  'lease-expired': SIGN_IN.leaseExpired,
  'clock-suspect': SIGN_IN.clockSuspect,
  wiped: SIGN_IN.wiped,
  'no-vault': UNLOCK.noVault,
}

/**
 * Over the locked workspace, which stays mounted beneath it (inert and hidden), so a form in progress keeps its text
 * (OFFLINE-CONTRACT §2.6, idle and hidden locks). Only the password reopens it.
 */
export function UnlockScreen({ runtime, reason, onUnlocked, onSignOut, onCancel }: {
  runtime: OfflineRuntime
  /** Why it locked; 'unconfirmed' when Health ID could not confirm the session while offline. */
  reason: LockReason | 'unconfirmed'
  onUnlocked: () => void
  /** Signs out; a failure is said here (A12.2). */
  onSignOut: () => Promise<void>
  /** Offered when the person opened the unlock themselves (offline paused on this tab). */
  onCancel?: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError(''); setBusy(true)
    try {
      const result = await runtime.unlockLocked(password)
      setPassword('')
      if (result.ok) { onUnlocked(); return }
      setError(REFUSALS[result.reason])
    } catch { setError(UNLOCK.wrong) }
    finally { setBusy(false) }
  }

  async function leave() {
    setError('')
    try { await onSignOut() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
  }

  const why = reason === 'unconfirmed' ? UNLOCK.unconfirmed : reason === 'hidden' ? UNLOCK.hidden : reason === 'manual' ? UNLOCK.paused : UNLOCK.idle
  return <main className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="offline-unlock-title" data-testid="lock-overlay">
      <h1 id="offline-unlock-title" ref={heading} tabIndex={-1}>{UNLOCK.title}</h1>
      <p>{why}</p>
      <form className="staff-form" onSubmit={event => void submit(event)}>
        <Field label={UNLOCK.password} htmlFor="offline-unlock-password" required><PasswordInput id="offline-unlock-password" data-testid="lock-overlay-password"
          autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        {error && <p role="alert" className="staff-error">{error}</p>}
        <Button type="submit" data-testid="lock-overlay-unlock" aria-disabled={busy || undefined}>{busy ? UNLOCK.working : UNLOCK.submit}</Button>
      </form>
      {onCancel && <Button tone="quiet" onClick={onCancel}>{UNLOCK.notNow}</Button>}
      <Button tone="quiet" onClick={() => void leave()}>{UNLOCK.signOut}</Button>
    </section>
  </main>
}
