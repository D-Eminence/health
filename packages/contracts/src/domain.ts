/**
 * Domain vocabulary shared across Health ID frontends.
 *
 * Everything in this file was read out of the existing Health ID codebase.
 * Nothing here is inferred from what an endpoint "probably" returns.
 *
 * Rule for this package: a type may describe a value the backend is known to
 * produce, or it may describe a value whose shape is not yet confirmed — in
 * which case it is `UnverifiedPayload` and the gap is recorded in
 * `docs/OPEN-QUESTIONS.md`. There is no third option where the frontend
 * invents a shape and treats it as fact.
 */

/**
 * A payload whose wire shape has not been confirmed against the backend.
 *
 * Using `unknown` rather than a guessed interface is deliberate: it forces the
 * caller to narrow at the boundary, and it makes every unconfirmed contract
 * visible to `grep`. Replace one of these only with a shape read from the
 * backend, never with one inferred from a UI's needs.
 */
export type UnverifiedPayload = unknown

// ---------------------------------------------------------------------------
// Identity
//
// Health ID separates the authentication principal from the domain identities
// attached to it. These are distinct concepts and the frontend keeps them
// distinct: a person is not "a user", they are a patient, or a staff member,
// or a platform administrator, and the applications differ accordingly.
// ---------------------------------------------------------------------------

/** Authorisation role carried on the authentication principal. */
export type HidAppRole = 'patient' | 'clinician' | 'org_admin' | 'platform_admin'

/** Professional role a staff member holds within a facility. */
export type HidStaffRole = 'doctor' | 'nurse' | 'lab' | 'pharmacist' | 'admin'

/** Roles for which the backend requires a second authentication factor. */
export const PRIVILEGED_ROLES: readonly HidAppRole[] = ['clinician', 'org_admin', 'platform_admin']

export function isPrivilegedRole(role: HidAppRole): boolean {
  return PRIVILEGED_ROLES.includes(role)
}

/** Assurance level of the current authentication. `aal2` means MFA satisfied. */
export type HidAssuranceLevel = 'aal1' | 'aal2'

// ---------------------------------------------------------------------------
// Access control
//
// These describe consent and access state. The frontend renders them; the
// backend decides them. A value here is never a permission check.
// ---------------------------------------------------------------------------

export type HidAccessScope = 'read_records' | 'write_records' | 'break_glass'
export type HidRequestStatus = 'pending' | 'approved' | 'denied' | 'revoked' | 'expired'
export type HidGrantStatus = 'active' | 'revoked' | 'expired'
export type HidSharePermissionTier = 'view_only' | 'clinical_review' | 'clinical_collaboration'
export type HidShareDurationPreset = '24h' | '7d' | '30d' | 'until_revoked'
export type HidShareTargetType = 'profile' | 'record' | 'health_event'

// ---------------------------------------------------------------------------
// Field classification
//
// Drives PHI handling decisions in shared code: what may be cached, what may
// be put in a URL, what may be logged. Classification lives with the contract
// rather than with any one screen, so every application applies it the same way.
// ---------------------------------------------------------------------------

export type DataClassification =
  /** Safe to cache, log and put in a URL. */
  | 'public'
  /** Not PHI, but identifies a session or account. Not for logs or URLs. */
  | 'internal'
  /** Identifies a patient. Never logged, never in a URL, never persisted. */
  | 'identifying'
  /** Clinical content. Never logged, never persisted, minimised in memory. */
  | 'clinical'

/** True when a value must not leave application memory. */
export function isRestricted(classification: DataClassification): boolean {
  return classification === 'identifying' || classification === 'clinical'
}
