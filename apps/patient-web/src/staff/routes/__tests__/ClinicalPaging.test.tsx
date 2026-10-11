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
 * page" in a navigation landmark above the list, shown only when there is more
 * than one page. Paging never changes which encounter is being documented.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  createEncounter: vi.fn(), updateEncounter: vi.fn(), updateDiagnosis: vi.fn(), updateRecord: vi.fn(),
  vitalCorrections: vi.fn(), correctVital: vi.fn(),
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
      permissions: ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.vital.read', 'ehr.vital.write', 'ehr.diagnosis.read',
        'ehr.diagnosis.write', 'ehr.lab-request.read', 'ehr.lab-request.write'],
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
const RECORD_2 = 'ZGlhZ25vc2VzLXBhZ2UtMg'
const RECORD_3 = 'ZGlhZ25vc2VzLXBhZ2UtMw'
const LAB_2 = 'bGFiLXJlcXVlc3RzLXBhZ2UtMg'
const VITAL_2 = 'dml0YWxzLXBhZ2UtMg'
const base = { patientId: PATIENT, encounterId: E1.id, facilityId: 'facility-1', createdAt: '2026-10-01T08:05:00.000Z' }
const diagnosis = (id: string, display: string) => ({ ...base, id, codeSystem: 'ICD-10', code: 'B54', display,
  clinicalStatus: 'active', verificationStatus: 'provisional', notes: null, rowVersion: '1' })
const labDraft = (id: string, display: string) => ({ ...base, id, testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: display,
  priority: 'routine', status: 'draft', clinicalInformation: null, rowVersion: '1' })
const vital = (id: string, pulseBpm: number) => ({ ...base, id, recordedAt: base.createdAt, pulseBpm, systolicMmhg: null,
  diastolicMmhg: null, currentCorrectionNo: 0, rowVersion: '1' })

