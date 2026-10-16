import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createApiClient } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createPatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { RecordsPage } from '../routes/Portal'
import { historyFixture } from './importedHistoryFixture'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))

describe('patient imported-record API integration', () => {
  it('renders imported history from the patient-self endpoint even with no encounters or clinical notes', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], importedRecords: historyFixture, limit: 50 }),
      { headers: { 'content-type': 'application/json' } }))
    const api = createPatientApi(createRegisteredBrowserClient(createApiClient({ baseUrl: 'https://gateway.test',
      clientId: 'patient-web', sessionMode: 'cookie', fetchImpl: fetchImpl as typeof fetch }), 'patient-web'))
    render(<SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'synthetic-patient', appRole: 'patient', assuranceLevel: 'aal1' }, api)}>
      <RecordsPage /></SessionContext.Provider>)
    expect(await screen.findByRole('heading', { name: 'Imported medical history' })).toBeTruthy()
    expect(screen.getByText('Preserved report')).toBeTruthy()
    expect(new URL(String(fetchImpl.mock.calls[0]![0])).pathname).toBe('/api/v1/ehr/me/records')
  })
})
