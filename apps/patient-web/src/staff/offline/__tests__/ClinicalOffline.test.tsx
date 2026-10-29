import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { fakeRuntime } from './fakeRuntime'
import { setOfflineRuntimeForTests } from '../runtime'
import { forgetDeviceCopies } from '../ehrReads'

type ApiModule = typeof ApiModuleNs

/**
 * The clinical record with offline in use (a fake runtime of the frozen interface): a note saved offline shows as a
 * pending row, never as saved by the backend; a definitive first refusal reaches the form's fields as it does today;
 * a read answered from the device says so; and the emergency summary never goes near the device.
 */
const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const FACILITY_ID = '98d00002-0000-4000-8000-000000000001'
const PERMISSIONS = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write']
const facility = { id: FACILITY_ID, membershipId: 'member-1', organizationId: 'org-1', name: 'Demo Hospital', roles: ['clinician'],
  permissions: PERMISSIONS, isPrimary: true }
const encounter = { id: 'enc-1', patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-29T09:00:00.000Z', chiefComplaint: 'Cough', rowVersion: 1 }

const staff = vi.hoisted(() => ({ purpose: 'direct-care' as 'direct-care' | 'emergency' }))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', roles: [], permissions: [], facilities: [facility], facility } } },
    activePatient: { hid: 'HID-ABCDEF23', purpose: staff.purpose,
      lookup: { authorization: { decision: 'allow', consentGrantId: 'grant-1' }, patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } } },
    setActivePatient: () => true,
  }),
}))

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), consentStatus: vi.fn(), createRecord: vi.fn(),
  emergencyRecords: vi.fn(), reportedHealthProfile: vi.fn(),
}))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))

const { Clinical } = await import('../../routes/Clinical')

beforeEach(() => {
  staff.purpose = 'direct-care'
  for (const mock of Object.values(api)) mock.mockReset()
  api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow', consentGrantId: 'grant-1', scope: 'write_records' },
    patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })
  api.encounters.mockResolvedValue({ items: [encounter], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
})
afterEach(() => { setOfflineRuntimeForTests(undefined); forgetDeviceCopies() })

function renderClinical() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
}

async function writeNote(title: string) {
  fireEvent.change(await screen.findByRole('textbox', { name: /Note type/ }), { target: { value: 'Consultation' } })
  fireEvent.change(screen.getByRole('textbox', { name: /^Title/ }), { target: { value: title } })
  fireEvent.change(screen.getByRole('textbox', { name: /Clinical note/ }), { target: { value: 'Chest clear. Review in a week.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
}

describe('saving with offline in use', () => {
  it('shows a note saved offline as a pending row, not as saved by the backend', async () => {
    const runtime = fakeRuntime({ summary: { connectivity: 'offline' } })
    setOfflineRuntimeForTests(runtime)
    renderClinical()
    await writeNote('Follow-up note')

    const row = await screen.findByText('Not sent yet')
    const pending = row.closest('.offline-pending') as HTMLElement
    expect(within(pending).getByText('Clinical note')).toBeTruthy()
    expect(within(pending).getByText(/Saved on this device, not sent yet/)).toBeTruthy()
    expect(screen.getByText('Saved on this device. It will be sent when Health ID can be reached.')).toBeTruthy()
    expect(screen.queryByText('Clinical record saved by the backend.')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    expect(runtime.commands.save).toHaveBeenCalledWith('ehr.note.create', expect.objectContaining({
      facilityId: FACILITY_ID, patientId: PATIENT_ID, encounter: { server: 'enc-1' },
      body: { noteType: 'Consultation', title: 'Follow-up note', status: 'draft', content: 'Chest clear. Review in a week.' },
    }), { awaitMs: 8000 })
  })

  it('shows a definitive first refusal online at the form’s fields, as today', async () => {
    const runtime = fakeRuntime({ saveOutcome: async () => {
      // The runtime reports the 400 as a problem; the form reads it as the HidApiError it reads today.
      throw { status: 400, code: 'VALIDATION_FAILED', message: 'The request is not valid.',
        details: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] }] }
    } })
    setOfflineRuntimeForTests(runtime)
    renderClinical()
    await writeNote('An over-long title')

    expect((await screen.findAllByText(/Title must be shorter than or equal to 240 characters/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: /^Title/ }).getAttribute('aria-invalid')).toBe('true')
    // Nothing was kept: no pending row.
    expect(screen.queryByText('Not sent yet')).toBeNull()
  })

  it('without offline, a 400 is the staffApi refusal it always was', async () => {
    setOfflineRuntimeForTests(null)
    api.createRecord.mockRejectedValue(new HidApiError(400, 'The request is not valid.', { code: 'VALIDATION_FAILED',
      details: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] }] }))
    renderClinical()
    await writeNote('An over-long title')
    expect((await screen.findAllByText(/Title must be shorter than or equal to 240 characters/)).length).toBeGreaterThan(0)
    expect(api.createRecord).toHaveBeenCalledTimes(1)
  })
})

describe('reading with offline in use', () => {
  it('says when the chart is the copy saved on this device', async () => {
    const runtime = fakeRuntime({ offline: true, summary: { connectivity: 'offline' }, cache: {
      encounters: { value: { items: [encounter], nextCursor: null }, savedAt: '2026-10-29T09:42:00.000Z' },
    } })
    setOfflineRuntimeForTests(runtime)
    api.encounters.mockRejectedValue(new HidApiError(0, 'Network error', { code: 'NETWORK_ERROR' }))
    renderClinical()
    expect(await screen.findByText(/^Saved copy from .* on this device$/)).toBeTruthy()
    expect(runtime.audit.recordOpen).toHaveBeenCalledWith(PATIENT_ID, 'encounters')
  })

  it('never sends the emergency summary or its lookup through the device', async () => {
    staff.purpose = 'emergency'
    const runtime = fakeRuntime({})
    setOfflineRuntimeForTests(runtime)
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow', breakGlass: true, consentGrantId: 'grant-9' },
      patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })
    api.emergencyRecords.mockResolvedValue({ encounters: [], notes: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [] })
    renderClinical()
    await waitFor(() => expect(api.emergencyRecords).toHaveBeenCalled())
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, 'HID-ABCDEF23', 'emergency')
    expect(runtime.reads.read).not.toHaveBeenCalled()
    expect(runtime.reads.setGrant).not.toHaveBeenCalled()
    expect(runtime.reads.keepOffline).not.toHaveBeenCalled()
  })
})
