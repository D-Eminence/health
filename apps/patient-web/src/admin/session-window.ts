/**
 * The platform session's idle and absolute expiry, exactly as the backend last
 * reported them (sign-in, refresh and MFA status responses). Held in memory
 * only. It never decides whether the session is valid: the server does, on
 * every request. It explains why the server stopped accepting the session.
 */

/**
 * Why the workspace ended: the server's PLATFORM_SESSION_EXPIRED or
 * PLATFORM_SESSION_REVOKED (or the reading of its reported expiry), or
 * `switched` when the browser's platform cookies now hold another
 * administrator's session (signed in from another tab).
 */
export type SessionEndReason = 'expired' | 'revoked' | 'switched'

interface SessionWindow { idleExpiresAt: number | null; absoluteExpiresAt: number | null }

let state: SessionWindow = { idleExpiresAt: null, absoluteExpiresAt: null }
/** The reason the server last gave for refusing this session (Stage 4A), until a new session starts. */
let serverReason: SessionEndReason | null = null
const windowListeners = new Set<(value: Readonly<SessionWindow>) => void>()
const endListeners = new Set<(reason: SessionEndReason | null) => void>()

function instant(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function recordSessionWindow(input: { idleExpiresAt?: string; absoluteExpiresAt?: string }): void {
  serverReason = null
  state = {
    idleExpiresAt: instant(input.idleExpiresAt) ?? state.idleExpiresAt,
    absoluteExpiresAt: instant(input.absoluteExpiresAt) ?? state.absoluteExpiresAt,
  }
  for (const listener of windowListeners) listener(state)
}

export function clearSessionWindow(): void {
  serverReason = null
  state = { idleExpiresAt: null, absoluteExpiresAt: null }
  for (const listener of windowListeners) listener(state)
}

export function currentSessionWindow(): Readonly<SessionWindow> {
  return state
}

/** The reason a backend problem code states: 401 PLATFORM_SESSION_EXPIRED or PLATFORM_SESSION_REVOKED. */
export function serverSessionEnd(code: string | null | undefined): SessionEndReason | null {
  if (code === 'PLATFORM_SESSION_EXPIRED') return 'expired'
  if (code === 'PLATFORM_SESSION_REVOKED') return 'revoked'
  return null
}

/** Keeps the server's reason from a refused refresh for the next session-end report. */
export function recordServerSessionEnd(reason: SessionEndReason | null): void {
  if (reason) serverReason = reason
}

/**
 * Why the server no longer accepts the session, read from the expiry it last
 * reported: `expired` when its idle or absolute expiry has passed; `revoked`
 * when it was refused before then. Used only when the server gave no reason
 * (a generic 401, for example with no session cookie left); null when this
 * page never held a platform session.
 */
export function sessionEndReason(now = Date.now()): SessionEndReason | null {
  const { idleExpiresAt, absoluteExpiresAt } = state
  if (idleExpiresAt === null && absoluteExpiresAt === null) return null
  if ((idleExpiresAt !== null && now >= idleExpiresAt) || (absoluteExpiresAt !== null && now >= absoluteExpiresAt)) {
    return 'expired'
  }
  return 'revoked'
}

/** The server's own reason wins over the expiry reading. */
export function reportSessionEnded(reason: SessionEndReason | null = null): void {
  const value = reason ?? serverReason ?? sessionEndReason()
  serverReason = null
  for (const listener of endListeners) listener(value)
}

export function onSessionEnded(listener: (reason: SessionEndReason | null) => void): () => void {
  endListeners.add(listener)
  return () => { endListeners.delete(listener) }
}

export function onSessionWindow(listener: (value: Readonly<SessionWindow>) => void): () => void {
  windowListeners.add(listener)
  return () => { windowListeners.delete(listener) }
}
