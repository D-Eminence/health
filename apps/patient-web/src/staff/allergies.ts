/**
 * Allergies (hid-system 0124). Two sources, always kept apart and labelled on screens:
 * - recorded: what a clinician recorded at a facility (`GET ehr/patients/:id/allergies`);
 * - reported by the patient: the text the patient typed in their Health ID portal (0094).
 * A backend before 0124 answers 404 to the allergy routes: screens then show the patient-reported text only and offer
 * no way to add an allergy, and the prescribing form sends no allergy acknowledgement.
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

export interface AllergyMatch {
  source: 'recorded' | 'patient_reported'
  substance: string
  /** One plain-English sentence from the EHR. */
  message: string
}

export interface AllergyCheck {
  matches: AllergyMatch[]
}

/** The add form's limits, as the EHR checks them. */
export const SUBSTANCE_LIMIT = 200
export const REACTION_LIMIT = 500
export const REASON_MIN = 3
export const REASON_LIMIT = 500

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, limit) : null
const time = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const isSeverity = (value: unknown): value is AllergySeverity =>
  typeof value === 'string' && (ALLERGY_SEVERITIES as readonly string[]).includes(value)

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

export function parseAllergyCheck(value: unknown): AllergyCheck {
  if (!record(value) || !Array.isArray(value.matches)) throw new Error('The allergy check could not be read.')
  return {
    matches: value.matches.flatMap(item => {
      if (!record(item)) return []
      const message = text(item.message, 600)
      const substance = text(item.substance, 1000)
      if (!message || !substance) return []
      return [{ source: item.source === 'patient_reported' ? 'patient_reported' as const : 'recorded' as const, substance, message }]
    }),
  }
}

/** The warning messages a 409 ALLERGY_ACKNOWLEDGEMENT_REQUIRED carries (the problem's errors), each one sentence. */
export function warningMessages(details: unknown): string[] {
  if (!Array.isArray(details)) return []
  return details.flatMap(entry => {
    if (!record(entry) || entry.field !== 'allergyAcknowledgement' || !Array.isArray(entry.messages)) return []
    return entry.messages.filter((message): message is string => typeof message === 'string' && message.trim() !== '').map(message => message.slice(0, 600))
  })
}

export const ALLERGY_ACKNOWLEDGEMENT_REQUIRED = 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED'
