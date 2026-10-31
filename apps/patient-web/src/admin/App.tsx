import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Activity, Blocks, Building2, CircleDollarSign, ClipboardCheck, FileCheck2, LayoutDashboard, Lock, Megaphone, PhoneOff, Route as RouteIcon, ScanFace, ScrollText, ShieldCheck, ShieldX, SlidersHorizontal, Stethoscope, TriangleAlert, UserPlus, Users, Compass } from 'lucide-react'
import { AppShell, type NavItem } from '../kasuwa/AppShell'
import { Alert, Badge, Button, EmptyState, type Icon } from '../kasuwa/ui'
import { ToastProvider } from '../kasuwa/toast'
import { isHidApiError } from '@hid/http'
import {
  adminApi, adminSessionAccount, closeAdminSession, setAdminSessionAccount, type AdminActor, type AdminSession,
} from './api'
import { ApprovalsPage } from './Approvals'
import { ClinicianApplicationPage, ClinicianApplicationsPage } from './ClinicianApplications'
import { AuditPage } from './Audit'
import { EmergencyContactAlertsPage } from './EmergencyContacts'
import { BrandLogo } from '../BrandLogo'
import { OverviewPage } from './Dashboard'
import { FacilitiesPage, FacilityDetailPage } from './Facilities'
import { IntegrationsPage } from './Integrations'
import { ApplicationsPage } from './Organizations'
import { ControlsPage, DemosPage, OperationsPage, PricingPage, ReviewsPage } from './Pages'
import { PrincipalsPage } from './Principals'
import { SelfServiceFacilitiesPage } from './SelfServiceFacilities'
import { OrderRoutesPage } from './OrderRoutes'
import { WrongPatientReportsPage } from './WrongPatientReports'
import { failure } from './problems'
import { SecurityPage } from './SecurityPage'
import {
  clearSessionWindow, currentSessionWindow, onSessionEnded, onSessionWindow, reportSessionEnded, type SessionEndReason,
} from './session-window'
import { isServed, navigationItemFor, visibleNavigation, type NavigationSection } from './navigation'
import { useWrongPatientServed } from '../wrongPatientServed'
import { AdminSignIn } from './SignIn'
import { NovuAdminSignIn } from './NovuSignIn'
import { usesNovuBackend } from '../backendContract'
import { StepUpProvider } from './StepUp'
import { announceAdminSessionChange, onOtherAdminTabSessionChange } from './tabs'
import { date, has } from './ui'
import './style.css'

/** The server's PLATFORM_SESSION_EXPIRED / PLATFORM_SESSION_REVOKED, or the reading of its reported expiry. */
export const SESSION_ENDED_MESSAGES: Readonly<Record<SessionEndReason, string>> = {
  expired: 'You were signed out after 15 minutes without activity, or after 8 hours. Sign in again to continue.',
  revoked: 'You were signed out from another session or by another administrator, or your roles or authenticator '
    + 'changed. Sign in again. Tell your security team if you didn’t expect this.',
  switched: 'Another administrator signed in on this browser, so you were signed out here. Sign in again to continue.',
}
const NO_ACCESS = 'This account can’t use platform administration.'
const SIGNED_OUT = 'You’ve signed out.'

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
  return <section role="alert" aria-labelledby="admin-forbidden-title">
    <h1 id="admin-forbidden-title" className="sr-only">You can’t open this page</h1>
    <EmptyState icon={ShieldX} title={`You can’t open ${item ? item.title : 'this page'}`}
      description="Your roles don’t include it. Ask a Super Admin if you need it."
      action={<Button to="/admin/overview">Go to overview</Button>} />
  </section>
}

function NotFound() {
  return <section aria-labelledby="admin-not-found-title">
    <h1 id="admin-not-found-title" className="sr-only">Page not found</h1>
    <EmptyState icon={Compass} title="Page not found" description="This page doesn’t exist."
      action={<Button to="/admin/overview">Go to overview</Button>} />
  </section>
}

/** Groups long enough to fold (Hick's law): they open while they hold the current page. */
const FOLDING_GROUPS: ReadonlySet<string> = new Set(['Operations', 'Commercial'])
/** The phone tabs, in order of preference: the first three this administrator may open. */
const TAB_PREFERENCE = ['/admin/overview', '/admin/facilities', '/admin/principals', '/admin/audit', '/admin/approvals', '/admin/applications']
const TAB_LABELS: Readonly<Record<string, string>> = { '/admin/principals': 'Users', '/admin/applications': 'Applications' }

/** The phone tabs from the same visible navigation as the sidebar, so a tab never leads to a page this account can't open. */
function phoneTabs(sections: readonly NavigationSection[]): readonly [NavItem, NavItem, NavItem] {
  const items = sections.flatMap(section => section.items)
  const ordered = [...TAB_PREFERENCE.flatMap(path => items.filter(item => item.path === path)), ...items.filter(item => !TAB_PREFERENCE.includes(item.path))]
  const tabs = ordered.slice(0, 3).map(item => ({ to: item.path, label: TAB_LABELS[item.path] ?? item.title, icon: ADMIN_ICONS[item.path] ?? LayoutDashboard }))
  // Every administrator can open Overview; an account with fewer than three areas repeats nothing it can't open.
  while (tabs.length < 3) tabs.push({ to: `/admin/overview#${tabs.length}`, label: 'Overview', icon: LayoutDashboard })
  return [tabs[0]!, tabs[1]!, tabs[2]!]
}

/** Names the browser tab after the current area. */
function useAreaTitle() {
  const location = useLocation()
  useEffect(() => {
    const item = navigationItemFor(location.pathname)
    document.title = `${item && isServed(item) ? item.title : 'Platform'} · Health ID Platform`
  }, [location.pathname])
}

