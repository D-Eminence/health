import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient, HidApiError, isHidApiError, NO_RETRY, type ApiClient, type RequestSpec } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createLogger } from '@hid/observability'
import { createSessionStore, type AuthPrincipal, type SessionState } from '@hid/auth'
import { createPatientApi, type PatientApi, type PatientSession } from './api'
import { getEnvironment } from './env'
import { announceSessionChange, heldByOtherPortal, onOtherTabSessionChange, patientSessionRequired } from './sessionChange'
import { createPatientResourceCache, PatientResourcesContext } from './resourceCache'
import { leaveAfterSignOut, noteSessionEndedHere } from './sso/singleSignOn'

interface SessionContextValue {
  readonly state: SessionState
  readonly api: PatientApi
  readonly sessionError: string | null
  /**
   * The browser's shared cookies hold a provider's sign-in, not a patient's. This
   * portal is then signed out, which is not an error: sign-in says so.
   */
  readonly otherPortalSession: boolean
  /**
   * This tab's patient session ended because the browser's sign-in changed in
   * another tab: a sign-out another tab announced, or another account's sign-in.
   * Sign-in says so. A sign-in that ended on its own (expired, revoked) is not this.
   */
  readonly signedOutElsewhere: boolean
  readonly retrySessionCheck: () => void
  readonly signIn: (email: string, password: string, turnstileToken: string) => Promise<void>
  readonly acceptGoogleSession: (session: PatientSession) => void
  /**
   * Takes up the session an activation made (POST .../activate answered `signedIn: true`, hid-system, owner decision
   * 2026-10-28) as sign-in takes up its own. That answer names no actor, so the session is read first. Resolves
   * whether it is a patient's; the other tabs are told either way, since the cookies changed.
   */
  readonly takeUpActivatedSession: () => Promise<boolean>
  readonly refresh: () => Promise<void>
  readonly signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

/**
 * Whether the session the browser holds belongs to the provider portal, which
 * shares this origin and its cookies: hid-system's staff actor carries no kind
 * (and the platform's names its own), where a patient's names `patient`.
 */
function heldForAnotherPortal(session: PatientSession): boolean {
  const actor = session?.actor
  return typeof actor === 'object' && actor !== null && actor.kind !== 'patient'
}

/** Whether `session` is the patient session of `subject`. */
function isPatientSessionOf(session: PatientSession | null | undefined, subject: string): boolean {
  return session?.actor?.kind === 'patient' && session.actor.subject === subject
}

/** How long sign-out waits for this device's notifications to be turned off (contract b6-contract.md §11.6). */
const PUSH_OFF_LIMIT_MS = 2_000

/**
 * Signing out turns notifications off on this device (contract D5, §11.6): when the browser holds a push subscription,
 * Identity is told to remove it, and the browser unsubscribes. Best effort, at most PUSH_OFF_LIMIT_MS, and never a
 * reason for the sign-out to fail or wait longer: the server never pushes to a sign-in that has ended, and erases its
 * subscription in its next sweep. With no subscription (any backend before push, any browser that never turned it on)
 * nothing is sent.
 */
async function turnOffDevicePush(api: PatientApi): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<void>(done => { timer = setTimeout(done, PUSH_OFF_LIMIT_MS) })
  const work = (async () => {
    const device = await import('./pushDevice')
    const current = await device.browserSubscription()
    if (!current) return
    try {
      await api.removeWebPushSubscription(current.endpoint, {
        signal: AbortSignal.timeout(PUSH_OFF_LIMIT_MS), timeoutMs: PUSH_OFF_LIMIT_MS, retry: NO_RETRY,
        // Its 401 neither signs the tab out nor starts a refresh: the sign-out deals with the session itself.
        reportUnauthorized: false, refreshOnUnauthorized: () => false,
      })
    } catch { /* Identity stops on its own once the sign-in ends */ }
    await device.turnOffBrowser()
  })().catch(() => { /* never fails the sign-out */ })
  try { await Promise.race([work, limit]) } finally { clearTimeout(timer) }
}

