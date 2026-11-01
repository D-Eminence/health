import type { RegistrationCase } from '../../../staff/api'
import { registrationErrorText } from '../../../staff/registrationFlow'

/*
 * Today's Patient registration page (staff/routes/Registration.tsx), its rules and every word it says, ported here
 * word for word: that page is not exported in reusable pieces. Each constant names the line it comes from. The words
 * the design adds (its headings, "Create record", "Back to list", "Not collected by Health ID yet") are marked so.
 */

/** The permission that opens the page (Registration.tsx 43, 215). */
export const WRITE_PERMISSION = 'identity.registration.write'
/** The permission for the case's decisions and account enrollment (Registration.tsx 44, 165, 194, 253, 255, 256). */
export const APPROVE_PERMISSION = 'identity.registration.approve'

/** A registration case ID as Identity issues it (Registration.tsx 9). */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** The statuses whose case has a Health ID, so an account may be enrolled (Registration.tsx 10). */
export const COMPLETED: ReadonlySet<RegistrationCase['status']> = new Set<RegistrationCase['status']>(
  ['approved_new_identity', 'linked_existing', 'resolved_existing_identity'])

/** A refusal in plain words, or the step's own fallback (Registration.tsx 12-14). Never Identity's own text. */
export function safeError(error: unknown, fallback: string) {
  return registrationErrorText(error, fallback)
}

