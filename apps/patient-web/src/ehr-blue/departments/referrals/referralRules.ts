import { useSyncExternalStore } from 'react'
import { isHidApiError } from '@hid/http'
import { formatDate, formatDateTime } from '@hid/ui/display'
import type { EhrBadgeTone } from '@hid/ui/ehr'
import type {
  ReferralCard, ReferralDeclineReason, ReferralEffectiveState, ReferralHistoryEntry, ReferralOutcome, ReferralPackageKind,
  ReferralWithdrawReason,
} from '../../../staff/api'
import { DEPARTMENTS } from '../../collected/facilityProfile'

/*
 * Referrals between facilities (hid-system REF-1, migrations 0191-0193; INTERFACE_CONTRACT.md "REF-1") in plain words:
 * who may do what, what each state, reason and outcome is called, the limits the server checks, the Lagos date and time
 * of every step whatever the device's zone (@hid/ui/display), and what each refusal says (the planned contract's
 * messages, never the word for an access code). The backend decides every request; these only choose what the pages
 * offer.
 *
 * Built at the owner's answers Q261-Q266 A (25 Nov 2026) and at the recommended option of Q-REF-7 to Q-REF-15 (not yet
 * answered by the owner). Clinical lists here (decline reasons, outcomes, urgency) are drafts awaiting the clinical
 * lead's sign-off (Q124 A).
 */

export const TITLE = 'Referrals'
export const EYEBROW = 'Between facilities'
export const DESCRIPTION = 'Referrals this facility sent, and those other facilities sent here: answer them, mark patients arrived and record the outcome.'
export const BASE = '/provider/referrals'

/** The four codes of 0193, and 0135's pair that arrival also needs. */
export const REFERRAL_READ = 'ehr.referral.read'
export const REFERRAL_SEND = 'ehr.referral.send'
export const REFERRAL_RECEIVE = 'ehr.referral.receive'
export const REFERRAL_ARRIVE = 'ehr.referral.arrive'
export const REFERRAL_CODES = [REFERRAL_READ, REFERRAL_SEND, REFERRAL_RECEIVE, REFERRAL_ARRIVE] as const
export const ENCOUNTER_READ = 'ehr.encounter.read'
export const ENCOUNTER_WRITE = 'ehr.encounter.write'
/** Staff patient search (0132): the fresh search arrival needs (Q-REF-9 A). */
export const PATIENT_SEARCH = 'identity.registration.write'

export const canRead = (permissions: readonly string[]) => permissions.includes(REFERRAL_READ)
export const canSend = (permissions: readonly string[]) => permissions.includes(REFERRAL_SEND) && permissions.includes(ENCOUNTER_WRITE)
export const canReceive = (permissions: readonly string[]) => permissions.includes(REFERRAL_RECEIVE)
export const canArrive = (permissions: readonly string[]) =>
  permissions.includes(REFERRAL_ARRIVE) && permissions.includes(ENCOUNTER_READ) && permissions.includes(ENCOUNTER_WRITE)
export const canSearch = (permissions: readonly string[]) => permissions.includes(PATIENT_SEARCH)
/** Whether the page has anything for this member: any one of the four codes. */
export const usesReferrals = (permissions: readonly string[]) => REFERRAL_CODES.some(code => permissions.includes(code))

export const PAGE_REFUSED = 'Only the front desk, clinicians and doctors of this facility can use referrals.'
export const REFERRAL_REFUSED = 'Only doctors and clinicians can send, answer or read referrals.'
export const ARRIVE_REFUSED = 'Only the front desk, clinicians and doctors of this facility can mark a referred patient as arrived.'
export const NOT_AVAILABLE = 'Referrals are not available yet.'
export const NOT_AVAILABLE_MORE = 'Health ID will turn referrals on for your facility once they are ready. Until then, keep using your paper referral letters.'
export const CONTROL_OFF = 'Referrals between facilities on Health ID are switched off for now. You can print a referral letter instead.'

/** Each state as staff read it. `expired` and the visit entered in error are worked out by the server when read. */
export function stateText(card: Pick<ReferralCard, 'effectiveState' | 'endedKind' | 'withdrawal' | 'side'>): string {
  const state = card.effectiveState
  if (state === 'expired') return card.endedKind === 'not_arrived' ? 'Did not arrive in time' : 'Not answered in time'
  if (state === 'withdrawn') {
    if (card.endedKind === 'visit_entered_in_error') return 'Withdrawn: the visit was entered in error'
    return card.withdrawal?.by === 'patient' ? 'Withdrawn by the patient' : 'Withdrawn'
  }
  return STATE_WORDS[state] ?? 'Status not known'
}

