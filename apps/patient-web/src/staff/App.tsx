import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useHref, useLinkClickHandler, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { Badge, Button, ButtonLink, EmptyState, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type PatientLookup, type StaffSession } from './api'
import {
  announceStaffSessionChange, onOtherTabSessionChange, onStaffSessionEnded, setStaffSessionActor, setStaffSessionReady,
  staffSessionGeneration, staffSignInPath, startStaffSessionGeneration,
} from './session'
import { SignIn } from './routes/SignIn'
import { Dashboard } from './routes/Dashboard'
import { Patients } from './routes/Patients'
import { Registration } from './routes/Registration'
import { AccessRequests } from './routes/AccessRequests'
import { FacilityAudit } from './routes/Audit'
import { Clinical } from './routes/Clinical'
import { Laboratory, Pharmacy, Ocr, Outreach, MigrateGap } from './routes/Operations'
import { resolveStaffProductHostname } from '../productHostname'
import './style.css'

type SessionState =
  | { status: 'loading'; session: null }
  | { status: 'error'; session: null; error: string }
  | { status: 'signed-out'; session: null }
  /** The server stopped accepting the session while it was in use (expired, revoked or ended elsewhere). */
  | { status: 'ended'; session: null }
  | { status: 'ready'; session: StaffSession }

export interface ActivePatient {
  hid: string
  lookup: Extract<PatientLookup, { patient: object }>
  purpose: 'direct-care' | 'emergency'
}

/**
 * Why the workspace is locked while the session is ready: the page is away
 * (hidden, or in the back/forward cache), the server is being asked whether the
 * session still holds, or it could not say. Locked, the workspace is hidden and
 * inert, and protected requests wait (see `staffSessionReadyFor`).
 */
type SessionLock = 'away' | 'checking' | 'unconfirmed' | null

/** A tab back in view after this long asks the server before it shows the workspace again. */
const RECHECK_AFTER_HIDDEN_MS = 60_000

interface StaffContextValue {
  state: SessionState
  lock: SessionLock
  /** Asks the server again whether the session holds, locking the workspace meanwhile. */
  checkSession(): void
  activePatient: ActivePatient | null
  login(email: string, password: string, turnstileToken?: string): Promise<void>
  refresh(): Promise<void>
  /** Resolves false, changing nothing, when the session ended while the switch was answered. */
  selectFacility(id: string): Promise<boolean>
  signOut(): Promise<void>
  /**
   * Sets the patient open in this session. Returns false, changing nothing, when
   * the session or facility the caller's page belonged to has since ended, so a
   * late answer can neither reopen a patient nor move to their record.
   */
  setActivePatient(patient: ActivePatient | null): boolean
}

const StaffContext = createContext<StaffContextValue | null>(null)

export function useStaff() {
  const context = useContext(StaffContext)
  if (!context) throw new Error('Staff workspace context is unavailable')
  return context
}

