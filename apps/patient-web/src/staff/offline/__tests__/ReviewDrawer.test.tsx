import type * as ApiModuleNs from '../../api'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { PendingView } from '@hid/offline'
import { fakeRuntime } from './fakeRuntime'

type ApiModule = typeof ApiModuleNs

/** The author's review of changes Health ID could not take as they were (OFFLINE-CONTRACT §2.9). */
const api = vi.hoisted(() => ({ records: vi.fn(), encounter: vi.fn(), reportedHealthProfile: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { ReviewDrawer } = await import('../ReviewDrawer')

const PATIENT_ID = 'b1000000-0000-4000-8000-00000000a7c3'
const scope = { facilityId: 'facility-1', patientId: PATIENT_ID, encounter: { server: 'enc-1' } }

function pending(commandId: string, op: PendingView['op'], input: Record<string, unknown>): PendingView {
  return { commandId, op, state: 'review', capturedAt: '2026-10-29T09:00:00.000Z', label: op, input: { ...scope, ...input } as never }
}

beforeEach(() => { for (const mock of Object.values(api)) mock.mockReset() })

describe('review drawer', () => {
  it('412: shows your change and the current record side by side, with nothing preselected', async () => {
    api.records.mockResolvedValue({ items: [{ id: 'note-1', patientId: PATIENT_ID, encounterId: 'enc-1', createdAt: '2026-10-29T08:00:00.000Z',
      status: 'amended', title: 'Cough review', rowVersion: 3 }], nextCursor: null })
    const runtime = fakeRuntime({
      review: [{ commandId: 'cmd-1', class: 'CC2', laneBlocked: 2, patientId: PATIENT_ID, op: 'ehr.note.update' }],
      pending: [pending('cmd-1', 'ehr.note.update', { note: { server: 'note-1' },
        body: { expectedRowVersion: 2, changeReason: 'Signed after review', status: 'signed' } })],
    })
    render(<MemoryRouter><ReviewDrawer runtime={runtime} onClose={() => undefined} /></MemoryRouter>)

    expect(await screen.findByRole('dialog', { name: 'Changes that need your review' })).toBeTruthy()
    expect(await screen.findByText('Note status change: The record changed since you saw it')).toBeTruthy()
    expect(screen.getByText('This visit and 2 entries could not be sent.')).toBeTruthy()
    const yours = screen.getByRole('heading', { name: 'Your change' }).parentElement as HTMLElement
    expect(await within(yours).findByText('signed')).toBeTruthy()
    const current = screen.getByRole('heading', { name: 'Current record' }).parentElement as HTMLElement
    expect(await within(current).findByText('amended')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT_ID, 'enc-1', 'clinical-notes', { cursor: undefined, fresh: true })
    // Nothing is chosen for the author.
    for (const radio of screen.getAllByRole('radio')) expect((radio as HTMLInputElement).checked).toBe(false)
    expect(screen.getByRole('radio', { name: 'Apply my change on top' })).toBeTruthy()

    // A reason of fewer than 8 characters is refused; nothing is resolved.
    fireEvent.click(screen.getByRole('radio', { name: 'Apply my change on top' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Enter a reason of at least 8 characters.')
    expect(runtime.review.resolve).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Signed again after reading the amendment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByText('Saved. It will be sent when Health ID can be reached.')
    expect(runtime.review.resolve).toHaveBeenCalledWith('cmd-1', 'apply-on-top', { reason: 'Signed again after reading the amendment' })
  })

  it('CC4: shows the new allergy beside the held prescription', async () => {
    api.reportedHealthProfile.mockResolvedValue({ bloodGroup: null, genotype: null, allergies: 'Penicillin (rash)',
      currentMedications: 'Metformin 500 mg', chronicConditions: null, medicalNotes: null, updatedAt: '2026-10-29T09:30:00.000Z' })
    const runtime = fakeRuntime({
      review: [{ commandId: 'cmd-2', class: 'CC4', laneBlocked: 0, patientId: PATIENT_ID, op: 'ehr.prescription.create' }],
      pending: [pending('cmd-2', 'ehr.prescription.create', { body: { medicationDisplay: 'Amoxicillin 500 mg', frequency: 'three times a day',
        instructions: 'With food', status: 'draft' } })],
    })
    render(<MemoryRouter><ReviewDrawer runtime={runtime} onClose={() => undefined} /></MemoryRouter>)
    expect(await screen.findByText('Prescription: Check before sending this prescription')).toBeTruthy()
    expect(await screen.findByText('Penicillin (rash)')).toBeTruthy()
    expect(screen.getByText('Metformin 500 mg')).toBeTruthy()
    expect(screen.getByText('Amoxicillin 500 mg')).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith('facility-1', PATIENT_ID)
    expect(screen.getByRole('radio', { name: 'Send as is (I have checked)' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Discard' })).toBeTruthy()
  })

  it('CC5: asking for access again keeps the change and leads to patient access', async () => {
    const runtime = fakeRuntime({
      review: [{ commandId: 'cmd-3', class: 'CC5', laneBlocked: 0, patientId: PATIENT_ID, op: 'ehr.note.create' }],
      pending: [pending('cmd-3', 'ehr.note.create', { body: { title: 'Ward round', content: 'Stable' } })],
    })
    render(<MemoryRouter><ReviewDrawer runtime={runtime} onClose={() => undefined} /></MemoryRouter>)
    expect(await screen.findByText('Clinical note: Access to this patient ended')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Ask for access again' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Reason/ }), { target: { value: 'Patient still on the ward' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText('Kept on this device until access is approved.')).toBeTruthy()
    expect(runtime.review.resolve).toHaveBeenCalledWith('cmd-3', 'ask-access', { reason: 'Patient still on the ward' })
    expect(screen.getByRole('link', { name: 'Patient access' }).getAttribute('href')).toBe('/provider/patients')
  })

  it('CC1 offers no action: the change waits for confirmation', async () => {
    const runtime = fakeRuntime({ review: [{ commandId: 'cmd-4', class: 'CC1', laneBlocked: 0, patientId: PATIENT_ID, op: 'ehr.vital.create' }] })
    render(<MemoryRouter><ReviewDrawer runtime={runtime} onClose={() => undefined} /></MemoryRouter>)
    expect(await screen.findByText('Health ID has not confirmed this change yet. Don’t enter it again.')).toBeTruthy()
    expect(screen.queryByRole('radio')).toBeNull()
  })
})
