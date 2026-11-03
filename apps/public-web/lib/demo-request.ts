import type { DemoSubmission } from './commercial-api'
import { isContactEmail } from './contact-email'
import { PlainError } from '@hid/http'

/** Public contact address used on informational pages. Demo forms submit to the API. */
export const DEMO_INBOX = 'hello@healthidentitydirectory.com'

export const DEMO_PRODUCTS = [
  { code: 'ehr', label: 'Health ID EHR' },
  { code: 'migrate', label: 'Health ID Migrate' },
  { code: 'laboratory', label: 'Health ID Laboratory' },
  { code: 'pharmacy', label: 'Health ID Pharmacy' },
  { code: 'outreach', label: 'Health ID Outreach' },
  { code: 'api', label: 'Health ID API' },
  { code: 'general', label: 'General enquiry' },
] as const

export type DemoProductCode = (typeof DEMO_PRODUCTS)[number]['code']

export interface DemoRequest {
  readonly service: DemoProductCode | ''
  readonly facility: string
  readonly contactName: string
  readonly role: string
  readonly otherRole: string
  readonly email: string
  readonly phone: string
  readonly notes: string
}

export interface DemoRequestContext {
  readonly sourcePage: string
  readonly sourceSection: string
  readonly ctaLabel: string
}

export type DemoRequestErrors = Partial<Record<keyof DemoRequest, string>>

/** The longest role hid-system accepts. */
export const ROLE_MAX_LENGTH = 120

function isRoleLength(value: string): boolean {
  const length = value.trim().length
  return length >= 2 && length <= ROLE_MAX_LENGTH
}

export function validateDemoRequest(request: DemoRequest): DemoRequestErrors {
  const errors: DemoRequestErrors = {}
  if (!DEMO_PRODUCTS.some(product => product.code === request.service)) {
    errors.service = 'Choose a service.'
  }
  if (request.facility.trim().length < 2 || request.facility.trim().length > 200) {
    errors.facility = 'Enter your organisation or facility.'
  }
  if (request.contactName.trim().length < 2 || request.contactName.trim().length > 160) {
    errors.contactName = 'Enter your full name.'
  }
  // The role sent is `role`, or `otherRole` when the role is Other; hid-system
  // accepts 2 to 120 characters after trimming (CreateDemoRequestDto.contactRole).
  if (!isRoleLength(request.role)) errors.role = 'Enter your role, in 2 to 120 characters.'
  if (request.role === 'Other' && !isRoleLength(request.otherRole)) {
    errors.otherRole = 'Tell us your role, in 2 to 120 characters.'
  }
  if (!isContactEmail(request.email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (request.phone.trim() && !/^\+?[0-9 ()-]{7,32}$/.test(request.phone.trim())) {
    errors.phone = 'Enter a valid phone number.'
  }
  if (request.notes.trim() && (request.notes.trim().length < 8 || request.notes.trim().length > 2000)) {
    errors.notes = 'Add at least 8 characters, or leave this blank.'
  }
  return errors
}

export function toDemoSubmission(
  request: DemoRequest,
  context: DemoRequestContext,
  turnstileToken: string,
): DemoSubmission {
  const errors = validateDemoRequest(request)
  if (Object.keys(errors).length > 0 || !request.service || !turnstileToken) {
    throw new PlainError('Complete the form and the security check before sending.')
  }
  const role = request.role === 'Other' ? request.otherRole.trim() : request.role.trim()
  return {
    contactName: request.contactName.trim(),
    contactEmail: request.email.trim().toLowerCase(),
    productCode: request.service,
    organizationName: request.facility.trim(),
    ...(role ? { contactRole: role } : {}),
    ...(request.phone.trim() ? { contactPhone: request.phone.trim() } : {}),
    ...(request.notes.trim() ? { message: request.notes.trim() } : {}),
    sourcePage: context.sourcePage.slice(0, 200),
    sourceSection: context.sourceSection.slice(0, 120),
    ctaLabel: context.ctaLabel.slice(0, 120),
    turnstileAction: 'book-demo',
    turnstileToken,
  }
}
