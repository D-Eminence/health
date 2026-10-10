import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createApiClient, isHidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createLogger } from '@hid/observability'
import { createSessionStore, type AuthPrincipal, type SessionState } from '@hid/auth'
import { createPatientApi, type PatientApi, type PatientSession } from './api'
import { getEnvironment } from './env'
import { announceSessionChange } from './sessionChange'

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
      refreshSession: async () => { await patientApi?.refresh() },
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
      announceSessionChange()
      store.setAuthenticated(patientPrincipal(session))
      setSessionError(null)
    },
    acceptGoogleSession: session => {
      announceSessionChange()
      store.setAuthenticated(patientPrincipal(session))
      setSessionError(null)
    },
    refresh: async () => {
      const session = await api.refresh()
      store.setAuthenticated(patientPrincipal(session))
    },
    signOut: async () => {
      await api.logout()
      announceSessionChange()
      store.clear()
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
