import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createApiClient } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createPatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { RecordsPage } from '../routes/Portal'
import { historyFixture } from './importedHistoryFixture'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))

describe('patient imported-record API integration', () => {
  it('renders imported history from the patient-self endpoint even with no encounters or clinical notes', async () => {
    const notServed = (input: RequestInfo | URL) => /imported-history/.test(String(input))
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => notServed(input) ? new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }) : new Response(JSON.stringify({ encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], importedRecords: historyFixture, limit: 50 }),
      { headers: { 'content-type': 'application/json' } }))
    const api = createPatientApi(createRegisteredBrowserClient(createApiClient({ baseUrl: 'https://gateway.test',
      clientId: 'patient-web', sessionMode: 'cookie', fetchImpl: fetchImpl as typeof fetch }), 'patient-web'))
    render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'synthetic-patient', appRole: 'patient', assuranceLevel: 'aal1' }, api)}>
      <RecordsPage /></SessionContext.Provider></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Older health records' })).toBeTruthy()
    expect(screen.getByText('Preserved report')).toBeTruthy()
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toContain('/api/v1/ehr/me/records')
    // An older backend does not serve main's imported-history route: the new section stays silent, and shows no second heading.
    expect(screen.getAllByRole('heading', { name: 'Older health records' })).toHaveLength(1)
  })
})
