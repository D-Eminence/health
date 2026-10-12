import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { AccessRequests } from '../AccessRequests'
import { Clinical } from '../Clinical'
import { Laboratory, Outreach, Pharmacy } from '../Operations'
import { Registration } from '../Registration'

/**
 * NEW-PEHR-ACTION-FOCUS for the provider pages' refresh buttons. Each was
 * disabled while its own read ran, so pressing it from the keyboard took focus
 * from it (Chromium moves focus to the body) and a keyboard or screen reader
 * user started again from the top of the page. Each now stays focusable, marked
 * unavailable (aria-disabled) while the read runs, and ignores a second press.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(), emergencyRecords: vi.fn(),
  labWorkItems: vi.fn(), labAccession: vi.fn(), labExecutions: vi.fn(), labResultHistory: vi.fn(), pharmacyWorkItems: vi.fn(),
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), listAccessRequests: vi.fn(),
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown }))

vi.mock('../../api', () => ({
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(() => true),
    lock: null,
  }),
}))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const CASE = 'c0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
const encounter = { id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }
const note = { id: 'note-1', patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', noteType: 'Consultation',
  title: 'Admission note', status: 'signed', rowVersion: '2', createdAt: '2026-10-10T08:05:00.000Z' }
const revisions = [{ id: 'revision-1', revisionNo: 1, content: 'Fever.', changeReason: 'Initial', createdAt: '2026-10-10T08:05:00.000Z' }]
const workItem = { id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: 'accession-1',
  accessionNumber: 'ACC-1', specimenStatuses: ['received'], acceptedAt: '2026-10-09T08:00:00.000Z' }
const accession = { id: 'accession-1', accessionNumber: 'ACC-1', workItemId: 'work-item-1', status: 'open',
  specimens: [{ id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-1', specimenType: 'Venous blood', status: 'received', version: 3 }] }
const result = { id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: 1,
  currentReleasedVersion: 1, revisions: [{ version: 1, resultType: 'numeric', numericValue: 13.2, textValue: null, unit: 'g/dL',
    referenceRange: null, abnormalFlag: 'normal', entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released',
    enteredAt: '2026-10-09T09:40:00.000Z', correctionReason: null }] }
const execution = { id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: 'facility-1', status: 'completed',
  method: null, startedAt: '2026-10-09T09:00:00.000Z', completedAt: '2026-10-09T09:30:00.000Z', version: 2, result }
const prescription = { id: 'work-item-9', patientId: PATIENT, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
  medication: { display: 'Amoxicillin 500 mg capsule' }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily', dispensing: null }
const registrationCase = { caseId: CASE, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 }

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/**
 * Presses `button` from the keyboard while `read` answers later: it keeps focus,
 * marked unavailable rather than disabled, a second press reads nothing more, and
 * once `read` has answered with `answer` it is available again, still focused.
 */
async function expectRefreshKeepsFocus(button: HTMLElement, read: Mock, answer: unknown) {
  const reading = deferred<unknown>()
  read.mockReturnValueOnce(reading.promise)
  const before = read.mock.calls.length
  button.focus()
  await act(async () => { fireEvent.click(button) })
  await waitFor(() => expect(read.mock.calls.length).toBe(before + 1))
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect((button as HTMLButtonElement).disabled).toBe(false)
  expect(document.activeElement).toBe(button)
  await act(async () => { fireEvent.click(button) })
  expect(read.mock.calls.length).toBe(before + 1)
  await act(async () => { reading.resolve(answer) })
  await waitFor(() => expect(button.getAttribute('aria-disabled')).toBeNull())
  expect(document.activeElement).toBe(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = null
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
  api.encounters.mockResolvedValue({ items: [encounter], nextCursor: null })
  api.records.mockResolvedValue({ items: [note], nextCursor: null })
  api.noteRevisions.mockResolvedValue(revisions)
})

