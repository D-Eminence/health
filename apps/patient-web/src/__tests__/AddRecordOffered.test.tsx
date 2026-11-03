import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../kasuwa/toast'
import { PortalShell, RecordsPage } from '../routes/Portal'
import { forgetPatientEntriesServed } from '../patientEntriesServed'
import { json, press, problem, renderPortal, type Handler } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'production' }) }))

/**
 * "Add a record" is offered only once the backend serves the records a patient adds (patientEntriesServed.ts): the +
 * menu, the Records page's button and its empty page's button. Today's backend does not, so a patient is never offered
 * a Save that can only be refused. Fictional data only.
 */

const RECORDS = { encounters: [{ id: 'enc-1', facilityId: 'facility-1', encounterType: 'ambulatory', status: 'completed',
  startedAt: '2026-10-08T10:00:00Z', endedAt: null }], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }
const NO_RECORDS = { ...RECORDS, encounters: [] }

function gateway(records: unknown): Handler {
  return (path, method) => path === '/ehr/me/records' && method === 'GET' ? json(records)
    : path === '/identity/me' ? json({ hid: 'HID-ABC234', fullName: 'Ada Example', firstName: 'Ada' })
    : problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
}

const portal = (records: unknown) => renderPortal(<ToastProvider><Routes>
  <Route path="/" element={<PortalShell />}><Route path="records" element={<RecordsPage />} /></Route>
</Routes></ToastProvider>, gateway(records), {}, { at: '/records' })

/** The + menu's items, as the sheet lists them. */
async function plusMenu() {
  await press(screen.getByRole('button', { name: 'Add or share' }))
  return within(screen.getByRole('dialog', { name: 'Add or share' })).getAllByRole('link').map(link => link.textContent ?? '')
}

beforeEach(() => { forgetPatientEntriesServed() })

describe('"Add a record" where the backend does not serve it (today’s)', () => {
  it('is not on the Records page or in the + menu', async () => {
    portal(RECORDS)
    await screen.findByText('Outpatient visit')
    expect(screen.queryByRole('button', { name: 'Add a record' })).toBeNull()
    const items = await plusMenu()
    expect(items.some(item => item.includes('Add a record'))).toBe(false)
    expect(items.some(item => item.includes('Share my records'))).toBe(true)
  })

  it('is not on the empty Records page, which does not offer to add one either', async () => {
    portal(NO_RECORDS)
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add a record' })).toBeNull()
    expect(screen.queryByText(/add your own/i)).toBeNull()
    expect(screen.getByText('Records from your providers appear here.')).toBeTruthy()
  })
})

describe('"Add a record" once the backend serves it', () => {
  it('is on the Records page and first in the + menu', async () => {
    portal({ ...RECORDS, patientEntries: [] })
    await screen.findByText('Outpatient visit')
    expect(await screen.findByRole('button', { name: 'Add a record' })).toBeTruthy()
    const items = await plusMenu()
    expect(items[0]).toContain('Add a record')
  })

  it('is on the empty Records page, with the line that says a patient can add their own', async () => {
    portal({ ...NO_RECORDS, patientEntries: [] })
    expect(await screen.findByText('No records yet')).toBeTruthy()
    expect(screen.getByText(/You can add your own too/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Add a record' })).toHaveLength(2)
  })
})
