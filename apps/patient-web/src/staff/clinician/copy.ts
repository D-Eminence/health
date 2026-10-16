import { isHidApiError } from '@hid/http'
import type { ClinicianAccessState, ClinicianApplicationState, ClinicianApplicationView, ClinicianDecisionCode,
  ClinicianProfession, ClinicianRegulatorCode } from '../clinicianApplicationApi'

/**
 * The words of clinician self sign-up and its status page (hid-system ADR-066).
 * Every state and decision is said in fixed words chosen here: an
 * administrator's own notes never reach the applicant, and nothing is called
 * verified or approved before Identity says so.
 */

export const PROFESSION_CHOICE: Readonly<Record<ClinicianProfession, string>> = {
  doctor: 'Doctor (medical or dental practitioner)',
  nurse: 'Nurse or midwife',
}
export const PROFESSION_NAME: Readonly<Record<ClinicianProfession, string>> = { doctor: 'doctor', nurse: 'nurse or midwife' }
export const REGULATOR_NAME: Readonly<Record<ClinicianRegulatorCode, string>> = {
  MDCN: 'Medical and Dental Council of Nigeria (MDCN)',
  NMCN: 'Nursing and Midwifery Council of Nigeria (NMCN)',
}

/** The same words for every address: whether a code was really sent is never said. */
export const codeSentCopy = (email: string) =>
  `If this address can be used, we've sent a 6-digit code to ${email}. It expires in 10 minutes.`
export const statusCodeSentCopy = (email: string) =>
  `If this address has a clinician application, we've sent a 6-digit code to ${email}. It expires in 10 minutes.`

export const FACTOR_UNPROVEN = 'Your authenticator was set up at platform sign-in. Contact HID support to reset it.'
export const MAINTENANCE = 'Health ID is under maintenance. Try again later.'
export const REQUIRES_SIGN_OUT = "You're signed in to Health ID in this browser. Sign out, then come back to apply."
export const SECURITY_CHECK = 'Complete the security check again.'
export const SECURITY_CHECK_UNAVAILABLE = "The security check isn't available right now. Try again in a few minutes."
export const SIGNUP_CLOSED = "New clinician applications aren't open right now."
/** A form that keeps what was typed when intake has closed (sign-up's search and submit). */
export const SIGNUP_CLOSED_KEPT = `${SIGNUP_CLOSED} Your details are still here; try again later.`
/**
 * Intake closed while applying to another facility. Since hid-system 9e981e4 a closed intake is answered before the
 * capability, so the status page reads the applications again to learn whether it is still open.
 */
export const SIGNUP_CLOSED_NOT_SENT = "New clinician applications aren't open right now, so no application was sent."
/**
 * A submission or another application refused by a quota: the network's, Health ID's, or (hid-system 9e981e4) the
 * platform's daily cap met as the application is created. Which one is not said, and no countdown is shown.
 */
export const APPLICATIONS_LIMITED = 'Too many applications have been sent, from your network or to Health ID today. '
  + 'Your details are still here; try again later.'
/**
 * The facility searches of this capability are spent (hid-system 7cd8038: 30 per draft or ready capability, then 429
 * CLINICIAN_APPLICATION_SEARCH_LIMITED with no Retry-After). They never come back, so neither waiting nor searching
 * again helps; a new capability does: on sign-up, the email confirmed again (the details stay), and on the status page,
 * a new code once the page is closed (the apply form is not kept).
 */
export const SIGNUP_SEARCHES_USED = "You've used all the facility searches for this email confirmation. "
  + 'To search again, confirm your email again: your details stay on this page.'
export const STATUS_SEARCHES_USED = "You've used all the facility searches for this page. To search again, close this page, "
  + "then enter your email for a new code; what you've typed here isn't kept."
