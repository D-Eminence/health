import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, AssistedRegistrationDesignation, Facility } from '../api'
import { FacilityDetailPage } from '../Facilities'
import { StepUpProvider } from '../StepUp'
import { focusWhenShown } from '../../__tests__/focusWhenShown'

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
  // Reset, not only cleared: an answer one test queued and did not use must not reach the next.
  vi.resetAllMocks(); mocks.keys = 0
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

  it('moves focus to the panel heading after a first designation, and keeps it there once the form is read again', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ ...ACTIVE, version: 1 })
    mocks.api.setAssistedRegistration.mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    const button = section.getByRole('button', { name: 'Designate facility' })
    button.focus()
    fireEvent.click(button)
    // The designation is read again with a new version, so the form, and the button that had focus, are replaced.
    expect(await section.findByRole('button', { name: 'Save designation' })).toBeTruthy()
    expect(button.isConnected).toBe(false)
    const heading = section.getByRole('heading', { name: 'Registration in person' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('moves focus to the panel heading after a step-up, which closes its dialog', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ ...ACTIVE, version: 1 })
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-15T12:05:00.000Z' })
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await section.findByRole('button', { name: 'Save designation' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(section.getByRole('heading', { name: 'Registration in person' })))
  })

  it('moves focus to the panel heading after a version conflict, once the designation is read again', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ACTIVE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'VERSION_CONFLICT'))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    const button = section.getByRole('button', { name: 'Designate facility' })
    button.focus()
    fireEvent.click(button)
    expect(await section.findByRole('button', { name: 'Save designation' })).toBeTruthy()
    expect(button.isConnected).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(section.getByRole('heading', { name: 'Registration in person' })))
  })

  it('keeps focus on the button after a refusal that leaves the form in place', async () => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'ADMIN_STATE_CONFLICT'))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    const button = section.getByRole('button', { name: 'Designate facility' })
    button.focus()
    fireEvent.click(button)
    await section.findByRole('alert')
    expect(document.activeElement).toBe(button)
  })

  it('announces a second save with the same answer: the notice is cleared while it saves, then shown anew', async () => {
    let second: (value: unknown) => void = () => {}
    mocks.api.assistedRegistration.mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, town: 'Ikeja GRA', version: 5 })
      .mockResolvedValueOnce({ ...ACTIVE, town: 'Ikeja GRA', hours: 'Mon to Sat, 9am to 4pm', version: 6 })
    mocks.api.setAssistedRegistration.mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 5, replayed: false })
      .mockReturnValueOnce(new Promise(resolve => { second = resolve }))
    open(MANAGE)
    const section = await panel()
    await section.findByText('12 Marina Road')
    fillLocation({ town: 'Ikeja GRA', reason: 'The desk moved to the GRA wing' })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    const saved = 'Saved. Patients can now be checked in person here while registration at a facility is switched on.'
    const first = await section.findByText(saved)
    // Refreshing has its own status region; assert the save announcement itself.
    const announcement = first.closest('[role="status"]')!
    expect(announcement.textContent).toBe(saved)
    await section.findByText('Ikeja GRA')
    fillLocation({ town: 'Ikeja GRA', hours: 'Mon to Sat, 9am to 4pm', reason: 'Open on Saturdays from this week' })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    await section.findByRole('button', { name: 'Saving…' })
    // The live region empties while the save runs, so the same words are announced again when they return.
    expect(announcement.textContent).toBe('')
    second({ facilityId: FACILITY_ID, status: 'active', version: 6, replayed: false })
    const again = await section.findByText(saved)
    expect(again).not.toBe(first)
    expect(announcement.textContent).toBe(saved)
  })

  it('alerts a second identical refusal: the alert is removed while it saves, then shown anew', async () => {
    let second: (reason: unknown) => void = () => {}
    mocks.api.assistedRegistration.mockResolvedValue(ACTIVE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'ADMIN_STATE_CONFLICT'))
      .mockReturnValueOnce(new Promise((_resolve, reject) => { second = reject }))
    open(MANAGE)
    const section = await panel()
    await section.findByText('12 Marina Road')
    fireEvent.change(section.getByLabelText(/^Reason for this designation change/), { target: { value: 'Confirming the current location' } })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    const first = await section.findByRole('alert')
    expect(first.textContent).toBe('Nothing changed: the designation already has this status and location.')
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    await section.findByRole('button', { name: 'Saving…' })
    expect(section.queryByRole('alert')).toBeNull()
    second(problem(409, 'ADMIN_STATE_CONFLICT'))
    const again = await section.findByRole('alert')
    expect(again).not.toBe(first)
    expect(again.textContent).toBe('Nothing changed: the designation already has this status and location.')
  })

  it('says why the designation could not be read', async () => {
    mocks.api.assistedRegistration.mockRejectedValue(problem(404, 'ADMIN_FACILITY_NOT_FOUND'))
    open(MANAGE)
    const section = await panel()
    expect(await section.findByText('This facility was not found. Check the facility link.')).toBeTruthy()
  })

  it('says quietly that this Identity does not offer it, never the route text, when the read route is missing', async () => {
    // An Identity without hid-system #85 answers the unknown route with its default 404, NOT_FOUND "Cannot GET ...".
    mocks.api.assistedRegistration.mockRejectedValue(new HidApiError(404,
      `Cannot GET /api/v1/admin/facilities/${FACILITY_ID}/assisted-registration`, { code: 'NOT_FOUND', requestId: 'corr-404' }))
    open(MANAGE)
    const section = await panel()
    const note = await section.findByText('Registration in person is not available on this Identity service yet. Nothing can be read or changed here until it is.')
    expect(note.className).toBe('admin-note')
    expect(section.queryByRole('alert')).toBeNull()
    expect(section.queryByRole('button')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Cannot GET/)
    // The rest of the facility page still works.
    expect(screen.getByRole('heading', { name: 'Ikeja Clinic', level: 1 })).toBeTruthy()
  })

  it('clears an earlier alert when the next press is refused before sending', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ACTIVE)
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'VERSION_CONFLICT'))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    expect((await section.findByRole('alert')).textContent).toMatch(/^The designation changed since it was read/)
    // The form is read again with an empty reason; saving it is refused at the reason, before anything is sent.
    fireEvent.click(await section.findByRole('button', { name: 'Save designation' }))
    const reason = section.getByLabelText(/^Reason for this designation change/)
    await waitFor(() => expect(reason.getAttribute('aria-invalid')).toBe('true'))
    expect(section.queryByRole('alert')).toBeNull()
    expect(section.queryByText(/The designation changed since it was read/)).toBeNull()
    expect(mocks.api.setAssistedRegistration).toHaveBeenCalledOnce()
  })

  it('clears a "Saved." notice when the next change is refused before sending', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce({ ...ACTIVE, town: 'Ikeja GRA', version: 5 })
    mocks.api.setAssistedRegistration.mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 5, replayed: false })
    open(MANAGE)
    const section = await panel()
    await section.findByText('12 Marina Road')
    fillLocation({ town: 'Ikeja GRA', reason: 'The desk moved to the GRA wing' })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    expect(await section.findByText(/^Saved\./)).toBeTruthy()
    await section.findByText('Ikeja GRA')
    fireEvent.click(section.getByRole('radio', { name: /Suspended/ }))
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    const reason = section.getByLabelText(/^Reason for this designation change/)
    await waitFor(() => expect(reason.getAttribute('aria-invalid')).toBe('true'))
    // Only the refusal answers this press: the notice of the save before it is gone.
    expect(section.getByRole('status').textContent).toBe('')
    expect(section.queryByText(/^Saved\./)).toBeNull()
    expect(mocks.api.setAssistedRegistration).toHaveBeenCalledOnce()
  })

  it('reads the designation again when the page is refreshed, and sends a change with the version read', async () => {
    mocks.api.assistedRegistration.mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, status: 'suspended', reason: 'Paused by another administrator', version: 5 })
    mocks.api.setAssistedRegistration.mockResolvedValueOnce({ facilityId: FACILITY_ID, status: 'active', version: 6, replayed: false })
    open(MANAGE)
    const section = await panel()
    expect(await section.findByText('Active')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await section.findByText('Paused by another administrator')).toBeTruthy()
    expect(mocks.api.assistedRegistration).toHaveBeenCalledTimes(2)
    expect(section.getByText('Suspended')).toBeTruthy()
    fireEvent.click(section.getByRole('radio', { name: /^Active/ }))
    fireEvent.change(section.getByLabelText(/^Reason for this designation change/), { target: { value: 'The desk is open again' } })
    fireEvent.click(section.getByRole('button', { name: 'Save designation' }))
    await waitFor(() => expect(mocks.api.setAssistedRegistration).toHaveBeenCalledOnce())
    expect(mocks.api.setAssistedRegistration.mock.calls[0]![2]).toBe(5)
  })

  it.each(['suspended', 'rejected', 'pending'])('says an active designation is not in effect while the facility is %s', async status => {
    mocks.api.facility.mockResolvedValue({ ...facility, status })
    mocks.api.assistedRegistration.mockResolvedValue(ACTIVE)
    open(actor([]))
    const section = await panel()
    await section.findByText('12 Marina Road')
    expect(section.getByText('Active')).toBeTruthy()
    expect(section.getByText('Not in effect: the facility must be verified and active, in an active organization.')).toBeTruthy()
  })

  it('adds nothing to an active designation of a verified facility, or to a suspended one', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility).mockResolvedValue({ ...facility, status: 'suspended', version: 4 })
    mocks.api.assistedRegistration.mockResolvedValueOnce(ACTIVE).mockResolvedValue({ ...ACTIVE, status: 'suspended', version: 5 })
    open(actor([]))
    const section = await panel()
    await section.findByText('12 Marina Road')
    // Only a verified facility in an active organization takes part: the description says so.
    expect(section.getByText(/the facility is verified and active, in an active organization/)).toBeTruthy()
    expect(section.queryByText(/^Not in effect/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await section.findByText('Suspended')).toBeTruthy()
    expect(section.queryByText(/^Not in effect/)).toBeNull()
  })

  it('says the designation is no longer in effect once the facility is suspended on the same page', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility).mockResolvedValue({ ...facility, status: 'suspended', version: 4 })
    mocks.api.assistedRegistration.mockResolvedValue(ACTIVE)
    mocks.api.command.mockResolvedValueOnce({ status: 'suspended', version: 4 })
    open(MANAGE)
    const section = await panel()
    await section.findByText('12 Marina Road')
    expect(section.queryByText(/^Not in effect/)).toBeNull()
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'suspended' } })
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: 'Licence under review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    expect(await section.findByText('Not in effect: the facility must be verified and active, in an active organization.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.assistedRegistration).toHaveBeenCalledTimes(2))
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

