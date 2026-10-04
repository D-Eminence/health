import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Button, Field, Input } from '@hid/ui'
import { getEnvironment } from '../env'
import { useStaff } from '../App'

function TurnstileChallenge({ onToken }: { onToken: (token: string) => void }) {
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
        action: 'staff-login',
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
  }, [siteKey, onToken])

  if (!siteKey) return null
  return <div><div ref={host} />{error && <p role="alert" className="staff-error">{error}</p>}</div>
}

export function SignIn() {
  const { state, login } = useStaff()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const siteKey = getEnvironment().turnstileSiteKey

  if (state.status === 'ready') return <Navigate to="/provider" replace />
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try { await login(email.trim(), password, token || undefined); navigate('/provider') }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign in failed.') }
    finally { setBusy(false) }
  }

  return <div className="staff-auth-page">
    <main className="staff-auth">
      <div className="staff-brand"><span className="staff-brand-mark">H</span><span>Health ID <small>Provider</small></span></div>
      <p className="staff-eyebrow">Secure clinical workspace</p>
      <h1>Welcome back.</h1>
      <p>Sign in with the staff account assigned to your facility. Your permissions and facility are verified by Health ID.</p>
      <form className="staff-form" onSubmit={event => void submit(event)}>
        <Field label="Work email" htmlFor="staff-email" required><Input id="staff-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></Field>
        <Field label="Password" htmlFor="staff-password" required><Input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></Field>
        <TurnstileChallenge onToken={setToken} />
        {error && <p className="staff-error" role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !!siteKey && !token}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      </form>
      <p className="staff-muted">Need access or password recovery? Contact your facility administrator. Self-service staff recovery is not exposed by this backend.</p>
    </main>
    <aside className="staff-auth-aside" aria-label="About secure access">
      <p className="staff-eyebrow">One connected care record</p>
      <h2>The right information, at the point of care.</h2>
      <p>Patient records open only after a server-approved grant, a patient PIN, or a documented emergency access event.</p>
      <div className="staff-steps"><div className="staff-step"><span>1</span>Choose your active facility.</div><div className="staff-step"><span>2</span>Request governed patient access.</div><div className="staff-step"><span>3</span>Record care within an authorized encounter.</div></div>
    </aside>
  </div>
}
