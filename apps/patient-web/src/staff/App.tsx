import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Navigate, Outlet, Route, Routes, useHref, useLinkClickHandler, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '../BrandLogo'
import { Badge, Button, ButtonLink, Card, EmptyState, Select } from '@hid/ui'
import { isHidApiError } from '@hid/http'
import {
  staffApi, type PatientLookup, type StaffEnrollmentCodeSent, type StaffLoginResult, type StaffMfaActivation, type StaffMfaEnrollment,
  type StaffSession,
} from './api'
import { facilityChoiceNeeded, type FacilityChoiceReason } from './facilitySelection'
import {
  announceStaffSessionChange, endsStaffSession, onOtherTabSessionChange, onStaffSessionEnded, onStaffSessionRead, setStaffSessionActor,
  setStaffSessionFacilities, setStaffSessionReady, staffSessionEndReason, staffSessionGeneration, staffSignInPath, startStaffSessionGeneration,
  type StaffSessionEndReason,
} from './session'
import { SignIn, STAFF_MFA_NOTICE } from './routes/SignIn'
import { Dashboard } from './routes/Dashboard'
import { Patients } from './routes/Patients'
import { Registration } from './routes/Registration'
import { InPersonCheck } from './routes/InPersonCheck'
import { PROVIDER_NAVIGATION as navigation, visibleNavigation } from './navigation'
import { AccessRequests } from './routes/AccessRequests'
import { FacilityAudit } from './routes/Audit'
import { Clinical } from './routes/Clinical'
import { Laboratory, Pharmacy, Ocr, Outreach, MigrateGap } from './routes/Operations'
import { Billing, BillingBanner } from './routes/Billing'
import { ReviewBanner } from './routes/ReviewBanner'
import { StaffPage } from './routes/Staff'
import { StaffJoin } from './routes/StaffJoin'
import { captureStaffInvitationFragment } from './invitationCapture'
import { roleLabels } from './staffAccess'
import { usesNovuBackend } from '../backendContract'
import { resolveStaffProductHostname, STAFF_JOIN_PATH } from '../productHostname'
import { revealFocusedLink } from '../navStrip'
import { useDocumentTitle } from '../authSteps'
import { focusPageHeading, useFocusOnPageChange } from '../pageFocus'
import { LIMITS, type LockReason, type OfflineCore, type StaffSessionSnapshot } from '@hid/offline'
import { lockOtherAccount, markSessionReady, setSessionRestoredOnly, offlineActive, offlineRuntime, offlineRuntimeMayFollow, resolveOfflineRuntime, restoredStaffSession, useOfflineActive, useOfflineSummary } from './offline/runtime'
import { resaveGrantCloses } from './offline/ehrCommands'
import { attachOnlineSession, healthIdUnreachable, keepsVaultFacility, offersOfflineSignIn, syncShell } from './offline/session'
import { OfflineSignIn } from './offline/OfflineSignIn'
import { UnlockScreen } from './offline/UnlockScreen'
import { KeepOfflineChoice } from './offline/KeepOfflineChoice'
import { ConnectivityIndicator } from './offline/ConnectivityIndicator'
import { SyncPanel } from './offline/SyncPanel'
import { ReviewDrawer } from './offline/ReviewDrawer'
import { UpdateBanner } from './offline/UpdateBanner'
import { setUnsavedFormsSource } from './offline/shellUpdateAdapter'
import { anyUnsavedForms, trackUnsavedForms } from './offline/unsavedForms'
import { PANEL, SIGN_IN, UNLOCK } from './offline/copy'
import { CaptureRoute } from './offline/OfflineCards'
import './style.css'
import './offline/offline.css'

/** `reason`: why Identity ended the session, when it said (see StaffSessionEndReason). */
type SessionState =
  | { status: 'loading'; session: null }
  | { status: 'error'; session: null; error: string }
  | { status: 'signed-out'; session: null; reason?: StaffSessionEndReason }
  /** The server stopped accepting the session while it was in use (expired, revoked or ended elsewhere). */
  | { status: 'ended'; session: null; reason?: StaffSessionEndReason }
  /**
   * `facilityLost`: a refresh or check found the facility this tab worked at gone
   * from the actor's facilities; the session is the one it read, and the facility
   * must be chosen again before any page opens.
   */
  | { status: 'ready'; session: StaffSession; facilityLost?: boolean; mode?: 'offline' }
  /**
   * Health ID could not be reached to read the session, and this device keeps an offline copy: the offline sign-in
   * is offered (OFFLINE-CONTRACT §2.6). Never reached without an offline runtime.
   */
  | { status: 'offline-sign-in'; session: null }

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
type SessionLock = 'away' | 'checking' | 'unconfirmed' | 'offline' | null

/** A tab back in view after this long asks the server before it shows the workspace again. */
const RECHECK_AFTER_HIDDEN_MS = 60_000

/**
 * The offline side of the session (OFFLINE-CONTRACT §2.6), present only while an offline runtime exists. `lockReason`
 * is why the vault locked while the workspace shows the password unlock (lock 'offline'); `choice` is the one-time
 * "Keep an offline copy" question (amendment A5); `paused` says this tab's vault is closed though offline is in use
 * at this facility (an online reload: writes go straight online until the person unlocks).
 */
interface StaffOffline {
  runtime: OfflineCore
  lockReason: LockReason | 'unconfirmed' | null
  choice: boolean
  paused: boolean
  restore(snapshot: StaffSessionSnapshot): void
  unlocked(): void
  keep(): Promise<void>
  decline(): void
  openUnlock(): void
}

