import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { RecordsPage } from '../routes/Portal'
import { dayLabel } from '../routes/recordSearch'
import { historyFixture } from './importedHistoryFixture'
import { json, problem, renderPortal, type Handler } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))
afterEach(() => { novu.on = true })

/**
 * hid-1.0's records page: a "Search by date, title, or keyword" box over the records loaded, and the records under
 * day headings, newest day first. Nothing is sent for a search.
 */
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString()
const NOVU_RECORDS = {
  encounters: [
    { id: 'enc-old', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed', startedAt: at(2, 9), endedAt: null },
    { id: 'enc-new', facilityId: 'facility-1', encounterType: 'emergency', status: 'completed', startedAt: at(8, 14), endedAt: null },
    { id: 'enc-morning', facilityId: 'facility-1', encounterType: 'inpatient', status: 'completed', startedAt: at(8, 8), endedAt: null },
  ],
  notes: [
    { id: 'note-1', encounterId: 'enc-new', facilityId: 'facility-1', noteType: 'progress', title: 'Chest pain review', status: 'signed',
      revisionNo: 1, content: 'Seen by Dr Okafor at Lagos Island General.', signedAt: at(8, 15) },
    { id: 'note-2', encounterId: 'enc-old', facilityId: 'facility-1', noteType: 'discharge', title: '', status: 'signed',
      revisionNo: 1, content: 'Blood pressure follow-up in two weeks.', signedAt: at(2, 10) },
  ],
  importedRecords: historyFixture, importedHealthProfile: null, limit: 50,
}
const gateway = (records: unknown): Handler => (path, method) => path === '/ehr/me/records' && method === 'GET'
  ? json(records) : path === '/ehr/me/imported-history' ? problem(404, 'NOT_FOUND', 'Not served') : problem(500, 'UNEXPECTED', `${method} ${path}`)
/** hid-system main's records answer, which has no imported records: they are read a page at a time beside it. */
const MAIN_RECORDS = {
  ...NOVU_RECORDS, importedRecords: undefined, importedHealthProfile: undefined, vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [],
  released: ['encounters', 'notes', 'vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents'], withheld: [],
}
const legacyRecord = {
  id: 'rec-1', origin: 'provider-authored', title: 'Legacy malaria treatment', category: 'medication', infoType: 'medication',
  createdAt: '2019-03-01T10:00:00.000Z', updatedAt: '2019-03-02T10:00:00.000Z', currentVersionId: 'ver-1',
  versions: [{ id: 'ver-1', versionNo: 1, origin: 'provider-authored', createdAt: '2019-03-01T10:00:00.000Z', record: 'Artemether course.',
    notes: null, structuredData: null, transcriptionText: null }],
  versionsTruncated: false, files: [], filesTruncated: false,
}
const mainGateway: Handler = (path, method) => {
  if (path === '/ehr/me/records' && method === 'GET') return json(MAIN_RECORDS)
  if (path === '/ehr/me/imported-history' && method === 'GET') return json({ records: [legacyRecord], healthProfile: null,
    limits: { records: 50, versionsPerRecord: 20, filesPerRecord: 20 }, truncated: { records: false }, nextCursor: null, provenance: 'legacy-import' })
  if (path === '/identity/me/imported-history-sharing') return problem(404, 'NOT_FOUND', 'Not served')
  return problem(500, 'UNEXPECTED', `${method} ${path}`)
}
const cardOf = (name: string) => screen.getByRole('heading', { name, level: 2 }).closest('.patient-card') as HTMLElement
const search = () => screen.getByRole('searchbox', { name: 'Search your records' })
const type = (text: string) => fireEvent.change(search(), { target: { value: text } })

describe('the records page', () => {
  it('lists each section\'s records under their day, newest day first and newest first within a day', async () => {
    renderPortal(<RecordsPage />, gateway(NOVU_RECORDS))
    await screen.findByText('emergency')
    const encounters = within(cardOf('Encounters'))
    expect(encounters.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual([dayLabel('2026-10-08'), dayLabel('2026-10-02')])
    const [newest, oldest] = encounters.getAllByRole('list')
    expect(within(newest!).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['emergency', 'inpatient'])
    expect(within(oldest!).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['ambulatory'])
    expect(within(cardOf('Clinical notes')).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual([dayLabel('2026-10-08'), dayLabel('2026-10-02')])
    // Imported history too, each record's title a level under its day.
    const imported = screen.getByRole('region', { name: 'Imported medical history' })
    expect(within(imported).getByRole('heading', { level: 3 }).textContent).toBe(dayLabel('2026-06-17'))
    expect(within(imported).getByRole('heading', { name: 'Preserved report', level: 4 })).toBeTruthy()
  })

  it('finds records by the words in a note, and says how many match', async () => {
    const { sent } = renderPortal(<RecordsPage />, gateway(NOVU_RECORDS))
    await screen.findByText('emergency')
    expect(screen.getByRole('search')).toBeTruthy()
    type('okafor')
    expect(screen.getByText('Chest pain review')).toBeTruthy()
    expect(screen.queryByText('Blood pressure follow-up in two weeks.')).toBeNull()
    expect(within(cardOf('Encounters')).getByText('No completed encounters match your search.')).toBeTruthy()
    expect(screen.getByText('No imported records match your search.')).toBeTruthy()
    expect(screen.getByText('1 record matches your search.').getAttribute('role')).toBe('status')
    // Nothing is sent for a search.
    expect(sent).toHaveLength(1)
  })

  it('finds records by type, title, date and imported details, with every word', async () => {
    renderPortal(<RecordsPage />, gateway(NOVU_RECORDS))
    await screen.findByText('emergency')
    type('encounter')
    expect(within(cardOf('Encounters')).getAllByRole('listitem')).toHaveLength(3)
    expect(within(cardOf('Clinical notes')).getByText('No signed clinical notes match your search.')).toBeTruthy()
    type('discharge')
    expect(within(cardOf('Clinical notes')).getAllByRole('listitem')).toHaveLength(1)
    type('original entry')
    expect(screen.getByRole('heading', { name: 'Preserved report' })).toBeTruthy()
    expect(screen.getByText('1 of the 1 imported record shown match your search.')).toBeTruthy()
    type('note okafor chest')
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
    type('okafor appendix')
    expect(screen.getByText('No records match your search.')).toBeTruthy()
    type('  ')
    expect(within(cardOf('Encounters')).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('heading', { name: 'Preserved report' })).toBeTruthy()
  })

  it('finds records by the words of the day they are listed under, as its heading names it', async () => {
    renderPortal(<RecordsPage />, gateway(NOVU_RECORDS))
    await screen.findByText('emergency')
    // Under "Thursday, 8 October 2026", where each record's own date reads "8 Oct 2026".
    type('Thursday October')
    expect(within(cardOf('Encounters')).getAllByRole('listitem').map(item => item.querySelector('strong')?.textContent)).toEqual(['emergency', 'inpatient'])
    expect(within(cardOf('Clinical notes')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('3 records match your search.')).toBeTruthy()
    // Imported history's day too: "Wednesday, 17 June 2026".
    type('June')
    expect(screen.getByRole('heading', { name: 'Preserved report' })).toBeTruthy()
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
  })

  it('counts the imported records it shows on a main-v1 build, where they are read beside the records', async () => {
    novu.on = false
    renderPortal(<RecordsPage />, mainGateway)
    await screen.findByText('Legacy malaria treatment')
    type('malaria')
    expect(screen.getByText('1 of the 1 imported record shown match your search.')).toBeTruthy()
    expect(screen.getByText('1 record matches your search.').getAttribute('role')).toBe('status')
    type('okafor')
    expect(screen.getByText('No imported records match your search.')).toBeTruthy()
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
    type('malaria okafor')
    expect(screen.getByText('No records match your search.')).toBeTruthy()
  })

  it('says a section was not shared, not that nothing matched, while a search is typed', async () => {
    novu.on = false
    renderPortal(<RecordsPage />, gateway({
      ...NOVU_RECORDS, importedRecords: undefined, vitals: [], diagnoses: [], labRequests: [], documents: [],
      prescriptions: [{ id: 'rx-1', encounterId: 'enc-new', facilityId: 'facility-1', medicationCodeSystem: null, medicationCode: null,
        medicationDisplay: 'Amlodipine', doseQuantity: 5, doseUnit: 'mg', routeCode: null, frequency: 'daily', instructions: 'With food',
        startsOn: '2026-10-08', endsOn: null, status: 'active' }],
      released: ['encounters', 'notes', 'prescriptions'], withheld: ['vitals', 'diagnoses', 'labRequests', 'documents'],
    }))
    await screen.findByText('Amlodipine')
    type('amlodipine')
    expect(within(cardOf('Prescriptions')).getByRole('heading', { level: 3 }).textContent).toBe(dayLabel('2026-10-08'))
    expect(within(cardOf('Vitals')).getByText('Not yet shared with patients in Health ID.')).toBeTruthy()
    expect(within(cardOf('Encounters')).getByText('No completed encounters match your search.')).toBeTruthy()
    expect(screen.getByText('1 record matches your search.')).toBeTruthy()
  })

  it('offers no search until the records are read', async () => {
    renderPortal(<RecordsPage />, () => problem(503, 'EHR_UNAVAILABLE', 'Records are unavailable.'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
  })
})
