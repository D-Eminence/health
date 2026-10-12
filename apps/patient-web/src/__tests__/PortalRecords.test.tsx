import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  render(<SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, createPatientApi(client))}><RecordsPage /></SessionContext.Provider>)
}

const empty = { encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], limit: 100 }
const upload = (sizeBytes: unknown, fileName = 'referral.pdf') => ({ id: fileName, encounterId: null, facilityId: 'facility-1', fileName,
  mediaType: 'application/pdf', sizeBytes, classification: 'phi', status: 'uploaded', createdAt: '2026-10-01T08:00:00.000Z' })

describe('patient record documents', () => {
  it('formats a size sent as a string, as pg sends a bigint', async () => {
    renderRecords({ ...empty, documents: [upload('1234567')] })
    expect((await screen.findByText('referral.pdf')).closest('li')?.textContent).toContain('1,234,567 bytes')
  })

  it('formats a size sent as a number the same way', async () => {
    renderRecords({ ...empty, documents: [upload(1234567)] })
    expect((await screen.findByText('referral.pdf')).closest('li')?.textContent).toContain('1,234,567 bytes')
  })

  it('says the size is unavailable when it is missing or not a number', async () => {
    renderRecords({ ...empty, documents: [upload(null), upload('not a size', 'scan.pdf')] })
    expect((await screen.findByText('referral.pdf')).closest('li')?.textContent).toContain('Size unavailable')
    expect(screen.getByText('scan.pdf').closest('li')?.textContent).toContain('Size unavailable')
  })
})