describe('the clinical record', () => {
  beforeEach(() => {
    staff.permissions = ['ehr.encounter.read', 'ehr.note.read']
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  })

  it('Refresh encounters', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('Admission note')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh encounters' }), api.encounters, { items: [encounter], nextCursor: null })
  })

  it('Refresh revisions', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Review note content' }))
    await screen.findByText('Fever.')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh revisions' }), api.noteRevisions, revisions)
  })

  it('Refresh summary, on the emergency summary', async () => {
    staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'emergency', lookup }
    const summary = { encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], limit: 100 }
    api.emergencyRecords.mockResolvedValue(summary)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Completed encounters' })
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh summary' }), api.emergencyRecords, summary)
  })
})

describe('Laboratory', () => {
  beforeEach(() => {
    staff.permissions = ['lab.work-item.read', 'lab.accession.read', 'lab.execution.read', 'lab.result.released.read']
    api.labWorkItems.mockResolvedValue({ items: [workItem] })
    api.labAccession.mockResolvedValue(accession)
    api.labExecutions.mockResolvedValue({ items: [execution] })
    api.labResultHistory.mockResolvedValue(result)
  })

  async function openAccession() {
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
    await screen.findByText(/Hemoglobin · LOINC/)
  }

  it('Refresh work', async () => {
    render(<Laboratory />)
    await screen.findByText('Haemoglobin')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh work' }), api.labWorkItems, { items: [workItem] })
  })

  it('Refresh accession', async () => {
    await openAccession()
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh accession' }), api.labAccession, accession)
  })

  it('Refresh executions', async () => {
    await openAccession()
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh executions' }), api.labExecutions, { items: [execution] })
  })

  it('Refresh history', async () => {
    await openAccession()
    fireEvent.click(screen.getByRole('button', { name: 'View result history' }))
    await screen.findByText('Version 1')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh history' }), api.labResultHistory, result)
  })
})

describe('Pharmacy', () => {
  it('Refresh work', async () => {
    staff.permissions = ['pharmacy.work-item.read']
    api.pharmacyWorkItems.mockResolvedValue({ items: [prescription] })
    render(<Pharmacy />)
    await screen.findByText('Amoxicillin 500 mg capsule')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh work' }), api.pharmacyWorkItems, { items: [prescription] })
  })
})

describe('Outreach', () => {
  beforeEach(() => {
    staff.permissions = ['outreach.campaign.read', 'outreach.registration.read']
    api.outreachCampaigns.mockResolvedValue([])
    api.outreachCases.mockResolvedValue([])
  })

  /** The Refresh button beside the heading `name` (an empty list offers one of its own too). */
  function refreshOf(name: string) {
    return within(screen.getByRole('heading', { level: 2, name }).closest<HTMLElement>('.staff-row')!).getByRole('button', { name: 'Refresh' })
  }

  it('Refresh campaigns', async () => {
    render(<Outreach />)
    await screen.findByText('No campaigns')
    await expectRefreshKeepsFocus(refreshOf('Campaigns'), api.outreachCampaigns, [])
  })

  it('Refresh registration cases', async () => {
    render(<Outreach />)
    await screen.findByText('No registration cases')
    await expectRefreshKeepsFocus(refreshOf('Registration cases'), api.outreachCases, [])
  })
})

describe('access requests', () => {
  it('Refresh', async () => {
    staff.permissions = ['identity.consent.write']
    api.listAccessRequests.mockResolvedValue([])
    render(<AccessRequests />)
    await screen.findByText('No access requests')
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh' }), api.listAccessRequests, [])
  })
})

describe('registration', () => {
  beforeEach(() => {
    staff.permissions = ['identity.registration.write']
    api.registrationCapabilities.mockResolvedValue({ nin: { enabled: false, state: 'disabled' }, newPatientRegistrationRequiresNin: true })
    api.registrationCase.mockResolvedValue(registrationCase)
  })

  it('Check again', async () => {
    render(<Registration />)
    await screen.findByText(/NIN verification is disabled/)
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Check again' }), api.registrationCapabilities,
      { nin: { enabled: false, state: 'disabled' }, newPatientRegistrationRequiresNin: true })
  })

  it('Refresh current case', async () => {
    render(<Registration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: CASE } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    await screen.findByRole('heading', { name: `Case ${CASE}` })
    await expectRefreshKeepsFocus(screen.getByRole('button', { name: 'Refresh current case' }), api.registrationCase, registrationCase)
  })
})