function StaffProvider({ children }: { children: ReactNode }) {
  const [state, setSessionState] = useState<SessionState>({ status: 'loading', session: null })
  // The state as of the last change, read synchronously by the session-end listener.
  const status = useRef<SessionState['status']>('loading')
  const currentSession = useRef<StaffSession | null>(null)
  const [lock, setLockState] = useState<SessionLock>(null)
  const lockRef = useRef<SessionLock>(null)
  // Where focus was when the workspace locked, given back when it opens again.
  const focusBeforeLock = useRef<HTMLElement | null>(null)
  const setLock = useCallback((next: SessionLock) => {
    if (next !== null && lockRef.current === null && document.activeElement instanceof HTMLElement) focusBeforeLock.current = document.activeElement
    lockRef.current = next
    setLockState(next)
    setStaffSessionReady(status.current === 'ready' && next === null)
  }, [])
  // Since when, in which session, and whether into the back/forward cache, the page is away.
  const away = useRef<{ since: number; sentIn: number; cached: boolean } | null>(null)
  // Readiness for protected requests follows the state and the lock at once, not after a render.
  const setState = useCallback((next: SessionState) => {
    status.current = next.status; currentSession.current = next.session; setSessionState(next)
    setStaffSessionActor(next.status === 'ready' ? next.session.actor.id : null)
    // A session that becomes ready while the page is hidden (opened in the
    // background, or signed in or restored while away) is away from the start:
    // locked, and judged as it comes back like any other absence.
    if (next.status === 'ready' && document.visibilityState === 'hidden') {
      away.current ??= { since: Date.now(), sentIn: staffSessionGeneration(), cached: false }
      if (lockRef.current === null) setLock('away')
    }
    setStaffSessionReady(next.status === 'ready' && lockRef.current === null)
  }, [setLock])
  useEffect(() => {
    if (lock !== null) return
    const focused = focusBeforeLock.current
    focusBeforeLock.current = null
    if (focused?.isConnected) focused.focus()
  }, [lock])
  // Leaving the provider portal (for the patient portal, in the same page) leaves no session in use.
  useEffect(() => () => { setStaffSessionActor(null); setStaffSessionReady(false) }, [])
  // Each session, sign-out and facility starts a new period. A patient set by a page
  // from an earlier period is ignored, whenever its answer arrives.
  const period = useRef(0)
  const [currentPeriod, setCurrentPeriod] = useState(0)
  const [activePatient, setActivePatientValue] = useState<ActivePatient | null>(null)
  const startPeriod = useCallback(() => {
    period.current += 1
    setCurrentPeriod(period.current)
    setActivePatientValue(null)
  }, [])
  const setActivePatient = useMemo(() => {
    const owner = currentPeriod
    return (patient: ActivePatient | null) => {
      if (period.current !== owner || status.current !== 'ready') return false
      setActivePatientValue(patient)
      return true
    }
  }, [currentPeriod])

  // A protected request in the current session was refused with 401. That alone
  // does not prove the session ended, so the server is asked; but the refusal is
  // reason enough to lock the workspace at once, hiding every patient it shows,
  // until the server answers. A session it still accepts gets the workspace back
  // as it was; one it cannot vouch for stays locked. Reports from the same session
  // that arrive while it answers are asked about once more afterwards, since its
  // answer may predate them. Reports from an earlier session, or while none is in
  // use (loading, signed out, already ended), change nothing.
  const asking = useRef<{ sentIn: number; again: boolean } | null>(null)
  const ask = useCallback((sentIn: number) => {
    const actor = currentSession.current?.actor
    if (status.current !== 'ready' || !actor || sentIn !== staffSessionGeneration()) return
    setLock('checking')
    if (asking.current?.sentIn === sentIn) { asking.current.again = true; return }
    const question = { sentIn, again: false }
    asking.current = question
    void staffApi.checkSession(actor.id, sentIn).catch(() => 'unknown' as const).then(answer => {
      if (asking.current === question) asking.current = null
      if (status.current !== 'ready' || sentIn !== staffSessionGeneration()) return
      if (answer === 'ended') {
        startStaffSessionGeneration()
        startPeriod()
        away.current = null
        setState({ status: 'ended', session: null })
        setLock(null)
        announceStaffSessionChange()
      } else if (question.again) ask(sentIn)
      // An answer that arrives while the page is away, or still hidden, opens
      // nothing: the page is judged again as it comes back.
      else if (answer === 'alive') {
        if (document.visibilityState === 'hidden' && !away.current) away.current = { since: Date.now(), sentIn, cached: false }
        setLock(away.current?.sentIn === sentIn ? 'away' : null)
      }
      else setLock('unconfirmed')
    })
  }, [setState, setLock, startPeriod])
  useEffect(() => onStaffSessionEnded(ask), [ask])

  // Nothing else reveals a session that ended while this tab sent no request: a
  // sign-in, sign-out or end in another tab (staff or patient), or time away. The
  // workspace is locked as soon as the page is hidden or put in the back/forward
  // cache, so it is not what shows when the page is seen again, and as soon as
  // another tab says its session changed; the server is then asked before it opens.
  useEffect(() => {
    const recheck = () => ask(staffSessionGeneration())
    // Idempotent: a page already away stays away from when it first left, and a
    // stronger lock (checking, unconfirmed) is kept.
    const leave = (cached: boolean) => {
      if (status.current !== 'ready') return
      const left = away.current
      away.current = { since: left?.since ?? Date.now(), sentIn: left?.sentIn ?? staffSessionGeneration(), cached: (left?.cached ?? false) || cached }
      if (lockRef.current === null) setLock('away')
    }
    // Back in view. A brief absence of the same session, with nothing heard
    // meanwhile, opens the workspace again without asking; a return after a minute
    // or more, a page restored from the back/forward cache and one whose session
    // changed while it was away are asked about first.
    const back = (restored: boolean) => {
      // A restore reported while the page is still hidden is not a return: the
      // page stays away until it is seen.
      if (document.visibilityState === 'hidden') return
      const left = away.current
      away.current = null
      if (status.current !== 'ready') return
      // A restore whose visibility change already asked has nothing more to ask.
      if (!left) { if (restored && lockRef.current === null) recheck(); return }
      const brief = !restored && !left.cached && left.sentIn === staffSessionGeneration()
        && Date.now() - left.since < RECHECK_AFTER_HIDDEN_MS
      if (!brief) recheck()
      else if (lockRef.current === 'away') setLock(null)
    }
    const onVisibility = () => { if (document.visibilityState === 'hidden') leave(false); else back(false) }
    const onPageHide = (event: PageTransitionEvent) => leave(event.persisted)
    const onPageShow = (event: PageTransitionEvent) => back(event.persisted)
    // A page left away without the event that brings it back opens on the next focus, as on a return.
    const onFocus = () => { if (away.current && document.visibilityState === 'visible') back(false) }
    const stopListening = onOtherTabSessionChange(recheck)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    return () => {
      stopListening()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
    }
  }, [ask, setLock])

  const refresh = useCallback(async () => {
    startStaffSessionGeneration()
    const sentIn = staffSessionGeneration()
    startPeriod()
    away.current = null
    setState({ status: 'loading', session: null })
    setLock(null)
    // A sign-in or sign-out made while the session is read owns the state by the
    // time a late answer arrives: that answer is about the browser's earlier session.
    const current = () => staffSessionGeneration() === sentIn
    try {
      let session: StaffSession
      try { session = await staffApi.session() }
      catch (error) {
        if (!isHidApiError(error) || error.status !== 401 || !current()) throw error
        session = await staffApi.refresh()
      }
      if (!current()) return
      if (session.actor.kind === 'patient') throw new Error('This account does not have a staff session.')
      setState({ status: 'ready', session })
    } catch (error) {
      if (!current()) return
      if (isHidApiError(error) && error.status === 401) {
        setState({ status: 'signed-out', session: null })
      } else {
        setState({ status: 'error', session: null, error: error instanceof Error ? error.message : 'Session could not be verified.' })
      }
    }
  }, [setState, setLock, startPeriod])

  useEffect(() => { void refresh() }, [refresh])

  async function login(email: string, password: string, turnstileToken?: string) {
    const session = await staffApi.login(email, password, turnstileToken)
    if (session.actor.kind === 'patient') throw new Error('A staff account is required for this portal.')
    startStaffSessionGeneration()
    startPeriod()
    away.current = null
    setLock(null)
    setState({ status: 'ready', session })
    announceStaffSessionChange()
  }

  async function selectFacility(id: string) {
    const owner = period.current
    const session = await staffApi.selectFacility(id)
    // A switch answered after its session ended, or after another change, applies to nothing now.
    if (period.current !== owner || status.current !== 'ready') return false
    startPeriod()
    setState({ status: 'ready', session })
    return true
  }

  async function signOut() {
    // No next session can start meanwhile: signing in waits for a sign-out in progress.
    // So a sign-out answered while the session-ended screen shows also completes, as asked.
    await staffApi.logout()
    startStaffSessionGeneration()
    startPeriod()
    away.current = null
    setState({ status: 'signed-out', session: null })
    setLock(null)
    announceStaffSessionChange()
  }

  const checkSession = useCallback(() => ask(staffSessionGeneration()), [ask])
  const value = useMemo<StaffContextValue>(() => ({ state, lock, checkSession, activePatient, login, refresh, selectFacility, signOut, setActivePatient }),
    [state, lock, checkSession, activePatient, refresh, setActivePatient])
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>
}

