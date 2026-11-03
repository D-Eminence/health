import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { CORRECTION_UNREAD, LOADING_CORRECTION, RETRACTED_TEXT } from '../../../ehr-blue/clinical/triage/vitals'
import { TONE_OUTLINE } from '../../../kasuwa/ui'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, renderPage } from './harness'

/**
 * Consultation, one encounter: the Vitals card, today's Vitals tab (staff/routes/Clinical.tsx:1849-1858) on the
 * encounter page: each vital's values with units, its status and time, its current correction, record pages past the
 * first 50, and the way to the vitals form. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), noteRevisions: vi.fn(),
  documents: vi.fn(), vitalCorrections: vi.fn(), reportedHealthProfile: vi.fn(), createRecord: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Connected orders</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const READS = ['ehr.encounter.read', 'ehr.vital.read']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const OTHER = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed', startedAt: '2026-10-20T08:00:00.000Z' }
const VITAL = {
  id: 'vital-1', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:05:00.000Z', status: 'final',
  systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 80, temperatureC: '36.60', oxygenSaturationPercent: '97.50', currentCorrectionNo: 0, rowVersion: '1',
}
const CORRECTED = { ...VITAL, currentCorrectionNo: 1, rowVersion: '2' }
const CORRECTION = {
  id: 'correction-1', vitalId: 'vital-1', correctionNo: 1, replacementValues: { systolicMmhg: 118, diastolicMmhg: 76, pulseBpm: 92 },
  reason: 'Repeat reading', createdAt: '2026-10-30T08:20:00.000Z',
}

let vitals: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  staff.facilityId = undefined
  staff.permissions = [...READS]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  vitals = [VITAL]
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER, OTHER], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'vitals' ? vitals : [], nextCursor: null }))
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.vitalCorrections.mockResolvedValue([CORRECTION])
  api.reportedHealthProfile.mockResolvedValue(null)
})

async function openEncounter() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  return within(await screen.findByRole('heading', { level: 2, name: 'Vitals' }).then(heading => heading.closest('section') as HTMLElement))
}

function vitalsReads() {
  return api.records.mock.calls.filter(call => call[3] === 'vitals')
}

describe('Consultation record: Vitals card', () => {
  it('shows each vital with its values and units, its status and when it was recorded, reading the vitals once', async () => {
    const card = await openEncounter()
    const link = await card.findByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })
    expect(link.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-1`)
    const row = link.closest('li') as HTMLElement
    expect(within(row).getByText('120/80')).toBeTruthy()
    expect(within(row).getByText('mmHg')).toBeTruthy()
    expect(within(row).getByText('bpm')).toBeTruthy()
    expect(within(row).getByText('36.6')).toBeTruthy()
    expect(within(row).getByText('97.5')).toBeTruthy()
    expect(within(row).getByText('Final')).toBeTruthy()
    expect(within(row).getByText(`Recorded: ${formatWhen(VITAL.createdAt)}`)).toBeTruthy()
    // The card shows the encounter page's own vitals list: no second read, and no correction read for an uncorrected vital.
    expect(vitalsReads()).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals']])
    expect(api.vitalCorrections).not.toHaveBeenCalled()
    for (const href of screen.getAllByRole('link').map(item => item.getAttribute('href') ?? '')) {
      expect(href).not.toContain(PATIENT_HID)
      expect(href).not.toContain(PATIENT_ID)
    }
  })

  it('says today’s sentence when the visit has no vitals', async () => {
    vitals = []
    const card = await openEncounter()
    expect(await card.findByText('No vitals for this consultation.')).toBeTruthy()
  })

  it('shows a corrected vital’s current correction, its reason and time, and what was first recorded', async () => {
    vitals = [CORRECTED]
    const card = await openEncounter()
    const corrected = await card.findByText(/^Corrected \(correction 1\):/)
    expect(within(corrected).getByText('118/76')).toBeTruthy()
    expect(within(corrected).getByText('92')).toBeTruthy()
    expect(card.getByText('Reason: Repeat reading')).toBeTruthy()
    expect(card.getByText(`Corrected at: ${formatWhen(CORRECTION.createdAt)}`)).toBeTruthy()
    const original = card.getByText(/^Originally recorded:/)
    expect(within(original).getByText('120/80')).toBeTruthy()
    expect(card.getAllByText('120/80')).toHaveLength(1)
    // Today's read of the corrections, no access re-check of its own.
    expect(api.vitalCorrections).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vital-1')
  })

  it('says it is loading the correction, and never shows the first values as current meanwhile', async () => {
    vitals = [CORRECTED]
    let answer!: (value: unknown) => void
    api.vitalCorrections.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const card = await openEncounter()
    expect(await card.findByText(LOADING_CORRECTION)).toBeTruthy()
    expect(card.queryByText(/^Corrected \(correction 1\):/)).toBeNull()
    // The first values show only as what was first recorded, never as the current ones.
    expect(card.getAllByText('120/80')).toHaveLength(1)
    expect(within(card.getByText(/^Originally recorded:/)).getByText('120/80')).toBeTruthy()
    await act(async () => answer([CORRECTION]))
    expect(card.queryByText(LOADING_CORRECTION)).toBeNull()
    expect(card.getByText(/^Corrected \(correction 1\):/)).toBeTruthy()
  })

  it('says when a correction can’t be read, and shows what was first recorded', async () => {
    vitals = [CORRECTED]
    api.vitalCorrections.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const card = await openEncounter()
    const alert = await card.findByRole('alert')
    expect(alert.textContent?.startsWith(`${CORRECTION_UNREAD} `)).toBe(true)
    expect(within(card.getByText(/^Originally recorded:/)).getByText('120/80')).toBeTruthy()
    expect(card.queryByText(/^Corrected \(correction 1\):/)).toBeNull()
  })

  it('marks vitals entered in error with today’s warning', async () => {
    vitals = [{ ...VITAL, status: 'entered_in_error' }]
    const card = await openEncounter()
    expect(await card.findByText(RETRACTED_TEXT)).toBeTruthy()
    // Today's warning badge (Clinical.tsx VitalPanel), not the shared map's neutral tone.
    const badge = card.getByText('Entered in error')
    expect(badge.className).toContain(TONE_OUTLINE.warn)
    expect(badge.className).not.toContain(TONE_OUTLINE.neutral)
  })

  it('pages past the first 50 vitals with the card’s Record pages, History following the page shown', async () => {
    const later = { ...VITAL, id: 'vital-2', createdAt: '2026-10-29T08:05:00.000Z', pulseBpm: 88 }
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string }) => {
      if (kind !== 'vitals') return { items: [], nextCursor: null }
      return page?.cursor === 'vitals-2' ? { items: [later], nextCursor: null } : { items: [VITAL], nextCursor: 'vitals-2' }
    })
    const card = await openEncounter()
    const pager = await card.findByRole('navigation', { name: 'Record pages' })
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    const link = await card.findByRole('link', { name: `Vitals · ${formatWhen(later.createdAt)}` })
    expect(link.getAttribute('href')).toBe(`/provider/triage/${ENCOUNTER_ID}~vital-2`)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { cursor: 'vitals-2', fresh: false })
    expect(within(pager).getByText('Page 2')).toBeTruthy()
    expect(card.queryByRole('link', { name: `Vitals · ${formatWhen(VITAL.createdAt)}` })).toBeNull()
    // History lists the page the card shows, with no pager of its own for it.
    const history = within(screen.getByRole('heading', { level: 2, name: 'History' }).closest('section') as HTMLElement)
    expect(history.getByRole('link', { name: `Vitals · ${formatWhen(later.createdAt)}` })).toBeTruthy()
    expect(history.queryByRole('navigation', { name: 'Record pages' })).toBeNull()
    expect(window.location.href).not.toContain('vitals-2')
  })

  it('is not shown, and nothing is read, for a role that can’t read vitals', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.note.read']
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 2, name: 'Vitals' })).toBeNull()
    expect(vitalsReads()).toEqual([])
  })

  it('links "Record vitals" only for a role that may record vitals, with write access to the patient', async () => {
    let card = await openEncounter()
    expect(card.queryByRole('link', { name: 'Record vitals' })).toBeNull()
    cleanup()
    staff.permissions = [...READS, 'ehr.vital.write']
    card = await openEncounter()
    expect((await card.findByRole('link', { name: 'Record vitals' })).getAttribute('href')).toBe('/provider/triage/new')
    cleanup()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    card = await openEncounter()
    await screen.findByText('You can view this record but not change it.')
    expect(card.queryByRole('link', { name: 'Record vitals' })).toBeNull()
  })
})
