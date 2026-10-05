import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Registration } from './Registration'

const api = vi.hoisted(() => ({
  registrationCapabilities: vi.fn(),
  registrationCase: vi.fn(),
  resolveNin: vi.fn(),
  linkExistingRegistration: vi.fn(),
  approveNewRegistration: vi.fn(),
  enrollRegistration: vi.fn(),
}))

vi.mock('../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', permissions: ['identity.registration.write', 'identity.registration.approve'],
  } } } } }),
}))
vi.mock('../api', () => ({ staffApi: api }))

const caseId = 'c0000000-0000-4000-8000-000000000001'
const patientId = 'a0000000-0000-4000-8000-000000000001'

beforeEach(() => {
  vi.clearAllMocks()
  api.registrationCapabilities.mockResolvedValue({
    nin: { enabled: false, state: 'deferred' }, newPatientRegistrationRequiresNin: true,
  })
})

describe('provider registration', () => {
  it('keeps NIN entry disabled when the backend reports deferred verification', async () => {
    render(<Registration />)
    expect(await screen.findByText(/NIN verification is deferred/)).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'National Identity Number' })).toBeNull()
    expect(api.resolveNin).not.toHaveBeenCalled()
  })

  it('links only a server supplied review candidate with the case version', async () => {
    api.registrationCase.mockResolvedValue({
      caseId, status: 'review_required', version: 3, candidateCount: 1,
      candidates: [{ patientId, fullName: 'Amina Example', dateOfBirth: '1990-01-02' }],
    })
    api.linkExistingRegistration.mockResolvedValue({
      caseId, status: 'linked_existing', version: 4, candidateCount: 1,
      patient: { patientId, hid: 'HID-ABCDEFG' },
    })
    render(<Registration />)
    await screen.findByText(/NIN verification is deferred/)
    fireEvent.change(screen.getByRole('textbox', { name: 'Registration case ID' }), { target: { value: caseId } })
    fireEvent.click(screen.getByRole('button', { name: 'Load case' }))
    const candidate = await screen.findByRole('combobox', { name: 'Candidate to link' })
    expect(within(candidate).getAllByRole('option')).toHaveLength(2)
    fireEvent.change(candidate, { target: { value: patientId } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Review reason' }), { target: { value: 'Identity match reviewed with patient' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link selected patient' }))
    await waitFor(() => expect(api.linkExistingRegistration).toHaveBeenCalledWith(
      'facility-1', expect.objectContaining({ caseId, status: 'review_required', version: 3 }),
      patientId, 'Identity match reviewed with patient', expect.any(String),
    ))
    expect(await screen.findByText(/The verified identity was linked/)).toBeTruthy()
    expect(api.approveNewRegistration).not.toHaveBeenCalled()
  })

  it('reuses the resolve key on retry and clears the NIN after a successful response', async () => {
    api.registrationCapabilities.mockResolvedValue({
      nin: { enabled: true, state: 'test-only' }, newPatientRegistrationRequiresNin: true,
    })
    api.resolveNin.mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
    api.registrationCase.mockResolvedValue({ caseId, status: 'pending_new_identity_approval', version: 1, candidateCount: 0 })
    render(<Registration />)
    const nin = await screen.findByLabelText(/National Identity Number/) as HTMLInputElement
    fireEvent.change(nin, { target: { value: '12345678901' } })
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Amina' } })
    fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Example' } })
    fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: '1990-01-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(1))
    await screen.findByText('NIN verification could not be completed.')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and create case' }))
    await waitFor(() => expect(api.resolveNin).toHaveBeenCalledTimes(2))
    const [firstCall, secondCall] = api.resolveNin.mock.calls
    expect(firstCall?.[2]).toBeTruthy()
    expect(firstCall?.[2]).toBe(secondCall?.[2])
    await screen.findByText('NIN verification created a governed registration case. Review its status before continuing.')
    expect(nin.value).toBe('')
  })
})
