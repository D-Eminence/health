import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Appointments (hid-system APPT-1, 0160 and 0161 on claude/sprint-appointments-backend, Release D, not live), as the blue
 * EHR's Appointments and the portal's "My appointments" call them. Proposed until the backend is live. No Health ID or
 * NIN in any address. Every id here is fictional.
 */
const APPOINTMENT = 'a0000000-0000-4000-8000-00000000a001'
const PATIENT = 'b0000000-0000-4000-8000-00000000b001'
const CLINIC = 'c0000000-0000-4000-8000-00000000c001'

const STAFF_ROUTES = ['ehr.appointments', 'ehr.appointmentBookableStaff', 'ehr.appointment', 'ehr.appointmentReschedule',
  'ehr.appointmentCancel', 'ehr.appointmentNoShow', 'ehr.appointmentCheckIn', 'ehr.patientAppointments',
  'ehr.appointmentClinics', 'ehr.appointmentClinic', 'ehr.appointmentSettings', 'identity.appointmentCallList']

describe('appointments routes (hid-system APPT-1)', () => {
  it('registers every route as proposed, with the backend’s codes', () => {
    for (const name of [...STAFF_ROUTES, 'ehr.myAppointments']) expect(findEndpoint(name)?.status).toBe('proposed')
    expect(findEndpoint('ehr.appointments')).toMatchObject({ path: '/api/v1/ehr/appointments', methods: ['GET', 'POST'],
      permissions: { GET: ['ehr.appointment.read'], POST: ['ehr.appointment.write'] } })
    expect(findEndpoint('ehr.appointmentCheckIn')?.permissions).toEqual({ POST: ['ehr.appointment.write', 'ehr.encounter.read', 'ehr.encounter.write'] })
    expect(findEndpoint('ehr.appointmentNoShow')?.permissions).toEqual({ POST: ['ehr.appointment.write'] })
    expect(findEndpoint('ehr.appointmentClinic')?.permissions).toEqual({ PATCH: ['organization.manage'] })
    expect(findEndpoint('ehr.appointmentSettings')).toMatchObject({ methods: ['GET', 'PATCH'], permissions: { PATCH: ['organization.manage'] } })
    expect(findEndpoint('identity.appointmentCallList')?.permissions).toEqual({ GET: ['ehr.appointment.write'] })
  })

  it('lets the provider portal call the staff routes and only the portal call "My appointments"', () => {
    for (const name of STAFF_ROUTES) {
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(BoundaryViolationError)
    }
    expect(() => assertEndpointAllowed('patient-web', 'ehr.myAppointments')).not.toThrow()
    expect(() => assertEndpointAllowed('staff-web', 'ehr.myAppointments')).toThrow(BoundaryViolationError)
    expect(() => assertEndpointAllowed('ehr-web', 'ehr.myAppointments')).toThrow(BoundaryViolationError)
  })

  it('tells each address apart, a static one before an id', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/appointments', { day: '2026-12-03' }).name).toBe('ehr.appointments')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/appointments').name).toBe('ehr.appointments')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/appointments/bookable-staff').name).toBe('ehr.appointmentBookableStaff')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/appointments/${APPOINTMENT}`).name).toBe('ehr.appointment')
    for (const [action, name] of [['reschedule', 'ehr.appointmentReschedule'], ['cancel', 'ehr.appointmentCancel'],
      ['no-show', 'ehr.appointmentNoShow'], ['check-in', 'ehr.appointmentCheckIn']] as const) {
      expect(assertRegisteredBrowserRequest('POST', `/api/v1/ehr/appointments/${APPOINTMENT}/${action}`).name).toBe(name)
    }
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/patients/${PATIENT}/appointments`).name).toBe('ehr.patientAppointments')
    expect(assertRegisteredBrowserRequest('PATCH', `/api/v1/ehr/appointment-clinics/${CLINIC}`).name).toBe('ehr.appointmentClinic')
    expect(assertRegisteredBrowserRequest('PATCH', '/api/v1/ehr/appointment-settings').name).toBe('ehr.appointmentSettings')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/identity/appointment-call-list', { day: '2026-12-03' }).name)
      .toBe('identity.appointmentCallList')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/me/appointments', { when: 'upcoming' }).name).toBe('ehr.myAppointments')
    // The contract's PUT is served as PATCH; there is no delete of an appointment or a clinic.
    expect(() => assertRegisteredBrowserRequest('PUT', '/api/v1/ehr/appointment-settings')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/appointments/${APPOINTMENT}`)).toThrow(BrowserRouteError)
  })

  it('needs a day for the lists, and refuses a Health ID, NIN or phone in their addresses', () => {
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/appointments')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/appointment-call-list')).toThrow(BrowserRouteError)
    for (const key of ['healthId', 'nin', 'phone']) {
      expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/appointments', { day: '2026-12-03', [key]: 'HID-ZZZZ22' }))
        .toThrow(BrowserRouteError)
      expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/identity/appointment-call-list', { day: '2026-12-03', [key]: 'x' }))
        .toThrow(BrowserRouteError)
    }
  })

  it('keeps the email Identity asks notification-api to send off the browser surface', () => {
    expect(() => assertRegisteredBrowserRequest('POST', '/api/v1/notifications/appointment-notice')).toThrow(BrowserRouteError)
  })
})
