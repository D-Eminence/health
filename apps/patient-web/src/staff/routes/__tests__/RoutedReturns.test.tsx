import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'

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

/**
 * Item 3 (owner decision D19; SPEC-FINAL §8.2, §9.2): an order the laboratory ended as accepted for someone who was not the
 * patient. The row says what the laboratory reports, with a red notice; each result it had released reads "another
 * person's result, withdrawn by {lab} on {date}", and its value (another person's) stays hidden until asked for.
 */
describe('an order the laboratory reports it accepted for the wrong person', () => {
  const wrong = (overrides: Record<string, unknown> = {}) => summary({ endedKind: 'wrong_patient', endedAt: '2026-10-24T09:00:00.000Z',
    version: 6, ...overrides })
  function serveRecord(route: Record<string, unknown>) {
    api.records.mockResolvedValue({ items: [{ patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1',
      createdAt: '2026-10-10T08:05:00.000Z', id: REQUEST, testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin',
      priority: 'routine', status: 'active', clinicalInformation: null, rowVersion: '2', orderRoute: route }],
    nextCursor: null, crossFacilityOrders: true })
  }

  it('says what the laboratory reports, in red, and hides each withdrawn value until asked for', async () => {
    serveRecord(wrong())
    routes.routes.mockResolvedValue({ items: [{ ...wrong(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [
        result({}),
        result({ kind: 'entered_in_error', resultType: null, numericValue: null, unit: null, referenceRange: null, abnormalFlag: null,
          revisionKind: null, occurredAt: '2026-10-24T09:00:00.000Z' }),
        result({ resultVersion: 2, numericValue: '10.4', revisionKind: 'correction', correctionReason: 'Re-run',
          occurredAt: '2026-10-23T10:00:00.000Z' }),
        result({ resultVersion: 2, kind: 'entered_in_error', resultType: null, numericValue: null, unit: null, referenceRange: null,
          abnormalFlag: null, revisionKind: null, occurredAt: '2026-10-24T09:00:00.000Z' }),
      ] }] })
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    expect(await screen.findByText('Yaba Diagnostics reports that the results it released belong to someone else, and has ended it. Do not use them.')).toBeTruthy()
    const panel = document.querySelector('.staff-order-route') as HTMLElement
    const notice = panel.querySelector('.staff-danger') as HTMLElement
    expect([...notice.querySelectorAll('p')].map(line => line.textContent)).toEqual([
      'This order can’t be sent again. Write a new lab request if Ada Patient still needs it.',
      'Do not use any result from Yaba Diagnostics on this order: Yaba Diagnostics reports they are another person’s. Ada Patient '
        + 'has not been tested: repeat the test if it is still needed. If you acted on a result, review Ada Patient’s care. Tell Ada '
        + 'Patient that a result they may have seen was not theirs.'])
    // The order can't be sent again: no Send.
    expect(screen.queryByRole('button', { name: 'Send to another laboratory' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show details and results' }))
    await waitFor(() => expect(lines()).toHaveLength(2))
    const withdrawn = 'Haemoglobin (do not use): another person’s result, withdrawn by Yaba Diagnostics on 24 Oct 2026.'
    expect(lines()).toEqual([`${withdrawn} Show the withdrawn value`, `${withdrawn} Show the withdrawn value`])
    // Neither value is on the page until it is asked for.
    expect(panel.textContent).not.toMatch(/9\.8|10\.4|g\/dL/)
    const reveal = screen.getAllByRole('button', { name: 'Show the withdrawn value' })
    expect(reveal[0]!.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(reveal[0]!)
    expect(lines()[0]).toBe(`${withdrawn} Hide the withdrawn value Released by Yaba Diagnostics on 23 Oct 2026: 10.4 g/dL, flagged low, reference 12.0-15.5`)
    expect(panel.textContent).not.toMatch(/9\.8/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the withdrawn value' })[0]!)
    expect(lines()[1]).toMatch(/Released by Yaba Diagnostics on 22 Oct 2026: 9\.8 g\/dL/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide the withdrawn value' })[0]!)
    expect(panel.textContent).not.toMatch(/10\.4/)
  })

  it('says nothing came back from an order ended before anything was released', async () => {
    serveRecord(wrong({ effectiveState: 'cancelled', completedAt: null }))
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    expect(await screen.findByText('Yaba Diagnostics reports that it accepted this for someone who was not Ada Patient, and has ended it. '
      + 'Nothing came back from it.')).toBeTruthy()
    const notice = document.querySelector('.staff-order-route .staff-danger') as HTMLElement
    expect(notice.textContent).toBe('This order can’t be sent again. Write a new lab request if Ada Patient still needs it.')
  })

  it('leaves the returns of every other order as they were, values shown', async () => {
    routes.routes.mockResolvedValue({ items: [{ ...summary(), attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
      results: [result({})] }] })
    await openDetails()
    await waitFor(() => expect(lines()).toHaveLength(1))
    expect(lines()).toEqual(['Haemoglobin: Released by Yaba Diagnostics on 22 Oct 2026: 9.8 g/dL, flagged low, reference 12.0-15.5'])
    expect(screen.queryByRole('button', { name: 'Show the withdrawn value' })).toBeNull()
    expect(document.querySelector('.staff-order-route .staff-danger')).toBeNull()
  })
})

/**
 * D17 (hid-system 0090; SPEC-FINAL §9.2): the laboratory reported, after the order had ended another way (support's close,
 * the clinician's entered in error), that it accepted it for the wrong person, and withdrew the results. The clinician reads
 * item 3's red warning, the values hidden, and that what they recorded from them still shows (D17-4); an order something
 * came back on, not reported, says whom to phone with the reference and until when (D17-5). None of it without the
 * backend's D17 fields.
 */
describe('a late report, and the guidance with the order’s own date (D17)', () => {
  const late = { wrongPatient: { reportedAt: '2026-11-21T09:00:00.000Z', late: true }, correctableUntil: null }
  function serve(route: Record<string, unknown>, fields: Record<string, unknown> = { lateCorrection: true }) {
    api.records.mockResolvedValue({ items: [{ patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1',
      createdAt: '2026-10-10T08:05:00.000Z', id: REQUEST, testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Haemoglobin',
      priority: 'routine', status: 'active', clinicalInformation: null, rowVersion: '2', orderRoute: route }],
    nextCursor: null, crossFacilityOrders: true, wrongPatientReports: true, ...fields })
  }
  beforeEach(() => { forgetLateCorrectionServed() })
  afterEach(() => { forgetLateCorrectionServed() })

  it.each([['support', 'closed by support'], ['entered_in_error', 'marked entered in error by the clinician']])(
    'warns in red and hides the values of an order ended %s and reported late (%s)', async endedKind => {
      const route = summary({ endedKind, endedAt: '2026-11-01T09:00:00.000Z', ...late })
      serve(route)
      routes.routes.mockResolvedValue({ items: [{ ...route, attestation: attestation('Dr Ade Okon', 'Yaba Diagnostics'), events: [],
        results: [result({}), result({ kind: 'entered_in_error', resultType: null, numericValue: null, unit: null, referenceRange: null,
          abnormalFlag: null, revisionKind: null, occurredAt: '2026-11-21T09:00:00.000Z' })] }] })
      render(<MemoryRouter><Clinical /></MemoryRouter>)
      fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
      expect(await screen.findByText('Yaba Diagnostics reports that the results it released belong to someone else, and has withdrawn '
        + 'them. Do not use them.')).toBeTruthy()
      const panel = document.querySelector('.staff-order-route') as HTMLElement
      const notice = panel.querySelector('.staff-danger') as HTMLElement
      expect([...notice.querySelectorAll('p')].map(line => line.textContent)).toEqual([
        'This order can’t be sent again. Write a new lab request if Ada Patient still needs it.',
        expect.stringMatching(/^Do not use any result from Yaba Diagnostics on this order/),
        'This was reported 29 days after it came back. Anything you recorded from it (a note, a diagnosis, a prescription) still '
          + 'shows to Ada Patient and to the assistants until you amend it or mark it entered in error. Tell Ada Patient directly: '
          + 'Health ID tells them only in the app.'])
      fireEvent.click(screen.getByRole('button', { name: 'Show details and results' }))
      await waitFor(() => expect(lines()).toHaveLength(1))
      expect(lines()).toEqual(['Haemoglobin (do not use): another person’s result, withdrawn by Yaba Diagnostics on 21 Nov 2026. '
        + 'Show the withdrawn value'])
      expect(panel.textContent).not.toMatch(/9\.8|g\/dL/)
    })

  it('says whom to phone with the reference and until when, once served, for an order something came back on (D17-5)', async () => {
    serve(summary({ wrongPatient: null, correctableUntil: '2027-04-19T10:00:00.000Z' }))
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    expect(await screen.findByText('If Ada Patient says they did not give a sample at Yaba Diagnostics, or you have evidence the '
      + 'sample was someone else’s, phone Yaba Diagnostics and give it the reference 9C1B2D3E: it can withdraw the result until 19 '
      + 'Apr 2027. A result that is only unexpected is not a reason: repeat the test.')).toBeTruthy()
    expect(document.querySelector('.staff-order-route .staff-danger')).toBeNull()
  })

  it('says, past its date, to record it in the notes without the value (D17-3)', async () => {
    serve(summary({ wrongPatient: null, correctableUntil: null }))
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    expect(await screen.findByText('If a result from Yaba Diagnostics on this order is not Ada Patient’s, record that in Ada '
      + 'Patient’s notes without repeating its value, and tell Health ID support.')).toBeTruthy()
  })

  it('says none of it against today’s answers: item 3’s and item 4’s signals, no lateCorrection, no deadline', async () => {
    serve(summary({ endedKind: 'support', endedAt: '2026-11-01T09:00:00.000Z' }), {})
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    expect(await screen.findByText(/^Results released by Yaba Diagnostics on /)).toBeTruthy()
    const panel = document.querySelector('.staff-order-route') as HTMLElement
    expect(panel.textContent).not.toMatch(/phone Yaba Diagnostics|record that in|reported .* after it came back|withdrawn them/)
    expect(panel.querySelector('.staff-danger')).toBeNull()
  })
})