/**
 * Shown in place of the whole workspace once the server stops accepting the
 * session. The workspace and every page under it are gone, with whatever
 * patient information they held. The wording is fixed: it carries no server
 * detail, and the backend gives staff clients no reason to name. It is announced
 * once, as focus moves to its heading; it is not also a live region.
 */
function SessionEnded() {
  const location = useLocation()
  const signIn = staffSignInPath(location.pathname)
  const href = useHref(signIn)
  const follow = useLinkClickHandler(signIn)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <div className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="staff-session-ended-title">
      <h1 id="staff-session-ended-title" ref={heading} tabIndex={-1}>Your session has ended</h1>
      <p>For your security, the provider workspace was closed and the patient information it showed was cleared. Sign in again to continue.</p>
      <ButtonLink href={href} onClick={follow}>Sign in again</ButtonLink>
    </section>
  </div>
}

/**
 * Shown over the locked workspace while the server is asked whether the session
 * holds, or once it could not say. The workspace stays hidden throughout; the
 * clinician can ask again or sign out. Announced, like the ended screen, by the
 * focus moving to its heading.
 */
function SessionCheck({ unconfirmed }: { unconfirmed: boolean }) {
  const { checkSession, signOut } = useStaff()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [unconfirmed])

  async function leave() {
    if (signingOut) return
    setError('')
    setSigningOut(true)
    try { await signOut() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
    finally { setSigningOut(false) }
  }

  return <div className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="staff-session-check-title">
      <h1 id="staff-session-check-title" ref={heading} tabIndex={-1}>{unconfirmed ? 'We could not confirm your session' : 'Checking your session…'}</h1>
      <p>{unconfirmed
        ? 'For your security, the provider workspace stays hidden until Health ID confirms your session. Try again, or sign out.'
        : 'For your security, the provider workspace is hidden while Health ID confirms your session.'}</p>
      {unconfirmed && <Button onClick={checkSession}>Try again</Button>}
      <Button tone="quiet" onClick={() => void leave()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
      {error && <p role="alert" className="staff-error">{error}</p>}
    </section>
  </div>
}

function Gate({ children }: { children: ReactNode }) {
  const { state, lock, refresh } = useStaff()
  if (state.status === 'ended') return <SessionEnded />
  if (state.status === 'loading') return <div className="staff-centered" role="status"><BrandLogo className="staff-state-logo" />Checking your secure session…</div>
  if (state.status === 'error') return <div className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState title="Session unavailable" description={state.error} action={<Button onClick={() => void refresh()}>Try again</Button>} /></div>
  if (state.status === 'signed-out') {
    const productRoute = resolveStaffProductHostname(window.location.hostname)?.route
    const signInPath = productRoute ? `/provider/sign-in?returnTo=${encodeURIComponent(productRoute)}` : '/provider/sign-in'
    return <Navigate to={signInPath} replace />
  }
  if (state.session.actor.facilities.length === 0) return <div className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState title="No facility assignment" description="Your account has no active facility membership. Ask your organization administrator for access." /></div>
  // Locked, the workspace is hidden and inert but stays mounted: nothing reloads,
  // and a session the server still accepts gets it back as it was.
  return <>{lock && <SessionCheck unconfirmed={lock === 'unconfirmed'} />}<div hidden={lock !== null} inert={lock !== null}>{children}</div></>
}

const navigation = [
  { to: '/provider', label: 'Overview', permission: '' },
  { to: '/provider/patients', label: 'Patient access', permission: 'identity.patient.read' },
  { to: '/provider/registration', label: 'Patient registration', permission: 'identity.registration.write' },
  { to: '/provider/requests', label: 'Access requests', permission: 'identity.consent.write' },
  { to: '/provider/audit', label: 'Facility audit', permission: 'audit.read' },
  { to: '/provider/clinical', label: 'Clinical record', permission: 'ehr.encounter.read' },
  { to: '/provider/laboratory', label: 'Laboratory', permission: 'lab.work-item.read' },
  { to: '/provider/pharmacy', label: 'Pharmacy', permission: 'pharmacy.work-item.read' },
  { to: '/provider/ocr', label: 'Document OCR', permission: 'ocr.job.read' },
  { to: '/provider/outreach', label: 'Outreach', permission: 'outreach.registration.read' },
] as const

function Shell() {
  const { state, selectFacility, signOut, activePatient } = useStaff()
  const [facilityError, setFacilityError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  const [switching, setSwitching] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const navigate = useNavigate()
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const currentFacility = actor.facility
  const permissions = currentFacility?.permissions ?? []
  const visible = navigation.filter(item => !item.permission || permissions.includes(item.permission))

  async function chooseFacility(id: string) {
    setFacilityError('')
    setSwitching(true)
    try { if (await selectFacility(id)) navigate('/provider') }
    catch (error) { setFacilityError(error instanceof Error ? error.message : 'Facility could not be selected.') }
    finally { setSwitching(false) }
  }

  async function leave() {
    if (signingOut) return
    setSignOutError('')
    setSigningOut(true)
    try { await signOut() }
    catch (error) { setSignOutError(error instanceof Error ? error.message : 'Sign-out could not be completed.') }
    finally { setSigningOut(false) }
  }

  return <div className="staff-app">
    <header className="staff-topbar">
      <NavLink to="/provider" className="staff-brand" aria-label="Health ID provider home"><BrandLogo /><small>Provider</small></NavLink>
      <div className="staff-topbar-actions">
        <span className="staff-user">{actor.displayName ?? actor.email ?? 'Staff member'}</span>
        <Button tone="quiet" size="sm" onClick={() => void leave()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
      </div>
    </header>
    <div className="staff-layout">
      <aside className="staff-sidebar" aria-label="Provider navigation">
        <div className="staff-facility">
          <label htmlFor="staff-facility-select">Working at</label>
          <Select id="staff-facility-select" value={currentFacility?.id ?? ''} disabled={switching} onChange={event => void chooseFacility(event.target.value)}>
            {!currentFacility && <option value="">Select a facility</option>}
            {actor.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
          </Select>
          {facilityError && <p role="alert" className="staff-error">{facilityError}</p>}
        </div>
        <nav className="staff-nav">{visible.map(item => <NavLink key={item.to} to={item.to} end={item.to === '/provider'} className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}>{item.label}{item.to === '/provider/clinical' && !activePatient && <span className="staff-nav-meta">Select patient</span>}</NavLink>)}</nav>
        <div className="staff-sidebar-footer"><Badge tone="information">{actor.roles.join(', ') || 'Staff'}</Badge><p>Access is limited to your active facility and server permissions.</p></div>
      </aside>
      <main className="staff-main">{signOutError && <p role="alert" className="staff-error">{signOutError}</p>}<Outlet /></main>
    </div>
  </div>
}

export function App() {
  return <StaffProvider><Routes>
    <Route path="sign-in" element={<SignIn />} />
    <Route element={<Gate><Shell /></Gate>}>
      <Route index element={<Dashboard />} />
      <Route path="patients" element={<Patients />} />
      <Route path="registration" element={<Registration />} />
      <Route path="requests" element={<AccessRequests />} />
      <Route path="audit" element={<FacilityAudit />} />
      <Route path="clinical" element={<Clinical />} />
      <Route path="laboratory" element={<Laboratory />} />
      <Route path="pharmacy" element={<Pharmacy />} />
      <Route path="ocr" element={<Ocr />} />
      <Route path="outreach" element={<Outreach />} />
      <Route path="migrate" element={<MigrateGap />} />
      <Route path="*" element={<EmptyState title="Page not found" description="This provider page is unavailable." action={<NavLink className="staff-text-link" to="/provider">Go to provider overview →</NavLink>} />} />
    </Route>
  </Routes></StaffProvider>
}