interface StaffContextValue {
  state: SessionState
  lock: SessionLock
  /** Asks the server again whether the session holds, locking the workspace meanwhile. */
  checkSession(): void
  activePatient: ActivePatient | null
  /**
   * The password step. It changes nothing here: since hid-system #71 Identity
   * answers with the second step it asks for, and an Identity before #71 with
   * the session, which the page opens with `completeSignIn`.
   */
  login(email: string, password: string, turnstileToken?: string): Promise<StaffLoginResult>
  /** The second step by authenticator or recovery code; answers with the session for `completeSignIn`. */
  verifyMfa(proof: { code: string } | { recoveryCode: string }): Promise<StaffSession>
  /** A first enrolment's proof: a code emailed to the account's address. Sets no cookie. */
  sendEnrollmentCode(): Promise<StaffEnrollmentCodeSent>
  /** The new authenticator's secret, with the emailed code (none once the proof is verified). Sets no cookie. */
  startEnrollment(emailCode?: string): Promise<StaffMfaEnrollment>
  /**
   * The first code of a new authenticator; answers with the session and its
   * recovery codes. The page shows the codes, then opens the session.
   */
  activateEnrollment(code: string): Promise<StaffMfaActivation>
  /** Opens the workspace with the session a sign-in step answered with. Throws, opening nothing, for a patient's. */
  completeSignIn(session: StaffSession): void
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
  /** Null unless this page has an offline runtime: every screen then behaves as it always has. */
  offline: StaffOffline | null
}

const StaffContext = createContext<StaffContextValue | null>(null)

export function useStaff() {
  const context = useContext(StaffContext)
  if (!context) throw new Error('Staff workspace context is unavailable')
  return context
}

