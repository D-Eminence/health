import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { MemoryRouter } from 'react-router-dom'
import { createPatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { RecordsPage } from '../routes/Portal'
import { historyFixture } from './importedHistoryFixture'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

// Exact aggregate keys from Novu PatientRecordsService.read: the five additional
// arrays in main-v1 are absent, including when there are no imported records.
const empty = { encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }
function show(value: unknown) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  }))
  const client = createRegisteredBrowserClient(createApiClient({ baseUrl: 'https://gateway.test',
    clientId: 'patient-web', sessionMode: 'cookie', fetchImpl }), 'patient-web')
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'synthetic-patient',
    appRole: 'patient', assuranceLevel: 'aal1' }, createPatientApi(client))}><RecordsPage /></SessionContext.Provider></MemoryRouter>)
  return fetchImpl
}

describe('Novu patient records contract', () => {
  it('renders the actual Novu aggregate without dereferencing absent main-v1 arrays', async () => {
    const fetchImpl = show({ ...empty, importedRecords: historyFixture,
      encounters: [{ id: 'enc-1', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed', startedAt: '2026-10-08T10:00:00Z', endedAt: null }],
      notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'facility-1', noteType: 'progress', title: 'Synthetic review', status: 'signed', revisionNo: 1, content: 'Synthetic note content.', signedAt: '2026-10-08T10:20:00Z' }],
    })
    expect(await screen.findByText('Preserved report')).toBeTruthy()
    expect(screen.getByText('Synthetic note content.')).toBeTruthy()
    expect(screen.getByText('Ambulatory')).toBeTruthy()
    expect(screen.getByText('Your visits, doctor’s notes and older records.')).toBeTruthy()
    for (const name of ['Vitals', 'Diagnoses', 'Medicines', 'Lab tests', 'Documents']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('keeps the page visible for an empty Novu record without claiming missing categories are empty', async () => {
    show(empty)
    // The redesign leaves an empty section out of All and says so once; the absent main-v1 sections are never called empty.
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(screen.getByText('No older records.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Records', level: 1 })).toBeTruthy()
    expect(screen.queryByText('No medicines prescribed.')).toBeNull()
    expect(screen.queryByRole('tab', { name: /Medicines/ })).toBeNull()
  })

  it('shows a load error for invalid imported records instead of blanking the page', async () => {
    show({ ...empty, importedRecords: [{}] })
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load your records')
    expect(screen.getByRole('heading', { name: 'Records', level: 1 })).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })
})
