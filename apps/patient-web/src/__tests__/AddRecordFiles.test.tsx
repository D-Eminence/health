import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../kasuwa/toast'
import { PortalShell, RecordsPage } from '../routes/Portal'
import { forgetPatientEntriesServed, patientEntriesServed, patientEntryFilesServed } from '../patientEntriesServed'
import { json, patientApi, press, problem, renderPortal, type Handler, type Sent } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

/**
 * Photos and files on their own switch (the coordinator's decision, 4 Nov; BACKEND-NEEDS.md §1 "Served or not"): the
 * records answer's `patientEntries` turns on text entries only, and uploads are offered only once that answer carries
 * `patientEntryFiles: true`. Without it the drawer shows no picker and sends no upload request. Fictional data only.
 */

const ENTRY_ID = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const ENTRIES = '/ehr/me/patient-entries'
const RECORDS = { encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }

function gateway(records: () => unknown): Handler {
  return (path, method) => path === '/ehr/me/records' && method === 'GET' ? json(records())
    : path === '/identity/me' ? json({ hid: 'HID-ABC234', fullName: 'Ada Example', firstName: 'Ada' })
    : path === '/identity/patient-enrollments/participating-facilities' ? json({ facilities: [], whatToBring: [] })
    : path === ENTRIES && method === 'POST' ? json({ entry: { id: ENTRY_ID } }, 201)
    : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
}

const portal = (records: () => unknown) => renderPortal(<ToastProvider><Routes>
  <Route path="/" element={<PortalShell />}><Route path="records" element={<RecordsPage />} /></Route>
</Routes></ToastProvider>, gateway(records), {}, { at: '/records' })

/** The + menu's "Add a record" item, as the sheet lists it (its label and hint). */
async function plusMenuAddItem() {
  await press(screen.getByRole('button', { name: 'Add or share' }))
  const items = within(screen.getByRole('dialog', { name: 'Add or share' })).getAllByRole('link').map(link => link.textContent ?? '')
  await press(screen.getByRole('button', { name: 'Add or share' }))
  return items.find(item => item.includes('Add a record'))
}

const entryRequests = (sent: Sent[]) => sent.filter(request => request.path.startsWith(ENTRIES)).map(request => `${request.method} ${request.path}`)

beforeEach(() => { forgetPatientEntriesServed() })

describe('the files switch, as api.records reads it', () => {
  it('is on only for patientEntryFiles exactly true, and stays on for the page’s life', async () => {
    let answer: unknown = { ...RECORDS, patientEntries: [] }
    const { api } = patientApi(() => json(answer))
    await api.records()
    expect(patientEntriesServed()).toBe(true)
    expect(patientEntryFilesServed()).toBe(false)
    for (const value of [false, 'true', 1, null, {}]) {
      answer = { ...RECORDS, patientEntries: [], patientEntryFiles: value }
      await api.records()
      expect(patientEntryFilesServed(), String(value)).toBe(false)
    }
    answer = { ...RECORDS, patientEntries: [], patientEntryFiles: true }
    await api.records()
    expect(patientEntryFilesServed()).toBe(true)
    // Nothing turns it off again: a later answer without it, or with false.
    answer = { ...RECORDS, patientEntries: [] }
    await api.records()
    answer = { ...RECORDS, patientEntries: [], patientEntryFiles: false }
    await api.records()
    expect(patientEntryFilesServed()).toBe(true)
    forgetPatientEntriesServed()
    expect(patientEntryFilesServed()).toBe(false)
  })

  it('is not turned on by a Save’s 201', async () => {
    const { api } = patientApi(() => json({ entry: { id: ENTRY_ID } }, 201))
    await api.addOwnRecord({ kind: 'visit', title: 'Check-up', facilityName: null, occurredOn: '2026-10-20', notes: null }, 'k')
    expect(patientEntriesServed()).toBe(true)
    expect(patientEntryFilesServed()).toBe(false)
  })
})

describe('"Add a record" with patientEntries but no patientEntryFiles', () => {
  it('offers text entries only: no photo or file picker, and the Save sends the entry alone', async () => {
    const { sent } = portal(() => ({ ...RECORDS, patientEntries: [] }))
    expect(await screen.findByText('No records yet')).toBeTruthy()
    // The page does not promise a photo.
    expect(screen.getByText(/You can add your own too, from any hospital\./)).toBeTruthy()
    expect(screen.queryByText(/photo of the paper/)).toBeNull()
    // Nor does the + menu's "Add a record".
    const item = await plusMenuAddItem()
    expect(item).toContain('A visit, result or medicine')
    expect(item).not.toMatch(/photo/i)

    await press(screen.getAllByRole('button', { name: 'Add a record' })[0]!)
    const drawer = screen.getByRole('dialog', { name: 'Add a record' })
    expect(within(drawer).queryByRole('button', { name: /Take a photo/ })).toBeNull()
    expect(within(drawer).queryByRole('button', { name: /Upload a file/ })).toBeNull()
    expect(drawer.querySelectorAll('input[type=file]')).toHaveLength(0)
    expect(within(drawer).queryByText(/photo/i)).toBeNull()
    expect(within(drawer).getByText('Notes')).toBeTruthy()

    fireEvent.change(within(drawer).getByLabelText('Name it'), { target: { value: 'Check-up at Lagos General' } })
    await press(within(drawer).getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    await waitFor(() => expect(entryRequests(sent)).toEqual([`POST ${ENTRIES}`]))
    expect(sent.some(request => request.path.includes('/documents/'))).toBe(false)
  })
})

describe('"Add a record" with patientEntries and patientEntryFiles: true', () => {
  it('offers the photo and file pickers, and says so on the page', async () => {
    portal(() => ({ ...RECORDS, patientEntries: [], patientEntryFiles: true }))
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(screen.getByText(/You can add your own too, from any hospital, with a photo of the paper\./)).toBeTruthy()
    expect(await plusMenuAddItem()).toContain('A visit, result or medicine, with a photo')
    await press(screen.getAllByRole('button', { name: 'Add a record' })[0]!)
    const drawer = screen.getByRole('dialog', { name: 'Add a record' })
    expect(within(drawer).getByRole('button', { name: /Take a photo/ })).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: /Upload a file/ })).toBeTruthy()
    expect(drawer.querySelectorAll('input[type=file]')).toHaveLength(2)
    expect(within(drawer).getByText('Photos and notes')).toBeTruthy()
  })
})
