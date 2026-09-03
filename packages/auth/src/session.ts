/**
 * Session state for Health ID frontends.
 *
 * Two rules shape this module:
 *
 *  1. Tokens and principals live in memory only. Nothing identifying is written
 *     to `localStorage`, `sessionStorage`, IndexedDB or a cookie readable by
 *     script. A closed tab is a cleared session; that is the intended trade.
 *
 *  2. The only thing that persists is a portal hint — which of the three
 *     entrances the person last used — so returning users land on the right
 *     sign-in screen. It is a single enum value and identifies nobody.
 *
 * Token *refresh* is the authentication provider's job, not this module's. This
 * holds what the provider currently reports and notifies the application when
 * it changes.
 */

import type { AuthPrincipal, PrincipalKind } from './principal'

export type SessionStatus =
  /** Before the first check completes. Guards must wait, not redirect. */
  | 'unknown'
  /** Checked, and nobody is signed in. */
  | 'anonymous'
  /** Checked, and a principal is present. */
  | 'authenticated'

export type SessionState =
  | { readonly status: 'unknown'; readonly principal: null }
  | { readonly status: 'anonymous'; readonly principal: null }
  | { readonly status: 'authenticated'; readonly principal: AuthPrincipal }

export const INITIAL_SESSION_STATE: SessionState = { status: 'unknown', principal: null }

export type SessionListener = (state: SessionState) => void

export interface SessionStore {
  getState(): SessionState
  /** Replaces the current state and notifies subscribers. */
  setAuthenticated(principal: AuthPrincipal): void
  setAnonymous(): void
  /** Clears the in-memory access token and principal. */
  clear(): void
  /** Stores the access token in memory for the API client to read. */
  setAccessToken(token: string | null): void
  getAccessToken(): string | null
  subscribe(listener: SessionListener): () => void
}

export function createSessionStore(): SessionStore {
  let state: SessionState = INITIAL_SESSION_STATE
  // Held in a closure, never in storage: a token in `localStorage` is readable
  // by any script that reaches the page, and survives the tab that earned it.
  let accessToken: string | null = null
  const listeners = new Set<SessionListener>()

  const publish = (next: SessionState) => {
    state = next
    for (const listener of listeners) listener(state)
  }

  return {
    getState: () => state,

    setAuthenticated(principal) {
      publish({ status: 'authenticated', principal })
    },

    setAnonymous() {
      accessToken = null
      publish({ status: 'anonymous', principal: null })
    },

    clear() {
      accessToken = null
      publish({ status: 'anonymous', principal: null })
    },

    setAccessToken(token) {
      accessToken = token
    },

    getAccessToken: () => accessToken,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Portal hint
// ---------------------------------------------------------------------------

const PORTAL_HINT_KEY = 'hid.portal-hint'

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function resolveStorage(storage?: KeyValueStorage): KeyValueStorage | null {
  if (storage) return storage
  if (typeof globalThis.localStorage === 'undefined') return null
  return globalThis.localStorage
}

/**
 * Remembers which entrance was last used. This is the only value any Health ID
 * frontend persists about a person, and it is one of three constants.
 */
export function writePortalHint(kind: PrincipalKind, storage?: KeyValueStorage): void {
  const target = resolveStorage(storage)
  if (!target) return
  try {
    target.setItem(PORTAL_HINT_KEY, kind)
  } catch {
    // Storage can be unavailable (private mode, blocked site data). The hint is
    // a convenience; losing it must never interrupt a sign-in.
  }
}

export function readPortalHint(storage?: KeyValueStorage): PrincipalKind | null {
  const target = resolveStorage(storage)
  if (!target) return null
  try {
    const value = target.getItem(PORTAL_HINT_KEY)
    return value === 'patient' || value === 'staff' || value === 'platform' ? value : null
  } catch {
    return null
  }
}

export function clearPortalHint(storage?: KeyValueStorage): void {
  const target = resolveStorage(storage)
  if (!target) return
  try {
    target.removeItem(PORTAL_HINT_KEY)
  } catch {
    // Ignored for the same reason as above.
  }
}

/** Every storage key this package is permitted to write. Asserted in tests. */
export const PERSISTED_STORAGE_KEYS: readonly string[] = [PORTAL_HINT_KEY]
