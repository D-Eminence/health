import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../kasuwa/toast'
import { PortalShell, RecordsPage } from '../routes/Portal'
import { forgetPatientEntriesServed } from '../patientEntriesServed'
import { json, problem, renderPortal, type Handler } from './portalHarness'
import { historyFixture } from './importedHistoryFixture'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

/**
 * The Records page's launch fixes (RN-01/HCS-02, RN-07, RN-08, RN-17, RN-19), on the production (Novu) records answer.
 * Fictional data only.
 */

const visit = (n: number, startedAt = `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00Z`) => ({
  id: `enc-${n}`, facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed', startedAt, endedAt: null })
const RECORDS = { encounters: [visit(1, '2026-10-08T10:00:00Z')], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }

function gateway(records: unknown): Handler {
  return (path, method) => path === '/ehr/me/records' && method === 'GET' ? json(records)
    : path === '/identity/me' ? json({ hid: 'HID-ABC234', fullName: 'Ada Example', firstName: 'Ada' })
    : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
}

const portal = (records: unknown, at = '/records') => renderPortal(<ToastProvider><Routes>
  <Route path="/" element={<PortalShell />}><Route path="records" element={<RecordsPage />} /></Route>
</Routes></ToastProvider>, gateway(records), {}, { at })

beforeEach(() => { forgetPatientEntriesServed() })

describe('Records launch fixes', () => {
  // An older ?add=record link still opens the drawer, as main intends: its Save is how the page learns (RecordsOwnEntries).
  it('RN-01/HCS-02: offers no "Add a record" where the backend does not keep patient records', async () => {
    portal(RECORDS)
    await screen.findByText('Outpatient visit')
    expect(screen.queryByRole('button', { name: 'Add a record' })).toBeNull()
  })

  it('RN-07: leaves out Older health records for a patient who has none, with one designed empty state', async () => {
    portal({ ...RECORDS, encounters: [] })
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Older health records' })).toBeNull()
    expect(screen.queryByText('No older records.')).toBeNull()
    expect(screen.queryByText(/old Health ID system/)).toBeNull()
    // The opening line names only what the page shows.
    expect(screen.queryByText(/older records/)).toBeNull()
  })

  it('RN-07: still shows Older health records to a patient who has some', async () => {
    portal({ ...RECORDS, importedRecords: historyFixture })
    expect(await screen.findByRole('heading', { name: 'Older health records' })).toBeTruthy()
  })

  it('RN-08: says only the newest are shown when a section comes back full, even without truncated flags', async () => {
    portal({ ...RECORDS, encounters: Array.from({ length: 50 }, (_, n) => visit(n)) })
    expect(await screen.findByText('Showing your 50 most recent visits; older ones are not shown.')).toBeTruthy()
  })

  it('RN-08: says nothing about older ones when a section is not full', async () => {
    portal(RECORDS)
    await screen.findByText('Outpatient visit')
    expect(screen.queryByText(/most recent/)).toBeNull()
  })

  it('RN-17: names each record button with its date, so two visits can be told apart', async () => {
    portal({ ...RECORDS, encounters: [visit(1, '2026-10-08T10:00:00Z'), visit(2, '2026-09-02T10:00:00Z')] })
    await screen.findAllByText('Outpatient visit')
    const names = screen.getAllByRole('button', { name: /^Outpatient visit/ }).map(button => button.textContent ?? '')
    expect(names).toHaveLength(2)
    expect(names[0]).toContain('8 Oct 2026')
    expect(names[1]).toMatch(/2 Sept? 2026/)
    expect(new Set(names).size).toBe(2)
  })

  it('RN-19: a search that finds nothing suggests only the kinds shown, and offers Clear search back to the field', async () => {
    portal(RECORDS)
    await screen.findByText('Outpatient visit')
    const search = screen.getByRole('searchbox', { name: 'Search your records' }) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'zzzz nothing' } })
    expect(await screen.findByText('Nothing matches')).toBeTruthy()
    expect(screen.queryByText(/vitals/)).toBeNull()
    expect(screen.getByText(/a type like “visit” or “note”/)).toBeTruthy()
    const clear = screen.getByRole('button', { name: 'Clear search' })
    clear.focus()
    await act(async () => { fireEvent.click(clear) })
    expect(search.value).toBe('')
    expect(document.activeElement).toBe(search)
    expect(screen.getByText('Outpatient visit')).toBeTruthy()
  })

  it('RN-19: a search that finds nothing offers Clear search when older records are shown too', async () => {
    portal({ ...RECORDS, importedRecords: historyFixture })
    await screen.findByRole('heading', { name: 'Older health records' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your records' }), { target: { value: 'zzzz nothing' } })
    expect(await screen.findByText('Nothing matches')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
  })

  it('RN-19: on one record type, a search that finds nothing says so once, with Clear search', async () => {
    portal(RECORDS, '/records?tab=encounters')
    await screen.findByText('Outpatient visit')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your records' }), { target: { value: 'zzzz nothing' } })
    expect(await screen.findByText('Nothing matches')).toBeTruthy()
    expect(screen.queryByText('None match your search.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
  })

  it('RN-19: on All, older records do not add a second "no match" line under Nothing matches', async () => {
    portal({ ...RECORDS, importedRecords: historyFixture })
    await screen.findByRole('heading', { name: 'Older health records' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your records' }), { target: { value: 'zzzz nothing' } })
    expect(await screen.findByText('Nothing matches')).toBeTruthy()
    expect(screen.queryByText('No older records match your search.')).toBeNull()
  })

  it('RN-19: on one record type, a search that matches only other types says so, with a way to all records', async () => {
    const note = { id: 'note-1', encounterId: 'enc-1', facilityId: 'facility-1', noteType: 'progress', title: 'Malaria review', status: 'signed', revisionNo: 1,
      content: 'Fictional note content.', signedAt: '2026-10-08T10:20:00Z' }
    portal({ ...RECORDS, notes: [note] }, '/records?tab=encounters')
    await screen.findByText('Outpatient visit')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search your records' }), { target: { value: 'malaria review' } })
    expect(await screen.findByText('Nothing matches here')).toBeTruthy()
    expect(screen.getByText('1 record of another type matches your search.')).toBeTruthy()
    expect(screen.queryByText('None match your search.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show all record types' })) })
    expect(await screen.findByText('Malaria review')).toBeTruthy()
    expect(screen.queryByText('Nothing matches here')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search your records' }))
  })
})
