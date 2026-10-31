import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type PatientRecords } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { RecordsPage } from '../routes/Portal'

/**
 * The patient's own record aggregate, GET /ehr/me/records (hid-system
 * patient-records.controller.ts). Each vitals entry carries every measurement
 * EHR holds (patient-records.service.ts): blood pressure, temperature, pulse,
 * respiratory rate, oxygen saturation, weight and height. Blood pressure is
 * stored as both values or neither (0004_ehr_clinical_records.sql).
 */
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

const empty: PatientRecords = { encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], limit: 100 }
const vital = (id: string, values: Partial<PatientRecords['vitals'][number]>): PatientRecords['vitals'][number] => ({
  id, encounterId: 'encounter-1', facilityId: 'facility-1', recordedAt: '2026-10-08T10:00:00Z', heightCm: null, weightKg: null,
  temperatureC: null, pulseBpm: null, respiratoryRate: null, systolicMmhg: null, diastolicMmhg: null, oxygenSaturationPercent: null,
  source: 'manual', ...values,
})

function renderRecords(records: PatientRecords) {
  return renderAnswering(async () => json(records))
}

function renderAnswering(answer: () => Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/api/v1/ehr/me/records'
    ? answer() : json({}, 404)) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  render(<MemoryRouter initialEntries={['/records']}><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><RecordsPage /></SessionContext.Provider></MemoryRouter>)
  return fetchImpl
}

/** A part of the record's card, by its heading. */
const card = (heading: string) => within(screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement)
/** Shows one part of the record, with its tab (All leaves out a part with nothing in it). */
async function showPart(tab: string) {
  const tabs = within(await screen.findByRole('navigation', { name: 'Record type' }))
  await act(async () => { fireEvent.click(tabs.getByRole('button', { name: new RegExp(`^${tab}\\d*$`) })) })
}
/** The page's opening line, under its heading. */
const intro = (heading: HTMLElement) => heading.parentElement!.nextElementSibling?.textContent ?? ''
const PARTS: ReadonlyArray<readonly [tab: string, title: string, none: string]> = [
  ['Visits', 'Visits', 'No completed visits yet.'], ['Notes', 'Clinical notes', 'No signed clinical notes yet.'],
  ['Vitals', 'Vitals', 'No vitals recorded yet.'], ['Diagnoses', 'Diagnoses', 'No diagnoses recorded.'],
  ['Medicines', 'Medicines', 'No medicines prescribed.'], ['Lab tests', 'Lab tests', 'No lab tests requested.'],
  ['Documents', 'Documents', 'No documents uploaded.'],
]

