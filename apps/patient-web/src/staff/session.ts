import { isHidApiError } from '@hid/http'

/**
 * The end of the provider's staff session, as the staff API finds it. hid-system
 * answers an ended, expired or revoked staff session with a generic
 * 401 AUTHENTICATION_REQUIRED and gives staff clients no reason, so the portal
 * names none either. Held in memory only.
 */
const listeners = new Set<() => void>()

/** Calls `listener` each time a protected staff request finds the session ended. */
export function onStaffSessionEnded(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function reportStaffSessionEnded(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Whether an error from a protected staff request means the session itself has
 * ended. The HTTP client has already tried to restore the session once by
 * refreshing it, so a 401 that reaches the caller is final. A 403 is an
 * authorization refusal of one request (including break-glass) and never ends it.
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
const RETURN_PATHS: ReadonlySet<string> = new Set([
  '/provider', '/provider/patients', '/provider/registration', '/provider/requests', '/provider/audit',
  '/provider/clinical', '/provider/laboratory', '/provider/pharmacy', '/provider/ocr', '/provider/outreach', '/provider/migrate',
])

export function staffReturnPath(path: string | null): string | null {
  return path !== null && RETURN_PATHS.has(path) ? path : null
}

/** The staff sign-in page, returning afterwards to `path` when it is a workspace page. */
export function staffSignInPath(path: string | null): string {
  const returnTo = staffReturnPath(path)
  return returnTo ? `/provider/sign-in?returnTo=${encodeURIComponent(returnTo)}` : '/provider/sign-in'
}