const STATE_WORDS: Readonly<Partial<Record<ReferralEffectiveState, string>>> = {
  printed: 'Printed, outside Health ID',
  sent: 'Waiting for an answer',
  accepted: 'Accepted',
  arrived: 'Arrived',
  completed: 'Completed',
  declined: 'Declined',
}

export function stateTone(state: ReferralEffectiveState | string): EhrBadgeTone {
  switch (state) {
    case 'sent': return 'brand'
    case 'accepted': case 'arrived': case 'completed': return 'positive'
    case 'declined': case 'expired': return 'caution'
    default: return 'neutral'
  }
}

export const URGENCY_WORDS: Readonly<Record<'routine' | 'urgent', string>> = { routine: 'Routine', urgent: 'Urgent' }
export function urgencyText(urgency: string): string {
  return urgency === 'urgent' ? 'Urgent' : urgency === 'routine' ? 'Routine' : 'Urgency not known'
}
/** Urgent referrals use the critical tone; no timers until the clinical lead names targets. */
export function urgencyTone(urgency: string): EhrBadgeTone {
  return urgency === 'urgent' ? 'critical' : 'neutral'
}

/** The draft decline reasons, for the clinical lead's sign-off. */
export const DECLINE_REASON_WORDS: Readonly<Record<ReferralDeclineReason, string>> = {
  service_not_offered: 'We do not offer this service',
  no_capacity: 'No capacity now',
  more_information_needed: 'More information needed',
  better_elsewhere: 'Better seen elsewhere',
  other: 'Another reason',
}
export const WITHDRAW_REASON_WORDS: Readonly<Record<ReferralWithdrawReason, string>> = {
  patient_changed_mind: 'The patient changed their mind',
  no_longer_needed: 'No longer needed',
  sent_in_error: 'Sent in error',
  other: 'Another reason',
}
/** A withdraw reason that needs a note of at least 8 characters. */
export const WITHDRAW_NEEDS_NOTE: ReadonlySet<ReferralWithdrawReason> = new Set(['sent_in_error', 'other'])

/** The draft outcomes, for the clinical lead's sign-off. `here`: as the receiving facility words it. */
export function outcomeText(code: string, here: boolean): string {
  switch (code as ReferralOutcome) {
    case 'seen_care_returned': return here ? 'Seen; care goes back to the referring clinician' : 'Seen; care comes back to you'
    case 'seen_care_continues': return here ? 'Seen; care continues here' : 'Seen; care continues at the receiving facility'
    case 'admitted': return 'Admitted'
    case 'referred_onward': return 'Referred on to another facility'
    case 'did_not_attend': return 'Did not attend'
    default: return 'Outcome not known'
  }
}
export const SEEN_OUTCOMES: readonly ReferralOutcome[] = ['seen_care_returned', 'seen_care_continues', 'admitted', 'referred_onward']

export function declineReasonText(code: string): string {
  return Object.hasOwn(DECLINE_REASON_WORDS, code) ? DECLINE_REASON_WORDS[code as ReferralDeclineReason] : 'Another reason'
}
export function withdrawReasonText(code: string | null): string {
  return code && Object.hasOwn(WITHDRAW_REASON_WORDS, code) ? WITHDRAW_REASON_WORDS[code as ReferralWithdrawReason] : ''
}

export const PACKAGE_KIND_WORDS: Readonly<Record<ReferralPackageKind, string>> = {
  diagnoses: 'Current diagnoses',
  medicines: 'Current medicines',
  allergies: 'Allergies',
  vitals: 'Vital signs (last 30 days)',
  labResults: 'Released lab results',
}
export function packageKindText(kind: string): string {
  return Object.hasOwn(PACKAGE_KIND_WORDS, kind) ? PACKAGE_KIND_WORDS[kind as ReferralPackageKind] : 'Other details'
}
/** "Current diagnoses (2), Current medicines (3)"; '' when nothing was sent. */
export function packageSummaryText(summary: ReferralCard['packageSummary']): string {
  return (summary ?? []).filter(entry => entry.count > 0).map(entry => `${packageKindText(entry.kind)} (${entry.count})`).join(', ')
}

/** At most this many of each kind go in a package (the server's limits, drafts for the clinical lead). */
export const PACKAGE_LIMITS: Readonly<Record<ReferralPackageKind, number>> = { diagnoses: 30, medicines: 30, allergies: 30, vitals: 10, labResults: 20 }

