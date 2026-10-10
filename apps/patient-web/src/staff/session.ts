import { isHidApiError } from '@hid/http'

/**
 * The end of the provider's staff session, as the staff API finds it. hid-system
 * answers an ended, expired or revoked staff session with a generic
 * 401 AUTHENTICATION_REQUIRED and gives staff clients no reason, so the portal
 * names none either. Held in memory only.
 */
const listeners = new Set<(generation: number) => void>()

/**
 * Counts the sessions this page has held. The provider starts a new generation
 * whenever a session starts or ends, so an answer to a request sent in an
 * earlier one can be recognised and ignored.
 */
let generation = 0

export function staffSessionGeneration(): number {
  return generation
}

export function startStaffSessionGeneration(): void {
  generation += 1
}

/** Calls `listener` each time a request sent in `generation` is refused as if the session had ended. */
export function onStaffSessionEnded(listener: (generation: number) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function reportStaffSessionEnded(sentIn: number = generation): void {
  for (const listener of [...listeners]) listener(sentIn)
}

/**
 * Whether an error is the 401 that hid-system gives a request without a usable
 * session. For a protected request outside /api/v1/auth/ the HTTP client has
 * already refreshed once, yet the 401 still proves nothing on its own: each
 * refresh rotates the session, so a retry still on its way can be refused while
 * the session lives on. The provider confirms with the server before ending it.
 * Calls under /api/v1/auth/ are never refreshed by the client; their callers
 * restore the session themselves. A 403 is an authorization refusal of one
 * request (including break-glass) and never ends the session.
 */
export function endsStaffSession(error: unknown): boolean {
  return isHidApiError(error) && error.status === 401
}

/**
 * The provider workspace pages a sign-in may return to, matched exactly. Only a
 * path from this list is ever used, so a crafted `returnTo` cannot lead to
 * another origin, another app or a page outside the workspace, and it never
 * carries a query that could hold a patient identifier.
 */
export const STAFF_RETURN_PATHS: readonly string[] = [
  '/provider', '/provider/patients', '/provider/registration', '/provider/requests', '/provider/audit',
  '/provider/clinical', '/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/outreach', '/provider/migrate',
]

export function staffReturnPath(path: string | null): string | null {
  return path !== null && STAFF_RETURN_PATHS.includes(path) ? path : null
}

/** The staff sign-in page, returning afterwards to `path` when it is a workspace page. */
export function staffSignInPath(path: string | null): string {
  const returnTo = staffReturnPath(path)
  return returnTo ? `/provider/sign-in?returnTo=${encodeURIComponent(returnTo)}` : '/provider/sign-in'
}