/**
 * Focus moves in the commit that shows where it goes. From an effect, it moved a task after the render that followed
 * the answer, and a check made as soon as the answer was shown (findBy on a busy runner) found it elsewhere. The answer
 * is given outside act, as a fetch's arrives, and focus is read at the moment the answer is shown.
 */
describe('focus as soon as an answer is shown', () => {
  const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const actEnvironment = environment.IS_REACT_ACT_ENVIRONMENT
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = actEnvironment })

  it('has focus on the panel heading as soon as a save is shown', async () => {
    let answer: (value: unknown) => void = () => {}
    mocks.api.assistedRegistration.mockResolvedValueOnce(NONE).mockResolvedValueOnce({ ...ACTIVE, version: 1 })
    mocks.api.setAssistedRegistration.mockRejectedValueOnce(problem(409, 'ADMIN_STATE_CONFLICT'))
      .mockReturnValueOnce(new Promise(resolve => { answer = resolve }))
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation()
    const button = section.getByRole('button', { name: 'Designate facility' })
    button.focus()
    // Refused first, so the press that saves clears an answer on screen. A press with no answer to clear leaves the
    // panel an update React renders straight after the answer's render, running every effect at once: there an
    // effect cannot be told from a layout effect.
    fireEvent.click(button)
    await section.findByRole('alert')
    fireEvent.click(button)
    const shown = focusWhenShown(() => section.queryByText(/^Saved\./))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    answer({ facilityId: FACILITY_ID, status: 'active', version: 1, replayed: false })
    const { focused } = await shown
    expect(focused).toBe(section.getByRole('heading', { name: 'Registration in person' }))
    // The designation read again replaces the form; focus stays on the heading.
    expect(await section.findByRole('button', { name: 'Save designation' })).toBeTruthy()
    expect(document.activeElement).toBe(section.getByRole('heading', { name: 'Registration in person' }))
  })

  it('has focus on a refused field as soon as it is marked refused', async () => {
    mocks.api.assistedRegistration.mockResolvedValue(NONE)
    open(MANAGE)
    const section = await panel()
    await section.findByText('This facility does not take part in registration in person.')
    fillLocation({ town: ' ' })
    const town = section.getByLabelText(/^Town/)
    const shown = focusWhenShown(() => town.getAttribute('aria-invalid') === 'true' ? town : null)
    fireEvent.click(section.getByRole('button', { name: 'Designate facility' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
