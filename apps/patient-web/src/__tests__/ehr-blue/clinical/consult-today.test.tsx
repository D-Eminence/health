import { act, fireEvent, screen, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, renderPage } from './harness'

/**
 * Today's chart sections on the Consultation encounter page: staff imported history, the patient assistant,
 * "Reported by the patient" and the imported medical history, each today's own component under today's permission
 * checks and build switches. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(),
  documents: vi.fn(), reportedHealthProfile: vi.fn(), importedHistory: vi.fn(), importedRecords: vi.fn(), recordChatAvailability: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))
const builds = vi.hoisted(() => ({ chat: false, importedRecords: false }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../staff/stagingOnlyFeatures', () => ({
  staffPatientChatEnabled: () => builds.chat,
  importedRecordsEnabled: () => builds.importedRecords,
}))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => null,
  EncounterOrderPages: () => null,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const PROFILE = {
  bloodGroup: 'O+', genotype: 'AA', allergies: 'Penicillin (fictional)', currentMedications: null, chronicConditions: null,
  medicalNotes: null, updatedAt: '2026-10-29T10:00:00.000Z',
}
const BASE = ['ehr.encounter.read', 'ehr.note.read', 'ehr.diagnosis.read', 'ehr.document.read']

beforeEach(() => {
  vi.clearAllMocks()
  builds.chat = false
  builds.importedRecords = false
  staff.permissions = [...BASE]
  staff.activePatient = activePatient()
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.reportedHealthProfile.mockResolvedValue(PROFILE)
  api.importedHistory.mockReturnValue(new Promise(() => {}))
  api.importedRecords.mockReturnValue(new Promise(() => {}))
  api.recordChatAvailability.mockReturnValue(new Promise(() => {}))
})

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  await screen.findByRole('heading', { level: 2, name: 'Note' })
  await act(async () => {})
}

const sections = () => document.querySelector('.hid-ehr-clinical-today')

describe('Consultation record: today’s chart sections', () => {
  it('shows "Reported by the patient" as today does, labelled as not clinically verified, in the design’s card', async () => {
    await openEncounter()
    const card = (await screen.findByRole('heading', { level: 2, name: 'Reported by the patient' })).closest('section')!
    expect(sections()?.contains(card)).toBe(true)
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(within(card).getByText('Patient-reported')).toBeTruthy()
    expect(within(card).getByText(/not clinically verified/)).toBeTruthy()
    expect(within(card).getByText('Penicillin (fictional)')).toBeTruthy()
    expect(within(card).getAllByText('Not stated').length).toBeGreaterThan(0)
  })

  it('shows nothing when the read is refused (403) or not served (404), as today', async () => {
    for (const status of [403, 404]) {
      api.reportedHealthProfile.mockRejectedValueOnce(new HidApiError(status, 'No', { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' }))
      const view = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
      await screen.findByRole('heading', { level: 2, name: 'Note' })
      await act(async () => {})
      expect(screen.queryByRole('heading', { name: 'Reported by the patient' })).toBeNull()
      view.unmount()
    }
  })

  it('says when the service fails to answer, with today’s retry', async () => {
    api.reportedHealthProfile.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    await openEncounter()
    expect(await screen.findByText('What the patient entered about their health could not be loaded.')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry patient-reported health information' })) })
    expect(await screen.findByRole('heading', { level: 2, name: 'Reported by the patient' })).toBeTruthy()
  })

  it('reads nothing of them without ehr.note.read', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.diagnosis.read']
    await openEncounter()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(api.importedRecords).not.toHaveBeenCalled()
  })

  it('reads staff imported history only with ehr.imported-history.read, as today', async () => {
    await openEncounter()
    expect(api.importedHistory).not.toHaveBeenCalled()
  })

  it('reads staff imported history for the open patient with ehr.imported-history.read', async () => {
    staff.permissions = [...BASE, 'ehr.imported-history.read']
    await openEncounter()
    expect(api.importedHistory).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, null, expect.any(AbortSignal))
  })

  it('offers the patient assistant only where the build turns it on and the role may use it', async () => {
    staff.permissions = [...BASE, 'ehr.record-chat.use']
    const off = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    await screen.findByRole('heading', { level: 2, name: 'Note' })
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
    off.unmount()

    builds.chat = true
    await openEncounter()
    expect(screen.getByRole('button', { name: 'Ask about this patient' })).toBeTruthy()
  })

  it('shows the imported medical history only where the build turns it on', async () => {
    builds.importedRecords = true
    await openEncounter()
    expect(api.importedRecords).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'direct-care', expect.any(AbortSignal))
    expect(screen.getByText('Loading imported medical history…')).toBeTruthy()
  })

  it('item 2: shows them on the Consultation list too, for a patient with no encounter here and a read-only grant ("Reported by the patient")', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    staff.permissions = [...BASE, 'ehr.record-chat.use']
    builds.chat = true
    builds.importedRecords = true
    renderPage(<ConsultWorkspace />, 'consult')
    expect(await screen.findByText('No consultations for this patient here yet.')).toBeTruthy()
    expect(await screen.findByText('Changes are unavailable')).toBeTruthy()
    const card = (await screen.findByRole('heading', { level: 2, name: 'Reported by the patient' })).closest('section')!
    expect(sections()?.contains(card)).toBe(true)
    expect(within(card).getByText('Penicillin (fictional)')).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(screen.getByRole('button', { name: 'Ask about this patient' })).toBeTruthy()
    expect(api.importedRecords).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'direct-care', expect.any(AbortSignal))
    expect(screen.getByText('Loading imported medical history…')).toBeTruthy()
    // Under the encounter table (here its empty state).
    const empty = screen.getByText('No consultations for this patient here yet.')
    expect(empty.compareDocumentPosition(sections()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('item 2: shows none of them on the Consultation list for an emergency patient', async () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult')
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    await act(async () => {})
    expect(sections()).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('shows none of them for an emergency patient', async () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(api.importedHistory).not.toHaveBeenCalled()
  })
})
