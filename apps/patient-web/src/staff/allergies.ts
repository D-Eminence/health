/**
 * Allergies (hid-system 0124). Two sources, always kept apart and labelled on screens:
 * - recorded: what a clinician recorded at a facility (`GET ehr/patients/:id/allergies`);
 * - reported by the patient: the text the patient typed in their Health ID portal (0094).
 * A backend before 0124 answers 404 to the allergy routes: screens then show the patient-reported text only and offer
 * no way to add an allergy, and the prescribing form sends no allergy acknowledgement.
 * Shapes as hid-system#218 serves them at 7fbb04aa (docs/INTERFACE_CONTRACT.md, "Allergies and the allergy check at
 * prescribing"); what a backend at 76283f57 lacks (the rejected parts of a 409, a prescription's stored reasons) is read
 * as not said, never as "none".
 */

export const ALLERGY_SEVERITIES = ['severe', 'moderate', 'mild', 'unknown'] as const
export type AllergySeverity = typeof ALLERGY_SEVERITIES[number]

export const SEVERITY_LABELS: Readonly<Record<AllergySeverity, string>> = {
  severe: 'Severe', moderate: 'Moderate', mild: 'Mild', unknown: 'Severity not known',
}

export interface RecordedAllergy {
  id: string
  substance: string
  reaction: string | null
  severity: AllergySeverity
  status: 'active' | 'entered_in_error'
  rowVersion: number
  createdAt: string | null
  enteredInErrorReason: string | null
  /** Recorded at this facility: only then may it be marked entered in error here. */
  recordedHere: boolean
}

export interface AllergyList {
  recorded: RecordedAllergy[]
  patientReported: { allergies: string | null; updatedAt: string | null }
}

export const ALLERGY_MATCH_KINDS = ['same_medicine', 'same_class', 'cross_reactivity'] as const
export type AllergyMatchKind = typeof ALLERGY_MATCH_KINDS[number]

/**
 * One line of the allergy check: one allergy (or one group of the same allergy recorded more than once) the medicine
 * may match. The message says it all, in the EHR's words: "Penicillin allergy: SEVERE (Anaphylaxis)." or
 * "Patient-reported allergy: “…”.", why it matched, then where and when it was recorded. Show it whole.
 */
export interface AllergyMatch {
  source: 'recorded' | 'patient_reported'
  /** Recorded only: the first (oldest) recorded allergy the line stands for. */
  allergyId?: string
  /** Recorded only: every recorded allergy the line stands for; more than one on a grouped line ("recorded at 2 facilities"). */
  allergyIds?: string[]
  /** Recorded: the substance as recorded. Patient-reported: the one term the patient wrote. */
  substance: string
  /** Recorded only; always null on a patient-reported line. */
  reaction: string | null
  /** Recorded: mild, moderate, severe or unknown. Patient-reported: null (the patient gives no severity). */
  severity: AllergySeverity | null
  matchKind: AllergyMatchKind
  /** The class shared (same_class) or the medicine's class or name (cross_reactivity); none for the same medicine. */
  className?: string
  /** Recorded only: true when (any of) the allergy was recorded at this facility. */
  recordedHere?: boolean
  /** Recorded only: when it was (most recently) recorded, an ISO UTC time. The message's date is the day in Lagos. */
  recordedOn?: string
  /** The EHR's plain-English sentence for the line. */
  message: string
}

export interface AllergyCheck {
  matches: AllergyMatch[]
  /** True exactly when there is a match: the prescriber must then acknowledge the warning to go ahead. */
  acknowledgementRequired: boolean
  /**
   * Names exactly this warning (the medicine and every match). On every answer, even with no match: never decide on
   * it. Keep it, and send it with the reason, only when acknowledgementRequired.
   */
  warningToken: string
}

/** What a prescription create, Activate or Resume (PATCH) or a send of a draft carries after an allergy warning. */
export interface AllergyAcknowledgement {
  reason: string
  warningToken: string
}

/** The add form's limits, as the EHR checks them. */
export const SUBSTANCE_LIMIT = 200
export const REACTION_LIMIT = 500
/** The entered-in-error reason: 3-500 (the EHR keeps 3 there; only the prescribing acknowledgement asks 10). */
export const REASON_MIN = 3
export const REASON_LIMIT = 500
/** The prescriber's reason to go ahead after an allergy warning: 10-500 characters after trimming. */
export const ACK_REASON_MIN = 10
export const ACK_REASON_LIMIT = 500
/**
 * The EHR's rule for that reason (ehr-api allergies.dto.ts ACK_REASON): three letters in a row somewhere (a real word),
 * and no control character but a new line.
 */
