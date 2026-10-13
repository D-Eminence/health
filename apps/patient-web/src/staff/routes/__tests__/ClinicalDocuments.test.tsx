import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { Clinical } from '../Clinical'

/**
 * Clinical documents. EHR's document list sends size_bytes and row_version as
 * text (document.service.ts list), and a download answers { url,
 * expiresInSeconds } (s3-storage.provider.ts createDownload). The download URL
 * is opened in a new tab only when it is an https storage link, or plain http to
 * this machine in a local environment: a javascript: or data: URL from a faulty
 * backend or proxy would otherwise run with the portal's origin.
 */
const api = vi.hoisted(() => ({ lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), records: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn() }))
const environment = vi.hoisted(() => ({ name: 'production' }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: environment.name, apiBaseUrl: 'https://gateway.example.test' }) }))
vi.mock('../../session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'],
      permissions: ['ehr.encounter.read', 'ehr.document.read'],
    } } } },
    activePatient: { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup },
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, breakGlass: false } }
// As EHR's list sends it: size and version as text.
const listed = { id: 'document-1', patientId: PATIENT, encounterId: ENCOUNTER, fileName: 'referral.pdf', mediaType: 'application/pdf',
  sizeBytes: '20480', status: 'available', scanStatus: 'clean', version: '1', createdAt: '2026-10-10T09:05:00.000Z' }

let opened: MockInstance<typeof window.open>

beforeEach(() => {
  vi.clearAllMocks()
  environment.name = 'production'
  opened = vi.spyOn(window, 'open').mockReturnValue(null)
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1', encounterType: 'ambulatory',
    status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.documents.mockResolvedValue({ items: [listed] })
})
afterEach(() => { opened.mockRestore() })

async function openDocuments() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Documents' }))
  return screen.findByText('referral.pdf')
}

async function download(url: string) {
  api.documentDownload.mockResolvedValue({ url, expiresInSeconds: 60 })
  await openDocuments()
  fireEvent.click(screen.getByRole('button', { name: 'Open file' }))
  await waitFor(() => expect(api.documentDownload).toHaveBeenCalledWith('facility-1', 'document-1'))
}

describe('the document list', () => {
  it('reads a size EHR sends as text', async () => {
    const name = await openDocuments()
    expect(name.closest('.staff-list-item')?.textContent).toContain('20 KiB')
  })

  // hid-system #59: only the account that created an upload intent completes it, and there is no
  // delegated completion, so an intent left `initiated` is never scanned; the list still shows it.
  it('says an upload that was not completed will not be scanned, and to upload the file again', async () => {
    api.documents.mockResolvedValue({ items: [{ ...listed, status: 'initiated', scanStatus: null }] })
    const item = (await openDocuments()).closest<HTMLElement>('.staff-list-item')!
    expect(item.textContent).toContain('Upload not completed; only the person who started it can finish it. Upload the file again.')
    expect(item.textContent).not.toMatch(/scan: (pending|null)/)
    expect(screen.getByRole('button', { name: 'Open file' })).toHaveProperty('disabled', true)
  })
})

describe('opening a document checks the link first', () => {
  it('opens an https storage link', async () => {
    const link = 'https://storage.example.test/bucket/document-1?X-Amz-Signature=abc'
    await download(link)
    await waitFor(() => expect(opened).toHaveBeenCalledWith(link, '_blank', 'noopener,noreferrer'))
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://storage.example.test/bucket/document-1',
    'https://user:secret@storage.example.test/bucket/document-1',
    'not a url',
  ])('never opens %s, and says the document could not be opened', async url => {
    await download(url)
    expect((await screen.findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(opened).not.toHaveBeenCalled()
  })

  it('refuses plain http to this machine outside a local environment', async () => {
    await download('http://localhost:4566/bucket/document-1')
    expect((await screen.findByRole('alert')).textContent).toBe('Document could not be opened.')
    expect(opened).not.toHaveBeenCalled()
  })

  it('accepts plain http to this machine in a local environment, where storage runs without TLS', async () => {
    environment.name = 'local'
    await download('http://localhost:4566/bucket/document-1')
    await waitFor(() => expect(opened).toHaveBeenCalledWith('http://localhost:4566/bucket/document-1', '_blank', 'noopener,noreferrer'))
  })
})
