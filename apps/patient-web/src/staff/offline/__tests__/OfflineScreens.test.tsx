import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PatientIndexEntry } from '@hid/offline'
import { fakeRuntime } from './fakeRuntime'

type ApiModule = typeof ApiModuleNs

const FACILITY_ID = '98d00002-0000-4000-8000-000000000001'
const api = vi.hoisted(() => ({ consentStatus: vi.fn(), encounters: vi.fn(), requestAccess: vi.fn(), uploadDocument: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const staff = vi.hoisted(() => ({ facilityId: '98d00002-0000-4000-8000-000000000001' }))
vi.mock('../../App', () => ({
  useStaff: () => {
    const facility = { id: staff.facilityId, membershipId: 'member-1', organizationId: 'org-1', name: 'Demo Hospital', roles: ['clinician'],
      permissions: ['identity.patient.read', 'identity.consent.write'], isPrimary: true }
    return { state: { status: 'ready', session: { actor: { id: 'staff-1', roles: [], permissions: [], facilities: [facility], facility } } },
      activePatient: null, setActivePatient: () => true }
  },
}))

const { setOfflineRuntimeForTests } = await import('../runtime')
const { setOfflineEnvironmentForTests } = await import('../environment')
const { OnThisDevice } = await import('../OnThisDevice')
const { CapturePage } = await import('../CapturePage')
const { Patients } = await import('../../routes/Patients')
const { indicatorState } = await import('../ConnectivityIndicator')

const entry = (patientId: string, displayName: string, hidCode: string, grantExpiresAt: string | null, pendingCount = 0): PatientIndexEntry =>
  ({ patientId, displayName, hidCode, lastOpenedAt: '2026-10-29T08:00:00.000Z', grantExpiresAt, pendingCount })
const PATIENTS = [
  entry('p-1', 'Chidi Okafor', 'HID-ABCDEF23', '2026-10-29T18:00:00.000Z', 2),
  entry('p-2', 'Ngozi Adeyemi', 'HID-QWERTY45', '2026-10-29T17:00:00.000Z'),
]

beforeEach(() => { for (const mock of Object.values(api)) mock.mockReset() })
afterEach(() => { setOfflineRuntimeForTests(undefined); setOfflineEnvironmentForTests(null) })

describe('On this device', () => {
  it('lists the patients kept here with access-until and pending counts, and searches on the device', async () => {
    const runtime = fakeRuntime({ patients: PATIENTS })
    const opened: string[] = []
    render(<OnThisDevice runtime={runtime} onOpen={item => opened.push(item.hidCode)} />)
    expect(await screen.findByText('Chidi Okafor', { selector: 'strong' })).toBeTruthy()
    expect(screen.getByText(/HID-ABCDEF23 · Access until .* · 2 waiting to send/)).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search patients on this device' }), { target: { value: 'ngozi' } })
    await waitFor(() => expect(screen.queryByText('Chidi Okafor', { selector: 'strong' })).toBeNull())
    expect(screen.getByText('Ngozi Adeyemi', { selector: 'strong' })).toBeTruthy()
    expect(runtime.patients.search).toHaveBeenLastCalledWith('ngozi')

    fireEvent.click(screen.getByRole('button', { name: 'Open Ngozi Adeyemi' }))
    expect(opened).toEqual(['HID-QWERTY45'])

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search patients on this device' }), { target: { value: 'nobody' } })
    expect(await screen.findByText('No patient on this device matches.')).toBeTruthy()
  })
})

describe('Migrate capture', () => {
  it('refuses a patient whose access does not allow writing', async () => {
    const runtime = fakeRuntime({ patients: PATIENTS })
    setOfflineRuntimeForTests(runtime)
    api.consentStatus.mockResolvedValue({ patientId: 'p-2', facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    render(<MemoryRouter><CapturePage runtime={runtime} facilityId={FACILITY_ID} /></MemoryRouter>)
    const picker = await screen.findByRole('combobox', { name: /Patient/ })
    await waitFor(() => expect(screen.getByRole('option', { name: /Ngozi Adeyemi/ })).toBeTruthy())
    fireEvent.change(picker, { target: { value: 'p-2' } })

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This patient’s access does not allow adding documents.')
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'page.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText(/Page or document/), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to upload' }))
    expect(runtime.commands.save).not.toHaveBeenCalled()
    expect(api.uploadDocument).not.toHaveBeenCalled()
    expect(screen.queryByRole('combobox', { name: 'Visit' })).toBeNull()
  })

  it('offers only patients whose access has not ended', async () => {
    const runtime = fakeRuntime({ patients: [...PATIENTS, entry('p-3', 'Ended Access', 'HID-ZXCVBN67', '2026-10-29T09:00:00.000Z')] })
    setOfflineRuntimeForTests(runtime)
    render(<MemoryRouter><CapturePage runtime={runtime} facilityId={FACILITY_ID} /></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('option', { name: /Chidi Okafor/ })).toBeTruthy())
    expect(screen.queryByRole('option', { name: /Ended Access/ })).toBeNull()
  })
})

describe('access request length (D4)', () => {
  async function send() {
    render(<MemoryRouter><Patients /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: /Health ID/ }), { target: { value: 'HID-ABCDEF23' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Clinical reason/ }), { target: { value: 'Follow-up of chest infection' } })
  }

  it('offers 1, 4, 8 or 12 hours at a pilot facility, 8 by default, and sends 480 minutes', async () => {
    setOfflineEnvironmentForTests({ mode: 'pilot', facilities: [FACILITY_ID] })
    api.requestAccess.mockResolvedValue({ accessRequestId: 'req-1', status: 'pending' })
    await send()
    const select = screen.getByRole('combobox', { name: 'Access for' }) as HTMLSelectElement
    expect([...select.options].map(option => option.textContent)).toEqual(['1 hour', '4 hours', '8 hours', '12 hours'])
    expect(select.value).toBe('480')
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith(FACILITY_ID, 'HID-ABCDEF23', 'read_records', 'Follow-up of chest infection', 480))
  })

  it('elsewhere shows no choice and sends 60 minutes, as today', async () => {
    staff.facilityId = '11111111-0000-4000-8000-000000000001'
    setOfflineEnvironmentForTests({ mode: 'pilot', facilities: [FACILITY_ID] })
    api.requestAccess.mockResolvedValue({ accessRequestId: 'req-1', status: 'pending' })
    await send()
    expect(screen.queryByRole('combobox', { name: 'Access for' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith('11111111-0000-4000-8000-000000000001', 'HID-ABCDEF23', 'read_records',
      'Follow-up of chest infection', 60))
    staff.facilityId = FACILITY_ID
  })

  it('with offline off in the build, sends 60 minutes and shows no choice', async () => {
    setOfflineEnvironmentForTests(null)
    api.requestAccess.mockResolvedValue({ accessRequestId: 'req-1', status: 'pending' })
    await send()
    expect(screen.queryByRole('combobox', { name: 'Access for' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith(FACILITY_ID, 'HID-ABCDEF23', 'read_records', 'Follow-up of chest infection', 60))
  })
})

describe('connectivity indicator', () => {
  const base = { connectivity: 'online', vault: 'unlocked', leaseUntil: null, clock: 'anchored', pending: 0, sending: 0, attention: 0,
    lastSyncAt: null, escrow: false, storage: { usageBytes: null, quotaBytes: null, persisted: true, low: false } } as const
  it.each([
    [{}, 'Online'], [{ connectivity: 'slow' }, 'Slow connection'], [{ connectivity: 'reconnecting' }, 'Reconnecting…'],
    [{ connectivity: 'offline' }, 'Offline'], [{ sending: 3 }, 'Sending 3 changes'], [{ attention: 1, connectivity: 'offline' }, '1 change needs attention'],
  ] as const)('%o reads “%s”', (change, text) => {
    expect(indicatorState({ ...base, ...change }).text).toBe(text)
  })
})
