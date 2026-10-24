import { isHidApiError } from '@hid/http'

/**
 * Backend problem codes (hid-system 7cbbf98) whose generic status message
 * would mislead the administrator. Each message explains the backend's
 * decision; none of them changes what the backend allows.
 */
const ADMIN_PROBLEMS: Readonly<Record<string, string>> = {
  ACCOUNT_RECOVERY_REQUIRED: 'This account must complete its own password reset or recovery before it can be active.',
  ADMIN_SELF_CHANGE_DENIED: 'You cannot change your own account status or platform roles. Ask another administrator.',
  ADMIN_STATE_CONFLICT: 'This account is already in that state. Reload to see its current status.',
  LAST_SUPER_ADMIN: 'At least one active platform Super Admin must remain.',

  // Sessions. The backend names the end of a platform session it can attribute
  // (Stage 4A) and gives every other refusal the generic code.
  AUTHENTICATION_REQUIRED: 'Your platform session has ended. Sign in again to continue.',
  PLATFORM_SESSION_EXPIRED: 'Your platform session expired after 15 minutes without activity or at its 8-hour limit. Sign in again to continue.',
  PLATFORM_SESSION_REVOKED: 'Your platform session was ended: it was signed out or revoked, your account or roles changed, or your authenticator was reset. Sign in again to continue.',
  PLATFORM_SESSION_REQUIRED: 'This needs an MFA-verified platform administration session. Sign in to platform administration again.',
  PLATFORM_SESSION_SCOPE_DENIED: 'A platform administration session can be used only for platform administration.',
  CSRF_VALIDATION_FAILED: 'The security check for this session failed. Sign in again to continue.',
  ORIGIN_DENIED: 'This site is not allowed to send platform administration requests.',

  // Multi-factor authentication. The backend gives a replayed code the same
  // answer as a wrong one, by design.
  MFA_REQUIRED: 'An enrolled authenticator is required for this action.',
  MFA_INVALID_CODE: 'That code was not accepted. Each code works only once, so wait for the next code in your authenticator app.',
  MFA_CODE_REQUIRED: 'Enter either an authenticator code or a recovery code.',
  MFA_CHALLENGE_INVALID: 'This sign-in attempt expired or ran out of attempts. Sign in again.',
  MFA_RATE_LIMITED: 'Too many incorrect codes. Verification is locked for up to 15 minutes; try again later.',
  MFA_UNAVAILABLE: 'Administrator MFA is temporarily unavailable, so platform sign-in cannot be completed. Contact platform operations.',
  MFA_NOT_ENROLLED: 'This administrator has no authenticator to reset.',
  // A first platform enrolment of an account with an eligible staff membership (hid-system #71): no factor is created.
  MFA_ENROLLMENT_STAFF_SIGN_IN_REQUIRED: 'This account also works at a facility, so its authenticator is set up at staff sign-in. '
    + 'Sign in to the Health ID Provider Portal and set it up there first, then use the same authenticator here.',

  // Step-up and the high-risk policy: STEP_UP_REQUIRED when this session has no
  // confirmation, STEP_UP_EXPIRED when the last one is older than 5 minutes.
  STEP_UP_REQUIRED: 'This action needs a fresh authenticator confirmation (they last 5 minutes). It was not carried out.',
  STEP_UP_EXPIRED: 'Your last authenticator confirmation is more than 5 minutes old. Confirm again; the action was not carried out.',
  REASON_REQUIRED: 'Enter a reason of 8 to 500 characters. It is recorded in the audit log.',
  IF_MATCH_REQUIRED: 'Reload this item before changing it.',
  // Identity's answer to a missing or malformed Idempotency-Key on an admin command
  // (common/idempotency.ts); IDEMPOTENCY_KEY_INVALID is patient enrollment's, never an admin route's.
  IDEMPOTENCY_KEY_REQUIRED: 'This request could not be matched to a single submission. Try again.',
  IDEMPOTENCY_CONFLICT: 'This submission conflicts with an earlier one. Reload and try again.',
  IDEMPOTENCY_KEY_REUSED: 'This submission conflicts with an earlier one. Reload and try again.',
  HIGH_RISK_POLICY_MISSING: 'This action is unavailable because the server has no security policy for it.',

  // Two-person approval.
  TWO_PERSON_APPROVAL_REQUIRED: 'Granting Super Admin needs approval from a second Super Admin. Create an elevation request instead.',
  SELF_APPROVAL_DENIED: 'You cannot decide a request you made or one that changes your own account. Another Super Admin must decide it.',
  APPROVER_INELIGIBLE: 'Only another active Super Admin with an enrolled authenticator can decide this request.',
  APPROVAL_CANCEL_DENIED: 'Only the administrator who made this request can cancel it.',
  APPROVAL_NOT_PENDING: 'This request has already been decided. Reload to see the outcome.',
  APPROVAL_ALREADY_PENDING: 'A request for this administrator is already pending. It must be decided or cancelled first.',
  APPROVAL_EXPIRED: 'This request expired after 24 hours and was not carried out. Create a new request if it is still needed.',
  TARGET_INELIGIBLE: 'This account cannot receive this change in its current state.',

  // Platform availability.
  PLATFORM_PORTAL_DISABLED: 'Platform administration is temporarily disabled.',
  PLATFORM_MAINTENANCE: 'Health ID is in maintenance mode. Try again later.',

  // Records, integrations and pricing. These 409s are refusals, not edits by
  // someone else, so the generic "item changed" message would mislead.
  ADMIN_RESOURCE_NOT_FOUND: 'This item no longer exists or is not available to you. Reload the list.',
  ADMIN_INVALID_CURSOR: 'The next page could not be loaded because the list position is no longer valid. Refresh the list to start again.',
  INTEGRATION_NOT_FOUND: 'This integration or route no longer exists. Reload the page.',
  INTEGRATION_UNCHANGED: 'Nothing changed: the integration already has these settings or this state.',
  INTEGRATION_CONFIGURATION_EXTERNAL: 'This integration has no settings that can be edited here. They are managed in deployment configuration.',
  INTEGRATION_CREDENTIAL_UNAVAILABLE: 'This integration cannot be enabled until its credentials are configured in the deployment.',
  INTEGRATION_INFRASTRUCTURE_CONTROL: 'This integration is controlled by infrastructure configuration and cannot be changed here.',
  INTEGRATION_TEST_UNSUPPORTED: 'This integration does not support a connection test.',
  INTEGRATION_TEST_ALREADY_ATTEMPTED: 'A connection test was already attempted for this version. Reload before testing again.',
  INTEGRATION_PROVIDER_INCOMPATIBLE: 'That provider does not support this capability or is not enabled. Enable it first.',
  INTEGRATION_PAUSED: 'This integration is paused. Enable it in Integrations first.',
  PRICING_UNCHANGED: 'Nothing changed: the catalog already has these values.',

  // Clinician applications (hid-system ADR-066, branch claude/clinician-self-signup at fa58e2b): the queue's
  // three commands, and the workforce codes (0087) step 2 can return. None of them means someone else edited.
  CLINICIAN_QUEUE_UNAVAILABLE: 'This Identity has no clinician queue yet (hid-system ADR-066 is not deployed), so '
    + 'applications cannot be listed or reviewed here.',
  CLINICIAN_APPLICATION_NOT_FOUND: 'This application no longer exists or is not available to you. Reload the list.',
  CLINICIAN_APPLICATION_STATE_INVALID: 'This application is no longer at this step. Reload it to see its current state.',
  CLINICIAN_APPLICATION_COMMAND_INVALID: 'The server refused this step as incomplete. Tick every check, choose how identity '
    + 'and employment were confirmed, give an evidence reference and a reason of 8 to 500 characters, and a verification '
    + 'date after today, no later than the licence expiry and within three years.',
  CLINICIAN_APPLICATION_SECOND_ADMIN_REQUIRED: 'You recorded step 1 for this application, so a different Super Admin must '
    + 'approve it. Nothing was changed.',
  CLINICIAN_APPLICATION_AUTHENTICATOR_CODE_INVALID: 'The authenticator code wasn’t accepted. Ask for a new code and try again.',
  CLINICIAN_APPLICATION_AUTHENTICATOR_RATE_LIMITED: 'Too many wrong codes for this applicant. Wait 15 minutes.',
  CLINICIAN_APPLICATION_AUTHENTICATOR_REQUIRED: 'The applicant hasn’t set up their authenticator, or it wasn’t confirmed '
    + 'in this step. Step 1 needs a code from it.',
  CLINICIAN_APPLICATION_AUTHENTICATOR_CHANGED: 'The applicant’s authenticator was reset after step 1. Reject the '
    + 'application with ‘Other’; they can apply again.',
  CLINICIAN_APPLICATION_ACCOUNT_INELIGIBLE: 'This applicant’s account can’t be given clinical access in its current state: '
    + 'it is not active, or an application of it was refused for identity. Reject the application.',
  WORKFORCE_SELF_CHANGE_DENIED: 'You cannot review your own application or give yourself facility access. Another Super '
    + 'Admin must do this.',
  WORKFORCE_FACILITY_CONFLICT: 'You work at this facility, so another Super Admin must do this.',
  WORKFORCE_FACILITY_NOT_VERIFIED: 'This facility isn’t verified and active, so it can’t take clinicians now. Reject the '
    + 'application with ‘Facility not available’, or wait until the facility is active again.',
  WORKFORCE_ATTESTATION_REQUIRED: 'The step-1 verification can no longer support a grant (it lapsed, or its reviewer now '
    + 'works at the facility). Reject the application; the clinician can apply again.',
  WORKFORCE_MEMBERSHIP_EXISTS: 'This account already has access, or pending access, at this facility. Reject with '
    + '‘Duplicate’; nothing else is changed.',
  WORKFORCE_ROLE_CONFLICT: 'This account is a facility administrator here and can’t also hold a clinical role at this '
    + 'facility. Reject the application; the clinician must apply with a separate email address.',
  WORKFORCE_ACCOUNT_INELIGIBLE: 'This account can’t hold staff access in its current state (for example it is locked). '
    + 'Nothing was changed.',
  WORKFORCE_STAFF_INELIGIBLE: 'The applicant’s staff record can’t be given a role in its current state. Nothing was changed.',
  WORKFORCE_EMAIL_IN_USE: 'An account already uses this email address. This person may have applied by themselves: check '
    + 'Clinician applications.',

  // Support's review of facilities that signed themselves up (P4, Novu only).
  SELF_SERVICE_REVIEW_UNAVAILABLE: 'This Identity does not list new facility sign-ups yet (facility self sign-up is not '
    + 'deployed), so there is nothing to review here.',
  SELF_SERVICE_FACILITY_NOT_FOUND: 'This sign-up is no longer in the list. The list has been refreshed.',
  SELF_SERVICE_FACILITY_ALREADY_REVIEWED: 'Another administrator has already reviewed this sign-up. The list has been refreshed.',
  SELF_SERVICE_FACILITY_REQUEST_INVALID: 'Enter a note of 8 to 500 characters about what you checked.',

  // Facility-assisted registration designations (hid-system #85, ADR-063).
  FACILITY_NOT_ACTIVE: 'Only a verified, active facility of an active organization can register patients in person. Verify the facility first.',
  ADMIN_FACILITY_NOT_FOUND: 'This facility was not found. Check the facility link.',
}

export function problemCode(error: unknown): string | null {
  return isHidApiError(error) ? error.code : null
}

export function isProblem(error: unknown, code: string): boolean {
  return problemCode(error) === code
}

/**
 * A safe, actionable message for an admin request failure. `context` gives a
 * more specific explanation of a backend code for one screen, for example
 * what PERMISSION_DENIED means for an export.
 */
export function failure(error: unknown, fallback: string, context: Readonly<Record<string, string>> = {}) {
  if (isHidApiError(error)) {
    const known = context[error.code] ?? ADMIN_PROBLEMS[error.code]
    if (known) return known
    if (error.status === 409) return 'This item changed. Reload it and try again.'
    if (error.status === 403) return 'Your account does not have permission for this action.'
    if (error.status === 401) return 'Your session has expired. Sign in again to continue.'
    if (error.status === 429) return 'Too many attempts. Wait a few minutes and try again.'
    if (error.status === 0 || error.status >= 500) {
      return error.requestId ? `${fallback} Reference: ${error.requestId}` : fallback
    }
    return error.message
  }
  return fallback
}
