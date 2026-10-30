import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Json } from '@hid/offline'
import { openVault, PILOT, snapshotOf } from './offlineFixture'

type ApiModule = typeof ApiModuleNs

/** Re-review 6 (A12.6, §2.8): "Close access" on Access requests goes through the device like the patient page's. */
const api = vi.hoisted(() => ({ listAccessRequests: vi.fn(), closeGrant: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { displayName: 'Ada Clinician', facility: { id: PILOT, membershipId: 'member-1',
      name: 'Demo Hospital', roles: ['doctor'], permissions: ['identity.patient.read', 'identity.consent.write'] } } } },
    activePatient: null, setActivePatient: () => true, lock: null,
  }),
}))
vi.mock('../../session', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(),
  staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
const { setOfflineRuntimeForTests } = await import('../runtime')
const { AccessRequests } = await import('../../routes/AccessRequests')

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const GRANT = 'c0000000-0000-4000-8000-000000000001'
const request = { accessRequestId: 'b0000000-0000-4000-8000-000000000001', patientId: PATIENT, scope: 'write_records',
  purposeOfUse: 'direct-care', reason: 'Follow-up consultation', status: 'approved', requestedDurationMinutes: 480,
  requestedAt: '2026-10-30T08:00:00.000Z', consentGrantId: GRANT, grantExpiresAt: '2026-10-30T16:00:00.000Z', effectiveStatus: 'active' }

beforeEach(() => {
  api.listAccessRequests.mockReset().mockResolvedValue([request])
  api.closeGrant.mockReset().mockResolvedValue({})
})
afterEach(() => { setOfflineRuntimeForTests(undefined) })

describe('Close access on Access requests with offline in use', () => {
  it('waits for the patient’s unsent work: queued on the device, not sent ahead of it', async () => {
    const { runtime, controls } = await openVault(snapshotOf(PILOT))
    setOfflineRuntimeForTests(runtime)
    controls.setConnectivity('offline')
    await runtime.commands.save('ehr.prescription.create', { facilityId: PILOT, patientId: PATIENT, encounter: { server: 'enc-1' },
      body: { medicationDisplay: 'Amoxicillin 500 mg', frequency: 'twice a day', instructions: 'With food', status: 'draft' } } as unknown as Json,
      { awaitMs: 0 })
    render(<MemoryRouter><AccessRequests /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Close access' }))
    expect(await screen.findByText('The patient was removed from this device. Access is closed when Health ID can be reached.')).toBeTruthy()
    expect(api.closeGrant).not.toHaveBeenCalled()
    const close = controls.commands().find(command => command.op === 'identity.grant.close')
    expect(close).toBeTruthy()
    expect(close!.input).toMatchObject({ patientId: PATIENT, grantId: GRANT })
  })

  it('without offline, it is the staffApi close it always was', async () => {
    setOfflineRuntimeForTests(null)
    render(<MemoryRouter><AccessRequests /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Close access' }))
    await waitFor(() => expect(api.closeGrant).toHaveBeenCalledWith(PILOT, GRANT, 'Clinician closed completed patient access'))
    expect(await screen.findByText('Access was closed by the backend.')).toBeTruthy()
  })
})
