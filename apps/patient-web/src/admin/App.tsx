import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { adminApi, type AdminActor, type AdminSession } from './api'
import { environment } from './env'
import { Turnstile } from './Turnstile'
import { BrandLogo } from '../BrandLogo'
import {
  ApplicationsPage, AuditPage, ControlsPage, DemosPage, FacilitiesPage,
  IntegrationsPage, OperationsPage, OverviewPage, PricingPage, PrincipalsPage, ReviewsPage,
} from './Pages'
import './style.css'

const NAVIGATION = [
  { path: '/admin/overview', title: 'Overview', permission: 'platform.admin.access' },
  { path: '/admin/facilities', title: 'Facilities', permission: 'platform.facility.read' },
  { path: '/admin/principals', title: 'Users & roles', permission: 'platform.principal.read' },
  { path: '/admin/applications', title: 'Applications', permission: 'platform.identity-review.read' },
  { path: '/admin/reviews', title: 'Identity review', permission: 'platform.identity-review.read' },
  { path: '/admin/audit', title: 'Audit', permission: 'platform.audit.read' },
  { path: '/admin/operations', title: 'Operations', permission: 'platform.operations.read' },
  { path: '/admin/pricing', title: 'Pricing', permission: 'platform.pricing.read' },
  { path: '/admin/demos', title: 'Demo requests', permission: 'platform.demo.read' },
  { path: '/admin/integrations', title: 'Integrations', permission: 'platform.integration.read' },
  { path: '/admin/controls', title: 'Platform controls', permission: 'platform.control.read' },
] as const

function has(actor: AdminActor, permission: string) {
  return actor.platformPermissions.includes(permission)
}

function Guard({ actor, permission, children }: { actor: AdminActor; permission: string; children: ReactNode }) {
  return has(actor, permission) ? <>{children}</> : (
    <main className="admin-message" role="alert"><h1>Access denied</h1>
      <p>Your platform account does not have permission for this area.</p></main>
  )
}

