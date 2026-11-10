import { isHidApiError } from '@hid/http'
import type { Chart } from '../../parts/chart'

/*
 * "Discussed with the patient" (owner Q24, 4 Nov): a doctor or clinician with write access marks a released sensitive
 * or critical lab result as discussed, so the patient's chat may then use it, or withdraws that mark with a reason.
 * Session B's server is hid-system #177 (lab-api, migration 0107, draft); the shapes below are read from its code
 * (result-discussions.service.ts, dto/result-discussion.dto.ts):
 *   - GET  /api/v1/lab/patients/:patientId/result-discussions: the patient's gated results, each at its last released
 *     version, with the latest mark on that version (`discussion`);
 *   - POST .../results/:resultId/discussion, body { resultVersion }, with an Idempotency-Key;
 *   - POST .../results/:resultId/discussion/withdrawal, body { resultVersion, reasonCode, reason }, with an
 *     Idempotency-Key.
 * A mark covers one result version: a corrected result released again is held again until it is discussed.
 * Until a backend serves the routes (a 404), or for a member who may not read them (403), nothing at all is shown.
 */

/** The permission to mark or withdraw (doctor and clinician, hid-system 0107). */
export const DISCUSSED_PERMISSION = 'lab.result.discuss'

/** Why a mark is withdrawn (lab-api WITHDRAWAL_REASON_CODES), each in plain words. */
export const WITHDRAWAL_REASONS = [
  { code: 'marked_in_error', words: 'Marked by mistake' },
  { code: 'not_yet_discussed', words: 'Not discussed with the patient yet' },
  { code: 'wrong_patient', words: 'Marked for the wrong patient' },
  { code: 'other', words: 'Another reason' },
] as const
export type WithdrawalReasonCode = (typeof WITHDRAWAL_REASONS)[number]['code']

/** A withdrawal reason code in plain words; an unknown code is said as "Another reason". */
export function reasonWords(code: string | null | undefined): string {
  return WITHDRAWAL_REASONS.find(reason => reason.code === code)?.words ?? 'Another reason'
}

/** The reason's length the server takes, trimmed (lab-api WithdrawResultDiscussionDto). */
export const WITHDRAW_REASON_MIN = 8
export const WITHDRAW_REASON_MAX = 500

/** The latest mark on the result's last released version. */
export interface Discussion {
  readonly state: 'discussed' | 'withdrawn'
  readonly eventNo: number
  readonly at: string
  readonly byMembershipId: string
  /** Only for a withdrawal. */
  readonly reasonCode: string | null
}

/** One gated result of the list (lab-api ResultDiscussionItem). */
export interface DiscussionItem {
  readonly resultId: string
  readonly resultVersion: number
  readonly gate: { readonly sensitive: boolean; readonly critical: boolean }
  readonly finishedVisit: boolean
  readonly discussion: Discussion | null
  readonly visibleToPatient: boolean
}

export interface DiscussionList {
  readonly results: ReadonlyMap<string, DiscussionItem>
  readonly truncated: boolean
}

/** The answer to a mark or a withdrawal. */
export interface DiscussionAnswer {
  readonly resultId: string
  readonly resultVersion: number
  readonly state: 'discussed' | 'withdrawn'
  readonly eventNo: number
  readonly at: string
  readonly visibleToPatient: boolean
}

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

function readDiscussion(value: unknown): Discussion | null | undefined {
  if (value === null) return null
  if (!isObject(value)) return undefined
  const { state, eventNo, at, byMembershipId, reasonCode } = value
  if ((state !== 'discussed' && state !== 'withdrawn') || typeof eventNo !== 'number' || !isText(at) || !isText(byMembershipId)) return undefined
  return { state, eventNo, at, byMembershipId, reasonCode: state === 'withdrawn' && isText(reasonCode) ? reasonCode : null }
}

function readItem(value: unknown): DiscussionItem | null {
  if (!isObject(value) || !isText(value.resultId) || !isVersion(value.resultVersion) || !isObject(value.gate)) return null
  const { sensitive, critical } = value.gate
  if (typeof sensitive !== 'boolean' || typeof critical !== 'boolean') return null
  if (typeof value.finishedVisit !== 'boolean' || typeof value.visibleToPatient !== 'boolean') return null
  const discussion = readDiscussion(value.discussion)
  if (discussion === undefined) return null
  return { resultId: value.resultId, resultVersion: value.resultVersion, gate: { sensitive, critical }, finishedVisit: value.finishedVisit,
    discussion, visibleToPatient: value.visibleToPatient }
}

/** The list's answer; null when it is not that shape (nothing is then shown). A malformed row is left out. */
export function readDiscussionList(value: unknown): DiscussionList | null {
  if (!isObject(value) || !Array.isArray(value.results)) return null
  const results = new Map<string, DiscussionItem>()
  for (const row of value.results) {
    const item = readItem(row)
    if (item) results.set(item.resultId, item)
  }
  return { results, truncated: value.truncated === true }
}

