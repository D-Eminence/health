import { isHidApiError } from '@hid/http'
import { refusalText } from '../../../staff/fieldProblem'

/**
 * The refusal messages of today's Laboratory, Pharmacy, Migrate and Outreach
 * pages (staff/routes/Operations.tsx), word for word: the blue pages call the
 * same staff API and must say the same thing when it refuses.
 */

/**
 * OCR's answer when EHR, Lab or Pharmacy refused OCR's own workload identity: a
 * fault between services, not a refusal of the user. Its detail is technical, so it
 * is said plainly.
 */
export const SERVICE_AUTH_UNAVAILABLE: ReadonlySet<string> = new Set(['EHR_SERVICE_AUTH_UNAVAILABLE', 'LAB_SERVICE_AUTH_UNAVAILABLE', 'PHARMACY_SERVICE_AUTH_UNAVAILABLE'])

/** The gateway's answer for every route of a module that is off (404 API_ROUTE_NOT_FOUND). */
export const MODULE_NOT_IN_SERVICE = 'This workspace is not in service on this Health ID deployment: its work cannot be loaded or changed here, and refreshing will not help.'

/** A Lab write on work from an order another facility sent, once that order no longer lets this laboratory record. */
export const ROUTED_WRITE_CLOSED = 'This order from another facility no longer lets you record on it: it has ended, or its time for work is over. You can still read what was recorded. Refresh the list.'
const LAB_NOT_FOUND_FOR_WRITING = /^LAB_[A-Z_]+_NOT_FOUND$/

/**
 * A refusal's message, with each field a 400 VALIDATION_FAILED names. `routed`: a Lab
 * write on work from an order another facility sent, whose 404 for writing means the
 * order closed.
 */
export function errorText(error: unknown, fallback: string, routed = false) {
  if (isHidApiError(error) && SERVICE_AUTH_UNAVAILABLE.has(error.code)) return 'A connection between Health ID services failed; retry in about 15 seconds.'
  if (isHidApiError(error) && error.status === 404 && error.code === 'API_ROUTE_NOT_FOUND') return MODULE_NOT_IN_SERVICE
  if (isHidApiError(error) && error.code === 'ORDER_ROUTE_CLOSED') return 'This order from another facility is closed: it was cancelled, or its time for work has ended, so nothing more can be recorded on it. Refresh the list.'
  if (routed && isHidApiError(error) && error.status === 404 && LAB_NOT_FOUND_FOR_WRITING.test(error.code)) return ROUTED_WRITE_CLOSED
  if (isHidApiError(error) && error.status === 423 && error.code === 'CROSS_FACILITY_ORDERS_UNAVAILABLE') return 'Health ID has paused work on orders from other facilities. Try again later.'
  return refusalText(error, fallback)
}
