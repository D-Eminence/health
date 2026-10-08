import { isHidApiError } from '@hid/http'

// Refusals whose generic status message would mislead the administrator.
const ADMIN_PROBLEMS: Readonly<Record<string, string>> = {
  ACCOUNT_RECOVERY_REQUIRED: 'This account must complete its own password reset or recovery before it can be active.',
  ADMIN_SELF_CHANGE_DENIED: 'You cannot change your own account status or platform roles. Ask another administrator.',
  ADMIN_STATE_CONFLICT: 'This account is already in that state. Reload to see its current status.',
  LAST_SUPER_ADMIN: 'At least one active platform Super Admin must remain.',
}

/** A safe, actionable message for an admin request failure. */
export function failure(error: unknown, fallback: string) {
  if (isHidApiError(error)) {
    const known = ADMIN_PROBLEMS[error.code]
    if (known) return known
    if (error.status === 409) return 'This item changed. Reload it and try again.'
    if (error.status === 403) return 'Your account does not have permission for this action.'
    if (error.status === 401) return 'Your session has expired. Sign in again to continue.'
    if (error.status === 0 || error.status >= 500) {
      return error.requestId ? `${fallback} Reference: ${error.requestId}` : fallback
    }
    return error.message
  }
  return fallback
}
