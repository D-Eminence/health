import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createApiClient, HidApiError } from '@hid/http'
import { createRegisteredBrowserClient } from '@hid/api'
import { createPatientApi } from '../api'
import { ImportedHistorySharingCard, ImportedHistoryView, PatientImportedHistory, type ImportedHistoryLoad, type SharingApi } from '../ImportedHistoryPage'
import { parseImportedHistory, type ImportedHistoryPage, type ImportedMedicalRecord } from '../importedRecords'

/**
 * Imported legacy medical history as hid-system main serves it (#94, ADR-067; INTERFACE_CONTRACT.md, "Imported
 * legacy medical history"): `GET /ehr/me/imported-history` and `GET /ehr/patients/:patientId/imported-history`,
 * a page at a time, and the patient's sharing choice (`/identity/me/imported-history-sharing`). The staging
 * branches' `/imported-records` screen is ImportedHistory.test.tsx.
 */
const record = (n: number, over: Record<string, unknown> = {}) => ({
  id: `rec-${n}`, origin: 'provider-authored', title: `Legacy record ${n}`, category: 'medication', infoType: 'medication',
  createdAt: '2019-03-01T10:00:00.000Z', updatedAt: '2019-03-02T10:00:00.000Z', currentVersionId: `ver-${n}`,
  versions: [{ id: `ver-${n}`, versionNo: 1, origin: 'provider-authored', createdAt: '2019-03-01T10:00:00.000Z', record: `Text ${n} <b>not markup</b>`,
    notes: null, structuredData: null, transcriptionText: null }],
  versionsTruncated: false,
  files: [{ id: `file-${n}`, recordVersionId: `ver-${n}`, fileName: 'scan.pdf', mediaType: 'application/pdf', sizeBytes: 100, createdAt: '2019-03-01T10:00:00.000Z', accessStatus: 'pending-safety-verification' }],
  filesTruncated: false, ...over,
})
const wire = (records: unknown[], over: Record<string, unknown> = {}) => ({
  records, healthProfile: null, limits: { records: 50, versionsPerRecord: 20, filesPerRecord: 20 }, truncated: { records: false },
  nextCursor: null, provenance: 'legacy-import', ...over,
})
const page = (records: ImportedMedicalRecord[], over: Partial<ImportedHistoryPage> = {}): ImportedHistoryPage =>
  ({ records, limits: { records: 50, versionsPerRecord: 20, filesPerRecord: 20 }, moreRecords: false, nextCursor: null, ...over })
const patientPage = (...numbers: number[]) => parseImportedHistory(wire(numbers.map(n => record(n))), false)

describe('the answer', () => {
  it('reads a patient page and a staff page', () => {
    const own = parseImportedHistory(wire([record(1)], { truncated: { records: true }, nextCursor: 'cursor-abcdefghijklmnop' }), false)
    expect(own.records).toHaveLength(1)
    expect(own.moreRecords).toBe(true)
    expect(own.nextCursor).toBe('cursor-abcdefghijklmnop')
    expect(own.shared).toBeUndefined()
    expect(parseImportedHistory(wire([], { shared: false }), true).shared).toBe(false)
  })
  it.each([
    ['no records list', { ...wire([]), records: undefined }, false],
    ['a repeated record id', wire([record(1), record(1)]), false],
    ['a record with no versions list', wire([record(1, { versions: undefined })]), false],
    ['a file with an unknown access status', wire([record(1, { files: [{ id: 'f', createdAt: 'x', accessStatus: 'open' }] })]), false],
    ['no limits', { ...wire([]), limits: undefined }, false],
    ['a staff answer with no shared flag', wire([]), true],
  ])('rejects %s', (_name, value, staff) => {
    expect(() => parseImportedHistory(value, staff)).toThrow(/invalid response/)
  })
})

