import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { adminApi, type AdminActor, type AdminSession } from './api'
import { ApprovalsPage } from './Approvals'
import { BrandLogo } from '../BrandLogo'
import {
  ApplicationsPage, AuditPage, ControlsPage, DemosPage, FacilitiesPage,
  IntegrationsPage, OperationsPage, OverviewPage, PricingPage, PrincipalsPage, ReviewsPage,
} from './Pages'
import { failure } from './problems'
import { SecurityPage } from './SecurityPage'
import {
  clearSessionWindow, currentSessionWindow, onSessionEnded, onSessionWindow, reportSessionEnded, type SessionEndReason,
} from './session-window'
import { AdminSignIn } from './SignIn'
import { StepUpProvider } from './StepUp'
import { date, has } from './ui'
import './style.css'

/** Approvals are listed for these permissions (hid-system PlatformSecurityService.listApprovals). */
const APPROVAL_PERMISSIONS = ['platform.role.manage', 'platform.mfa.reset', 'platform.audit.read']

const NAVIGATION: ReadonlyArray<{ path: string; title: string; visible: (actor: AdminActor) => boolean }> = [
  { path: '/admin/overview', title: 'Overview', visible: actor => has(actor, 'platform.admin.access') },
  { path: '/admin/facilities', title: 'Facilities', visible: actor => has(actor, 'platform.facility.read') },
  { path: '/admin/principals', title: 'Users & roles', visible: actor => has(actor, 'platform.principal.read') },
  { path: '/admin/approvals', title: 'Approvals', visible: actor => APPROVAL_PERMISSIONS.some(code => has(actor, code)) },
  { path: '/admin/applications', title: 'Applications', visible: actor => has(actor, 'platform.identity-review.read') },
  { path: '/admin/reviews', title: 'Identity review', visible: actor => has(actor, 'platform.identity-review.read') },
  { path: '/admin/audit', title: 'Audit', visible: actor => has(actor, 'platform.audit.read') },
  { path: '/admin/operations', title: 'Operations', visible: actor => has(actor, 'platform.operations.read') },
  { path: '/admin/pricing', title: 'Pricing', visible: actor => has(actor, 'platform.pricing.read') },
  { path: '/admin/demos', title: 'Demo requests', visible: actor => has(actor, 'platform.demo.read') },
  { path: '/admin/integrations', title: 'Integrations', visible: actor => has(actor, 'platform.integration.read') },
  { path: '/admin/controls', title: 'Platform controls', visible: actor => has(actor, 'platform.control.read') },
  { path: '/admin/security', title: 'Security', visible: actor => has(actor, 'platform.admin.access') },
]

export const SESSION_ENDED_MESSAGES: Readonly<Record<SessionEndReason, string>> = {
  expired: 'Your platform session expired after 15 minutes without activity or at its 8-hour limit. Sign in again to continue.',
  revoked: 'Your platform session was ended before it expired. It may have been revoked from another session or by another '
    + 'administrator, or your authenticator was reset. Sign in again, and tell your security team if you did not expect this.',
}
const NO_ACCESS = 'This account has no platform administration access.'

function Guard({ allowed, children }: { allowed: boolean; children: ReactNode }) {
  return allowed ? <>{children}</> : (
    <main className="admin-message" role="alert"><h1>Access denied</h1>
      <p>Your platform account does not have permission for this area.</p></main>
  )
}