export function App() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkRevision, setCheckRevision] = useState(0)
  const [entryError, setEntryError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setChecking(true)
    setCheckError(null)
    void adminApi.session().then(value => {
      if (!active) return
      if (has(value.actor, 'platform.admin.access')) setSession(value)
      else { setSession(null); setEntryError('This account has no platform administration access.') }
    })
      .catch(error => {
        if (!active) return
        setSession(null)
        if (isHidApiError(error) && error.status === 403) {
          setEntryError('This account has no platform administration access.')
        } else if (!isHidApiError(error) || error.status !== 401) {
          setCheckError('We could not check your platform session. Try again.')
        }
      })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [checkRevision])

  async function signIn(email: string, password: string, token: string) {
    setEntryError(null)
    try {
      await adminApi.login(email, password, token)
      const next = await adminApi.session()
      if (!has(next.actor, 'platform.admin.access')) {
        setEntryError('This account has no platform administration access.')
        return
      }
      setSession(next)
    } catch (reason) {
      setEntryError(reason instanceof Error ? reason.message : 'Sign-in could not be completed.')
    }
  }

  async function signOut() {
    setEntryError(null)
    try { await adminApi.logout(); setSession(null) }
    catch (reason) { setEntryError(reason instanceof Error ? reason.message : 'Sign-out could not be completed.') }
  }

  if (checking) return <main className="admin-message" role="status"><BrandLogo className="admin-state-logo" />Checking your platform session…</main>
  if (checkError) return <main className="admin-message" role="alert"><BrandLogo className="admin-state-logo" /><h1>Session unavailable</h1>
    <p>{checkError}</p><button type="button" className="admin-primary" onClick={() => setCheckRevision(value => value + 1)}>Try again</button></main>
  if (!session) return <AdminSignIn onSubmit={signIn} error={entryError} />
  const actor = session.actor

  return (
    <div className="admin-app">
      <a className="admin-skip" href="#admin-main">Skip to content</a>
      <aside className="admin-sidebar" aria-label="Platform administration">
        <div className="admin-brand"><BrandLogo /><small>Platform</small></div>
        <nav className="admin-nav" aria-label="Platform areas">
          {NAVIGATION.filter(item => has(actor, item.permission)).map(item => (
            <NavLink key={item.path} to={item.path} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
              {item.title}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-footer"><span>{actor.displayName || actor.email || 'Platform administrator'}</span>
          <button type="button" onClick={() => void signOut()}>Sign out</button></div>
      </aside>
      <div className="admin-main-wrap">
        <header className="admin-mobile-header"><Link to="/admin/overview" className="admin-mobile-logo"><BrandLogo /><span>Platform</span></Link>
          <button type="button" onClick={() => void signOut()}>Sign out</button></header>
        <nav className="admin-mobile-nav" aria-label="Platform areas">
          {NAVIGATION.filter(item => has(actor, item.permission)).map(item => <NavLink key={item.path} to={item.path}>{item.title}</NavLink>)}
        </nav>
        <main id="admin-main" className="admin-main">
          {entryError ? <p role="alert" className="admin-error">{entryError}</p> : null}
          <Routes>
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="sign-in" element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="facilities" element={<Guard actor={actor} permission="platform.facility.read"><FacilitiesPage actor={actor} /></Guard>} />
            <Route path="principals" element={<Guard actor={actor} permission="platform.principal.read"><PrincipalsPage actor={actor} /></Guard>} />
            <Route path="applications" element={<Guard actor={actor} permission="platform.identity-review.read"><ApplicationsPage actor={actor} /></Guard>} />
            <Route path="reviews" element={<Guard actor={actor} permission="platform.identity-review.read"><ReviewsPage /></Guard>} />
            <Route path="audit" element={<Guard actor={actor} permission="platform.audit.read"><AuditPage /></Guard>} />
            <Route path="operations" element={<Guard actor={actor} permission="platform.operations.read"><OperationsPage /></Guard>} />
            <Route path="pricing" element={<Guard actor={actor} permission="platform.pricing.read"><PricingPage actor={actor} /></Guard>} />
            <Route path="demos" element={<Guard actor={actor} permission="platform.demo.read"><DemosPage actor={actor} /></Guard>} />
            <Route path="integrations" element={<Guard actor={actor} permission="platform.integration.read"><IntegrationsPage actor={actor} /></Guard>} />
            <Route path="controls" element={<Guard actor={actor} permission="platform.control.read"><ControlsPage actor={actor} /></Guard>} />
            <Route path="*" element={<section className="admin-message"><h1>Page not found</h1>
              <p>This platform page is unavailable.</p><Link to="/admin/overview">Go to overview</Link></section>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function AdminSignIn({ onSubmit, error }: { onSubmit: (email: string, password: string, token: string) => Promise<void>; error: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [pending, setPending] = useState(false)
  const config = environment()
  const requiresToken = Boolean(config.turnstileSiteKey) || config.name !== 'local'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (requiresToken && !token)) return
    setPending(true)
    try { await onSubmit(email.trim(), password, token ?? '') }
    finally { setPending(false); setToken(null); setResetKey(value => value + 1) }
  }

  return <main className="admin-auth"><form className="admin-auth-card" onSubmit={event => void submit(event)}>
    <BrandLogo className="admin-auth-logo" />
    <p className="admin-eyebrow">Health ID platform</p><h1>Administration sign in</h1>
    <p>Access is limited to accounts with platform permissions.</p>
    <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>
    {(config.turnstileSiteKey || config.name !== 'local') &&
      <Turnstile siteKey={config.turnstileSiteKey} resetKey={resetKey} onChange={setToken} />}
    {error ? <p role="alert" className="admin-error">{error}</p> : null}
    <button type="submit" className="admin-primary" disabled={pending || (requiresToken && !token)}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
    <p><Link to="/admin/recover">Forgot your password?</Link></p>
  </form></main>
}