describe('the history', () => {
  it('shows records as text, with attachments pending safety verification and no download', async () => {
    const load = vi.fn<ImportedHistoryLoad>().mockResolvedValue(patientPage(1))
    render(<ImportedHistoryView load={load} audience="patient" />)
    expect(await screen.findByText('Legacy record 1')).toBeTruthy()
    expect(screen.getByText('Text 1 <b>not markup</b>')).toBeTruthy()
    expect(document.querySelector('.imported-history-card b')).toBeNull()
    expect(screen.getByText('Download pending safety verification.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(screen.getByText('Showing 1 imported record, newest first.')).toBeTruthy()
    expect(load).toHaveBeenCalledWith(null, expect.any(AbortSignal))
  })
  it('loads the next page with its cursor and adds it without repeating a record', async () => {
    const load = vi.fn<ImportedHistoryLoad>()
      .mockResolvedValueOnce(parseImportedHistory(wire([record(1), record(2)], { truncated: { records: true }, nextCursor: 'cursor-abcdefghijklmnop' }), false))
      .mockResolvedValueOnce(patientPage(2, 3))
    render(<ImportedHistoryView load={load} audience="patient" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more imported records' }))
    expect(await screen.findByText('Legacy record 3')).toBeTruthy()
    expect(load).toHaveBeenLastCalledWith('cursor-abcdefghijklmnop', expect.any(AbortSignal))
    expect(screen.getAllByText('Legacy record 2')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Show more imported records' })).toBeNull()
  })
  it('keeps what is shown and says so when the next page fails', async () => {
    const load = vi.fn<ImportedHistoryLoad>()
      .mockResolvedValueOnce(parseImportedHistory(wire([record(1)], { truncated: { records: true }, nextCursor: 'cursor-abcdefghijklmnop' }), false))
      .mockRejectedValueOnce(new HidApiError(400, 'Private', { code: 'INVALID_CURSOR' }))
    render(<ImportedHistoryView load={load} audience="patient" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more imported records' }))
    expect((await screen.findByRole('alert')).textContent).toContain('could not be read')
    expect(screen.getByText('Legacy record 1')).toBeTruthy()
  })
  it.each([
    ['off in hid-system (503 IMPORTED_HISTORY_DISABLED)', new HidApiError(503, 'Disabled', { code: 'IMPORTED_HISTORY_DISABLED' })],
    ['not served by this backend (404)', new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })],
  ])('shows nothing, and no error, when it is %s', async (_name, reason) => {
    const load = vi.fn<ImportedHistoryLoad>().mockRejectedValue(reason)
    const view = render(<ImportedHistoryView load={load} audience="patient" />)
    await waitFor(() => expect(screen.queryByText('Loading imported medical history…')).toBeNull())
    expect(view.container.textContent).toBe('')
  })
  it('says a real failure, and retries', async () => {
    const load = vi.fn<ImportedHistoryLoad>().mockRejectedValueOnce(new HidApiError(503, 'Private', { code: 'IMPORTED_HISTORY_UNAVAILABLE' })).mockResolvedValue(patientPage(1))
    render(<ImportedHistoryView load={load} audience="patient" />)
    expect((await screen.findByRole('alert')).textContent).toBe('Imported medical history could not be read right now. Please try again.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry imported history' }))
    expect(await screen.findByText('Legacy record 1')).toBeTruthy()
  })
  it.each([
    [403, 'CONSENT_REQUIRED', 'The patient has not given consent for this facility to read their record.'],
    [400, 'DIRECT_CARE_PURPOSE_REQUIRED', 'Imported medical history is read for direct care only.'],
    [403, 'BREAK_GLASS_EXCLUDED', 'Imported medical history is not shown under emergency access.'],
    [403, 'FORBIDDEN', 'You do not have access to this patient’s imported medical history.'],
  ])('tells staff why a read was refused (%s %s)', async (status, code, message) => {
    const load = vi.fn<ImportedHistoryLoad>().mockRejectedValue(new HidApiError(status, 'Private detail', { code }))
    render(<ImportedHistoryView load={load} audience="staff" />)
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.queryByText(/Private detail/)).toBeNull()
  })
  it('tells staff when the patient has not shared, with no record shown', async () => {
    const load = vi.fn<ImportedHistoryLoad>().mockResolvedValue(parseImportedHistory(wire([], { shared: false }), true))
    render(<ImportedHistoryView load={load} audience="staff" />)
    expect(await screen.findByText(/has not shared/)).toBeTruthy()
  })
})

