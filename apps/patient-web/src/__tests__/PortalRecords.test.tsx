import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { RecordsPage } from '../routes/Portal'

/**
 * EHR's patient record aggregate (GET /ehr/me/records) selects documents.size_bytes,
 * a bigint, without a cast, and pg returns a bigint as a string: the size must
 * be read as a number before it is formatted (EHR-DOCS-01).
 */
function json(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

function renderRecords(records: unknown) {
  const fetchImpl = vi.fn(async () => json(records)) as unknown as typeof fetch
  const client = createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web')
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, createPatientApi(client))}><RecordsPage /></SessionContext.Provider></MemoryRouter>)
}

// As an EHR before hid-system #52 answers, naming no withheld section: only such a
// build sends a patient documents. Since #52 documents are withheld from the
// patient (PatientRecords.test.tsx covers that answer).
const empty = { encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], limit: 100 }
const upload = (sizeBytes: unknown, fileName = 'referral.pdf') => ({ id: fileName, encounterId: null, facilityId: 'facility-1', fileName,
  mediaType: 'application/pdf', sizeBytes, classification: 'phi', status: 'uploaded', createdAt: '2026-10-01T08:00:00.000Z' })

/** What a document's row says under its name: its kind and size, as people read them. */
const meta = async (fileName: string) => (await screen.findByText(fileName)).nextElementSibling?.textContent

describe('patient record documents', () => {
  it('formats a size sent as a string, as pg sends a bigint', async () => {
    renderRecords({ ...empty, documents: [upload('1234567'), upload('20480', 'small.pdf')] })
    expect(await meta('referral.pdf')).toBe('PDF document · 1.2 MB')
    expect(await meta('small.pdf')).toBe('PDF document · 20 KB')
  })

  it('formats a size sent as a number the same way', async () => {
    renderRecords({ ...empty, documents: [upload(1234567), upload(20480, 'small.pdf')] })
    expect(await meta('referral.pdf')).toBe('PDF document · 1.2 MB')
    expect(await meta('small.pdf')).toBe('PDF document · 20 KB')
  })

  it('leaves the size out when it is missing or not a number, never a wrong one', async () => {
    renderRecords({ ...empty, documents: [upload(null), upload('not a size', 'scan.pdf')] })
    expect(await meta('referral.pdf')).toBe('PDF document')
    expect(await meta('scan.pdf')).toBe('PDF document')
    expect(document.body.textContent).not.toMatch(/NaN|undefined|null/)
  })
})

/** Owner, 2 November: a visit's kind and status in plain words, never the system's lower-case class ("ambulatory"). */
describe('patient record visits', () => {
  it('names the kind of visit and where it is in plain words', async () => {
    renderRecords({ ...empty, encounters: [
      { id: 'enc-1', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-01T08:00:00.000Z', endedAt: null },
      { id: 'enc-2', facilityId: 'facility-1', encounterType: 'IMP', status: 'finished', startedAt: '2026-09-01T08:00:00.000Z', endedAt: null },
    ], documents: [] })
    expect((await screen.findByText('Outpatient visit')).nextElementSibling?.textContent).toBe('In progress')
    expect((await screen.findByText('Inpatient stay')).nextElementSibling?.textContent).toBe('Finished')
    expect(document.body.textContent).not.toMatch(/ambulatory|Ambulatory|\bIMP\b/)
  })
})

/**
 * Owner rule (IDs on screen): a lab test or medicine shows its name, priority and status in plain words, in its row and
 * when opened; never its record, visit or facility id, its test code, its outside order reference, or the status word.
 */
describe('lab tests and medicines name no ids or codes', () => {
  const LAB_ID = 'd1111111-1111-4111-8111-111111111111'
  const VISIT_ID = 'e2222222-2222-4222-8222-222222222222'
  const FACILITY_ID = 'f3333333-3333-4333-8333-333333333333'
  const RX_ID = 'a4444444-4444-4444-8444-444444444444'
  const lab = (status: string) => ({ id: LAB_ID, encounterId: VISIT_ID, facilityId: FACILITY_ID, testCodeSystem: 'http://loinc.org',
    testCode: '58410-2', testDisplay: 'Full blood count', priority: 'routine', status, specimenTypeCode: 'BLDV',
    clinicalInformation: 'Tiredness for two weeks', externalOrderReference: 'EXT-ORDER-7731', createdAt: '2026-10-01T08:00:00.000Z' })
  const medicine = (status: string) => ({ id: RX_ID, encounterId: VISIT_ID, facilityId: FACILITY_ID, medicationDisplay: 'Paracetamol 500 mg',
    doseQuantity: 1, doseUnit: 'tablet', frequency: 'Three times daily', instructions: 'After food', status, startsOn: '2026-10-01' })
  const hidden = /d1111111|e2222222|f3333333|a4444444|58410-2|loinc|BLDV|EXT-ORDER-7731|\bactive\b|on-hold|entered-in-error/

  it('says a lab test’s priority and status in words, in its row and opened', async () => {
    renderRecords({ ...empty, labRequests: [lab('active')], documents: [] })
    const title = await screen.findByText('Full blood count')
    expect(title.nextElementSibling?.textContent).toBe('Routine · Requested')
    expect(document.body.textContent).not.toMatch(hidden)
    title.closest('button')!.click()
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(hidden)
  })

  it('names a lab test put on hold or entered by mistake in words', async () => {
    renderRecords({ ...empty, labRequests: [lab('on-hold'), { ...lab('entered-in-error'), id: 'd5555555-5555-4555-8555-555555555555', testDisplay: 'Malaria test' }], documents: [] })
    expect((await screen.findByText('Full blood count')).nextElementSibling?.textContent).toBe('Routine · On hold')
    expect((await screen.findByText('Malaria test')).nextElementSibling?.textContent).toBe('Routine · Entered by mistake')
    expect(document.body.textContent).not.toMatch(hidden)
  })

  it('says a medicine’s status in words', async () => {
    renderRecords({ ...empty, prescriptions: [medicine('active')], documents: [] })
    expect((await screen.findByText('Paracetamol 500 mg')).nextElementSibling?.textContent).toBe('1 tablet · Three times daily · Active')
    renderRecords({ ...empty, prescriptions: [{ ...medicine('entered-in-error'), medicationDisplay: 'Ibuprofen 200 mg' }], documents: [] })
    expect((await screen.findByText('Ibuprofen 200 mg')).nextElementSibling?.textContent).toBe('1 tablet · Three times daily · Entered by mistake')
    expect(document.body.textContent).not.toMatch(hidden)
  })
})
