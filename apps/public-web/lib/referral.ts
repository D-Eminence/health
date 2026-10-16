import type { DemoSubmission } from './commercial-api'
import { DEMO_PRODUCTS, type DemoProductCode } from './demo-request'

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

/** The products a referred facility can be interested in; Outreach and the API are sold differently. */
export const REFERRAL_PRODUCTS = DEMO_PRODUCTS.filter(product =>
  ['ehr', 'laboratory', 'pharmacy', 'migrate', 'general'].includes(product.code))

export interface ReferralRequest {
  readonly referrerName: string
  readonly referrerEmail: string
  readonly referrerPhone: string
  readonly facilityName: string
  readonly facilityType: FacilityType | ''
  readonly facilityLocation: string
  readonly product: DemoProductCode | ''
  readonly facilityContact: string
  readonly notes: string
  readonly consent: boolean
}

export type ReferralErrors = Partial<Record<keyof ReferralRequest, string>>

export const EMPTY_REFERRAL: ReferralRequest = {
  referrerName: '', referrerEmail: '', referrerPhone: '', facilityName: '', facilityType: '',
  facilityLocation: '', product: '', facilityContact: '', notes: '', consent: false,
}

/** hid-system's demo-request message limit. */
const MESSAGE_MAX = 2000

export function validateReferral(request: ReferralRequest): ReferralErrors {
  const errors: ReferralErrors = {}
  const name = request.referrerName.trim()
  if (name.length < 2 || name.length > 160) errors.referrerName = 'Enter your full name.'
  const email = request.referrerEmail.trim()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.referrerEmail = 'Enter a valid email address.'
  if (request.referrerPhone.trim() && !/^\+?[0-9 ()-]{7,32}$/.test(request.referrerPhone.trim())) {
    errors.referrerPhone = 'Enter a valid phone number.'
  }
  const facility = request.facilityName.trim()
  if (facility.length < 2 || facility.length > 200) errors.facilityName = 'Enter the facility’s name.'
  if (!FACILITY_TYPES.some(type => type.value === request.facilityType)) errors.facilityType = 'Choose the type of facility.'
  if (request.facilityLocation.trim().length > 120) errors.facilityLocation = 'Keep the location under 120 characters.'
  if (request.product && !REFERRAL_PRODUCTS.some(product => product.code === request.product)) errors.product = 'Choose a product.'
  if (request.facilityContact.trim().length > 300) errors.facilityContact = 'Keep this under 300 characters.'
  if (request.notes.trim().length > 800) errors.notes = 'Keep this under 800 characters.'
  if (!request.consent) errors.consent = 'Confirm the facility knows you are introducing them.'
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
    request.notes.trim() ? `Notes: ${request.notes.trim()}` : '',
    'The referrer confirmed the facility knows about this introduction.',
  ].filter(Boolean)
  return lines.join('\n').slice(0, MESSAGE_MAX)
}

export function toReferralSubmission(request: ReferralRequest, sourcePage: string, turnstileToken: string): DemoSubmission {
  const errors = validateReferral(request)
  if (Object.keys(errors).length > 0 || !turnstileToken) {
    throw new Error('Complete the form and verification before submitting.')
  }
  return {
    contactName: request.referrerName.trim(),
    contactEmail: request.referrerEmail.trim().toLowerCase(),
    ...(request.referrerPhone.trim() ? { contactPhone: request.referrerPhone.trim() } : {}),
    contactRole: 'Referral partner',
    organizationName: request.facilityName.trim(),
    productCode: (request.product || 'general') as DemoSubmission['productCode'],
    message: referralMessage(request),
    sourcePage: sourcePage.slice(0, 200),
    sourceSection: REFERRAL_SECTION,
    ctaLabel: REFERRAL_CTA,
    turnstileAction: 'book-demo',
    turnstileToken,
  }
}
