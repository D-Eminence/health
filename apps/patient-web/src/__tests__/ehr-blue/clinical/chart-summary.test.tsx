import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientsWorkspace } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import {
  LAB_PROGRESS_UNAVAILABLE, LEFT_OUT_PERMISSION, LEFT_OUT_UNAVAILABLE, PHARMACY_PROGRESS_UNAVAILABLE, PROGRESS_UNKNOWN, parseChartSummary,
} from '../../../ehr-blue/clinical/patients/chartSummary'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, renderPage } from './harness'

/**
 * The patient page's chart summary (EHR-C4, GET chart-summary as hid-system 4c843270 serves it): one call for the
 * chart, each section the answer gives shown with its link, each section left out said in the contract's words where
 * it would be, and today's separate visits list read instead when the call fails as a whole. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), closeGrant: vi.fn(), encounters: vi.fn(), chartSummary: vi.fn(),
  reportedHealthProfile: vi.fn(), allergies: vi.fn(), sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, roles: undefined as string[] | undefined }))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 5), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
  staffSessionSignal: vi.fn(() => new AbortController().signal),
}))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => session)

const READS = ['ehr.encounter.read', 'ehr.diagnosis.read', 'ehr.prescription.read', 'ehr.lab-request.read', 'ehr.vital.read', 'ehr.note.read']
const ALL = ['identity.patient.read', ...READS, 'lab.result.released.read']
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const CONSENT = { patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true }
const ENCOUNTER = { id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-11-18T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 1 }

const PROBLEM_ID = 'd0000000-0000-4000-8000-000000000001'
const MEDICINE_ID = 'f0000000-0000-4000-8000-000000000001'
const LAB_ID = 'b0000000-0000-4000-8000-000000000001'
const VITAL_ID = 'c0000000-0000-4000-8000-000000000001'
const RESULT_ID = 'a1000000-0000-4000-8000-000000000001'
const ALLERGY_ID = 'a2000000-0000-4000-8000-000000000001'

/** An item's ORD-3 progress: a status and its times, each an ISO time or null. */
type Progress = { status: string } & Record<string, string | null>

/** A full answer, shaped as the contract's example (EHR-C4), with fictional values. */
function fullAnswer() {
  return {
    patientId: PATIENT_ID,
    facilityId: FACILITY_ID,
    purposeOfUse: 'direct-care',
    limits: { recentVisits: 10, problems: 50, medications: 50, openLabRequests: 50, allergies: 200, recentResults: 10 },
    sections: {
      demographics: { patientId: PATIENT_ID, fullName: 'Patient One', firstName: 'Patient', lastName: 'One', dateOfBirth: '1990-04-12', gender: 'female' },
      problems: { items: [{ id: PROBLEM_ID, encounterId: ENCOUNTER_ID, codeSystem: 'ICD-10', code: 'B50.9', display: 'Malaria', clinicalStatus: 'active', verificationStatus: 'confirmed', onsetAt: null, notes: null, createdAt: '2026-11-18T08:10:00.000Z' }], more: false },
      medications: { items: [{ id: MEDICINE_ID, encounterId: ENCOUNTER_ID, medicationDisplay: 'Artemether and lumefantrine', medicationCodeSystem: null, medicationCode: null, doseQuantity: '4.0000', doseUnit: 'tablet', routeCode: 'oral', frequency: 'Twice a day', instructions: 'After food', startsOn: '2026-11-18', endsOn: null, status: 'active', createdAt: '2026-11-18T08:20:00.000Z', ownProgress: { status: 'dispensed', receivedAt: '2026-11-18T09:00:00.000Z', dispensedAt: '2026-11-18T10:05:00.000Z', reversedAt: null } as Progress | undefined }], more: false },
      allergies: { recorded: [{ source: 'recorded', id: ALLERGY_ID, substance: 'Penicillin', reaction: 'Rash', severity: 'severe', recordedHere: true, recordedOn: '2026-11-01T08:00:00.000Z' }], patientReported: { source: 'patient_reported', allergies: null, updatedAt: null } },
      latestVitals: { facilityId: FACILITY_ID, measures: {
        bloodPressure: { value: { systolicMmhg: 128, diastolicMmhg: 84 }, recordedAt: '2026-11-18T08:05:00.000Z', vitalId: VITAL_ID, encounterId: ENCOUNTER_ID, corrected: false },
        pulseBpm: { value: 76, recordedAt: '2026-11-18T08:05:00.000Z', vitalId: VITAL_ID, encounterId: ENCOUNTER_ID, corrected: true },
      } },
      recentVisits: { items: [{ id: ENCOUNTER_ID, encounterNumber: 'ENC-0001', encounterType: 'ambulatory', status: 'in_progress', startedAt: ENCOUNTER.startedAt, endedAt: null, chiefComplaint: 'Fever for two days', importedPaperRecords: false }], more: false },
      openLabRequests: { items: [{ id: LAB_ID, encounterId: ENCOUNTER_ID, testCodeSystem: 'HID-LAB', testCode: 'MP-SMEAR', testDisplay: 'Malaria parasite smear', priority: 'urgent', status: 'active', specimenTypeCode: null, clinicalInformation: null, createdAt: '2026-11-18T08:15:00.000Z', ownProgress: { status: 'sample_collected', receivedAt: '2026-11-18T08:30:00.000Z', collectedAt: '2026-11-18T09:30:00.000Z', lastResultAt: null } as Progress }], more: false },
      recentResults: { items: [{ id: RESULT_ID, version: '1', title: 'Full blood count', recordedAt: '2026-11-17T11:05:00.000Z', effectiveAt: null, fields: { haemoglobin: 12.1 } }], more: false, complete: true },
    },
    leftOut: [] as { section: string; reason: string; message: string }[],
  }
}

