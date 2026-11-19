import { useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'

/*
 * The NIN check, as the sign-up's NIN start (POST /identity/patient-enrollments), the profile's "Verify your NIN"
 * (POST /identity/me/verification/nin) and the registration desk's check (POST /identity/nin/resolve) make it.
 *
 * Identity asks QoreID once per NIN (hid-system 0137, "One QoreID check per NIN", nin-check-once.ts) and waits for its
 * answer up to QOREID_TIMEOUT_MS (12 s from hid-system #271, 15 s on the 0137 branch, at most 20 s), and a second
 * request for a NIN being checked waits that long plus 3 s for the first one's answer. The production gateway gives up
 * at 30 s. So these three requests wait 30 s, not the client's usual 15 s, and say after a few seconds that the check
 * is still going. Identity's answers when it could not finish are said here in plain words, never with a code:
 *
 *  - 409 NIN_CHECK_IN_PROGRESS: another request (or this one, sent before) is checking this NIN.
 *  - 409 NIN_CHECK_HELD with `retryAfterSeconds`: a check QoreID may have charged left no answer; the NIN is held.
 *  - 504 QOREID_TIMEOUT (or any 504, or this client's own wait ending): the check goes on and its answer is kept.
 *  - 400 NIN_DETAILS_INVALID (the desk): a name or date of birth that cannot be anyone's.
 *
 * A retry of the same details sends the same Idempotency-Key, so it picks up the check already made; each screen keeps
 * its key in memory only and makes a new one when the details change or the person starts over.
 */

/** How long a NIN check request waits for Identity's answer: at least 15 s, inside the gateway's 30 s. */
export const NIN_CHECK_TIMEOUT_MS = 30_000
/** After this long without an answer, the screen says the check is still going. */
export const NIN_STILL_CHECKING_AFTER_MS = 4_000

export const NIN_STILL_CHECKING = 'Still checking the NIN. This can take up to a minute.'
export const NIN_IN_PROGRESS = 'We’re still checking this NIN. Wait a moment, then try again.'
export const NIN_TAKING_LONGER = 'The NIN check is taking longer than usual. Try again in a minute.'
export const NIN_HELD_FEW_MINUTES = 'This NIN check is on hold. Try again in a few minutes.'
export const NIN_DETAILS_CHECK = 'Those details don’t match the NIN record. Check the NIN, name and date of birth, then try again.'

/** "This NIN check is on hold. Try again after 14:32." in the person's own time zone, rounded up to the minute. */
export function ninHeldText(until: number, now = Date.now()): string {
  const at = new Date(Math.ceil(until / 60_000) * 60_000)
  const clock = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const today = new Date(now).toDateString() === at.toDateString()
  return `This NIN check is on hold. Try again after ${clock}${today ? '' : ' tomorrow'}.`
}

export type NinCheckOutcome = 'in_progress' | 'held' | 'taking_longer' | 'details'

export interface NinCheckProblem {
  readonly outcome: NinCheckOutcome
  /** What the screen says. */
  readonly text: string
  /** Until when a held NIN cannot be checked (ms since the epoch); null when the answer did not say. */
  readonly heldUntil: number | null
}

/**
 * Identity's answer for a NIN check it could not finish, in plain words, or null for any other failure (which the
 * screen says as it already does).
 */
export function ninCheckProblem(caught: unknown, now = Date.now()): NinCheckProblem | null {
  if (!isHidApiError(caught)) return null
  if (caught.status === 409 && caught.code === 'NIN_CHECK_IN_PROGRESS') {
    return { outcome: 'in_progress', text: NIN_IN_PROGRESS, heldUntil: null }
  }
  if (caught.status === 409 && caught.code === 'NIN_CHECK_HELD') {
    const seconds = caught.retryInSeconds
    const heldUntil = seconds !== null && seconds > 0 ? now + seconds * 1_000 : null
    return { outcome: 'held', text: heldUntil === null ? NIN_HELD_FEW_MINUTES : ninHeldText(heldUntil, now), heldUntil }
  }
  if (caught.status === 504 || caught.status === 408 || caught.code === 'REQUEST_TIMEOUT' || caught.code === 'QOREID_TIMEOUT') {
    return { outcome: 'taking_longer', text: NIN_TAKING_LONGER, heldUntil: null }
  }
  if (caught.status === 400 && caught.code === 'NIN_DETAILS_INVALID') {
    return { outcome: 'details', text: NIN_DETAILS_CHECK, heldUntil: null }
  }
  return null
}

/** True once a NIN check has been waiting NIN_STILL_CHECKING_AFTER_MS; false again when it ends. */
export function useStillChecking(checking: boolean): boolean {
  const [still, setStill] = useState(false)
  useEffect(() => {
    if (!checking) { setStill(false); return }
    const timer = setTimeout(() => setStill(true), NIN_STILL_CHECKING_AFTER_MS)
    return () => clearTimeout(timer)
  }, [checking])
  return still
}

/**
 * A NIN on hold: `held` is true until the time Identity named, and the screen keeps its button off meanwhile. `hold`
 * takes that time (or null, to end the hold).
 */
export function useNinHold(): { readonly held: boolean; readonly hold: (until: number | null) => void } {
  const [until, setUntil] = useState<number | null>(null)
  useEffect(() => {
    if (until === null) return
    const timer = setTimeout(() => setUntil(null), Math.max(0, until - Date.now()))
    return () => clearTimeout(timer)
  }, [until])
  return { held: until !== null, hold: setUntil }
}