type Page = { items: unknown[]; nextCursor: string | null }
let encounterPages: Record<string, Page>
let recordPages: Record<string, Page>

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  encounterPages = { first: { items: [E1, E2], nextCursor: ENCOUNTER_NEXT }, [ENCOUNTER_NEXT]: { items: [E3], nextCursor: null } }
  recordPages = {
    'diagnoses:first': { items: [diagnosis('d-1', 'Malaria')], nextCursor: RECORD_2 },
    [`diagnoses:${RECORD_2}`]: { items: [diagnosis('d-2', 'Typhoid')], nextCursor: RECORD_3 },
    [`diagnoses:${RECORD_3}`]: { items: [diagnosis('d-3', 'Cholera')], nextCursor: null },
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
function pageButton(name: string, label: string) { return within(pager(name)).getByRole('button', { name: label }) }
function off(button: HTMLElement) { return button.getAttribute('aria-disabled') === 'true' }
function pageShown(name: string) { return within(pager(name)).getByRole('status').textContent }
function cursorOf(call: unknown[] | undefined, index: number) { return (call?.[index] as { cursor?: string } | undefined)?.cursor }
/** The facility, patient, encounter and kind of the latest records read. */
function lastRecordList() { return api.records.mock.calls.at(-1)?.slice(0, 4) }
function hold<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
/** Holds every read the predicate picks out, and answers the rest as before. */
function holdRecordReads(pick: (kind: string, page: { cursor?: string; fresh?: boolean } | undefined) => boolean) {
  const held = hold<Page>()
  const fallback = api.records.getMockImplementation()!
  api.records.mockImplementation((...args: unknown[]) => pick(args[3] as string, args[4] as { cursor?: string; fresh?: boolean } | undefined)
    ? held.promise : fallback(...(args as Parameters<typeof fallback>)))
  return held
}
const label = (text: string) => new RegExp(`^${text}\\s*\\*?$`)

async function openDiagnoses() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
  await screen.findByText('Malaria')
}
async function diagnosesPage2() {
  await openDiagnoses()
  fireEvent.click(pageButton('Record pages', 'Next page'))
  await screen.findByText('Typhoid')
}
function submitDiagnosisChange(reason = 'Confirmed by culture') {
  const form = screen.getByRole('button', { name: 'Update diagnosis' }).closest('form')!
  fireEvent.change(within(form).getByLabelText(label('Verification')), { target: { value: 'confirmed' } })
  fireEvent.change(within(form).getByLabelText(label('Reason for change')), { target: { value: reason } })
  fireEvent.click(within(form).getByRole('button', { name: 'Update diagnosis' }))
}

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
    expect(pageShown('Encounter pages')).toBe('Page 1')
    expect(off(pageButton('Encounter pages', 'Previous page'))).toBe(true)
    api.lookupPatient.mockClear()

    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    expect(await screen.findByText(/Headache/)).toBeTruthy()
    expect(screen.queryByText(/Fever/)).toBeNull()
    expect(cursorOf(api.encounters.mock.calls.at(-1), 2)).toBe(ENCOUNTER_NEXT)
    expect(api.lookupPatient).toHaveBeenCalled()
    expect(pageShown('Encounter pages')).toBe('Page 2')
    expect(off(pageButton('Encounter pages', 'Next page'))).toBe(true)

    fireEvent.click(pageButton('Encounter pages', 'Previous page'))
    expect(await screen.findByText(/Fever/)).toBeTruthy()
    expect(cursorOf(api.encounters.mock.calls.at(-1), 2)).toBeUndefined()
    expect(pageShown('Encounter pages')).toBe('Page 1')
  })

  it('keeps documenting the chosen encounter while another page of encounters is shown', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: /Cough/ }))
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, E2.id, 'vitals']))
    const reads = api.records.mock.calls.length

    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    await screen.findByText(/Headache/)
    fireEvent.click(pageButton('Encounter pages', 'Previous page'))
    await screen.findByText(/Fever/)

    expect(api.records.mock.calls.length).toBe(reads)
    expect(screen.getByRole('button', { name: /Cough/ }).className).toContain('selected')
    expect(screen.getByText(new Date(E2.startedAt).toLocaleString() + ' · in progress')).toBeTruthy()
  })

  it('never carries an unsaved record draft to another encounter', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Diagnoses' }))
    await screen.findByText('Malaria')
    fireEvent.change(screen.getByLabelText(label('Display')), { target: { value: 'Dengue' } })

    fireEvent.click(screen.getByRole('button', { name: /Cough/ }))
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, E2.id, 'diagnoses']))
    expect((screen.getByLabelText(label('Display')) as HTMLInputElement).value).toBe('')
  })

  it('refreshes the page shown, without reusing a read already in flight', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    await screen.findByText(/Headache/)

    encounterPages[ENCOUNTER_NEXT] = { items: [{ ...E3, chiefComplaint: 'Migraine' }], nextCursor: null }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh encounters' }))
    expect(await screen.findByText(/Migraine/)).toBeTruthy()
    expect(screen.queryByText(/Headache/)).toBeNull()
    expect(api.encounters.mock.calls.at(-1)?.[2]).toEqual({ cursor: ENCOUNTER_NEXT, fresh: true })
    expect(pageShown('Encounter pages')).toBe('Page 2')
  })

  it('returns to the first page, and selects it, after starting an encounter', async () => {
    const created = encounter(4, 'Chest pain')
    api.createEncounter.mockResolvedValue(created)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    await screen.findByText(/Headache/)

    encounterPages.first = { items: [created, E1], nextCursor: ENCOUNTER_NEXT }
    fireEvent.change(screen.getByLabelText(/^Chief complaint/), { target: { value: 'Chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start encounter' }))

    expect(await screen.findByText(/Chest pain/)).toBeTruthy()
    expect(api.encounters.mock.calls.at(-1)?.[2]).toEqual({ cursor: undefined, fresh: true })
    expect(pageShown('Encounter pages')).toBe('Page 1')
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, created.id, 'vitals']))
  })

  it('documents a new encounter even when the first page does not hold it', async () => {
    const created = { ...encounter(4, 'Chest pain'), startedAt: '2026-09-01T08:00:00.000Z' }
    api.createEncounter.mockResolvedValue(created)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.change(screen.getByLabelText(/^Chief complaint/), { target: { value: 'Chest pain' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start encounter' }))

    await screen.findByText('Encounter created by the backend.')
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, created.id, 'vitals']))
    expect(screen.getByText(new Date(created.startedAt).toLocaleString() + ' · in progress')).toBeTruthy()
  })

  it('stays on the page after a status change there, with the encounter it changed', async () => {
    api.updateEncounter.mockResolvedValue({ ...E3, status: 'on_hold', rowVersion: 2 })
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    fireEvent.click(await screen.findByRole('button', { name: /Headache/ }))
    await waitFor(() => expect(lastRecordList()).toEqual(['facility-1', PATIENT, E3.id, 'vitals']))

    encounterPages[ENCOUNTER_NEXT] = { items: [{ ...E3, status: 'on_hold', rowVersion: 2 }], nextCursor: null }
    const form = screen.getByText('Encounter status').closest('form')!
    fireEvent.change(within(form).getByLabelText(label('Reason for change')), { target: { value: 'Awaiting results' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await screen.findByText('Encounter status updated.')
    expect(api.encounters.mock.calls.at(-1)?.[2]).toEqual({ cursor: ENCOUNTER_NEXT, fresh: true })
    expect(pageShown('Encounter pages')).toBe('Page 2')
    expect(screen.queryByText(/Fever/)).toBeNull()
    expect(screen.getByText(new Date(E3.startedAt).toLocaleString() + ' · on hold')).toBeTruthy()
  })

  it('does not undo a page move made while a status change was saving', async () => {
    const saving = hold<unknown>()
    api.updateEncounter.mockReturnValue(saving.promise)
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    const form = screen.getByText('Encounter status').closest('form')!
    fireEvent.change(within(form).getByLabelText(label('Reason for change')), { target: { value: 'Awaiting results' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(api.updateEncounter).toHaveBeenCalled())

    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    await screen.findByText(/Headache/)
    await act(async () => { saving.resolve({ ...E1, status: 'on_hold', rowVersion: 2 }) })

    await screen.findByText('Encounter status updated.')
    expect(pageShown('Encounter pages')).toBe('Page 2')
    expect(screen.getByText(/Headache/)).toBeTruthy()
    expect(screen.getByText(new Date(E1.startedAt).toLocaleString() + ' · on hold')).toBeTruthy()
  })

  it('goes back to the first page, and says so, when the backend no longer accepts the cursor', async () => {
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText(/Fever/)
    fireEvent.click(pageButton('Encounter pages', 'Next page'))
    await screen.findByText(/Headache/)
    const fallback = api.encounters.getMockImplementation()!
    api.encounters.mockImplementation((...args: unknown[]) => (args[2] as { cursor?: string } | undefined)?.cursor
      ? Promise.reject(new HidApiError(400, 'Pagination cursor is invalid', { code: 'INVALID_CURSOR' }))
      : fallback(...(args as Parameters<typeof fallback>)))

    fireEvent.click(screen.getByRole('button', { name: 'Refresh encounters' }))
    expect(await screen.findByText(/list changed since it was opened/)).toBeTruthy()
    expect(await screen.findByText(/Fever/)).toBeTruthy()
    expect(screen.queryByText(/Headache/)).toBeNull()
    expect(pageShown('Encounter pages')).toBe('Page 1')
    expect(off(pageButton('Encounter pages', 'Previous page'))).toBe(true)
  })
})

describe('paging an encounter record list', () => {
  it('shows each page from the backend cursor, goes back one page at a time, and nothing past the last', async () => {
    await diagnosesPage2()
    expect(screen.queryByText('Malaria')).toBeNull()
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBe(RECORD_2)
    expect(pageShown('Record pages')).toBe('Page 2')

    fireEvent.click(pageButton('Record pages', 'Next page'))
    expect(await screen.findByText('Cholera')).toBeTruthy()
    expect(pageShown('Record pages')).toBe('Page 3')
    expect(off(pageButton('Record pages', 'Next page'))).toBe(true)

    fireEvent.click(pageButton('Record pages', 'Previous page'))
    expect(await screen.findByText('Typhoid')).toBeTruthy()
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBe(RECORD_2)
    expect(pageShown('Record pages')).toBe('Page 2')
  })

  it('shows the pager above the rows, as the reference does', async () => {
    await openDiagnoses()
    const nav = pager('Record pages')
    const row = screen.getByText('Malaria')
    expect(nav.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the page buttons focusable while a page loads, and ignores presses until it has', async () => {
    await openDiagnoses()
    const held = holdRecordReads((kind, page) => kind === 'diagnoses' && page?.cursor === RECORD_2)
    const next = pageButton('Record pages', 'Next page')
    next.focus()
    fireEvent.click(next)
    await waitFor(() => expect(off(next)).toBe(true))
    expect((next as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(next)
    const reads = api.records.mock.calls.length
    fireEvent.click(next)
    expect(api.records.mock.calls.length).toBe(reads)

    await act(async () => { held.resolve({ items: [diagnosis('d-2', 'Typhoid')], nextCursor: RECORD_3 }) })
    expect(await screen.findByText('Typhoid')).toBeTruthy()
    expect(off(pageButton('Record pages', 'Next page'))).toBe(false)
  })

  it('reports a failed page read beside the list, keeping the page shown', async () => {
    await openDiagnoses()
    holdRecordReads((kind, page) => kind === 'diagnoses' && page?.cursor === RECORD_2)
      .reject(new HidApiError(503, 'Service unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(pageButton('Record pages', 'Next page'))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Service unavailable')
    expect(pager('Record pages').closest('.staff-card')!.contains(alert)).toBe(true)
    expect(screen.getByText('Malaria')).toBeTruthy()
    expect(pageShown('Record pages')).toBe('Page 1')
  })

  it('stays on the page after a diagnosis change there, re-reading that page afresh', async () => {
    api.updateDiagnosis.mockResolvedValue({})
    await diagnosesPage2()
    recordPages[`diagnoses:${RECORD_2}`] = { items: [{ ...diagnosis('d-2', 'Typhoid'), verificationStatus: 'confirmed', rowVersion: '2' }], nextCursor: RECORD_3 }
    submitDiagnosisChange()

    await screen.findByText('Diagnosis updated.')
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[4]).toEqual({ cursor: RECORD_2, fresh: true }))
    expect(await screen.findByText('ICD-10 · B54 · active · confirmed')).toBeTruthy()
    expect(pageShown('Record pages')).toBe('Page 2')
  })

  it('stays on the page after a lab request status change there', async () => {
    api.updateRecord.mockResolvedValue({})
    recordPages['lab-requests:first'] = { items: [labDraft('l-1', 'Haemoglobin')], nextCursor: LAB_2 }
    recordPages[`lab-requests:${LAB_2}`] = { items: [labDraft('l-2', 'Glucose')], nextCursor: null }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    await screen.findByText('Haemoglobin')
    fireEvent.click(pageButton('Record pages', 'Next page'))
    await screen.findByText('Glucose')

    const form = screen.getByText('Lab request status').closest('form')!
    fireEvent.change(within(form).getByLabelText(label('Reason for change')), { target: { value: 'Ordered twice' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))

    await screen.findByText('Lab request status updated.')
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[4]).toEqual({ cursor: LAB_2, fresh: true }))
    expect(pageShown('Record pages')).toBe('Page 2')
  })

  it('stays on the page after a vital correction there', async () => {
    api.correctVital.mockResolvedValue({ id: 'c-1', correctionNo: 1 })
    recordPages['vitals:first'] = { items: [vital('v-1', 70)], nextCursor: VITAL_2 }
    recordPages[`vitals:${VITAL_2}`] = { items: [vital('v-2', 88)], nextCursor: null }
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('70 bpm')
    fireEvent.click(pageButton('Record pages', 'Next page'))
    await screen.findByText('88 bpm')

    fireEvent.click(screen.getByRole('button', { name: 'Correct these vitals' }))
    const form = screen.getByRole('button', { name: 'Save correction' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(label('Pulse \\(bpm\\)')), { target: { value: '90' } })
    fireEvent.change(within(form).getByLabelText(label('Reason for correction')), { target: { value: 'Misread monitor' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))

    await screen.findByText('Vital correction saved.')
    await waitFor(() => expect(api.records.mock.calls.at(-1)?.[4]).toEqual({ cursor: VITAL_2, fresh: true }))
    expect(pageShown('Record pages')).toBe('Page 2')
  })

  it('does not undo a page move made while a change was saving', async () => {
    const saving = hold<unknown>()
    api.updateDiagnosis.mockReturnValue(saving.promise)
    await diagnosesPage2()
    submitDiagnosisChange()
    await waitFor(() => expect(api.updateDiagnosis).toHaveBeenCalled())

    fireEvent.click(pageButton('Record pages', 'Previous page'))
    await screen.findByText('Malaria')
    await act(async () => { saving.resolve({}) })

    await screen.findByText('Diagnosis updated.')
    expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBeUndefined()
    expect(pageShown('Record pages')).toBe('Page 1')
    expect(screen.getByText('Malaria')).toBeTruthy()
  })

  it('returns to the first page after adding a record, where the new record is', async () => {
    api.createRecord.mockResolvedValue({ id: 'd-new' })
    await diagnosesPage2()
    recordPages['diagnoses:first'] = { items: [diagnosis('d-new', 'Dengue'), diagnosis('d-1', 'Malaria')], nextCursor: RECORD_2 }
    fireEvent.change(screen.getByLabelText(/^Code system/), { target: { value: 'ICD-10' } })
    fireEvent.change(screen.getByLabelText(label('Code')), { target: { value: 'A90' } })
    fireEvent.change(screen.getByLabelText(label('Display')), { target: { value: 'Dengue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save record' }))

    expect(await screen.findByText('Dengue')).toBeTruthy()
    expect(pageShown('Record pages')).toBe('Page 1')
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
    expect(pageShown('Record pages')).toBe('Page 1')
  })

  it('never lets a re-read that lands after a tab change replace the new tab', async () => {
    api.updateDiagnosis.mockResolvedValue({})
    await openDiagnoses()
    // Every diagnoses read from here on, the re-read after the change, waits until released.
    const held = holdRecordReads(kind => kind === 'diagnoses')
    const diagnosisReads = () => api.records.mock.calls.filter(call => call[3] === 'diagnoses').length
    const before = diagnosisReads()
    submitDiagnosisChange()
    await waitFor(() => expect(diagnosisReads()).toBeGreaterThan(before))

    recordPages['vitals:first'] = { items: [vital('v-1', 70)], nextCursor: null }
    fireEvent.click(screen.getByRole('tab', { name: 'Vitals' }))
    expect(await screen.findByText('70 bpm')).toBeTruthy()

    await act(async () => { held.resolve({ items: [diagnosis('d-1', 'Malaria')], nextCursor: null }) })
    expect(screen.getByText('70 bpm')).toBeTruthy()
    expect(screen.queryByText('Malaria')).toBeNull()
  })

  it('makes no re-read for a list left while its change was saving', async () => {
    const saving = hold<unknown>()
    api.updateDiagnosis.mockReturnValue(saving.promise)
    await openDiagnoses()
    submitDiagnosisChange()
    await waitFor(() => expect(api.updateDiagnosis).toHaveBeenCalled())

    recordPages['vitals:first'] = { items: [vital('v-1', 70)], nextCursor: null }
    fireEvent.click(screen.getByRole('tab', { name: 'Vitals' }))
    expect(await screen.findByText('70 bpm')).toBeTruthy()
    const diagnosisReads = api.records.mock.calls.filter(call => call[3] === 'diagnoses').length
    await act(async () => { saving.resolve({}) })

    expect(screen.getByText('70 bpm')).toBeTruthy()
    expect(screen.queryByText(/No vitals/)).toBeNull()
    expect(api.records.mock.calls.filter(call => call[3] === 'diagnoses').length).toBe(diagnosisReads)
  })

  it('shows no error from a page read the clinician has moved on from', async () => {
    await openDiagnoses()
    const held = holdRecordReads((kind, page) => kind === 'diagnoses' && page?.cursor === RECORD_2)
    fireEvent.click(pageButton('Record pages', 'Next page'))
    await waitFor(() => expect(cursorOf(api.records.mock.calls.at(-1), 4)).toBe(RECORD_2))

    recordPages['vitals:first'] = { items: [vital('v-1', 70)], nextCursor: null }
    fireEvent.click(screen.getByRole('tab', { name: 'Vitals' }))
    expect(await screen.findByText('70 bpm')).toBeTruthy()
    await act(async () => { held.reject(new HidApiError(503, 'Service unavailable', { code: 'SERVICE_UNAVAILABLE' })) })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('70 bpm')).toBeTruthy()
  })

  it('goes back to the first page, and says so, when the backend no longer accepts the cursor', async () => {
    await diagnosesPage2()
    const fallback = api.records.getMockImplementation()!
    api.records.mockImplementation((...args: unknown[]) => (args[4] as { cursor?: string } | undefined)?.cursor
      ? Promise.reject(new HidApiError(400, 'Pagination cursor is invalid', { code: 'INVALID_CURSOR' }))
      : fallback(...(args as Parameters<typeof fallback>)))

    fireEvent.click(pageButton('Record pages', 'Next page'))
    expect(await screen.findByText(/list changed since it was opened/)).toBeTruthy()
    expect(await screen.findByText('Malaria')).toBeTruthy()
    expect(pageShown('Record pages')).toBe('Page 1')
    expect(off(pageButton('Record pages', 'Previous page'))).toBe(true)
  })
})
