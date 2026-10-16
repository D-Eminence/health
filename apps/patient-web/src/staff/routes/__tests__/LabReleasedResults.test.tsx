import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

/**
 * A clinician reads the released results of the Lab work item accepted from one
 * of their lab requests (hid-system #51, lab-executions.service.ts
 * listReleasedForEhrOrder; INTERFACE_CONTRACT.md, Lab "Released results"): with
 * lab.result.released.read, only when asked, since each read is audited. Every
 * result keeps only its released revisions under their stored version numbers,
 * so a gap is a revision never released; an order with nothing released answers
 * no results; 404 LAB_WORK_ITEM_NOT_FOUND is an order Lab holds no work item for
 * that the reader can see.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(),
}))
const staff = vi.hoisted(() => ({ activePatient: null as unknown, permissions: [] as string[] }))

vi.mock('../../api', () => ({
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
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const REQUEST = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const READ_WRITE = ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write']
const SENDER = [...READ_WRITE, 'lab.work-item.accept']
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z' }
const labRequest = (status: string, rowVersion = '1') => ({ ...base, id: REQUEST, testCodeSystem: 'LOINC', testCode: '718-7',
  testDisplay: 'Haemoglobin', priority: 'routine', status, clinicalInformation: null, rowVersion })

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  staff.permissions = SENDER
  records = { 'lab-requests': [] }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) =>
    ({ items: records[kind] ?? [], nextCursor: null }))
})

async function openLabRequests() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
}

describe('released Lab results of a lab request', () => {
  const revision = (version: number, overrides: Record<string, unknown> = {}) => ({ version, resultType: 'numeric', numericValue: 13.4,
    textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'normal', entrySource: 'manual', verificationStatus: 'verified',
    releaseStatus: 'released', enteredAt: '2026-10-10T09:00:00.000Z', releasedAt: '2026-10-10T10:00:00.000Z', correctionReason: null, ...overrides })
  const released = (results: unknown[]) => ({ workItemId: 'work-item-1', sourceEhrOrderId: REQUEST, sourceEhrOrderVersion: 1, patientId: PATIENT,
    acceptedAt: '2026-10-10T08:06:00.000Z', test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, results })

  async function openResults() {
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    fireEvent.click(await screen.findByRole('button', { name: 'View released results' }))
  }

  it('is offered only to a role that may read released results, and read only when asked for', async () => {
    staff.permissions = [...SENDER, 'lab.result.released.read']
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    expect(await screen.findByRole('button', { name: 'View released results' })).toBeTruthy()
    expect(api.labReleasedResultsForOrder).not.toHaveBeenCalled()
  })

  it('is not offered without lab.result.released.read, or for a draft that never reached Lab', async () => {
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    await screen.findByText('Haemoglobin')
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
  })

  it('is not offered for a draft', async () => {
    staff.permissions = [...SENDER, 'lab.result.released.read']
    records['lab-requests'] = [labRequest('draft')]
    await openLabRequests()
    await screen.findByText('Haemoglobin')
    expect(screen.queryByRole('button', { name: 'View released results' })).toBeNull()
  })

  describe('read', () => {
    beforeEach(() => { staff.permissions = [...SENDER, 'lab.result.released.read'] })

    it('shows each released revision: value, unit, flag, range and when it was released', async () => {
      api.labReleasedResultsForOrder.mockResolvedValue(released([{ id: 'result-1', executionId: 'execution-1', status: 'released',
        verificationStatus: 'verified', currentVersion: 1, currentReleasedVersion: 1, revisions: [revision(1, { abnormalFlag: 'high', numericValue: 17.2 })] }]))
      await openResults()
      expect(api.labReleasedResultsForOrder).toHaveBeenCalledWith('facility-1', REQUEST, 'direct-care')
      const shown = await screen.findByText(/17\.2 g\/dL/)
      const item = shown.closest<HTMLElement>('.staff-list-item')!
      expect(item.textContent).toMatch(/high/)
      expect(item.textContent).toMatch(/Reference range: 12\.0-15\.5/)
      expect(item.textContent).toMatch(new RegExp(`Released ${new Date('2026-10-10T10:00:00.000Z').toLocaleString().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    })

    it('marks a revision entered in error, and says when versions were never released', async () => {
      api.labReleasedResultsForOrder.mockResolvedValue(released([{ id: 'result-1', executionId: 'execution-1', status: 'entered_in_error',
        verificationStatus: 'entered_in_error', currentVersion: 3, currentReleasedVersion: 3,
        revisions: [revision(1), revision(3, { numericValue: 14.1, verificationStatus: 'entered_in_error' })] }]))
      await openResults()
      const wrong = (await screen.findByText(/14\.1 g\/dL/)).closest<HTMLElement>('.staff-list-item')!
      expect(within(wrong).getByText('Entered in error')).toBeTruthy()
      expect(screen.getByText(/never released/)).toBeTruthy()
    })

    it('says when nothing has been released yet', async () => {
      api.labReleasedResultsForOrder.mockResolvedValue(released([]))
      await openResults()
      expect(await screen.findByText('No result released yet.')).toBeTruthy()
    })

    it.each([
      ['404 LAB_WORK_ITEM_NOT_FOUND', new HidApiError(404, 'Lab work item was not found', { code: 'LAB_WORK_ITEM_NOT_FOUND' }), /Lab has no work item for this request that you can see/],
      ['404 from a Lab without the route', new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' }), /not available from this Lab service/],
      ['403 LAB_EXECUTION_ACCESS_DENIED', new HidApiError(403, 'Lab execution/result access is not authorized', { code: 'LAB_EXECUTION_ACCESS_DENIED' }), /Access denied/],
      ['403 PERMISSION_DENIED', new HidApiError(403, 'Permission denied', { code: 'PERMISSION_DENIED' }), /Access denied/],
    ])('says what a refusal means (%s)', async (_case, refusal, says) => {
      api.labReleasedResultsForOrder.mockRejectedValue(refusal)
      await openResults()
      expect((await screen.findByRole('alert')).textContent).toMatch(says)
    })
  })
})
