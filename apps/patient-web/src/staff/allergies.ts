/**
 * Allergies (hid-system 0124). Two sources, always kept apart and labelled on screens:
 * - recorded: what a clinician recorded at a facility (`GET ehr/patients/:id/allergies`);
 * - reported by the patient: the text the patient typed in their Health ID portal (0094).
 * A backend before 0124 answers 404 to the allergy routes: screens then show the patient-reported text only and offer
 * no way to add an allergy, and the prescribing form sends no allergy acknowledgement.
 * Shapes as hid-system#218 serves them at 76283f57 (docs/INTERFACE_CONTRACT.md, "Allergies and the allergy check").
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
 * The token of the warning a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED names: the only message of its last errors entry,
 * field allergyAcknowledgement.warningToken. Null when there is none, or it is not 64 lower-case hex.
 */
export function refusalWarningToken(details: unknown): string | null {
  if (!Array.isArray(details)) return null
  const entry = details.find(item => record(item) && item.field === 'allergyAcknowledgement.warningToken')
  const token = record(entry) && Array.isArray(entry.messages) ? entry.messages[0] : null
  return typeof token === 'string' && WARNING_TOKEN.test(token) ? token : null
}

export const ALLERGY_ACKNOWLEDGEMENT_REQUIRED = 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED'
/** 400 from recording an allergy that is "NKDA", "No known allergies", "none" and the like (no errors member). */
export const ALLERGY_NOT_A_SUBSTANCE = 'ALLERGY_NOT_A_SUBSTANCE'
