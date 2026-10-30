import type * as ApiModuleNs from '../../api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { openVault, snapshotOf } from './offlineFixture'
import { setOfflineRuntimeForTests } from '../runtime'
import { ehrReads, forgetDeviceCopies } from '../ehrReads'

type ApiModule = typeof ApiModuleNs

/**
 * The clinical record with offline in use (Stream A's in-memory runtime, `@hid/offline/testing`): a note saved offline shows as a
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

/** A vault open at Demo Hospital, registered as the portal's runtime. */
async function vault() {
  const fake = await openVault(snapshotOf(FACILITY_ID))
  setOfflineRuntimeForTests(fake.runtime)
  return fake
}

/**
 * The reads the chart makes, made once online so this device keeps them (the grant comes with the lookup): the
 * second lookup is the one answered through the device, now that the patient is on it.
 */
async function keepChart() {
  await ehrReads.lookupPatient(FACILITY_ID, 'HID-ABCDEF23', 'direct-care')
  await ehrReads.lookupPatient(FACILITY_ID, 'HID-ABCDEF23', 'direct-care')
  await ehrReads.consentStatus(FACILITY_ID, PATIENT_ID)
  await ehrReads.encounters(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
  await ehrReads.records(FACILITY_ID, PATIENT_ID, 'enc-1', 'clinical-notes')
}

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
    const { controls } = await vault()
    await keepChart()
    controls.setConnectivity('offline')
    renderClinical()
    await writeNote('Follow-up note')

    const row = await screen.findByText('Not sent yet')
    const pending = row.closest('.offline-pending') as HTMLElement
    expect(within(pending).getByText('Clinical note')).toBeTruthy()
    expect(within(pending).getByText(/Saved on this device, not sent yet/)).toBeTruthy()
    expect(screen.getByText('Saved on this device. It will be sent when Health ID can be reached.')).toBeTruthy()
    expect(screen.queryByText('Clinical record saved by the backend.')).toBeNull()
    expect(api.createRecord).not.toHaveBeenCalled()
    const [saved] = controls.commands()
    expect(saved).toMatchObject({ op: 'ehr.note.create', state: 'queued', everSent: false, patientId: PATIENT_ID })
    expect(saved!.input).toMatchObject({ facilityId: FACILITY_ID, patientId: PATIENT_ID, encounter: { server: 'enc-1' },
      body: { noteType: 'Consultation', title: 'Follow-up note', status: 'draft', content: 'Chest clear. Review in a week.' } })
    expect(controls.requests).toEqual([])

    // Back online, it is sent once, with the body exactly as staffApi sends it, under its own key.
    controls.setConnectivity('online')
    await waitFor(() => expect(controls.commands()[0]!.state).toBe('applied'))
    expect(controls.requests).toHaveLength(1)
    expect(controls.requests[0]).toMatchObject({ method: 'POST', path: `/api/v1/ehr/patients/${PATIENT_ID}/encounters/enc-1/clinical-notes` })
    expect(JSON.parse(controls.requests[0]!.bodyText)).toEqual({ noteType: 'Consultation', title: 'Follow-up note', status: 'draft',
      content: 'Chest clear. Review in a week.' })
    expect(controls.requests[0]!.headers).toMatchObject({ 'X-Facility-ID': FACILITY_ID, 'X-Purpose-Of-Use': 'direct-care' })
  })

  it('shows a definitive first refusal online at the form’s fields, as today', async () => {
    const { controls } = await vault()
    controls.respondNext({ status: 400, code: 'VALIDATION_FAILED', body: { detail: 'The request is not valid.', code: 'VALIDATION_FAILED',
      errors: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] }] } })
    renderClinical()
    await writeNote('An over-long title')

    expect((await screen.findAllByText(/Title must be shorter than or equal to 240 characters/)).length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: /^Title/ }).getAttribute('aria-invalid')).toBe('true')
    // Nothing was kept: no pending row, and no command left on the device.
    expect(screen.queryByText('Not sent yet')).toBeNull()
    expect(controls.commands()).toEqual([])
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
  it('says when the chart is the copy saved on this device, and records the offline open', async () => {
    const { controls } = await vault()
    await keepChart()
    controls.setConnectivity('offline')
    renderClinical()
    expect(await screen.findByText(/^Saved copy from .* on this device$/)).toBeTruthy()
    expect(await screen.findByText('Cough')).toBeTruthy()
    expect(controls.auditEvents().some(event => event.action === 'ehr.record.read' && event.patientId === PATIENT_ID
      && event.section === 'encounters')).toBe(true)
  })

  it('never sends the emergency summary or its lookup through the device', async () => {
    staff.purpose = 'emergency'
    const { runtime, controls } = await vault()
    const read = vi.spyOn(runtime.reads, 'read')
    const grant = vi.spyOn(runtime.reads, 'setGrant')
    const remember = vi.spyOn(runtime, 'rememberPatient')
    api.lookupPatient.mockResolvedValue({ authorization: { decision: 'allow', breakGlass: true, consentGrantId: 'grant-9' },
      patient: { patientId: PATIENT_ID, hid: 'HID-ABCDEF23', fullName: 'Chidi Okafor' } })
    api.emergencyRecords.mockResolvedValue({ encounters: [], notes: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [] })
    renderClinical()
    await waitFor(() => expect(api.emergencyRecords).toHaveBeenCalled())
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, 'HID-ABCDEF23', 'emergency')
    expect(read).not.toHaveBeenCalled()
    expect(grant).not.toHaveBeenCalled()
    expect(remember).not.toHaveBeenCalled()
    expect(controls.cachedPatients()).toEqual([])
  })
})

