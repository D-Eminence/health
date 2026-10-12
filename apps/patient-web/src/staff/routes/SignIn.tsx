import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '@hid/ui'
import { getEnvironment } from '../env'
import { useStaff } from '../App'
import { BrandLogo } from '../../BrandLogo'
import { turnstileSize } from '../../Turnstile'
import { resolveStaffProductHostname, STAFF_RECOVERY_PATH, staffLoginAction, staffRecoveryHref } from '../../productHostname'
import { staffReturnPath } from '../session'

function getStaffLandingPath(search: string): string {
  return staffReturnPath(new URLSearchParams(search).get('returnTo'))
    ?? resolveStaffProductHostname(window.location.hostname)?.route ?? '/provider'
}

function TurnstileChallenge({ onToken, resetKey }: { onToken: (token: string) => void; resetKey: number }) {
  const siteKey = getEnvironment().turnstileSiteKey
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!siteKey || !host.current) return
    let active = true
    let widgetId: string | null = null
    const render = () => {
      if (!active || !host.current || !window.turnstile) return
      widgetId = window.turnstile.render(host.current, {
        sitekey: siteKey,
        action: staffLoginAction(window.location.hostname),
        size: turnstileSize(host.current, 'normal'),
        callback: onToken,
        'expired-callback': () => onToken(''),
        'error-callback': () => { onToken(''); setError('Human verification could not load. Refresh the page and try again.') },
      })
    }
    if (window.turnstile) render()
    else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.onload = render
      script.onerror = () => setError('Human verification could not load. Refresh the page and try again.')
      document.head.append(script)
    }
    return () => { active = false; if (widgetId && window.turnstile) window.turnstile.remove(widgetId) }
  }, [siteKey, onToken, resetKey])

  if (!siteKey) return null
  return <div><div ref={host} />{error && <p role="alert" className="staff-error">{error}</p>}</div>
}

export function SignIn() {
  const { state, login } = useStaff()
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [turnstileResetKey, setTurnstileResetKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const siteKey = getEnvironment().turnstileSiteKey
  const landingPath = getStaffLandingPath(location.search)

  if (state.status === 'ready') return <Navigate to={landingPath} replace />
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await login(email.trim(), password, token || undefined); navigate(getStaffLandingPath(location.search)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign in failed.') }
    finally {
      setToken('')
      setTurnstileResetKey(value => value + 1)
      setBusy(false)
    }
  }

  return <div className="staff-auth-page">
    <main className="staff-auth">
      <div className="staff-brand"><BrandLogo /><small>Provider</small></div>
      <p className="staff-eyebrow">Secure clinical workspace</p>
      <h1>Welcome back.</h1>
      <p>Sign in with the staff account assigned to your facility. Your permissions and facility are verified by Health ID.</p>
      <form className="staff-form" onSubmit={event => void submit(event)}>
        <Field label="Work email" htmlFor="staff-email" required><Input id="staff-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></Field>
        <Field label="Password" htmlFor="staff-password" required><Input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        <TurnstileChallenge onToken={setToken} resetKey={turnstileResetKey} />
        {error && <p className="staff-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !!siteKey && !token}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <RecoveryLink />
    </main>
    <aside className="staff-auth-aside" aria-label="About secure access">
      <p className="staff-eyebrow">One connected care record</p>
      <h2>The right information, at the point of care.</h2>
      <p>Patient records open only after a server-approved grant, a patient PIN, or a documented emergency access event.</p>
      <div className="staff-steps"><div className="staff-step"><span>1</span>Choose your active facility.</div><div className="staff-step"><span>2</span>Request governed patient access.</div><div className="staff-step"><span>3</span>Record care within an authorized encounter.</div></div>
    </aside>
  </div>
}

/**
 * hid-system accepts a staff password reset only on the main site, so a staff
 * product site links to the main site's recovery page and says so.
 */
function RecoveryLink() {
  const href = staffRecoveryHref(window.location.hostname)
  const central = href !== STAFF_RECOVERY_PATH
  return <p className="staff-muted">
    {central ? <a href={href}>Forgot your password?</a> : <Link to={href}>Forgot your password?</Link>}
    {central && ' Password resets are done on the main Health ID site.'}
    {' '}For a new staff account, contact your facility administrator.
  </p>
}
