import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Outreach } from '../Operations'
import { Registration } from '../Registration'

/**
 * NEW-PEHR-ACTION-FOCUS on registration and outreach. Verifying a NIN disabled
 * the whole form, button included, so focus fell to the page; a case decision
 * and an outreach link remove the form that made them; and each confirmation
 * was a status node inserted with its text. Controls stay focusable while their
 * request runs, focus moves to the case once its form goes, and a status region
 * mounted throughout says what happened.
 */
const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(), registrationCase: vi.fn(), resolveNin: vi.fn(), linkExistingRegistration: vi.fn(),
  approveNewRegistration: vi.fn(), enrollRegistration: vi.fn(),
  outreachCampaigns: vi.fn(), outreachCases: vi.fn(), outreachCampaignMembers: vi.fn(), linkExistingOutreachCase: vi.fn(),
}))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', membershipId: 'member-1',
    permissions: ['identity.registration.write', 'identity.registration.approve', 'outreach.registration.read', 'outreach.registration.write'],
  } } } }, lock: null }),
}))
vi.mock('../../api', () => ({ staffApi: api }))

const caseId = 'c0000000-0000-4000-8000-000000000001'
const patientId = 'a0000000-0000-4000-8000-000000000001'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
function region(id: string) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Expected the status region ${id} to be mounted before the step.`)
  expect(element.getAttribute('role')).toBe('status')
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  api.registrationCapabilities.mockResolvedValue({ nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true })
})

describe('registration', () => {
  it('verifying a NIN keeps its button focusable while it runs', async () => {
    const verifying = deferred<unknown>()
    api.resolveNin.mockReturnValueOnce(verifying.promise)
    api.registrationCase.mockResolvedValue({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
    render(<Registration />)
    fireEvent.change(await screen.findByLabelText(/National Identity Number/), { target: { value: '12345678901' } })
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Amina' } })
    fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: '1990-01-02' } })
    const status = region('registration-status')
    const button = screen.getByRole('button', { name: 'Verify and create case' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.resolveNin).toHaveBeenCalledTimes(1)
    await act(async () => { verifying.resolve({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 }) })
    await waitFor(() => expect(status.textContent).toBe('NIN verification created a governed registration case. Review its status before continuing.'))
  })

  it('a case decision: focus moves to the case once its form goes, and the page says it', async () => {
    api.registrationCase.mockResolvedValue({ caseId, status: 'review_required', version: 3, candidateCount: 1,
      candidates: [{ patientId, fullName: 'Amina Example', dateOfBirth: '1990-01-02' }] })
    api.linkExistingRegistration.mockResolvedValue({ caseId, status: 'linked_existing', version: 4, candidateCount: 1,
      patient: { patientId, hid: 'HID-ABCDEFG' } })
    render(<Registration />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registration case ID' }), { target: { value: caseId } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'Candidate to link' }), { target: { value: patientId } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Review reason' }), { target: { value: 'Identity match reviewed with patient' } })
    const status = region('registration-status')
    await press(screen.getByRole('button', { name: 'Link selected patient' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: `Case ${caseId}` })))
    expect(status.textContent).toBe('The verified identity was linked to the selected patient.')
  })
})

describe('outreach', () => {
  it('linking a case: focus moves to the case once its form goes, and the case says it', async () => {
    const pending = { id: 'case-1', status: 'identity_resolution_pending', fullName: 'Amina Example', rowVersion: 2, createdAt: '2026-10-01T08:00:00.000Z' }
    api.outreachCampaigns.mockResolvedValue([])
    api.outreachCases.mockResolvedValueOnce([pending]).mockResolvedValue([{ ...pending, status: 'identity_resolved', rowVersion: 3 }])
    api.linkExistingOutreachCase.mockResolvedValue({ ...pending, status: 'identity_resolved', rowVersion: 3 })
    render(<Outreach />)
    const title = await screen.findByText('Amina Example')
    const card = title.closest<HTMLElement>('.staff-list-item')!
    const status = region('outreach-case-status-case-1')
    fireEvent.click(within(card).getByText('Link verified existing patient'))
    fireEvent.change(within(card).getByRole('textbox', { name: /Canonical patient ID/ }), { target: { value: patientId } })
    fireEvent.change(within(card).getByRole('textbox', { name: /Resolution reason/ }), { target: { value: 'Matched by phone and date of birth' } })
    await press(within(card).getByRole('button', { name: 'Link existing patient' }))
    await waitFor(() => expect(document.activeElement).toBe(title))
    expect(within(card).queryByRole('button', { name: 'Link existing patient' })).toBeNull()
    expect(status.textContent).toBe('Existing patient linked.')
  })
})
