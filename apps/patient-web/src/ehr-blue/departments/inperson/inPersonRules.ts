import { isHidApiError } from '@hid/http'
import type { AssistedDocumentType, AssistedVerificationInput } from '../../../staff/api'

/*
 * The rules and words of today's in-person check (staff/routes/InPersonCheck.tsx at main a4f5704), ported word for word:
 * today's page is not exported in reusable pieces. Each block names the lines it comes from. Identity decides every
 * check (hid-system main f9dbaf0: #85, migration 0094, ADR-063; INTERFACE_CONTRACT.md "Facility-assisted registration");
 * these only say what today's page says, and refuse what today's page refuses before anything is sent.
 */

/** InPersonCheck.tsx:26. The facility permission the page needs, as today's. */
export const ASSISTED_REGISTRATION_PERMISSION = 'identity.patient.assisted_registration'

/** InPersonCheck.tsx:136-137. Today's page, word for word, for a member whose role lacks the permission. */
export const UNAVAILABLE_TITLE = 'In-person check unavailable'
export const UNAVAILABLE_MESSAGE = 'Your role at this facility cannot check patients in person. Doctors, clinicians and nurses at a facility that takes part in registration can. Ask a platform administrator if your role should.'

/** InPersonCheck.tsx:266-268. The page heading. */
export const EYEBROW = 'Identity operations'
export const TITLE = 'In-person check'
export const DESCRIPTION = 'Check a patient registering on their own phone who cannot receive the code sent to the phone on their NIN record. You check one original photo ID; Health ID compares the details with the NIN record and never shows you the record.'

/** InPersonCheck.tsx:28-33. The documents Identity takes, in today's order and words. */
export const DOCUMENT_TYPES: ReadonlyArray<readonly [AssistedDocumentType, string]> = [
  ['national_id_card', 'National ID card'],
  ['international_passport', 'International passport'],
  ['drivers_licence', 'Driver’s licence'],
  ['voters_card', 'Voter’s card'],
]

/** InPersonCheck.tsx:296-297. The one method Identity takes. */
export const METHOD = 'government_photo_id_in_person'
export const METHOD_LABEL = 'Original government photo ID, checked in person'

export type Attestation = keyof AssistedVerificationInput['attestations']

/** InPersonCheck.tsx:35-42. The five statements, in today's order and words. */
export const ATTESTATIONS: ReadonlyArray<readonly [Attestation, string]> = [
  ['patientPresent', 'The patient is here in person.'],
  ['originalDocumentSeen', 'I have seen the original document, not a copy or a photo of it.'],
  ['photoMatchesPerson', 'The photo on the document matches the person in front of me.'],
  ['codeShownOnPatientsOwnDevice', 'The desk code is shown on the patient’s own phone.'],
  ['patientConsents', 'The patient agrees to this check against their NIN record.'],
]

/** InPersonCheck.tsx:44-45. Identity's desk code alphabet (Crockford base32: no I, L, O or U). */
const DESK_CODE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$/

/**
 * InPersonCheck.tsx:47-55. The code as Identity reads it (identity/desk-code.ts): spaces, hyphens and case ignored, the
 * look-alikes O read as zero and I and L as one. Null when what is left is not 10 characters of the alphabet.
 */
export function normalizeDeskCode(value: string): string | null {
  const code = value.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1')
  return DESK_CODE.test(code) ? code : null
}

/** InPersonCheck.tsx:57-64. What the form holds: in this page's state only. */
export interface Values {
  readonly deskCode: string
  readonly documentType: AssistedDocumentType | ''
  readonly firstName: string
  readonly lastName: string
  readonly dateOfBirth: string
  readonly attestations: Readonly<Record<Attestation, boolean>>
}

/** InPersonCheck.tsx:66-70. */
export const EMPTY: Values = {
  deskCode: '', documentType: '', firstName: '', lastName: '', dateOfBirth: '',
  attestations: { patientPresent: false, originalDocumentSeen: false, photoMatchesPerson: false,
    codeShownOnPatientsOwnDevice: false, patientConsents: false },
}

/** InPersonCheck.tsx:72-83. What would be sent for these values, read as Identity reads them; the same values give the same request. */
export function requestOf(values: Values): AssistedVerificationInput {
  const dateOfBirth = values.dateOfBirth.trim()
  return {
    deskCode: normalizeDeskCode(values.deskCode) ?? values.deskCode.trim(),
    method: METHOD,
    documentType: values.documentType as AssistedDocumentType,
    document: { firstName: values.firstName.trim(), lastName: values.lastName.trim(), ...(dateOfBirth ? { dateOfBirth } : {}) },
    attestations: { patientPresent: true, originalDocumentSeen: true, photoMatchesPerson: true,
      codeShownOnPatientsOwnDevice: true, patientConsents: true },
  }
}

/** InPersonCheck.tsx:85-88. The values and the statements confirmed, as one string: the submission they make. */
export function signatureOf(values: Values): string {
  return JSON.stringify([requestOf(values), ATTESTATIONS.map(([key]) => values.attestations[key])])
}

/** InPersonCheck.tsx:90-91. */
export type FieldResult = 'match' | 'no_match' | 'not_in_record'
export type Mismatch = { firstName?: string; lastName?: string; dateOfBirth?: string }

