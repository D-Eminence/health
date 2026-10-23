import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import {
  adminApi, adminSessionAccount, closeAdminSession, setAdminSessionAccount, type AdminActor, type AdminSession,
} from './api'
import { ApprovalsPage } from './Approvals'
import { ClinicianApplicationPage, ClinicianApplicationsPage } from './ClinicianApplications'
import { AuditPage } from './Audit'
import { BrandLogo } from '../BrandLogo'
import { OverviewPage } from './Dashboard'
import { FacilitiesPage, FacilityDetailPage } from './Facilities'
import { IntegrationsPage } from './Integrations'
import { ApplicationsPage } from './Organizations'
import { ControlsPage, DemosPage, OperationsPage, PricingPage, ReviewsPage } from './Pages'
import { PrincipalsPage } from './Principals'
import { failure } from './problems'
import { SecurityPage } from './SecurityPage'
import {
  clearSessionWindow, currentSessionWindow, onSessionEnded, onSessionWindow, reportSessionEnded, type SessionEndReason,
} from './session-window'
import { isServed, navigationItemFor, visibleNavigation } from './navigation'
import { AdminSignIn } from './SignIn'
import { NovuAdminSignIn } from './NovuSignIn'
import { usesNovuBackend } from '../backendContract'
import { StepUpProvider } from './StepUp'
import { announceAdminSessionChange, onOtherAdminTabSessionChange } from './tabs'
import { date, has } from './ui'
import './style.css'

/** The server's PLATFORM_SESSION_EXPIRED / PLATFORM_SESSION_REVOKED, or the reading of its reported expiry. */
export const SESSION_ENDED_MESSAGES: Readonly<Record<SessionEndReason, string>> = {
  expired: 'Your platform session expired after 15 minutes without activity or at its 8-hour limit. Sign in again to continue.',
  revoked: 'Your platform session was ended before it expired: it was signed out or revoked from another session or by '
    + 'another administrator, your account or roles changed, or your authenticator was reset. Sign in again, and tell your '
    + 'security team if you did not expect this.',
  switched: 'Platform administration in this browser is now signed in as another administrator, so your workspace was '
    + 'closed. Sign in again to continue.',
}
const NO_ACCESS = 'This account has no platform administration access.'
const SIGNED_OUT = 'You have signed out of platform administration.'

/** A tab back in view after this long asks the server whose session the browser holds. */
const RECHECK_AFTER_HIDDEN_MS = 60_000

/**
 * Guards an area with the same rule that shows it in the navigation. A
 * forbidden page says so instead of looking empty; the backend still refuses
 * the area's requests on its own.
 */
function Area({ path, actor, children }: { path: string; actor: AdminActor; children: ReactNode }) {
  const item = navigationItemFor(path)
  if (item && !isServed(item)) return <NotFound />
  if (item?.visible(actor)) return <>{children}</>
  return <section className="admin-message admin-forbidden" role="alert" aria-labelledby="admin-forbidden-title">
    <h1 id="admin-forbidden-title">Access denied</h1>
    <p>Your platform account does not have permission for {item ? item.title : 'this area'}. Ask a Super Admin if you
      need it; access is granted through platform roles.</p>
    <Link to="/admin/overview">Go to overview</Link>
  </section>
}

function NotFound() {
  return <section className="admin-message" aria-labelledby="admin-not-found-title">
    <h1 id="admin-not-found-title">Page not found</h1>
    <p>This platform page is unavailable.</p><Link to="/admin/overview">Go to overview</Link>
  </section>
}

/** Names the browser tab after the current area. */
function useAreaTitle() {
  const location = useLocation()
  useEffect(() => {
    const item = navigationItemFor(location.pathname)
    document.title = `${item ? item.title : 'Platform'} · Health ID Platform`
  }, [location.pathname])
}

