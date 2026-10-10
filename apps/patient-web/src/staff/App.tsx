import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useHref, useLinkClickHandler, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { Badge, Button, ButtonLink, EmptyState, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type PatientLookup, type StaffSession } from './api'
import { onStaffSessionEnded, staffSessionGeneration, staffSignInPath, startStaffSessionGeneration } from './session'
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

interface StaffContextValue {
  state: SessionState
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
  const setState = useCallback((next: SessionState) => {
    status.current = next.status; currentSession.current = next.session; setSessionState(next)
  }, [])
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
  // does not prove the session ended, so the server is asked (reports arriving
  // together share one question, as the client merges identical reads). Reports
  // from an earlier session, or while none is in use (loading, signed out,
  // already ended), change nothing.
  useEffect(() => onStaffSessionEnded(sentIn => {
    const actor = currentSession.current?.actor
    if (status.current !== 'ready' || !actor || sentIn !== staffSessionGeneration()) return
    void staffApi.sessionHasEnded(actor.id).then(ended => {
      if (!ended || status.current !== 'ready' || sentIn !== staffSessionGeneration()) return
      startStaffSessionGeneration()
      startPeriod()
      setState({ status: 'ended', session: null })
    })
  }), [setState, startPeriod])

  const refresh = useCallback(async () => {
    startStaffSessionGeneration()
    startPeriod()
    setState({ status: 'loading', session: null })
    try {
      let session: StaffSession
      try { session = await staffApi.session() }
      catch (error) {
        if (!isHidApiError(error) || error.status !== 401) throw error
        session = await staffApi.refresh()
      }
      if (session.actor.kind === 'patient') throw new Error('This account does not have a staff session.')
      setState({ status: 'ready', session })
    } catch (error) {
      if (isHidApiError(error) && error.status === 401) {
        setState({ status: 'signed-out', session: null })
      } else {
        setState({ status: 'error', session: null, error: error instanceof Error ? error.message : 'Session could not be verified.' })
      }
    }
  }, [setState, startPeriod])

  useEffect(() => { void refresh() }, [refresh])

  async function login(email: string, password: string, turnstileToken?: string) {
    const session = await staffApi.login(email, password, turnstileToken)
    if (session.actor.kind === 'patient') throw new Error('A staff account is required for this portal.')
    startStaffSessionGeneration()
    startPeriod()
    setState({ status: 'ready', session })
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
    const owner = period.current
    await staffApi.logout()
    // A sign-out answered after its session ended must not sign out the next one.
    if (period.current !== owner) return
    startStaffSessionGeneration()
    startPeriod()
    setState({ status: 'signed-out', session: null })
  }

  const value = useMemo<StaffContextValue>(() => ({ state, activePatient, login, refresh, selectFacility, signOut, setActivePatient }), [state, activePatient, refresh, setActivePatient])
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>
}

/**
 * Shown in place of the whole workspace once the server stops accepting the
 * session. The workspace and every page under it are gone, with whatever
 * patient information they held. The wording is fixed: it carries no server
 * detail, and the backend gives staff clients no reason to name.
 */
function SessionEnded() {
  const location = useLocation()
  const signIn = staffSignInPath(location.pathname)
  const href = useHref(signIn)
  const follow = useLinkClickHandler(signIn)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  return <div className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" role="alert" aria-labelledby="staff-session-ended-title">
      <h1 id="staff-session-ended-title" ref={heading} tabIndex={-1}>Your session has ended</h1>
      <p>For your security, the provider workspace was closed and the patient information it showed was cleared. Sign in again to continue.</p>
      <ButtonLink href={href} onClick={follow}>Sign in again</ButtonLink>
    </section>
  </div>
}

function Gate({ children }: { children: ReactNode }) {
  const { state, refresh } = useStaff()
  if (state.status === 'ended') return <SessionEnded />
  if (state.status === 'loading') return <div className="staff-centered" role="status"><BrandLogo className="staff-state-logo" />Checking your secure session…</div>
  if (state.status === 'error') return <div className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState title="Session unavailable" description={state.error} action={<Button onClick={() => void refresh()}>Try again</Button>} /></div>
  if (state.status === 'signed-out') {
    const productRoute = resolveStaffProductHostname(window.location.hostname)?.route
    const signInPath = productRoute ? `/provider/sign-in?returnTo=${encodeURIComponent(productRoute)}` : '/provider/sign-in'
    return <Navigate to={signInPath} replace />
  }
  if (state.session.actor.facilities.length === 0) return <div className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState title="No facility assignment" description="Your account has no active facility membership. Ask your organization administrator for access." /></div>
  return <>{children}</>
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