describe('patient health records', () => {
  it('shows every vital the record holds, with no entry reduced to a bare date or a leading separator', async () => {
    renderRecords({ ...empty, vitals: [
      vital('vital-bp', { systolicMmhg: 120, diastolicMmhg: 80 }),
      vital('vital-pulse', { pulseBpm: 72 }),
      vital('vital-all', { systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 37.2, pulseBpm: 70, respiratoryRate: 16,
        oxygenSaturationPercent: 98, weightKg: 70.5, heightCm: 172 }),
    ] })
    await screen.findByRole('heading', { name: 'Vitals' })
    const entries = card('Vitals').getAllByRole('listitem').map(item => item.querySelector('span > span')?.textContent)
    expect(entries).toEqual([
      'BP 120/80 mmHg',
      'Pulse 72 bpm',
      'BP 118/76 mmHg · Temp 37.2°C · Pulse 70 bpm · Respiratory rate 16 breaths/min · SpO₂ 98% · Weight 70.5 kg · Height 172 cm',
    ])
  })

  it('lists each part of the record it returns', async () => {
    renderRecords({
      encounters: [{ id: 'enc-1', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed', startedAt: '2026-10-08T10:00:00Z', endedAt: '2026-10-08T10:30:00Z' }],
      notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'facility-1', noteType: 'progress', title: 'Review', status: 'signed', revisionNo: 1, content: 'Doing well.', signedAt: '2026-10-08T10:20:00Z' }],
      vitals: [vital('vital-1', { temperatureC: 36.8 })],
      diagnoses: [{ id: 'dx-1', encounterId: 'enc-1', facilityId: 'facility-1', codeSystem: 'ICD-10', code: 'J06.9', display: 'Upper respiratory infection', clinicalStatus: 'active', verificationStatus: 'confirmed', onsetAt: null, abatementAt: null, notes: null }],
      prescriptions: [{ id: 'rx-1', encounterId: 'enc-1', facilityId: 'facility-1', medicationCodeSystem: null, medicationCode: null, medicationDisplay: 'Paracetamol', doseQuantity: 500, doseUnit: 'mg', routeCode: null, frequency: 'Every 8 hours', instructions: 'After meals', startsOn: null, endsOn: null, status: 'active' }],
      labRequests: [{ id: 'lab-1', encounterId: 'enc-1', facilityId: 'facility-1', testCodeSystem: 'LOINC', testCode: '718-7', testDisplay: 'Hemoglobin', priority: 'routine', status: 'active', specimenTypeCode: null, clinicalInformation: null, externalOrderReference: null, createdAt: '2026-10-08T10:10:00Z' }],
      documents: [{ id: 'doc-1', encounterId: 'enc-1', facilityId: 'facility-1', fileName: 'scan.pdf', mediaType: 'application/pdf', sizeBytes: 2048, classification: 'clinical', status: 'uploaded', createdAt: '2026-10-08T10:15:00Z' }],
      limit: 100,
    })
    expect(await screen.findByText('Ambulatory')).toBeTruthy()
    expect(card('Visits').getByText('Ambulatory')).toBeTruthy()
    expect(card('Clinical notes').getByText('Doing well.')).toBeTruthy()
    expect(card('Vitals').getByText('Temp 36.8°C')).toBeTruthy()
    expect(card('Diagnoses').getByText('Upper respiratory infection')).toBeTruthy()
    expect(card('Medicines').getByText('Paracetamol')).toBeTruthy()
    expect(card('Lab tests').getByText('Hemoglobin')).toBeTruthy()
    expect(card('Documents').getByText('scan.pdf')).toBeTruthy()
  })

  it('says so for each part of the record that holds nothing, from an EHR that names no withheld category', async () => {
    const fetchImpl = renderRecords(empty)
    expect(await screen.findByText('No records yet')).toBeTruthy()
    for (const [tab, title, none] of PARTS) {
      await showPart(tab)
      expect(card(title).getByText(none)).toBeTruthy()
      expect(screen.queryByText('Not shared with you yet.')).toBeNull()
    }
    // The page also asks for imported history (hid-system main, #94), a read of its own; the records are read once.
    expect((fetchImpl as unknown as { mock: { calls: Array<[RequestInfo | URL]> } }).mock.calls
      .filter(([url]) => new URL(String(url)).pathname === '/api/v1/ehr/me/records')).toHaveLength(1)
  })

  /**
   * hid-system #52 (patient-records.service.ts readSelf): only encounters and
   * signed notes are released to the patient. The other five arrays are always
   * empty and named in `withheld`, which means "not released to this caller",
   * never "no records" (INTERFACE_CONTRACT.md, Record summaries). Each released
   * section shows at most `limits[section]` rows and says in `truncated` whether
   * more exist.
   */
  const released: PatientRecords = {
    ...empty, released: ['encounters', 'notes'],
    withheld: ['vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents'],
    limits: { encounters: 50, notes: 50 }, truncated: { encounters: true, notes: false }, limit: 50,
  }

  it('says a withheld part of the record is not yet shared, never that it holds nothing', async () => {
    renderRecords(released)
    for (const [tab, title, none] of PARTS) {
      await showPart(tab)
      const withheld = !['Visits', 'Notes'].includes(tab)
      expect(card(title).queryByText(withheld ? none : 'Not shared with you yet.')).toBeNull()
      expect(card(title).getByText(withheld ? 'Not shared with you yet.' : none)).toBeTruthy()
    }
  })

  it('says when only the most recent encounters or notes are shown', async () => {
    renderRecords(released)
    await showPart('Visits')
    expect(card('Visits').getByText('Showing your 50 most recent visits; older ones are not shown.')).toBeTruthy()
    await showPart('Notes')
    expect(card('Clinical notes').queryByText(/most recent/)).toBeNull()
  })

  it('says when only the most recent signed notes are shown, and not for encounters that are all shown', async () => {
    renderRecords({ ...released, truncated: { encounters: false, notes: true } })
    await showPart('Notes')
    expect(card('Clinical notes').getByText('Showing your 50 most recent doctor’s notes; older ones are not shown.')).toBeTruthy()
    await showPart('Visits')
    expect(card('Visits').queryByText(/most recent/)).toBeNull()
  })

  // Until the record is read, nothing says what it holds: a withheld part may be among those named.
  it('names no part of the record while it is read', async () => {
    renderAnswering(() => new Promise<Response>(() => {}))
    const heading = await screen.findByRole('heading', { name: 'Records' })
    expect(intro(heading)).toBe('What your doctors and hospitals have shared with you.')
    expect(intro(heading)).not.toMatch(/vitals|diagnoses|prescriptions|medicines|lab|documents/i)
  })

  it('names no part of the record when it cannot be read', async () => {
    renderAnswering(async () => json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'EHR_UNAVAILABLE' }, 503))
    const heading = await screen.findByRole('heading', { name: 'Records' })
    await screen.findByRole('button', { name: /try again/i })
    expect(intro(heading)).not.toMatch(/vitals|diagnoses|prescriptions|medicines|lab|documents/i)
  })

  it('describes only the released parts of the record', async () => {
    renderRecords(released)
    expect(await screen.findByText('Your visits and doctor’s notes. Other parts aren’t shared with you yet.')).toBeTruthy()
    expect(screen.queryByText(/vital signs, diagnoses, prescriptions/)).toBeNull()
  })
})