// eslint-disable-next-line no-control-regex -- the characters refused are the control characters themselves
export const ACK_REASON = /^(?=[\s\S]*\p{L}{3})[^\u0000-\u0009\u000b-\u001f\u007f]*$/u
/** A warning token: 64 lower-case hex (sha256). */
export const WARNING_TOKEN = /^[a-f0-9]{64}$/
/** The longest message kept: a patient-reported term can be most of the patient's text, with the sentence round it. */
const MESSAGE_LIMIT = 4500

/**
 * What is never recorded as an allergy (ehr-api allergy-match.ts NOT_AN_ALLERGY): the EHR refuses it with 400
 * ALLERGY_NOT_A_SUBSTANCE when, trimmed, lower-cased and without a trailing run of "." or "!", it is one of these.
 */
export const NOT_AN_ALLERGY: readonly string[] = ['none', 'nil', 'no', 'nkda', 'nka', 'n/a', 'na', 'unknown', 'not known',
  'no known allergies', 'no known drug allergies', 'no allergies', 'none known']

/** "NKDA", "No known allergies.", "none" and the like: what the EHR refuses to record as an allergy. */
export function isNoKnownAllergy(substance: string): boolean {
  return NOT_AN_ALLERGY.includes(substance.trim().toLowerCase().replace(/[.!]+$/, '').trim())
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, limit) : null
const time = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const isSeverity = (value: unknown): value is AllergySeverity =>
  typeof value === 'string' && (ALLERGY_SEVERITIES as readonly string[]).includes(value)
const isMatchKind = (value: unknown): value is AllergyMatchKind =>
  typeof value === 'string' && (ALLERGY_MATCH_KINDS as readonly string[]).includes(value)
const id = (value: unknown): string | null => typeof value === 'string' && value.trim() !== '' ? value : null

/** One recorded allergy; one that is not one is dropped, never shown half-read. */
export function parseRecordedAllergy(value: unknown): RecordedAllergy | null {
  if (!record(value) || typeof value.id !== 'string') return null
  const substance = text(value.substance, SUBSTANCE_LIMIT)
  const rowVersion = Number(value.rowVersion)
  if (!substance || !Number.isInteger(rowVersion) || rowVersion < 1) return null
  if (value.status !== 'active' && value.status !== 'entered_in_error') return null
  return {
    id: value.id, substance, reaction: text(value.reaction, REACTION_LIMIT),
    severity: isSeverity(value.severity) ? value.severity : 'unknown',
    status: value.status, rowVersion, createdAt: time(value.createdAt),
    enteredInErrorReason: text(value.enteredInErrorReason, REASON_LIMIT),
    recordedHere: value.recordedHere === true,
  }
}

export function parseAllergyList(value: unknown): AllergyList {
  if (!record(value) || !Array.isArray(value.recorded)) throw new Error('The allergies could not be read.')
  const reported = record(value.patientReported) ? value.patientReported : {}
  return {
    recorded: value.recorded.flatMap(item => parseRecordedAllergy(item) ?? []),
    patientReported: { allergies: text(reported.allergies, 1000), updatedAt: time(reported.updatedAt) },
  }
}

/** One line of the check; null when it is not one (the whole answer is then unread, never shown in part). */
function parseAllergyMatch(item: unknown): AllergyMatch | null {
  if (!record(item)) return null
  const message = text(item.message, MESSAGE_LIMIT)
  const substance = text(item.substance, MESSAGE_LIMIT)
  if (!message || !substance || !isMatchKind(item.matchKind)) return null
  const className = text(item.className, SUBSTANCE_LIMIT)
  const kind = { matchKind: item.matchKind, ...(className ? { className } : {}) }
  if (item.source === 'patient_reported') return { source: 'patient_reported', substance, reaction: null, severity: null, ...kind, message }
  if (item.source !== 'recorded') return null
  const ids = Array.isArray(item.allergyIds) ? item.allergyIds.flatMap(entry => id(entry) ?? []) : []
  const allergyId = id(item.allergyId) ?? ids[0] ?? null
  const allergyIds = ids.length > 0 ? ids : allergyId ? [allergyId] : []
  const recordedOn = time(item.recordedOn)
  return {
    source: 'recorded', ...(allergyId ? { allergyId } : {}), ...(allergyIds.length > 0 ? { allergyIds } : {}), substance,
    reaction: text(item.reaction, REACTION_LIMIT), severity: isSeverity(item.severity) ? item.severity : 'unknown', ...kind,
    recordedHere: item.recordedHere === true, ...(recordedOn ? { recordedOn } : {}), message,
  }
}

