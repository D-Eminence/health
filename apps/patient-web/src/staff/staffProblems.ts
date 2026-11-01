import { isHidApiError } from '@hid/http'

/**
 * What the Staff page and the join pages say for Identity's refusals (P4b SPEC 6.4, 8.1-8.3), keyed by `code`. None of
 * them says whether an email has a Health ID account. Statuses of 500 or more, and the gateway's
 * UPSTREAM_UNAVAILABLE, are "temporarily unavailable", whatever their code.
 */
export interface StaffProblemContext {
  /** The facility's name, as the page shows it. */
  facility: string
  limits?: { invitationsPerDay: number; emailsPerDay: number; pendingLimit: number }
}

export const STAFF_UNAVAILABLE = 'Staff management is temporarily unavailable. Please try again in a few minutes.'
export const JOIN_UNAVAILABLE = 'Joining a facility isn’t working right now. Please try again in a few minutes.'

/** The refusals after which the Staff page reads its list again: it was out of date. */
export const STAFF_REFRESHING: readonly string[] = ['VERSION_CONFLICT', 'FACILITY_REVIEW_PENDING', 'FACILITY_ALREADY_REVIEWED',
  'STAFF_INVITATION_NOT_PENDING', 'STAFF_INVITATION_NOT_FOUND', 'FACILITY_STAFF_NOT_FOUND', 'FACILITY_STAFF_ALREADY_ENDED',
  'STAFF_INVITATION_ALREADY_PENDING', 'STAFF_INVITATION_DELIVERY_PAUSED', 'STAFF_INVITATIONS_UNAVAILABLE']

export function isUnavailable(caught: unknown): boolean {
  if (!isHidApiError(caught)) return false
  return caught.status === 0 || caught.status === 408 || caught.status >= 500 || caught.code === 'UPSTREAM_UNAVAILABLE'
}

/** An Identity without the route (hid-system main, or Novu before P4b): its 404 names no code of its own. */
export function isRouteMissing(caught: unknown): boolean {
  return isHidApiError(caught) && caught.status === 404 && (caught.code === 'NOT_FOUND' || caught.code === 'API_ROUTE_NOT_FOUND')
}

/** The Staff page's words for a refused command. */
export function staffProblemText(caught: unknown, context: StaffProblemContext): string {
  if (!isHidApiError(caught)) return 'That didn’t work. Please try again.'
  if (isUnavailable(caught)) return STAFF_UNAVAILABLE
  const { facility, limits } = context
  switch (caught.code) {
    case 'FACILITY_REVIEW_PENDING': return `You can add staff once Health ID support has checked ${facility}.`
    case 'FACILITY_ALREADY_REVIEWED': return `Health ID support has already checked ${facility}. To change your own clinical `
      + 'access now, contact Health ID support.'
    case 'STAFF_INVITATIONS_UNAVAILABLE': return 'Adding staff is paused by Health ID. Try again later.'
    case 'STAFF_REAUTHENTICATION_FAILED': return 'That password isn’t right.'
    case 'STAFF_RECENT_RECOVERY_HOLD': return 'Your account was recovered with a code in the last 24 hours. You can add staff '
      + 'and change roles again once 24 hours have passed.'
    case 'STAFF_INVITATION_RECIPIENT_LIMIT': return 'This person has been invited too often recently. Try again later.'
    case 'STAFF_INVITATION_DELIVERY_PAUSED': return `Too many invitations from ${facility} could not be delivered in the last `
      + 'day. Check the addresses; you can send again later.'
    case 'STAFF_INVITATION_DAILY_LIMIT': return limits
      ? `${facility} can send ${limits.invitationsPerDay} invitations and ${limits.emailsPerDay} invitation emails a day, `
        + 'and has reached that limit. Try again later.'
      : `${facility} has sent as many invitations as it can for now. Try again later.`
    case 'STAFF_INVITATION_PENDING_LIMIT': return limits
      ? `${facility} already has ${limits.pendingLimit} invitations waiting. Revoke the ones no longer needed, then try again.`
      : `${facility} has as many invitations waiting as it can. Revoke the ones no longer needed, then try again.`
    case 'STAFF_INVITATION_SEND_LIMIT': return 'This invitation has been sent 5 times, the most it can be. Revoke it, then '
      + 'invite the person again.'
    case 'STAFF_INVITATION_RESEND_TOO_SOON': return 'You can send this invitation again a minute after the last one.'
    case 'STAFF_INVITATION_ALREADY_PENDING': return 'An invitation to this email address is already waiting. Send that one '
      + 'again instead.'
    case 'STAFF_INVITATION_ALREADY_MEMBER': return `This person already works at ${facility}.`
    case 'STAFF_INVITATION_SELF': return 'You can’t invite yourself.'
    case 'STAFF_INVITATION_ROLE_NOT_ALLOWED': return `${facility} can’t invite someone in this role.`
    case 'STAFF_INVITATION_INVALID': case 'VALIDATION_FAILED': return 'Some details weren’t accepted. Check the name, email '
      + 'address and licence number, then try again.'
    case 'IDEMPOTENCY_KEY_REUSED': return 'This invitation changed while it was being sent. Check the details and send it again.'
    case 'STAFF_INVITATION_NOT_PENDING': return 'This invitation has already been accepted, revoked or has expired. The list '
      + 'has been refreshed.'
    case 'STAFF_INVITATION_NOT_FOUND': return 'This invitation is no longer in the list. The list has been refreshed.'
    case 'FACILITY_STAFF_NOT_FOUND': return `This person is no longer in ${facility}’s list. The list has been refreshed.`
    case 'FACILITY_STAFF_ALREADY_ENDED': return `This person no longer works at ${facility}. The list has been refreshed.`
    case 'FACILITY_STAFF_SELF': return 'You can’t change your own access here. Contact Health ID support.'
    case 'FACILITY_STAFF_ADMINISTRATOR': return 'You can’t change a facility administrator’s access here. Contact Health ID support.'
    case 'FACILITY_STAFF_ROLE_UNCHANGED': return 'This person already has this role and licence.'
    case 'FACILITY_STAFF_PLATFORM_ACCOUNT': return 'This person’s account is managed by Health ID support. Contact support to '
      + 'change their access.'
    case 'FACILITY_STAFF_REASON_INVALID': return 'Enter a reason of 8 to 500 characters.'
    case 'ADMINISTRATOR_LICENCE_INVALID': return 'Check the licence number. Use the letters, digits, spaces, slashes, dots and '
      + 'hyphens shown on the licence.'
    case 'STAFF_MANAGEMENT_NOT_ADMINISTRATOR': return `Only the administrator who signed ${facility} up can record their own `
      + 'licence here.'
    case 'STAFF_MANAGEMENT_NOT_AVAILABLE': return `Health ID support manages who works at ${facility}.`
    case 'PERMISSION_DENIED': return `Only ${facility}’s administrator can manage its staff.`
    case 'VERSION_CONFLICT': return 'This changed while you were working on it. The list has been refreshed: check it and '
      + 'try again.'
    case 'IDEMPOTENCY_KEY_REQUIRED': return 'That didn’t go through. Please try again.'
    default: break
  }
  if (caught.status === 429) return 'Too many tries. Wait a few minutes and try again.'
  return 'That didn’t work. Please try again.'
}