describe('the sharing choice', () => {
  const sharing = (over: Partial<SharingApi> = {}): SharingApi => ({
    importedHistorySharing: vi.fn().mockResolvedValue({ shared: false, updatedAt: null }),
    setImportedHistorySharing: vi.fn().mockResolvedValue({ shared: true, changed: true, updatedAt: '2026-10-17T10:00:00.000Z' }), ...over })
  it('is off until the patient chooses, then shares, then stops', async () => {
    const api = sharing()
    render(<ImportedHistorySharingCard api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Share with staff who treat me' }))
    expect(await screen.findByText(/can now see your imported medical history/)).toBeTruthy()
    expect(api.setImportedHistorySharing).toHaveBeenCalledWith(true)
    vi.mocked(api.setImportedHistorySharing).mockResolvedValue({ shared: false, changed: true, updatedAt: '2026-10-17T10:05:00.000Z' })
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }))
    expect(await screen.findByText(/no longer see your imported medical history/)).toBeTruthy()
  })
  it.each([
    ['PATIENT_RECENT_AUTH_REQUIRED', 'Sharing needs a recent sign-in. Sign in again, then try again.'],
    ['PATIENT_RECENT_RECOVERY_HOLD', 'Sharing cannot be turned on in the 24 hours after you recover your account. Please try again later.'],
    ['IMPORTED_HISTORY_SHARING_DISABLED', 'Sharing imported medical history is not available yet.'],
  ])('says why turning sharing on was refused (%s) and keeps the choice off', async (code, message) => {
    const api = sharing({ setImportedHistorySharing: vi.fn().mockRejectedValue(new HidApiError(403, 'Private', { code })) })
    render(<ImportedHistorySharingCard api={api} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Share with staff who treat me' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.getByRole('button', { name: 'Share with staff who treat me' })).toBeTruthy()
  })
  it.each([
    ['its switch is off', new HidApiError(503, 'Off', { code: 'IMPORTED_HISTORY_SHARING_DISABLED' })],
    ['it is not served (404)', new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })],
  ])('is not shown when %s', async (_name, reason) => {
    const view = render(<ImportedHistorySharingCard api={sharing({ importedHistorySharing: vi.fn().mockRejectedValue(reason) })} />)
    await waitFor(() => expect(view.container.textContent).toBe(''))
  })
})

describe('through the registered cookie client', () => {
  it('reads a page with its cursor, and changes the sharing choice with the CSRF header', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      const body = path.endsWith('/imported-history-sharing') ? { shared: true, changed: true, updatedAt: '2026-10-17T10:00:00.000Z' } : wire([record(1)])
      return new Response(JSON.stringify(init?.method === 'POST' || path.endsWith('imported-history') ? body : {}), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    const transport = createApiClient({ baseUrl: 'https://staging.healthidentitydirectory.com', clientId: 'patient-web', sessionMode: 'cookie',
      getCsrfToken: () => 'synthetic-csrf-token', fetchImpl: fetchImpl as unknown as typeof fetch })
    const api = createPatientApi(createRegisteredBrowserClient(transport, 'patient-web'))
    const first = await api.importedHistory('cursor-abcdefghijklmnop')
    expect(first.records).toHaveLength(1)
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://staging.healthidentitydirectory.com/api/v1/ehr/me/imported-history?cursor=cursor-abcdefghijklmnop')
    expect(fetchImpl.mock.calls[0]?.[1]?.credentials).toBe('include')
    const change = await api.setImportedHistorySharing(true)
    expect(change).toEqual({ shared: true, changed: true, updatedAt: '2026-10-17T10:00:00.000Z' })
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ shared: true }) })
    expect(new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get('X-CSRF-Token')).toBe('synthetic-csrf-token')
  })
  it('mounts the history and the choice together for the patient', async () => {
    const api = { importedHistory: vi.fn().mockResolvedValue(patientPage(1)), importedHistorySharing: vi.fn().mockResolvedValue({ shared: false, updatedAt: null }),
      setImportedHistorySharing: vi.fn() }
    render(<PatientImportedHistory api={api} />)
    expect(await screen.findByText('Legacy record 1')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Share with staff who treat me' })).toBeTruthy()
  })
})

void page
