import { isHidApiError } from '@hid/http'
import { getEnvironment } from '../../staff/env'
import type { ProviderEnrollmentAvailability, ProviderEnrollmentProfile } from '../../staff/api'

/*
 * Today's facility sign-up rules and words, which the blue registration keeps unchanged underneath. None of them is
 * exported from staff/routes/ProviderEnrollment.tsx (only organizationTypeNote, ORGANIZATION_TYPE_NOTES and the page
 * are), so each is ported here verbatim, with the source lines it came from. A change to today's page must be made
 * here too: the tests in __tests__/ehr-blue/signup pin the exact words.
 */

// ProviderEnrollment.tsx:22-23
export type Product = 'ehr' | 'migrate' | 'laboratory' | 'pharmacy'
export type OrganizationType = 'clinic' | 'hospital' | 'laboratory' | 'pharmacy' | 'other'

// ProviderEnrollment.tsx:25-30
export const products: Array<{ code: Product; label: string }> = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
  { code: 'migrate', label: 'Health ID Migrate' },
]

// ProviderEnrollment.tsx:32-38
export const organizationTypes: Array<{ value: OrganizationType; label: string }> = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'other', label: 'Other healthcare provider' },
]

// ProviderEnrollment.tsx:40-46
export const productOptions: Record<OrganizationType, Product[]> = {
  hospital: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  clinic: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
  laboratory: ['laboratory'],
  pharmacy: ['pharmacy'],
  other: ['ehr', 'laboratory', 'pharmacy', 'migrate'],
}

/** Identity's wait before another code (resendAfterSeconds), when its answer does not give one. (ProviderEnrollment.tsx:131-132) */
export const DEFAULT_RESEND_SECONDS = 60
/** The longest wait before a new code a Novu answer can give (up to about a day, P4 round 2), with room to spare. (:133-134) */
export const MAX_CODE_WAIT_SECONDS = 2 * 24 * 60 * 60

// ProviderEnrollment.tsx:136-137
const HOUR_MS = 60 * 60_000
export const DAY_MS = 24 * HOUR_MS

/**
 * Identity sends at most 5 codes an hour, and 15 a day, for one sign-up (hid-system 0056). Past either, main still
 * answers a start with a new challenge, but sends no code and keeps the last one in force, so the page sends no
 * start it knows would be one of those. Novu says itself whether a start sent a code (codeSent, P4 round 2), and
 * the page then follows its answer instead of counting. (ProviderEnrollment.tsx:139-145)
 */
const CODE_LIMITS = [{ count: 5, windowMs: HOUR_MS }, { count: 15, windowMs: DAY_MS }] as const

/**
 * An open sign-up holds its CAC number and product for the email it was started with until 24 hours after it
 * started (hid-system 0086, A8); after that another email's start closes it, from any network, since a lapse refuses
 * no one (R15). The page says before a start that another email can't finish an open sign-up it knows of yet.
 * (ProviderEnrollment.tsx:147-152)
 */
export const OPEN_SIGN_UP_MS = DAY_MS

// ProviderEnrollment.tsx:154-158
export const START_UNAVAILABLE = 'We couldn’t finish checking your details just now. Please try again in a minute. '
  + 'If an email with a code arrives meanwhile, ignore it: you’ll get a new code when you try again.'
export const STEP_UNAVAILABLE = 'Facility sign-up is temporarily unavailable. Please try again in a few minutes.'
export const CAC_CHECK_BUSY = 'We couldn’t check your CAC registration number just now. Please try again in a minute.'
export const OFFLINE = 'We couldn’t reach Health ID. Check your internet connection and try again.'

// ProviderEnrollment.tsx:160
export type Step = 'start' | 'resend' | 'verify' | 'activate'

/** How a message ends: with support's address (SupportContact). (ProviderEnrollment.tsx:162-163) */
export type Support = 'plain' | 'cac' | 'cac-otherwise' | 'held' | 'help'

/** What the page says or does about a refusal. (ProviderEnrollment.tsx:165-176) */
export type Refusal =
  | { kind: 'closed' }
  /** An outage, a timeout or a lost connection: the step may be tried again. */
  | { kind: 'unavailable'; text: string }
  | { kind: 'message'; text: string; support?: Support }
  /** Activation's enrollment session is gone: back to the details for a new code. */
  | { kind: 'session-expired' }
  /** Activation may have created the account already: sign in. */
  | { kind: 'maybe-active' }
  /** A panel in place of the step; `restart` offers a new sign-up with another email (Novu closed this one). */
  | { kind: 'help'; title: string; text: string; restart?: boolean }

