import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { Badge, Button, EmptyState, Select } from '@hid/ui'
import { isHidApiError, isSessionClientMismatch, onSessionClientMismatch } from '@hid/http'
import { staffApi, type PatientLookup, type StaffSession } from './api'
import { SignIn } from './routes/SignIn'
import { Dashboard } from './routes/Dashboard'
import { Patients } from './routes/Patients'
import { Registration } from './routes/Registration'
import { AccessRequests } from './routes/AccessRequests'
import { FacilityAudit } from './routes/Audit'
import { Clinical } from './routes/Clinical'
import { Laboratory, Pharmacy, Ocr, Outreach, MigrateGap } from './routes/Operations'
import { resolveStaffProductHostname } from '../productHostname'
import { SessionHeldByPatientPortal } from './SessionHeldByPatientPortal'
import './style.css'

type SessionState =
  | { status: 'loading'; session: null }
  | { status: 'error'; session: null; error: string }
  | { status: 'signed-out'; session: null }
  | { status: 'ready'; session: StaffSession }

export interface ActivePatient {
  hid: string
  lookup: Extract<PatientLookup, { patient: object }>
  purpose: 'direct-care' | 'emergency'
}

interface StaffContextValue {
  state: SessionState
  activePatient: ActivePatient | null
  /**
   * Identity refused the workspace's refresh because the browser's sign-in
   * belongs to the patient portal (403 SESSION_CLIENT_MISMATCH, hid-system
   * #39). Cleared by the next staff sign-in.
   */
  heldByPatientPortal: boolean
  login(email: string, password: string, turnstileToken?: string): Promise<void>
  refresh(): Promise<void>
  selectFacility(id: string): Promise<void>
  signOut(): Promise<void>
  setActivePatient(patient: ActivePatient | null): void
}

const StaffContext = createContext<StaffContextValue | null>(null)

export function useStaff() {
  const context = useContext(StaffContext)
  if (!context) throw new Error('Staff workspace context is unavailable')
  return context
}

function StaffProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', session: null })
  const [activePatient, setActivePatient] = useState<ActivePatient | null>(null)
  const [heldByPatientPortal, setHeldByPatientPortal] = useState(false)

  // A patient signed in in this browser, replacing the staff cookies. That is
  // not an expired staff session, and nothing is signed out: the workspace
  // forgets its session and patient locally, so sign-in opens, and
  // SessionHeldByPatientPortal says where the browser's sign-in belongs.
  useEffect(() => onSessionClientMismatch(event => {
    if (event.clientId !== 'staff-web') return
    setHeldByPatientPortal(true)
    setActivePatient(null)
    setState({ status: 'signed-out', session: null })
  }), [])

  const refresh = useCallback(async () => {
    setState({ status: 'loading', session: null })
    try {
      let session: StaffSession
      try { session = await staffApi.session() }
      catch (error) {
        if (!isHidApiError(error) || error.status !== 401) throw error
        session = await staffApi.refresh()
      }
      if (session.actor.kind === 'patient') throw new Error('This account does not have a staff session.')
      setHeldByPatientPortal(false)
      setState({ status: 'ready', session })
    } catch (error) {
      if ((isHidApiError(error) && error.status === 401) || isSessionClientMismatch(error)) {
        setState({ status: 'signed-out', session: null })
      } else {
        setState({ status: 'error', session: null, error: error instanceof Error ? error.message : 'Session could not be verified.' })
      }
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  async function login(email: string, password: string, turnstileToken?: string) {
    const session = await staffApi.login(email, password, turnstileToken)
    if (session.actor.kind === 'patient') throw new Error('A staff account is required for this portal.')
    setActivePatient(null)
    setHeldByPatientPortal(false)
    setState({ status: 'ready', session })
  }

  async function selectFacility(id: string) {
    const session = await staffApi.selectFacility(id)
    setActivePatient(null)
    setState({ status: 'ready', session })
  }

  async function signOut() {
    await staffApi.logout()
    setActivePatient(null)
    setState({ status: 'signed-out', session: null })
  }

  const value = useMemo<StaffContextValue>(() => ({ state, activePatient, heldByPatientPortal, login, refresh, selectFacility, signOut, setActivePatient }), [state, activePatient, heldByPatientPortal, refresh])
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>
}

function Gate({ children }: { children: ReactNode }) {
  const { state, refresh } = useStaff()
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
    try { await selectFacility(id); navigate('/provider') }
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
    <Route element={<SessionHeldByPatientPortal><Gate><Shell /></Gate></SessionHeldByPatientPortal>}>
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