/**
 * The allergy check's answer. One that is not one (a line without its message, a missing or malformed warningToken,
 * acknowledgementRequired that disagrees with the lines) throws, as a failed check does: a warning line is never
 * dropped, and an unread answer is never taken for "no allergies". The prescription's own save is then checked by the
 * EHR, which answers 409 with the warning.
 */
export function parseAllergyCheck(value: unknown): AllergyCheck {
  const unread = () => new Error('The allergy check could not be read.')
  if (!record(value) || !Array.isArray(value.matches) || typeof value.acknowledgementRequired !== 'boolean'
    || typeof value.warningToken !== 'string' || !WARNING_TOKEN.test(value.warningToken)) throw unread()
  const matches: AllergyMatch[] = []
  for (const item of value.matches) {
    const match = parseAllergyMatch(item)
    if (!match) throw unread()
    matches.push(match)
  }
  if (value.acknowledgementRequired !== matches.length > 0) throw unread()
  return { matches, acknowledgementRequired: value.acknowledgementRequired, warningToken: value.warningToken }
}

/**
 * The warning messages a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED carries (the problem's errors with the field
 * allergyAcknowledgement, one per match, in match order), each one sentence.
 */
export function warningMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return details.flatMap(entry => {
    if (!record(entry) || entry.field !== 'allergyAcknowledgement' || !Array.isArray(entry.messages)) return []
    return entry.messages.filter((message): message is string => typeof message === 'string' && message.trim() !== '').map(message => message.slice(0, MESSAGE_LIMIT))
  })
}

/**
 * The token of the warning a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED names: the only message of its errors entry with the
 * field allergyAcknowledgement.warningToken (after the warnings; at 7fbb04aa the rejected entries follow it). Null when
 * there is none, or it is not 64 lower-case hex.
 */
export function refusalWarningToken(details: unknown): string | null {
  if (!Array.isArray(details)) return null
  const entry = details.find(item => record(item) && item.field === 'allergyAcknowledgement.warningToken')
  const token = record(entry) && Array.isArray(entry.messages) ? entry.messages[0] : null
  return typeof token === 'string' && WARNING_TOKEN.test(token) ? token : null
}

/**
 * Which part of the acknowledgement the EHR refused, one code per errors entry with the field
 * allergyAcknowledgement.rejected (hid-system#218 at 7fbb04aa; read by `code`, never by the sentence or the detail):
 * - MISSING: none was sent (the first warning; then the only one);
 * - REASON_MISSING, REASON_INVALID: the reason (blank; or not 10-500 characters, no word, a hidden character);
 * - TOKEN_INVALID: the token named no warning (absent, or not 64 lower-case hex);
 * - TOKEN_STALE: the token names another warning: the warning changed since it was shown.
 * The reason and the token are checked apart: one of each can come together, the reason's first.
 */
export const ALLERGY_ACKNOWLEDGEMENT_MISSING = 'ALLERGY_ACKNOWLEDGEMENT_MISSING'
export const ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING = 'ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING'
export const ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID = 'ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID'
export const ALLERGY_WARNING_TOKEN_INVALID = 'ALLERGY_WARNING_TOKEN_INVALID'
export const ALLERGY_WARNING_TOKEN_STALE = 'ALLERGY_WARNING_TOKEN_STALE'
export const ALLERGY_REJECTION_CODES = [ALLERGY_ACKNOWLEDGEMENT_MISSING, ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING,
  ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID, ALLERGY_WARNING_TOKEN_INVALID, ALLERGY_WARNING_TOKEN_STALE] as const
export type AllergyRejectionCode = typeof ALLERGY_REJECTION_CODES[number]

