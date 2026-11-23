import { HidApiError } from '@hid/http'
import type { RegistrationCase } from '../../../staff/api'
import type { RefusedWork } from '../../../staff/refusedWork'
import { registrationErrorText } from '../../../staff/registrationFlow'
import { dateText } from '../parts/format'

/*
 * The classic Patient registration page (staff/routes/Registration.tsx as it is on main now), its rules and every word
 * it says, ported here word for word: that page is not exported in reusable pieces. Each constant names the line it
 * comes from (parity report 3.3-58 to 3.3-63). The words the design adds (its headings, "Create record", "Back to list")
 * are marked so.
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

/** A refusal in plain words, or the step's own fallback (Registration.tsx 12-14). Never Identity's own text. */
export function safeError(error: unknown, fallback: string) {
  return registrationErrorText(error, fallback)
}

/** The case's status in words (Registration.tsx 19-29). */
export function statusLabel(status: RegistrationCase['status']) {
  return ({
    pending_new_identity_approval: 'Needs approval',
    review_required: 'Possible match',
    resolved_existing_identity: 'Already on Health ID',
    linked_existing: 'Linked',
    approved_new_identity: 'New Health ID',
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

/** Registration.tsx 214: classic's heading of the page's own refusal, word for word, also the frame's at the address. */
export const UNAVAILABLE_TITLE = 'You can’t register patients here'
/**
 * The work the refusal names, in a sentence refusedWorkText (staff/refusedWork.ts) writes by who reads it. Screens name
 * no permission (the owner's rule), so the sentence under the heading says who to ask by role, not by permission. Receptionists and records
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

// ---- Whether NIN checks work (Registration.tsx 87, 100, 227-230) ----------------------------------------------
// Only when NIN checks are not working: a working service needs no card (Registration.tsx 227).

export const CHECK_AGAIN = 'Check again'
export const TRY_AGAIN = 'Try again'
export const CHECKING = 'Checking…'
export const CAPABILITY_LOADING = 'Checking NIN checks are working…'
export const CAPABILITY_FAILED_TITLE = 'Can’t check NINs right now'
export const CAPABILITY_FAILED = 'We couldn’t check whether NIN checks are working.'
/** Whether NIN checks work, in plain words: never the server's own state for them. */
export const NIN_OFF_TITLE = 'NIN checks are off'
/** Only where Identity offers no registration without a NIN either (a backend before hid-system 0130). */
export const NIN_NOT_ENABLED = 'New registrations can’t start until they’re back on.'
/** NIN checks are off and Identity takes a registration without a NIN (hid-system 0130): the desk is pointed to it. */
/** Said under NIN_OFF_TITLE, so it does not say again that NIN checks are off. */
export const NIN_OFF_WITHOUT_NIN = 'You can still register a new patient without a NIN: choose Create record, then Register without a NIN. Their record will show NIN Not Verified.'
/** The same, on the new form itself, above the form it points to. */
export const NIN_OFF_FORM_NOTICE = 'NIN checks are not available right now, so this patient is registered without a NIN. Their record will show NIN Not Verified.'

// ---- Check their NIN (Registration.tsx 123-160, 232-257) ------------------------------------------------------

/** Registration.tsx 233: classic's "1. Check their NIN", without the number: here it is the form's only step. */
export const START_TITLE = 'Check their NIN'
export const START_TEXT = 'Type it as it is on their NIN slip. It isn’t kept here.'
export const NIN_LABEL = 'NIN (11 digits)'
export const FIRST_LABEL = 'First name'
export const LAST_LABEL = 'Last name'
export const DOB_LABEL = 'Date of birth'
export const GENDER_LABEL = 'Gender (optional)'
/** Registration.tsx 239: the gender options (registrationFlow.ts REGISTRATION_GENDERS), in classic's order. */
export const GENDER_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ['', 'Not given'], ['female', 'Female'], ['male', 'Male'], ['intersex', 'Intersex'], ['other', 'Other'], ['unknown', 'Unknown'],
]
export const VERIFY = 'Check NIN'
export const VERIFYING = 'Checking…'
export const NIN_REFUSED = 'Enter the 11 digit NIN.'
export const NAME_DATE_REFUSED = 'Enter the patient’s name and date of birth.'
export const VERIFY_FAILED = 'We couldn’t check that NIN. Try again.'
/** A name or date of birth Identity refused before checking (400 NIN_DETAILS_INVALID), marked at each such field. */
export const NIN_DETAILS_FIELD = 'Check this against the NIN record.'
/** A NIN QoreID has no record of (422 NIN_NOT_VERIFIED, owner Q117), marked at the NIN field. */
export const NIN_NUMBER_FIELD = 'Check this number.'
/** Registration.tsx 152, 156. */
export const CASE_CREATED = 'NIN checked. See the result below.'
export const CASE_CREATED_RELOAD = 'NIN checked. Refresh to see the result.'

// ---- Register without a NIN (hid-system 0130, owner Q106; identity-api nin-registration.controller.ts) ----------

export const WITHOUT_NIN_TITLE = 'Register without a NIN'
export const WITHOUT_NIN_TEXT = 'Enter the patient’s name and date of birth as they give them, and why they are registered without a NIN. If nobody already registered could be the same person, the patient is registered straight away. Otherwise an approver at this facility reviews it first.'
export const REASON_LABEL = 'Why is there no NIN?'
export const SELECT_REASON = 'Choose a reason'
/** Under the phone when the patient is a child: the contact is optional, and goes together. */
export const CHILD_CONTACT_NOTE = 'Optional for a child. If you give any of the phone or address, give all of it.'
export const REGISTER_WITHOUT_NIN = 'Register patient'
export const REGISTERING = 'Registering…'
/** outcome `registered`: the patient has a Health ID now. */
export const REGISTERED_WITHOUT_NIN = 'The patient was registered and given a Health ID. Their record shows NIN Not Verified.'
/** outcome `sent_for_review`: no other person's details are shown. */
export const SENT_FOR_REVIEW = 'This may be someone who is already registered, so it was sent for review. An approver at this facility will decide before a record is made.'
/** Its case ID is put in Find registration case, whose button is LOAD_CASE ("Open"). */
export const WITHOUT_NIN_RELOAD = 'The registration was saved, but it could not be shown. Choose Open next to its case ID to see it.'
export const WITHOUT_NIN_FAILED = 'The patient could not be registered. Check the details and try again.'
/** On the record of a registration without a NIN that waits for an approver who did not start it. */
export const SENT_FOR_REVIEW_NOTICE = 'Sent for review. This may be someone who is already registered. An approver at this facility, other than the person who started it, will decide.'
export const NIN_FACT = 'NIN'
export const ninStatusText = (status: NonNullable<RegistrationCase['ninStatus']>) => (status === 'verified' ? 'NIN Verified' : 'NIN Not Verified')

/** identity-api registration-without-nin.service.ts WITHOUT_NIN_MESSAGES, by code: plain words, never Identity's own text. */
export const WITHOUT_NIN_PHONE_REQUIRED = 'Enter the patient’s phone number and address. Only a child can be registered without them.'
const WITHOUT_NIN_REFUSALS: Readonly<Record<string, string>> = {
  PHONE_REQUIRED: WITHOUT_NIN_PHONE_REQUIRED,
  NOT_A_CHILD: 'This date of birth makes the patient 18 or older. Choose another reason.',
  REGISTRATION_WITHOUT_NIN_INVALID: 'Some details are missing or not valid. Check them and try again.',
  VALIDATION_FAILED: 'Some details are missing or not valid. Check them and try again.',
  REGISTRATION_WITHOUT_NIN_DENIED: 'You cannot register patients at this facility.',
  REGISTRATION_WITHOUT_NIN_NOT_AVAILABLE: 'Registration without a NIN is not available at a demonstration or test facility.',
  REGISTRATION_WITHOUT_NIN_UNAVAILABLE: 'Registration without a NIN is not available right now. Try again in a minute.',
  IDEMPOTENCY_KEY_REUSED: 'This request was already sent with different details. Start a new registration.',
}

/** A refusal of a registration without a NIN in plain words, or its fallback. */
export function withoutNinErrorText(caught: unknown): string {
  if (caught instanceof HidApiError && Object.prototype.hasOwnProperty.call(WITHOUT_NIN_REFUSALS, caught.code)) {
    return WITHOUT_NIN_REFUSALS[caught.code]!
  }
  return safeError(caught, WITHOUT_NIN_FAILED)
}

// ---- Continue a registration (Registration.tsx 104-121, 219-226) -----------------------------------------------

/**
 * Health ID keeps no list of registrations to search, so one started on an earlier visit is continued by its
 * Registration ID, which each registration shows under "More details".
 */
export const CASE_ID_LABEL = 'Registration ID'
export const CASE_ID_HINT = 'Shown on the registration when it was started.'
export const LOAD_CASE = 'Open'
export const LOADING = 'Opening…'
export const REFRESH_CASE = 'Refresh'
export const REFRESHING = 'Refreshing…'
export const CASE_ID_REFUSED = 'Enter a valid registration case ID.'
export const CASE_LOAD_FAILED = 'We couldn’t open that registration.'

// ---- The case (Registration.tsx 259-300) -------------------------------------------------------------------------

/** A case by the person's name, as typed when it was started here; one reopened by its reference has no name to show. */
export const caseTitle = (name: string | null) => (name ? `Registration for ${name}` : 'Earlier registration')
/** When the case was started, or reopened, on this visit to the page. */
export const caseWhen = (started: boolean, at: string) => `${started ? 'Started' : 'Reopened'} ${dateText(at)}`
export const MORE_DETAILS = 'More details'
/** Registration.tsx 269: the ID that continues this registration later ("Continue a registration" asks for it). */
export const REFERENCE_LABEL = 'Registration ID'
export const REFERENCE_HINT = 'Note this down to reopen this registration on a later visit.'
/** Registration.tsx 276. */
export const REVIEW_NOTICE = 'This person may already be on Health ID. Pick the right one to link them.'
/** Why the design's "Register reviewed duplicate as distinct person" is off. */
export const NO_OVERRIDE = 'A new Health ID cannot be given once a possible match has been found.'
/** Registration.tsx 279: classic's "Can’t show the matches" alert, title and line. */
export const CANDIDATES_UNAVAILABLE = 'Can’t show the matches. Refresh to try again.'
/** Registration.tsx 278, 280. */
export const candidateLine = (dateOfBirth: string | null) => `Born ${dateOfBirth ?? 'unknown'}`
export const candidateOption = (fullName: string, dateOfBirth: string | null) => `${fullName} · ${dateOfBirth ?? 'date unknown'}`
/** Registration.tsx 284: by whether this member may give the Health ID. */
export const noCandidateNotice = (canApprove: boolean) =>
  `No match found. ${canApprove ? 'You can give them a new Health ID.' : 'Someone with approval rights must give them a new Health ID.'}`

/** Registration.tsx 170-173, 180-187, 280, 285. */
export const CANDIDATE_LABEL = 'Which person is it?'
export const SELECT_CANDIDATE = 'Choose'
export const LINK_REASON_LABEL = 'Why (for the record)'
export const LINK = 'Link to this person'
export const APPROVE_REASON_LABEL = 'Why (for the record)'
export const APPROVE = 'Create Health ID'
export const SAVING = 'Saving…'
export const CANDIDATE_REFUSED = 'Select a candidate returned by this registration case.'
export const REVIEW_REASON_REFUSED = 'Enter a review reason between 8 and 500 characters.'
export const APPROVED = 'New Health ID created.'
export const LINKED = 'Linked to the existing patient.'
export const REVIEW_FAILED = 'That didn’t save. Refresh and try again.'

/** Registration.tsx 199, 207, 210, 295-298: "No phone or app? Create their account". */
export const ENROLL_TITLE = 'Create their account'
export const ENROLL_TEXT = 'No phone or app? They get an email to set a password. Use their own email, not yours.'
export const EMAIL_LABEL = 'Their email'
export const ENROLL_REASON_LABEL = 'Why (for the record)'
export const ENROLL = 'Create account'
export const ENROLLING = 'Creating…'
export const ENROLL_REFUSED = 'Enter a valid email and an enrollment reason between 8 and 500 characters.'
export const ENROLLED = 'Account created. The patient will get an email to set their password.'
export const ENROLL_FAILED = 'We couldn’t create the account. They may already have one.'
export const enrolledText = (hid: string) => `Account created for ${hid}. They’ll get an email to finish.`

// ---- The design's words (design/ehr-target src/workflows.tsx, catalog.ts) -------------------------------------

export const CREATE_RECORD = 'Create record'
export const BACK_TO_LIST = 'Back to list'
/** workflows.tsx 69: a create view is headed "New " and the module's title. */
export const NEW_TITLE = 'New patient registration'
export const SAVED_RECORD = 'Saved record'
export const NO_ACTIONS = 'Nothing else to do here.'
export const NEXT_STEPS = 'Next steps'
/** Goes to Patients with the patient's Health ID filled in, as classic registration's "Find … and open their chart". */
export const OPEN_IN_PATIENTS = 'Open in Patients'
/**
 * The desk's contact for the patient and the Health ID they say they have (hid-system 0114): named, required fields,
 * whose labels are collected/deskFields.ts DESK_LABELS. The design's allergies are left to clinical records and its
 * "provisional local identity" is off (owner decisions D11, D12), so neither is shown.
 */
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