export function App() {
  // The sidebar lists support's wrong-patient reports only while no answer has said the backend lacks them (item 3).
  useWrongPatientServed()
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
  if (checking) return <main className="admin-message"><BrandLogo className="admin-state-logo" /><p role="status">Checking your sign-in…</p></main>
  if (checkError) return <main className="admin-message"><BrandLogo className="admin-state-logo" /><h1>Couldn’t check your sign-in</h1>
    <p role="alert">{checkError}</p><Button variant="primary" onClick={() => setCheckRevision(value => value + 1)}>Try again</Button></main>
  if (!session) return usesNovuBackend()
    ? <NovuAdminSignIn onSignedIn={signedInNow} notice={notice} />
    : <AdminSignIn onSignedIn={signedInNow} notice={notice} />
  const actor = session.actor
  const sections = visibleNavigation(actor)

  return (
    <ToastProvider><StepUpProvider>
      <AppShell
        brand={<Link to="/admin/overview" aria-label="Health ID platform home" className="inline-flex items-center gap-2.5 no-underline"><BrandLogo className="h-7 w-auto" /><Badge tone="violet" size="sm">Admin</Badge></Link>}
        switcher={{ name: 'Health ID platform', subtitle: actor.platformRoles.map(role => role.replace(/^platform_/, '').replace(/_/g, ' ')).join(', ') || 'Administrator',
          avatar: <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-violet text-white"><ShieldCheck className="size-5" /></span> }}
        nav={sections.map(section => ({ title: section.title === 'Platform' ? undefined : section.title, collapsible: FOLDING_GROUPS.has(section.title),
          items: section.items.map(item => ({ to: item.path, label: item.title, icon: ADMIN_ICONS[item.path] ?? LayoutDashboard })) }))}
        person={{ name: actor.displayName || actor.email || 'Platform administrator', detail: actor.email || 'Platform', profileTo: has(actor, 'platform.admin.access') ? '/admin/security' : undefined }}
        onSignOut={() => void signOut()}
        signingOut={signingOut}
        headerStart={<Link to="/admin/overview" aria-label="Health ID platform home" className="inline-flex items-center gap-2 no-underline lg:hidden"><BrandLogo className="h-7 w-auto" /><Badge tone="violet" size="sm">Admin</Badge></Link>}
        tabs={phoneTabs(sections)}>
          <div id="admin-main" className="admin-main @container">
            <SessionWarning />
            {signOutError ? <Alert intent="error" className="mb-4">{signOutError}</Alert> : null}
            <Routes>
              <Route index element={<Navigate to="/admin/overview" replace />} />
              <Route path="sign-in" element={<Navigate to="/admin/overview" replace />} />
              <Route path="overview" element={<Area path="/admin/overview" actor={actor}><OverviewPage actor={actor} /></Area>} />
              <Route path="applications" element={<Area path="/admin/applications" actor={actor}><ApplicationsPage actor={actor} /></Area>} />
              <Route path="self-service-facilities" element={<Area path="/admin/self-service-facilities" actor={actor}><SelfServiceFacilitiesPage actor={actor} /></Area>} />
              <Route path="facilities" element={<Area path="/admin/facilities" actor={actor}><FacilitiesPage actor={actor} /></Area>} />
              <Route path="facilities/:facilityId" element={<Area path="/admin/facilities" actor={actor}><FacilityDetailPage actor={actor} /></Area>} />
              <Route path="order-routes" element={<Area path="/admin/order-routes" actor={actor}><OrderRoutesPage actor={actor} /></Area>} />
              <Route path="wrong-patient-reports" element={<Area path="/admin/wrong-patient-reports" actor={actor}><WrongPatientReportsPage actor={actor} /></Area>} />
              <Route path="principals" element={<Area path="/admin/principals" actor={actor}><PrincipalsPage actor={actor} /></Area>} />
              <Route path="emergency-contacts" element={<Area path="/admin/emergency-contacts" actor={actor}><EmergencyContactAlertsPage /></Area>} />
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
          </div>
      </AppShell>
    </StepUpProvider></ToastProvider>
  )
}

/** Each platform area's icon, by path. */
const ADMIN_ICONS: Readonly<Record<string, Icon>> = {
  '/admin/overview': LayoutDashboard, '/admin/applications': FileCheck2, '/admin/self-service-facilities': UserPlus,
  '/admin/facilities': Building2, '/admin/order-routes': RouteIcon, '/admin/wrong-patient-reports': TriangleAlert,
  '/admin/principals': Users, '/admin/emergency-contacts': PhoneOff, '/admin/approvals': ClipboardCheck,
  '/admin/reviews': ScanFace, '/admin/clinicians': Stethoscope, '/admin/audit': ScrollText, '/admin/security': Lock,
  '/admin/operations': Activity, '/admin/integrations': Blocks, '/admin/controls': SlidersHorizontal,
  '/admin/pricing': CircleDollarSign, '/admin/demos': Megaphone,
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

  return <div className="mb-4 flex flex-col gap-2"><Alert intent="warning" title={atLimit ? `You’ll be signed out at ${ends}` : `You’ll be signed out at ${ends} if you stay idle`}
    action={atLimit ? undefined : <Button size="sm" loading={busy} disabled={busy} onClick={() => void stay()}>{busy ? 'Extending…' : 'Stay signed in'}</Button>}>
    {atLimit ? 'Sessions last at most 8 hours. Save your work.' : null}
  </Alert>{error && <Alert intent="error" size="sm">{error}</Alert>}</div>
}