export function StaffProvider({ children }: { children: ReactNode }) {
  const [state, setSessionState] = useState<SessionState>({ status: 'loading', session: null })
  // The state as of the last change, read synchronously by the session-end listener.
  const status = useRef<SessionState['status']>('loading')
  const currentSession = useRef<StaffSession | null>(null)
  const facilityLost = useRef(false)
  // The offline runtime, when the build has one for this host (null otherwise: nothing below changes then).
  const [runtime, setRuntime] = useState(() => offlineRuntime())
  // The runtime as of now, for the session read at load, which must not run again when a runtime is found later.
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  // An `off` build makes the runtime only if this origin already keeps an offline database (kill switch, A11.1):
  // it then sends what is pending after the next sign-in and deletes each vault once empty.
  useEffect(() => {
    if (runtime) return
    let active = true
    void resolveOfflineRuntime().then(found => { if (active && found) setRuntime(found) })
    return () => { active = false }
  }, [runtime])
  // Whether the session in use was restored from this device's vault, with Health ID out of reach.
  const offlineMode = useRef(false)
  // The facility whose vault is open: a session read that no longer lists it ends the membership on this device.
  const vaultFacility = useRef<string | null>(null)
  // Set while a facility switch closes the vault it leaves: that close is not an idle lock to ask a password for.
  const leavingVault = useRef(false)
  const [offlineLockReason, setOfflineLockReason] = useState<LockReason | 'unconfirmed' | null>(null)
  const [offlineChoice, setOfflineChoice] = useState<StaffSessionSnapshot | null>(null)
  const [offlinePaused, setOfflinePaused] = useState(false)
  const [lock, setLockState] = useState<SessionLock>(null)
  // Readiness for protected requests, told to the offline engine too: it sends only while the session is ready, the
  // workspace is not locked (§2.8, "Eligible"), and Health ID confirmed the account. A session opened offline is not
  // confirmed: sending waits for the background read that confirms it (A12.3).
  const markReady = useCallback((ready: boolean) => {
    // A session restored offline is not one Health ID confirmed: no protected request goes out under whatever cookie the
    // browser holds until the background read confirms it (A12.3). Sign-in routes (/api/v1/auth/**) are not gated.
    setStaffSessionReady(ready && !offlineMode.current)
    markSessionReady(offlineRuntime(), ready && !offlineMode.current, currentSession.current?.actor.id)
  }, [])
  const lockRef = useRef<SessionLock>(null)
  // Where focus was when the workspace locked, given back when it opens again.
  const focusBeforeLock = useRef<HTMLElement | null>(null)
  const setLock = useCallback((next: SessionLock) => {
    if (next !== null && lockRef.current === null && document.activeElement instanceof HTMLElement) focusBeforeLock.current = document.activeElement
    lockRef.current = next
    setLockState(next)
    markReady(status.current === 'ready' && next === null)
  }, [markReady])
  // Since when, in which session, and whether into the back/forward cache, the page is away.
  const away = useRef<{ since: number; sentIn: number; cached: boolean } | null>(null)
  // Readiness for protected requests follows the state and the lock at once, not after a render.
  const setState = useCallback((next: SessionState) => {
    status.current = next.status; currentSession.current = next.session
    offlineMode.current = next.status === 'ready' && next.mode === 'offline'
    setSessionRestoredOnly(offlineMode.current)
    facilityLost.current = next.status === 'ready' && next.facilityLost === true
    setSessionState(next)
    setStaffSessionActor(next.status === 'ready' ? next.session.actor.id : null)
    setStaffSessionFacilities(next.status === 'ready' ? next.session.actor.facilities.map(facility => facility.id) : null)
    // A session that becomes ready while the page is hidden (opened in the
    // background, or signed in or restored while away) is away from the start:
    // locked, and judged as it comes back like any other absence.
    if (next.status === 'ready' && document.visibilityState === 'hidden') {
      away.current ??= { since: Date.now(), sentIn: staffSessionGeneration(), cached: false }
      if (lockRef.current === null) setLock('away')
    }
    markReady(next.status === 'ready' && lockRef.current === null)
  }, [setLock, markReady])
  // In the commit that opens the workspace, not an effect a task later: a check made as soon as it opens finds the focus given back.
  useLayoutEffect(() => {
    if (lock !== null) return
    const focused = focusBeforeLock.current
    focusBeforeLock.current = null
    if (focused?.isConnected) focused.focus()
  }, [lock])
  // Leaving the provider portal (for the patient portal, in the same page) leaves no session in use.
  useEffect(() => () => { setStaffSessionActor(null); setStaffSessionFacilities(null); setStaffSessionReady(false) }, [])
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

  // Locks the vault and shows the password unlock over the workspace, which stays mounted (§2.6).
  const lockOffline = useCallback((reason: LockReason | 'unconfirmed') => {
    if (!runtime) return
    runtime.lock(reason === 'unconfirmed' ? 'session' : reason)
    setOfflineLockReason(reason)
    setLock('offline')
  }, [runtime, setLock])
  // A session read that no longer lists the vault's facility: the membership ended (§2.6, D9).
  const checkVaultFacility = useCallback((session: StaffSession) => {
    const rt = runtimeRef.current
    if (!rt || keepsVaultFacility(session, vaultFacility.current)) return
    vaultFacility.current = null
    void rt.wipe('membership').catch(() => undefined)
  }, [])

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
  // What this tab knew of the offline copy for the session that ended: none of it carries over to the next account.
  const forgetOfflineSession = useCallback(() => {
    vaultFacility.current = null
    setOfflineChoice(null); setOfflinePaused(false); setOfflineLockReason(null)
  }, [])
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
        // The vault closes with the session: no other account's work is sent from it (A12.3).
        runtime?.lock('session')
        forgetOfflineSession()
        startStaffSessionGeneration()
        startPeriod()
        away.current = null
        setState({ status: 'ended', session: null, reason: staffSessionEndReason(sentIn) })
        setLock(null)
        announceStaffSessionChange()
      } else if (question.again) ask(sentIn)
      // An answer that arrives while the page is away, or still hidden, opens
      // nothing: the page is judged again as it comes back.
      else if (answer === 'alive') {
        if (document.visibilityState === 'hidden' && !away.current) away.current = { since: Date.now(), sentIn, cached: false }
        setLock(away.current?.sentIn === sentIn ? 'away' : null)
      }
      // Offline, Health ID cannot confirm the session: the password reopens the workspace instead (§2.6).
      else if (offlineActive(runtime) && runtime.summary().connectivity === 'offline') lockOffline('unconfirmed')
      else setLock('unconfirmed')
    })
  }, [setState, setLock, startPeriod, runtime, lockOffline, forgetOfflineSession])
  useEffect(() => onStaffSessionEnded(ask), [ask])

  // A refresh or check of this session that finds the facility this tab works at no
  // longer among the actor's (its membership ended). The tab never moves to the
  // facility the answer reports, which may be another tab's choice; it cannot stay
  // where it is either. Its patient closes and it asks where the person is working,
  // and requests still on their way for the facility that is gone are not sent
  // (setStaffSessionFacilities). This applies before a check's answer opens the
  // workspace, and before a refreshed request is repeated.
  useEffect(() => onStaffSessionRead((read, sentIn) => {
    const current = currentSession.current
    const working = current?.actor.facility?.id
    if (status.current !== 'ready' || sentIn !== staffSessionGeneration() || !current || !working) return
    if (read.actor.id === current.actor.id) checkVaultFacility(read)
    // A tab still asking has no facility of its own to lose: the facility it holds is only
    // the one Identity reported. Its question stays; a facility gone meanwhile is refused
    // when chosen, and the refusal says so.
    if (facilityLost.current || facilityChoiceNeeded(current) !== null) return
    if (read.actor.id !== current.actor.id || read.actor.facilities.some(facility => facility.id === working)) return
    startPeriod()
    // The question replaces the page and takes focus (FacilityChoice): focus held before a check is not given back.
    focusBeforeLock.current = null
    setState({ status: 'ready', session: read, facilityLost: true })
  }), [setState, startPeriod, checkVaultFacility])
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
      // Hidden 5 minutes or more with offline in use: the vault locks, and only the password reopens it (§2.6).
      if (offlineActive(runtime) && Date.now() - left.since >= LIMITS.idleLockMs) { lockOffline('hidden'); return }
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
  }, [ask, setLock, runtime, lockOffline])

  // Idle 5 minutes (no key, pointer, touch or wheel) or hidden 5 minutes with offline in use: the runtime locks the
  // vault in every tab (§2.6), told here of activity and visibility. Whenever its vault locks, the workspace shows the
  // password unlock over the forms it keeps.
  useEffect(() => {
    if (!runtime) return
    const active = () => runtime.noteActivity()
    const visibility = () => runtime.noteVisibility(document.visibilityState === 'hidden')
    const events = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const
    for (const name of events) document.addEventListener(name, active, { passive: true, capture: true })
    document.addEventListener('visibilitychange', visibility)
    let wasOpen = runtime.summary().vault === 'unlocked'
    const stop = runtime.subscribe(() => {
      const open = runtime.summary().vault === 'unlocked'
      if (wasOpen && !open && status.current === 'ready' && lockRef.current !== 'offline' && !leavingVault.current && runtime.policy().enabled) {
        setOfflineLockReason(document.visibilityState === 'hidden' ? 'hidden' : 'idle'); setLock('offline')
      }
      wasOpen = open
    })
    return () => {
      stop()
      for (const name of events) document.removeEventListener(name, active, { capture: true })
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [runtime, setLock])

  // The shell's "Update now" waits while any staff form holds unsaved edits (A7, A9): the update reloads this tab.
  useEffect(() => {
    if (!runtime) return
    const stop = trackUnsavedForms(document)
    const unplug = setUnsavedFormsSource(anyUnsavedForms)
    return () => { stop(); if (typeof unplug === 'function') unplug() }
  }, [runtime])

  // Set once attachOffline exists (below): a session read on load asks the runtime too.
  const attachAfterRead = useRef<((session: StaffSession) => Promise<void>) | null>(null)

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
      // A sign-out made offline reaches Health ID before any session is read (§2.6, A12.2): no session read may open
      // the workspace of the account that signed out. If Health ID cannot be reached, nothing is read and the flag stays.
      const rt = runtimeRef.current ?? (offlineRuntimeMayFollow() ? await resolveOfflineRuntime() : null)
      if (rt && await rt.logoutPending().catch(() => false)) {
        await staffApi.sendPendingSignOut()
        await rt.logoutSent()
        if (!current()) return
        setState({ status: 'signed-out', session: null })
        announceStaffSessionChange()
        return
      }
      if (!current()) return
      let session: StaffSession
      try { session = await staffApi.session() }
      catch (error) {
        // A 401, or a sign-in made without an authenticator (403 STAFF_MFA_REQUIRED), which the refresh ends.
        if (!endsStaffSession(error) || !current()) throw error
        session = await staffApi.refresh()
      }
      if (!current()) return
      if (session.actor.kind === 'patient') throw new Error('This account does not have a staff session.')
      lockOtherAccount(runtimeRef.current, session.actor.id)
      checkVaultFacility(session)
      setState({ status: 'ready', session })
      askIfHeardWhileOpening()
      void attachAfterRead.current?.(session)
    } catch (error) {
      if (!current()) return
      if (endsStaffSession(error)) {
        runtimeRef.current?.lock('session')
        setState({ status: 'signed-out', session: null, reason: staffSessionEndReason(sentIn) })
        return
      }
      // Health ID out of reach, and this device keeps an offline copy: offer it (§2.6, "Offline cold start").
      if (healthIdUnreachable(error) && await offersOfflineSignIn(runtimeRef.current ?? offlineRuntime())) {
        if (current()) setState({ status: 'offline-sign-in', session: null })
        return
      }
      if (!current()) return
      setState({ status: 'error', session: null, error: error instanceof Error ? error.message : 'Session could not be verified.' })
    }
  }, [setState, setLock, startPeriod, askIfHeardWhileOpening, checkVaultFacility])

  // After an online sign-in or facility switch, the runtime opens this account's vault for the facility, or the
  // one-time "Keep an offline copy" question is asked (amendment A5). Without a runtime nothing happens.
  const attachOffline = useCallback(async (session: StaffSession) => {
    if (!runtime) return
    const owner = period.current
    const { result, snapshot } = await attachOnlineSession(runtime, session)
    if (period.current !== owner) return
    if (result === 'attached' && snapshot) vaultFacility.current = snapshot.facilityId
    setOfflineChoice(result === 'choice' ? snapshot : null)
    setOfflinePaused(result === 'paused')
  }, [runtime])
  attachAfterRead.current = attachOffline

  // Back online after working offline: the session is read in the background, keeping the workspace and its forms.
  // A session that cannot be restored locks the vault and asks for an online sign-in (§2.6).
  useEffect(() => {
    if (!runtime) return
    let reading = false
    return runtime.subscribe(() => {
      if (!offlineMode.current || reading || runtime.summary().connectivity === 'offline') return
      reading = true
      const sentIn = staffSessionGeneration()
      const actorId = currentSession.current?.actor.id
      void staffApi.session().then(read => {
        if (sentIn !== staffSessionGeneration() || !offlineMode.current) return
        if (read?.actor?.id !== actorId) throw new Error('another account')
        checkVaultFacility(read)
        // The session is at another facility now (switched in another tab): the restored facility's vault closes before
        // the new facility attaches, so nothing of one facility goes into the other's vault (A12.7).
        const restored = vaultFacility.current
        if (restored !== null && read.actor.facility?.id?.toLowerCase() !== restored.toLowerCase()) {
          leavingVault.current = true
          runtime.lock('manual')
          vaultFacility.current = null
          setState({ status: 'ready', session: read })
          void attachOffline(read).finally(() => { leavingVault.current = false })
          return
        }
        setState({ status: 'ready', session: read })
      }).catch((error: unknown) => {
        if (sentIn !== staffSessionGeneration() || !offlineMode.current) return
        if (healthIdUnreachable(error)) return
        runtime.lock('session')
        startStaffSessionGeneration(); startPeriod(); away.current = null
        setState({ status: 'signed-out', session: null })
        setLock(null)
      }).finally(() => { reading = false })
    })
  }, [runtime, setState, setLock, startPeriod, checkVaultFacility, attachOffline])

  // A close of access left in review because a change it waited for was discarded is saved again (A12.6).
  useEffect(() => {
    if (!runtime) return
    let running = false
    let again = false
    const look = () => {
      if (running) { again = true; return }
      if (runtime.summary().attention === 0 || runtime.summary().vault !== 'unlocked') return
      running = true
      // A change heard during a run is looked at once the run ends.
      void resaveGrantCloses(runtime).catch(() => 0).finally(() => { running = false; if (again) { again = false; look() } })
    }
    return runtime.subscribe(look)
  }, [runtime])

  useEffect(() => { void refresh() }, [refresh])

  // Each step that can set the session cookies forgets what other tabs announced before it was sent:
  // the cookies it sets come after that. A change heard from here on is asked about once the session opens.
  async function login(email: string, password: string, turnstileToken?: string) {
    heardWhileOpening.current = false
    // A sign-out noted offline ends the session it was made in before another sign-in replaces the cookies (A12.2):
    // otherwise the next load would send it and end the new session instead.
    const rt = runtimeRef.current ?? (offlineRuntimeMayFollow() ? await resolveOfflineRuntime() : null)
    if (rt && await rt.logoutPending().catch(() => false)) {
      await staffApi.sendPendingSignOut()
      await rt.logoutSent()
    }
    return staffApi.login(email, password, turnstileToken)
  }

  async function verifyMfa(proof: { code: string } | { recoveryCode: string }) {
    heardWhileOpening.current = false
    return staffApi.verifyMfa(proof)
  }

  async function activateEnrollment(code: string) {
    heardWhileOpening.current = false
    const activated = await staffApi.activateEnrollment(code)
    // The browser holds the new session while its recovery codes are shown: the other tabs are told now.
    announceStaffSessionChange()
    return activated
  }

  function completeSignIn(session: StaffSession) {
    if (session.actor.kind === 'patient') throw new Error('A staff account is required for this portal.')
    // Another account signed in on this tab: the vault left open is locked first (A12.3).
    lockOtherAccount(runtime, session.actor.id)
    forgetOfflineSession()
    startStaffSessionGeneration()
    startPeriod()
    away.current = null
    setLock(null)
    setState({ status: 'ready', session })
    announceStaffSessionChange()
    askIfHeardWhileOpening()
    void attachOffline(session)
  }

  async function selectFacility(id: string) {
    const owner = period.current
    const session = await staffApi.selectFacility(id)
    // A switch answered after its session ended, or after another change, applies to nothing now.
    if (period.current !== owner || status.current !== 'ready') return false
    startPeriod()
    // Identity accepted this tab's own choice: an answer for the facility sent is that choice, whatever
    // selection it reports. Asking again straight away would leave the person no way on.
    const chosen: StaffSession = session.actor.facility?.id === id ? { ...session, facilitySelection: 'selected' } : session
    // The vault of the facility left is closed and its keys dropped before the new facility attaches (A12.7): an
    // unlock afterwards opens only the new facility's own vault. Nothing about the old one carries over.
    if (runtime) {
      leavingVault.current = true
      runtime.lock('manual')
      vaultFacility.current = null
      setOfflineChoice(null); setOfflinePaused(false); setOfflineLockReason(null)
    }
    setState({ status: 'ready', session: chosen })
    void attachOffline(chosen).finally(() => { leavingVault.current = false })
    return true
  }

  async function signOut() {
    // No next session can start meanwhile: signing in waits for a sign-out in progress.
    // So a sign-out answered while the session-ended screen shows also completes, as asked.
    // From a workspace locked for a check, the server is asked first whose session the browser holds.
    // Offline, the sign-out is noted on the device and sent first on the next online load (§2.6, "Wipe triggers").
    if (runtime && offlineMode.current) await runtime.signOut({ online: false })
    else {
      // A logout that cannot reach Health ID, on a device keeping an offline copy, signs out offline instead of
      // failing (A12.2): the copy closes now, and the logout is sent first on the next online load.
      let reached = true
      const confirmFirst = lockRef.current === 'checking' || lockRef.current === 'unconfirmed'
      try { await staffApi.logout(confirmFirst) }
      catch (error) {
        // From a locked workspace the server is asked first whose session it is; that question unanswered is said as a
        // plain error, so Health ID is asked once more whether it can be reached at all.
        const unreachable = healthIdUnreachable(error) || (confirmFirst && await staffApi.session().then(() => false, healthIdUnreachable))
        if (!(runtime && unreachable && await runtime.hasVaults().catch(() => false))) throw error
        reached = false
      }
      if (runtime) {
        if (reached) await runtime.signOut({ online: true }).catch(() => undefined)
        else await runtime.signOut({ online: false })
      }
    }
    vaultFacility.current = null
    setOfflineChoice(null); setOfflineLockReason(null); setOfflinePaused(false)
    startStaffSessionGeneration()
    startPeriod()
    away.current = null
    setState({ status: 'signed-out', session: null })
    setLock(null)
    announceStaffSessionChange()
  }

  const checkSession = useCallback(() => ask(staffSessionGeneration()), [ask])
  const summary = useOfflineSummary(runtime)
  const offline = useMemo<StaffOffline | null>(() => !runtime ? null : {
    runtime,
    lockReason: offlineLockReason,
    choice: offlineChoice !== null,
    // A vault closed on this tab at a facility that works offline: an online reload, with no password typed yet.
    paused: offlinePaused && summary?.vault !== 'unlocked',
    restore(snapshot) {
      const session = restoredStaffSession(snapshot)
      if (!session) return
      startStaffSessionGeneration()
      startPeriod()
      away.current = null
      vaultFacility.current = snapshot.facilityId
      setLock(null)
      setState({ status: 'ready', session, mode: 'offline' })
    },
    unlocked() { setOfflineLockReason(null); setOfflinePaused(false); setLock(null) },
    async keep() {
      const snapshot = offlineChoice
      if (!snapshot) return
      await runtime.attachSession(snapshot, { optIn: true, online: true })
      if (!offlineActive(runtime)) throw new Error('not kept')
      syncShell(runtime)
      vaultFacility.current = snapshot.facilityId
      setOfflineChoice(null)
    },
    // Declined: nothing is written, and the key derived at sign-in is dropped.
    decline() {
      const snapshot = offlineChoice
      setOfflineChoice(null)
      if (snapshot) void runtime.attachSession(snapshot, { optIn: false, online: true }).catch(() => undefined)
    },
    openUnlock() { setOfflineLockReason('manual'); setLock('offline') },
  }, [runtime, offlineLockReason, offlineChoice, offlinePaused, summary, startPeriod, setLock, setState])
  const value = useMemo<StaffContextValue>(() => ({ state, lock, checkSession, activePatient, login, verifyMfa,
    sendEnrollmentCode: staffApi.sendEnrollmentCode, startEnrollment: staffApi.startEnrollment, activateEnrollment,
    completeSignIn, refresh, selectFacility, signOut, setActivePatient, offline }), [state, lock, checkSession, activePatient, refresh, setActivePatient, offline])
  return <StaffContext.Provider value={value}>{children}</StaffContext.Provider>
}

