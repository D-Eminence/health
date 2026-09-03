import { describe, expect, it } from 'vitest'
import {
  APP_BOUNDARIES,
  BoundaryViolationError,
  assertEndpointAllowed,
  canUseService,
} from '../boundaries'
import { HID_ENDPOINTS, SERVICES_WITHOUT_CONTRACTS, findEndpoint } from '../registry'
import type { HidApp } from '../boundaries'

const ALL_APPS = Object.keys(APP_BOUNDARIES) as HidApp[]

describe('application boundaries', () => {
  it('grants the public site nothing that can reach patient data', () => {
    const publicServices = APP_BOUNDARIES['public-web'].services
    expect(publicServices).toEqual(['platform'])
    expect(APP_BOUNDARIES['public-web'].handlesPhi).toBe(false)
  })

  it('marks every application that touches a patient as handling PHI', () => {
    for (const app of ALL_APPS) {
      const boundary = APP_BOUNDARIES[app]
      const reachesPatients = boundary.services.some(service =>
        ['ehr', 'access', 'files', 'admin', 'outreach', 'ocr', 'lab', 'pharmacy'].includes(service),
      )
      if (reachesPatients) expect(boundary.handlesPhi).toBe(true)
    }
  })

  it('keeps administration out of the patient and staff applications', () => {
    expect(canUseService('patient-web', 'admin')).toBe(false)
    expect(canUseService('staff-web', 'admin')).toBe(false)
    expect(canUseService('admin-web', 'admin')).toBe(true)
  })

  it('keeps clinical services out of outreach, which is a registration workflow', () => {
    expect(canUseService('outreach-web', 'ehr')).toBe(false)
    expect(canUseService('outreach-web', 'outreach')).toBe(true)
  })

  it('gives every application a stated purpose', () => {
    for (const app of ALL_APPS) {
      expect(APP_BOUNDARIES[app].purpose.length).toBeGreaterThan(20)
    }
  })
})

describe('assertEndpointAllowed', () => {
  it('permits an endpoint inside the application grant', () => {
    expect(() => assertEndpointAllowed('patient-web', 'patients-me')).not.toThrow()
    expect(() => assertEndpointAllowed('admin-web', 'admin-billing')).not.toThrow()
  })

  it('rejects an endpoint outside the grant and says what is allowed', () => {
    expect(() => assertEndpointAllowed('patient-web', 'admin-billing')).toThrow(
      BoundaryViolationError,
    )
    expect(() => assertEndpointAllowed('patient-web', 'admin-billing')).toThrow(
      /may not call the "admin" service/,
    )
  })

  it('stops the public site reaching a clinical endpoint', () => {
    expect(() => assertEndpointAllowed('public-web', 'patients-records')).toThrow(
      BoundaryViolationError,
    )
  })

  it('rejects an endpoint that is not in the registry rather than assuming it exists', () => {
    expect(() => assertEndpointAllowed('patient-web', 'patient-preferences')).toThrow(
      /not a known Health ID endpoint/,
    )
  })

  it('refuses services that have no confirmed contracts', () => {
    for (const service of SERVICES_WITHOUT_CONTRACTS) {
      expect(HID_ENDPOINTS.filter(descriptor => descriptor.service === service)).toHaveLength(0)
    }
    // lab-web is granted the lab service, but there is nothing to call.
    expect(() => assertEndpointAllowed('lab-web', 'lab-orders-list')).toThrow(
      /not a known Health ID endpoint/,
    )
  })
})

describe('endpoint registry', () => {
  it('has no duplicate endpoint names', () => {
    const names = HID_ENDPOINTS.map(descriptor => descriptor.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('declares at least one method for every endpoint', () => {
    for (const descriptor of HID_ENDPOINTS) {
      expect(descriptor.methods.length).toBeGreaterThan(0)
    }
  })

  it('restricts every admin endpoint to platform administrators', () => {
    for (const descriptor of HID_ENDPOINTS.filter(entry => entry.service === 'admin')) {
      expect(descriptor.auth).toEqual({ kind: 'role', roles: ['platform_admin'] })
    }
  })

  it('keeps the public surface small and explicitly enumerated', () => {
    const publicEndpoints = HID_ENDPOINTS.filter(entry => entry.auth.kind === 'public').map(
      entry => entry.name,
    )

    // Sign-in, sign-up, password reset and outreach onboarding are unauthenticated
    // by necessity. Anything else appearing here needs justifying.
    expect(publicEndpoints.sort()).toEqual(
      [
        'admin-password-reset-start',
        'google-signin-eligibility',
        'health-check',
        'outreach-join',
        'outreach-resend-otp',
        'outreach-signup',
        'outreach-verify-otp',
        'patient-login',
        'patient-reset-complete',
        'patient-reset-start',
        'patient-reset-verify',
        'signup-availability',
        'signup-start',
        'signup-verify',
        'staff-login',
      ].sort(),
    )
  })

  it('marks record writes as non-idempotent in their notes', () => {
    expect(findEndpoint('records-create')?.note).toMatch(/not idempotent/i)
    expect(findEndpoint('records-version-create')?.note).toMatch(/not idempotent/i)
  })

  it('flags signed file URLs as values that must not be persisted', () => {
    expect(findEndpoint('files-sign-download')?.note).toMatch(/never persist/i)
    expect(findEndpoint('files-sign-upload')?.note).toMatch(/never persist/i)
  })
})
