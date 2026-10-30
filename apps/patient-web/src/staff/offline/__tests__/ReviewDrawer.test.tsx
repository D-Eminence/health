import type * as ApiModuleNs from '../../api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Json } from '@hid/offline'
import { openVault, PILOT, snapshotOf } from './offlineFixture'

type ApiModule = typeof ApiModuleNs

/**
 * The author's review of changes Health ID could not take as they were (OFFLINE-CONTRACT §2.9), with each class
 * produced by Stream A's in-memory runtime from the answers its fake server gives.
 */
const api = vi.hoisted(() => ({ records: vi.fn(), encounter: vi.fn(), reportedHealthProfile: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { ReviewDrawer } = await import('../ReviewDrawer')

const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const scope = { facilityId: PILOT, patientId: PATIENT_ID, encounter: { server: 'enc-1' } }
const lost = { status: null, networkError: true } as const

async function drawer(fake: Awaited<ReturnType<typeof openVault>>) {
  await fake.controls.flush()
  render(<MemoryRouter><ReviewDrawer runtime={fake.runtime} onClose={() => undefined} /></MemoryRouter>)
  expect(await screen.findByRole('dialog', { name: 'Changes that need your review' })).toBeTruthy()
}

beforeEach(() => { for (const mock of Object.values(api)) mock.mockReset() })

describe('review drawer', () => {
  it('412: shows your change and the current record side by side, with nothing preselected, and applies on top', async () => {
    api.records.mockResolvedValue({ items: [{ id: 'note-1', patientId: PATIENT_ID, encounterId: 'enc-1', createdAt: '2026-10-29T08:00:00.000Z',
      status: 'amended', title: 'Cough review', rowVersion: 3 }], nextCursor: null })
    const fake = await openVault(snapshotOf(PILOT))
    // Sent once with no answer, then refused as changed: the re-read finds the note amended, not signed (CC2).
    fake.controls.respondNext(lost, { status: 412, code: 'VERSION_CONFLICT' })
    const input = { ...scope, note: { server: 'note-1' }, body: { expectedRowVersion: 2, changeReason: 'Signed after review', status: 'signed' } }
    await fake.runtime.commands.save('ehr.note.update', input as unknown as Json, { awaitMs: 8000 })
    const resolve = vi.spyOn(fake.runtime.review, 'resolve')
    await drawer(fake)

    expect(await screen.findByText('Note status change: The record changed since you saw it')).toBeTruthy()
    const yours = screen.getByRole('heading', { name: 'Your change' }).parentElement as HTMLElement
    expect(await within(yours).findByText('signed')).toBeTruthy()
    const current = screen.getByRole('heading', { name: 'Current record' }).parentElement as HTMLElement
    expect(await within(current).findByText('amended')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(PILOT, PATIENT_ID, 'enc-1', 'clinical-notes', { cursor: undefined, fresh: true })
    // Nothing is chosen for the author.
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).checked).toBe(false)

    // A reason of fewer than 8 characters is refused; nothing is resolved.
    fireEvent.click(screen.getByRole('radio', { name: 'Apply my change on top' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter a reason of at least 8 characters.')
    expect(resolve).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Signed again after reading the amendment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Saved. It will be sent when Health ID can be reached.')
    // A new entry at the record's current version replaces the one refused.
    expect(resolve).toHaveBeenCalledWith(expect.any(String), 'apply-on-top', { reason: 'Signed again after reading the amendment',
      input: { ...input, body: { ...input.body, expectedRowVersion: 3 } } })
    await waitFor(() => expect(fake.controls.commands().some(command => command.state === 'discarded')).toBe(true))
  })

  it('412 on a vitals correction: your change shows the corrected readings', async () => {
    api.records.mockResolvedValue({ items: [{ id: 'vital-1', patientId: PATIENT_ID, encounterId: 'enc-1', createdAt: '2026-10-29T08:00:00.000Z',
      systolicMmhg: 120, diastolicMmhg: 80, rowVersion: 3 }], nextCursor: null })
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.respondNext(lost, { status: 412, code: 'VERSION_CONFLICT' })
    await fake.runtime.commands.save('ehr.vital.correct', { ...scope, vital: { server: 'vital-1' }, body: { expectedRowVersion: 2,
      changeReason: 'Repeat reading after rest', replacementValues: { systolicMmhg: 182, diastolicMmhg: 121 } } } as unknown as Json, { awaitMs: 8000 })
    await drawer(fake)
    const yours = (await screen.findByRole('heading', { name: 'Your change' })).parentElement as HTMLElement
    expect(await within(yours).findByText('182')).toBeTruthy()
    expect(within(yours).getByText('121')).toBeTruthy()
  })

  it('CC4: shows the new allergy beside the held prescription', async () => {
    api.records.mockResolvedValue({ items: [{ id: 'rx-1', patientId: PATIENT_ID, encounterId: 'enc-1', createdAt: '2026-10-29T09:00:00.000Z',
      medicationDisplay: 'Ibuprofen 400 mg', rowVersion: 1 }], nextCursor: null })
    api.reportedHealthProfile.mockResolvedValue({ bloodGroup: null, genotype: null, allergies: 'Penicillin (rash)',
      currentMedications: 'Metformin 500 mg', chronicConditions: null, medicalNotes: null, updatedAt: '2026-10-29T09:30:00.000Z' })
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.safetyChanged(true)
    await fake.runtime.commands.save('ehr.prescription.create', { ...scope, body: { medicationDisplay: 'Amoxicillin 500 mg',
      frequency: 'three times a day', instructions: 'With food', status: 'draft' } } as unknown as Json, { awaitMs: 8000 })
    await drawer(fake)

    expect(await screen.findByText('Prescription: Check before sending this prescription')).toBeTruthy()
    expect(await screen.findByText('Penicillin (rash)')).toBeTruthy()
    expect(screen.getByText('Metformin 500 mg')).toBeTruthy()
    expect(await screen.findByText('Amoxicillin 500 mg')).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(PILOT, PATIENT_ID)
    // The visit's prescriptions as Health ID has them now, read from the server visit.
    expect(screen.getByText('Ibuprofen 400 mg')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(PILOT, PATIENT_ID, 'enc-1', 'prescriptions')
    expect(screen.getByRole('radio', { name: 'Send as is (I have checked)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Discard' })).toBeTruthy()
    // Held before it was ever sent.
    expect(fake.controls.requests).toEqual([])
  })

  /** A prescription held for review (CC4) before it was ever sent. */
  async function heldPrescription() {
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.safetyChanged(true)
    await fake.runtime.commands.save('ehr.prescription.create', { ...scope, body: { medicationDisplay: 'Amoxicillin 500 mg',
      frequency: 'three times a day', instructions: 'With food', status: 'draft' } } as unknown as Json, { awaitMs: 8000 })
    await drawer(fake)
    await screen.findByText('Prescription: Check before sending this prescription')
    return fake
  }

  it('CC4: offers no "Send as is" while the current allergies and medications could not be read', async () => {
    api.reportedHealthProfile.mockRejectedValue(new Error('Failed to fetch'))
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    await heldPrescription()
    expect(await screen.findByText(/could not be read\. Try again when online\. Until they are read/)).toBeTruthy()
    expect(screen.queryByRole('radio', { name: 'Send as is (I have checked)' })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Discard' })).toBeTruthy()
    expect(screen.queryByText('No allergies or medications reported.')).toBeNull()
  })

  it('CC4: says when nothing is reported, and then offers "Send as is"', async () => {
    api.reportedHealthProfile.mockResolvedValue(null)
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    await heldPrescription()
    expect(await screen.findByText('No allergies or medications reported.')).toBeTruthy()
    expect(screen.getByText('No prescriptions on Health ID for this visit.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Send as is (I have checked)' })).toBeTruthy()
    expect(screen.queryByText('The current record could not be read. Try again when online.')).toBeNull()
  })

  it('CC4: an empty profile reads as nothing reported, not as a failed read', async () => {
    api.reportedHealthProfile.mockResolvedValue({ bloodGroup: null, genotype: null, allergies: '  ', currentMedications: null,
      chronicConditions: null, medicalNotes: null, updatedAt: null })
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    await heldPrescription()
    expect(await screen.findByText('No allergies or medications reported.')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Send as is (I have checked)' })).toBeTruthy()
  })

  /** A visit saved offline, then a prescription on it, held for review once the visit reached Health ID. */
  async function heldOnLocalVisit(receiptFor: (commandId: string) => Promise<unknown>) {
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.safetyChanged(true)
    const visit = await fake.runtime.commands.save('ehr.encounter.create', { facilityId: PILOT, patientId: PATIENT_ID, localId: 'v1',
      body: { encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T09:00:00.000Z', chiefComplaint: 'Cough' } } as unknown as Json,
      { awaitMs: 0 })
    if (visit.kind !== 'saved') throw new Error('expected the visit saved on the device')
    await fake.runtime.commands.save('ehr.prescription.create', { facilityId: PILOT, patientId: PATIENT_ID, encounter: { local: visit.commandId },
      body: { medicationDisplay: 'Amoxicillin 500 mg', frequency: 'three times a day', instructions: 'With food', status: 'draft' } } as unknown as Json,
      { awaitMs: 0 })
    Object.assign(fake.runtime, { receiptFor: vi.fn(receiptFor) })
    await drawer(fake)
    await screen.findByText('Prescription: Check before sending this prescription')
    return visit.commandId
  }

  it('CC4 on a visit saved offline: reads the prescriptions of the visit Health ID made of it (re-review 3)', async () => {
    api.reportedHealthProfile.mockResolvedValue(null)
    api.records.mockResolvedValue({ items: [{ id: 'rx-9', patientId: PATIENT_ID, encounterId: 'enc-9', createdAt: '2026-10-30T09:30:00.000Z',
      medicationDisplay: 'Co-amoxiclav 625 mg', rowVersion: 1 }], nextCursor: null })
    const visit = await heldOnLocalVisit(async commandId => ({ commandId, resourceType: 'encounter', resourceId: 'enc-9', status: 201,
      replay: false, serverDate: '2026-10-30T09:10:00.000Z', via: 'response' }))
    expect(await screen.findByText('Co-amoxiclav 625 mg')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(PILOT, PATIENT_ID, 'enc-9', 'prescriptions')
    expect(screen.queryByText('No prescriptions on Health ID for this visit.')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Send as is (I have checked)' })).toBeTruthy()
    expect(visit).toBeTruthy()
  })

  it('CC4 on a visit saved offline whose server visit is not known: says it could not read, and offers no "Send as is"', async () => {
    api.reportedHealthProfile.mockResolvedValue(null)
    api.records.mockResolvedValue({ items: [], nextCursor: null })
    await heldOnLocalVisit(async () => null)
    expect(await screen.findByText(/could not be read\. Try again when online\./)).toBeTruthy()
    expect(screen.queryByText('No prescriptions on Health ID for this visit.')).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Send as is (I have checked)' })).toBeNull()
    expect(api.records).not.toHaveBeenCalled()
  })

  it('CC5: asking for access again keeps the change and leads to patient access', async () => {
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.respondNext(lost)
    fake.controls.forbidNext({ code: 'CONSENT_REQUIRED' })
    await fake.runtime.commands.save('ehr.note.create', { ...scope, body: { title: 'Ward round', content: 'Stable' } } as unknown as Json,
      { awaitMs: 8000 })
    const resolve = vi.spyOn(fake.runtime.review, 'resolve')
    await drawer(fake)

    expect(await screen.findByText('Clinical note: Access to this patient ended')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Ask for access again' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Patient still on the ward' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Kept on this device until access is approved.')).toBeTruthy()
    expect(resolve).toHaveBeenCalledWith(expect.any(String), 'ask-access', { reason: 'Patient still on the ward' })
    expect(screen.getByRole('link', { name: 'Patient access' }).getAttribute('href')).toBe('/provider/patients')
    expect(fake.controls.commands()[0]!.state).toBe('held_access')
  })

  it('CC1 offers no action: the change waits for confirmation', async () => {
    const fake = await openVault(snapshotOf(PILOT))
    fake.controls.receiptsUnreachable(true)
    fake.controls.respondNext(lost)
    fake.controls.forbidNext({ code: 'CONSENT_REQUIRED' })
    await fake.runtime.commands.save('ehr.vital.create', { ...scope, body: { pulseBpm: 80 } } as unknown as Json, { awaitMs: 8000 })
    await drawer(fake)
    expect(await screen.findByText('Health ID has not confirmed this change yet. Don’t enter it again.')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