/**
 * Shown in place of the whole workspace once the server stops accepting the
 * session. The workspace and every page under it are gone, with whatever
 * patient information they held. The wording is fixed: it carries no server
 * detail. The backend gives staff clients no reason to name, except for a
 * sign-in made without an authenticator, which is said. It is announced once,
 * as focus moves to its heading; it is not also a live region.
 */
function SessionEnded({ reason }: { reason?: StaffSessionEndReason }) {
  const location = useLocation()
  const signIn = staffSignInPath(location.pathname)
  const href = useHref(signIn)
  const follow = useLinkClickHandler(signIn)
  const heading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => { heading.current?.focus() }, [])
  return <main className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="staff-session-ended-title">
      <h1 id="staff-session-ended-title" ref={heading} tabIndex={-1}>Your session has ended</h1>
      <p>For your security, the provider workspace was closed and the patient information it showed was cleared. {reason === 'mfa-required' ? STAFF_MFA_NOTICE : 'Sign in again to continue.'}</p>
      <ButtonLink href={href} onClick={follow}>Sign in again</ButtonLink>
    </section>
  </main>
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
  useLayoutEffect(() => { heading.current?.focus() }, [unconfirmed])

  async function leave() {
    if (signingOut) return
    setError('')
    setSigningOut(true)
    try { await signOut() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Sign-out could not be completed.') }
    finally { setSigningOut(false) }
  }

  return <main className="staff-centered"><BrandLogo className="staff-state-logo" />
    <section className="staff-session-ended" aria-labelledby="staff-session-check-title">
      <h1 id="staff-session-check-title" ref={heading} tabIndex={-1}>{unconfirmed ? 'We could not confirm your session' : 'Checking your session…'}</h1>
      <p>{unconfirmed
        ? 'For your security, the provider workspace stays hidden until Health ID confirms your session. Try again, or sign out.'
        : 'For your security, the provider workspace is hidden while Health ID confirms your session.'}</p>
      {unconfirmed && <Button onClick={checkSession}>Try again</Button>}
      <Button tone="quiet" onClick={() => void leave()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
      {error && <p role="alert" className="staff-error">{error}</p>}
    </section>
  </main>
}

function Gate({ children }: { children: ReactNode }) {
  const { state, lock, refresh, offline, signOut } = useStaff()
  const { pathname } = useLocation()
  if (state.status === 'ended') return <SessionEnded reason={state.reason} />
  if (state.status === 'offline-sign-in') {
    return offline ? <OfflineSignIn runtime={offline.runtime} onRestored={offline.restore} onRetry={() => void refresh()} /> : null
  }
  // Each state screen is the page: a main landmark, and an h1 where it has a title.
  if (state.status === 'loading') return <main className="staff-centered"><BrandLogo className="staff-state-logo" /><div role="status"><h1>Checking your secure session…</h1></div></main>
  if (state.status === 'error') return <main className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState titleAs="h1" title="Session unavailable" description={state.error} action={<Button onClick={() => void refresh()}>Try again</Button>} /></main>
  if (state.status === 'signed-out') {
    // Signed out on the join page (an invitation's link, Novu, P4b), the sign-in comes back to it; the link itself
    // waits in this page's memory (invitationCapture.ts), never in the return address.
    const joining = usesNovuBackend() && pathname.replace(/\/+$/, '').toLowerCase() === STAFF_JOIN_PATH
    const productRoute = joining ? STAFF_JOIN_PATH : resolveStaffProductHostname(window.location.hostname)?.route
    const signInPath = productRoute ? `/provider/sign-in?returnTo=${encodeURIComponent(productRoute)}` : '/provider/sign-in'
    return <Navigate to={signInPath} replace />
  }
  if (state.session.actor.facilities.length === 0) return <main className="staff-centered"><BrandLogo className="staff-state-logo" /><EmptyState titleAs="h1" title="No facility assignment" description="Your account has no active facility membership. Ask your organization administrator for access." /></main>
  // Locked, the workspace is hidden and inert but stays mounted: nothing reloads,
  // and a session the server still accepts gets it back as it was.
  // Locked for offline use, the password reopens it; the forms beneath keep what was typed.
  const unlock = lock === 'offline' && offline
    ? <UnlockScreen runtime={offline.runtime} reason={offline.lockReason ?? 'idle'} onUnlocked={offline.unlocked}
      onSignOut={signOut} onCancel={offline.lockReason === 'manual' ? offline.unlocked : undefined} />
    : null
  return <>{unlock ?? (lock && <SessionCheck unconfirmed={lock === 'unconfirmed'} />)}<div hidden={lock !== null} inert={lock !== null}>{children}</div></>
}

/**
 * A choice or switch of facility that Identity refused, in words the person can act
 * on. Its own detail for 403 FACILITY_ACCESS_DENIED speaks of "the actor"; the
 * facility is no longer one of theirs (the membership ended since the list was read).
 */
function facilityRefusal(caught: unknown, facility: string): string {
  if (isHidApiError(caught) && caught.code === 'FACILITY_ACCESS_DENIED') return `You are no longer active at ${facility}. Choose another facility.`
  return caught instanceof Error ? caught.message : 'Facility could not be selected.'
}

/** Why the facility question is asked: as Identity reports the selection, or 'lost' (see SessionState). */
type FacilityQuestion = FacilityChoiceReason | 'lost'

/** Why the question is asked, as the page says it. */
const FACILITY_CHOICE_WHY: Record<FacilityQuestion, string> = {
  reselect: 'The facility you chose for this sign-in is no longer available to you.',
  unchosen: 'You work at more than one facility.',
  unconfirmed: 'The facility for this sign-in is not confirmed.',
  // The page and any patient record close with the facility, and a save waiting to go is cancelled
  // (setStaffSessionFacilities): said, so no one believes it was kept.
  lost: 'The facility you were working at is no longer available to you. The page you had open was closed, along with any patient record, and anything not yet saved there was not sent.',
}

/**
 * Asks where the person is working before any page opens, so that no facility is
 * used that they did not choose (hid-system ADR-046): when the facility chosen for
 * this sign-in is no longer available ('reselect'), when none was chosen and
 * they work at more than one ('unchosen'), or when Identity reports a selection
 * this portal does not know ('unconfirmed'); and when the facility this tab was
 * working at is found gone mid-session ('lost'). Nothing is preselected. Choosing sends
 * the same POST /auth/facility as a switch, and Identity keeps it for the sign-in,
 * so a reload or a refresh reports it ('selected').
 */
function FacilityChoice({ reason, onChosen }: { reason: FacilityQuestion; onChosen: () => void }) {
  const { state, lock, selectFacility } = useStaff()
  const [picked, setPicked] = useState('')
  // Continue with nothing picked is reported at the options, which take focus, and their description
  // announces it. Sent with Enter on an option, focus does not move into them, so the message is an alert
  // instead, new for each refusal; as both it would be spoken twice. `missing` counts the refusals.
  const [missing, setMissing] = useState(0)
  const [missingAlert, setMissingAlert] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  // The question is the page: it takes focus when it appears, unless the person is already somewhere on it.
  // One that appears while the workspace is locked (hidden at load, or a sign-in being checked) takes it
  // once the workspace opens, once. Asked because the facility was found gone, it takes focus wherever
  // it was (Sign out, say): the page and patient closed under the person, and its heading says so.
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (focused.current || lock !== null) return
    focused.current = true
    const active = document.activeElement
    if (reason === 'lost' || !(active instanceof HTMLElement) || active === document.body || !active.isConnected) heading.current?.focus()
  }, [lock, reason])
  if (state.status !== 'ready') return null
  const { facilities } = state.session.actor

  async function choose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!picked) {
      const options = event.currentTarget.querySelector('fieldset')
      setMissingAlert(options?.contains(document.activeElement) ?? false)
      setMissing(count => count + 1)
      options?.querySelector<HTMLInputElement>('input[name="staff-facility-choice"]')?.focus()
      return
    }
    // The options are disabled while the choice is saved, so the one checked is the one
    // sent. A choice sent with Enter on an option moves focus to Continue, which stays
    // enabled, rather than leave it on a disabled option and so on the page.
    const form = event.currentTarget
    if (document.activeElement instanceof HTMLInputElement && form.contains(document.activeElement)) {
      form.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus()
    }
    const name = facilities.find(facility => facility.id === picked)?.name ?? 'this facility'
    setBusy(true)
    try { if (await selectFacility(picked)) onChosen() }
    catch (caught) { setError(facilityRefusal(caught, name)) }
    finally { setBusy(false) }
  }

  return <section className="staff-facility-choice" aria-labelledby="staff-facility-choice-title">
    <div className="staff-page-head">
      <h1 id="staff-facility-choice-title" ref={heading} tabIndex={-1} aria-describedby="staff-facility-choice-why">Where are you working?</h1>
      <p id="staff-facility-choice-why">{FACILITY_CHOICE_WHY[reason]} Choose where you are working before you continue. Patient access, records and requests use the facility you choose, and you can switch later from “Working at”.</p>
    </div>
    <Card className="staff-card"><form className="staff-form" noValidate onSubmit={event => void choose(event)}>
      <fieldset disabled={busy} aria-describedby={['staff-facility-choice-why', missing > 0 && 'staff-facility-choice-missing', error && 'staff-facility-choice-error'].filter(Boolean).join(' ')}>
        <legend>Facility</legend>
        {facilities.map(facility => <label key={facility.id} className="staff-choice">
          <input type="radio" name="staff-facility-choice" value={facility.id} checked={picked === facility.id}
            onChange={() => { setPicked(facility.id); setMissing(0); setError('') }} /> {facility.name}
        </label>)}
      </fieldset>
      {missing > 0 && <p key={missing} id="staff-facility-choice-missing" role={missingAlert ? 'alert' : undefined} className="staff-error">Choose a facility to continue.</p>}
      {error && <p id="staff-facility-choice-error" role="alert" className="staff-error">{error}</p>}
      {/* Kept enabled while it runs, so focus stays on it; a second press does nothing. */}
      <Button type="submit" aria-disabled={busy || undefined}>{busy ? 'Saving…' : 'Continue'}</Button>
    </form></Card>
  </section>
}

