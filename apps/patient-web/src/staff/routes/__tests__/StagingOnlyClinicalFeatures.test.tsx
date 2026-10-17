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
  api: { lookupPatient: vi.fn(), encounters: vi.fn(), consentStatus: vi.fn(), importedRecords: vi.fn(), patientChatHistory: vi.fn(),
    recordChatAvailability: vi.fn(), recordChatHistory: vi.fn() },
  // The member's permissions and the purpose of the open patient, which a test may change.
  permissions: ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read', 'ehr.record-chat.use'],
  purpose: 'direct-care',
}))
vi.mock('../../api', () => ({ staffApi: fixture.api,
  isAllowedPatientLookup: (value: { authorization: { decision: string } }) => value.authorization.decision === 'allow',
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))
vi.mock('../../App', () => ({ useStaff: () => ({
  state: { status: 'ready', session: { actor: { id: 'staff-a', facility: {
    id: 'facility-a', name: 'Test facility',
    permissions: fixture.permissions,
  } } } },
  activePatient: { hid: 'HID-TEST', purpose: fixture.purpose, lookup: fixture.patient },
  setActivePatient: vi.fn(),
}) }))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.api.lookupPatient.mockResolvedValue(fixture.patient)
  fixture.api.encounters.mockResolvedValue({ items: [], nextCursor: null })
  fixture.api.consentStatus.mockResolvedValue({ readAllowed: true, writeAllowed: false })
  fixture.api.importedRecords.mockResolvedValue({ importedRecords: historyFixture, limit: 50 })
  fixture.api.patientChatHistory.mockResolvedValue({ exchanges: [], retentionDays: 30, limit: 10 })
  fixture.api.recordChatAvailability.mockResolvedValue({ available: true, noticeVersion: 'n-1', historyLimit: 50, maxQuestionLength: 1000, released: ['notes'] })
  fixture.api.recordChatHistory.mockResolvedValue({ conversationId: null, exchanges: [], limit: 50 })
  fixture.permissions = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read', 'ehr.record-chat.use']
  fixture.purpose = 'direct-care'
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

  it('offers no patient assistant while the build leaves its flag off', async () => {
    await openChart()
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
    expect(screen.queryByRole('region', { name: /Record assistant/ })).toBeNull()
    expect(fixture.api.patientChatHistory).not.toHaveBeenCalled()
    expect(fixture.api.recordChatAvailability).not.toHaveBeenCalled()
    expect(fixture.api.recordChatHistory).not.toHaveBeenCalled()
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
  it('production Novu chart uses its existing read permission, imported records and scoped chat history', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    vi.stubEnv('VITE_HID_IMPORTED_RECORDS_ENABLED', 'true')
    vi.stubEnv('VITE_HID_STAFF_PATIENT_CHAT_ENABLED', 'true')
    fixture.permissions = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read']
    await openChart()
    expect(await screen.findByText('Preserved report')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this patient' }))
    await screen.findByLabelText('Your question')
    expect(fixture.api.patientChatHistory).toHaveBeenCalledWith('facility-a', 'patient-a', expect.any(AbortSignal))
    expect(fixture.api.importedRecords).toHaveBeenCalledWith('facility-a', 'patient-a', 'direct-care', expect.any(AbortSignal))
    expect(fixture.api.recordChatAvailability).not.toHaveBeenCalled()
    expect(fixture.api.recordChatHistory).not.toHaveBeenCalled()
  })

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
    // The served contract (ADR-069): availability and the member's own history, never the staging branch's routes.
    expect(fixture.api.recordChatAvailability).toHaveBeenCalledWith('facility-a', 'patient-a', expect.any(AbortSignal))
    expect(fixture.api.recordChatHistory).toHaveBeenCalledWith('facility-a', 'patient-a', expect.any(AbortSignal))
    expect(fixture.api.patientChatHistory).not.toHaveBeenCalled()
    expect(fixture.api.importedRecords).not.toHaveBeenCalled()
  })

  it('offers it only to a member holding ehr.record-chat.use, for direct care', async () => {
    vi.stubEnv('VITE_HID_STAFF_PATIENT_CHAT_ENABLED', 'true')
    fixture.permissions = ['ehr.encounter.read', 'ehr.note.read', 'ehr.document.read']
    await openChart()
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
  })

  it('offers it for no other purpose than direct care (never under break-glass)', async () => {
    vi.stubEnv('VITE_HID_STAFF_PATIENT_CHAT_ENABLED', 'true')
    fixture.purpose = 'emergency'
    // An emergency chart is not the direct-care chart; give it time to settle, then look for the assistant.
    render(<MemoryRouter><Clinical /></MemoryRouter>)
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(screen.queryByRole('button', { name: 'Ask about this patient' })).toBeNull()
    expect(fixture.api.recordChatAvailability).not.toHaveBeenCalled()
  })
})