export const FACILITY_UNAVAILABLE = "This facility can't accept clinicians on Health ID right now. Choose another or ask your facility administrator."
export const FACILITY_BUSY = 'This facility has many applications waiting. Try again in a few days or contact HID support.'
export const ACCOUNT_INELIGIBLE = "This account can't apply for a clinical role. Contact HID support."
/** The page's account was disabled or is no longer active (403 CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE on a read or a withdrawal). */
export const ACCOUNT_UNAVAILABLE = "This account can't be used for clinician applications. Contact HID support."
/**
 * An approved clinician, or a facility's staff member, whose authenticator was
 * reset sets it up again only at staff sign-in (403
 * CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED): Identity's own fixed words.
 */
export const STAFF_SIGN_IN_REQUIRED = 'Your authenticator was reset. Sign in to the provider portal to set it up again, or contact HID support.'
export const PAGE_EXPIRED = 'For your security, this page closed after 30 minutes. Enter your email to continue.'
export const APPLICATION_CHANGED = 'This application changed; here is its current state.'

/** Why another facility cannot be applied to (P14 refusals, and the account view's applyRefusal). */
export const APPLY_REFUSAL: Readonly<Record<string, string>> = {
  CLINICIAN_APPLICATION_ROLE_CONFLICT: "A facility administrator account can't hold a clinical role at its own facility. "
    + 'Sign up again with a different email address for your clinician account.',
  CLINICIAN_APPLICATION_MEMBERSHIP_EXISTS: 'You already work at this facility on Health ID.',
  CLINICIAN_APPLICATION_ALREADY_OPEN: 'You already have an open application for this facility.',
  CLINICIAN_APPLICATION_LIMIT_REACHED: 'You have too many applications open. Wait for a decision or withdraw one.',
  CLINICIAN_APPLICATION_FACILITY_BUSY: FACILITY_BUSY,
  CLINICIAN_APPLICATION_FACILITY_UNAVAILABLE: FACILITY_UNAVAILABLE,
  CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE: ACCOUNT_INELIGIBLE,
  CLINICIAN_SIGNUP_CLOSED: SIGNUP_CLOSED,
}

/** The code of a refusal, or null for anything that is not an answer of Identity's. */
export function codeOf(caught: unknown): string | null {
  return isHidApiError(caught) ? caught.code : null
}

/** A refusal that ends nothing: the page keeps what was typed and the step can be sent again. */
export function isUnavailable(caught: unknown): boolean {
  return !isHidApiError(caught) || caught.status === 0 || caught.status === 408 || caught.status >= 500
}

/**
 * The words for refusals every step can meet; `fallback` for anything else
 * (an outage included: nothing is ended by it). `rateLimited` is the step's
 * own: Identity's quota answers say when to try again only in a header, and no
 * countdown is shown.
 */
