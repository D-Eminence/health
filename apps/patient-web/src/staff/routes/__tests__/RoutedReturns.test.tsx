import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

/**
 * What came back to the ordering facility from a laboratory at another facility (Novu, P4c, SPEC-FINAL §13.1 "Returns",
 * C3): read only when the clinician asks (each read is audited), result by result: the value to use first, with its unit,
 * flag and reference range and a correction's reason; each version a correction replaced, marked as replaced; a version
 * marked entered in error, naming the value it voids; earlier routes of the same order, each with who confirmed the
 * patient agreed; and what a refused read means.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(),
}))
const routes = vi.hoisted(() => ({ attestation: vi.fn(), destinations: vi.fn(), send: vi.fn(), routes: vi.fn(), withdraw: vi.fn() }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
  orderRoutesApi: routes,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ade Okon', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write', 'ehr.order-route.send'],
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const REQUEST = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const summary = (overrides: Record<string, unknown> = {}) => ({ id: '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', reference: '9C1B2D3E',
  kind: 'lab_request', version: 3, effectiveState: 'completed', receivingFacility: { id: 'f-yaba', name: 'Yaba Diagnostics', available: true },
  createdAt: '2026-10-20T09:00:00.000Z', respondBy: '2026-10-27T09:00:00.000Z', acceptedAt: '2026-10-21T10:00:00.000Z',
  completedAt: '2026-10-22T10:00:00.000Z', endedAt: null, endedKind: null, declineReason: null, acceptLocked: false, resendAllowed: false,
  ...overrides })
const attestation = (name: string, facility: string) => ({ textVersion: 'order-route-lab-attestation-v1', attestedByName: name,
  attestedAt: '2026-10-20T09:00:00.000Z', receivingFacilityName: facility })
const result = (overrides: Record<string, unknown>) => ({ resultId: 'r1', resultVersion: 1, kind: 'released',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, resultType: 'numeric', numericValue: '9.8', textValue: null,
  unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low', revisionKind: 'original', correctionReason: null,
  occurredAt: '2026-10-22T10:00:00.000Z', ...overrides })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [{ patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1',
    createdAt: '2026-10-10T08:05:00.000Z', id: REQUEST, testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin',
    priority: 'routine', status: 'active', clinicalInformation: null, rowVersion: '2', orderRoute: summary() }],
  nextCursor: null, crossFacilityOrders: true })
})
afterEach(() => { vi.unstubAllEnvs() })

async function openDetails() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Show details and results' }))
}

function lines() {
  return [...document.querySelectorAll('.staff-order-route .staff-order-notes li')].map(item => item.textContent)
}

describe('results that came back from another laboratory', () => {
  it('lists each result, the value to use first, with a correction’s reason and a result marked entered in error', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [
        result({ resultId: 'r2', test: { codeSystem: 'LOINC', code: '6690-2', name: 'White cell count' }, kind: 'entered_in_error',
          resultType: null, numericValue: null, unit: null, referenceRange: null, abnormalFlag: null, revisionKind: null,
          occurredAt: '2026-10-24T10:00:00.000Z' }),
        result({ resultVersion: 2, numericValue: '10.1', abnormalFlag: 'critical_candidate', revisionKind: 'correction',
          correctionReason: 'Sample re-run on a calibrated analyser', occurredAt: '2026-10-23T10:00:00.000Z' }),
        result({ resultId: 'r2', test: { codeSystem: 'LOINC', code: '6690-2', name: 'White cell count' }, resultType: 'text',
          numericValue: null, textValue: 'Within limits', unit: null, referenceRange: null, abnormalFlag: 'normal',
          occurredAt: '2026-10-23T12:00:00.000Z' }),
        result({}),
      ] }] })
    await openDetails()
    await waitFor(() => expect(lines()).toHaveLength(3))
    expect(lines()).toEqual([
      'Haemoglobin (current result): Released by Yaba Diagnostics on 23 Oct 2026: 10.1 g/dL, flagged possibly critical, '
        + 'reference 12.0-15.5. Corrected on 23 Oct 2026: Sample re-run on a calibrated analyser',
      'Haemoglobin (replaced): Released by Yaba Diagnostics on 22 Oct 2026: 9.8 g/dL, flagged low, reference 12.0-15.5. '
        + 'Replaced by the correction of 23 Oct 2026: do not use it.',
      'White cell count (do not use): Marked entered in error by Yaba Diagnostics on 24 Oct 2026: the value released on '
        + '23 Oct 2026, Within limits. No value of this result stands: contact Yaba Diagnostics.',
    ])
  })

  it('never shows a value that a correction replaced as a plain release (low haemoglobin corrected to normal)', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [
        result({ numericValue: '11.2', abnormalFlag: 'low', occurredAt: '2026-10-22T10:00:00.000Z' }),
        result({ resultVersion: 2, numericValue: '13.0', abnormalFlag: 'normal', revisionKind: 'correction',
          correctionReason: 'Analyser recalibrated', occurredAt: '2026-10-23T10:00:00.000Z' }),
      ] }] })
    await openDetails()
    await waitFor(() => expect(lines()).toHaveLength(2))
    expect(lines()).toEqual([
      'Haemoglobin (current result): Released by Yaba Diagnostics on 23 Oct 2026: 13.0 g/dL, reference 12.0-15.5. '
        + 'Corrected on 23 Oct 2026: Analyser recalibrated',
      'Haemoglobin (replaced): Released by Yaba Diagnostics on 22 Oct 2026: 11.2 g/dL, flagged low, reference 12.0-15.5. '
        + 'Replaced by the correction of 23 Oct 2026: do not use it.',
    ])
    expect(lines().filter(line => /flagged low/.test(line ?? '')).every(line => /Replaced by the correction/.test(line ?? ''))).toBe(true)
  })

  it('says which value a correction marked entered in error voids, and that the value it replaced does not come back', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [
        result({ numericValue: '11.2', abnormalFlag: 'low', occurredAt: '2026-10-22T10:00:00.000Z' }),
        result({ resultVersion: 2, numericValue: '13.0', abnormalFlag: 'normal', revisionKind: 'correction',
          correctionReason: 'Analyser recalibrated', occurredAt: '2026-10-23T10:00:00.000Z' }),
        result({ resultVersion: 2, kind: 'entered_in_error', resultType: null, numericValue: null, unit: null, referenceRange: null,
          abnormalFlag: null, revisionKind: null, correctionReason: null, occurredAt: '2026-10-24T10:00:00.000Z' }),
      ] }] })
    await openDetails()
    await waitFor(() => expect(lines()).toHaveLength(2))
    expect(lines()).toEqual([
      'Haemoglobin (do not use): Marked entered in error by Yaba Diagnostics on 24 Oct 2026: the value released on 23 Oct 2026, '
        + '13.0 g/dL, reference 12.0-15.5. No value of this result stands: contact Yaba Diagnostics.',
      'Haemoglobin (replaced): Released by Yaba Diagnostics on 22 Oct 2026: 11.2 g/dL, flagged low, reference 12.0-15.5. '
        + 'Replaced by the correction of 23 Oct 2026: do not use it.',
    ])
  })

  it('keeps two results of the same test apart, each as released', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [
        result({ resultId: 'r9', numericValue: '12.4', abnormalFlag: 'normal', occurredAt: '2026-10-23T10:00:00.000Z' }),
        result({}),
      ] }] })
    await openDetails()
    await waitFor(() => expect(lines()).toHaveLength(2))
    expect(lines()).toEqual([
      'Haemoglobin: Released by Yaba Diagnostics on 22 Oct 2026: 9.8 g/dL, flagged low, reference 12.0-15.5',
      'Haemoglobin: Released by Yaba Diagnostics on 23 Oct 2026: 12.4 g/dL, reference 12.0-15.5',
    ])
  })

  it('says nothing has come back yet from a laboratory that accepted it', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary({ effectiveState: 'accepted', completedAt: null }),
      attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [], results: [] }] })
    await openDetails()
    expect(await screen.findByText('Nothing has come back from Yaba Diagnostics yet.')).toBeTruthy()
  })

  it('shows an earlier route of the same order, with who confirmed the patient agreed to it', async () => {
    routes.routes.mockResolvedValue({ items: [
      { ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [], results: [result({})] },
      { ...summary({ id: 'r-old', reference: '1A2B3C4D', effectiveState: 'declined', declineReason: 'test_not_offered',
        receivingFacility: { id: 'f-ikeja', name: 'Ikeja Labs', available: true }, acceptedAt: null, completedAt: null }),
      attestation: attestation('Dr Bola Ade', 'Ikeja Labs'), events: [], results: [] },
    ] })
    await openDetails()
    expect(await screen.findByText('Earlier: Declined by Ikeja Labs: This test isn’t offered. Send it elsewhere.')).toBeTruthy()
    expect(screen.getByText(/^Dr Bola Ade confirmed on .* that Ada Patient agreed to send it to Ikeja Labs\.$/)).toBeTruthy()
    expect(screen.getByText(/^Dr Ade Okon confirmed on .* that Ada Patient agreed to send it to Yaba Diagnostics\.$/)).toBeTruthy()
  })

  it.each([
    [new HidApiError(403, 'Denied', { code: 'CONSENT_REQUIRED' }), 'Your access to this patient does not cover this order’s details.'],
    [new HidApiError(404, 'Gone', { code: 'ORDER_NOT_FOUND' }), 'This order was not found. Reload the list.'],
    [new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }), 'Sending orders to other facilities is not available yet.'],
    [new HidApiError(503, 'Down', { code: 'UPSTREAM_UNAVAILABLE' }), 'The details could not be loaded. Try again.'],
  ])('says what a refused read means (%s)', async (error, says) => {
    routes.routes.mockRejectedValue(error)
    await openDetails()
    expect((await screen.findByRole('alert')).textContent).toBe(says)
  })
})
