import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient, HidApiError, isHidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createLogger } from '@hid/observability'
import { createSessionStore, type AuthPrincipal, type SessionState } from '@hid/auth'
import { createPatientApi, type PatientApi, type PatientSession } from './api'
import { getEnvironment } from './env'
import { announceSessionChange, heldByOtherPortal } from './sessionChange'

interface SessionContextValue {
  readonly state: SessionState
  readonly api: PatientApi
  readonly sessionError: string | null
  readonly retrySessionCheck: () => void
  readonly signIn: (email: string, password: string, turnstileToken: string) => Promise<void>
  readonly acceptGoogleSession: (session: PatientSession) => void
  readonly refresh: () => Promise<void>
  readonly signOut: () => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

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
      // Protected requests try a refresh before the final 401 clears the session.
      onUnauthorized: () => { if (store.getState().status === 'authenticated') store.clear() },
      refreshSession: async () => {
        try {
          await patientApi?.refresh()
        } catch (error) {
          // With no refresh cookie left (expired, or cleared by a sign-out in
          // another tab) the backend refuses the refresh with 403
          // CSRF_VALIDATION_FAILED; with a provider's sign-in in the cookies, with
          // 403 SESSION_CLIENT_MISMATCH, rotating nothing. Either way this
          // patient's session has ended here, as for a 401, so the patient returns
          // to sign-in instead of seeing that refusal on the page.
          if (isHidApiError(error) && error.status === 403) {
            throw new HidApiError(401, 'Your session has ended. Sign in again.', { code: 'AUTHENTICATION_REQUIRED', retryable: false, cause: error })
          }
          throw error
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
        if (active) {
          store.setAuthenticated(patientPrincipal(session))
          setSessionError(null)
        }
      } catch (error) {
        if (!active) return
        if (isHidApiError(error) && error.status === 401) {
          store.setAnonymous()
          setSessionError(null)
        } else {
          setSessionError('We could not check your session. Try again.')
        }
      }
    })()
    return () => { active = false }
  }, [api, store, checkKey])

  const value = useMemo<SessionContextValue>(() => ({
    state, api, sessionError,
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
      } finally { announceSessionChange() }
    },
    acceptGoogleSession: session => {
      try {
        store.setAuthenticated(patientPrincipal(session))
        setSessionError(null)
      } finally { announceSessionChange() }
    },
    refresh: async () => {
      const session = await api.refresh()
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
  }), [state, api, sessionError, store])

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
    retrySessionCheck: () => {},
    signIn: async () => {},
    acceptGoogleSession: () => {},
    refresh: async () => {},
    signOut: async () => {},
  }
}

export { SessionContext }
