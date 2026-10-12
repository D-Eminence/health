import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useHref, useLinkClickHandler, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { Badge, Button, ButtonLink, EmptyState, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import { staffApi, type PatientLookup, type StaffSession } from './api'
import { facilityChoiceNeeded, type FacilityChoiceReason } from './facilitySelection'
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
import { revealFocusedLink } from '../navStrip'
import { focusPageHeading, useFocusOnPageChange } from './pageFocus'
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
  // A change another tab announced while this tab's session was still being read
  // or signed in: that answer may predate it, so the session is asked about once
  // it is ready.
  const heardWhileOpening = useRef(false)
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
  const askIfHeardWhileOpening = useCallback(() => {
    if (!heardWhileOpening.current) return
    heardWhileOpening.current = false
    ask(staffSessionGeneration())
  }, [ask])

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
    const stopListening = onOtherTabSessionChange(() => {
      if (status.current === 'ready') recheck()
      else heardWhileOpening.current = true
    })
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
    heardWhileOpening.current = false
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
      askIfHeardWhileOpening()
    } catch (error) {
      if (!current()) return
      if (isHidApiError(error) && error.status === 401) {
        setState({ status: 'signed-out', session: null })
      } else {
        setState({ status: 'error', session: null, error: error instanceof Error ? error.message : 'Session could not be verified.' })
      }
    }
  }, [setState, setLock, startPeriod, askIfHeardWhileOpening])

  useEffect(() => { void refresh() }, [refresh])

  async function login(email: string, password: string, turnstileToken?: string) {
    heardWhileOpening.current = false
    const session = await staffApi.login(email, password, turnstileToken)
    if (session.actor.kind === 'patient') throw new Error('A staff account is required for this portal.')
    startStaffSessionGeneration()
    startPeriod()
    away.current = null
    setLock(null)
    setState({ status: 'ready', session })
    announceStaffSessionChange()
    askIfHeardWhileOpening()
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
    // From a workspace locked for a check, the server is asked first whose session the browser holds.
    await staffApi.logout(lockRef.current === 'checking' || lockRef.current === 'unconfirmed')
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

/** Why the question is asked, as the page says it. */
const FACILITY_CHOICE_WHY: Record<FacilityChoiceReason, string> = {
  reselect: 'The facility you chose for this sign-in is no longer available to you.',
  unchosen: 'You work at more than one facility.',
  unconfirmed: 'The facility for this sign-in is not confirmed.',
}

/**
 * Asks where the person is working before any page opens, so that no facility is
 * used that they did not choose (hid-system ADR-046): when the facility chosen for
 * this sign-in is no longer available ('reselect'), when none was chosen and
 * they work at more than one ('unchosen'), or when Identity reports a selection
 * this portal does not know ('unconfirmed'). Nothing is preselected. Choosing sends
 * the same POST /auth/facility as a switch, and Identity keeps it for the sign-in,
 * so a reload or a refresh reports it ('selected').
 */
function FacilityChoice({ reason, onChosen }: { reason: FacilityChoiceReason; onChosen: () => void }) {
  const { state, lock, selectFacility } = useStaff()
  const [picked, setPicked] = useState('')
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  // The question is the page: it takes focus when it appears, unless the person is already somewhere on it.
  // One that appears while the workspace is locked (hidden at load, or a sign-in being checked) takes it
  // once the workspace opens, once.
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current || lock !== null) return
    focused.current = true
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body || !active.isConnected) heading.current?.focus()
  }, [lock])
  if (state.status !== 'ready') return null
  const { facilities } = state.session.actor

  async function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!picked) {
      setMissing(true)
      document.querySelector<HTMLInputElement>('input[name="staff-facility-choice"]')?.focus()
      return
    }
    setBusy(true)
    try { if (await selectFacility(picked)) onChosen() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Facility could not be selected.') }
    finally { setBusy(false) }
  }

  return <section className="staff-card staff-facility-choice" aria-labelledby="staff-facility-choice-title">
    <h1 id="staff-facility-choice-title" ref={heading} tabIndex={-1}>Where are you working?</h1>
    <p id="staff-facility-choice-why">{FACILITY_CHOICE_WHY[reason]} Choose where you are working before you continue. Patient access, records and requests use the facility you choose, and you can switch later from “Working at”.</p>
    <form className="staff-form" noValidate onSubmit={event => void choose(event)}>
      <fieldset aria-describedby={missing ? 'staff-facility-choice-why staff-facility-choice-missing' : 'staff-facility-choice-why'}>
        <legend>Facility</legend>
        {facilities.map(facility => <label key={facility.id} className="staff-choice">
          <input type="radio" name="staff-facility-choice" value={facility.id} checked={picked === facility.id}
            onChange={() => { setPicked(facility.id); setMissing(false) }} /> {facility.name}
        </label>)}
      </fieldset>
      {missing && <p id="staff-facility-choice-missing" role="alert" className="staff-error">Choose a facility to continue.</p>}
      {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
      <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Continue'}</Button>
    </form>
    {error && <p role="alert" className="staff-error">{error}</p>}
  </section>
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
  const { state, selectFacility, signOut, activePatient, lock } = useStaff()
  const [facilityError, setFacilityError] = useState('')
  const [signOutError, setSignOutError] = useState('')
  const [switching, setSwitching] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const navigate = useNavigate()
  const main = useRef<HTMLElement>(null)
  useFocusOnPageChange(main, lock !== null)
  // A facility chosen in the list is not switched to until the switch is confirmed: on a
  // closed list one arrow key changes the value (WCAG 3.2.2). The choice belongs to the
  // account and facility it was made in, so a refresh, a switch from another tab, a lock
  // or the next session that changes either discards it. It also belongs to the page:
  // moving to another page discards it, as Cancel does, so the list never goes on showing
  // an unconfirmed facility while work continues at the one in use.
  const [choice, setChoice] = useState<{ from: string; to: string } | null>(null)
  // Set by a switch made on the overview, or by the first choice of facility, after
  // which the page's heading takes focus once the workspace is open, unless the
  // user has put focus somewhere since. From any other
  // page the change of page moves focus (useFocusOnPageChange) once the overview shows;
  // focusing now would reach the old page's heading while the router's transition is
  // pending.
  const [focusHeading, setFocusHeading] = useState(false)
  useEffect(() => {
    if (!focusHeading || lock !== null) return
    setFocusHeading(false)
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body || !active.isConnected) focusPageHeading(main.current)
  }, [focusHeading, lock])
  const { pathname } = useLocation()
  const shownPath = useRef(pathname)
  useEffect(() => {
    // Only a change of page discards the proposal, not the shell's first render.
    if (shownPath.current !== pathname) setChoice(null)
    shownPath.current = pathname
  }, [pathname])
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const choiceNeeded = facilityChoiceNeeded(state.session)
  const currentFacility = actor.facility
  const permissions = currentFacility?.permissions ?? []
  const visible = navigation.filter(item => !item.permission || permissions.includes(item.permission))
  const choosingFrom = `${actor.id}|${currentFacility?.id ?? ''}`
  const chosenId = choice?.from === choosingFrom ? choice.to : currentFacility?.id ?? ''
  const chosen = chosenId !== (currentFacility?.id ?? '') ? actor.facilities.find(facility => facility.id === chosenId) : undefined

  async function switchFacility() {
    if (switching || !chosen) return
    setFacilityError('')
    setSwitching(true)
    try {
      if (await selectFacility(chosen.id)) {
        const onOverview = shownPath.current === '/provider'
        setChoice(null)
        navigate('/provider')
        if (onOverview) setFocusHeading(true)
      }
    }
    catch (error) { setFacilityError(error instanceof Error ? error.message : 'Facility could not be selected.') }
    finally { setSwitching(false) }
  }

  function keepFacility() {
    setChoice(null)
    setFacilityError('')
    document.getElementById('staff-facility-select')?.focus()
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
        {!choiceNeeded && <div className="staff-facility">
          <label htmlFor="staff-facility-select">Working at</label>
          <Select id="staff-facility-select" value={chosenId} disabled={switching} aria-describedby={chosen ? 'staff-facility-question' : undefined}
            onChange={event => { setFacilityError(''); setChoice({ from: choosingFrom, to: event.target.value }) }}>
            {!currentFacility && <option value="">Select a facility</option>}
            {actor.facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
          </Select>
          {chosen && <div className="staff-facility-confirm" role="group" aria-labelledby="staff-facility-question">
            <p id="staff-facility-question">{currentFacility ? `You are working at ${currentFacility.name}. Switch to ${chosen.name}?` : `Work at ${chosen.name}?`}{activePatient ? ' The open patient record will close.' : ''}</p>
            {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
            <div className="staff-row"><Button size="sm" onClick={() => void switchFacility()} aria-disabled={switching || undefined}>{switching ? 'Switching…' : 'Switch facility'}</Button><Button size="sm" tone="quiet" onClick={keepFacility} disabled={switching}>Cancel</Button></div>
          </div>}
          {facilityError && <p role="alert" className="staff-error">{facilityError}</p>}
        </div>}
        <nav className="staff-nav" onFocus={revealFocusedLink}>{visible.map(item => <NavLink key={item.to} to={item.to} end={item.to === '/provider'} className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}>{item.label}{item.to === '/provider/clinical' && !activePatient && <span className="staff-nav-meta">Select patient</span>}</NavLink>)}</nav>
        <div className="staff-sidebar-footer"><Badge tone="information">{actor.roles.join(', ') || 'Staff'}</Badge><p>Access is limited to your active facility and server permissions.</p></div>
      </aside>
      <main ref={main} className="staff-main">{signOutError && <p role="alert" className="staff-error">{signOutError}</p>}
        {choiceNeeded ? <FacilityChoice reason={choiceNeeded} onChosen={() => setFocusHeading(true)} /> : <Outlet />}</main>
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
