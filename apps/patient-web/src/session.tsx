/**
 * Session wiring for the patient application.
 *
 * This is the seam between the authentication provider and the rest of the
 * application. It holds the in-memory session store, hands the API client a
 * token supplier, and clears state when the backend rejects a token.
 *
 * What it does *not* do is authenticate anyone. Signing in, refreshing tokens
 * and enforcing MFA belong to the Health ID authentication architecture that
 * already exists; `signIn` below is the single place where that provider will
 * be attached, and it is marked accordingly rather than guessed at.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createHidApi, type HidApiFor } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createLogger } from '@hid/observability'
import { createSessionStore, type AuthPrincipal, type SessionState } from '@hid/auth'
import { getEnvironment } from './env'

interface SessionContextValue {
  readonly state: SessionState
  readonly api: HidApiFor<'patient-web'>
  /** Ends the session locally. The backend invalidates its own state separately. */
  readonly signOut: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const environment = getEnvironment()
  const storeRef = useRef(createSessionStore())
  const store = storeRef.current

  const [state, setState] = useState<SessionState>(store.getState())

  useEffect(() => store.subscribe(setState), [store])

  const api = useMemo(() => {
    const logger = createLogger({
      minLevel: environment.name === 'local' ? 'debug' : 'warn',
      baseContext: { app: 'patient-web', environment: environment.name },
    })

    const client = createApiClient({
      baseUrl: environment.apiBaseUrl,
      clientId: 'patient-web',
      logger,
      // The token lives in the store's closure, never in storage.
      getAccessToken: () => store.getAccessToken(),
      // A rejected token means this session is over. Clearing here is what makes
      // the guards re-evaluate and route the user back to sign-in.
      onUnauthorized: () => store.clear(),
    })

    return createHidApi({ app: 'patient-web', client })
  }, [environment, store])

  useEffect(() => {
    // CONTRACT GAP — the session bootstrap goes here.
    //
    // Restoring a session on load requires the Health ID authentication
    // provider: reading the current token, its assurance level, and the
    // principal it belongs to. That integration is not built in this task
    // because the provider boundary at the Gateway has not been confirmed
    // (docs/OPEN-QUESTIONS.md, Q1 and Q4).
    //
    // Until it is, the application resolves to anonymous rather than
    // pretending to be signed in. Failing closed is the only safe default.
    store.setAnonymous()
  }, [store])

  const value = useMemo<SessionContextValue>(
    () => ({
      state,
      api,
      signOut: () => store.clear(),
    }),
    [state, api, store],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** Test seam: builds a provider value without a network or a real environment. */
export function createTestSessionValue(
  principal: AuthPrincipal | null,
  api: HidApiFor<'patient-web'>,
): SessionContextValue {
  return {
    state: principal
      ? { status: 'authenticated', principal }
      : { status: 'anonymous', principal: null },
    api,
    signOut: () => {},
  }
}

export { SessionContext }
