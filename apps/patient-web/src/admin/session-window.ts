/**
 * The platform session's idle and absolute expiry, exactly as the backend last
 * reported them (sign-in, refresh and MFA status responses). Held in memory
 * only. It never decides whether the session is valid: the server does, on
 * every request. It explains why the server stopped accepting the session.
 */

export type SessionEndReason = 'expired' | 'revoked'

interface SessionWindow { idleExpiresAt: number | null; absoluteExpiresAt: number | null }

let state: SessionWindow = { idleExpiresAt: null, absoluteExpiresAt: null }
const windowListeners = new Set<(value: Readonly<SessionWindow>) => void>()
const endListeners = new Set<(reason: SessionEndReason | null) => void>()

function instant(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function recordSessionWindow(input: { idleExpiresAt?: string; absoluteExpiresAt?: string }): void {
  state = {
    idleExpiresAt: instant(input.idleExpiresAt) ?? state.idleExpiresAt,
    absoluteExpiresAt: instant(input.absoluteExpiresAt) ?? state.absoluteExpiresAt,
  }
  for (const listener of windowListeners) listener(state)
}

export function clearSessionWindow(): void {
  state = { idleExpiresAt: null, absoluteExpiresAt: null }
  for (const listener of windowListeners) listener(state)
}

export function currentSessionWindow(): Readonly<SessionWindow> {
  return state
}

/**
 * Why the server no longer accepts the session. `expired` when its last
 * reported idle or absolute expiry has passed; `revoked` when it was refused
 * before then (revoked, signed out elsewhere, or MFA reset). The backend
 * returns the same 401 for all of these, so this is the closest truthful
 * reading; null when this page never held a platform session.
 */
export function sessionEndReason(now = Date.now()): SessionEndReason | null {
  const { idleExpiresAt, absoluteExpiresAt } = state
  if (idleExpiresAt === null && absoluteExpiresAt === null) return null
  if ((idleExpiresAt !== null && now >= idleExpiresAt) || (absoluteExpiresAt !== null && now >= absoluteExpiresAt)) {
    return 'expired'
  }
  return 'revoked'
}

export function reportSessionEnded(): void {
  const reason = sessionEndReason()
  for (const listener of endListeners) listener(reason)
}

export function onSessionEnded(listener: (reason: SessionEndReason | null) => void): () => void {
  endListeners.add(listener)
  return () => { endListeners.delete(listener) }
}

export function onSessionWindow(listener: (value: Readonly<SessionWindow>) => void): () => void {
  windowListeners.add(listener)
  return () => { windowListeners.delete(listener) }
}
