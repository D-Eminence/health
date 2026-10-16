import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Clinical } from '../Clinical'
import { historyFixture } from '../../../__tests__/importedHistoryFixture'

/**
 * Imported medical history and "Ask about this patient" came with Health-id
 * #61 from hid-system's staging branches. hid-system main serves neither
 * GET /ehr/patients/:id/imported-records nor /ehr/patients/:id/chat*, so on a
 * production chart ehr-api answered 404 NOT_FOUND and the page showed
 * "Cannot GET /api/v1/ehr/patients/<id>/imported-records" in an alert, and an
 * assistant whose history could never load. Each is now mounted only when the
 * build turns it on (VITE_HID_IMPORTED_RECORDS_ENABLED,
 * VITE_HID_STAFF_PATIENT_CHAT_ENABLED), which no launch build does.
 */
const fixture = vi.hoisted(() => ({
  patient: { authorization: { decision: 'allow' }, patient: { patientId: 'patient-a', hid: 'HID-TEST', fullName: 'Test patient' } },
  api: { lookupPatient: vi.fn(), encounters: vi.fn(), consentStatus: vi.fn(), importedRecords: vi.fn(), patientChatHistory: vi.fn() },
}))
vi.mock('../../api', () => ({ staffApi: fixture.api,
  isAllowedPatientLookup: (value: { authorization: { decision: string } }) => value.authorization.decision === 'allow',
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))
vi.mock('../../App', () => ({ useStaff: () => ({
  state: { status: 'ready', session: { actor: { id: 'staff-a', facility: {
    id: 'facility-a', name: 'Test facility',
    permissions: ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read'],
  } } } },
  activePatient: { hid: 'HID-TEST', purpose: 'direct-care', lookup: fixture.patient },
  setActivePatient: vi.fn(),
}) }))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.api.lookupPatient.mockResolvedValue(fixture.patient)
  fixture.api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  fixture.api.consentStatus.mockResolvedValue({ readAllowed: true, writeAllowed: false })
  fixture.api.importedRecords.mockResolvedValue({ importedRecords: historyFixture, limit: 50 })
  fixture.api.patientChatHistory.mockResolvedValue({ exchanges: [], retentionDays: 30, limit: 10 })
})
afterEach(() => { vi.unstubAllEnvs() })

async function openChart() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  await screen.findByText('No encounters are available for this patient and facility.')
}

describe('a chart built for hid-system main (no flags set)', () => {
  it('requests no imported history and shows none, so no raw 404 reaches the page', async () => {
    await openChart()
    expect(fixture.api.importedRecords).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Imported medical history' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry imported history' })).toBeNull()
    expect(screen.queryByText('Loading imported medical history…')).toBeNull()
  })

  it('offers no patient assistant, whose routes main does not serve', async () => {
    await openChart()
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
    expect(screen.queryByRole('region', { name: /Record assistant/ })).toBeNull()
    expect(fixture.api.patientChatHistory).not.toHaveBeenCalled()
  })

  it.each(['false', '1', 'yes', ''])('keeps both off for a flag value of %j', async value => {
    vi.stubEnv('VITE_HID_IMPORTED_RECORDS_ENABLED', value)
    vi.stubEnv('VITE_HID_STAFF_PATIENT_CHAT_ENABLED', value)
    await openChart()
    expect(fixture.api.importedRecords).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
  })
})

describe('a chart built for a backend that serves them (flags set to true)', () => {
  it('shows imported history when VITE_HID_IMPORTED_RECORDS_ENABLED is true', async () => {
    vi.stubEnv('VITE_HID_IMPORTED_RECORDS_ENABLED', 'true')
    await openChart()
    expect(await screen.findByText('Preserved report')).toBeTruthy()
    expect(fixture.api.importedRecords).toHaveBeenCalledWith('facility-a', 'patient-a', 'direct-care', expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
  })

  it('offers the patient assistant when VITE_HID_STAFF_PATIENT_CHAT_ENABLED is true', async () => {
    vi.stubEnv('VITE_HID_STAFF_PATIENT_CHAT_ENABLED', 'true')
    await openChart()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this patient' }))
    await screen.findByLabelText('Your question')
    expect(fixture.api.patientChatHistory).toHaveBeenCalledWith('facility-a', 'patient-a', expect.any(AbortSignal))
    expect(fixture.api.importedRecords).not.toHaveBeenCalled()
  })
})
