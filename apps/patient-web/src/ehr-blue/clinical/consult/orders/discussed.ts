import type { Chart } from '../../parts/chart'

/*
 * "Discussed with the patient" (owner Q24, 4 Nov): a clinician with care access marks a released lab result as
 * discussed, so the patient's chat may then use it, or withdraws that mark with a reason. Both are audited by the
 * server (hid-system migration 0121, Session B).
 *
 * AWAITING SESSION B'S API. Every field name, permission and call below is assumed: they are kept in this one file so
 * the screen can be wired to B's real API with one small change here. Until then:
 *   - a result without `patientChat` (every backend today) shows nothing: no button, no text;
 *   - DISCUSSED_CALLS is null, so no button is offered even if a result carries the field; nothing is sent.
 */

/** Assumed: the field on each released result (LabResult) that says whether the patient chat holds it back. */
const FIELD = 'patientChat'
/** Assumed: `patientChat.held`, true while the patient chat leaves this result out. */
const HELD = 'held'
/** Assumed: `patientChat.discussed.at`, when a clinician marked it discussed with the patient; absent until then. */
const DISCUSSED = 'discussed'
const AT = 'at'

/** Assumed: the permission a care-access clinician holds to mark or withdraw (today's lab request write). */
export const DISCUSSED_PERMISSION = 'ehr.lab-request.write'

/** What the screen needs to know about one result's place in the patient chat. */
export interface PatientChatHold {
  /** The patient chat leaves this result out until it is discussed. */
  readonly held: boolean
  /** When it was marked discussed with the patient; null while not marked. */
  readonly discussedAt: string | null
}

/** One result's hold, read from any object carrying the assumed field; null when the field is absent or malformed. */
export function readHold(value: unknown): PatientChatHold | null {
  if (typeof value !== 'object' || value === null) return null
  const hold = (value as Record<string, unknown>)[FIELD]
  if (typeof hold !== 'object' || hold === null) return null
  const held = (hold as Record<string, unknown>)[HELD]
  if (typeof held !== 'boolean') return null
  const discussed = (hold as Record<string, unknown>)[DISCUSSED]
  const at = typeof discussed === 'object' && discussed !== null ? (discussed as Record<string, unknown>)[AT] : undefined
  return { held, discussedAt: typeof at === 'string' && at ? at : null }
}

/** Assumed calls: mark and withdraw, each answering with the result's new hold (read with readHold). */
export interface DiscussedCalls {
  mark(facilityId: string, requestId: string, resultId: string): Promise<unknown>
  withdraw(facilityId: string, requestId: string, resultId: string, reason: string): Promise<unknown>
}

/**
 * The calls, once Session B's API lands: two staffApi methods on the staff client (staff/api.ts, whose client is
 * private to it and whose endpoints the browser boundary must register), set here. Null today: no button is offered.
 */
const DISCUSSED_CALLS: DiscussedCalls | null = null

export function discussedCalls(): DiscussedCalls | null {
  return DISCUSSED_CALLS
}

/** Only a clinician with care access may mark or withdraw: direct care, write access, and the permission. */
export function mayMarkDiscussed(chart: Chart | undefined): boolean {
  return !!chart && chart.purpose === 'direct-care' && chart.canWrite && chart.can(DISCUSSED_PERMISSION)
}

/** The shortest reason a withdrawal takes. */
export const WITHDRAW_REASON_MIN = 3

export const DISCUSSED_WORDS = {
  mark: 'Discussed with the patient',
  markBody: 'The patient\'s chat can then use this result.',
  markFailed: 'The result could not be marked as discussed. Try again.',
  withdraw: 'Withdraw',
  withdrawConfirm: 'Withdraw the mark',
  withdrawBody: 'The patient\'s chat will leave this result out again.',
  withdrawFailed: 'The mark could not be withdrawn. Try again.',
  reason: 'Reason for withdrawing',
  reasonShort: `Give a reason of at least ${WITHDRAW_REASON_MIN} characters.`,
  discussedOn: (date: string) => date ? `Discussed with the patient on ${date}` : 'Discussed with the patient',
} as const
