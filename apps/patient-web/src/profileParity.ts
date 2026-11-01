import { PHONE_COUNTRIES } from './routes/enrollment/phoneCountries'
import { PlainError } from '@hid/http'

/**
 * hid-1.0 patient parity B3 (owner decisions of 2026-10-28, and the lead's for the wave): what the profile's coverage,
 * photo, contact details and health information read and send, as hid-system 0094 serves them on
 * staging-novu-ci-20261005. A backend before 0094 answers each route 404, which the portal takes as "not offered"
 * and shows nothing for.
 */

/** The blood groups the patient can choose, as hid-1.0 offered them (src/lib/utils.ts BLOOD_GROUPS). */
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const
export type BloodGroup = typeof BLOOD_GROUPS[number]
/** hid-1.0's genotypes (src/lib/utils.ts GENOTYPES), and CC. */
export const GENOTYPES = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'] as const
export type Genotype = typeof GENOTYPES[number]

/** The most characters Identity keeps for the hospital and the HMO's name (as for the sign-up's hospital). */
export const COVERAGE_TEXT_LIMIT = 120
/** The most characters EHR keeps for each health text. */
export const HEALTH_TEXT_LIMIT = 1000

/**
 * The most bytes a JSON body the profile sends may take. Production's load balancer runs AWS WAF's common rule set,
 * whose SizeRestrictions_BODY rule refuses any request body over 8 KB (8,192 bytes) with a 403 before it reaches the
 * gateway, and the rule stays (the lead's decision). The photo and the health information are the bodies that can
 * grow past it: each is measured against this, with room to spare, and is not sent when it is over.
 */
export const EDGE_BODY_MAX_BYTES = 8000
/** The bytes `body` takes as the client sends it: JSON.stringify, as UTF-8. */
export const jsonBodyBytes = (body: unknown): number => new TextEncoder().encode(JSON.stringify(body)).byteLength

/** GET and PUT identity/me/profile-details. */
export interface ProfileDetails {
  hospitalCurrentlyUsing: string | null
  hmoName: string | null
  rowVersion: number
}

/** The six things the patient says about their health, each null when not stated. */
export interface HealthFields {
  bloodGroup: BloodGroup | null
  genotype: Genotype | null
  allergies: string | null
  currentMedications: string | null
  chronicConditions: string | null
  medicalNotes: string | null
}
export const HEALTH_FIELDS = ['bloodGroup', 'genotype', 'allergies', 'currentMedications', 'chronicConditions', 'medicalNotes'] as const
export const HEALTH_TEXT_FIELDS = ['allergies', 'currentMedications', 'chronicConditions', 'medicalNotes'] as const
export type HealthTextField = typeof HEALTH_TEXT_FIELDS[number]

/** GET and PUT ehr/me/health-profile: what the patient entered; rowVersion 0 and updatedAt null before the first save. */
export interface HealthProfile extends HealthFields {
  rowVersion: number
  updatedAt: string | null
}

/** GET ehr/patients/:id/reported-health-profile: the same, for a clinician, without the version. */
export interface ReportedHealthProfile extends HealthFields {
  updatedAt: string | null
}

/** POST identity/me/contact-changes for an email: the code went to the new address. */
export interface EmailChangeStarted {
  changeId: string
  maskedContact: string
  expiresInSeconds: number
  resendAfterSeconds: number
}

