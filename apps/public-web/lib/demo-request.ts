/**
 * Demo requests — INTERIM MECHANISM, MARKED FOR REPLACEMENT.
 *
 * The design shows a demo form that submits and confirms. There is no backend
 * contract for it: no endpoint at the frozen release accepts a demo or sales
 * enquiry, and `send-email` is backend-internal rather than a public intake.
 *
 * Rather than invent an endpoint or fake a success state, the form composes the
 * enquiry and hands it to the visitor's mail client. That loses no lead, makes
 * no claim the platform cannot honour, and is a single function to delete once
 * a real intake contract exists.
 *
 * See docs/OPEN-QUESTIONS.md, Q13. Replace this with a service module in
 * @hid/api the moment the endpoint is confirmed.
 */

export interface DemoRequest {
  readonly service: string
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
  readonly pageUrl: string
  readonly submittedAt: string
  readonly campaign: string
}

/** Where enquiries go until an intake endpoint exists. */
export const DEMO_INBOX = 'hello@healthidentitydirectory.com'

const FIELD_LABELS: Record<keyof DemoRequest, string> = {
  service: 'Service',
  facility: 'Organisation or facility',
  contactName: 'Full name',
  role: 'Role',
  otherRole: 'Specified role',
  email: 'Work email',
  phone: 'Phone number',
  notes: 'Additional note',
}

export type DemoRequestErrors = Partial<Record<keyof DemoRequest, string>>

/**
 * Validates the enquiry.
 *
 * Deliberately forgiving: this is a sales form, and rejecting a real facility
 * over a phone-number format loses a customer. Only the fields needed to reply
 * are required.
 */
export function validateDemoRequest(request: DemoRequest): DemoRequestErrors {
  const errors: DemoRequestErrors = {}

  if (request.service.trim() === '') errors.service = 'Select the service you are interested in.'
  if (request.facility.trim() === '') errors.facility = 'Enter your organisation or facility.'
  if (request.contactName.trim() === '') errors.contactName = 'Enter your full name.'
  if (request.role.trim() === '') errors.role = 'Select your role.'
  if (request.role === 'Other' && request.otherRole.trim() === '') errors.otherRole = 'Tell us your role.'

  const email = request.email.trim()
  if (email === '') {
    errors.email = 'Enter an email address so we can reply.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'That email address does not look right.'
  }

  return errors
}

/** Builds the message body. Plain text so it reads correctly in any mail client. */
export function composeDemoEnquiry(request: DemoRequest, context?: DemoRequestContext): { subject: string; body: string } {
  const lines = (Object.keys(FIELD_LABELS) as (keyof DemoRequest)[])
    .map(field => [FIELD_LABELS[field], request[field].trim()] as const)
    .filter(([, value]) => value !== '')
    .map(([label, value]) => `${label}: ${value}`)

  return {
    subject: `Demo request — ${request.facility.trim()}`,
    body: [
      'A demo request from the Health ID website.',
      '',
      ...lines,
      ...(context ? [
        '',
        'Request context',
        `Source page: ${context.sourcePage}`,
        `Source section: ${context.sourceSection}`,
        `CTA: ${context.ctaLabel}`,
        `Page URL: ${context.pageUrl}`,
        `Submitted: ${context.submittedAt}`,
        ...(context.campaign ? [`Campaign: ${context.campaign}`] : []),
      ] : []),
    ].join('\n'),
  }
}

/** The `mailto:` URL the form hands to the browser. */
export function buildDemoMailto(request: DemoRequest, context?: DemoRequestContext): string {
  const { subject, body } = composeDemoEnquiry(request, context)
  return `mailto:${DEMO_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