/** The case's status in words (Registration.tsx 16-26). */
export function statusLabel(status: RegistrationCase['status']) {
  return ({
    pending_new_identity_approval: 'Awaiting new patient approval',
    review_required: 'Possible existing patient review',
    resolved_existing_identity: 'Verified existing patient',
    linked_existing: 'Linked to existing patient',
    approved_new_identity: 'New patient approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  })[status]
}

/** The case's possible existing patients (Registration.tsx 249). */
export function candidatesText(registration: RegistrationCase) {
  return registration.candidateCount > 0
    ? `${registration.candidateCount} possible existing patient${registration.candidateCount === 1 ? '' : 's'}.`
    : 'No possible existing patients reported.'
}

// ---- The page and its refusal -----------------------------------------------------------------------------------

/** Registration.tsx 215: the page's own refusal, also the frame's at the address. */
export const UNAVAILABLE_TITLE = 'Registration unavailable'
export const UNAVAILABLE_MESSAGE = 'This facility membership needs identity registration write permission.'

/** Registration.tsx 218: the page head. Today's title ends in a full stop; the design's headings have none. */
export const EYEBROW = 'Identity operations'
export const TITLE = 'Patient registration'
export const DESCRIPTION = 'Verify a NIN, review possible matches, and link the verified identity to a governed Health ID. Every step is tied to your active facility and recorded by the backend.'

// ---- Verification availability (Registration.tsx 220-227, 92, 106) ------------------------------------------

export const AVAILABILITY_TITLE = 'Verification availability'
export const CHECK_AGAIN = 'Check again'
export const CHECKING = 'Checking…'
export const CAPABILITY_LOADING = 'Checking the backend’s registration capability…'
export const CAPABILITY_FAILED = 'Registration capabilities could not be loaded.'
export const ninEnabledText = (state: string) => `NIN verification is enabled in ${state} mode.`
export const ninNotEnabledText = (state: string) =>
  `NIN verification is ${state}. New cases cannot be started here until the backend enables a verification provider.`

// ---- Start with verified identity (Registration.tsx 129-161, 229-239) --------------------------------------

export const START_TITLE = 'Start with verified identity'
export const START_TEXT = 'Enter the NIN and matching demographic claims. The NIN is sent directly to the identity service and is cleared from this form after a successful response.'
export const NIN_LABEL = 'National Identity Number'
export const FIRST_LABEL = 'First name'
export const LAST_LABEL = 'Last name'
export const DOB_LABEL = 'Date of birth'
export const GENDER_LABEL = 'Gender (optional)'
/** Registration.tsx 235: the gender options, in today's order. */
export const GENDER_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['', 'Not supplied'], ['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Unknown'],
]
export const VERIFY = 'Verify and create case'
export const VERIFYING = 'Verifying…'
export const NIN_REFUSED = 'Enter the 11 digit NIN.'
export const NAME_DATE_REFUSED = 'Enter the patient’s name and date of birth.'
export const VERIFY_FAILED = 'NIN verification could not be completed.'
export const CASE_CREATED = 'NIN verification created a governed registration case. Review its status before continuing.'
export const CASE_CREATED_RELOAD = 'Case created. Reload its details before reviewing it.'

// ---- Resume a registration case (Registration.tsx 110-127, 241-246) ---------------------------------------

export const FIND_TEXT = 'Use the case ID supplied when verification completed. The backend does not provide a searchable case list.'
export const CASE_ID_LABEL = 'Registration case ID'
export const LOAD_CASE = 'Load case'
export const LOADING = 'Loading…'
export const REFRESH_CASE = 'Refresh current case'
export const CASE_ID_REFUSED = 'Enter a valid registration case ID.'
export const CASE_LOAD_FAILED = 'The registration case could not be loaded.'

// ---- The case (Registration.tsx 248-258) -------------------------------------------------------------------------

export const caseTitle = (caseId: string) => `Case ${caseId}`
export const REVIEW_NOTICE = 'A possible existing patient was found. Only a listed candidate may be linked. This API does not support overriding the match review to create a new identity.'
/** The last sentence of REVIEW_NOTICE: why the design's "Register reviewed duplicate as distinct person" is off. */
export const NO_OVERRIDE = 'This API does not support overriding the match review to create a new identity.'
export const CANDIDATES_UNAVAILABLE = 'Candidate details are unavailable. Refresh this case before reviewing it.'
export const candidateLine = (dateOfBirth: string | null, patientId: string) => `Date of birth: ${dateOfBirth ?? 'Not provided'} · Patient ID: ${patientId}`
export const candidateOption = (fullName: string, dateOfBirth: string | null) => `${fullName} · ${dateOfBirth ?? 'date unknown'}`
export const NO_CANDIDATE_NOTICE = 'Verification found no candidate. An authorized reviewer may approve a new Health ID.'

export const CANDIDATE_LABEL = 'Candidate to link'
export const SELECT_CANDIDATE = 'Select a candidate'
export const LINK_REASON_LABEL = 'Review reason'
export const LINK = 'Link selected patient'
export const APPROVE_REASON_LABEL = 'Approval reason'
export const APPROVE = 'Approve new Health ID'
export const SAVING = 'Saving…'
export const CANDIDATE_REFUSED = 'Select a candidate returned by this registration case.'
export const REVIEW_REASON_REFUSED = 'Enter a review reason between 8 and 500 characters.'
export const APPROVED = 'A new Health ID was approved.'
export const LINKED = 'The verified identity was linked to the selected patient.'
export const REVIEW_FAILED = 'The case review could not be completed. Refresh the case before changing its decision.'

export const ENROLL_TITLE = 'Enroll patient account'
export const ENROLL_TEXT = 'This creates a pending account for a patient who does not already have one. The email must belong to the patient; contact verification and password setup follow separately.'
export const EMAIL_LABEL = 'Patient email'
export const ENROLL_REASON_LABEL = 'Enrollment reason'
export const ENROLL = 'Create pending patient account'
export const ENROLLING = 'Enrolling…'
export const ENROLL_REFUSED = 'Enter a valid email and an enrollment reason between 8 and 500 characters.'
export const ENROLLED = 'A pending patient account was created. Contact ownership and password setup still require verification.'
export const ENROLL_FAILED = 'Account enrollment could not be completed. The patient may already have an account.'
export const enrolledText = (hid: string) => `Pending account created for ${hid}. Contact verification is required.`

// ---- The design's words (design/ehr-target src/workflows.tsx, catalog.ts) -------------------------------------

export const CREATE_RECORD = 'Create record'
export const BACK_TO_LIST = 'Back to list'
/** workflows.tsx 69: a create view is headed "New " and the module's title. */
export const NEW_TITLE = 'New patient registration'
export const SAVED_RECORD = 'Saved record'
export const NO_ACTIONS = 'No further actions for your permission and this record state.'
export const NEXT_STEPS = 'Next steps'
/** Owner decision: a design field Health ID does not take is shown, disabled, with this hint. Never sent or kept. */
export const NOT_COLLECTED = 'Not collected by Health ID yet'
/** catalog.ts patients: the fields Health ID does not take. */
export const PHONE_LABEL = 'Phone'
export const ADDRESS_LABEL = 'Address'
export const ALLERGIES_LABEL = 'Recorded allergies'
export const PROVISIONAL_LABEL = 'Provisional local identity'
export const EXISTING_HID_LABEL = 'Existing Health ID (optional)'
/** workflows.tsx 251-276: a design action Health ID cannot do, shown disabled with today's reason (NO_OVERRIDE). */
export const DISTINCT_PERSON = 'Register reviewed duplicate as distinct person'
/** catalog.ts patients actions: shown disabled with a one-line reason. */
export const CORRECT_DEMOGRAPHICS = 'Correct demographics'
export const NO_CORRECTION = 'Health ID does not take demographic corrections on a registration case yet.'
/** The "Find registration case" card: today has no case list, so it lists what this visit found or made. */
export const FIND_TITLE = 'Find registration case'
export const VISIT_CAPTION = 'Registration cases'
export const NO_VISIT_TITLE = 'No registration cases opened yet'
export const NO_VISIT_MESSAGE = 'Cases you load or create here are listed until you leave this page.'
