import { HidApiError, isHidApiError } from '@hid/http'
import { SESSION_CHANGE_CHANNEL } from '../sessionChange'
import type { StaffSession } from './api'

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
 * earlier one can be recognised and ignored. Starting one also cancels the
 * protected requests still in flight from the last, through `staffSessionSignal`.
 */
let generation = 0
let generationEnd = new AbortController()

export function staffSessionGeneration(): number {
  return generation
}

/** Aborted when the current generation ends. */
export function staffSessionSignal(): AbortSignal {
  return generationEnd.signal
}

export function startStaffSessionGeneration(): void {
  generation += 1
  const ended = generationEnd
  generationEnd = new AbortController()
  ended.abort()
  wakeWaiting()
}

/**
 * Whether the session in use is ready for protected requests: in use, confirmed,
 * and its workspace unlocked. While it is being checked, could not be confirmed,
 * or the page is away, a protected request waits; if that session ends meanwhile
 * the request is never sent.
 */
let ready = false
let waiting: Array<() => void> = []

function wakeWaiting(): void {
  const woken = waiting
  waiting = []
  for (const resume of woken) resume()
}

export function setStaffSessionReady(value: boolean): void {
  ready = value
  wakeWaiting()
}

/**
 * Whether the session of generation `sentIn` is ready now. Throws a cancellation
 * once that session has ended: whatever was waiting on it is abandoned.
 */
export function staffSessionReadyFor(sentIn: number): boolean {
  if (generation !== sentIn) {
    throw new HidApiError(0, 'Stopped because the session it belonged to ended.', { code: 'REQUEST_CANCELLED', retryable: false })
  }
  return ready
}

/** Resolves at the next change of readiness or of session. */
export function nextStaffSessionChange(): Promise<void> {
  return new Promise(resolve => { waiting.push(resolve) })
}

/**
 * Waits until the session of generation `sentIn` is ready; rejects, cancelled,
 * once it has ended. A step that follows another (an upload's completion, opening
 * a patient after a PIN check) calls it just before it acts.
 */
export async function untilStaffSessionReady(sentIn: number): Promise<void> {
  while (!staffSessionReadyFor(sentIn)) await nextStaffSessionChange()
}

/**
 * The account of the session in use, or null while none is (loading, signed out,
 * ended). A refresh that answers for another account has not restored this
 * session: the browser's cookies now belong to someone else.
 */
let actor: string | null = null

export function staffSessionActor(): string | null {
  return actor
}

export function setStaffSessionActor(id: string | null): void {
  actor = id
}

/**
 * The facilities of the session in use, as the provider holds them, or null while
 * none is in use. Identity refuses a request whose X-Facility-ID is not one of the
 * actor's active facilities (403 FACILITY_ACCESS_DENIED), so a protected request
 * for a facility the provider has found gone (a membership ended mid-session) is
 * never sent: one waiting for a check, or repeated after a refresh, is cancelled.
 */
let facilities: readonly string[] | null = null

export function setStaffSessionFacilities(ids: readonly string[] | null): void {
  facilities = ids
}

/**
 * Throws a cancellation when `facilityId` is no longer one of the session's
 * facilities. A request that names none is left to the server, as before.
 */
export function assertStaffSessionFacility(facilityId: string | undefined): void {
  if (!facilityId || facilities === null || facilities.includes(facilityId)) return
  throw new HidApiError(0, 'Stopped because you are no longer active at the facility it was for.', { code: 'REQUEST_CANCELLED', retryable: false })
}

/**
 * The origin's other tabs share this tab's cookies. Each tells the others when
 * its session changes (a staff or patient sign-in, a sign-out, a session end),
 * naming nothing; a tab that hears it asks the server itself. This tab announces
 * on the channel it listens with, since a channel never hears its own messages.
 */
let tabs: BroadcastChannel | null = null
let tabListeners = 0

export function onOtherTabSessionChange(listener: () => void): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  // A browser that refuses the channel leaves this tab to notice changes on its
  // own (a refused request, a return to the page); the portal still works.
  let channel: BroadcastChannel
  try { channel = tabs ??= new BroadcastChannel(SESSION_CHANGE_CHANNEL) } catch { return () => undefined }
  const receive = () => listener()
  channel.addEventListener('message', receive)
  tabListeners += 1
  return () => {
    channel.removeEventListener('message', receive)
    tabListeners -= 1
    if (tabListeners === 0 && tabs === channel) { channel.close(); tabs = null }
  }
}

export function announceStaffSessionChange(): void {
  try { tabs?.postMessage('changed') } catch { /* best effort, as for listening */ }
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
 * Sessions of the account in use, read by a refresh (after a 401) or a session
 * check, with the generation they were read in. The provider learns from them only
 * whether the facility its tab works at is still one of the actor's: it never
 * moves to the facility they report, which may be another tab's choice.
 */
const readListeners = new Set<(session: StaffSession, generation: number) => void>()

export function onStaffSessionRead(listener: (session: StaffSession, generation: number) => void): () => void {
  readListeners.add(listener)
  return () => { readListeners.delete(listener) }
}

export function reportStaffSessionRead(session: StaffSession, sentIn: number): void {
  for (const listener of [...readListeners]) listener(session, sentIn)
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
 * Whether a 403 says the request's session is a patient's. Identity and EHR
 * answer a staff route with PATIENT_SCOPE_DENIED only after verifying a valid
 * patient session (hid-system security.guard and remote-security.guard): the
 * browser's shared cookies now belong to a patient who signed in on this origin.
 * The provider then asks the server, as for a 401; it never signs out on the
 * 403 alone. No other 403 says anything about whose session it is.
 */
export function refusedAsPatient(error: unknown): boolean {
  return isHidApiError(error) && error.status === 403 && error.code === 'PATIENT_SCOPE_DENIED'
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
