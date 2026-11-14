import { useState, type FormEvent } from 'react'
import { PasswordInput } from '@hid/ui'
import { AuthLayout } from '../AuthLayout'
import { adminApi } from './api'
import { environment } from './env'
import { failure } from './problems'
import { Turnstile } from './Turnstile'

/** Matches the existing Novu password/cookie contract; admin access is checked by the server after login. */
export function NovuAdminSignIn({ onSignedIn, notice }: {
  onSignedIn: () => Promise<void>; notice: string | null
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const config = environment()
  const requiresToken = Boolean(config.turnstileSiteKey) || config.name !== 'local'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (requiresToken && !token)) return
    setPending(true); setError(null)
    try {
      await adminApi.novuLogin(email.trim(), password, token ?? '')
      setPassword('')
      try { await onSignedIn() }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'Platform administration could not be opened.') }
    } catch (caught) { setError(failure(caught, 'Sign-in could not be completed.')) }
    finally { setPending(false); setToken(null); setResetKey(value => value + 1) }
  }

  return <AuthLayout brandTo="/admin/sign-in" brandLabel="Health ID platform administration"
    title="Platform administration." titleId="admin-sign-in-title" titleAs="p"
    lede="Access is limited to accounts with platform permissions.">
    {notice && <p role="status" className="admin-warning">{notice}</p>}
    <form onSubmit={event => void submit(event)} className="admin-auth-form">
      <h1>Administration sign in</h1>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <div className="admin-field"><label htmlFor="admin-password">Password</label><PasswordInput appearance="plain"
        id="admin-password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></div>
      {requiresToken && <Turnstile siteKey={config.turnstileSiteKey} resetKey={resetKey} onChange={setToken} />}
      {error && <p role="alert" className="admin-error">{error}</p>}
      <button type="submit" className="admin-primary" disabled={pending || (requiresToken && !token)}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  </AuthLayout>
}