export function App() {
  const [session, setSession] = useState<AdminSession | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [checkRevision, setCheckRevision] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const signedIn = useRef(false)
  const checkingSession = useRef(false)
  const signOutRunning = useRef(false)
  // Another admin tab spoke while no workspace was open. The answer that opens
  // the next one may predate it, so the server is asked again once it opens.
  const heardWhileOpening = useRef(false)
  const recheckSession = useRef<() => void>(() => undefined)
  useAreaTitle()

  const end = useCallback((message: string | null) => {
    signedIn.current = false
    // Until the next session check or sign-in, nothing this workspace sent restores a session.
    closeAdminSession()
    clearSessionWindow()
    setSession(null)
    setNotice(message)
    // A sign-out that failed belonged to this workspace, not to the next one.
    setSignOutError(null)
  }, [])

  // The server stopped accepting this platform session (401 after refresh).
  // While the page checks for a session (a reload or a new tab), only a reason
  // the server gave is shown: a first visit gets no session-ended notice.
  useEffect(() => onSessionEnded(reason => {
    if (signedIn.current) end(reason ? SESSION_ENDED_MESSAGES[reason] : 'Your platform session has ended. Sign in again to continue.')
    else if (checkingSession.current && reason) setNotice(SESSION_ENDED_MESSAGES[reason])
  }), [end])

  const open = useCallback((value: AdminSession) => {
    if (!has(value.actor, 'platform.admin.access')) throw new Error(NO_ACCESS)
    signedIn.current = true
    // From here a refresh that answers for another administrator ends the workspace.
    setAdminSessionAccount(value.actor.accountId)
    setNotice(null)
    setSession(value)
    // Records the server's idle and absolute expiry for the session warning.
    if (!usesNovuBackend()) void adminApi.mfaStatus().catch(() => undefined)
    if (heardWhileOpening.current) { heardWhileOpening.current = false; recheckSession.current() }
  }, [])

  useEffect(() => {
    let active = true
    checkingSession.current = true
    heardWhileOpening.current = false
    setAdminSessionAccount(null)
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
    }).finally(() => { if (active) { checkingSession.current = false; setChecking(false) } })
    return () => { active = false; checkingSession.current = false }
  }, [checkRevision, open])

  useEffect(() => () => closeAdminSession(), [])

  // Nothing else reveals that another tab signed a different administrator in,
  // or this one out, while this tab sent no request. When another admin tab
  // says so, or the page returns after a while away or from the back/forward
  // cache, the server is asked whose session the browser holds. Another
  // administrator's ends the workspace; a refused session ends it through the
  // client's 401; a question the server could not answer (an outage) changes
  // nothing. A change announced while the next workspace is being opened is asked
  // about once it opens.
  useEffect(() => {
    let asking = false
    let again = false
    let hiddenSince: number | null = null
    const recheck = () => {
      const accountId = adminSessionAccount()
      if (!signedIn.current || accountId === null) return
      if (asking) { again = true; return }
      asking = true
      void adminApi.session().then(value => {
        if (signedIn.current && adminSessionAccount() === accountId && value.actor.accountId !== accountId) {
          reportSessionEnded('switched')
        }
      }).catch(() => undefined).finally(() => {
        asking = false
        if (again) { again = false; recheck() }
      })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { hiddenSince ??= Date.now(); return }
      const away = hiddenSince === null ? 0 : Date.now() - hiddenSince
      hiddenSince = null
      if (away >= RECHECK_AFTER_HIDDEN_MS) recheck()
    }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) recheck() }
    recheckSession.current = recheck
    const stopListening = onOtherAdminTabSessionChange(() => {
      if (signedIn.current) recheck()
      else heardWhileOpening.current = true
    })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      stopListening()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // MFA verification or activation has already replaced the browser's platform
  // cookies and told the other admin tabs (api.ts), whether or not this workspace opens.
  async function signedInNow() {
    heardWhileOpening.current = false
    setAdminSessionAccount(null)
    let value: AdminSession
    try { value = await adminApi.session() }
    catch (error) {
      if (usesNovuBackend() && isHidApiError(error) && error.status === 403) throw new Error(NO_ACCESS)
      throw new Error(failure(error, 'Platform administration could not be opened. Try again.'))
    }
    open(value)
  }

  // The check before logout can take a second of retries: a second press starts nothing more.
  async function signOut() {
    if (signOutRunning.current) return
    signOutRunning.current = true
    setSigningOut(true)
    try { await signOutOnce() }
    finally { signOutRunning.current = false; setSigningOut(false) }
  }

  async function signOutOnce() {
    setSignOutError(null)
    const accountId = adminSessionAccount()
    // The reason the workspace ended with while signing out, if it did and had one.
    let ended = null as SessionEndReason | null
    const stopWatching = onSessionEnded(reason => { if (reason) ended ??= reason })
    try {
      // Logout ends whichever platform session the browser's cookies carry, and a
      // tab that has not yet heard of another administrator's sign-in would end
      // theirs. The server is asked first, restoring a lapsed access token on the
      // way, so the logout also reaches a session idle for a few minutes.
      if (accountId !== null && (await adminApi.session()).actor.accountId !== accountId) {
        end(SESSION_ENDED_MESSAGES.switched)
        return
      }
      await adminApi.logout()
      end(SIGNED_OUT)
    } catch (reason) {
      if (!isHidApiError(reason) || reason.status !== 401) {
        // A refusal that ended the workspace (403 PLATFORM_SESSION_REQUIRED) has said why already.
        if (signedIn.current) setSignOutError(failure(reason, 'Sign-out could not be completed.'))
        return
      }
      // The browser holds another administrator's session, which is left alone.
      if (ended === 'switched') return
      // A session that expired or was revoked has already ended the workspace with that
      // reason, whichever request was refused (on a lapsed access token, the refresh
      // gives it), and the notice is kept. Only an end with no reason reads as signed out.
      if (!ended) end(SIGNED_OUT)
    } finally { stopWatching() }
    // The other admin tabs used the same session.
    announceAdminSessionChange()
  }

  // Each screen is a main landmark holding its status or alert: a role on the main element itself would replace the landmark.
  if (checking) return <main className="admin-message"><BrandLogo className="admin-state-logo" /><p role="status">Checking your platform session…</p></main>
  if (checkError) return <main className="admin-message"><BrandLogo className="admin-state-logo" /><h1>Session unavailable</h1>
    <p role="alert">{checkError}</p><button type="button" className="admin-primary" onClick={() => setCheckRevision(value => value + 1)}>Try again</button></main>
  if (!session) return usesNovuBackend()
    ? <NovuAdminSignIn onSignedIn={signedInNow} notice={notice} />
    : <AdminSignIn onSignedIn={signedInNow} notice={notice} />
  const actor = session.actor
  const sections = visibleNavigation(actor)

  return (
    <StepUpProvider>
      <div className="admin-app">
        <a className="admin-skip" href="#admin-main">Skip to content</a>
        <aside className="admin-sidebar" aria-label="Platform administration">
          <div className="admin-brand"><BrandLogo /><small>Platform</small></div>
          <nav className="admin-nav" aria-label="Platform areas">
            {sections.map(section => <div className="admin-nav-section" key={section.title}>
              <p className="admin-nav-heading">{section.title}</p>
              <ul>{section.items.map(item => <li key={item.path}>
                <NavLink to={item.path} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
                  {item.title}
                </NavLink></li>)}</ul>
            </div>)}
          </nav>
          <div className="admin-sidebar-footer"><span>{actor.displayName || actor.email || 'Platform administrator'}</span>
            <button type="button" disabled={signingOut} onClick={() => void signOut()}>Sign out</button></div>
        </aside>
        <div className="admin-main-wrap">
          <header className="admin-mobile-header"><Link to="/admin/overview" className="admin-mobile-logo"><BrandLogo /><span>Platform</span></Link>
            <button type="button" disabled={signingOut} onClick={() => void signOut()}>Sign out</button></header>
          <nav className="admin-mobile-nav" aria-label="Platform areas">
            {sections.flatMap(section => section.items).map(item => <NavLink key={item.path} to={item.path}>{item.title}</NavLink>)}
          </nav>
          <main id="admin-main" className="admin-main">
            <SessionWarning />
            {signOutError ? <p role="alert" className="admin-error">{signOutError}</p> : null}
            <Routes>
              <Route index element={<Navigate to="/admin/overview" replace />} />
              <Route path="sign-in" element={<Navigate to="/admin/overview" replace />} />
              <Route path="overview" element={<Area path="/admin/overview" actor={actor}><OverviewPage actor={actor} /></Area>} />
              <Route path="applications" element={<Area path="/admin/applications" actor={actor}><ApplicationsPage actor={actor} /></Area>} />
              <Route path="facilities" element={<Area path="/admin/facilities" actor={actor}><FacilitiesPage actor={actor} /></Area>} />
              <Route path="facilities/:facilityId" element={<Area path="/admin/facilities" actor={actor}><FacilityDetailPage actor={actor} /></Area>} />
              <Route path="principals" element={<Area path="/admin/principals" actor={actor}><PrincipalsPage actor={actor} /></Area>} />
              <Route path="approvals" element={<Area path="/admin/approvals" actor={actor}><ApprovalsPage actor={actor} /></Area>} />
              <Route path="reviews" element={<Area path="/admin/reviews" actor={actor}><ReviewsPage /></Area>} />
              <Route path="clinicians" element={<Area path="/admin/clinicians" actor={actor}><ClinicianApplicationsPage actor={actor} /></Area>} />
              <Route path="clinicians/:applicationId" element={<Area path="/admin/clinicians" actor={actor}><ClinicianApplicationPage actor={actor} /></Area>} />
              <Route path="audit" element={<Area path="/admin/audit" actor={actor}><AuditPage /></Area>} />
              <Route path="security" element={<Area path="/admin/security" actor={actor}><SecurityPage onSignOut={() => void signOut()} /></Area>} />
              <Route path="operations" element={<Area path="/admin/operations" actor={actor}><OperationsPage /></Area>} />
              <Route path="integrations" element={<Area path="/admin/integrations" actor={actor}><IntegrationsPage actor={actor} /></Area>} />
              <Route path="controls" element={<Area path="/admin/controls" actor={actor}><ControlsPage actor={actor} /></Area>} />
              <Route path="pricing" element={<Area path="/admin/pricing" actor={actor}><PricingPage actor={actor} /></Area>} />
              <Route path="demos" element={<Area path="/admin/demos" actor={actor}><DemosPage actor={actor} /></Area>} />
              <Route path="*" element={<NotFound />} />
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
    // Re-read once: the window may have changed between this render and the subscription.
    setTick(value => value + 1)
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
