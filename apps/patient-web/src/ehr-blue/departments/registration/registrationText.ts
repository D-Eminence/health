import { isHidApiError } from '@hid/http'
import type { RegistrationCase } from '../../../staff/api'
import type { RefusedWork } from '../../../staff/refusedWork'
import { dateText } from '../parts/format'

/*
 * Today's Patient registration page (staff/routes/Registration.tsx), its rules and every word it says, ported here
 * word for word: that page is not exported in reusable pieces. Each constant names the line it comes from. The words
 * the design adds (its headings, "Create record", "Back to list", "Not collected by Health ID yet") are marked so.
 * Screens use plain words (the owner's rule): no server terms, no case id or version on screen, except the case's
 * reference under "More details", kept so a registration can be reopened on a later visit.
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

/** A refusal's own message, or the step's fallback (Registration.tsx 12-14). Not refusalText: today says no more. */
export function safeError(error: unknown, fallback: string) {
  return isHidApiError(error) ? error.message : fallback
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

/** Registration.tsx 215: the heading of the page's own refusal, also the frame's at the address. */
export const UNAVAILABLE_TITLE = 'Registration unavailable'
/**
 * The work the refusal names, in a sentence refusedWorkText (staff/refusedWork.ts) writes by who reads it. Screens name
 * no permission (the owner's rule), so it replaces today's words, which named the one lacking. Receptionists and records
 * officers both register patients (the owner's answer, 2 Nov 2026), so a facility's own administrator is told to add
 * either, and everyone else to ask the administrator for either role. Only a hospital or a clinic gets it: sign-up
 * promises the clinical record to them alone (ProviderEnrollment.tsx ORGANIZATION_TYPE_NOTES). A laboratory or pharmacy
 * never does, as registration stays in the EHR (the owner's rule); an "other" facility agrees its access with Health ID
 * support, so the refusal never promises it: there, nobody is told to ask for either role, as neither would bring it.
 * Nor is someone who holds one of them already.
 */
export const REGISTRATION_WORK: RefusedWork = {
  name: 'Patient registration', work: 'registering patients', doneBy: ['receptionist', 'records_officer'], askForRole: true,
  gets: new Set(['hospital', 'clinic']),
}

/** Registration.tsx 218: the page head, in plain words. The design's headings have no full stop. */
export const EYEBROW = 'Patients'
export const TITLE = 'Patient registration'
export const DESCRIPTION = 'Check a patient’s NIN, look at possible matches, then give them a new Health ID or link them to the one they already have. Every step is saved for your facility.'

// ---- Verification availability (Registration.tsx 220-227, 92, 106) ------------------------------------------

export const AVAILABILITY_TITLE = 'Verification availability'
export const CHECK_AGAIN = 'Check again'
export const CHECKING = 'Checking…'
export const CAPABILITY_LOADING = 'Checking whether NIN checks are working…'
export const CAPABILITY_FAILED = 'Registration capabilities could not be loaded.'
/** Whether NIN checks work, in plain words: never the server's own state for them. */
export const NIN_ENABLED = 'NIN checks are working.'
export const NIN_NOT_ENABLED = 'NIN checks are not available right now, so new registrations cannot be started here. Try again later.'

// ---- Start with verified identity (Registration.tsx 129-161, 229-239) --------------------------------------

export const START_TITLE = 'Start with verified identity'
export const START_TEXT = 'Enter the patient’s NIN, with their name and date of birth as they give them. The NIN is only used for the check, and is cleared from this form once the check is done.'
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
export const CASE_CREATED = 'The NIN was checked and the registration was started. Review it before continuing.'
export const CASE_CREATED_RELOAD = 'The registration was started, but it could not be shown. Choose Load case to open it.'

// ---- Resume a registration case (Registration.tsx 110-127, 241-246) ---------------------------------------

/**
 * Health ID keeps no list of registrations to search, so one started on an earlier visit is reopened by its reference,
 * which each registration shows under "More details".
 */
export const FIND_TEXT = 'To reopen a registration started earlier, enter its reference. Each registration shows its reference under More details.'
export const CASE_ID_LABEL = 'Reference'
export const LOAD_CASE = 'Load case'
export const LOADING = 'Loading…'
export const REFRESH_CASE = 'Refresh current case'
export const CASE_ID_REFUSED = 'Enter the reference exactly as it is shown on the registration.'
export const CASE_LOAD_FAILED = 'The registration case could not be loaded.'

// ---- The case (Registration.tsx 248-258) -------------------------------------------------------------------------

/** A case by the person's name, as typed when it was started here; one reopened by its reference has no name to show. */
export const caseTitle = (name: string | null) => (name ? `Registration for ${name}` : 'Earlier registration')
/** When the case was started, or reopened, on this visit to the page. */
export const caseWhen = (started: boolean, at: string) => `${started ? 'Started' : 'Reopened'} ${dateText(at)}`
export const MORE_DETAILS = 'More details'
export const REFERENCE_LABEL = 'Reference'
export const REFERENCE_HINT = 'Note this down to reopen this registration on a later visit.'
export const REVIEW_NOTICE = 'A possible existing patient was found. Only a listed patient may be linked. A new Health ID cannot be given once a possible match has been found.'
/** The last sentence of REVIEW_NOTICE: why the design's "Register reviewed duplicate as distinct person" is off. */
export const NO_OVERRIDE = 'A new Health ID cannot be given once a possible match has been found.'
export const CANDIDATES_UNAVAILABLE = 'The possible matches could not be shown. Refresh this registration before reviewing it.'
export const candidateLine = (dateOfBirth: string | null) => `Date of birth: ${dateOfBirth ?? 'Not provided'}`
export const candidateOption = (fullName: string, dateOfBirth: string | null) => `${fullName} · ${dateOfBirth ?? 'date unknown'}`
export const NO_CANDIDATE_NOTICE = 'No possible match was found. Someone allowed to approve can give a new Health ID.'

export const CANDIDATE_LABEL = 'Patient to link'
export const SELECT_CANDIDATE = 'Choose a patient'
export const LINK_REASON_LABEL = 'Review reason'
export const LINK = 'Link selected patient'
export const APPROVE_REASON_LABEL = 'Approval reason'
export const APPROVE = 'Approve new Health ID'
export const SAVING = 'Saving…'
export const CANDIDATE_REFUSED = 'Choose one of the patients listed for this registration.'
export const REVIEW_REASON_REFUSED = 'Enter a review reason between 8 and 500 characters.'
export const APPROVED = 'A new Health ID was approved.'
export const LINKED = 'The patient was linked to their Health ID.'
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
export const NO_ACTIONS = 'Nothing else to do here.'
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
export const NO_VISIT_MESSAGE = 'Registrations you start or reopen here are listed until you leave this page.'
