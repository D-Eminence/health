/**
 * The plain words Health ID pages share for the failures every page has, and the sentence for each status. Kept apart
 * from ./plain.ts so ./errors.ts can use them without importing the module that imports it (plain.ts re-exports them).
 */

/** The words every Health ID page uses for the failures every page shares. */
export const PLAIN = {
  network: 'We couldn’t reach Health ID. Check your connection and try again.',
  timeout: 'This is taking too long. Check your connection and try again.',
  signedOut: 'Your session has ended. Please sign in again.',
  noAccess: 'You don’t have access to do this.',
  noAccessFacility: 'You don’t have access to do this. Ask your facility administrator if you need it.',
  notFound: 'We couldn’t find what you were looking for. It may have been moved or removed.',
  tooMany: 'You’ve tried this too many times. Please wait a few minutes and try again.',
  tooLarge: 'This file is too large. Choose a smaller file and try again.',
  changed: 'This was changed somewhere else. Refresh the page and try again.',
  unavailable: 'Health ID isn’t available right now. Please try again in a few minutes.',
  notAccepted: 'Some details weren’t accepted. Check them and try again.',
  notDone: 'This couldn’t be done right now. Refresh the page and try again.',
  stopped: 'This was stopped before it finished. Please try again.',
  securityCheck: 'Please complete the security check again, then try again.',
  signOutFailed: 'We couldn’t sign you out. Please try again.',
  generic: 'Something went wrong. Please try again.',
} as const

/** Who reads the words: a facility user is also told who to ask when access is refused. */
export type PlainAudience = 'patient' | 'facility'

/**
 * The words for a status when a page has none of its own. Used as every
 * HidApiError's `message`, so even a page that still prints `.message` shows
 * these and never the server's text.
 */
export function plainStatusText(status: number, audience: PlainAudience = 'patient'): string {
  if (status === 0) return PLAIN.network
  if (status === 400 || status === 422) return PLAIN.notAccepted
  if (status === 401) return PLAIN.signedOut
  if (status === 403) return audience === 'facility' ? PLAIN.noAccessFacility : PLAIN.noAccess
  if (status === 404 || status === 410) return PLAIN.notFound
  if (status === 408 || status === 504) return PLAIN.timeout
  if (status === 409) return PLAIN.notDone
  if (status === 412) return PLAIN.changed
  if (status === 413) return PLAIN.tooLarge
  if (status === 429) return PLAIN.tooMany
  if (status >= 500) return PLAIN.unavailable
  return PLAIN.generic
}