/** InPersonCheck.tsx:93-97. */
const RESULT_WORDS: Record<FieldResult, string> = {
  match: 'matches',
  no_match: 'does not match',
  not_in_record: 'not on the NIN record, so not compared',
}

/** InPersonCheck.tsx:99-104. A field's result in words; anything but the three results, such as a record value, is never shown. */
export function resultWords(field: keyof Mismatch, result: string | undefined, typedDateOfBirth: boolean): string {
  if (field === 'dateOfBirth' && result === 'no_match' && !typedDateOfBirth) {
    return 'does not match. None was typed; type the date of birth on the document.'
  }
  return result && Object.hasOwn(RESULT_WORDS, result) ? RESULT_WORDS[result as FieldResult] : 'no result given'
}

/** Which of the three results a field was given, for its colour (its words say it). Null for anything else. */
export function knownResult(result: string | undefined): FieldResult | null {
  return result && Object.hasOwn(RESULT_WORDS, result) ? result as FieldResult : null
}

/** InPersonCheck.tsx:106-110. */
export const DESK_CODE_ENTRY = 'Enter the 10-character desk code shown on the patient’s phone.'
export const DATE_OF_BIRTH_ENTRY = 'Enter the whole date of birth as written on the document, or clear the field if the document shows none.'
export const STALE = 'This desk code can no longer be checked: another check came first, or the patient has a new code. Ask the patient for the code on their phone now, then check again.'
export const RETRY = 'The check could not be completed. Press Check again without changing the details: it is sent as the same check, so it is not counted twice.'
export const RETRY_PROOF = 'The check is recorded, but the patient’s registration could not be moved on. Press Check again without changing the details within 10 minutes: it is not counted twice.'

/** InPersonCheck.tsx:167-175 and 221. The other refusals before sending, and the desk code's own. */
export const DOCUMENT_TYPE_ENTRY = 'Choose the document you checked.'
export const FIRST_NAME_ENTRY = 'Enter the first name as written on the document.'
export const LAST_NAME_ENTRY = 'Enter the last name as written on the document.'
export const ATTESTATIONS_ENTRY = 'Confirm all five statements. If any is not true, do not check this patient.'
export const DESK_CODE_NOT_FOUND = 'No registration is waiting for this desk code. Ask the patient to show the code on their phone again.'

/** InPersonCheck.tsx:232, 235, 238, 241, 249, 254. What an answer says in the page's alert. */
export const NOT_AUTHORIZED = 'You cannot register patients in person at this facility. Ask a platform administrator: the facility must take part, and you need an active account, a sign-in confirmed with your authenticator, an attested clinical grant and an active membership here.'
export const PERMISSION_DENIED = 'Your role at this facility cannot check patients in person. Ask a platform administrator.'
export const DISABLED_FALLBACK = 'Registration at a facility is not available.'
export const NOTHING_RECORDED = 'Nothing was recorded.'
export const KEY_REUSED = 'This check was already sent with other details. Check the details, then send them again.'
export const SOME_REFUSED = 'Some details were refused. Check them, then send them again.'
export const NOT_COMPLETED = 'The check could not be completed.'

/** InPersonCheck.tsx:272-273. A match: the patient goes on, on their own phone. */
export const VERIFIED_TITLE = 'Checked. The patient can continue on their phone.'
export const VERIFIED_NEXT = 'On their own phone they add a phone number or email, choose a password, and then see their Health ID. If the phone still shows the desk code, ask them to open their registration again on that phone.'

/** InPersonCheck.tsx:278-280. A person who already has a Health ID. */
export const REGISTERED_TITLE = 'This person already has a Health ID'
export const REGISTERED_NEXT = 'Do not start a new registration for them. Their registration on the phone has ended; account recovery lets them sign in to the Health ID they have.'

/** InPersonCheck.tsx:342-348. The details do not match. */
export const MISMATCH_TITLE = 'The details do not match the NIN record'
export const MISMATCH_NEXT = 'Check the document. If only spelling or spacing differs, such as a hyphen or a space in a name, type it the way the document allows and check again; each check counts toward the daily limit. Otherwise do not register this patient.'

/** InPersonCheck.tsx:274 and 337. */
export const ANOTHER = 'Check another patient'
export const CHECK = 'Check the details'
export const CHECK_AGAIN = 'Check again'
export const CHECKING = 'Checking…'

/**
 * InPersonCheck.tsx:112-120. An answer that may or may not have been recorded: the same submission is sent again. A 503
 * ASSISTED_REGISTRATION_DISABLED is not one: the route is closed and nothing was recorded.
 */
export function outcomeUnknown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  if (caught.code === 'ASSISTED_REGISTRATION_DISABLED') return false
  return caught.status === 0 || caught.status === 408 || caught.status >= 500
}

/**
 * InPersonCheck.tsx:122-130. Whether the date control holds a date it cannot report: one partly typed, or impossible such
 * as 31 February. Its value is then empty, so without this the check would go without the date the staff member typed,
 * be counted, and be answered as if none was typed.
 */
export function dateOfBirthUnfinished(form: HTMLFormElement): boolean {
  const control = form.elements.namedItem('dateOfBirth')
  return control instanceof HTMLInputElement && control.validity.badInput
}

/** The label a document type is shown with. */
export function documentLabel(type: AssistedDocumentType | ''): string {
  return DOCUMENT_TYPES.find(([value]) => value === type)?.[1] ?? ''
}