type Full = ReturnType<typeof fullAnswer>
/** An answer some of whose sections may be left out. */
type Answer = Omit<Full, 'sections'> & { sections: Partial<Full['sections']> }

/** The EHR's own `permission` sentence (chart-summary.service.ts LEFT_OUT_MESSAGES), never shown on a staff screen. */
const EHR_PERMISSION_SENTENCE = 'You do not have permission to see this part of the chart.'

/** The answer with `section` left out as the EHR lists it. */
function without(answer: Answer, section: keyof Full['sections'], reason: 'permission' | 'unavailable'): Answer {
  const { [section]: _dropped, ...sections } = answer.sections
  return { ...answer, sections, leftOut: [...answer.leftOut, { section, reason, message: reason === 'permission' ? EHR_PERMISSION_SENTENCE : LEFT_OUT_UNAVAILABLE }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.facilityId = undefined
  staff.roles = undefined
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue(CONSENT)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.chartSummary.mockResolvedValue(fullAnswer())
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockResolvedValue({ recorded: [], patientReported: { allergies: null, updatedAt: null } })
  api.sharedWithMe.mockRejectedValue(NOT_FOUND)
  api.staffShareInvitations.mockRejectedValue(NOT_FOUND)
})

function openPatient() {
  return renderPage(<PatientsWorkspace />, 'patients', '/open')
}

/** The chart summary's card. */
function summaryCard(): HTMLElement {
  return screen.getByRole('heading', { level: 2, name: 'Chart summary' }).closest('section') as HTMLElement
}

/** The summary's section named `title` (each is a labelled region in the summary's card). */
function section(title: string): HTMLElement {
  return within(summaryCard()).getByRole('region', { name: title })
}

async function summaryShown() {
  await screen.findByRole('heading', { level: 2, name: 'Chart summary' })
  await within(summaryCard()).findByRole('region', { name: 'Visits here' })
}

describe('The chart summary on the patient page', () => {
  it('opens the chart with one call and shows every section the answer gives, each with its link', async () => {
    openPatient()
    await summaryShown()
    expect(api.chartSummary).toHaveBeenCalledTimes(1)
    expect(api.chartSummary).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    // Today's separate visits read is not made: the summary carries the visits.
    expect(api.encounters).not.toHaveBeenCalled()

    const problems = section('Active problems')
    expect(within(problems).getByRole('link', { name: /^Malaria/ }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(problems.textContent).toContain('Active · Recorded 18 Nov 2026')

    const medicines = section('Current medicines')
    const medicine = within(medicines).getByRole('link', { name: /^Artemether and lumefantrine/ })
    expect(medicine.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${MEDICINE_ID}`)
    expect(medicine.textContent).toContain('4 tablet · by mouth · Twice a day')
    expect(medicine.textContent).toMatch(/Dispensed 18 Nov 2026, \d\d:05/)

    const vitals = section('Latest vitals')
    expect(vitals.textContent).toContain('Blood pressure: 128/84 mmHg')
    expect(vitals.textContent).toContain('Pulse: 76 bpm')
    expect(vitals.textContent).toContain('Corrected')
    expect(within(vitals).getAllByRole('link')[0]!.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~${VITAL_ID}`)

    const labs = section('Open lab requests')
    const lab = within(labs).getByRole('link', { name: /^Malaria parasite smear/ })
    expect(lab.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB_ID}`)
    expect(lab.textContent).toContain('Urgent')
    expect(lab.textContent).toMatch(/Sample taken 18 Nov 2026, \d\d:30/)

    const results = section('Recent lab results')
    expect(results.textContent).toMatch(/Full blood count.*Released 17 Nov 2026/)

    const visits = section('Visits here')
    const visit = within(visits).getByRole('link', { name: new RegExp(`^${consultationLabel(ENCOUNTER)}`) })
    expect(visit.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(visit.textContent).toContain('Outpatient visit · Fever for two days')
    // The full list stays one link away: Consultation lists every visit.
    expect(within(visits).getByRole('link', { name: 'See all visits' }).getAttribute('href')).toBe('/provider/clinical')

    // Allergies are the Allergies card's (its own read, which its changes need): not said twice in the summary.
    expect(within(summaryCard()).queryByRole('region', { name: 'Allergies' })).toBeNull()
  })

  it('shows no ID, code or permission word anywhere on the page', async () => {
    openPatient()
    await summaryShown()
    const text = document.body.textContent ?? ''
    for (const hidden of [PATIENT_ID, ENCOUNTER_ID, PROBLEM_ID, MEDICINE_ID, LAB_ID, VITAL_ID, RESULT_ID, ALLERGY_ID, FACILITY_ID,
      'B50.9', 'ICD', 'HID-LAB', 'MP-SMEAR', 'ENC-0001', 'ehr.', 'lab.result', 'permission_', 'unavailable', 'leftOut', 'sample_collected']) {
      expect(text).not.toContain(hidden)
    }
    // No en or em dash: each is named by its code point, so none is written here either.
    for (const dash of [0x2013, 0x2014]) expect(text).not.toContain(String.fromCodePoint(dash))
  })

  it('says a refused section in the contract’s words where it would be', async () => {
    api.chartSummary.mockResolvedValue(without(without(fullAnswer(), 'problems', 'permission'), 'allergies', 'permission'))
    openPatient()
    await summaryShown()
    expect(section('Active problems').textContent).toBe(`Active problems${LEFT_OUT_PERMISSION}`)
    // Allergies left out: said in the summary, where the Allergies card's are not.
    expect(section('Allergies').textContent).toBe(`Allergies${LEFT_OUT_PERMISSION}`)
    // The other sections are still shown.
    expect(within(section('Current medicines')).getByRole('link', { name: /^Artemether/ })).toBeTruthy()
  })

  it('says a section that failed in the contract’s words, and progress that could not be read', async () => {
    const answer = without(fullAnswer(), 'recentResults', 'unavailable')
    answer.sections.medications!.items[0]!.ownProgress = { status: 'unknown', receivedAt: null, dispensedAt: null, reversedAt: null }
    answer.leftOut.push({ section: 'medications.ownProgress', reason: 'unavailable', message: PHARMACY_PROGRESS_UNAVAILABLE })
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    expect(section('Recent lab results').textContent).toBe(`Recent lab results${LEFT_OUT_UNAVAILABLE}`)
    const medicines = section('Current medicines')
    expect(medicines.textContent).toContain(PHARMACY_PROGRESS_UNAVAILABLE)
    expect(within(medicines).getByRole('link', { name: /^Artemether/ }).textContent).toContain(PROGRESS_UNKNOWN)
    expect(section('Open lab requests').textContent).not.toContain(LAB_PROGRESS_UNAVAILABLE)
  })

  it('says a section it can’t read as could not be loaded, never in part', async () => {
    const answer = fullAnswer()
    ;(answer.sections.problems.items as unknown[]).push({ id: 'p2' })
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    expect(section('Active problems').textContent).toBe(`Active problems${LEFT_OUT_UNAVAILABLE}`)
  })

  it('says when a list holds only the newest, and where the rest are', async () => {
    const answer = fullAnswer()
    answer.sections.recentVisits.more = true
    answer.sections.problems.more = true
    answer.sections.recentResults = { ...answer.sections.recentResults, more: true, complete: false }
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    expect(section('Visits here').textContent).toContain('Showing the newest 10.')
    expect(within(section('Visits here')).getByRole('link', { name: 'See all visits' }).getAttribute('href')).toBe('/provider/clinical')
    expect(section('Active problems').textContent).toContain('Showing the newest 50. Open a visit to see all its diagnoses.')
    expect(section('Recent lab results').textContent).toContain('Showing the newest 10. Each lab request lists its own results.')
    expect(section('Recent lab results').textContent).toContain('newer results may not be shown here')
    expect(section('Current medicines').textContent).not.toContain('Showing the newest')
  })

  it.each([
    ['404 from an EHR before the chart summary', NOT_FOUND],
    ['a 503', new HidApiError(503, 'Service Unavailable', { code: 'SERVICE_UNAVAILABLE' })],
    ['an answer for another patient', null],
  ])('falls back to today’s separate visits list on %s', async (_case, failure) => {
    if (failure) api.chartSummary.mockRejectedValue(failure)
    else api.chartSummary.mockResolvedValue({ ...fullAnswer(), patientId: 'another-patient' })
    openPatient()
    // Today's card: its rows are buttons, read after today's access re-check.
    const visit = await screen.findByRole('button', { name: new RegExp(`^${consultationLabel(ENCOUNTER)}`) })
    expect(visit).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Visits here' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 2, name: 'Chart summary' })).toBeNull()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
  })

  it('falls back when the client has no chart summary call at all', async () => {
    const { chartSummary } = api
    try {
      ;(api as { chartSummary?: unknown }).chartSummary = undefined
      openPatient()
      expect(await screen.findByRole('button', { name: new RegExp(`^${consultationLabel(ENCOUNTER)}`) })).toBeTruthy()
    } finally {
      api.chartSummary = chartSummary
    }
  })

  it('Refresh re-checks access, then reads the summary again', async () => {
    openPatient()
    await summaryShown()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    const answer = fullAnswer()
    answer.sections.problems.items[0]!.display = 'Typhoid fever'
    api.chartSummary.mockResolvedValue(answer)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await within(section('Active problems')).findByRole('link', { name: /^Typhoid fever/ })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.chartSummary.mock.invocationCallOrder[1]!)
  })

  it('keeps the summary shown when Refresh fails, and says so', async () => {
    openPatient()
    await summaryShown()
    api.chartSummary.mockRejectedValue(new HidApiError(503, 'Service Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Couldn’t refresh the chart summary')).toBeTruthy()
    expect(within(section('Active problems')).getByRole('link', { name: /^Malaria/ })).toBeTruthy()
  })

  it('asks nothing of a role the call is not open to, and keeps today’s page for it', async () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write']
    openPatient()
    await screen.findByText('You have access')
    await act(async () => {})
    expect(api.chartSummary).not.toHaveBeenCalled()
    expect(api.encounters).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Chart summary' })).toBeNull()
  })

  it('asks nothing under emergency access', async () => {
    staff.activePatient = activePatient('emergency')
    openPatient()
    await screen.findByText('Emergency access')
    await act(async () => {})
    expect(api.chartSummary).not.toHaveBeenCalled()
  })

  it('says a visits section the role may not see, and reads no visits for it', async () => {
    staff.permissions = ['identity.patient.read', 'ehr.diagnosis.read']
    api.chartSummary.mockResolvedValue(without(fullAnswer(), 'recentVisits', 'permission'))
    openPatient()
    await summaryShown()
    expect(section('Visits here').textContent).toBe(`Visits here${LEFT_OUT_PERMISSION}`)
    await waitFor(() => expect(api.encounters).not.toHaveBeenCalled())
  })

  it.each([
    ['a diagnosis-only role', 'ehr.diagnosis.read'],
    ['a laboratory role', 'ehr.lab-request.read'],
  ])('shows %s its rows with no link into Consultation, which it cannot open', async (_role, permission) => {
    staff.permissions = ['identity.patient.read', permission]
    const answer = fullAnswer()
    answer.sections.problems.more = true
    answer.sections.openLabRequests.more = true
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    for (const [title, row] of [['Active problems', 'Malaria'], ['Current medicines', 'Artemether and lumefantrine'],
      ['Open lab requests', 'Malaria parasite smear'], ['Visits here', consultationLabel(ENCOUNTER)]] as const) {
      expect(section(title).textContent).toContain(row)
      expect(within(section(title)).queryAllByRole('link')).toEqual([])
    }
    // Where the rest are is not said as a visit to open: Consultation does not open for this role.
    expect(section('Active problems').textContent).toContain('Showing the newest 50.')
    expect(section('Active problems').textContent).not.toContain('Open a visit')
    expect(section('Open lab requests').textContent).not.toContain('Open a visit')
    expect(within(summaryCard()).queryByRole('link', { name: 'See all visits' })).toBeNull()
  })

  it.each([
    ['withdrawn', 'The pharmacy can no longer dispense this prescription'],
    ['sent_elsewhere', 'Sent to another pharmacy instead'],
    ['accepted', 'Received'],
  ])('says a medicine the pharmacy answered %s in plain words, not as progress not available', async (status, words) => {
    const answer = fullAnswer()
    answer.sections.medications.items[0]!.status = 'on_hold'
    answer.sections.medications.items[0]!.ownProgress = { status, receivedAt: '2026-11-18T09:00:00.000Z', acceptedAt: null, dispensedAt: null, reversedAt: null }
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    const medicine = within(section('Current medicines')).getByRole('link', { name: /^Artemether/ })
    expect(medicine.textContent).toContain(words)
    expect(medicine.textContent).not.toContain(PROGRESS_UNKNOWN)
    expect(section('Current medicines').textContent).not.toContain(status)
  })

  it('says a medicine a pharmacist accepted (ORD-4, Release B) as Accepted with its time', async () => {
    const answer = fullAnswer()
    answer.sections.medications.items[0]!.ownProgress = { status: 'accepted', receivedAt: '2026-11-18T09:00:00.000Z',
      acceptedAt: '2026-11-18T09:52:00.000Z', dispensedAt: null, reversedAt: null }
    api.chartSummary.mockResolvedValue(answer)
    openPatient()
    await summaryShown()
    const medicine = within(section('Current medicines')).getByRole('link', { name: /^Artemether/ })
    expect(medicine.textContent).toContain('Accepted')
    expect(medicine.textContent).not.toContain(PROGRESS_UNKNOWN)
  })

  it('never says "permission" for a section the role does not show', async () => {
    api.chartSummary.mockResolvedValue(without(without(fullAnswer(), 'problems', 'permission'), 'recentResults', 'permission'))
    openPatient()
    await summaryShown()
    expect(section('Active problems').textContent).toBe(`Active problems${LEFT_OUT_PERMISSION}`)
    expect(summaryCard().textContent?.toLowerCase()).not.toContain('permission')
  })
})

describe('Reading the chart summary', () => {
  it('reads a section neither answered nor listed as left out as could not be loaded', () => {
    const { recentResults: _dropped, ...sections } = fullAnswer().sections
    const summary = parseChartSummary({ ...fullAnswer(), sections }, PATIENT_ID)
    expect(summary.recentResults).toEqual({ shown: false, message: LEFT_OUT_UNAVAILABLE })
  })

  it('shows the contract’s sentence by reason when the answer’s own is not one of them', () => {
    const answer = { ...without(fullAnswer(), 'problems', 'permission') }
    answer.leftOut = [{ section: 'problems', reason: 'permission', message: 'PERMISSION_DENIED ehr.diagnosis.read' }]
    expect(parseChartSummary(answer, PATIENT_ID).problems).toEqual({ shown: false, message: LEFT_OUT_PERMISSION })
  })

  it('reads an item’s progress not known here as not available, and none before ORD-3 as nothing', () => {
    const answer = fullAnswer()
    answer.sections.openLabRequests.items[0]!.ownProgress = { status: 'teleported', receivedAt: null, collectedAt: null, lastResultAt: null }
    answer.sections.medications.items[0]!.ownProgress = undefined
    const summary = parseChartSummary(answer, PATIENT_ID)
    expect(summary.openLabRequests.shown && summary.openLabRequests.value.items[0]!.ownProgress?.status).toBe('unknown')
    expect(summary.medications.shown && summary.medications.value.items[0]!.ownProgress).toBeNull()
  })

  it.each(['withdrawn', 'sent_elsewhere', 'accepted'])('reads the live pharmacy answer %s as itself, not as unknown', status => {
    const answer = fullAnswer()
    answer.sections.medications.items[0]!.ownProgress = { status, receivedAt: '2026-11-18T09:00:00.000Z', dispensedAt: null, reversedAt: null }
    const summary = parseChartSummary(answer, PATIENT_ID)
    expect(summary.medications.shown && summary.medications.value.items[0]!.ownProgress).toEqual(
      { status, receivedAt: '2026-11-18T09:00:00.000Z', acceptedAt: null, dispensedAt: null, reversedAt: null })
  })

  it('throws on an answer that is not a chart summary for this patient', () => {
    expect(() => parseChartSummary(null, PATIENT_ID)).toThrow()
    expect(() => parseChartSummary({ patientId: PATIENT_ID }, PATIENT_ID)).toThrow()
    expect(() => parseChartSummary({ ...fullAnswer(), patientId: 'another-patient' }, PATIENT_ID)).toThrow()
  })
})
