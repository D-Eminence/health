import { act, fireEvent, screen, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, patientBanner, renderPage } from './harness'

/**
 * Today's chart sections on the Consultation encounter page: staff imported history, the patient assistant,
 * "Reported by the patient" and the imported medical history, each today's own component under today's permission
 * checks and build switches. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(),
  documents: vi.fn(), reportedHealthProfile: vi.fn(), importedHistory: vi.fn(), importedRecords: vi.fn(), recordChatAvailability: vi.fn(),
  labImports: vi.fn(), pharmacyImports: vi.fn(),
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
  api.labImports.mockResolvedValue({ items: [], nextCursor: null })
  api.pharmacyImports.mockResolvedValue({ items: [], nextCursor: null })
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
    // The read-only grant is said once, under the patient banner, whose access says "Read only".
    expect(await screen.findByText('You can view this record but not change it.')).toBeTruthy()
    expect(within(patientBanner()).getByText('Read only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New consultation' })).toBeNull()
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

  it('loads: reads them once while moving from the list to a visit and back, as today’s page keeps them mounted', async () => {
    staff.permissions = [...BASE, 'ehr.record-chat.use']
    builds.chat = true
    builds.importedRecords = true
    renderPage(<ConsultWorkspace />, 'consult')
    expect(await screen.findByRole('heading', { level: 2, name: 'Reported by the patient' })).toBeTruthy()
    const card = screen.getByRole('heading', { level: 2, name: 'Reported by the patient' }).closest('section')!
    fireEvent.click((await screen.findAllByRole('link', { name: /^Open / }))[0]!)
    await screen.findByRole('heading', { level: 2, name: 'Note' })
    await act(async () => {})
    // The same card, never read again, below the visit.
    expect(screen.getByRole('heading', { level: 2, name: 'Reported by the patient' }).closest('section')).toBe(card)
    expect(screen.getByRole('heading', { level: 2, name: 'History' }).compareDocumentPosition(sections()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('table')).toBeTruthy()
    for (const read of [api.reportedHealthProfile, api.importedRecords]) expect(read).toHaveBeenCalledTimes(1)
  })

  it('shows none of them for an emergency patient', async () => {
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    expect(api.importedHistory).not.toHaveBeenCalled()
  })
})

/** The Lab results and medicines read from the patient's paper records, beside the imported medical history. */
describe('Consultation record: imported from paper', () => {
  const CONSENT = 'The patient has not given consent for this facility to read their record.'
  const LAB_IMPORT = { id: 'lab-import-1', patientId: PATIENT_ID, status: 'accepted', externalLabName: 'Demo Diagnostics',
    reportedAt: '2024-02-14', observations: [{ id: 'obs-1', ordinal: 1, testName: 'Haemoglobin', value: '11.2', unit: 'g/dL' }] }
  const MEDICINE = { id: 'medicine-1', patientId: PATIENT_ID, medicationText: 'Metformin', strengthText: '500 mg' }
  const part = (kind: 'Lab results' | 'Medicines') => screen.getByRole('region', { name: `Imported from paper (unverified) ${kind}` })

  it('lists both, each in the chart’s sections, with lab.import.read and pharmacy.import.read', async () => {
    staff.permissions = [...BASE, 'lab.import.read', 'pharmacy.import.read']
    api.labImports.mockResolvedValue({ items: [LAB_IMPORT], nextCursor: null })
    api.pharmacyImports.mockResolvedValue({ items: [MEDICINE], nextCursor: null })
    await openEncounter()
    expect(await within(part('Lab results')).findByText('Report date: 14 Feb 2024')).toBeTruthy()
    expect(await within(part('Medicines')).findByText('Metformin')).toBeTruthy()
    expect(sections()?.contains(part('Lab results'))).toBe(true)
    expect(sections()?.contains(part('Medicines'))).toBe(true)
    expect(api.labImports).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, undefined, expect.any(AbortSignal))
    expect(api.pharmacyImports).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, undefined, expect.any(AbortSignal))
  })

  it('shows each only with its own permission', async () => {
    staff.permissions = [...BASE, 'pharmacy.import.read']
    await openEncounter()
    expect(await within(part('Medicines')).findByText('None imported from paper.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Imported from paper (unverified) Lab results' })).toBeNull()
    expect(api.labImports).not.toHaveBeenCalled()
  })

  it('reads neither without their permissions', async () => {
    await openEncounter()
    expect(screen.queryByRole('heading', { name: 'Imported from paper (unverified)' })).toBeNull()
    expect(api.labImports).not.toHaveBeenCalled()
    expect(api.pharmacyImports).not.toHaveBeenCalled()
  })

  it('says the patient has not given consent on 403 CONSENT_REQUIRED', async () => {
    staff.permissions = [...BASE, 'lab.import.read']
    api.labImports.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    await openEncounter()
    expect(await within(part('Lab results')).findByText(CONSENT)).toBeTruthy()
  })

  it('reads the next page with the cursor on Show more', async () => {
    staff.permissions = [...BASE, 'lab.import.read']
    api.labImports.mockResolvedValueOnce({ items: [LAB_IMPORT], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [{ ...LAB_IMPORT, id: 'lab-import-2', reportedAt: '2023-05-01' }], nextCursor: null })
    await openEncounter()
    await act(async () => { fireEvent.click(await within(part('Lab results')).findByRole('button', { name: 'Show more' })) })
    expect(await within(part('Lab results')).findByText('Report date: 1 May 2023')).toBeTruthy()
    expect(api.labImports).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, 'cursor-1', expect.any(AbortSignal))
  })

  it('shows neither for an emergency patient', async () => {
    staff.permissions = [...BASE, 'lab.import.read', 'pharmacy.import.read']
    staff.activePatient = activePatient('emergency')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(api.labImports).not.toHaveBeenCalled()
    expect(api.pharmacyImports).not.toHaveBeenCalled()
  })
})
