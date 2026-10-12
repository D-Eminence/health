import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).pathname === '/api/v1/ehr/me/records'
    ? json(records) : json({}, 404)) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  render(<SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><RecordsPage /></SessionContext.Provider>)
  return fetchImpl
}

const card = (heading: string) => within(screen.getByRole('heading', { name: heading }).closest('.patient-card') as HTMLElement)

describe('patient health records', () => {
  it('shows every vital the record holds, with no entry reduced to a bare date or a leading separator', async () => {
    renderRecords({ ...empty, vitals: [
      vital('vital-bp', { systolicMmhg: 120, diastolicMmhg: 80 }),
      vital('vital-pulse', { pulseBpm: 72 }),
      vital('vital-all', { systolicMmhg: 118, diastolicMmhg: 76, temperatureC: 37.2, pulseBpm: 70, respiratoryRate: 16,
        oxygenSaturationPercent: 98, weightKg: 70.5, heightCm: 172 }),
    ] })
    await screen.findByRole('heading', { name: 'Vitals' })
    const entries = card('Vitals').getAllByRole('listitem').map(item => item.querySelector('span')?.textContent)
    expect(entries).toEqual([
      'BP 120/80 mmHg',
      'Pulse 72',
      'BP 118/76 mmHg · Temp 37.2°C · Pulse 70 · Respiratory rate 16 · SpO₂ 98% · Weight 70.5 kg · Height 172 cm',
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
    expect(await screen.findByText('ambulatory')).toBeTruthy()
    expect(card('Clinical notes').getByText('Doing well.')).toBeTruthy()
    expect(card('Vitals').getByText('Temp 36.8°C')).toBeTruthy()
    expect(card('Diagnoses').getByText('Upper respiratory infection')).toBeTruthy()
    expect(card('Prescriptions').getByText('Paracetamol')).toBeTruthy()
    expect(card('Laboratory requests').getByText('Hemoglobin')).toBeTruthy()
    expect(card('Clinical documents').getByText('scan.pdf')).toBeTruthy()
  })

  it('says so for each part of the record that holds nothing', async () => {
    const fetchImpl = renderRecords(empty)
    expect(await screen.findByText('No completed encounters are available.')).toBeTruthy()
    for (const text of ['No signed clinical notes are available.', 'No vitals are available.', 'No diagnoses are available.',
      'No prescriptions are available.', 'No laboratory requests are available.', 'No clinical documents are available.']) {
      expect(screen.getByText(text)).toBeTruthy()
    }
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
