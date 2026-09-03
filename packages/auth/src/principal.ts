/**
 * Authentication principals.
 *
 * Health ID has three distinct identities and this package refuses to flatten
 * them into one "user" object. A patient, a member of clinical staff and a
 * platform administrator are different people doing different things under
 * different rules, and the applications that serve them stay separate.
 *
 * A principal answers exactly one question: *who is this session acting as, and
 * at what assurance level*. It deliberately carries no name, no Health ID code,
 * no phone number and no clinical data. Display information is fetched from the
 * relevant service when a screen needs it and lives only as long as that screen
 * does — which is what keeps identifying data out of anything long-lived.
 *
 * A principal is not a permission. The backend authorises every request.
 */

import type { HidAppRole, HidAssuranceLevel, HidStaffRole } from '@hid/contracts'

export type PrincipalKind = 'patient' | 'staff' | 'platform'

interface PrincipalBase {
  /** Opaque subject identifier from the authentication provider. Not a Health ID code. */
  readonly subjectId: string
  readonly appRole: HidAppRole
  /** `aal2` means a second factor has been satisfied for this session. */
  readonly assuranceLevel: HidAssuranceLevel
}

export interface PatientPrincipal extends PrincipalBase {
  readonly kind: 'patient'
  readonly appRole: 'patient'
}

export interface StaffPrincipal extends PrincipalBase {
  readonly kind: 'staff'
  readonly appRole: 'clinician' | 'org_admin'
  /** Professional role within the facility, used to shape the workspace. */
  readonly staffRole: HidStaffRole
  /** Opaque identifier of the facility context the session is operating in. */
  readonly organizationId: string | null
}

export interface PlatformPrincipal extends PrincipalBase {
  readonly kind: 'platform'
  readonly appRole: 'platform_admin'
}

export type AuthPrincipal = PatientPrincipal | StaffPrincipal | PlatformPrincipal

export function isPatient(principal: AuthPrincipal): principal is PatientPrincipal {
  return principal.kind === 'patient'
}

export function isStaff(principal: AuthPrincipal): principal is StaffPrincipal {
  return principal.kind === 'staff'
}

export function isPlatformAdmin(principal: AuthPrincipal): principal is PlatformPrincipal {
  return principal.kind === 'platform'
}

export function hasSatisfiedMfa(principal: AuthPrincipal): boolean {
  return principal.assuranceLevel === 'aal2'
}

/**
 * Fields a principal is allowed to contain.
 *
 * Enforced by a test rather than by types alone, because the failure this
 * guards against is someone adding `fullName` to make one screen simpler and
 * quietly reintroducing identifying data into session state.
 */
export const ALLOWED_PRINCIPAL_FIELDS: readonly string[] = [
  'kind',
  'subjectId',
  'appRole',
  'assuranceLevel',
  'staffRole',
  'organizationId',
]
