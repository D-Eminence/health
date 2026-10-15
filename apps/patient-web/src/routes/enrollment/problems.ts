import { isHidApiError } from '@hid/http'

/** Whether `reason` is Identity's refusal with this status and one of these codes. */
export function refusedWith(reason: unknown, status: number, ...codes: string[]) {
  return isHidApiError(reason) && reason.status === status && codes.includes(reason.code)
}

/**
 * A start refused because registration is closed: no route to prove the NIN
 * holder is on (`PATIENT_REGISTRATION_NOT_OPEN`, hid-system #84, ADR-062), or
 * the QoreID gate is shut (hid-system#68). Each carries the not-open detail;
 * the page shows its closed notice, as an availability read would now say.
 */
export const registrationClosed = (reason: unknown) =>
  refusedWith(reason, 503, 'PATIENT_REGISTRATION_NOT_OPEN', 'QOREID_DISABLED', 'QOREID_NIN_ONLY_DISABLED')

/**
 * An outage, a timeout or a lost connection: the step may be tried again as it
 * is. It never signs anyone out (ADR-059): nothing here calls sign-out or
 * leaves the page. Identity's other 5xx carry a generic detail, so the page
 * keys its own text on the code (INTERFACE_CONTRACT.md, "The NIN holder step").
 */
export function temporarilyUnavailable(reason: unknown) {
  if (!isHidApiError(reason)) return true
  return reason.status === 0 || reason.status === 408 || reason.status >= 500
    || reason.code === 'NETWORK_ERROR' || reason.code === 'REQUEST_TIMEOUT'
}

/** Identity's own text for a NIN lookup that could not be completed (ADR-062), also said for any start outage. */
export const NIN_CHECK_UNAVAILABLE = 'We could not check your NIN now. Try again later.'
/** Any other step's outage: the step is kept. */
export const STEP_UNAVAILABLE = 'Registration is temporarily unavailable. Try again in a few minutes.'
