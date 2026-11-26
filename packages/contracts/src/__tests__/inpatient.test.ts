import { describe, expect, it } from 'vitest'
import { BoundaryViolationError, assertEndpointAllowed } from '../boundaries'
import { BrowserRouteError, assertRegisteredBrowserRequest } from '../browser-routes'
import { findEndpoint } from '../registry'

/**
 * Inpatient admission, wards and beds (hid-system ADT-1, 0170-0173 on claude/sprint-inpatient-backend, hid-system#343,
 * Release D, not live), as the blue EHR's Inpatient / Wards, Wards & Beds, ICU and Ward configuration pages call it.
 * Proposed until the backend is live. No Health ID or NIN in any address. Every id here is fictional.
 */
const WARD = 'd0000000-0000-4000-8000-0000000000d1'
const BED = 'b0000000-0000-4000-8000-0000000000b1'
const ADMISSION = 'a0000000-0000-4000-8000-0000000000a1'
const MOVEMENT = 'c0000000-0000-4000-8000-0000000000c1'

const ADT_ROUTES = ['ehr.wards', 'ehr.ward', 'ehr.wardBeds', 'ehr.wardStaff', 'ehr.bed', 'ehr.bedStatus', 'ehr.bedBoard', 'ehr.census',
  'ehr.admissions', 'ehr.admission', 'ehr.admissionAdmit', 'ehr.admissionTransfer', 'ehr.admissionHandover',
  'ehr.admissionPrepareDischarge', 'ehr.admissionDischarge', 'ehr.admissionCancel', 'ehr.admissionDischargeSummary',
  'ehr.admissionWristband', 'ehr.admissionNewbornBand']

describe('inpatient routes (hid-system ADT-1)', () => {
  it('registers every route as proposed, with a note naming the branch and the switch', () => {
    for (const name of ADT_ROUTES) {
      const endpoint = findEndpoint(name)
      expect(endpoint?.status, name).toBe('proposed')
      expect(endpoint?.note, name).toMatch(/ADT-1.*INPATIENT_NOT_AVAILABLE/)
    }
    expect(findEndpoint('ehr.wards')).toMatchObject({ path: '/api/v1/ehr/wards', methods: ['GET', 'POST'],
      permissions: { POST: ['ehr.ward.manage'] } })
    // Ward staff or a ward admin read the list: neither code alone is required.
    expect(findEndpoint('ehr.wards')?.permissions?.GET).toBeUndefined()
    expect(findEndpoint('ehr.bedStatus')?.permissions).toBeUndefined()
    expect(findEndpoint('ehr.wardStaff')).toMatchObject({ methods: ['PUT'], permissions: { PUT: ['ehr.ward.manage'] } })
    expect(findEndpoint('ehr.admissions')?.permissions).toEqual({ GET: ['ehr.ward.read'],
      POST: ['ehr.admission.read', 'ehr.admission.decide'] })
    expect(findEndpoint('ehr.admissionAdmit')?.permissions).toEqual({ POST: ['ehr.ward.read', 'ehr.bed.allocate'] })
    expect(findEndpoint('ehr.admissionDischarge')?.permissions).toEqual({ POST: ['ehr.admission.read', 'ehr.admission.decide'] })
    expect(findEndpoint('ehr.admissionWristband')?.permissions).toEqual({ POST: ['ehr.ward.read', 'ehr.wristband.print'] })
  })

  it('lets only the provider portal call them', () => {
    for (const name of ADT_ROUTES) {
      expect(() => assertEndpointAllowed('staff-web', name), name).not.toThrow()
      expect(() => assertEndpointAllowed('patient-web', name), name).toThrow(BoundaryViolationError)
    }
  })

  it('tells each address apart', () => {
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/wards', { includeBeds: true }).name).toBe('ehr.wards')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/wards').name).toBe('ehr.wards')
    expect(assertRegisteredBrowserRequest('PATCH', `/api/v1/ehr/wards/${WARD}`).name).toBe('ehr.ward')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/ehr/wards/${WARD}/beds`).name).toBe('ehr.wardBeds')
    expect(assertRegisteredBrowserRequest('PUT', `/api/v1/ehr/wards/${WARD}/staff`).name).toBe('ehr.wardStaff')
    expect(assertRegisteredBrowserRequest('PATCH', `/api/v1/ehr/beds/${BED}`).name).toBe('ehr.bed')
    expect(assertRegisteredBrowserRequest('POST', `/api/v1/ehr/beds/${BED}/status`).name).toBe('ehr.bedStatus')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/bed-board', { wardType: 'icu' }).name).toBe('ehr.bedBoard')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/census', { date: '2026-12-03' }).name).toBe('ehr.census')
    expect(assertRegisteredBrowserRequest('GET', '/api/v1/ehr/admissions', { wardType: 'icu' }).name).toBe('ehr.admissions')
    expect(assertRegisteredBrowserRequest('POST', '/api/v1/ehr/admissions').name).toBe('ehr.admissions')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/admissions/${ADMISSION}`).name).toBe('ehr.admission')
    expect(assertRegisteredBrowserRequest('PATCH', `/api/v1/ehr/admissions/${ADMISSION}`).name).toBe('ehr.admission')
    for (const [action, name] of [['admit', 'ehr.admissionAdmit'], ['transfer', 'ehr.admissionTransfer'],
      ['prepare-discharge', 'ehr.admissionPrepareDischarge'], ['discharge', 'ehr.admissionDischarge'], ['cancel', 'ehr.admissionCancel'],
      ['wristband', 'ehr.admissionWristband'], ['newborn-band', 'ehr.admissionNewbornBand']] as const) {
      expect(assertRegisteredBrowserRequest('POST', `/api/v1/ehr/admissions/${ADMISSION}/${action}`).name, action).toBe(name)
    }
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/admissions/${ADMISSION}/discharge-summary`).name)
      .toBe('ehr.admissionDischargeSummary')
    expect(assertRegisteredBrowserRequest('GET', `/api/v1/ehr/admissions/${ADMISSION}/movements/${MOVEMENT}/handover`).name)
      .toBe('ehr.admissionHandover')
  })

  it('has no route that deletes a ward, bed or admission, or calls the switched-off death record', () => {
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/wards/${WARD}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/beds/${BED}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('DELETE', `/api/v1/ehr/admissions/${ADMISSION}`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('POST', `/api/v1/ehr/admissions/${ADMISSION}/death-record`)).toThrow(BrowserRouteError)
    expect(() => assertRegisteredBrowserRequest('GET', `/api/v1/ehr/admissions/${ADMISSION}/wristband`)).toThrow(BrowserRouteError)
  })
})
