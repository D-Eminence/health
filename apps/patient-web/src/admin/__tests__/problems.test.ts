import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import { failure, isProblem } from '../problems'

const problem = (status: number, code: string, requestId?: string) =>
  new HidApiError(status, 'Backend detail', { code, ...(requestId ? { requestId } : {}) })

describe('admin failure messages', () => {
  it('explains account-safety refusals instead of a generic conflict or denial', () => {
    expect(failure(problem(409, 'ACCOUNT_RECOVERY_REQUIRED'), 'fallback')).toMatch(/recovery before it can be active/)
    expect(failure(problem(403, 'ADMIN_SELF_CHANGE_DENIED'), 'fallback')).toMatch(/cannot change your own account/)
    expect(failure(problem(409, 'ADMIN_STATE_CONFLICT'), 'fallback')).toMatch(/already in that state/)
    expect(failure(problem(409, 'LAST_SUPER_ADMIN'), 'fallback')).toMatch(/Super Admin must remain/)
  })

  it('keeps the existing status messages for other refusals', () => {
    expect(failure(problem(409, 'VERSION_CONFLICT'), 'fallback')).toBe('This item changed. Reload it and try again.')
    expect(failure(problem(403, 'PERMISSION_DENIED'), 'fallback')).toBe('Your account does not have permission for this action.')
    expect(failure(problem(401, 'UNAUTHENTICATED'), 'fallback')).toBe('Your session has expired. Sign in again to continue.')
  })

  it('does not claim a session expired when the backend only says it is no longer accepted', () => {
    // hid-system returns AUTHENTICATION_REQUIRED for an expired and a revoked session alike.
    expect(failure(problem(401, 'AUTHENTICATION_REQUIRED'), 'fallback')).toBe('Your platform session has ended. Sign in again to continue.')
    expect(failure(problem(403, 'PLATFORM_SESSION_REQUIRED'), 'fallback')).toMatch(/MFA-verified platform administration session/)
    expect(failure(problem(403, 'PLATFORM_SESSION_SCOPE_DENIED'), 'fallback')).toMatch(/only for platform administration/)
    expect(failure(problem(403, 'CSRF_VALIDATION_FAILED'), 'fallback')).toMatch(/security check for this session failed/)
  })

  it('maps every backend MFA, step-up and approval code the admin console can receive', () => {
    const expected: Array<[number, string, RegExp]> = [
      [403, 'MFA_REQUIRED', /enrolled authenticator is required/],
      [401, 'MFA_INVALID_CODE', /not accepted\. Each code works only once/],
      [400, 'MFA_CODE_REQUIRED', /either an authenticator code or a recovery code/],
      [401, 'MFA_CHALLENGE_INVALID', /expired or ran out of attempts/],
      [429, 'MFA_RATE_LIMITED', /locked for up to 15 minutes/],
      [503, 'MFA_UNAVAILABLE', /temporarily unavailable/],
      [409, 'MFA_NOT_ENROLLED', /no authenticator to reset/],
      [403, 'STEP_UP_REQUIRED', /fresh authenticator confirmation \(they last 5 minutes\)\. It was not carried out/],
      [400, 'REASON_REQUIRED', /reason of 8 to 500 characters/],
      [428, 'IF_MATCH_REQUIRED', /Reload this item/],
      [403, 'HIGH_RISK_POLICY_MISSING', /no security policy/],
      [403, 'TWO_PERSON_APPROVAL_REQUIRED', /second Super Admin\. Create an elevation request/],
      [403, 'SELF_APPROVAL_DENIED', /cannot decide a request you made/],
      [403, 'APPROVER_INELIGIBLE', /another active Super Admin with an enrolled authenticator/],
      [403, 'APPROVAL_CANCEL_DENIED', /Only the administrator who made this request/],
      [409, 'APPROVAL_NOT_PENDING', /already been decided/],
      [409, 'APPROVAL_ALREADY_PENDING', /already pending/],
      [409, 'APPROVAL_EXPIRED', /expired after 24 hours and was not carried out/],
      [409, 'TARGET_INELIGIBLE', /cannot receive this change/],
      [423, 'PLATFORM_PORTAL_DISABLED', /temporarily disabled/],
    ]
    for (const [status, code, message] of expected) expect(failure(problem(status, code), 'fallback'), code).toMatch(message)
  })

  it('names how a platform session ended, an expired step-up and a refused list position (Stage 4A)', () => {
    expect(failure(new HidApiError(401, 'x', { code: 'PLATFORM_SESSION_EXPIRED' }), 'fallback')).toMatch(/expired after 15 minutes/)
    expect(failure(new HidApiError(401, 'x', { code: 'PLATFORM_SESSION_REVOKED' }), 'fallback')).toMatch(/was ended/)
    expect(failure(new HidApiError(403, 'x', { code: 'STEP_UP_EXPIRED' }), 'fallback')).toMatch(/more than 5 minutes old/)
    expect(failure(new HidApiError(400, 'x', { code: 'ADMIN_INVALID_CURSOR' }), 'fallback')).toMatch(/Refresh the list/)
  })

  it('explains the idempotency refusal Identity gives an admin command', () => {
    // hid-system identity-api common/idempotency.ts, used by every admin command that takes a key.
    expect(failure(new HidApiError(400, 'Idempotency-Key must contain 16 to 128 URL-safe characters',
      { code: 'IDEMPOTENCY_KEY_REQUIRED' }), 'fallback')).toBe('This request could not be matched to a single submission. Try again.')
  })

  it('lets one screen explain a backend code more precisely without changing other screens', () => {
    const exportRestricted = { PERMISSION_DENIED: 'Exports are restricted to Super Admins with the export permission.' }
    expect(failure(problem(403, 'PERMISSION_DENIED'), 'fallback', exportRestricted)).toBe(exportRestricted.PERMISSION_DENIED)
    expect(failure(problem(403, 'STEP_UP_REQUIRED'), 'fallback', exportRestricted)).toMatch(/fresh authenticator confirmation/)
    expect(isProblem(problem(403, 'STEP_UP_REQUIRED'), 'STEP_UP_REQUIRED')).toBe(true)
    expect(isProblem(new Error('STEP_UP_REQUIRED'), 'STEP_UP_REQUIRED')).toBe(false)
  })

  it('surfaces a server failure with its correlation reference and no backend detail', () => {
    expect(failure(problem(503, 'SERVICE_UNAVAILABLE', 'corr-503'), 'Audit events could not be loaded.'))
      .toBe('Audit events could not be loaded. Reference: corr-503')
    expect(failure(problem(500, 'INTERNAL_ERROR'), 'Audit events could not be loaded.'))
      .toBe('Audit events could not be loaded.')
    expect(failure(new Error('raw'), 'fallback')).toBe('fallback')
  })

  it('explains integration and pricing refusals that are not edits by someone else', () => {
    expect(failure(problem(409, 'INTEGRATION_UNCHANGED'), 'fallback')).toMatch(/^Nothing changed/)
    expect(failure(problem(409, 'PRICING_UNCHANGED'), 'fallback')).toMatch(/^Nothing changed/)
    expect(failure(problem(409, 'INTEGRATION_INFRASTRUCTURE_CONTROL'), 'fallback')).toMatch(/infrastructure configuration/)
    expect(failure(problem(409, 'INTEGRATION_CONFIGURATION_EXTERNAL'), 'fallback')).toMatch(/deployment configuration/)
    expect(failure(problem(409, 'INTEGRATION_CREDENTIAL_UNAVAILABLE'), 'fallback')).toMatch(/credentials are configured/)
    expect(failure(problem(400, 'INTEGRATION_PROVIDER_INCOMPATIBLE'), 'fallback')).toMatch(/does not support this capability/)
    expect(failure(problem(404, 'ADMIN_RESOURCE_NOT_FOUND'), 'fallback')).toMatch(/no longer exists/)
    for (const code of ['INTEGRATION_UNCHANGED', 'PRICING_UNCHANGED', 'INTEGRATION_TEST_ALREADY_ATTEMPTED']) {
      expect(failure(problem(409, code), 'fallback')).not.toBe('This item changed. Reload it and try again.')
    }
  })
})
