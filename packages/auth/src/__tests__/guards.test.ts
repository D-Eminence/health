import { describe, expect, it } from 'vitest'
import {
  PATIENT_ROUTE,
  PLATFORM_ADMIN_ROUTE,
  STAFF_ROUTE,
  evaluateAccess,
  isAllowed,
} from '../guards'
import { INITIAL_SESSION_STATE } from '../session'
import type { SessionState } from '../session'
import type { PatientPrincipal, PlatformPrincipal, StaffPrincipal } from '../principal'

const patient: PatientPrincipal = {
  kind: 'patient',
  subjectId: 'a',
  appRole: 'patient',
  assuranceLevel: 'aal1',
}

const clinician: StaffPrincipal = {
  kind: 'staff',
  subjectId: 'b',
  appRole: 'clinician',
  assuranceLevel: 'aal2',
  staffRole: 'doctor',
  organizationId: 'org-1',
}

const clinicianWithoutMfa: StaffPrincipal = { ...clinician, assuranceLevel: 'aal1' }

const platformAdmin: PlatformPrincipal = {
  kind: 'platform',
  subjectId: 'c',
  appRole: 'platform_admin',
  assuranceLevel: 'aal2',
}

function authenticated(principal: SessionState['principal']): SessionState {
  return { status: 'authenticated', principal } as SessionState
}

const anonymous: SessionState = { status: 'anonymous', principal: null }

describe('evaluateAccess', () => {
  it('waits while the session is still unknown', () => {
    expect(evaluateAccess(INITIAL_SESSION_STATE, PATIENT_ROUTE)).toEqual({ outcome: 'pending' })
  })

  it('sends an anonymous visitor to the entrance the route belongs to', () => {
    expect(evaluateAccess(anonymous, PATIENT_ROUTE)).toEqual({
      outcome: 'sign-in-required',
      portal: 'patient',
    })
    expect(evaluateAccess(anonymous, STAFF_ROUTE)).toEqual({
      outcome: 'sign-in-required',
      portal: 'staff',
    })
  })

  it('allows a patient into a patient route', () => {
    expect(isAllowed(evaluateAccess(authenticated(patient), PATIENT_ROUTE))).toBe(true)
  })

  it('keeps a patient out of staff routes and reports which portal they are in', () => {
    expect(evaluateAccess(authenticated(patient), STAFF_ROUTE)).toEqual({
      outcome: 'wrong-portal',
      actual: 'patient',
    })
  })

  it('keeps staff out of patient routes', () => {
    expect(evaluateAccess(authenticated(clinician), PATIENT_ROUTE)).toEqual({
      outcome: 'wrong-portal',
      actual: 'staff',
    })
  })

  it('requires a second factor on staff routes', () => {
    expect(evaluateAccess(authenticated(clinicianWithoutMfa), STAFF_ROUTE)).toEqual({
      outcome: 'mfa-required',
    })
    expect(isAllowed(evaluateAccess(authenticated(clinician), STAFF_ROUTE))).toBe(true)
  })

  it('allows a platform administrator only into the platform routes', () => {
    expect(isAllowed(evaluateAccess(authenticated(platformAdmin), PLATFORM_ADMIN_ROUTE))).toBe(true)
    expect(evaluateAccess(authenticated(clinician), PLATFORM_ADMIN_ROUTE)).toEqual({
      outcome: 'wrong-portal',
      actual: 'staff',
    })
  })

  it('rejects a correct portal with an insufficient role', () => {
    const orgAdmin = { ...clinician, appRole: 'org_admin' } as StaffPrincipal
    expect(
      evaluateAccess(authenticated(orgAdmin), {
        principalKinds: ['staff'],
        appRoles: ['clinician'],
      }),
    ).toEqual({ outcome: 'not-permitted' })
  })

  it('never returns allow for an anonymous session, whatever the requirement', () => {
    for (const requirement of [PATIENT_ROUTE, STAFF_ROUTE, PLATFORM_ADMIN_ROUTE]) {
      expect(isAllowed(evaluateAccess(anonymous, requirement))).toBe(false)
      expect(isAllowed(evaluateAccess(INITIAL_SESSION_STATE, requirement))).toBe(false)
    }
  })
})
