import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { HID_ENDPOINTS, findEndpoint } from '../registry'

/**
 * Nursing on the ward (hid-system NUR-1, migrations 0174-0177, on claude/sprint-inpatient-backend, #343), as the blue
 * EHR's nursing pages call it, with ADT-1's three reads it stands on. Proposed: not served until #343 is live. No Health
 * ID in any address. Every id here is fictional.
 */
const ADMISSION = 'd0000000-0000-4000-8000-0000000000d1'
const NAMES = ['ehr.wards', 'ehr.admissions', 'ehr.admission', 'ehr.observationChart', 'ehr.admissionMedicineRound', 'ehr.medicineRound',
  'ehr.medicineAdministrations', 'ehr.medicineAdministrationEnteredInError', 'ehr.nursingTasks', 'ehr.admissionNursingTasks',
  'ehr.nursingTask', 'ehr.nursingTaskStart', 'ehr.nursingTaskComplete', 'ehr.nursingTaskCancel', 'ehr.fluidBalance',
  'ehr.fluidEntryEnteredInError', 'ehr.clinicalShifts', 'ehr.clinicalShift', 'ehr.shiftAssignments', 'ehr.handovers',
  'ehr.handoverPatient', 'ehr.handoverGive', 'ehr.handoverAccept']

describe('nursing routes (hid-system NUR-1)', () => {
  it('registers each route as proposed with the backend’s codes, for the provider portal only', () => {
    for (const name of NAMES) {
      expect(findEndpoint(name)?.status).toBe('proposed')
      expect(() => assertEndpointAllowed('staff-web', name)).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name)).toThrow(BoundaryViolationError)
    }
    expect(findEndpoint('ehr.observationChart')?.permissions).toEqual({ GET: ['ehr.vital.read', 'ehr.admission.read'] })
    expect(findEndpoint('ehr.medicineAdministrations')?.permissions).toEqual({ POST: ['ehr.mar.record'] })
    expect(findEndpoint('ehr.fluidBalance')?.permissions).toEqual({ GET: ['ehr.vital.read'], POST: ['ehr.vital.write'] })
    expect(findEndpoint('ehr.clinicalShifts')?.permissions).toEqual({ POST: ['ehr.clinical-shift.manage'] })
    expect(findEndpoint('ehr.shiftAssignments')?.permissions).toEqual({ PUT: ['ehr.shift-assignment.manage'] })
    expect(findEndpoint('ehr.handoverPatient')?.permissions).toEqual({ PUT: ['ehr.handover.write'] })
    // ADT-1's reads the nursing pages stand on, registered as ADT-1's own pages register them (health#335), so the two
    // never disagree: the ward list opens with either ward code, so none is listed for GET.
    expect(findEndpoint('ehr.wards')?.methods).toEqual(['GET', 'POST'])
    expect(findEndpoint('ehr.wards')?.permissions).toEqual({ POST: ['ehr.ward.manage'] })
    expect(findEndpoint('ehr.admissions')?.methods).toEqual(['GET', 'POST'])
    expect(findEndpoint('ehr.admissions')?.permissions).toEqual({ GET: ['ehr.ward.read'], POST: ['ehr.admission.read', 'ehr.admission.decide'] })
    expect(findEndpoint('ehr.admission')?.methods).toEqual(['GET', 'PATCH'])
    expect(findEndpoint('ehr.admission')?.permissions).toEqual({ GET: ['ehr.ward.read'], PATCH: ['ehr.admission.read', 'ehr.admission.decide'] })
    for (const name of ['ehr.wards', 'ehr.admissions', 'ehr.admission']) {
      expect(HID_ENDPOINTS.filter(endpoint => endpoint.name === name)).toHaveLength(1)
    }
  })

  it('tells the ward round from a stay’s record, and a task from its steps', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/medicine-round', { wardId: 'c1', window: 'now' }).name).toBe('ehr.medicineRound')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/admissions/${ADMISSION}/medicine-round`).name).toBe('ehr.admissionMedicineRound')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/nursing-tasks/a1/complete').name).toBe('ehr.nursingTaskComplete')
    expect(assertRegisteredBrowserRequest('PATCH', '/api/v1/ehr/nursing-tasks/a1').name).toBe('ehr.nursingTask')
    expect(assertRegisteredBrowserRequest('PUT', `/api/v1/ehr/handovers/new/patients/${ADMISSION}`).name).toBe('ehr.handoverPatient')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/handovers', { wardId: 'c1', date: '2026-12-03', shiftId: 's1' }).name).toBe('ehr.handovers')
    expect(() => assertRegisteredBrowserRequest('DELETE', '/api/v1/ehr/nursing-tasks/a1')).toThrow(BrowserRouteError)
  })

  it('asks the ward round, assignments and handover for the ward, day and shift they are for', () => {
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/medicine-round')).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/handovers', { wardId: 'c1' })).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', '/api/v1/ehr/shift-assignments', { wardId: 'c1', date: '2026-12-03' })).toThrow(BrowserRouteError)
  })
})
