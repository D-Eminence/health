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