/**
 * A refusal's own words for the administrator. Identity masks every 5xx detail
 * on Novu, and the production gateway replaces the whole body of any 502, 503
 * or 504 with its own UPSTREAM_UNAVAILABLE, so every status of 500 or more is
 * read as "temporarily unavailable", whatever its code. A closed sign-up is a
 * 423 for that reason (P4). (ProviderEnrollment.tsx:178-256, verbatim)
 */
export function refusalOf(reason: unknown, step: Step, activationUncertain: boolean, novu: boolean): Refusal {
  if (!isHidApiError(reason)) return { kind: 'message', text: 'We could not complete facility sign-up. Please try again.' }
  const { status, code } = reason
  if (status === 423 && code === 'PROVIDER_ENROLLMENT_UNAVAILABLE') return { kind: 'closed' }
  const starting = step === 'start' || step === 'resend'
  if (status === 0 && code === 'NETWORK_ERROR') return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : OFFLINE }
  if (status === 0 || status === 408 || status >= 500 || code === 'UPSTREAM_UNAVAILABLE') {
    return { kind: 'unavailable', text: starting ? START_UNAVAILABLE : STEP_UNAVAILABLE }
  }
  // QoreID itself is limiting CAC checks (a 429 Identity passes on). Nothing was sent; a retry at once would only
  // spend the day's CAC checks, so the page waits a minute as for an outage.
  if (code === 'QOREID_RATE_LIMITED') return { kind: 'unavailable', text: CAC_CHECK_BUSY }
  if (step === 'activate') {
    if (status === 401 && code === 'ORGANIZATION_COMPLETION_SESSION_INVALID') {
      // On Novu an earlier try may have created the account before its answer was lost: its session is then used up.
      return novu && activationUncertain ? { kind: 'maybe-active' } : { kind: 'session-expired' }
    }
    // Novu: the account was created, then the sign-in that follows it failed (401, or 405 under OIDC).
    if (novu && (status === 401 || status === 405)) return { kind: 'maybe-active' }
    // On Novu this refusal closes the sign-up, so a start with another email opens a new one at once (hid-system
    // R15). Main keeps it open for this email.
    if (code === 'PROVIDER_EMAIL_ALREADY_REGISTERED') return novu
      ? { kind: 'help', title: 'This email already has a Health ID account', restart: true,
        text: 'The administrator email already belongs to a Health ID account, for example a patient account or a staff '
          + 'account, so it can’t also be this facility’s administrator. This sign-up has been closed, so you can start '
          + 'again at once with another email address for the administrator.' }
      : { kind: 'help', title: 'This email already has a Health ID account',
        text: 'The administrator email already belongs to a Health ID account, for example a patient account, so it can’t '
          + 'also be this facility’s administrator. Signing up again with another email for the same CAC number won’t work '
          + 'either.' }
    if (code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'help', title: 'Health ID needs to check this organization',
      text: 'This organization can’t be set up automatically. It may already be registered with Health ID, for example '
        + 'for another product.' }
  }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_SIGN_OUT') return { kind: 'message',
    text: 'This browser is signed in to Health ID, for example to a patient account. Sign out of Health ID first, or '
      + 'open this page in a private (incognito) window, then try again.' }
  // Novu answers this for a CAC number and product already registered, held by a governed application or by an open
  // sign-up with another email, closed on the way, or whose sign-up from this email or network support closed in the
  // last 7 days (0086, A8 and R15; a lapse refuses no one). Only support can say which, so the page promises no wait.
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' && novu) return { kind: 'message', support: 'cac',
    text: 'This organization can’t be set up automatically right now: its CAC number may already be linked to Health '
      + 'ID, another sign-up for it may be in progress, or Health ID support may have recently closed a sign-up for it.' }
  if (code === 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' || code === 'ORGANIZATION_REVIEW_REQUIRED') return { kind: 'message',
    support: 'cac', text: 'This organization needs a check by Health ID before it can be set up, for example because '
      + 'its CAC number is already linked to Health ID or another sign-up for it is in progress.' }
  if (code === 'PROVIDER_ALREADY_REGISTERED') return { kind: 'message', support: 'plain',
    text: 'This organization is already registered with Health ID. If you are its administrator, sign in instead.' }
  if (code === 'PROVIDER_CAC_PROFILE_INCOMPLETE') return { kind: 'message', support: 'cac',
    text: 'We couldn’t set up your organization automatically from its CAC record: the record is missing details we '
      + 'need, or it doesn’t show the company as active.' }
  if (code === 'CAC_NOT_VERIFIED') return { kind: 'message', text: 'We couldn’t verify this CAC registration number. '
    + 'Check the number on your CAC certificate (it starts with RC, BN or IT) and try again.' }
  if (code === 'APPLICATION_RATE_LIMITED') return { kind: 'message',
    text: 'There have been too many sign-up attempts from your network. Please try again later.' }
  if (code === 'VERIFICATION_QUOTA_EXCEEDED') return { kind: 'message',
    text: 'The limit on CAC checks has been reached for now. Please try again later.' }
  if (code === 'VERSION_CONFLICT') return { kind: 'message',
    text: 'Your sign-up changed while we were working on it. Please try again.' }
  if (code === 'ORGANIZATION_COMPLETION_CODE_INVALID') return { kind: 'message',
    text: 'That code isn’t right, or it has expired. Check the latest email from Health ID and try again, or send a new code.' }
  if (code === 'ORIGIN_DENIED') return { kind: 'message',
    text: 'This site isn’t allowed to send facility sign-ups. Open Set up your facility from healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_') && code.endsWith('_MISMATCH')) return { kind: 'message',
    text: 'The security check was made for another Health ID site. Open Set up your facility from '
      + 'healthidentitydirectory.com and try again.' }
  if (code.startsWith('TURNSTILE_')) return { kind: 'message',
    text: 'The security check didn’t go through. Please complete it again, then retry.' }
  if (code === 'PROVIDER_ENROLLMENT_DENIED') return { kind: 'message', text: STEP_UNAVAILABLE }
  if (code === 'VALIDATION_FAILED') return { kind: 'message', text: 'Some of the details weren’t accepted. Check them and try again.' }
  return { kind: 'message', text: reason.message }
}

