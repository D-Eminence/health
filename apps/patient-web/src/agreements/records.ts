import { isHidApiError } from '@hid/http'
import { FACILITY_AGREEMENT } from './facilityAgreement'
import { HEALTH_DATA } from './healthData'
import { PATIENT_TERMS } from './patientTerms'

/*
 * What a person agreed to, as the PROPOSED consent routes would record it (BACKEND-NEEDS.md, "Consent and agreements";
 * packages/contracts registry: identity.myConsents, identity.facilityAgreements, identity.facilityAgreementCurrent).
 * No backend serves them yet: every read answers 404, and the pages then show the current versions with Read only.
 */

export type PatientConsentDocument = 'patient-terms' | 'health-data' | 'email-updates'

export interface PatientConsentItem {
  readonly documentId: PatientConsentDocument
  readonly version: string
  readonly accepted: boolean
}

/** POST identity/me/consents. */
export interface PatientConsentRecord {
  readonly items: readonly PatientConsentItem[]
  readonly language: 'en'
  readonly method: 'self'
}

/** POST identity/facility-agreements. */
export interface FacilityAgreementRecord {
  readonly documentId: 'facility-agreement'
  readonly version: string
  readonly signerName: string
  readonly facilityName: string
  readonly language: 'en'
}

/** One agreement as the backend answers it. */
export interface RecordedConsent {
  readonly documentId: string
  readonly version: string
  readonly accepted: boolean
  readonly at: string | null
}

/** GET identity/me/consents. `needsAgreement` with `changes` when a version changed since the patient agreed. */
export interface PatientConsents {
  readonly items: readonly RecordedConsent[]
  readonly needsAgreement: boolean
  readonly changes: readonly string[]
}

/** GET identity/facility-agreements/current. */
export interface FacilityAgreementCurrent {
  readonly version: string | null
  readonly signerName: string | null
  readonly facilityName: string | null
  readonly signedAt: string | null
  readonly needsAgreement: boolean
  readonly changes: readonly string[]
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : null
const changesOf = (value: unknown) => Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string' && line.trim() !== '').slice(0, 3) : []

export function parsePatientConsents(value: unknown): PatientConsents {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const items = Array.isArray(body.items) ? body.items.flatMap(raw => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const documentId = text(item.documentId)
    const version = text(item.version)
    return documentId && version ? [{ documentId, version, accepted: item.accepted === true, at: text(item.acceptedAt) ?? text(item.at) }] : []
  }) : []
  return { items, needsAgreement: body.needsAgreement === true, changes: changesOf(body.changes) }
}

export function parseFacilityAgreement(value: unknown): FacilityAgreementCurrent {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    version: text(body.version), signerName: text(body.signerName), facilityName: text(body.facilityName),
    signedAt: text(body.signedAt), needsAgreement: body.needsAgreement === true, changes: changesOf(body.changes),
  }
}

/** The optional box's id, and the version of its one line ("Send me occasional updates by email"). */
export const EMAIL_UPDATES = 'email-updates'
const EMAIL_UPDATES_VERSION = '1.0'

/** The patient's three boxes, as the record sends them: every box, ticked or not. */
export function patientConsentRecord(checked: Readonly<Record<string, boolean>>): PatientConsentRecord {
  return {
    items: [
      { documentId: 'patient-terms', version: PATIENT_TERMS.version, accepted: checked[PATIENT_TERMS.id] === true },
      { documentId: 'health-data', version: HEALTH_DATA.version, accepted: checked[HEALTH_DATA.id] === true },
      { documentId: 'email-updates', version: EMAIL_UPDATES_VERSION, accepted: checked[EMAIL_UPDATES] === true },
    ],
    language: 'en', method: 'self',
  }
}

export function facilityAgreementRecord(signerName: string, facilityName: string): FacilityAgreementRecord {
  return { documentId: 'facility-agreement', version: FACILITY_AGREEMENT.version, signerName: signerName.trim(), facilityName, language: 'en' }
}

/** A route not served yet (or switched off): nothing is said about it. */
export const notServed = (reason: unknown) => isHidApiError(reason) && (reason.status === 404 || reason.status === 501)

/**
 * Records an agreement after the account or facility it belongs to exists. It never blocks or changes what the person
 * sees: a refusal, a 404 (not served yet) or a fault is let go, and nothing is kept in the browser to send later.
 */
export function recordQuietly(send: () => Promise<unknown>) {
  void Promise.resolve().then(send).catch(() => undefined)
}
