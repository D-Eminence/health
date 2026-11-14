import { ALLERGY_SEVERITIES, REACTION_LIMIT, SUBSTANCE_LIMIT, type AllergySeverity } from '../../../staff/allergies'

/**
 * The allergies the emergency read carries (hid-system#218 at 7fbb04aa, `allergies` on GET emergency-records), read
 * only, each source kept apart:
 * - recorded: the active allergies clinicians recorded, at this facility or another, in the EHR's order (most serious
 *   first: severe, not known, moderate, mild; newest first within each). Never sorted again here.
 * - patientReported: the text the patient typed in their Health ID portal, not checked by a clinician.
 * The staff client passes the answer through unparsed, and its type names no `allergies`: it is read from the answer
 * here. Pure; nothing here reads or writes the network or the browser's storage.
 */
export interface EmergencyRecordedAllergy {
  readonly id: string
  readonly substance: string
  readonly reaction: string | null
  readonly severity: AllergySeverity
  /** Recorded at the facility the emergency access is at. */
  readonly recordedHere: boolean
  /** When it was recorded, an ISO time; null when the EHR gave none that reads as a time. */
  readonly recordedOn: string | null
}

export interface EmergencyAllergies {
  readonly recorded: readonly EmergencyRecordedAllergy[]
  readonly patientReported: {
    /** The patient's own words; null when they entered none (a blank text is none). */
    readonly allergies: string | null
    /** When the patient last changed their health profile (any of it, not only allergies). */
    readonly updatedAt: string | null
  }
}

/** The patient's text as the EHR keeps it: 1 to 1000 characters (0094). */
const PATIENT_TEXT_LIMIT = 1000

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const time = (value: unknown): string | null => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
const isSeverity = (value: unknown): value is AllergySeverity =>
  typeof value === 'string' && (ALLERGY_SEVERITIES as readonly string[]).includes(value)

/** A text, trimmed; null for null, absent or blank; undefined for anything that is not a text (the answer is then unread). */
function optionalText(value: unknown, limit: number): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, limit) : null
}

/** One recorded allergy; null when it is not one. */
function recordedAllergy(value: unknown): EmergencyRecordedAllergy | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id.trim() || typeof value.recordedHere !== 'boolean') return null
  const substance = optionalText(value.substance, SUBSTANCE_LIMIT)
  const reaction = optionalText(value.reaction, REACTION_LIMIT)
  if (!substance || reaction === undefined) return null
  return {
    id: value.id, substance, reaction,
    // A severity this page does not know is said as not known, never as mild (as the chart and the check read it).
    severity: isSeverity(value.severity) ? value.severity : 'unknown',
    recordedHere: value.recordedHere, recordedOn: time(value.recordedOn),
  }
}

/**
 * The allergies of an emergency-records answer, or null when they can't be shown: an EHR before 7fbb04aa sends none,
 * and an answer whose allergies can't all be read is not shown in part (a dropped line could be the severe one). Null
 * is never "no allergies": the page then says the allergies can't be shown here.
 */
export function emergencyAllergies(answer: unknown): EmergencyAllergies | null {
  if (!record(answer) || !record(answer.allergies)) return null
  const { recorded, patientReported } = answer.allergies
  if (!Array.isArray(recorded) || !record(patientReported)) return null
  const rows: EmergencyRecordedAllergy[] = []
  for (const item of recorded) {
    const row = recordedAllergy(item)
    if (!row) return null
    rows.push(row)
  }
  const allergies = optionalText(patientReported.allergies, PATIENT_TEXT_LIMIT)
  if (allergies === undefined) return null
  return { recorded: rows, patientReported: { allergies, updatedAt: time(patientReported.updatedAt) } }
}