/**
 * The start's refusals about the organization behind the CAC number (blue only): the registration returns to its
 * Regulatory identity step with the words at the CAC field, as the design returns to the first failing step. Every
 * other refusal stays where the registration was submitted.
 */
export const CAC_REFUSALS: ReadonlySet<string> = new Set([
  'CAC_NOT_VERIFIED', 'PROVIDER_CAC_PROFILE_INCOMPLETE', 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW', 'ORGANIZATION_REVIEW_REQUIRED',
  'PROVIDER_ALREADY_REGISTERED',
])

/** Health ID support's address, from the build's support contact (a mailto: link). (ProviderEnrollment.tsx:258-263) */
export function supportAddress(): string | null {
  let contact: string | null = null
  try { contact = getEnvironment().supportContact } catch { /* a configuration problem is reported where the API is used */ }
  return contact?.startsWith('mailto:') ? contact.slice('mailto:'.length) : null
}

// ProviderEnrollment.tsx:293-299
export function isOrganizationType(value: string | null): value is OrganizationType {
  return organizationTypes.some(option => option.value === value)
}

export function isProduct(value: string | null): value is Product {
  return products.some(product => product.code === value)
}

/** Whole seconds until `at`, never below zero. (ProviderEnrollment.tsx:301-304) */
export function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000))
}

// ProviderEnrollment.tsx:306-308
export function seconds(count: number): string {
  return `${count} second${count === 1 ? '' : 's'}`
}

/** A wait in words: seconds, minutes, then hours. (ProviderEnrollment.tsx:310-315) */
export function waitWords(totalSeconds: number): string {
  if (totalSeconds <= 90) return seconds(totalSeconds)
  const minutes = Math.ceil(totalSeconds / 60)
  return minutes <= 90 ? `${minutes} minutes` : `about ${Math.ceil(minutes / 60)} hours`
}

/** What a start sends that Identity keys a sign-up on. (ProviderEnrollment.tsx:317-324) */
export interface StartDetails {
  productCode: Product
  organizationType: OrganizationType
  cacRegistrationNumber: string
  administratorName: string
  administratorEmail: string
}

/** Identity's sign-up (its application, and its codes) for a CAC number, product and administrator email. (:326-329) */
export function signUpKey(details: StartDetails): string {
  return `${details.cacRegistrationNumber}|${details.productCode}|${details.administratorEmail}`
}

/** What one open sign-up holds for its email: a CAC number and product (hid-system 0086). (:331-334) */
export function cacProductKey(details: StartDetails): string {
  return `${details.cacRegistrationNumber}|${details.productCode}`
}