/**
 * The codes of a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED's allergyAcknowledgement.rejected entries, in the EHR's order;
 * a code this page does not know is left out. Null when there is none it knows: an EHR before 7fbb04aa, which names no
 * rejected part (there, a refused request that carried an acknowledgement means the warning changed).
 */
export function refusalRejections(details: unknown): AllergyRejectionCode[] | null {
  if (!Array.isArray(details)) return null
  const codes = details.flatMap(entry => record(entry) && entry.field === 'allergyAcknowledgement.rejected'
    && (ALLERGY_REJECTION_CODES as readonly unknown[]).includes(entry.code) ? [entry.code as AllergyRejectionCode] : [])
  return codes.length > 0 ? codes : null
}

/** When a reason to go ahead over an allergy warning was given: on create, Activate, Resume, or sending a draft elsewhere. */
export const ACKNOWLEDGEMENT_STAGES = ['create', 'activate', 'resume', 'send'] as const
export type AcknowledgementStage = typeof ACKNOWLEDGEMENT_STAGES[number]

/**
 * A reason to go ahead over an allergy warning, stored with the prescription (hid-system#218 at 7fbb04aa): one item of
 * the prescription's allergyAcknowledgements. The reason is the prescriber's own words: shown as text, never kept.
 */
export interface PrescriptionAllergyAcknowledgement {
  id: string
  /** Null for a stage this page does not know. */
  stage: AcknowledgementStage | null
  reason: string
  /**
   * The account that gave it: an account id, never shown, and never the session's actor.id (that is the sign-in's
   * subject). Null when unread.
   */
  createdBy: string | null
  /**
   * The staff membership at this facility that gave it: what says "you", compared with the session's membership at the
   * chart's facility. Null when unread: then never "you".
   */
  createdByMembershipId: string | null
  createdAt: string | null
  /** The recorded allergies it covered: name them from the patient's allergy list. */
  matchedRecordedAllergyIds: string[]
  patientReportedMatched: boolean
  /** The patient's own terms it covered, as the EHR matched them (lower case). */
  patientReportedTerms: string[]
}

export interface PrescriptionAllergyAcknowledgements {
  /** Oldest first, as the EHR serves them. */
  items: PrescriptionAllergyAcknowledgement[]
  /** Items that could not be read: counted, never dropped in silence. */
  unread: number
}

/** The longest reason kept: the EHR stores 10-500 characters (and refuses over 2000 before that). */
const STORED_REASON_LIMIT = 2000

function parsePrescriptionAllergyAcknowledgement(value: unknown): PrescriptionAllergyAcknowledgement | null {
  if (!record(value)) return null
  const ackId = id(value.id)
  const reason = text(value.reason, STORED_REASON_LIMIT)
  if (!ackId || !reason) return null
  const strings = (items: unknown, limit: number) => Array.isArray(items)
    ? [...new Set(items.flatMap(item => text(item, limit) ?? []))] : []
  return {
    id: ackId,
    stage: typeof value.stage === 'string' && (ACKNOWLEDGEMENT_STAGES as readonly string[]).includes(value.stage) ? value.stage as AcknowledgementStage : null,
    reason, createdBy: id(value.createdBy), createdByMembershipId: id(value.createdByMembershipId), createdAt: time(value.createdAt),
    matchedRecordedAllergyIds: strings(value.matchedRecordedAllergyIds, 100),
    patientReportedMatched: value.patientReportedMatched === true,
    patientReportedTerms: strings(value.patientReportedTerms, MESSAGE_LIMIT),
  }
}

/**
 * A prescription's allergyAcknowledgements (the list and the one-prescription read, hid-system#218 at 7fbb04aa). Null
 * when the member is absent or not a list: an EHR before 7fbb04aa, which does not say whether a reason was given (never
 * read as "none"). `[]` is the only "none".
 */
export function parsePrescriptionAllergyAcknowledgements(value: unknown): PrescriptionAllergyAcknowledgements | null {
  if (!Array.isArray(value)) return null
  const items = value.flatMap(item => parsePrescriptionAllergyAcknowledgement(item) ?? [])
  return { items, unread: value.length - items.length }
}

export const ALLERGY_ACKNOWLEDGEMENT_REQUIRED = 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED'
/** 400 from recording an allergy that is "NKDA", "No known allergies", "none" and the like (no errors member). */
export const ALLERGY_NOT_A_SUBSTANCE = 'ALLERGY_NOT_A_SUBSTANCE'
