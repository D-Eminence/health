import { toast } from '@hid/ui'
import type { FacilityStaff, FacilityStaffInvitation, FacilityStaffMember, StaffDeliveryOutcome } from '../../../staff/api'
import { isLicenceBody, LICENCE_BODIES, type LicenceBody } from '../../../staff/staffAccess'
import { dateText } from '../parts/format'

/**
 * The Staff & access page's words: the target's (admin/staff.png and its prototype, src/admin.tsx Staff) where it
 * shows the state, and plain words in its voice for what only the live staff API knows (delivery, limits, licences).
 */

/** Ids that focus moves to across the page's parts. */
export const IDS = {
  inviteToggle: 'ehr-staff-invite-toggle',
  inviteWhy: 'ehr-staff-invite-why',
  problem: 'ehr-staff-problem',
  members: 'ehr-staff-members-title',
  invitations: 'ehr-staff-invitations-title',
  retry: 'ehr-staff-retry',
} as const

/** The target form's word for an empty required field. */
export const REQUIRED = 'Complete this field.'
export const EMAIL_PROBLEM = 'Enter a valid email address.'
export const REASON_PROBLEM = 'Enter a reason of 8 to 500 characters.'

/** The live page's email check (Identity takes the address it gives). */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function licenceNumberProblem(body: LicenceBody): string {
  return `Enter the ${body} licence number as it is on the licence: letters, digits, spaces, slashes, dots and hyphens.`
}

/** A reason Identity takes: 8 to 500 characters once trimmed. */
export function reasonProblem(reason: string): string | null {
  const length = reason.trim().length
  if (length === 0) return REQUIRED
  return length < 8 || length > 500 ? REASON_PROBLEM : null
}

/** "AO" for "Alex Owner": the target's avatar initials. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map(word => word.charAt(0).toLocaleUpperCase()).join('') || '?'
}

/** The facility's confirmation, as Identity serves it, with the person and the facility named (P4b SPEC 4.2). */
const ATTESTATION_FALLBACK = 'I confirm that {name} works at {facility} and, for a clinical role, that I have seen their '
  + 'current practising licence with the number entered above. Health ID records this confirmation with my name, and '
  + 'Health ID support may check it.'

export function attestationText(served: string | null | undefined, name: string, facility: string): string {
  return (served || ATTESTATION_FALLBACK).replaceAll('{name}', name || 'this person').replaceAll('{facility}', facility)
}

type Licence = FacilityStaffMember['licence'] | FacilityStaffInvitation['licence']

/** "MDCN ending 2345", or "None". */
export function licenceNumberText(licence: Licence): string {
  if (!licence) return 'None'
  return licence.numberHint ? `${licence.body} ending ${licence.numberHint}` : licence.body
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return 'an unknown date'
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'an unknown date' : parsed.toLocaleDateString()
}

/** Who stands behind a member's licence: the facility's administrator, or Health ID support's check. */
export function licenceVouch(licence: FacilityStaffMember['licence']): string | null {
  if (!licence) return null
  if (licence.method === 'platform_review') return `Checked by Health ID support on ${dateOnly(licence.vouchedAt)}`
  return licence.vouchedBy ? `Vouched for by ${licence.vouchedBy} on ${dateOnly(licence.vouchedAt)}` : null
}

/** An invitation's status as the target writes it: lower case. */
export function invitationStatus(status: string): string {
  return status.toLowerCase()
}

export const DELIVERY_WORDS: Readonly<Record<string, string>> = {
  accepted: 'sent',
  definitive_failure: 'not delivered: check the address',
  unknown: 'not confirmed',
  pending: 'sending',
}

/** What became of an invitation email just sent, as a toast: the target's "Invitation created", and the delivery. */
export function deliveryToast(outcome: StaffDeliveryOutcome | string, email: string, again: boolean) {
  const title = again ? 'Invitation sent again' : 'Invitation created'
  if (outcome === 'accepted') {
    toast.success(title, { description: `Sent to ${email}.` })
  } else if (outcome === 'definitive_failure') {
    toast.warning(title, { description: `The email to ${email} couldn’t be delivered. Check the address: if it’s wrong, `
      + 'revoke this invitation and invite the right one.' })
  } else {
    toast.warning(title, { description: `We couldn’t confirm that the email to ${email} was delivered. If it doesn’t `
      + 'arrive, resend it in a minute.' })
  }
}

/** Why "Invite staff" is not available now, in the order Identity would refuse. */
export function cannotInvite(staff: FacilityStaff): string {
  const name = staff.facility.name
  if (!staff.facility.invitationsOpen) return 'Adding staff is paused by Health ID. Try again later.'
  if (staff.facility.deliveryPaused) return `Too many invitations from ${name} couldn’t be delivered in the last day. Check `
    + 'the addresses; you can invite again later.'
  if (staff.limits.pendingInvitations >= staff.limits.pendingLimit) return `${name} already has ${staff.limits.pendingLimit} `
    + 'invitations waiting. Revoke the ones no longer needed before you invite anyone else.'
  return `${name} has sent as many invitations as it can for now (${staff.limits.invitationsPerDay} invitations and `
    + `${staff.limits.emailsPerDay} invitation emails a day). Try again later.`
}

/** "doctor or nurse", from the licences support can accept for this facility's administrator. */
export function holders(bodies: readonly string[]): string {
  const names = bodies.filter(isLicenceBody).map(body => LICENCE_BODIES[body].holder)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/** A count with its noun, as the target's plural(): "1 invitation", "3 invitations". */
export function plural(count: number, singular: string, multiple = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : multiple}`
}

/** When a waiting invitation may be sent again, or 0. */
export function resendTime(invitation: Pick<FacilityStaffInvitation, 'resendAvailableAt'>): number {
  const at = invitation.resendAvailableAt ? new Date(invitation.resendAvailableAt).getTime() : 0
  return Number.isFinite(at) ? at : 0
}

export { dateText }