/** A tab back in view after this long asks whose session the browser holds. */
const RECHECK_AFTER_HIDDEN_MS = 60_000

const sessionEnded = (cause?: unknown) =>
  new HidApiError(401, 'Your session has ended. Sign in again.', { code: 'AUTHENTICATION_REQUIRED', retryable: false, cause })

/** The backend is authoritative: only a verified patient actor opens this app. */
function patientPrincipal(session: PatientSession): AuthPrincipal {
  const actor = session?.actor
  if (actor?.kind !== 'patient' || !actor.subject || !actor.patientId || !actor.accountId) {
    throw new Error('This session does not belong to a patient account.')
  }
  return { kind: 'patient', subjectId: actor.subject, appRole: 'patient', assuranceLevel: 'aal1' }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const environment = getEnvironment()
  const storeRef = useRef(createSessionStore())
  const store = storeRef.current
  const [state, setState] = useState<SessionState>(store.getState())
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [otherPortalSession, setOtherPortalSession] = useState(false)
  const [signedOutElsewhere, setSignedOutElsewhere] = useState(false)
  const [checkKey, setCheckKey] = useState(0)
  const otherPortal = useRef(false)
  useEffect(() => { otherPortal.current = otherPortalSession }, [otherPortalSession])
  // Asks the server whose session the browser holds (the check below), settling once it is answered.
  const recheckSession = useRef<() => Promise<void>>(async () => undefined)

  useEffect(() => store.subscribe(setState), [store])
  // With single sign-on on app., a patient's session this page showed that ends, whichever way (a sign-out in another
  // tab or on another site, an expiry, a revocation; this page's own sign-out notes its own first), makes the next
  // hand-off from this page ask for a new sign-in (sso/singleSignOn.ts noteSessionEndedHere). Noted as the store
  // changes, before the page renders the hand-off. Off, it does nothing.
  useEffect(() => {
    let shown = store.getState().status === 'authenticated'
    return store.subscribe(next => {
      if (shown && next.status !== 'authenticated') noteSessionEndedHere()
      shown = next.status === 'authenticated'
    })
  }, [store])

  // The pages' last answers (resourceCache.ts), one account's at a time: a sign-out, a session ended elsewhere, or
  // another account's sign-in drops them before any page reads again. Pages rendered meanwhile find none, since a
  // read names its account.
  const resources = useRef(createPatientResourceCache()).current
  const account = state.status === 'authenticated' ? state.principal.subjectId : null
  useLayoutEffect(() => { resources.holdFor(account) }, [resources, account])
  const cached = useMemo(() => ({ cache: resources, account }), [resources, account])

  const api = useMemo(() => {
    let patientApi: PatientApi | null = null
    const client = createRegisteredBrowserClient(createApiClient({
      baseUrl: environment.apiBaseUrl,
      clientId: 'patient-web',
      sessionMode: 'cookie',
      logger: createLogger({ minLevel: environment.name === 'local' ? 'warn' : 'error',
        baseContext: { app: 'patient-web', environment: environment.name } }),
      // Protected requests try a refresh before the final 401 clears the session. A
      // question about the session and a refresh judge their own 401 (api.ts), so
      // the session read that finds the access token expired, before the refresh
      // that restores it, does not end it.
      onUnauthorized: () => { if (store.getState().status === 'authenticated') store.clear() },
      refreshSession: async () => {
        // The patient this tab shows. A refresh answers for whichever sign-in the
        // browser holds now, another patient's from another tab included.
        const shown = store.getState().principal?.subjectId
        let restored: PatientSession | undefined
        try {
          restored = await patientApi?.refresh()
        } catch (error) {
          // With no refresh cookie left (expired, or cleared by a sign-out in
          // another tab) the backend refuses the refresh with 403
          // CSRF_VALIDATION_FAILED; with a provider's sign-in in the cookies, with
          // 403 SESSION_CLIENT_MISMATCH, rotating nothing. Either way this
          // patient's session has ended here, as for a 401, so the patient returns
          // to sign-in instead of seeing that refusal on the page. A provider's
          // sign-in is another account's, and sign-in says so, as when a return
          // to view finds it; a tab that showed no patient blames no one.
          if (heldByOtherPortal(error) && shown !== undefined) setSignedOutElsewhere(true)
          if (isHidApiError(error) && error.status === 403) throw sessionEnded(error)
          throw error
        }
        // Restored only if it is this patient's: otherwise the request is not
        // repeated as another account, and this tab's session has ended. Enrollment
        // calls reach here with no patient shown, and are not bound to one.
        if (shown !== undefined && !isPatientSessionOf(restored, shown)) {
          setSignedOutElsewhere(true)
          store.clear()
          throw sessionEnded()
        }
      },
    }), 'patient-web')
    // A patient route refused because the session the browser sent is not a patient's
    // (403 PATIENT_SESSION_REQUIRED): the shared cookies may hold a provider's sign-in
    // now. The server is asked whose session it is before the refusal reaches the page,
    // so a page whose patient has left the browser goes to sign-in instead of showing it.
    const checked: ApiClient = {
      ...client,
      async request<T>(spec: RequestSpec): Promise<T> {
        try { return await client.request<T>(spec) }
        catch (error) {
          if (patientSessionRequired(error)) await recheckSession.current()
          throw error
        }
      },
      get: (path, spec) => checked.request({ ...spec, method: 'GET', path }),
      post: (path, body, spec) => checked.request({ ...spec, method: 'POST', path, body }),
    }
    patientApi = createPatientApi(checked)
    return patientApi
  }, [environment, store])

  useEffect(() => {
    let active = true
    // A provider's sign-in: no patient is signed in here, and asking again would only find it again.
    const providerSignedIn = () => {
      store.setAnonymous()
      setSessionError(null)
      setOtherPortalSession(true)
    }
    void (async () => {
      // Whether the refresh below refused to restore a session, which ends it as its 401 does.
      let refused = false
      try {
        let session: PatientSession
        try { session = await api.session() }
        catch (error) {
          // The access cookie lasts its 15-minute token, the refresh cookie the patient's sign-in (7 days idle, 30 at
          // most: hid-system, owner decision 2026-10-28). A page opened after a longer idle finds no access cookie,
          // and the client never refreshes an auth/ request itself, so the session is restored once before it is
          // judged, as a tab in use restores it (ask, below). The refresh takes its turn, and one that waited reads
          // the session first.
          if (!active || !isHidApiError(error) || error.status !== 401) throw error
          try { session = await api.refresh() }
          catch (refreshError) {
            // Identity refuses a provider's sign-in before rotating it (SESSION_CLIENT_MISMATCH).
            if (heldByOtherPortal(refreshError)) { if (active) providerSignedIn(); return }
            // No refresh cookie left (403 CSRF_VALIDATION_FAILED), or one Identity no longer accepts (401).
            refused = isHidApiError(refreshError) && refreshError.status === 403
            throw refreshError
          }
        }
        if (!active) return
        if (heldForAnotherPortal(session)) { providerSignedIn(); return }
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
        setOtherPortalSession(false)
        setSignedOutElsewhere(false)
      } catch (error) {
        if (!active) return
        if (refused || (isHidApiError(error) && error.status === 401)) {
          store.setAnonymous()
          setSessionError(null)
          setOtherPortalSession(false)
        } else {
          setSessionError('We could not check your session. Try again.')
        }
      }
    })()
    return () => { active = false }
  }, [api, store, checkKey])

  // Another tab's sign-in or sign-out changes the cookies this tab sends. Each
  // time one is heard of, and as the tab comes back into view after a minute or
  // more, the server is asked whose session the browser holds. A tab showing a
  // patient whose session has left the browser is signed out, so it neither keeps
  // that patient's records on screen after their sign-out nor acts as another
  // account. An access token past its 15 minutes answers 401 with the refresh
  // cookie still live, so the session is restored once before it is judged; an
  // outage proves nothing and changes nothing.
  useEffect(() => {
    let asking = false
    let again = false
    // Whether another tab announced a change since the question in progress, or
    // the next one, began.
    let heard = false
    // Requests refused with PATIENT_SESSION_REQUIRED, waiting for the question they raised.
    let waiting: Array<() => void> = []
    const settle = () => { const answered = waiting; waiting = []; for (const resume of answered) resume() }
    // `elsewhere` when the change is evident: another account's session, or a
    // refused refresh after another tab announced a change. A refused refresh
    // alone is also what this patient's own sign-in gives once it has expired or
    // been revoked, with no other tab involved, and is not blamed on one.
    const end = (subject: string, elsewhere: boolean) => {
      // Only the session asked about: a sign-in made in this tab meanwhile stays.
      if (store.getState().principal?.subjectId !== subject) return
      setSignedOutElsewhere(elsewhere)
      store.clear()
    }
    const ask = async (): Promise<void> => {
      const shown = store.getState().principal?.subjectId
      if (store.getState().status !== 'authenticated' || shown === undefined) {
        heard = false
        // Signed out here because the browser holds a provider's sign-in, which
        // sign-in and enrollment say: the session is checked again, so that they
        // stop saying so once it has been signed out elsewhere.
        if (otherPortal.current) setCheckKey(value => value + 1)
        if (!asking) settle()
        return
      }
      if (asking) { again = true; return }
      asking = true
      const announced = heard
      heard = false
      // Whether the server answered whose session the browser holds; an outage did not.
      let answered = false
      try {
        let session: PatientSession
        try { session = await api.session() }
        catch (error) {
          if (!isHidApiError(error) || error.status !== 401) return
          try { session = await api.refresh() }
          catch (refreshError) {
            // A provider's sign-in, refused before rotation, is another account's.
            if (heldByOtherPortal(refreshError)) { answered = true; end(shown, true) }
            else if (isHidApiError(refreshError) && (refreshError.status === 401 || refreshError.status === 403)) { answered = true; end(shown, announced || heard) }
            return
          }
        }
        answered = true
        if (!isPatientSessionOf(session, shown)) end(shown, true)
      } finally {
        asking = false
        // A change heard while asking may postdate the answer: ask once more.
        if (again) { again = false; void ask() }
        else {
          // Otherwise the answer postdates every change heard while the tab was out
          // of view, and its return has nothing more to ask about them.
          if (answered && away) away.heard = false
          settle()
        }
      }
    }
    // The refusal says the browser's session is not this patient's, as a change
    // another tab announces would: asked as one, and answered before the request returns.
    recheckSession.current = () => new Promise<void>(resume => {
      waiting.push(resume)
      heard = true
      void ask()
    })
    // Since when the tab is out of view, and whether another tab announced a change
    // meanwhile that no answer has followed yet.
    let away: { since: number; heard: boolean } | null = document.visibilityState === 'hidden' ? { since: Date.now(), heard: false } : null
    // Back in view. Each question is a request, a session read Identity audits, and
    // perhaps a refresh, so a brief look away with nothing announced meanwhile asks
    // nothing, as in the provider portal. A return after a minute or more, one after
    // another tab announced a change that no answer has followed (the question asked
    // as it was heard is still out, or found the service unavailable), and a page
    // restored from the back/forward cache are asked about.
    const back = (restored: boolean) => {
      if (document.visibilityState === 'hidden') return
      const left = away
      away = null
      // A restore whose return to view already asked has nothing more to ask.
      if (!left) { if (restored && !asking) void ask(); return }
      if (restored || left.heard || Date.now() - left.since >= RECHECK_AFTER_HIDDEN_MS) void ask()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') away ??= { since: Date.now(), heard: false }
      else back(false)
    }
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) back(true) }
    const stopListening = onOtherTabSessionChange(() => {
      heard = true
      if (away) away.heard = true
      void ask()
    })
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      stopListening()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      recheckSession.current = async () => undefined
      settle()
    }
  }, [api, store])

  const value = useMemo<SessionContextValue>(() => ({
    state, api, sessionError, otherPortalSession, signedOutElsewhere,
    retrySessionCheck: () => { setSessionError(null); setCheckKey(value => value + 1) },
    // A patient sign-in or sign-out replaces the session cookies this origin's other
    // tabs use, a provider's among them: they are told, naming no one.
    signIn: async (email, password, turnstileToken) => {
      const session = await api.login(email, password, turnstileToken)
      // The cookies changed whatever this page makes of the answer; the page's own
      // state changes first, so an announcement can never stand in its way.
      try {
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
        setOtherPortalSession(false)
        setSignedOutElsewhere(false)
      } finally { announceSessionChange() }
    },
    acceptGoogleSession: session => {
      try {
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
        setOtherPortalSession(false)
        setSignedOutElsewhere(false)
      } finally { announceSessionChange() }
    },
    takeUpActivatedSession: async () => {
      try {
        const session = await api.session()
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
        setOtherPortalSession(false)
        setSignedOutElsewhere(false)
        return true
      } catch {
        // Not read (an outage, or cookies the browser did not keep), or not a patient's: the patient signs in.
        return false
      } finally { announceSessionChange() }
    },
    refresh: async () => {
      const shown = store.getState().principal?.subjectId
      const session = await api.refresh()
      // Another account's session is never taken up as this tab's.
      if (shown !== undefined && !isPatientSessionOf(session, shown)) {
        setSignedOutElsewhere(true)
        store.clear()
        throw sessionEnded()
      }
      store.setAuthenticated(patientPrincipal(session))
    },
    signOut: async () => {
      const signedIn = store.getState().principal?.subjectId
      await turnOffDevicePush(api)
      // With single sign-on on app., where the sign-out sends the tab next (sso/singleSignOn.ts leaveAfterSignOut): the
      // provider's end-session address when the sign-out answered one, else nowhere. Noted before the session is
      // cleared, so the signed-out page that follows never hands off on its own. Every way out of the session asks for
      // the next sign-in from this page as the store clears it (noteSessionEndedHere, above). Off, it does nothing.
      let endSession: string | null = null
      try {
        endSession = await api.logout(signedIn)
      } catch (error) {
        // The browser holds a provider's sign-in now, which Identity neither ended
        // nor changed: this patient's has already left it. Nothing changed for the
        // other tabs to hear about.
        if (heldByOtherPortal(error)) { store.clear(); return }
        if (!isHidApiError(error) || error.status !== 401) throw error
        // Logout needs the 15-minute access token. After a longer idle the
        // session is restored once so the server ends it, but only if it is
        // still this patient's: another account's session is never revoked.
        let restored: PatientSession
        try {
          restored = await api.refresh()
        } catch (refreshError) {
          // A refused refresh leaves no session of this patient's in this browser
          // to end, a provider's sign-in refused as SESSION_CLIENT_MISMATCH included.
          if (isHidApiError(refreshError) && (refreshError.status === 401 || refreshError.status === 403)) {
            store.clear()
            return
          }
          throw refreshError
        }
        if (signedIn !== undefined && restored?.actor?.kind === 'patient' && restored.actor.subject === signedIn) {
          try { endSession = await api.logout(signedIn) }
          catch (repeated) { if (heldByOtherPortal(repeated)) { store.clear(); return } throw repeated }
        }
      }
      leaveAfterSignOut(endSession)
      store.clear()
      announceSessionChange()
    },
  }), [state, api, sessionError, otherPortalSession, signedOutElsewhere, store])

  return <SessionContext.Provider value={value}><PatientResourcesContext.Provider value={cached}>{children}</PatientResourcesContext.Provider></SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** Test seam for route guards and screens; no network or environment needed. */
export function createTestSessionValue(principal: AuthPrincipal | null, api: PatientApi): SessionContextValue {
  return {
    state: principal ? { status: 'authenticated', principal } : { status: 'anonymous', principal: null },
    api,
    sessionError: null,
    otherPortalSession: false,
    signedOutElsewhere: false,
    retrySessionCheck: () => {},
    signIn: async () => {},
    acceptGoogleSession: () => {},
    takeUpActivatedSession: async () => false,
    refresh: async () => {},
    signOut: async () => {},
  }
}

export { SessionContext }
