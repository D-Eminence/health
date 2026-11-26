import { formatTimeOrDateTime } from '@hid/ui/display'
import type { ClinicalRecord } from '../../../../staff/api'
import type { OrderKind } from './orders'
import { readOrderRoute } from './words'

/**
 * Where a prescription or lab request is in this facility's own pharmacy or laboratory: the `ownProgress` the EHR's
 * prescription and lab request reads carry (live contract, "ORD-3. Own pharmacy and laboratory progress on
 * prescriptions and lab requests"), in that section's screen words: "Received 10:40", "Dispensed 11:05", "Sample taken
 * 09:30", "Results ready 11:05", and "Progress not available right now" for `unknown`.
 *
 * Read defensively, so the list never fails because of it. A backend before ORD-3 sends no `ownProgress`: nothing is
 * shown, as today. A value this page does not understand (not an object, a status it does not know, or one of the
 * other kind's) is said as `unknown` is, since ehr-api itself answers `unknown` for anything unexpected. A time that is
 * missing or not a date leaves the words without a time. `ownProgress` names no pharmacist or laboratory member, so
 * these words never do.
 */

/** ORD-3's `unknown`: the pharmacy or laboratory could not be asked, or answered something unexpected. */
export const PROGRESS_UNAVAILABLE = 'Progress not available right now'

/**
 * ORD-3 `withdrawn` (0133): sent by itself, then held, cancelled, entered in error, edited or resumed before it was
 * dispensed. Said in the pharmacy's own reason words for it (health#308's `changed`, under its "Not dispensable"
 * status; the coordinator's 23 Nov design call), so the prescriber and the pharmacy read the same words.
 * `withdrawn` and `sent_elsewhere` are in the backend's contract at the live commit (hid-system 4c843270) but not yet
 * in this repo's copy (docs/backend-contract, copied at 092cd248, before 0133); the coordinator's next refresh of the
 * copy brings them.
 */
export const PHARMACY_WITHDRAWN = 'Changed or stopped by the prescribing team'

/**
 * ORD-3 `sent_elsewhere` (0133, Q121 A; in the live contract at 4c843270, see above) when the prescription carries no
 * route naming where it went: the pharmacy's reason words for it (health#308's `sent_elsewhere`). With a route, the
 * same words name the facility ("Sent to Demo Pharmacy by the prescribing team").
 */
export const SENT_ELSEWHERE = 'Sent to another pharmacy by the prescribing team'

/**
 * The pharmacy statuses ORD-3 names, with `accepted` from ORD-4 (planned contract, Release B): a backend that sends
 * it is not an error here, though ehr-api at Release A answers no such status.
 */
const PHARMACY_STATUSES: ReadonlySet<string> = new Set([
  'not_received', 'received', 'accepted', 'dispensed', 'dispensing_reversed', 'withdrawn', 'sent_elsewhere', 'unknown',
])
const LAB_STATUSES: ReadonlySet<string> = new Set([
  'not_received', 'received', 'sample_collected', 'some_results_ready', 'results_ready', 'unknown',
])

/** "11:05" today in Lagos, else "21 Nov 2026, 11:05", so an order read days later is not taken for today's; '' for no time. */
export function progressTime(value: unknown, now: Date = new Date()): string {
  return typeof value === 'string' ? formatTimeOrDateTime(value, now) : ''
}

/** "Dispensed 11:05", or "Dispensed" when the time is missing or not a date. */
function at(words: string, value: unknown, now: Date): string {
  const time = progressTime(value, now)
  return time ? `${words} ${time}` : words
}

/**
 * The words for an order's `ownProgress`, or null when there is nothing to say: no `ownProgress` (a backend before
 * ORD-3), or `not_received` (a draft, never sent; or an order with no work here, whose progress is on its route).
 */
export function ownProgressText(kind: OrderKind, record: ClinicalRecord, now: Date = new Date()): string | null {
  return ownProgressWords(kind, { ownProgress: record.ownProgress, orderRoute: record.orderRoute }, now)
}

/**
 * The same words from an order's `ownProgress` and `orderRoute` alone, as any read carries them: the visit's order
 * lists, and "Ordered by me" (MY-1), whose rows carry ORD-3's `ownProgress` in the same shape.
 */
export function ownProgressWords(kind: OrderKind, record: { readonly ownProgress?: unknown; readonly orderRoute?: unknown },
  now: Date = new Date()): string | null {
  const progress = record.ownProgress
  if (progress === undefined || progress === null) return null
  if (typeof progress !== 'object' || Array.isArray(progress)) return PROGRESS_UNAVAILABLE
  const value = progress as Record<string, unknown>
  const status = typeof value.status === 'string' ? value.status : ''
  if (!(kind === 'pharmacy' ? PHARMACY_STATUSES : LAB_STATUSES).has(status)) return PROGRESS_UNAVAILABLE
  if (status === 'not_received') return null
  if (status === 'unknown') return PROGRESS_UNAVAILABLE
  if (status === 'received') return at('Received', value.receivedAt, now)
  if (kind === 'pharmacy') {
    switch (status) {
      // ORD-4 (planned): "Accepted 10:52" only with its time. Without one this is the pharmacy having it, as before
      // ORD-4, and "Accepted" is never said for it (ORD-4 screen notes, "Before this ships").
      case 'accepted': return progressTime(value.acceptedAt, now) ? at('Accepted', value.acceptedAt, now) : at('Received', value.receivedAt, now)
      case 'dispensed': return at('Dispensed', value.dispensedAt, now)
      case 'dispensing_reversed': return at('Dispensing reversed', value.reversedAt, now)
      case 'withdrawn': return PHARMACY_WITHDRAWN
      default: {
        // sent_elsewhere: where it went is the prescription's own route, when it carries one.
        const facility = readOrderRoute(record.orderRoute)?.receivingFacility.name?.trim()
        return facility ? `Sent to ${facility} by the prescribing team` : SENT_ELSEWHERE
      }
    }
  }
  switch (status) {
    case 'sample_collected': return at('Sample taken', value.collectedAt, now)
    case 'some_results_ready': return at('Some results ready', value.lastResultAt, now)
    default: return at('Results ready', value.lastResultAt, now)
  }
}

/** The progress as a history row's line under its label (Detail.tsx HistoryItem `detail`), or none. */
export function progressDetail(kind: OrderKind, record: ClinicalRecord): readonly string[] | undefined {
  const progress = ownProgressText(kind, record)
  return progress ? [progress] : undefined
}
