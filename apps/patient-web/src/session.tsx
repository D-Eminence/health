import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient, HidApiError, isHidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createLogger } from '@hid/observability'
import { createSessionStore, type AuthPrincipal, type SessionState } from '@hid/auth'
import { createPatientApi, type PatientApi, type PatientSession } from './api'
import { getEnvironment } from './env'
import { announceSessionChange, heldByOtherPortal, onOtherTabSessionChange } from './sessionChange'

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

  useEffect(() => store.subscribe(setState), [store])

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
          // to sign-in instead of seeing that refusal on the page.
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
    patientApi = createPatientApi(client)
    return patientApi
  }, [environment, store])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const session = await api.session()
        if (!active) return
        if (heldForAnotherPortal(session)) {
          // A provider's sign-in: no patient is signed in here, and asking again
          // would only find it again.
          store.setAnonymous()
          setSessionError(null)
          setOtherPortalSession(true)
          return
        }
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
        setOtherPortalSession(false)
        setSignedOutElsewhere(false)
      } catch (error) {
        if (!active) return
        if (isHidApiError(error) && error.status === 401) {
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
      if (store.getState().status !== 'authenticated' || shown === undefined) { heard = false; return }
      if (asking) { again = true; return }
      asking = true
      const announced = heard
      heard = false
      try {
        let session: PatientSession
        try { session = await api.session() }
        catch (error) {
          if (!isHidApiError(error) || error.status !== 401) return
          try { session = await api.refresh() }
          catch (refreshError) {
            // A provider's sign-in, refused before rotation, is another account's.
            if (heldByOtherPortal(refreshError)) end(shown, true)
            else if (isHidApiError(refreshError) && (refreshError.status === 401 || refreshError.status === 403)) end(shown, announced || heard)
            return
          }
        }
        if (!isPatientSessionOf(session, shown)) end(shown, true)
      } finally {
        asking = false
        // A change heard while asking may postdate the answer: ask once more.
        if (again) { again = false; void ask() }
      }
    }
    // Since when the tab is out of view, and whether another tab announced a change meanwhile.
    let away: { since: number; heard: boolean } | null = document.visibilityState === 'hidden' ? { since: Date.now(), heard: false } : null
    // Back in view. Each question is a request, a session read Identity audits, and
    // perhaps a refresh, so a brief look away with nothing announced meanwhile asks
    // nothing, as in the provider portal. A return after a minute or more, one after
    // another tab announced a change, and a page restored from the back/forward
    // cache are asked about.
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
      try {
        await api.logout(signedIn)
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
          try { await api.logout(signedIn) }
          catch (repeated) { if (heldByOtherPortal(repeated)) { store.clear(); return } throw repeated }
        }
      }
      store.clear()
      announceSessionChange()
    },
  }), [state, api, sessionError, otherPortalSession, signedOutElsewhere, store])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
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
    refresh: async () => {},
    signOut: async () => {},
  }
}

export { SessionContext }
