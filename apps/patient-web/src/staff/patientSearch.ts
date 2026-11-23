import { isBlankHealthIdInput, normalizeHealthIdInput } from '@hid/contracts'

/**
 * Staff patient search (hid-system Release A, migration 0132; INTERFACE_CONTRACT "0132. Staff patient search and
 * emergency search"). The keys go in the POST body, never in an address. An answer never carries a Health ID or a
 * patient id: each card carries a `matchRef` instead, which stands for the patient for 10 minutes, only for the member,
 * facility and purpose that searched.
 */

/** A card's matchRef exactly as 0132 makes it: 'psr_' and 43 base64url characters (identity-api match-ref.ts). */
export const MATCH_REF_PATTERN = /^psr_[A-Za-z0-9_-]{43}$/

export type NinStatus = 'verified' | 'not_verified'

/** One search card. Never a Health ID or a patient id. */
export interface PatientSearchCard {
  readonly matchRef: string
  readonly matchRefExpiresAt: string
  readonly fullName: string
  readonly sex: string | null
  readonly dateOfBirth: string | null
  readonly healthIdLast4: string | null
  readonly ninStatus: NinStatus
}

export type PatientSearchOutcome = 'found' | 'no_match' | 'no_such_patient' | 'too_many'

export interface PatientSearchAnswer {
  readonly mode: 'standard' | 'emergency'
  readonly outcome: PatientSearchOutcome
  /** `here`: the keys given find only this facility's own patients (0131's). */
  readonly reach: 'everywhere' | 'here'
  readonly message: string | null
  readonly patients: readonly PatientSearchCard[]
}

/** `POST identity/patient-search` (direct care): every key optional; every key given must match. */
export interface PatientSearchKeys {
  readonly firstName?: string
  readonly lastName?: string
  readonly dateOfBirth?: string
  readonly healthId?: string
  readonly phone?: string
}

/** `POST identity/patient-search/emergency`: exactly these four, the reason typed before any result. */
export interface EmergencySearchKeys {
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly reason: string
}

/** `POST identity/own-facility-access` (0131): 24 hours of direct care for this facility's own patient. */
export interface OwnFacilityAccess {
  readonly consentGrantId: string
  readonly patientId: string
  readonly status: string
  readonly expiresAt: string
  readonly existingGrant: boolean
  readonly authorization: { readonly basis: 'own-facility'; readonly scope: string; readonly purpose: 'direct-care' }
}

const OUTCOMES: ReadonlySet<string> = new Set(['found', 'no_match', 'no_such_patient', 'too_many'])

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() !== '' ? value.trim() : null

/**
 * The body of a standard search: only the keys given, trimmed; a Health ID normalized as every Health ID field is
 * (HID- and upper case), and left out while nothing follows the prefix. Nothing else is ever sent.
 */
export function patientSearchBody(keys: PatientSearchKeys): Record<string, string> {
  const body: Record<string, string> = {}
  const firstName = text(keys.firstName)
  const lastName = text(keys.lastName)
  const dateOfBirth = text(keys.dateOfBirth)
  const phone = text(keys.phone)
  if (firstName) body.firstName = firstName
  if (lastName) body.lastName = lastName
  if (dateOfBirth) body.dateOfBirth = dateOfBirth
  if (keys.healthId !== undefined && !isBlankHealthIdInput(normalizeHealthIdInput(keys.healthId))) {
    body.healthId = normalizeHealthIdInput(keys.healthId)
  }
  if (phone) body.phone = phone
  return body
}

/** The body of an emergency search: exactly the four fields, trimmed. */
export function emergencySearchBody(keys: EmergencySearchKeys): EmergencySearchKeys {
  return { firstName: keys.firstName.trim(), lastName: keys.lastName.trim(), dateOfBirth: keys.dateOfBirth.trim(), reason: keys.reason.trim() }
}

function cardOf(value: unknown): PatientSearchCard | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const matchRef = typeof item.matchRef === 'string' && MATCH_REF_PATTERN.test(item.matchRef) ? item.matchRef : null
  const fullName = text(item.fullName)
  if (!matchRef || !fullName) return null
  const last4 = text(item.healthIdLast4)
  // Only the fields of the card are kept: a Health ID or a patient id, were one ever sent, is never read.
  return {
    matchRef,
    matchRefExpiresAt: text(item.matchRefExpiresAt) ?? '',
    fullName,
    sex: text(item.sex),
    dateOfBirth: text(item.dateOfBirth),
    healthIdLast4: last4 && /^[A-Z0-9]{1,8}$/i.test(last4) ? last4.toUpperCase() : null,
    ninStatus: item.ninStatus === 'verified' ? 'verified' : 'not_verified',
  }
}

/** A search answer as the screen uses it; a card without a matchRef or a name is left out. */
export function parsePatientSearchAnswer(value: unknown): PatientSearchAnswer {
  const answer = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patients = Array.isArray(answer.patients) ? answer.patients.map(cardOf).filter((card): card is PatientSearchCard => card !== null) : []
  const outcome = typeof answer.outcome === 'string' && OUTCOMES.has(answer.outcome) ? answer.outcome as PatientSearchOutcome
    : patients.length > 0 ? 'found' : 'no_match'
  return {
    mode: answer.mode === 'emergency' ? 'emergency' : 'standard',
    outcome: outcome === 'found' && patients.length === 0 ? 'no_match' : outcome,
    reach: answer.reach === 'here' ? 'here' : 'everywhere',
    message: text(answer.message),
    patients: outcome === 'found' ? patients : [],
  }
}

/** Whether a card's matchRef has expired (10 minutes after the search), so it can no longer be used. */
export function matchRefExpired(card: PatientSearchCard, now = Date.now()): boolean {
  const at = Date.parse(card.matchRefExpiresAt)
  return Number.isFinite(at) && at <= now
}

/** "NIN Verified" or "NIN Not Verified", as every staff screen says it (ID-0). */
export function ninStatusLabel(status: NinStatus): string {
  return status === 'verified' ? 'NIN Verified' : 'NIN Not Verified'
}
