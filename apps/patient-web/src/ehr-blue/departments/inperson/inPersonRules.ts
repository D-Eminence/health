import { isHidApiError } from '@hid/http'
import type { AssistedDocumentType, AssistedVerificationInput } from '../../../staff/api'

/*
 * The rules and words of the classic in-person check (staff/routes/InPersonCheck.tsx as it is on main now, after its
 * rewording on the redesign branch), ported word for word: that page is not exported in reusable pieces. Each block names
 * the lines it comes from (parity report 3.3-18 to 3.3-26). Identity decides every
 * check (hid-system main f9dbaf0: #85, migration 0094, ADR-063; INTERFACE_CONTRACT.md "Facility-assisted registration");
 * these only say what today's page says, and refuse what today's page refuses before anything is sent.
 */

/** InPersonCheck.tsx:29. What the page needs, as classic's. Never shown on screen. */
export const ASSISTED_REGISTRATION_PERMISSION = 'identity.patient.assisted_registration'

/** InPersonCheck.tsx:139-140. Classic's refusal, word for word, for someone this facility does not let check patients. */
export const UNAVAILABLE_TITLE = 'You can’t check patients in person here'
export const UNAVAILABLE_MESSAGE = 'Doctors and nurses at a taking-part facility can. Ask your administrator.'

/** staff/navigation.ts:19. The page's name in the menu. */
export const TITLE = 'In-person check'
/** InPersonCheck.tsx:268. The page heading and the line under it. */
export const PAGE_TITLE = 'Check a patient in person'
export const DESCRIPTION = 'For patients who can’t get a code on their NIN phone. You check their photo ID.'
/** InPersonCheck.tsx:289. The form's own (screen-reader) heading. */
export const FORM_TITLE = 'Check a patient'

/**
 * InPersonCheck.tsx:291-326. The three steps, their fields and hints. The method is fixed (a government photo ID seen in
 * person), so, as classic, it is said, not offered as a choice.
 */
export const STEP_CODE = 'The code on their phone'
export const CODE_LABEL = 'Code'
export const CODE_HINT = '10 letters and numbers. Spaces and dashes don’t matter.'
export const CODE_PLACEHOLDER = 'ABCD-EFGH-JK'
export const STEP_ID = 'Their photo ID'
export const STEP_ID_HINT = 'The original, not a copy or a photo of it.'
export const DOCUMENT_LABEL = 'Which ID?'
export const DOCUMENT_CHOOSE = 'Choose'
export const DETAILS_LEGEND = 'Type the details exactly as they are on the ID.'
export const DATE_OF_BIRTH_LABEL = 'Date of birth'
export const DATE_OF_BIRTH_HINT = 'If the ID shows one. Without it, the check may not match.'
export const STEP_CONFIRM = 'Confirm'
export const CONFIRM_LEGEND = 'Confirm each statement'

/** InPersonCheck.tsx:31-36. The documents Identity takes, in classic's order and words. */
export const DOCUMENT_TYPES: ReadonlyArray<readonly [AssistedDocumentType, string]> = [
  ['national_id_card', 'National ID card'],
  ['international_passport', 'International passport'],
  ['drivers_licence', 'Driver’s licence'],
  ['voters_card', 'Voter’s card'],
]

/** InPersonCheck.tsx:80. The one method Identity takes: sent, never offered as a choice. */
export const METHOD = 'government_photo_id_in_person'

export type Attestation = keyof AssistedVerificationInput['attestations']