/** The lengths the server checks (planned contract route 2, 4, 11, 12, 15). */
export const LIMITS = {
  reason: [8, 300], letter: [20, 8000], service: [2, 120], printedName: [2, 120], town: [0, 120],
  note: [8, 500], acceptNote: [0, 500], feedback: [8, 2000],
} as const

/** A department code in the facility profile's words (contract section 43.6); one it does not know, in plain words. */
export function departmentText(code: string | null | undefined): string {
  if (!code) return 'Department not known'
  const known = DEPARTMENTS.find(([value]) => value === code)
  if (known) return known[1]
  const words = code.replaceAll('_', ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Department not known'
}

/** Where a referral went: the receiving facility, or the printed letter's facility and town. */
export function destinationText(card: Pick<ReferralCard, 'destinationKind' | 'receivingFacility' | 'printedFacility'>): string {
  if (card.destinationKind === 'printed') {
    const printed = card.printedFacility
    if (!printed) return 'A facility outside Health ID'
    return printed.town ? `${printed.name}, ${printed.town}` : printed.name
  }
  return card.receivingFacility?.name ?? 'Another facility'
}

/** The other facility, from this facility's side of the referral. */
export function otherFacilityText(card: ReferralCard): string {
  return card.side === 'sent' ? destinationText(card) : card.referringFacility.name
}

/** "18 Nov 2026, 14:05" in Lagos; `fallback` when there is none. */
export function whenText(value: string | null | undefined, fallback = ''): string {
  return formatDateTime(value, fallback)
}
/** "18 Nov 2026": a date of birth, or the day by which something is due. */
export function dayText(value: string | null | undefined, fallback = ''): string {
  return formatDate(value, fallback)
}

export function sexText(sex: string | null | undefined): string {
  if (!sex) return ''
  const word = sex.replaceAll('_', ' ').toLowerCase()
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** What the receiver sees of the patient before accepting (Q-REF-8 A): "Female, 47 years". Never a name. */
export function previewPatientText(patient: ReferralCard['patient']): string {
  if (!patient) return ''
  const age = patient.ageYearsAtSend
  return [sexText(patient.sexAtSend), typeof age === 'number' ? (age === 1 ? '1 year' : `${age} years`) : ''].filter(Boolean).join(', ')
}

/** A whole Health ID is never shown: the last 4 characters, as the card gives them. */
export function healthIdEnding(last4: string | null | undefined): string {
  return last4 ? `•••• ${last4}` : ''
}

/** The date of birth as the card says it: an estimate (0145, an unknown patient's age) says so. */
export function bornText(dateOfBirth: string | null | undefined, estimated: boolean | null | undefined): string {
  const born = dayText(dateOfBirth)
  if (!born) return ''
  return estimated ? `Born about ${born} (estimated)` : `Born ${born}`
}

/** The referrer as frozen at sending: name, and the MDCN licence or "Licence not on record". */
export function referrerText(referrer: ReferralCard['referrer']): string {
  const licence = referrer.licence ? `${referrer.licence.body} ${referrer.licence.number}` : 'Licence not on record'
  return `${referrer.name} (${licence})`
}

/** One history line as staff read it; who did it comes from the staff names list, never an id. */
export function historyText(entry: ReferralHistoryEntry): string {
  switch (entry.kind) {
    case 'sent': return 'Sent'
    case 'printed': return 'Letter printed (outside Health ID)'
    case 'withdrawn': {
      const reason = withdrawReasonText(entry.reasonCode)
      return reason ? `Withdrawn by the referring facility: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : 'Withdrawn by the referring facility'
    }
    case 'patient_withdrew': return 'Withdrawn by the patient'
    case 'accepted': return 'Accepted'
    case 'declined': return entry.reasonCode ? `Declined: ${declineReasonText(entry.reasonCode).toLowerCase()}` : 'Declined'
    case 'arrived': return 'Patient arrived and checked in'
    case 'completed': return entry.reasonCode ? `Completed: ${outcomeText(entry.reasonCode, true).toLowerCase()}` : 'Completed'
    default: return 'Changed'
  }
}

/** Who did a step: "You", a colleague's name from the staff names list, or the side when another facility did it. */
export function historyWho(entry: ReferralHistoryEntry, names: ReadonlyMap<string, string | null>, me: string | undefined, card: ReferralCard): string {
  if (entry.side === 'patient') return 'The patient'
  const ours = (entry.side === 'referring') === (card.side === 'sent')
  if (!ours) return entry.side === 'referring' ? card.referringFacility.name : destinationText(card)
  if (!entry.byMembershipId) return 'This facility'
  if (me && entry.byMembershipId.toLowerCase() === me.toLowerCase()) return 'You'
  const name = names.get(entry.byMembershipId.toLowerCase())
  return name ?? (name === null ? 'Former staff member' : 'A staff member here')
}

/** Fills the agreement text's placeholders with the names on screen. Nothing else in the text is changed. */
export function fillAttestation(text: string, names: { patient: string; referringFacility: string; receivingFacility: string }): string {
  return text.replaceAll('{patient}', names.patient).replaceAll('{referringFacility}', names.referringFacility)
    .replaceAll('{receivingFacility}', names.receivingFacility)
}

/** Text the server would refuse for control characters (line breaks are allowed only where `lines`). */
export function hasControlCharacters(value: string, lines = false): boolean {
  // eslint-disable-next-line no-control-regex
  return (lines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)
}

/** Why a typed text can't be sent (the server's rule), or '' when it can. */
export function lengthProblem(value: string, [min, max]: readonly [number, number], label: string, lines = false): string {
  const length = value.trim().length
  if (length < min) return min <= 1 ? `Enter ${label}.` : `${label.charAt(0).toUpperCase()}${label.slice(1)} needs at least ${min} characters.`
  if (length > max) return `${label.charAt(0).toUpperCase()}${label.slice(1)} can be at most ${max} characters.`
  if (hasControlCharacters(value, lines)) return `${label.charAt(0).toUpperCase()}${label.slice(1)} has characters that can’t be sent. Type it again.`
  return ''
}

/** A referral's id as the address carries it: a UUID, never a Health ID. */
export const REFERRAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A fresh Idempotency-Key; the same key is sent again when the same body is retried. */
export function newKey(): string {
  return crypto.randomUUID()
}

// ---- What each refusal says -----------------------------------------------------
// The planned contract's messages, word for word (REF-1 "Errors"). Staff screens never show the word for an access code.

export const REFERRAL_REFUSALS: Readonly<Record<string, string>> = {
  VALIDATION_FAILED: 'Check the highlighted fields.',
  REFERRAL_DESTINATION_REQUIRED: 'Choose a facility on Health ID, or print a letter for a facility that is not on Health ID.',
  REFERRAL_PACKAGE_INVALID: 'Some of the details you ticked can no longer be sent. Reload the visit and tick them again.',
  REFERRAL_ATTESTATION_REQUIRED: 'Confirm that the patient agreed before sending.',
  REFERRAL_REASON_REQUIRED: 'Say why in at least 8 characters.',
  REFERRAL_OUTCOME_INVALID: 'Choose ‘Did not attend’ only before the patient arrives, and another outcome only after.',
  REFERRAL_ARRIVAL_NEEDS_ONE_PATIENT: 'Choose one patient: from a search result or from this facility’s patients.',
  REFERRAL_VISIT_INVALID: 'Choose a visit of this patient at this facility.',
  PURPOSE_OF_USE_REQUIRED: 'Referrals are for patient care only. Reload the page and try again.',
  IDEMPOTENCY_KEY_REQUIRED: 'Something went wrong sending this. Reload the page and try again.',
  REFERRAL_NOT_ALLOWED: REFERRAL_REFUSED,
  REFERRAL_ARRIVAL_NOT_ALLOWED: ARRIVE_REFUSED,
  REFERRAL_ARRIVAL_NEEDS_SEARCH: 'Search for the patient named on the referral, then mark them arrived. A search result can be used for 10 minutes.',
  CONSENT_REQUIRED: 'You need the patient’s approval or Access PIN to see their record here.',
  REFERRAL_NOT_FOUND: 'No such referral.',
  REFERRAL_VISIT_NOT_SIGNED: 'Sign the visit’s note first, then send the referral.',
  REFERRAL_PATIENT_NOT_IDENTIFIED: 'Identify the patient first (verify the NIN or merge the record), then refer them.',
  REFERRAL_PATIENT_APP_REQUIRED: 'This patient has no Health ID app account, so they could not see or withdraw the referral. Print a referral letter instead.',
  REFERRAL_PATIENT_DENIED: 'The patient has asked that their records are not shared with this facility.',
  REFERRAL_DESTINATION_UNAVAILABLE: 'This facility is not taking referrals on Health ID now. Choose another, or print a letter.',
  REFERRAL_DESTINATION_BUSY: 'This facility has too many referrals waiting for an answer. Try again later, or choose another.',
  REFERRAL_VISIT_LIMIT: 'This visit already has 5 referrals.',
  REFERRAL_ATTESTATION_OUTDATED: 'The agreement wording has changed. Read it again and confirm.',
  REFERRAL_NOT_PENDING: 'This referral was already answered or withdrawn. Reload it.',
  REFERRAL_EXPIRED: 'The time for this step has passed. The referring facility can send a new referral.',
  REFERRAL_NOT_ACCEPTED: 'This referral has not been accepted yet. Ask a doctor or clinician to accept it first.',
  REFERRAL_NOT_ARRIVED: 'Mark the patient as arrived first, or record ‘Did not attend’.',
  REFERRAL_CLOSED: 'This referral is closed.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with different details. Reload the page and try again.',
  REFERRAL_VERSION_CONFLICT: 'Someone else changed this referral. Reload it and try again.',
  CROSS_FACILITY_REFERRALS_UNAVAILABLE: CONTROL_OFF,
  REFERRAL_SEND_LIMITED: 'You have sent the most referrals allowed today. Try again tomorrow.',
  ORDER_DESTINATION_SEARCH_LIMITED: 'Too many searches: try again in an hour.',
  ORDER_DESTINATION_QUERY_INVALID: 'Type 3 to 80 letters of the facility’s name.',
  REFERRALS_NOT_AVAILABLE: NOT_AVAILABLE,
  INVALID_CURSOR: 'This list has changed. Load it again from the start.',
}

/** After these the referral on screen is out of date: it is read again. */
export const RELOAD_AFTER: ReadonlySet<string> = new Set(['REFERRAL_VERSION_CONFLICT', 'REFERRAL_NOT_PENDING', 'REFERRAL_EXPIRED',
  'REFERRAL_CLOSED', 'REFERRAL_NOT_ACCEPTED', 'REFERRAL_NOT_ARRIVED'])

/** Whether a refusal says the referral routes are not served here (an ehr-api before 0191, or the flag off). */
export function notServed(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  if (caught.status === 503 && caught.code === 'REFERRALS_NOT_AVAILABLE') return true
  return caught.status === 404 && !caught.code.startsWith('REFERRAL_')
}

/** Whether a refusal says the control cross_facility_referrals_enabled is off (423). */
export function controlOff(caught: unknown): boolean {
  return isHidApiError(caught) && caught.code === 'CROSS_FACILITY_REFERRALS_UNAVAILABLE'
}

/**
 * A refusal in plain words: the contract's, else `fallback`. `arriving`: a 403 on arrival names who may mark arrival.
 * '' for a request the page cancelled itself.
 */
export function refusalWords(caught: unknown, fallback: string, arriving = false): string {
  if (!isHidApiError(caught)) return fallback
  if (caught.code === 'REQUEST_CANCELLED') return ''
  if (notServed(caught)) return NOT_AVAILABLE
  if (Object.hasOwn(REFERRAL_REFUSALS, caught.code)) return REFERRAL_REFUSALS[caught.code]!
  // ehr-api's guard with its own text, and a facility the session can't use.
  if (caught.status === 403 && (caught.code === 'PERMISSION_DENIED' || caught.code === 'FORBIDDEN')) {
    return arriving ? ARRIVE_REFUSED : REFERRAL_REFUSED
  }
  if (caught.code === 'NETWORK_ERROR' || caught.code === 'REQUEST_TIMEOUT') return 'Couldn’t reach Health ID. Check the connection and try again.'
  return fallback
}

// ---- Whether Health ID serves referrals here -------------------------------------
// Learned from the backend's own answers, in memory for the page's life (as appointments and the emergency board do): a
// read answering 404 (an ehr-api before 0191) or 503 REFERRALS_NOT_AVAILABLE (the flag is off) says not served, only
// while nothing has said otherwise; any answer says served, once and for all. Until then null, and the page is listed.

type Served = boolean | null
let served: Served = null
const listeners = new Set<() => void>()
const changed = () => { for (const listener of listeners) listener() }

export function learnReferralsServed(value: boolean): void {
  if (served === true || served === value) return
  served = value
  changed()
}
export function referralsServed(): Served { return served }
export function subscribeReferralsServed(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useReferralsServed(): Served {
  return useSyncExternalStore(subscribeReferralsServed, referralsServed, referralsServed)
}
/** For tests: forget what was learned, as a new page would. */
export function forgetReferralsServed(): void {
  served = null
  changed()
}

/** Records what an answer (no argument) or a refusal says about whether referrals are served. */
export function learnFrom(caught?: unknown): void {
  if (caught === undefined) { learnReferralsServed(true); return }
  if (notServed(caught)) learnReferralsServed(false)
  else if (isHidApiError(caught) && caught.status !== 0 && !['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'REQUEST_CANCELLED'].includes(caught.code)) {
    learnReferralsServed(true)
  }
}
