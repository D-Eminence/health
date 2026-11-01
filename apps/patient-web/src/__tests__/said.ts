import type { HidApiError } from '@hid/http'

/*
 * What a facility page says for a failure: plain words, never the server's own text, code, status or ids (owner's rule,
 * 1 Nov 2026). Tests assert these words and that the server's own words are not on screen.
 */
export const SAID_REFUSED = 'You don’t have access to do this. Ask your facility administrator if you need it.'
export const SAID_UNAVAILABLE = 'Health ID isn’t available right now. Please try again in a few minutes.'
export const SAID_NOT_FOUND = 'We couldn’t find what you were looking for. It may have been moved or removed.'
export const SAID_CHANGED = 'This was changed somewhere else. Refresh the page and try again.'
export const SAID_NETWORK = 'We couldn’t reach Health ID. Check your connection and try again.'
export const SAID_SIGNED_OUT = 'Your session has ended. Please sign in again.'
export const SAID_TOO_MANY = 'You’ve tried this too many times. Please wait a few minutes and try again.'
/** A form whose fields a service refused (staff/fieldProblem.ts FIELDS_REFUSED). */
export const SAID_FIELDS_REFUSED = 'Some details weren’t accepted. Check the details you entered and try again.'
/** A service-to-service fault (EHR_/LAB_/PHARMACY_SERVICE_AUTH_UNAVAILABLE). */
export const SAID_TRY_SHORTLY = 'We couldn’t finish this just now. Wait a few seconds and try again.'
/** A module the gateway does not serve (404 API_ROUTE_NOT_FOUND). */
export const SAID_NOT_TURNED_ON = 'This part of Health ID isn’t turned on for your facility. Contact Health ID support if you need it.'

const BY_STATUS: Readonly<Record<number, string>> = {
  0: SAID_NETWORK, 401: SAID_SIGNED_OUT, 403: SAID_REFUSED, 404: SAID_NOT_FOUND, 412: SAID_CHANGED, 429: SAID_TOO_MANY,
  500: SAID_UNAVAILABLE, 502: SAID_UNAVAILABLE, 503: SAID_UNAVAILABLE,
}

/** The shared words for a failure's status (a test's own table, not the code under test). */
export function said(error: HidApiError): string {
  return BY_STATUS[error.status] ?? `no plain words for ${error.status}`
}