export function App() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkRevision, setCheckRevision] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const signedIn = useRef(false)

  const end = useCallback((message: string | null) => {
    signedIn.current = false
    clearSessionWindow()
    setSession(null)
    setNotice(message)
  }, [])

  // The server stopped accepting this platform session (401 after refresh).
  useEffect(() => onSessionEnded(reason => {
    if (signedIn.current) end(reason ? SESSION_ENDED_MESSAGES[reason] : 'Your platform session has ended. Sign in again to continue.')
  }), [end])

  const open = useCallback((value: AdminSession) => {
    if (!has(value.actor, 'platform.admin.access')) throw new Error(NO_ACCESS)
    signedIn.current = true
    setNotice(null)
    setSession(value)
    // Records the server's idle and absolute expiry for the session warning.
    void adminApi.mfaStatus().catch(() => undefined)
  }, [])

  useEffect(() => {
    let active = true
    setChecking(true)
    setCheckError(null)
    // A missing or expired access token is restored once by the API client's refresh.
    void adminApi.session().then(value => {
      if (!active) return
      try { open(value) } catch { setSession(null); setNotice(NO_ACCESS) }
    }).catch(error => {
      if (!active) return
      setSession(null)
      if (isHidApiError(error) && error.status === 403) setNotice(failure(error, NO_ACCESS))
      else if (!isHidApiError(error) || error.status !== 401) setCheckError('We could not check your platform session. Try again.')
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [checkRevision, open])

  async function signedInNow() {
    let value: AdminSession
    try { value = await adminApi.session() }
    catch (error) { throw new Error(failure(error, 'Platform administration could not be opened. Try again.')) }
    open(value)
  }

  async function signOut() {
    setSignOutError(null)
    try { await adminApi.logout(); end('You have signed out of platform administration.') }
    catch (reason) {
      if (isHidApiError(reason) && reason.status === 401) { end('You have signed out of platform administration.'); return }
      setSignOutError(failure(reason, 'Sign-out could not be completed.'))
    }
  }

  if (checking) return <main className="admin-message" role="status"><BrandLogo className="admin-state-logo" />Checking your platform session…</main>
  if (checkError) return <main className="admin-message" role="alert"><BrandLogo className="admin-state-logo" /><h1>Session unavailable</h1>
    <p>{checkError}</p><button type="button" className="admin-primary" onClick={() => setCheckRevision(value => value + 1)}>Try again</button></main>
  if (!session) return <AdminSignIn onSignedIn={signedInNow} notice={notice} />
  const actor = session.actor
  const navigation = NAVIGATION.filter(item => item.visible(actor))
  const allowed = (permission: string) => has(actor, permission)

  return (
    <StepUpProvider>
      <div className="admin-app">
        <a className="admin-skip" href="#admin-main">Skip to content</a>
        <aside className="admin-sidebar" aria-label="Platform administration">
          <div className="admin-brand"><BrandLogo /><small>Platform</small></div>
          <nav className="admin-nav" aria-label="Platform areas">
            {navigation.map(item => (
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
            {navigation.map(item => <NavLink key={item.path} to={item.path}>{item.title}</NavLink>)}
          </nav>
          <main id="admin-main" className="admin-main">
            <SessionWarning />
            {signOutError ? <p role="alert" className="admin-error">{signOutError}</p> : null}
            <Routes>
              <Route index element={<Navigate to="/admin/overview" replace />} />
              <Route path="sign-in" element={<Navigate to="/admin/overview" replace />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="facilities" element={<Guard allowed={allowed('platform.facility.read')}><FacilitiesPage actor={actor} /></Guard>} />
              <Route path="principals" element={<Guard allowed={allowed('platform.principal.read')}><PrincipalsPage actor={actor} /></Guard>} />
              <Route path="approvals" element={<Guard allowed={APPROVAL_PERMISSIONS.some(allowed)}><ApprovalsPage actor={actor} /></Guard>} />
              <Route path="applications" element={<Guard allowed={allowed('platform.identity-review.read')}><ApplicationsPage actor={actor} /></Guard>} />
              <Route path="reviews" element={<Guard allowed={allowed('platform.identity-review.read')}><ReviewsPage /></Guard>} />
              <Route path="audit" element={<Guard allowed={allowed('platform.audit.read')}><AuditPage /></Guard>} />
              <Route path="operations" element={<Guard allowed={allowed('platform.operations.read')}><OperationsPage /></Guard>} />
              <Route path="pricing" element={<Guard allowed={allowed('platform.pricing.read')}><PricingPage actor={actor} /></Guard>} />
              <Route path="demos" element={<Guard allowed={allowed('platform.demo.read')}><DemosPage actor={actor} /></Guard>} />
              <Route path="integrations" element={<Guard allowed={allowed('platform.integration.read')}><IntegrationsPage actor={actor} /></Guard>} />
              <Route path="controls" element={<Guard allowed={allowed('platform.control.read')}><ControlsPage actor={actor} /></Guard>} />
              <Route path="security" element={<SecurityPage onSignOut={() => void signOut()} />} />
              <Route path="*" element={<section className="admin-message"><h1>Page not found</h1>
                <p>This platform page is unavailable.</p><Link to="/admin/overview">Go to overview</Link></section>} />
            </Routes>
          </main>
        </div>
      </div>
    </StepUpProvider>
  )
}

/** Warn before the idle or absolute expiry the server last reported. */
export const SESSION_WARNING_MS = 2 * 60_000

/**
 * Shows the server-reported end of the session when it is near. The session is
 * extended only by user activity (a request or this button), never by a timer.
 */
export function SessionWarning() {
  const [, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const unsubscribe = onSessionWindow(() => setTick(value => value + 1))
    const timer = setInterval(() => setTick(value => value + 1), 15_000)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [])

  const { idleExpiresAt, absoluteExpiresAt } = currentSessionWindow()
  const now = Date.now()
  if (idleExpiresAt === null || now >= idleExpiresAt || idleExpiresAt - now > SESSION_WARNING_MS) return null
  // The idle window never extends past the absolute limit; at that point only a new sign-in helps.
  const atLimit = absoluteExpiresAt !== null && idleExpiresAt >= absoluteExpiresAt - 1000
  const ends = date(new Date(idleExpiresAt).toISOString())

  async function stay() {
    setBusy(true); setError(null)
    try { await adminApi.refresh() }
    catch (caught) {
      if (isHidApiError(caught) && caught.status === 401) reportSessionEnded()
      else setError(failure(caught, 'Your session could not be extended.'))
    } finally { setBusy(false) }
  }

  return <div className="admin-warning admin-session-warning" role="alert">
    {atLimit
      ? <p>Your session reaches its 8-hour limit at {ends}. Save your work; you will need to sign in again.</p>
      : <p>For security, your session ends at {ends} unless you continue working.</p>}
    {!atLimit && <button type="button" className="admin-secondary" disabled={busy} onClick={() => void stay()}>
      {busy ? 'Extending…' : 'Stay signed in'}</button>}
    {error && <p className="admin-error">{error}</p>}
  </div>
}
