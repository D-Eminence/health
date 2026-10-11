import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

/**
 * EHR pages a patient's encounters and each encounter's records 50 at a time,
 * newest first, with an opaque nextCursor (hid-system ehr/shared/clinical-context.ts
 * timelinePage). Rows past the first page were never shown. The record now pages
 * as the reference design's record lists do: "Previous page", "Page N" and "Next
 * page" in a navigation landmark, shown only when there is more than one page.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  createEncounter: vi.fn(), updateDiagnosis: vi.fn(), vitalCorrections: vi.fn(),
}))
const staff = vi.hoisted(() => ({ activePatient: null as unknown }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.vital.read', 'ehr.diagnosis.read',
        'ehr.diagnosis.write'],
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const encounter = (n: number, complaint: string) => ({ id: `e0000000-0000-4000-8000-00000000000${n}`, patientId: PATIENT,
  facilityId: 'facility-1', encounterType: 'ambulatory', status: 'in_progress', startedAt: `2026-10-0${n}T08:00:00.000Z`,
  chiefComplaint: complaint, rowVersion: 1 })
const E1 = encounter(1, 'Fever'), E2 = encounter(2, 'Cough'), E3 = encounter(3, 'Headache')
const ENCOUNTER_NEXT = 'ZW5jb3VudGVyLXBhZ2UtMg'
const RECORD_NEXT = 'ZGlhZ25vc2VzLXBhZ2UtMg'
const diagnosis = (id: string, display: string) => ({ id, patientId: PATIENT, encounterId: E1.id, facilityId: 'facility-1',
  createdAt: '2026-10-01T08:05:00.000Z', codeSystem: 'ICD-10', code: 'B54', display, clinicalStatus: 'active',
  verificationStatus: 'provisional', notes: null, rowVersion: '1' })

type Page = { items: unknown[]; nextCursor: string | null }
let encounterPages: Record<string, Page>
let recordPages: Record<string, Page>

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  encounterPages = { first: { items: [E1, E2], nextCursor: ENCOUNTER_NEXT }, [ENCOUNTER_NEXT]: { items: [E3], nextCursor: null } }
  recordPages = {
    'diagnoses:first': { items: [diagnosis('d-1', 'Malaria')], nextCursor: RECORD_NEXT },
    [`diagnoses:${RECORD_NEXT}`]: { items: [diagnosis('d-2', 'Typhoid')], nextCursor: null },
  }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockImplementation(async (_f: string, _p: string, page?: { cursor?: string }) =>
    encounterPages[page?.cursor ?? 'first'] ?? { items: [], nextCursor: null })
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string }) =>
    recordPages[`${kind}:${page?.cursor ?? 'first'}`] ?? { items: [], nextCursor: null })
  api.vitalCorrections.mockResolvedValue([])
})

function pager(name: string) { return screen.getByRole('navigation', { name }) }
function cursorOf(call: unknown[] | undefined, index: number) { return (call?.[index] as { cursor?: string } | undefined)?.cursor }
/** The facility, patient, encounter and kind of the latest records read. */
function lastRecordList() { return api.records.mock.calls.at(-1)?.slice(0, 4) }

describe('paging the encounter list', () => {
  it('offers no paging when the first page is the only one', async () => {
    encounterPages.first = { items: [E1, E2], nextCursor: null }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    expect(screen.queryByRole('navigation', { name: 'Encounter pages' })).toBeNull()
  })

  it('moves to the next page with the backend cursor and back, rechecking access each time', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    const nav = pager('Encounter pages')
    expect(within(nav).getByText('Page 1')).toBeTruthy()
    expect((within(nav).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    api.lookupPatient.mockClear()

    fireEvent.click(within(nav).getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText(/Headache/)).toBeTruthy()
    expect(screen.queryByText(/Fever/)).toBeNull()
    expect(cursorOf(api.encounters.mock.calls.at(-1), 2)).toBe(ENCOUNTER_NEXT)
    expect(api.lookupPatient).toHaveBeenCalled()
    expect(within(pager('Encounter pages')).getByText('Page 2')).toBeTruthy()
    expect((within(pager('Encounter pages')).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
    // The selected encounter is one on the page shown.
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, E3.id, 'vitals']))

    fireEvent.click(within(pager('Encounter pages')).getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText(/Fever/)).toBeTruthy()
    expect(cursorOf(api.encounters.mock.calls.at(-1), 2)).toBeUndefined()
    expect(within(pager('Encounter pages')).getByText('Page 1')).toBeTruthy()
  })

  it('refreshes the page shown, without reusing a read already in flight', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(within(pager('Encounter pages')).getByRole('button', { name: 'Next page' }))
    await screen.findByText(/Headache/)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh encounters' }))
    await waitFor(() => expect(api.encounters.mock.calls.at(-1)?.[2]).toEqual({ cursor: ENCOUNTER_NEXT, fresh: true }))
    expect(await screen.findByText(/Headache/)).toBeTruthy()
    expect(within(pager('Encounter pages')).getByText('Page 2')).toBeTruthy()
  })

  it('returns to the first page, and selects it, after starting an encounter', async () => {
    const created = encounter(4, 'Chest pain')
    api.createEncounter.mockResolvedValue(created)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(within(pager('Encounter pages')).getByRole('button', { name: 'Next page' }))
    await screen.findByText(/Headache/)

    encounterPages.first = { items: [created, E1], nextCursor: ENCOUNTER_NEXT }
    fireEvent.change(screen.getByLabelText(/^Chief complaint/), { target: { value: 'Chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start encounter' }))

    expect(await screen.findByText(/Chest pain/)).toBeTruthy()
    expect(api.encounters.mock.calls.at(-1)?.[2]).toEqual({ cursor: undefined, fresh: true })
    expect(within(pager('Encounter pages')).getByText('Page 1')).toBeTruthy()
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, created.id, 'vitals']))
  })
})

