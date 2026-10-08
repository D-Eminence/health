import { describe, expect, it } from 'vitest'
import { HidApiError } from '@hid/http'
import { failure } from '../problems'

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
    expect(failure(problem(401, 'AUTHENTICATION_REQUIRED'), 'fallback')).toBe('Your session has expired. Sign in again to continue.')
  })

  it('surfaces a server failure with its correlation reference and no backend detail', () => {
    expect(failure(problem(503, 'SERVICE_UNAVAILABLE', 'corr-503'), 'Audit events could not be loaded.'))
      .toBe('Audit events could not be loaded. Reference: corr-503')
    expect(failure(problem(500, 'INTERNAL_ERROR'), 'Audit events could not be loaded.'))
      .toBe('Audit events could not be loaded.')
    expect(failure(new Error('raw'), 'fallback')).toBe('fallback')
  })
})