/**
 * What a code carries besides its sign-up (Novu, R6): the facility type and administrator name of the start that sent
 * it. The account and organization take them from the code that confirms the email. A start that sends no code
 * stores its own type and name nowhere (0086 begin_self_service_provider_enrollment), so the code in force keeps its own.
 * (ProviderEnrollment.tsx:336-348)
 */
export interface CodeCarries {
  organizationType: OrganizationType
  administratorName: string
}

export function carriesOtherThan(details: StartDetails, carries: CodeCarries): boolean {
  return details.organizationType !== carries.organizationType || details.administratorName !== carries.administratorName
}

/**
 * Novu sent no code for changed details, and the code in force carries the earlier ones: Continue with the changes
 * waits until `until`, when Identity would send a code that carries them; the code in force can be entered with the
 * earlier details until `enterableUntil`. (ProviderEnrollment.tsx:350-362)
 */
export interface Unapplied {
  key: string
  challengeId: string
  carries: CodeCarries
  unsent: 'recent' | 'limit'
  until: number
  enterableUntil: number
}

/** When Identity would send another code, given when it sent the last ones (CODE_LIMITS); 0 when it would now. (:364-372) */
export function nextCodeAt(sentAt: readonly number[], now: number): number {
  let at = 0
  for (const { count, windowMs } of CODE_LIMITS) {
    const recent = sentAt.filter(sent => sent > now - windowMs).sort((a, b) => a - b)
    if (recent.length >= count) at = Math.max(at, recent[recent.length - count]! + windowMs)
  }
  return at > now ? at : 0
}

/**
 * What the password step shows from …/profile (Novu, P4 round 2); a missing or blank value is null, and so is a
 * facility type the page does not know. (ProviderEnrollment.tsx:374-396)
 */
export interface Registering {
  organizationName: string | null
  registrationNumber: string | null
  organizationType: OrganizationType | null
  administratorName: string | null
  administratorEmail: string | null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function registeringOf(answer: unknown): Registering {
  const value = (typeof answer === 'object' && answer !== null ? answer : {}) as Partial<Record<keyof ProviderEnrollmentProfile, unknown>>
  const organizationType = textOf(value.organizationType)
  return { organizationName: textOf(value.organizationName), registrationNumber: textOf(value.registrationNumber),
    organizationType: isOrganizationType(organizationType) ? organizationType : null,
    administratorName: textOf(value.administratorName), administratorEmail: textOf(value.administratorEmail) }
}

/** The facility type in the password step's sentence: "…, as a hospital, …". (ProviderEnrollment.tsx:398-405) */
const ORGANIZATION_TYPE_PHRASES: Readonly<Record<OrganizationType, string>> = {
  hospital: 'a hospital',
  clinic: 'a clinic',
  laboratory: 'a laboratory',
  pharmacy: 'a pharmacy',
  other: 'another kind of healthcare provider',
}

/** What the account will keep besides the organization (R6), for the password step. (ProviderEnrollment.tsx:407-412) */
export function registeringDetails(registering: Registering | null): string {
  if (!registering) return ''
  return (registering.organizationType ? `, as ${ORGANIZATION_TYPE_PHRASES[registering.organizationType]}` : '')
    + (registering.administratorName ? `, with ${registering.administratorName} as its administrator` : '')
}

// ProviderEnrollment.tsx:414-416
export function organizationTypeLabel(value: OrganizationType): string {
  return organizationTypes.find(option => option.value === value)?.label ?? value
}

/** The product's name in words (today's Product select's option labels). */
export function productLabel(value: Product): string {
  return products.find(product => product.code === value)?.label ?? value
}

/**
 * What Novu's availability answer means for the page. `{ open: false }` with reason 'closed', or with no reason
 * (Identity before P4 round 2, whose { open: false } meant closed), is closed; any other reason ('unavailable', a
 * fault) is not, so a fault never tells an applicant that sign-up is closed. A malformed answer shows the form.
 * (ProviderEnrollment.tsx:418-426)
 */
export function availabilityOf(answer: ProviderEnrollmentAvailability | null | undefined): 'open' | 'closed' | 'unavailable' {
  if (answer?.open !== false) return 'open'
  return (answer.reason ?? 'closed') === 'closed' ? 'closed' : 'unavailable'
}

/** What an accepted start did: sent a code, or sent none and left one that can still be entered, or none. (:428-429) */
export type StartOutcome = 'sent' | 'in-force' | 'none'