describe('paging an encounter record list', () => {
  async function diagnosesPage2() {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
    await screen.findByText('Malaria')
    fireEvent.click(within(pager('Record pages')).getByRole('button', { name: 'Next page' }))
    await screen.findByText('Typhoid')
  }

  it('shows the next page from the backend cursor, and nothing past the last', async () => {
    await diagnosesPage2()
    expect(screen.queryByText('Malaria')).toBeNull()
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBe(RECORD_NEXT)
    const nav = pager('Record pages')
    expect(within(nav).getByText('Page 2')).toBeTruthy()
    expect((within(nav).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(nav).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('stays on the page after a change there, re-reading that page afresh', async () => {
    api.updateDiagnosis.mockResolvedValue({})
    await diagnosesPage2()
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(/^Verification/), { target: { value: 'confirmed' } })
    fireEvent.change(within(form).getByLabelText(/^Reason for change/), { target: { value: 'Confirmed by culture' } })
    recordPages[`diagnoses:${RECORD_NEXT}`] = { items: [{ ...diagnosis('d-2', 'Typhoid'), verificationStatus: 'confirmed', rowVersion: '2' }], nextCursor: null }
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))

    await screen.findByText('Diagnosis updated.')
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[4]).toEqual({ cursor: RECORD_NEXT, fresh: true }))
    expect(await screen.findByText('ICD-10 · B54 · active · confirmed')).toBeTruthy()
    expect(within(pager('Record pages')).getByText('Page 2')).toBeTruthy()
  })

  it('returns to the first page after adding a record, where the new record is', async () => {
    api.createRecord.mockResolvedValue({ id: 'd-new' })
    await diagnosesPage2()
    recordPages['diagnoses:first'] = { items: [diagnosis('d-new', 'Dengue'), diagnosis('d-1', 'Malaria')], nextCursor: RECORD_NEXT }
    fireEvent.change(screen.getByLabelText(/^Code system/), { target: { value: 'ICD-10' } })
    fireEvent.change(screen.getByLabelText(/^Code\s*\*?$/), { target: { value: 'A90' } })
    fireEvent.change(screen.getByLabelText(/^Display/), { target: { value: 'Dengue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    expect(await screen.findByText('Dengue')).toBeTruthy()
    expect(within(pager('Record pages')).getByText('Page 1')).toBeTruthy()
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBeUndefined()
  })

  it('starts each list at its first page when the tab changes', async () => {
    await diagnosesPage2()
    fireEvent.click(screen.getByRole('tab', { name: 'Vitals' }))
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, E1.id, 'vitals']))
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBeUndefined()

    fireEvent.click(screen.getByRole('tab', { name: 'Diagnoses' }))
    expect(await screen.findByText('Malaria')).toBeTruthy()
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBeUndefined()
    expect(within(pager('Record pages')).getByText('Page 1')).toBeTruthy()
  })

  it('never lets a re-read that lands after a tab change replace the new tab', async () => {
    api.updateDiagnosis.mockResolvedValue({})
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
    await screen.findByText('Malaria')

    // Every diagnoses read from here on, the re-read after the change, waits until released.
    let settleReread: (page: Page) => void = () => {}
    const fallback = api.records.getMockImplementation()!
    api.records.mockImplementation((...args: unknown[]) => args[3] === 'diagnoses'
      ? new Promise<Page>(resolve => { settleReread = resolve })
      : fallback(...(args as Parameters<typeof fallback>)))
    const diagnosisReads = () => api.records.mock.calls.filter(call => call[3] === 'diagnoses').length
    const before = diagnosisReads()
    const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(/^Verification/), { target: { value: 'confirmed' } })
    fireEvent.change(within(form).getByLabelText(/^Reason for change/), { target: { value: 'Confirmed by culture' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))
    await waitFor(() => expect(diagnosisReads()).toBeGreaterThan(before))

    recordPages['vitals:first'] = { items: [{ id: 'v-1', patientId: PATIENT, encounterId: E1.id, createdAt: '2026-10-01T08:05:00.000Z',
      pulseBpm: 70, systolicMmhg: null, diastolicMmhg: null, currentCorrectionNo: 0, rowVersion: '1' }], nextCursor: null }
    fireEvent.click(screen.getByRole('tab', { name: 'Vitals' }))
    expect(await screen.findByText('70 bpm')).toBeTruthy()

    await act(async () => { settleReread({ items: [diagnosis('d-1', 'Malaria')], nextCursor: null }) })
    expect(screen.getByText('70 bpm')).toBeTruthy()
    expect(screen.queryByText('Malaria')).toBeNull()
  })

  it('goes back to the first page when the backend no longer accepts the cursor', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
    await screen.findByText('Malaria')
    const fallback = api.records.getMockImplementation()!
    api.records.mockImplementation((...args: unknown[]) => (args[4] as { cursor?: string } | undefined)?.cursor
      ? Promise.reject(new HidApiError(400, 'Pagination cursor is invalid', { code: 'INVALID_CURSOR' }))
      : fallback(...(args as Parameters<typeof fallback>)))

    fireEvent.click(within(pager('Record pages')).getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText(/list changed since it was opened/)).toBeTruthy()
    expect(await screen.findByText('Malaria')).toBeTruthy()
    expect(within(pager('Record pages')).getByText('Page 1')).toBeTruthy()
  })
})