/**
 * The join pages' words for a refused invitation (P4b SPEC 8.2-8.3). `facility` is the inviting facility when the page
 * knows it.
 */
export function joinProblemText(caught: unknown, facility: string | null): string {
  if (!isHidApiError(caught)) return 'That didn’t work. Please try again.'
  if (isUnavailable(caught)) return JOIN_UNAVAILABLE
  const theFacility = facility ?? 'the facility'
  switch (caught.code) {
    case 'STAFF_INVITATION_CODE_INVALID': return 'That code doesn’t match. Check the email.'
    case 'STAFF_INVITATION_LOCKED': return `This link has been tried too often. Ask ${theFacility} to send the invitation again.`
    case 'STAFF_INVITATION_SUPERSEDED': return 'A newer invitation was sent. Use the latest email.'
    case 'STAFF_INVITATION_EXPIRED': return `This invitation is too old. Ask ${theFacility} to send it again.`
    case 'STAFF_INVITATION_WITHDRAWN': return `This invitation is no longer available: ${theFacility} withdrew it, or can’t `
      + 'take new staff on Health ID right now. Ask the facility about it.'
    case 'STAFF_INVITATION_ALREADY_ACCEPTED': return 'This invitation has already been accepted. Sign in to use it.'
    case 'STAFF_INVITATION_REQUIRES_SIGN_OUT': return 'Someone is signed in to Health ID on this device, for example as a patient. Sign '
      + 'out, or open the link in a private window.'
    case 'STAFF_INVITATION_SESSION_INVALID': return 'This step timed out. Continue again to set your password.'
    case 'STAFF_INVITATIONS_UNAVAILABLE': return 'Joining is paused by Health ID. Try again later.'
    case 'STAFF_INVITATION_RATE_LIMITED': return 'Too many invitations opened from your internet connection. Please try again '
      + 'in an hour.'
    case 'STAFF_INVITATION_ACCOUNT_EXISTS': case 'STAFF_INVITATION_ACCOUNT_CHANGED': return 'Your Health ID account changed '
      + 'while you were joining. Open the invitation again from the email.'
    case 'STAFF_INVITATION_PATIENT_ACCOUNT': return `This email belongs to a Health ID patient account. Staff accounts need `
      + `their own email: ask ${theFacility} to invite your work email.`
    case 'STAFF_INVITATION_ACCOUNT_UNAVAILABLE': return 'This account can’t join a facility by invitation. Contact Health ID '
      + 'support.'
    case 'STAFF_INVITATION_EMAIL_MISMATCH': return 'This invitation is for another email address. Sign in with the account for '
      + 'the invited email.'
    case 'STAFF_INVITATION_ALREADY_MEMBER': return `You already work at ${theFacility} on Health ID.`
    case 'PASSWORD_INVALID': return 'Choose a password of 12 to 256 characters.'
    case 'ORIGIN_DENIED': return 'This site isn’t allowed to open Health ID invitations. Open the link in the invitation email '
      + 'again.'
    case 'VALIDATION_FAILED': return 'Check the email address and the 6-digit code from the invitation email.'
    default: break
  }
  if (caught.code.startsWith('TURNSTILE_') && caught.code.endsWith('_MISMATCH')) return 'The security check was made for '
    + 'another Health ID site. Open the link in the invitation email again.'
  if (caught.code.startsWith('TURNSTILE_')) return 'The security check didn’t work. Please do it again, then try again.'
  if (caught.status === 429) return 'Too many tries. Wait a few minutes and try again.'
  return 'That didn’t work. Please try again.'
}
