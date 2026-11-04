import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'
import { PatientAddedRecords } from '../PatientAddedRecords'

/**
 * "Added by the patient" on the chart (hid-system 0116): the records the patient added themselves, read-only, read as the
 * chart's other reads are (the selected facility, direct care, ehr.note.read), a page at a time, and labelled as not
 * checked by a health worker. Hidden where EHR does not serve them (404: hid-system main, or switched off) or refuses
 * them (403). Fictional data only.
 */
const fixture = vi.hoisted(() => ({ permissions: ['ehr.encounter.read', 'ehr.note.read'], purpose: 'direct-care',
  patient: { authorization: { decision: 'allow' }, patient: { patientId: 'patient-a', hid: 'HID-TEST', fullName: 'Test patient' } },
  api: { lookupPatient: vi.fn(), encounters: vi.fn(), consentStatus: vi.fn(), importedRecords: vi.fn(), reportedHealthProfile: vi.fn(), patientEntries: vi.fn() },
}))
vi.mock('../../api', () => ({ staffApi: fixture.api,
  isAllowedPatientLookup: (value: { authorization: { decision: string } }) => value.authorization.decision === 'allow',
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))
vi.mock('../../App', () => ({ useStaff: () => ({
  state: { status: 'ready', session: { actor: { id: 'staff-a', facility: { id: 'facility-a', name: 'Test facility', permissions: fixture.permissions } } } },
  activePatient: { hid: 'HID-TEST', purpose: fixture.purpose, lookup: fixture.patient },
  setActivePatient: vi.fn(),
}) }))

const entry = (n: number, extra: object = {}) => ({ id: `0000000${n}-1111-4111-8111-111111111111`, source: 'patient', kind: 'medicine',
  title: `Amoxicillin ${n}00 mg`, facilityName: n === 9 ? 'Lagos General Hospital' : null, occurredOn: `2026-0${n}-01`,
  notes: n === 9 ? 'Twice a day.\nFor a week.' : null, createdAt: `2026-0${n}-02T08:00:00.000Z`, documents: [], ...extra })
const CURSOR = 'Y3Vyc29yLW9uZS1maWN0aW9uYWw'
const LABEL = 'Added by the patient. Not checked by a health worker.'

beforeEach(() => {
  vi.clearAllMocks()
  fixture.permissions = ['ehr.encounter.read', 'ehr.note.read']
  fixture.purpose = 'direct-care'
  fixture.api.lookupPatient.mockResolvedValue(fixture.patient)
  fixture.api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  fixture.api.consentStatus.mockResolvedValue({ readAllowed: true, writeAllowed: false })
  fixture.api.reportedHealthProfile.mockResolvedValue(null)
  fixture.api.patientEntries.mockResolvedValue({ items: [entry(9), entry(8)], nextBefore: null })
})
afterEach(() => { vi.unstubAllEnvs() })

const section = async () => (await screen.findByRole('heading', { name: 'Added by the patient' })).closest('section') as HTMLElement
const titles = (card: HTMLElement) => within(card).getAllByRole('heading', { level: 3 }).map(item => item.textContent)

describe('Added by the patient, on the chart', () => {
  it('lists them read-only, newest first, labelled as not checked by a health worker', async () => {
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    const card = await section()
    expect(within(card).getByText(LABEL)).toBeTruthy()
    expect(titles(card)).toEqual(['Amoxicillin 900 mg', 'Amoxicillin 800 mg'])
    expect(within(card).getByText('Medicine · Lagos General Hospital · 1 Sept 2026')).toBeTruthy()
    expect(within(card).getByText('Medicine · 1 Aug 2026')).toBeTruthy()
    expect(within(card).getByText('Twice a day.\nFor a week.', { normalizer: text => text })).toBeTruthy()
    // Read-only: nothing to change or remove.
    expect(within(card).queryAllByRole('button')).toEqual([])
    expect(fixture.api.patientEntries).toHaveBeenCalledWith('facility-a', 'patient-a', null, expect.any(AbortSignal))
  })

  it('says so when the patient has added none', async () => {
    fixture.api.patientEntries.mockResolvedValue({ items: [], nextBefore: null })
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    const card = await section()
    expect(within(card).getByText('The patient hasn’t added any records.')).toBeTruthy()
    expect(within(card).getByText(LABEL)).toBeTruthy()
  })

  it.each([404, 403])('is hidden when the route answers %i', async status => {
    fixture.api.patientEntries.mockRejectedValue(new HidApiError(status, 'Refused', { code: status === 404 ? 'NOT_FOUND' : 'CONSENT_REQUIRED' }))
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    await waitFor(() => expect(fixture.api.patientEntries).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByRole('heading', { name: 'Added by the patient' })).toBeNull()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
  })

  it('says so when EHR could not answer, never in its words, and reads again on Retry', async () => {
    fixture.api.patientEntries.mockRejectedValueOnce(new HidApiError(503, 'relation ehr.patient_entries is locked'))
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    const card = await section()
    expect(within(card).getByText('The records the patient added could not be loaded.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/relation|locked/)
    fireEvent.click(within(card).getByRole('button', { name: 'Retry records added by the patient' }))
    await waitFor(() => expect(titles(card)).toHaveLength(2))
    expect(fixture.api.patientEntries).toHaveBeenCalledTimes(2)
  })

  it('shows older ones a page at a time, once each however often it is pressed, with focus on the first one shown', async () => {
    let release: (page: unknown) => void = () => {}
    fixture.api.patientEntries.mockResolvedValueOnce({ items: [entry(9), entry(8)], nextBefore: CURSOR })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    const card = await section()
    const older = within(card).getByRole('button', { name: 'Show older records added by the patient' })
    older.focus()
    fireEvent.click(older)
    fireEvent.click(older)
    expect(fixture.api.patientEntries).toHaveBeenCalledTimes(2)
    expect(fixture.api.patientEntries).toHaveBeenLastCalledWith('facility-a', 'patient-a', CURSOR, expect.any(AbortSignal))
    await act(async () => { release({ items: [entry(7)], nextBefore: null }) })
    expect(titles(card)).toEqual(['Amoxicillin 900 mg', 'Amoxicillin 800 mg', 'Amoxicillin 700 mg'])
    expect(document.activeElement).toBe(within(card).getByRole('heading', { level: 3, name: 'Amoxicillin 700 mg' }))
    expect(within(card).getByText('1 older record shown. That’s all of them.').closest('[role="status"]')).not.toBeNull()
    expect(within(card).queryByRole('button', { name: /Show older/ })).toBeNull()
  })

  it('says an older page could not be loaded and keeps Show older; reads from the start when the list changed', async () => {
    fixture.api.patientEntries.mockResolvedValueOnce({ items: [entry(9)], nextBefore: CURSOR })
      .mockRejectedValueOnce(new HidApiError(503, 'Down'))
      .mockRejectedValueOnce(new HidApiError(400, 'This list changed.', { code: 'INVALID_CURSOR' }))
      .mockResolvedValueOnce({ items: [entry(9), entry(8)], nextBefore: null })
    render(<PatientAddedRecords facilityId="facility-a" patientId="patient-a" />)
    const card = await section()
    fireEvent.click(within(card).getByRole('button', { name: 'Show older records added by the patient' }))
    expect(await within(card).findByText('Older records could not be loaded. Please try again.')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Show older records added by the patient' }))
    expect(await within(card).findByText('The list changed, so it was loaded again from the start.')).toBeTruthy()
    await waitFor(() => expect(titles(card)).toEqual(['Amoxicillin 900 mg', 'Amoxicillin 800 mg']))
    expect(fixture.api.patientEntries.mock.calls.map(call => call[2])).toEqual([null, CURSOR, CURSOR, null])
  })

  it('is on the classic chart for direct care with ehr.note.read, and not asked for otherwise', async () => {
    const { unmount } = render(<MemoryRouter><Clinical /></MemoryRouter>)
    expect(within(await section()).getByText(LABEL)).toBeTruthy()
    expect(fixture.api.patientEntries).toHaveBeenCalledWith('facility-a', 'patient-a', null, expect.any(AbortSignal))
    unmount()
    vi.clearAllMocks()
    fixture.permissions = ['ehr.encounter.read']
    const second = render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByText('No encounters are available for this patient and facility.')
    second.unmount()
    fixture.permissions = ['ehr.encounter.read', 'ehr.note.read']
    fixture.purpose = 'emergency'
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Test patient' })
    await act(async () => {})
    expect(fixture.api.patientEntries).not.toHaveBeenCalled()
  })
})