// The pages the browser tab can name, by path. A title never carries a patient's
// name or Health ID: it ends up in browser history, tab previews and shared screens.
const PAGE_TITLES: Readonly<Record<string, string>> = Object.fromEntries([
  ...navigation.map(item => [item.to, item.label]),
  ['/provider/migrate', 'Migration workspace'],
  ['/provider/capture', 'Capture documents'],
  [STAFF_JOIN_PATH, 'Join a facility'],
])
/** Pages only Novu serves (P4b): on main their paths are not routed, so the tab says so. */
const NOVU_ONLY_PAGES: ReadonlySet<string> = new Set(['/provider/staff', STAFF_JOIN_PATH])

/**
 * Names the browser tab after the provider page shown (PEHR-05): index.html
 * names it for patients only. A gate screen shown in place of the page names
 * itself instead. Rendered inside the provider, whose session state it reads.
 */
function ProviderTitle() {
  const { state, lock } = useStaff()
  // The router matches a path in any case: /provider/Clinical shows the clinical record.
  const path = useLocation().pathname.replace(/\/+$/, '').toLowerCase()
  const page = path === '/provider/sign-in' ? 'Sign in'
    : state.status === 'ended' ? 'Session ended'
      : state.status === 'offline-sign-in' ? 'Offline sign in'
      : lock === 'offline' ? 'Locked'
      : state.status === 'loading' || lock === 'checking' ? 'Checking your session'
        : state.status === 'error' ? 'Session unavailable'
          : lock === 'unconfirmed' ? 'Session not confirmed'
            : state.status === 'ready' && state.session.actor.facilities.length === 0 ? 'No facility assignment'
              // The question holds the page back (Shell shows it in the page's place), so it names the tab.
              : state.status === 'ready' && (state.facilityLost || facilityChoiceNeeded(state.session)) ? 'Where are you working?'
                : (!usesNovuBackend() && NOVU_ONLY_PAGES.has(path) ? undefined : PAGE_TITLES[path]) ?? 'Page not found'
  useDocumentTitle(`${page} · Health ID Provider`)
  return null
}

