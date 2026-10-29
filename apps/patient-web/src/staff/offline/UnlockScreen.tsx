import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { LockReason, OfflineRuntime } from '@hid/offline'
import { Button, Field, PasswordInput } from '@hid/ui'
import { BrandLogo } from '../../BrandLogo'
import { SIGN_IN, UNLOCK } from './copy'

/**
 * Over the locked workspace, which stays mounted beneath it (inert and hidden), so a form in progress keeps its text
 * (OFFLINE-CONTRACT §2.6, idle and hidden locks). Only the password reopens it.
 */
export function UnlockScreen({ runtime, reason, onUnlocked, onSignOut }: {
  runtime: OfflineRuntime
  /** Why it locked; 'unconfirmed' when Health ID could not confirm the session while offline. */
  reason: LockReason | 'unconfirmed'
  onUnlocked: () => void
  onSignOut: () => void
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
      setError(result.reason === 'wrong-credentials' ? UNLOCK.wrong : result.reason === 'lease-expired' ? SIGN_IN.leaseExpired
        : result.reason === 'clock-suspect' ? SIGN_IN.clockSuspect : SIGN_IN.wiped)
    } catch { setError(UNLOCK.wrong) }
    finally { setBusy(false) }
  }

  const why = reason === 'unconfirmed' ? UNLOCK.unconfirmed : reason === 'hidden' ? UNLOCK.hidden : UNLOCK.idle
  return <main className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="offline-unlock-title">
      <h1 id="offline-unlock-title" ref={heading} tabIndex={-1}>{UNLOCK.title}</h1>
      <p>{why}</p>
      <form className="staff-form" onSubmit={event => void submit(event)}>
        <Field label={UNLOCK.password} htmlFor="offline-unlock-password" required><PasswordInput id="offline-unlock-password"
          autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        {error && <p role="alert" className="staff-error">{error}</p>}
        <Button type="submit" aria-disabled={busy || undefined}>{busy ? UNLOCK.working : UNLOCK.submit}</Button>
      </form>
      <Button tone="quiet" onClick={onSignOut}>{UNLOCK.signOut}</Button>
    </section>
  </main>
}