describe('an active lab request stays online (A12.5)', () => {
  const LAB = ['ehr.lab-request.read', 'ehr.lab-request.write', 'lab.work-item.accept']
  beforeEach(() => { facility.permissions.push(...LAB) })
  afterEach(() => { facility.permissions.splice(facility.permissions.length - LAB.length, LAB.length) })

  async function labForm() {
    renderClinical()
    fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
    return await screen.findByRole('combobox', { name: /Request handling/ }) as HTMLSelectElement
  }
  const choices = (select: HTMLSelectElement) => [...select.options].map(option => option.value)

  it('online with a vault open, the form still offers an active request', async () => {
    await vault()
    expect(choices(await labForm())).toEqual(['draft', 'active'])
  })

  it('offline, the form offers a draft only', async () => {
    const { controls } = await vault()
    await keepChart()
    controls.setConnectivity('offline')
    expect(choices(await labForm())).toEqual(['draft'])
  })

  it('an active request is sent to Health ID directly, never kept on the device', async () => {
    const { controls } = await vault()
    const { ehrCommands } = await import('../ehrCommands')
    api.createRecord.mockResolvedValue({ id: 'lab-1', status: 'active', labHandoff: { state: 'accepted' } })
    const outcome = await ehrCommands.createRecord(FACILITY_ID, PATIENT_ID, 'enc-1', 'lab-requests', { status: 'active', testCode: '718-7' }, 'key-1')
    expect(outcome.kind).toBe('applied')
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'enc-1', 'lab-requests', { status: 'active', testCode: '718-7' }, 'key-1')
    expect(controls.commands()).toEqual([])
  })

  it('an active request for a visit saved on this device is refused, and a draft is kept', async () => {
    const { controls } = await vault()
    const { ehrCommands } = await import('../ehrCommands')
    await expect(ehrCommands.createRecord(FACILITY_ID, PATIENT_ID, 'local:visit-1', 'lab-requests', { status: 'active' }))
      .rejects.toThrow('An active lab request needs this visit to be on Health ID first.')
    expect(api.createRecord).not.toHaveBeenCalled()
    await ehrCommands.createRecord(FACILITY_ID, PATIENT_ID, 'enc-1', 'lab-requests', { status: 'draft', testCode: '718-7' })
    expect(controls.commands().map(command => command.op)).toEqual(['ehr.lab-request.create'])
  })
})

describe('a visit saved on this device becomes Health ID’s visit (A12.9)', () => {
  it('is replaced by the server visit as soon as its command is applied', async () => {
    const { runtime, controls } = await vault()
    await keepChart()
    controls.setConnectivity('offline')
    renderClinical()
    fireEvent.change(await screen.findByRole('combobox', { name: /Encounter type/ }), { target: { value: 'emergency' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Chief complaint/ }), { target: { value: 'Fall at home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start encounter' }))
    const pressed = await screen.findByRole('button', { name: 'Document this visit', pressed: true })
    expect(pressed).toBeTruthy()
    const [visit] = controls.commands()
    expect(visit).toMatchObject({ op: 'ehr.encounter.create' })

    // Health ID applies it: the runtime's receipt names the server visit (receiptFor, #39).
    const server = { ...encounter, id: 'enc-9', encounterType: 'emergency', chiefComplaint: 'Fall at home', rowVersion: 1 }
    api.encounter.mockResolvedValue(server)
    api.encounters.mockResolvedValue({ items: [server, encounter], nextCursor: null })
    Object.assign(runtime, { receiptFor: vi.fn(async (commandId: string) => commandId === visit!.id
      ? { commandId, resourceType: 'encounter', resourceId: 'enc-9', status: 201, replay: false, serverDate: '2026-10-30T08:00:00.000Z', via: 'response' }
      : null) })
    controls.setConnectivity('online')

    await waitFor(() => expect(api.encounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, 'enc-9'))
    const current = await screen.findByRole('button', { current: true })
    expect(current.textContent).toMatch(/emergency/)
    expect(screen.queryByRole('button', { name: 'Document this visit', pressed: true })).toBeNull()
  })
})