export function refusalCopy(caught: unknown, fallback: string, rateLimited = 'Too many attempts. Try again later.'): string {
  const code = codeOf(caught)
  if (code === null) return fallback
  if (code.startsWith('TURNSTILE_')) return code === 'TURNSTILE_UNAVAILABLE' ? SECURITY_CHECK_UNAVAILABLE : SECURITY_CHECK
  switch (code) {
    case 'CLINICIAN_APPLICATION_RATE_LIMITED': return rateLimited
    case 'PLATFORM_MAINTENANCE': return MAINTENANCE
    case 'CLINICIAN_APPLICATION_REQUIRES_SIGN_OUT': return REQUIRES_SIGN_OUT
    case 'STAFF_MFA_FACTOR_UNPROVEN': return FACTOR_UNPROVEN
    case 'CLINICIAN_APPLICATION_STAFF_SIGN_IN_REQUIRED': return STAFF_SIGN_IN_REQUIRED
    case 'VERSION_CONFLICT': return APPLICATION_CHANGED
  }
  return APPLY_REFUSAL[code] ?? fallback
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' })
const LAGOS_DAY = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' })

/**
 * Today's date (`YYYY-MM-DD`) in Lagos, where Identity reads licence and
 * verification dates, whatever the device's own time zone.
 */
export function lagosToday(now = new Date()): string {
  const parts = LAGOS_DAY.formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** A date as applicants in Nigeria read it; nothing for a value Identity did not give. */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : DATE.format(date)
}

export const STATE_LABEL: Readonly<Record<ClinicianApplicationState, string>> = {
  awaiting_authenticator: 'Waiting for your authenticator',
  submitted: 'Received',
  under_review: 'Licence checked',
  approved: 'Approved',
  rejected: 'Not approved',
  withdrawn: 'Withdrawn',
  expired: 'Closed',
}

/** What a decision's words name: the regulator's code and the facility. */
type DecisionSubject = { regulator: { code: string }; facility: { name: string } }

const DECISION_COPY: Readonly<Record<ClinicianDecisionCode, (view: DecisionSubject) => string>> = {
  licence_not_verified: view => `We could not confirm your licence on the ${view.regulator.code} register.`,
  licence_not_current: view => `Your licence is not current on the ${view.regulator.code} register.`,
  details_mismatch: view => `The licence details you gave don't match the ${view.regulator.code} register. `
    + 'Apply again with the details exactly as on your licence.',
  identity_not_confirmed: () => 'We could not confirm that this licence belongs to you. Contact HID support if you think this is wrong.',
  employment_not_confirmed: view => `${view.facility.name} did not confirm that you work there.`,
  facility_not_available: view => `${view.facility.name} cannot accept new clinicians on Health ID at the moment.`,
  duplicate: () => 'You already have access, or another application, for this facility.',
  existing_account: () => 'This licence already belongs to another Health ID account. Sign in with that account, '
    + 'or contact HID support to add this facility to it.',
  other: () => 'Your application was not approved. Contact HID support for details.',
}

/**
 * What a rejection with `code` tells the applicant on the status page. The
 * platform console shows it to the administrator choosing the code (A5).
 */
export function decisionCopy(code: ClinicianDecisionCode, subject: DecisionSubject): string {
  return DECISION_COPY[code](subject)
}

const ACCESS_COPY: Readonly<Record<ClinicianAccessState, (view: ClinicianApplicationView, decided: string) => string>> = {
  active: (view, decided) => `Approved on ${decided}. You can sign in to the provider portal as a ${PROFESSION_NAME[view.profession]} `
    + `at ${view.facility.name} with your password and authenticator app.`,
  lapsed: (view, decided) => `Approved on ${decided}. Your access at ${view.facility.name} is paused because its licence check has expired. `
    + 'Contact HID support to renew it.',
  ended: (view, decided) => `Approved on ${decided}. Your access at ${view.facility.name} has ended.`,
  account_unavailable: (_view, decided) => `Approved on ${decided}. Your account can't sign in at the moment. Contact HID support.`,
}

/** What an application's state means for the applicant, in fixed words (design §8). */
export function stateCopy(view: ClinicianApplicationView): string[] {
  switch (view.state) {
    case 'awaiting_authenticator':
      return ['Set up your authenticator app to send this application for review. HID can\'t review it until you do. '
        + `We keep applications open for 30 days (until ${formatDate(view.expiresAt) ?? 'the end of that time'}).`]
    case 'submitted':
      return [`Application received. An HID administrator will check your licence with ${view.regulator.code}, call you to confirm it's you, `
        + `and confirm with ${view.facility.name} that you work there. You can't sign in to the provider portal until two HID `
        + 'administrators approve it.']
    case 'under_review':
      return ['Your licence has been checked. A second HID administrator must confirm it before your access is turned on.']
    case 'approved': {
      const decided = formatDate(view.decidedAt) ?? 'a date not shown'
      const access = view.accessState && Object.hasOwn(ACCESS_COPY, view.accessState) ? view.accessState : 'account_unavailable'
      return [ACCESS_COPY[access](view, decided)]
    }
    case 'rejected': {
      const code = view.decisionCode && Object.hasOwn(DECISION_COPY, view.decisionCode) ? view.decisionCode : 'other'
      const sentence = DECISION_COPY[code](view)
      // After an identity refusal the account cannot apply again, so it is not offered.
      return code === 'identity_not_confirmed' ? [sentence] : [sentence, 'You can apply again once the problem is fixed.']
    }
    case 'withdrawn': return ['You withdrew this application.']
    case 'expired': return ['This application closed because it wasn\'t decided within 30 days. You can apply again.']
  }
  return ['This application\'s state can\'t be shown here. Contact HID support.']
}
