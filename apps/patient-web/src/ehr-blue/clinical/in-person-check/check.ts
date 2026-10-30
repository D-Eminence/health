import { findEndpoint } from '@hid/contracts'
import { isHidApiError } from '@hid/http'
import type { AssistedDocumentType, AssistedVerificationInput } from '../../../staff/api'
import { normalizeDeskCode } from '../../../staff/routes/InPersonCheck'

/**
 * Today's in-person check rules and wording (staff/routes/InPersonCheck.tsx). That page exports only
 * ASSISTED_REGISTRATION_PERMISSION and normalizeDeskCode, which the blue page imports; everything below it keeps
 * private (not exported), so it is restated here word for word: the document types, the five statements, the values
 * and the request they make, the submission signature, the result words, every message, outcomeUnknown and
 * dateOfBirthUnfinished. The messages today writes inline in its refusals are named here, with the same text.
 */

/** The route the check calls; who may call it comes from the contracts registry, never from a list of our own. */
export const ASSISTED_VERIFICATIONS = 'identity.assistedVerifications'

/** Whether the role holds every permission the registry lists for the check (POST); none listed refuses. */
export function mayCheck(permissions: readonly string[]): boolean {
  const required = findEndpoint(ASSISTED_VERIFICATIONS)?.permissions?.POST ?? []
  return required.length > 0 && required.every(permission => permissions.includes(permission))
}

export const DOCUMENT_TYPES: ReadonlyArray<readonly [AssistedDocumentType, string]> = [
  ['national_id_card', 'National ID card'],
  ['international_passport', 'International passport'],
  ['drivers_licence', 'Driver’s licence'],
  ['voters_card', 'Voter’s card'],
]

export type Attestation = keyof AssistedVerificationInput['attestations']
export const ATTESTATIONS: ReadonlyArray<readonly [Attestation, string]> = [
  ['patientPresent', 'The patient is here in person.'],
  ['originalDocumentSeen', 'I have seen the original document, not a copy or a photo of it.'],
  ['photoMatchesPerson', 'The photo on the document matches the person in front of me.'],
  ['codeShownOnPatientsOwnDevice', 'The desk code is shown on the patient’s own phone.'],
  ['patientConsents', 'The patient agrees to this check against their NIN record.'],
]

export interface Values {
  deskCode: string
  documentType: AssistedDocumentType | ''
  firstName: string
  lastName: string
  dateOfBirth: string
  attestations: Record<Attestation, boolean>
}

export const EMPTY: Values = {
  deskCode: '', documentType: '', firstName: '', lastName: '', dateOfBirth: '',
  attestations: { patientPresent: false, originalDocumentSeen: false, photoMatchesPerson: false,
    codeShownOnPatientsOwnDevice: false, patientConsents: false },
}

/** What would be sent for these values, read as Identity reads them; the same values give the same request. */
export function requestOf(values: Values): AssistedVerificationInput {
  const dateOfBirth = values.dateOfBirth.trim()
  return {
    deskCode: normalizeDeskCode(values.deskCode) ?? values.deskCode.trim(),
    method: 'government_photo_id_in_person',
    documentType: values.documentType as AssistedDocumentType,
    document: { firstName: values.firstName.trim(), lastName: values.lastName.trim(), ...(dateOfBirth ? { dateOfBirth } : {}) },
    attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
      codeShownOnPatientsOwnDevice: true, patientConsents: true },
  }
}

/** The values and the statements confirmed, as one string: the submission they make. */
export function signatureOf(values: Values): string {
  return JSON.stringify([requestOf(values), ATTESTATIONS.map(([key]) => values.attestations[key])])
}

type FieldResult = 'match' | 'no_match' | 'not_in_record'
export type Mismatch = { firstName?: string; lastName?: string; dateOfBirth?: string }

const RESULT_WORDS: Record<FieldResult, string> = {
  match: 'matches',
  no_match: 'does not match',
  not_in_record: 'not on the NIN record, so not compared',
}

export function resultWords(field: keyof Mismatch, result: string | undefined, typedDateOfBirth: boolean): string {
  if (field === 'dateOfBirth' && result === 'no_match' && !typedDateOfBirth) {
    return 'does not match. None was typed; type the date of birth on the document.'
  }
  return result && Object.hasOwn(RESULT_WORDS, result) ? RESULT_WORDS[result as FieldResult] : 'no result given'
}

export const DESK_CODE_ENTRY = 'Enter the 10-character desk code shown on the patient’s phone.'
export const DATE_OF_BIRTH_ENTRY = 'Enter the whole date of birth as written on the document, or clear the field if the document shows none.'
export const STALE = 'This desk code can no longer be checked: another check came first, or the patient has a new code. Ask the patient for the code on their phone now, then check again.'
export const RETRY = 'The check could not be completed. Press Check again without changing the details: it is sent as the same check, so it is not counted twice.'
export const RETRY_PROOF = 'The check is recorded, but the patient’s registration could not be moved on. Press Check again without changing the details within 10 minutes: it is not counted twice.'

// Written inline in today's refused() and answer(); the same words.
export const DOCUMENT_ENTRY = 'Choose the document you checked.'
export const FIRST_NAME_ENTRY = 'Enter the first name as written on the document.'
export const LAST_NAME_ENTRY = 'Enter the last name as written on the document.'
export const CONFIRM_ALL = 'Confirm all five statements. If any is not true, do not check this patient.'
export const NOT_WAITING = 'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'
export const NOT_AUTHORIZED = 'You cannot register patients in person at this facility. Ask a platform administrator: the facility must take part, and you need an active account, a sign-in confirmed with your authenticator, an attested clinical grant and an active membership here.'
export const ROLE_REFUSED = 'Your role at this facility cannot check patients in person. Ask a platform administrator.'
export const ROUTE_CLOSED = 'Registration at a facility is not available.'
export const KEY_REUSED = 'This check was already sent with other details. Check the details, then send them again.'
export const DETAILS_REFUSED = 'Some details were refused. Check them, then send them again.'
export const NOT_COMPLETED = 'The check could not be completed.'

/** Today's page without the permission (its EmptyState). */
export const UNAVAILABLE_TITLE = 'In-person check unavailable'
export const UNAVAILABLE = 'Your role at this facility cannot check patients in person. Doctors, clinicians and nurses at a facility that takes part in registration can. Ask a platform administrator if your role should.'

/**
 * An answer that may or may not have been recorded: the same submission is sent again. A 503
 * ASSISTED_REGISTRATION_DISABLED is not one: the route is closed and nothing was recorded.
 */
export function outcomeUnknown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  if (caught.code === 'ASSISTED_REGISTRATION_DISABLED') return false
  return caught.status === 0 || caught.status === 408 || caught.status >= 500
}

/**
 * Whether the date control holds a date it cannot report: one partly typed, or impossible such as 31
 * February. Its value is then empty, so without this the check would go without the date the staff
 * member typed, be counted, and be answered as if none was typed.
 */
export function dateOfBirthUnfinished(form: HTMLFormElement): boolean {
  const control = form.elements.namedItem('dateOfBirth')
  return control instanceof HTMLInputElement && control.validity.badInput
}