/** A mark's or a withdrawal's answer; null when it is not that shape (the results are then read again). */
export function readDiscussionAnswer(value: unknown): DiscussionAnswer | null {
  if (!isObject(value) || !isText(value.resultId) || !isVersion(value.resultVersion) || typeof value.eventNo !== 'number'
    || typeof value.visibleToPatient !== 'boolean') return null
  if (value.state === 'discussed' && isText(value.discussedAt)) {
    return { resultId: value.resultId, resultVersion: value.resultVersion, state: 'discussed', eventNo: value.eventNo, at: value.discussedAt,
      visibleToPatient: value.visibleToPatient }
  }
  if (value.state === 'withdrawn' && isText(value.withdrawnAt)) {
    return { resultId: value.resultId, resultVersion: value.resultVersion, state: 'withdrawn', eventNo: value.eventNo, at: value.withdrawnAt,
      visibleToPatient: value.visibleToPatient }
  }
  return null
}

/** The list item after an answer: the new mark on the same version (withdrawn: with the reason code given). */
export function afterAnswer(item: DiscussionItem, answer: DiscussionAnswer, reasonCode: string | null): DiscussionItem {
  // The answer names no member; the list read next names the one who made the change.
  return { ...item, visibleToPatient: answer.visibleToPatient,
    discussion: { state: answer.state, eventNo: answer.eventNo, at: answer.at, byMembershipId: '', reasonCode: answer.state === 'withdrawn' ? reasonCode : null } }
}

/** Held back from the patient's chat: a sensitive or critical result the patient does not see. */
export function isHeld(item: DiscussionItem): boolean {
  return (item.gate.sensitive || item.gate.critical) && !item.visibleToPatient
}

/**
 * Only a member who may mark or withdraw sees any of this: direct care (never emergency access), write access to the
 * patient (never read-only), and lab.result.discuss.
 */
export function mayMarkDiscussed(chart: Chart | undefined): boolean {
  return !!chart && chart.purpose === 'direct-care' && chart.canWrite && chart.can(DISCUSSED_PERMISSION)
}

export const DISCUSSED_WORDS = {
  mark: 'Discussed with the patient',
  markBody: 'The patient\'s chat can then use this result.',
  markFailed: 'The result could not be marked as discussed. Try again.',
  withdraw: 'Withdraw',
  withdrawConfirm: 'Withdraw the mark',
  withdrawBody: 'The patient\'s chat will leave this result out again.',
  withdrawFailed: 'The mark could not be withdrawn. Try again.',
  reasonCode: 'Why are you withdrawing it?',
  reasonCodeMissing: 'Choose why you are withdrawing the mark.',
  choose: 'Choose a reason',
  reason: 'Reason for withdrawing',
  reasonShort: `Give a reason of at least ${WITHDRAW_REASON_MIN} characters.`,
  reasonLong: `Keep the reason to ${WITHDRAW_REASON_MAX} characters or fewer.`,
  discussedOn: (date: string) => date ? `Discussed with the patient on ${date}` : 'Discussed with the patient',
  visitOpen: 'The patient\'s chat will use it once the visit is finished.',
  withdrawnOn: (date: string, code: string | null) => `Mark withdrawn${date ? ` on ${date}` : ''}: ${reasonWords(code).toLowerCase()}.`,
} as const

/** A refused mark or withdrawal in plain words: never the server's own text or code. */
export function discussedProblem(caught: unknown, fallback: string): string {
  if (!isHidApiError(caught)) return fallback
  if (caught.status === 403) {
    return caught.code === 'PATIENT_ACCESS_DENIED'
      ? 'Your access to this patient does not let you change this. Open the patient again, or ask for write access.'
      : 'You do not have permission to mark results as discussed with the patient.'
  }
  if (caught.status === 409) {
    switch (caught.code) {
      case 'RESULT_VERSION_CHANGED': return 'This result has a newer version. Refresh the results and check it before you try again.'
      case 'RESULT_NOT_RELEASED': return 'This version of the result is not released. Refresh the results.'
      case 'RESULT_ENTERED_IN_ERROR': return 'This result was entered in error. Do not use it.'
      case 'RESULT_NOT_DISCUSSED': return 'This result is no longer marked as discussed. Refresh the results.'
      case 'RESULT_DISCUSSION_CHANGED': return 'The mark on this result was changed since this page was read. Refresh the results.'
      default: return 'This could not be saved because the result changed. Refresh the results and try again.'
    }
  }
  if (caught.status === 404) return 'This result could not be found. Refresh the results.'
  return fallback
}