/** The same for a phone: changed at once, shown as not verified (production sends no SMS). */
export interface PhoneChanged {
  phone: string
  phoneVerified: boolean
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
/** A text as sent, or null for null, an empty one, or anything that is not text. */
const textOrNull = (value: unknown, limit: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.slice(0, limit) : null
const time = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null

/** The coverage answer; one that is not one is refused, so a card never shows or saves against a wrong version. */
export function parseProfileDetails(value: unknown): ProfileDetails {
  const rowVersion = record(value) ? count(value.rowVersion) : null
  if (!record(value) || rowVersion === null) throw new Error('Your coverage details could not be read.')
  return {
    hospitalCurrentlyUsing: textOrNull(value.hospitalCurrentlyUsing, COVERAGE_TEXT_LIMIT),
    hmoName: textOrNull(value.hmoName, COVERAGE_TEXT_LIMIT),
    rowVersion,
  }
}

function healthFields(value: Record<string, unknown>): HealthFields {
  return {
    bloodGroup: isOneOf(BLOOD_GROUPS, value.bloodGroup) ? value.bloodGroup : null,
    genotype: isOneOf(GENOTYPES, value.genotype) ? value.genotype : null,
    allergies: textOrNull(value.allergies, HEALTH_TEXT_LIMIT),
    currentMedications: textOrNull(value.currentMedications, HEALTH_TEXT_LIMIT),
    chronicConditions: textOrNull(value.chronicConditions, HEALTH_TEXT_LIMIT),
    medicalNotes: textOrNull(value.medicalNotes, HEALTH_TEXT_LIMIT),
  }
}

/** The patient's health information; an answer that is not one is refused. */
export function parseHealthProfile(value: unknown): HealthProfile {
  const rowVersion = record(value) ? count(value.rowVersion) : null
  if (!record(value) || rowVersion === null) throw new Error('Your health information could not be read.')
  return { ...healthFields(value), rowVersion, updatedAt: time(value.updatedAt) }
}

/** What a clinician reads: null when the answer is not one, or holds nothing the patient stated. */
export function parseReportedHealthProfile(value: unknown): ReportedHealthProfile | null {
  if (!record(value)) return null
  const fields = healthFields(value)
  if (HEALTH_FIELDS.every(field => fields[field] === null)) return null
  return { ...fields, updatedAt: time(value.updatedAt) }
}

export function parseEmailChangeStarted(value: unknown): EmailChangeStarted {
  const changeId = record(value) && typeof value.changeId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value.changeId) ? value.changeId : null
  if (!record(value) || changeId === null) throw new PlainError('The code could not be sent. Try again.')
  return {
    changeId,
    maskedContact: textOrNull(value.maskedContact, 254) ?? 'your new email address',
    expiresInSeconds: count(value.expiresInSeconds) ?? 600,
    resendAfterSeconds: count(value.resendAfterSeconds) ?? 60,
  }
}

export function parsePhoneChanged(value: unknown, sent: string): PhoneChanged {
  const phone = record(value) && typeof value.phone === 'string' && value.phone.trim() !== '' ? value.phone.trim() : sent
  return { phone, phoneVerified: record(value) && value.phoneVerified === true }
}

/** Control characters other than a newline, which no profile text may hold. */
// eslint-disable-next-line no-control-regex -- the characters to drop are the control characters themselves
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g
// eslint-disable-next-line no-control-regex -- as above, newlines included
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g

/** A one-line value as typed, without control characters (a tab or a pasted line break becomes a space). */
export const oneLine = (value: string): string => value.replace(/[\t\r\n]+/g, ' ').replace(CONTROL, '')
/** A text area's value as typed: line breaks kept as newlines, a tab a space, other control characters dropped. */
export const multiLine = (value: string): string => value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(CONTROL_BUT_NEWLINE, '')
/** What is sent for a field: its text trimmed, or null when nothing is left. */
export const sentText = (value: string): string | null => value.trim() === '' ? null : value.trim()

/**
 * A blood group hid-1.0 kept as free text ("O+", "o positive", "AB -ve"), as one of the choices, or null when it is
 * not one: the patient then chooses.
 */
export function bloodGroupOf(text: string | undefined): BloodGroup | null {
  if (!text) return null
  const compact = text.toUpperCase().replace(/\s+/g, '')
    .replace(/(POSITIVE|POS|\+VE|RH\+)$/, '+').replace(/(NEGATIVE|NEG|-VE|RH-)$/, '-')
  return isOneOf(BLOOD_GROUPS, compact) ? compact : null
}

/** A genotype hid-1.0 kept as free text ("as", "A S"), as one of the choices, or null. */
export function genotypeOf(text: string | undefined): Genotype | null {
  if (!text) return null
  const compact = text.toUpperCase().replace(/[\s/-]+/g, '')
  return isOneOf(GENOTYPES, compact) ? compact : null
}

/** An email shown masked: its first character, then the domain ("a•••@example.com"). */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at <= 0) return '•••'
  return `${email.slice(0, 1)}•••${email.slice(at)}`
}

/** A phone number shown masked: its country code when it is one the sign-up offers, and its last four digits ("+234 •••• 4567"). */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 6) return '••••'
  const last = digits.slice(-4)
  const code = phone.trim().startsWith('+')
    ? PHONE_COUNTRIES.map(country => country.code).filter(candidate => digits.startsWith(candidate) && digits.length - candidate.length > 4)
      .sort((a, b) => b.length - a.length)[0]
    : undefined
  return code ? `+${code} •••• ${last}` : `•••• ${last}`
}
