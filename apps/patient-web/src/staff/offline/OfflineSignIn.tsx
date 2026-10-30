import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { OfflineRuntime, StaffSessionSnapshot, UnlockResult } from '@hid/offline'
import { Button, Field, Input, PasswordInput } from '@hid/ui'
import { BrandLogo } from '../../BrandLogo'
import { SIGN_IN } from './copy'

type Refusal = Extract<UnlockResult, { ok: false }>['reason']
const REFUSALS: Readonly<Record<Refusal, string>> = {
  'wrong-credentials': SIGN_IN.wrong, 'lease-expired': SIGN_IN.leaseExpired, 'clock-suspect': SIGN_IN.clockSuspect,
  'no-vault': SIGN_IN.noVault, wiped: SIGN_IN.wiped,
}

/**
 * Shown when the session cannot be read because Health ID cannot be reached and this device keeps an offline copy
 * (OFFLINE-CONTRACT §2.6, "Offline cold start"). Email and password open the copy; the password is never kept.
 */
export function OfflineSignIn({ runtime, onRestored, onRetry }: {
  runtime: OfflineRuntime
  onRestored: (snapshot: StaffSessionSnapshot) => void
  onRetry: () => void
}) {
  const [email, setEmail] = useState('')
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
      const result = await runtime.unlockOffline(email.trim(), password)
      setPassword('')
      if (!result.ok) { setError(REFUSALS[result.reason]); return }
      const snapshot = runtime.restoreSession()
      if (!snapshot) { setError(SIGN_IN.noVault); return }
      onRestored(snapshot)
    } catch { setError(SIGN_IN.noVault) }
    finally { setBusy(false) }
  }

  return <main className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended offline-sign-in" aria-labelledby="offline-sign-in-title">
      <h1 id="offline-sign-in-title" ref={heading} tabIndex={-1}>{SIGN_IN.title}</h1>
      <p>{SIGN_IN.lede}</p>
      <form className="staff-form" data-testid="offline-signin" onSubmit={event => void submit(event)}>
        <Field label={SIGN_IN.email} htmlFor="offline-email" required><Input id="offline-email" type="email" autoComplete="username" value={email}
          onChange={event => setEmail(event.target.value)} required /></Field>
        <Field label={SIGN_IN.password} htmlFor="offline-password" required><PasswordInput id="offline-password" autoComplete="current-password"
          value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        {error && <p role="alert" className="staff-error">{error}</p>}
        <Button type="submit" data-testid="offline-signin-submit" aria-disabled={busy || undefined}>{busy ? SIGN_IN.working : SIGN_IN.submit}</Button>
      </form>
      <Button tone="quiet" onClick={onRetry}>{SIGN_IN.retry}</Button>
    </section>
  </main>
}
