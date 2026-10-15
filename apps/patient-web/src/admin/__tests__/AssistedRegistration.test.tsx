import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, AssistedRegistrationDesignation, Facility } from '../api'
import { FacilityDetailPage } from '../Facilities'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  api: { facility: vi.fn(), audit: vi.fn(), command: vi.fn(), stepUp: vi.fn(),
    assistedRegistration: vi.fn(), setAssistedRegistration: vi.fn() },
  keys: 0,
}))
vi.mock('../api', () => ({ adminApi: mocks.api, PAGE_SIZE: 25, newIdempotencyKey: () => `key-${++mocks.keys}` }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const facility: Facility = { id: FACILITY_ID, organizationId: 'org-1', organizationName: 'Lagos Health', name: 'Ikeja Clinic',
  code: 'IKJ', status: 'verified', statusReason: null, statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z',
  membershipCount: 4, version: 3 }
const NONE: AssistedRegistrationDesignation = { facilityId: FACILITY_ID, designated: false, status: null, addressLine: null,
  town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null }
const ACTIVE: AssistedRegistrationDesignation = { facilityId: FACILITY_ID, designated: true, status: 'active',
  addressLine: '12 Marina Road', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos', hours: 'Mon to Fri, 9am to 4pm',
  reason: 'Approved for the in-person registration pilot', version: 4, updatedAt: '2026-10-10T09:00:00.000Z' }
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.facility.read', ...permissions] })
const MANAGE = actor(['platform.facility.manage'])
const problem = (status: number, code: string, detail = code) => new HidApiError(status, detail, { code, requestId: `corr-${status}` })

function open(who: AdminActor) {
  render(<MemoryRouter initialEntries={[`/admin/facilities/${FACILITY_ID}`]}><StepUpProvider><Routes>
    <Route path="/admin/facilities/:facilityId" element={<FacilityDetailPage actor={who} />} />
  </Routes></StepUpProvider></MemoryRouter>)
}

const panel = async () => {
  const heading = await screen.findByRole('heading', { name: 'Registration in person' })
  return within(heading.closest('section')!)
}

function fillLocation(values: { address?: string; town?: string; lga?: string; state?: string; hours?: string; reason?: string } = {}) {
  // The facility's status form has a reason field too: only the designation's are filled.
  const form = within(screen.getByRole('heading', { name: 'Registration in person' }).closest('section')!)
  const set = (label: RegExp, value: string) => fireEvent.change(form.getByLabelText(label), { target: { value } })
  set(/^Address line/, values.address ?? '12 Marina Road')
  set(/^Town/, values.town ?? 'Ikeja')
  set(/^Local government area/, values.lga ?? 'Ikeja')
  set(/^State/, values.state ?? 'Lagos')
  set(/^Opening hours/, values.hours ?? 'Mon to Fri, 9am to 4pm')
  set(/^Reason for this designation change/, values.reason ?? 'Approved for the in-person registration pilot')
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.keys = 0
  mocks.api.facility.mockResolvedValue(facility)
  mocks.api.audit.mockResolvedValue({ items: [], nextBeforeSequenceId: null })
})

describe('the facility’s designation for registration in person (hid-system #85, ADR-063)', () => {
  it('shows a facility without one, and offers no change without platform.facility.manage', async () => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    open(actor([]))
    const section = await panel()
    expect(await section.findByText('This facility does not take part in registration in person.')).toBeTruthy()
    expect(mocks.api.assistedRegistration).toHaveBeenCalledWith(FACILITY_ID, expect.anything())
    expect(section.queryByRole('button', { name: 'Designate facility' })).toBeNull()
    expect(section.getByText(/Changing it needs the platform.facility.manage permission/)).toBeTruthy()
  })

  it('designates a facility the first time with version 0, after step-up, as one submission', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ ...ACTIVE, version: 1 })
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-15T12:05:00.000Z' })
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    // The first designation is active: the command refuses If-Match 0 with suspended.
    expect(section.queryByRole('radio', { name: /Suspended/ })).toBeNull()
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await section.findByText('Saved. Patients can now be checked in person here while registration at a facility is switched on.')).toBeTruthy()
    const body = { status: 'active', addressLine: '12 Marina Road', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos',
      hours: 'Mon to Fri, 9am to 4pm', reason: 'Approved for the in-person registration pilot' }
    expect(mocks.api.setAssistedRegistration.mock.calls).toEqual([[FACILITY_ID, body, 0, 'key-1'], [FACILITY_ID, body, 0, 'key-1']])
    await waitFor(() => expect(mocks.api.assistedRegistration).toHaveBeenCalledTimes(2))
    expect(await section.findByText('Active')).toBeTruthy()
  })

  it('leaves out an empty address line and hours', async () => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    mocks.api.setAssistedRegistration.mockResolvedValue({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation({ address: '  ', hours: '' })
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    await waitFor(() => expect(mocks.api.setAssistedRegistration).toHaveBeenCalledOnce())
    expect(mocks.api.setAssistedRegistration.mock.calls[0]![1]).toEqual({ status: 'active', town: 'Ikeja', lga: 'Ikeja',
      state: 'Lagos', reason: 'Approved for the in-person registration pilot' })
  })

  it('shows the designation and suspends it with its version', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce({ ...ACTIVE, status: 'suspended', version: 5 })
    mocks.api.setAssistedRegistration.mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'suspended', version: 5, replayed: false })
    open(MANAGE)
    const section = await panel()
    expect(await section.findByText('12 Marina Road')).toBeTruthy()
    expect(section.getByText('Mon to Fri, 9am to 4pm')).toBeTruthy()
    expect(section.getByText('Active')).toBeTruthy()
    // The form starts from the stored location.
    expect((section.getByLabelText(/^Town/) as HTMLInputElement).value).toBe('Ikeja')
    fireEvent.click(section.getByRole('radio', { name: /Suspended/ }))
    fireEvent.change(section.getByLabelText(/^Reason for this designation change/), { target: { value: 'Paused while the desk is moved' } })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    expect(await section.findByText('Saved. No patient can be checked in person here while it is suspended.')).toBeTruthy()
    expect(mocks.api.setAssistedRegistration).toHaveBeenCalledWith(FACILITY_ID, { status: 'suspended', addressLine: '12 Marina Road',
      town: 'Ikeja', lga: 'Ikeja', state: 'Lagos', hours: 'Mon to Fri, 9am to 4pm', reason: 'Paused while the desk is moved' }, 4, 'key-1')
  })

  it.each([
    [{ town: ' ' }, /^Town/, 'Enter the town patients are shown.'],
    [{ lga: '' }, /^Local government area/, 'Enter the local government area patients are shown.'],
    [{ state: '' }, /^State/, 'Enter the state patients are shown.'],
    [{ reason: 'Short' }, /^Reason for this designation change/, 'Enter a reason of 8 to 500 characters. It is recorded in the audit log.'],
  ])('refuses %o at its field before sending', async (values, field, message) => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation(values)
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    const control = section.getByLabelText(field)
    await waitFor(() => expect(document.activeElement).toBe(control))
    expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(control.getAttribute('aria-describedby')!)?.textContent).toBe(message)
    expect(mocks.api.setAssistedRegistration).not.toHaveBeenCalled()
  })

  it.each([
    ['FACILITY_NOT_ACTIVE', 409, 'Only a verified, active facility of an active organization can register patients in person. Verify the facility first.'],
    ['ADMIN_STATE_CONFLICT', 409, 'Nothing changed: the designation already has this status and location.'],
    ['ADMIN_COMMAND_INVALID', 400, 'This designation was refused. A facility’s first designation must be active; check the values and try again.'],
    ['PERMISSION_DENIED', 403, 'Changing the designation needs the platform.facility.manage permission. Ask a Super Admin.'],
    ['IDEMPOTENCY_CONFLICT', 409, 'This submission conflicts with an earlier one. Reload and try again.'],
  ])('explains %s', async (code, status, shown) => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(status, code))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    expect((await section.findByRole('alert')).textContent).toBe(shown)
  })

  it('reads the designation again after a version conflict', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ACTIVE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'VERSION_CONFLICT'))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    expect((await section.findByRole('alert')).textContent)
      .toBe('The designation changed since it was read. It has been read again: check it, then make your change again.')
    await waitFor(() => expect(mocks.api.assistedRegistration).toHaveBeenCalledTimes(2))
    expect(await section.findByText('12 Marina Road')).toBeTruthy()
    expect(section.getByRole('button', { name: 'Save designation' })).toBeTruthy()
  })

  it('sends the same submission again after a 503, and a new one once the details change', async () => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(503, 'ADMIN_COMMAND_UNAVAILABLE'))
      .mockRejectedValueOnce(new HidApiError(0, 'We could not reach the service.', { code: 'NETWORK_ERROR' }))
      .mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: true })
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    expect((await section.findByRole('alert')).textContent).toBe('The designation could not be saved. Try again. Reference: corr-503')
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    await waitFor(() => expect(mocks.api.setAssistedRegistration).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(section.getByRole('alert').textContent).toBe('The designation could not be saved. Try again.'))
    fillLocation({ hours: 'Mon to Sat, 9am to 4pm' })
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    expect(await section.findByText('This designation was already saved.')).toBeTruthy()
    expect(mocks.api.setAssistedRegistration.mock.calls.map(call => call[3])).toEqual(['key-1', 'key-1', 'key-2'])
  })

  it('says why the designation could not be read', async () => {
    mocks.api.assistedRegistration.mockRejectedValue(problem(404, 'ADMIN_FACILITY_NOT_FOUND'))
    open(MANAGE)
    const section = await panel()
    expect(await section.findByText('This facility was not found. Check the facility link.')).toBeTruthy()
  })

  it('keeps the save button working, and says it is saving while it runs', async () => {
    let answer: (value: unknown) => void = () => {}
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    mocks.api.setAssistedRegistration.mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    const saving = await section.findByRole('button', { name: 'Saving…' })
    expect(saving.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(saving)
    expect(mocks.api.setAssistedRegistration).toHaveBeenCalledOnce()
    answer({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    expect(await section.findByText(/^Saved\./)).toBeTruthy()
  })
})
