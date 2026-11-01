import type { DemoSubmission } from './commercial-api'
import { isContactEmail } from './contact-email'
import { PlainError } from '@hid/http'

/**
 * A facility referral ("Earn with Health ID").
 *
 * hid-system has no referral route, so a referral is sent as a demo request
 * (POST /commercial/demo-requests, which the public site may already call),
 * tagged `sourceSection: 'referral'`. The referrer is the contact: they gave
 * their details and consent, and the Health ID team replies to them. The
 * facility's own contact, if given, travels only in the message, and only
 * after the referrer confirms the facility knows about the introduction.
 *
 * Rewards are tracked and paid by the Health ID team, not by this site.
 */

export const REFERRAL_SECTION = 'referral'
export const REFERRAL_CTA = 'Refer a facility'

export const FACILITY_TYPES = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'other', label: 'Other healthcare provider' },
] as const

export type FacilityType = (typeof FACILITY_TYPES)[number]['value']

export interface ReferralRequest {
  readonly referrerName: string
  readonly referrerEmail: string
  readonly referrerPhone: string
  readonly facilityName: string
  readonly facilityType: FacilityType | ''
  readonly facilityLocation: string
  readonly facilityContact: string
  readonly consent: boolean
}

export type ReferralErrors = Partial<Record<keyof ReferralRequest, string>>

export const EMPTY_REFERRAL: ReferralRequest = {
  referrerName: '', referrerEmail: '', referrerPhone: '', facilityName: '', facilityType: '',
  facilityLocation: '', facilityContact: '', consent: false,
}

/** The form's two steps: the facility first, then the referrer. */
export const FACILITY_FIELDS = ['facilityName', 'facilityType', 'facilityLocation', 'facilityContact'] as const
export const REFERRER_FIELDS = ['referrerName', 'referrerEmail', 'referrerPhone', 'consent'] as const

/** The errors that belong to one step, in the order the fields appear. */
export function stepErrors(errors: ReferralErrors, fields: readonly (keyof ReferralRequest)[]): ReferralErrors {
  return Object.fromEntries(fields.filter(field => errors[field]).map(field => [field, errors[field]]))
}

/** hid-system's demo-request message limit. */
const MESSAGE_MAX = 2000

/** What each field says when its value cannot be sent, whether this site or hid-system refuses it. */
const PROBLEMS = {
  referrerName: 'Enter your full name.',
  referrerEmail: 'Enter a valid email address.',
  referrerPhone: 'Enter a valid phone number.',
  facilityName: 'Enter the facility’s name.',
  facilityType: 'Choose the type of facility.',
} as const satisfies ReferralErrors

export function validateReferral(request: ReferralRequest): ReferralErrors {
  const errors: ReferralErrors = {}
  const name = request.referrerName.trim()
  if (name.length < 2 || name.length > 160) errors.referrerName = PROBLEMS.referrerName
  const email = request.referrerEmail.trim()
  if (!isContactEmail(email)) errors.referrerEmail = PROBLEMS.referrerEmail
  if (request.referrerPhone.trim() && !/^\+?[0-9 ()-]{7,32}$/.test(request.referrerPhone.trim())) {
    errors.referrerPhone = PROBLEMS.referrerPhone
  }
  const facility = request.facilityName.trim()
  if (facility.length < 2 || facility.length > 200) errors.facilityName = PROBLEMS.facilityName
  if (!FACILITY_TYPES.some(type => type.value === request.facilityType)) errors.facilityType = PROBLEMS.facilityType
  if (request.facilityLocation.trim().length > 120) errors.facilityLocation = 'Keep the location under 120 characters.'
  if (request.facilityContact.trim().length > 300) errors.facilityContact = 'Keep this under 300 characters.'
  if (!request.consent) errors.consent = 'Confirm the facility knows you are introducing them.'
  return errors
}

/** The referral's fields by the names hid-system's CreateDemoRequestDto gives them. */
const BACKEND_FIELDS: Readonly<Record<string, keyof typeof PROBLEMS>> = {
  contactName: 'referrerName',
  contactEmail: 'referrerEmail',
  contactPhone: 'referrerPhone',
  organizationName: 'facilityName',
  organizationType: 'facilityType',
}

/**
 * The fields a 400 VALIDATION_FAILED names (the problem's `errors`, which the
 * HTTP client keeps as HidApiError.details: `{ field, messages }[]`), as this
 * form's errors. A field the referrer did not type is left out, so the caller
 * keeps the backend's message for it.
 */
export function refusedReferralFields(details: unknown): ReferralErrors {
  const errors: ReferralErrors = {}
  if (!Array.isArray(details)) return errors
  for (const entry of details as unknown[]) {
    const field = typeof entry === 'object' && entry !== null ? (entry as { field?: unknown }).field : undefined
    if (typeof field !== 'string' || !Object.hasOwn(BACKEND_FIELDS, field)) continue
    const name = BACKEND_FIELDS[field]!
    errors[name] = PROBLEMS[name]
  }
  return errors
}

/** The message the Health ID team reads: who referred whom, and what they said. */
export function referralMessage(request: ReferralRequest): string {
  const type = FACILITY_TYPES.find(option => option.value === request.facilityType)?.label ?? 'Not given'
  const lines = [
    `Referral from ${request.referrerName.trim()} (Earn with Health ID).`,
    `Facility type: ${type}.`,
    request.facilityLocation.trim() ? `Location: ${request.facilityLocation.trim()}.` : '',
    request.facilityContact.trim() ? `Who to speak to: ${request.facilityContact.trim()}` : '',
    'The referrer confirmed the facility knows about this introduction.',
  ].filter(Boolean)
  return lines.join('\n').slice(0, MESSAGE_MAX)
}

export function toReferralSubmission(request: ReferralRequest, sourcePage: string, turnstileToken: string): DemoSubmission {
  const errors = validateReferral(request)
  if (Object.keys(errors).length > 0 || !turnstileToken) {
    throw new PlainError('Complete the form and the security check before sending.')
  }
  return {
    contactName: request.referrerName.trim(),
    contactEmail: request.referrerEmail.trim().toLowerCase(),
    ...(request.referrerPhone.trim() ? { contactPhone: request.referrerPhone.trim() } : {}),
    contactRole: 'Referral partner',
    organizationName: request.facilityName.trim(),
    // The five facility types are hid-system's organizationType values.
    ...(request.facilityType ? { organizationType: request.facilityType } : {}),
    productCode: 'general',
    message: referralMessage(request),
    sourcePage: sourcePage.slice(0, 200),
    sourceSection: REFERRAL_SECTION,
    ctaLabel: REFERRAL_CTA,
    turnstileAction: 'book-demo',
    turnstileToken,
  }
}