/** InPersonCheck.tsx:39-45. The five statements, in classic's order and words. */
export const ATTESTATIONS: ReadonlyArray<readonly [Attestation, string]> = [
  ['patientPresent', 'The patient is here in person.'],
  ['originalDocumentSeen', 'I’ve seen the original ID, not a copy or photo.'],
  ['photoMatchesPerson', 'The photo on the ID is this person.'],
  ['codeShownOnPatientsOwnDevice', 'The code is on their own phone.'],
  ['patientConsents', 'They agree to this check against their NIN.'],
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

/** InPersonCheck.tsx:96-100. */
const RESULT_WORDS: Record<FieldResult, string> = {
  match: 'matches',
  no_match: 'doesn’t match',
  not_in_record: 'not on their NIN, so not checked',
}

/** InPersonCheck.tsx:102-107. A field's result in words; anything but the three results, such as a record value, is never shown. */
export function resultWords(field: keyof Mismatch, result: string | undefined, typedDateOfBirth: boolean): string {
  if (field === 'dateOfBirth' && result === 'no_match' && !typedDateOfBirth) {
    return 'doesn’t match. None was typed; type the date on the ID.'
  }
  return result && Object.hasOwn(RESULT_WORDS, result) ? RESULT_WORDS[result as FieldResult] : 'no result given'
}

/** Which of the three results a field was given, for its colour (its words say it). Null for anything else. */
export function knownResult(result: string | undefined): FieldResult | null {
  return result && Object.hasOwn(RESULT_WORDS, result) ? result as FieldResult : null
}

/** InPersonCheck.tsx:109-113. */
export const DESK_CODE_ENTRY = 'Type the 10-character code on their phone.'
export const DATE_OF_BIRTH_ENTRY = 'Type the full date as it is on the ID, or leave it empty if there isn’t one.'
export const STALE = 'That code has changed. Ask for the code on their phone now, then check again.'
export const RETRY = 'That didn’t go through. Press Check again without changes. It won’t count twice.'
export const RETRY_PROOF = 'Saved, but their sign-up didn’t move on. Press Check again within 10 minutes, without changes.'

/** InPersonCheck.tsx:170-178 and 223. The other refusals before sending, and the desk code's own. */
export const DOCUMENT_TYPE_ENTRY = 'Choose which ID you looked at.'
export const FIRST_NAME_ENTRY = 'Type the first name as it is on the ID.'
export const LAST_NAME_ENTRY = 'Type the last name as it is on the ID.'
export const ATTESTATIONS_ENTRY = 'Tick all five. If any isn’t true, stop here.'
export const DESK_CODE_NOT_FOUND = 'No sign-up is waiting for this code. Ask them to show the code again.'

/** InPersonCheck.tsx:234-256. What an answer says in the page's alert, under classic's alert title. */
export const ERROR_TITLE = 'That didn’t work'
export const NOT_AUTHORIZED = 'You can’t check patients in person here. Ask Health ID support to set you up.'
export const ROLE_REFUSED = 'Your role here can’t check patients in person. Ask your administrator.'
export const DISABLED = 'Registration at a facility is not available. Nothing was recorded.'
export const KEY_REUSED = 'This was already sent with different details. Check them and try again.'
export const SOME_REFUSED = 'Some details weren’t accepted. Check them and try again.'
export const NOT_COMPLETED = 'The check could not be completed.'
export const LIMITED = 'The daily limit of in-person checks has been reached. Try again later.'

/** InPersonCheck.tsx:273-274. A match: the patient goes on, on their own phone. */
export const VERIFIED_TITLE = 'Checked'
export const VERIFIED_NEXT = 'They can finish on their phone now. If it still shows the code, ask them to open their sign-up again.'

/** InPersonCheck.tsx:281-283. A person who already has a Health ID. */
export const REGISTERED_TITLE = 'They already have a Health ID'
export const REGISTERED_NEXT = 'Don’t register them again. They can get back into their account with “Forgot password”.'

/** InPersonCheck.tsx:337-345. The details do not match. */
export const MISMATCH_TITLE = 'The details don’t match their NIN'
export const MISMATCH_NEXT = 'If only a space or hyphen differs, type it as the ID shows and check again. Otherwise, don’t register them.'

/** InPersonCheck.tsx:275 and 349. */
export const ANOTHER = 'Check another patient'
export const CHECK = 'Check details'
export const CHECK_AGAIN = 'Check again'
export const CHECKING = 'Checking…'

/**
 * InPersonCheck.tsx:115-123. An answer that may or may not have been recorded: the same submission is sent again. A 503
 * ASSISTED_REGISTRATION_DISABLED is not one: the route is closed and nothing was recorded.
 */
export function outcomeUnknown(caught: unknown): boolean {
  if (!isHidApiError(caught)) return true
  if (caught.code === 'ASSISTED_REGISTRATION_DISABLED') return false
  return caught.status === 0 || caught.status === 408 || caught.status >= 500
}

/**
 * InPersonCheck.tsx:125-133. Whether the date control holds a date it cannot report: one partly typed, or impossible such
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
