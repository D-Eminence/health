/**
 * Plain English for every failure a patient or a facility user can see.
 *
 * The owner's rule (1 Nov 2026): nothing internal is shown in the patient or
 * facility apps, and every error or message is plain, friendly English.
 * `plainErrorText(caught, fallback)` is the one way a page turns a caught error
 * into words. It never returns the server's own text (a HidApiError's
 * `detail`), an error or status code, a status number, a correlation id, an
 * internal id, or a JavaScript error's message ("Failed to fetch",
 * "Cannot read properties of undefined"). It returns, in this order:
 *
 *  1. the page's own words for the error's code (`codes`), then for its
 *     status (`statuses`);
 *  2. a PlainError's message: words a page wrote for people on purpose;
 *  3. the words every page shares for the failures every page has: no
 *     connection, too slow, signed out, no access, not found, too many tries, a
 *     file too large, changed meanwhile, Health ID unavailable, stopped, a refused
 *     security check;
 *  4. otherwise the page's own `fallback`, which says what failed and what to
 *     do next ("We couldn’t save this note. Try again.").
 *
 * A refusal still says it was refused, and a step still says what to do: the
 * page keeps its meaning, only the words come from here.
 */

import { HidApiError } from './errors'
import { PLAIN, plainStatusText, type PlainAudience } from './plainWords'

export { PLAIN, plainStatusText }
export type { PlainAudience }

/**
 * An error whose message a page wrote for people, in plain words, on purpose
 * ("Select a facility first."). plainErrorText shows its message; every other
 * error's message is never shown. Never build one from a caught error's text.
 */
export class PlainError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'PlainError'
  }
}

export function isPlainError(value: unknown): value is PlainError {
  return value instanceof PlainError
}

export interface PlainErrorOptions {
  /** The page's own words for the error codes it knows, e.g. `{ NIN_ALREADY_REGISTERED: 'This person already has a Health ID.' }`. */
  readonly codes?: Readonly<Record<string, string>>
  /** The page's own words for a status, e.g. `{ 401: 'That email or password isn’t right. Try again.' }` on a sign-in page. */
  readonly statuses?: Readonly<Partial<Record<number, string>>>
  readonly audience?: PlainAudience
}

/** Error codes that mean the thing changed after it was loaded (a 409 for anything else keeps the page's own words). */
const CHANGED_CODE = /(^|_)(CONFLICT|STALE|VERSION|PRECONDITION)(_|$)/

/** A browser's own words for a request that never reached the server (Chrome, Firefox, Safari). */
const BROWSER_NETWORK_FAILURE = /failed to fetch|networkerror|network error|load failed|network request failed/i

/** Whether the error means the request never reached Health ID: no connection, or the browser could not send it. */
export function isConnectionFailure(caught: unknown): boolean {
  if (caught instanceof HidApiError) return caught.code === 'NETWORK_ERROR' || (caught.status === 0 && caught.code !== 'REQUEST_CANCELLED')
  return caught instanceof TypeError && BROWSER_NETWORK_FAILURE.test(caught.message)
}

/** Whether the error is a request the page or the browser stopped on purpose (nothing needs to be said). */
export function isStoppedRequest(caught: unknown): boolean {
  if (caught instanceof HidApiError) return caught.code === 'REQUEST_CANCELLED'
  return typeof caught === 'object' && caught !== null && (caught as { name?: unknown }).name === 'AbortError'
}

function own(words: Readonly<Record<string | number, string | undefined>> | undefined, key: string | number): string | null {
  if (!words || !Object.prototype.hasOwnProperty.call(words, key)) return null
  const text = words[key]
  return typeof text === 'string' && text.trim() !== '' ? text : null
}

/**
 * What a page shows for a caught error, in plain English: see the module comment. `fallback` is the page's own
 * sentence for this step and is used whenever nothing more specific applies (a 400, an unknown code, a bug).
 */
export function plainErrorText(caught: unknown, fallback: string, options: PlainErrorOptions = {}): string {
  if (caught instanceof HidApiError) {
    const words = own(options.codes, caught.code) ?? own(options.statuses, caught.status)
    if (words) return words
    if (caught.code === 'REQUEST_CANCELLED') return PLAIN.stopped
    // The security check (Turnstile) is refused the same way on every page that has one.
    if (caught.code.startsWith('TURNSTILE_')) return PLAIN.securityCheck
    if (isConnectionFailure(caught)) return PLAIN.network
    if (caught.status === 408 || caught.status === 504 || caught.code === 'REQUEST_TIMEOUT') return PLAIN.timeout
    if (caught.status === 401) return PLAIN.signedOut
    if (caught.status === 403) return options.audience === 'facility' ? PLAIN.noAccessFacility : PLAIN.noAccess
    if (caught.status === 404 || caught.status === 410) return PLAIN.notFound
    if (caught.status === 413) return PLAIN.tooLarge
    if (caught.status === 429) return PLAIN.tooMany
    if (caught.status === 412 || (caught.status === 409 && CHANGED_CODE.test(caught.code))) return PLAIN.changed
    if (caught.status >= 500) return PLAIN.unavailable
    return fallback
  }
  if (caught instanceof PlainError && caught.message.trim() !== '') return caught.message
  if (isStoppedRequest(caught)) return PLAIN.stopped
  if (isConnectionFailure(caught)) return PLAIN.network
  return fallback
}