/** Offline status and sync in the top bar, shown only while offline is in use at this facility (or paused on this tab). */
function OfflineTopbar({ runtime, open, onToggle }: { runtime: OfflineCore; open: boolean; onToggle: () => void }) {
  return <div className="offline-topbar">
    <ConnectivityIndicator runtime={runtime} />
    <Button tone="quiet" size="sm" aria-expanded={open} aria-controls="offline-panel" onClick={onToggle}>{PANEL.title}</Button>
  </div>
}

function Shell() {
  const { state, selectFacility, signOut, activePatient, lock, offline } = useStaff()
  const offlineInUse = useOfflineActive(offline?.runtime ?? null)
  const showOffline = offline !== null && (offlineInUse || offline.paused)
  const [panelOpen, setPanelOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
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
  useLayoutEffect(() => {
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
  const choiceNeeded = state.status !== 'ready' ? null : state.facilityLost ? 'lost' : facilityChoiceNeeded(state.session)
  // The sidebar goes while the facility is chosen, and with it the proposal and refusal of a switch made
  // before: they were about a facility left behind, and are not shown, or announced, again when it is back.
  useEffect(() => {
    if (!choiceNeeded) return
    setChoice(null)
    setFacilityError('')
  }, [choiceNeeded])
  if (state.status !== 'ready') return null
  const { actor } = state.session
  const currentFacility = actor.facility
  const visible = visibleNavigation(currentFacility)
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
    catch (error) { setFacilityError(facilityRefusal(error, chosen.name)) }
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
      {/* While the facility is being chosen the brand is not a link: no page opens before the choice. */}
      {choiceNeeded
        ? <span className="staff-brand"><BrandLogo /><small>Provider</small></span>
        : <NavLink to="/provider" className="staff-brand" aria-label="Health ID provider home"><BrandLogo /><small>Provider</small></NavLink>}
      <div className="staff-topbar-actions">
        {showOffline && offline && <OfflineTopbar runtime={offline.runtime} open={panelOpen} onToggle={() => setPanelOpen(value => !value)} />}
        <span className="staff-user">{actor.displayName ?? actor.email ?? 'Staff member'}</span>
        <Button tone="quiet" size="sm" onClick={() => void leave()} disabled={signingOut}>{signingOut ? 'Signing out…' : 'Sign out'}</Button>
      </div>
    </header>
    {/* While the facility is being chosen there is no sidebar: its list, links and role badge would all
        come from the facility Identity reported, which no one chose. Sign out stays in the header. */}
    <div className={choiceNeeded ? 'staff-layout staff-layout-single' : 'staff-layout'}>
      {!choiceNeeded && <aside className="staff-sidebar" aria-label="Provider navigation">
        <div className="staff-facility">
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
        </div>
        <nav className="staff-nav" onFocus={revealFocusedLink}>{visible.map(item => <NavLink key={item.to} to={item.to} end={item.to === '/provider'} className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}>{item.label}{item.to === '/provider/clinical' && !activePatient && <span className="staff-nav-meta">Select patient</span>}</NavLink>)}</nav>
        <div className="staff-sidebar-footer"><Badge tone="information">{(usesNovuBackend() ? roleLabels(actor.roles) : actor.roles.join(', ')) || 'Staff'}</Badge><p>Access is limited to your active facility and server permissions.</p></div>
      </aside>}
      {/* Hidden itself while the workspace is locked: only the session check's main is exposed then. */}
      <main ref={main} className="staff-main" hidden={lock !== null}>{signOutError && <p role="alert" className="staff-error">{signOutError}</p>}
        {offline && <OfflineNotices offline={offline} mode={state.mode} showPanel={showOffline && panelOpen} onClosePanel={() => setPanelOpen(false)}
          onReview={() => setReviewOpen(true)} />}
        {offline && reviewOpen && <ReviewDrawer runtime={offline.runtime} onClose={() => setReviewOpen(false)} />}
        {/* Asked again for another reason (an answer to the choice that reports another facility), it starts afresh. */}
        {choiceNeeded ? <FacilityChoice key={choiceNeeded} reason={choiceNeeded} onChosen={() => setFocusHeading(true)} /> : <><ReviewBanner /><BillingBanner /><Outlet /></>}</main>
    </div>
  </div>
}

/** What the workspace says about offline above the page: nothing unless offline is in use or offered here. */
function OfflineNotices({ offline, mode, showPanel, onClosePanel, onReview }: {
  offline: StaffOffline; mode?: 'offline'; showPanel: boolean; onClosePanel: () => void; onReview: () => void
}) {
  return <>
    {offline.choice && <KeepOfflineChoice onKeep={offline.keep} onDecline={offline.decline} />}
    {mode === 'offline' && <p className="staff-notice" role="status">{SIGN_IN.offlineMode}</p>}
    {offline.paused && <div className="staff-notice offline-update" role="status"><span>{UNLOCK.pausedBanner}</span>
      <Button size="sm" tone="secondary" onClick={offline.openUnlock}>{UNLOCK.pausedAction}</Button></div>}
    {showPanel && <div id="offline-panel"><SyncPanel runtime={offline.runtime} onReview={onReview} onClose={onClosePanel} /></div>}
    <UpdateBanner />
  </>
}

export function App() {
  // An invitation link (Novu, P4b) leaves the address on the first render, before the sign-in gate decides anything.
  useState(() => usesNovuBackend() && captureStaffInvitationFragment())
  const novu = usesNovuBackend()
  return <StaffProvider><ProviderTitle /><Routes>
    <Route path="sign-in" element={<SignIn />} />
    <Route element={<Gate><Shell /></Gate>}>
      <Route index element={<Dashboard />} />
      <Route path="patients" element={<Patients />} />
      <Route path="registration" element={<Registration />} />
      <Route path="in-person-check" element={<InPersonCheck />} />
      <Route path="requests" element={<AccessRequests />} />
      <Route path="audit" element={<FacilityAudit />} />
      <Route path="clinical" element={<Clinical />} />
      <Route path="laboratory" element={<Laboratory />} />
      <Route path="pharmacy" element={<Pharmacy />} />
      <Route path="ocr" element={<Ocr />} />
      <Route path="outreach" element={<Outreach />} />
      <Route path="migrate" element={<MigrateGap />} />
      <Route path="billing" element={<Billing />} />
      {/* Migrate capture (D7): shown only while offline is in use at this facility; otherwise "Page not found". */}
      <Route path="capture" element={<CaptureRoute />} />
      {/* A self-signed-up facility's staff, and joining a facility signed in (Novu, P4b). */}
      {novu && <Route path="staff" element={<StaffPage />} />}
      {novu && <Route path="staff/join" element={<StaffJoin />} />}
      <Route path="*" element={<EmptyState titleAs="h1" title="Page not found" description="This provider page is unavailable." action={<NavLink className="staff-text-link" to="/provider">Go to provider overview →</NavLink>} />} />
    </Route>
  </Routes></StaffProvider>
}
