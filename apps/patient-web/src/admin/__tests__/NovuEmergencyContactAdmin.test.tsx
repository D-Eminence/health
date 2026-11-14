import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, Facility } from '../api'
import { EmergencyContactAlertsPage } from '../EmergencyContacts'
import { FacilityDetailPage } from '../Facilities'
import { canOpen, navigationItemFor, visibleNavigation } from '../navigation'
import { StepUpProvider } from '../StepUp'
import { focusWhenShown } from '../../__tests__/focusWhenShown'

/**
 * hid-system #109's emergency-contact administration, which only Novu (staging-novu-ci-20261005) serves: the phone an
 * alert gives for a facility, and support's opt-out of a person who asked to stop receiving alerts. Main has neither
 * route, so the main-v1 console shows neither.
 */
const mocks = vi.hoisted(() => ({
  api: { facility: vi.fn(), audit: vi.fn(), command: vi.fn(), stepUp: vi.fn(), assistedRegistration: vi.fn(),
    setFacilityAlertPhone: vi.fn(), optOutEmergencyContact: vi.fn() },
  keys: 0,
}))
vi.mock('../api', () => ({ adminApi: mocks.api, PAGE_SIZE: 25, newIdempotencyKey: () => `key-${++mocks.keys}` }))

const FACILITY_ID = '0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f'
const facility = (overrides: Partial<Facility> = {}): Facility => ({ id: FACILITY_ID, organizationId: 'org-1',
  organizationName: 'Lagos Health', name: 'Ikeja Clinic', code: 'IKJ', status: 'verified', statusReason: null,
  statusChangedAt: null, createdAt: '2026-09-01T09:00:00.000Z', membershipCount: 4, version: 3,
  alertPhoneE164: null, alertPhoneUpdatedAt: null, ...overrides })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.admin.access', 'platform.facility.read', ...permissions] })
const NOT_SET = 'Not set: alerts give Health ID support\'s number (+234 702 671 7252)'

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}

function open(element: ReactElement, path = `/admin/facilities/${FACILITY_ID}`, route = '/admin/facilities/:facilityId') {
  render(<MemoryRouter initialEntries={[path]}><StepUpProvider><Routes>
    <Route path={route} element={<>{element}<Location /></>} />
  </Routes></StepUpProvider></MemoryRouter>)
}

const alertPhone = async () => within(await screen.findByRole('region', { name: 'Alert phone number' }))

/** What a screen reader finds at the field the moment focus reaches it: marked invalid and described by the refusal. */
function onFocus(field: HTMLElement) {
  const found: Array<{ invalid: string | null; describedBy: string[]; alerts: string[] }> = []
  field.addEventListener('focus', () => found.push({ invalid: field.getAttribute('aria-invalid'),
    describedBy: (field.getAttribute('aria-describedby') ?? '').split(' '),
    alerts: screen.queryAllByRole('alert').map(alert => alert.id) }))
  return found
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.keys = 0
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  mocks.api.assistedRegistration.mockResolvedValue({ facilityId: FACILITY_ID, designated: false, status: null, addressLine: null,
    town: null, lga: null, state: null, hours: null, reason: null, version: 0, updatedAt: null })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('a facility\'s alert phone number', () => {
  it('says alerts give support\'s number while none is set, and sets one with the facility version, the key and a reason', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility())
      .mockResolvedValue(facility({ version: 4, alertPhoneE164: '+2348030000000', alertPhoneUpdatedAt: '2026-10-24T09:00:00.000Z' }))
    mocks.api.setFacilityAlertPhone.mockResolvedValue({ facilityId: FACILITY_ID, alertPhoneE164: '+2348030000000', version: 4, replayed: false })
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    expect(section.getByText(NOT_SET)).toBeTruthy()
    expect(section.queryByLabelText(/^Clear it/)).toBeNull()
    const save = section.getByRole('button', { name: 'Save alert phone number' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(section.getByLabelText('Facility phone number'), { target: { value: ' 0803 000 0000 ' } })
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Front desk line confirmed' } })
    fireEvent.click(save)
    expect(await section.findByText('Saved. Alerts about emergency access here now give +2348030000000.')).toBeTruthy()
    expect(mocks.api.setFacilityAlertPhone).toHaveBeenCalledWith(expect.objectContaining({ id: FACILITY_ID, version: 3 }),
      '0803 000 0000', 'Front desk line confirmed', 'key-1')
    // The command bumps the facility's version: the facility is read again.
    await waitFor(() => expect(section.getByText('+2348030000000')).toBeTruthy())
    expect(mocks.api.facility).toHaveBeenCalledTimes(2)
    expect((section.getByLabelText('Facility phone number') as HTMLInputElement).value).toBe('')
  })

  it('says a refused number at the phone field, and moves focus there', async () => {
    mocks.api.facility.mockResolvedValue(facility())
    mocks.api.setFacilityAlertPhone.mockRejectedValue(new HidApiError(400, 'Enter the facility phone in international format '
      + '(+234...) or as an 11-digit number starting with 0', { code: 'ADMIN_INVALID_FACILITY_PHONE' }))
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    const phone = section.getByLabelText('Facility phone number')
    const focused = onFocus(phone)
    fireEvent.change(phone, { target: { value: '12345' } })
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Front desk line confirmed' } })
    fireEvent.click(section.getByRole('button', { name: 'Save alert phone number' }))
    await waitFor(() => expect(document.activeElement).toBe(phone))
    const refusal = section.getByRole('alert')
    expect(refusal.textContent).toBe('Enter the facility phone in international format (+234...) or as an 11-digit number starting with 0.')
    expect(focused).toEqual([{ invalid: 'true', describedBy: [`admin-facility-alert-phone-hint`, refusal.id], alerts: [refusal.id] }])
    expect(mocks.api.facility).toHaveBeenCalledTimes(1)
  })

  it('says a number that is already set as nothing changed, not as an account\'s state', async () => {
    mocks.api.facility.mockResolvedValue(facility({ alertPhoneE164: '+2348030000000', alertPhoneUpdatedAt: '2026-10-24T09:00:00.000Z' }))
    mocks.api.setFacilityAlertPhone.mockRejectedValue(new HidApiError(409, 'No state change', { code: 'ADMIN_STATE_CONFLICT' }))
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    fireEvent.change(section.getByLabelText('Facility phone number'), { target: { value: '0803 000 0000' } })
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Front desk line confirmed' } })
    fireEvent.click(section.getByRole('button', { name: 'Save alert phone number' }))
    expect((await section.findByRole('alert')).textContent)
      .toBe('The facility already has this alert phone number, or none if you are clearing it. Nothing was changed.')
  })

  it('reads the facility again after a version conflict, and sends its new version next', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility())
      .mockResolvedValue(facility({ version: 4, statusReason: 'Changed by another admin' }))
    mocks.api.setFacilityAlertPhone.mockRejectedValueOnce(new HidApiError(409, 'Version conflict', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValue({ facilityId: FACILITY_ID, alertPhoneE164: '+2348030000000', version: 5, replayed: false })
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    fireEvent.change(section.getByLabelText('Facility phone number'), { target: { value: '0803 000 0000' } })
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Front desk line confirmed' } })
    fireEvent.click(section.getByRole('button', { name: 'Save alert phone number' }))
    expect((await section.findByRole('alert')).textContent)
      .toBe('This facility changed since it was read. It has been read again: check it, then make your change again.')
    expect(await screen.findByText('Changed by another admin')).toBeTruthy()
    expect(mocks.api.facility).toHaveBeenCalledTimes(2)
    fireEvent.click(section.getByRole('button', { name: 'Save alert phone number' }))
    expect(await section.findByText('Saved. Alerts about emergency access here now give +2348030000000.')).toBeTruthy()
    expect(mocks.api.setFacilityAlertPhone.mock.calls.map(([sent]) => (sent as Facility).version)).toEqual([3, 4])
  })

  it('takes a number again once a reload finds it cleared while "Clear it" was ticked', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility({ alertPhoneE164: '+2348030000000', alertPhoneUpdatedAt: '2026-10-24T09:00:00.000Z' }))
      .mockResolvedValue(facility({ version: 4 }))
    mocks.api.setFacilityAlertPhone.mockRejectedValueOnce(new HidApiError(409, 'Version conflict', { code: 'VERSION_CONFLICT' }))
      .mockResolvedValue({ facilityId: FACILITY_ID, alertPhoneE164: '+2348031111111', version: 5, replayed: false })
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    fireEvent.click(section.getByLabelText(/^Clear it/))
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Facility line disconnected' } })
    fireEvent.click(section.getByRole('button', { name: 'Clear alert phone number' }))
    expect(await section.findByText(NOT_SET)).toBeTruthy()
    expect(section.queryByLabelText(/^Clear it/)).toBeNull()
    const phone = section.getByLabelText('Facility phone number') as HTMLInputElement
    expect(phone.disabled).toBe(false)
    expect(section.queryByRole('button', { name: 'Clear alert phone number' })).toBeNull()
    fireEvent.change(phone, { target: { value: '0803 111 1111' } })
    fireEvent.click(section.getByRole('button', { name: 'Save alert phone number' }))
    expect(await section.findByText('Saved. Alerts about emergency access here now give +2348031111111.')).toBeTruthy()
    expect(mocks.api.setFacilityAlertPhone).toHaveBeenLastCalledWith(expect.objectContaining({ version: 4 }), '0803 111 1111',
      'Facility line disconnected', expect.any(String))
  })

  it('clears a number, so alerts give support\'s', async () => {
    mocks.api.facility.mockResolvedValueOnce(facility({ alertPhoneE164: '+2348030000000', alertPhoneUpdatedAt: '2026-10-24T09:00:00.000Z' }))
      .mockResolvedValue(facility({ version: 4 }))
    mocks.api.setFacilityAlertPhone.mockResolvedValue({ facilityId: FACILITY_ID, alertPhoneE164: null, version: 4, replayed: false })
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    expect(section.getByText('+2348030000000')).toBeTruthy()
    fireEvent.click(section.getByLabelText(/^Clear it/))
    expect((section.getByLabelText('Facility phone number') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Facility line disconnected' } })
    fireEvent.click(section.getByRole('button', { name: 'Clear alert phone number' }))
    expect(await section.findByText('Cleared. Alerts about emergency access here now give Health ID support\'s number (+234 702 671 7252).')).toBeTruthy()
    expect(mocks.api.setFacilityAlertPhone).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }), null, 'Facility line disconnected', 'key-1')
    expect(await section.findByText(NOT_SET)).toBeTruthy()
  })

  it('is read-only without platform.facility.manage', async () => {
    mocks.api.facility.mockResolvedValue(facility())
    open(<FacilityDetailPage actor={actor([])} />)
    const section = await alertPhone()
    expect(section.getByText(NOT_SET)).toBeTruthy()
    expect(section.getByText('Your roles don’t let you change it.')).toBeTruthy()
    expect(section.queryByLabelText('Facility phone number')).toBeNull()
  })

  it('is not shown on the main backend, which has no alert phone', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    mocks.api.facility.mockResolvedValue(facility())
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    expect(await screen.findByRole('heading', { name: 'Ikeja Clinic', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Alert phone number' })).toBeNull()
    expect(screen.queryByText(/Not set: alerts give/)).toBeNull()
  })
})

describe('stopping alerts to a person', () => {
  const page = () => open(<EmergencyContactAlertsPage />, '/admin/emergency-contacts', '/admin/emergency-contacts')
  const reason = () => screen.getByLabelText('Reason for stopping these alerts')

  it('sends the channel, address and reason with one key per submission, shows counts only and clears the address', async () => {
    mocks.api.optOutEmergencyContact.mockResolvedValueOnce({ contacts: 2, patients: 2, replayed: false })
      .mockResolvedValueOnce({ contacts: 0, patients: 0, replayed: false })
    page()
    const address = screen.getByLabelText('Email address') as HTMLInputElement
    const stop = screen.getByRole('button', { name: 'Stop alerts' }) as HTMLButtonElement
    fireEvent.change(address, { target: { value: ' ada@example.com ' } })
    expect(stop.disabled).toBe(true)
    fireEvent.change(reason(), { target: { value: 'Recipient called support' } })
    fireEvent.click(stop)
    expect(await screen.findByText('Removed 2 contacts for 2 patients. Each patient is told in their Health ID notifications.')).toBeTruthy()
    expect(mocks.api.optOutEmergencyContact).toHaveBeenCalledWith(
      { channel: 'email', destination: 'ada@example.com', reason: 'Recipient called support' }, 'key-1')
    expect(address.value).toBe('')
    expect((reason() as HTMLTextAreaElement).value).toBe('')
    expect(screen.getByTestId('location').textContent).toBe('/admin/emergency-contacts')
    expect(document.body.textContent).not.toContain('ada@example.com')

    fireEvent.change(address, { target: { value: 'nobody@example.com' } })
    fireEvent.change(reason(), { target: { value: 'Recipient called support' } })
    fireEvent.click(stop)
    expect(await screen.findByText('No emergency contact uses that address.')).toBeTruthy()
    expect(mocks.api.optOutEmergencyContact).toHaveBeenLastCalledWith(
      { channel: 'email', destination: 'nobody@example.com', reason: 'Recipient called support' }, 'key-2')
  })

  it('takes a phone number for SMS, and says a refused address at its field', async () => {
    mocks.api.optOutEmergencyContact.mockRejectedValue(new HidApiError(400, 'Enter a valid phone number',
      { code: 'EMERGENCY_CONTACT_DESTINATION_INVALID' }))
    page()
    fireEvent.change(screen.getByLabelText('How they receive alerts'), { target: { value: 'sms' } })
    const phone = screen.getByLabelText('Phone number') as HTMLInputElement
    expect(phone.type).toBe('tel')
    const focused = onFocus(phone)
    fireEvent.change(phone, { target: { value: '0803 12' } })
    fireEvent.change(reason(), { target: { value: 'Recipient called support' } })
    fireEvent.click(screen.getByRole('button', { name: 'Stop alerts' }))
    await waitFor(() => expect(document.activeElement).toBe(phone))
    const refusal = screen.getByRole('alert')
    expect(refusal.textContent).toBe('Enter a valid phone number')
    expect(focused).toEqual([{ invalid: 'true', describedBy: ['admin-opt-out-hint', refusal.id], alerts: [refusal.id] }])
    expect(document.getElementById('admin-opt-out-hint')?.textContent).toBe('For example 0803 123 4567 or +234 803 123 4567.')
    expect(phone.value).toBe('0803 12')
  })

  it('is an area on Novu for holders of platform.emergency-contact.manage only, and none on main', () => {
    const support = actor(['platform.emergency-contact.manage'])
    const titles = (who: AdminActor) => visibleNavigation(who).flatMap(section => section.items.map(item => item.title))
    expect(titles(support)).toContain('Emergency contact alerts')
    expect(titles(actor([]))).not.toContain('Emergency contact alerts')
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    expect(titles(support)).not.toContain('Emergency contact alerts')
    expect(canOpen(navigationItemFor('/admin/emergency-contacts')!, support)).toBe(false)
  })
})

/**
 * Focus moves to a refused field in the commit that marks it refused. From an effect, it moved a task after the render
 * that followed the refusal, and a check made as soon as the field was marked (findBy on a busy runner) found focus
 * elsewhere. The refusal is given outside act, as a fetch's answer arrives, and focus is read at the moment the field
 * is marked.
 */
describe('focus as soon as a refusal is shown', () => {
  const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  const actEnvironment = environment.IS_REACT_ACT_ENVIRONMENT
  afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = actEnvironment })
  const refused = (field: HTMLElement) => () => field.getAttribute('aria-invalid') === 'true' ? field : null

  it('has focus on the alert phone field as soon as it is marked refused', async () => {
    let refuse: (reason: unknown) => void = () => {}
    mocks.api.facility.mockResolvedValue(facility())
    mocks.api.setFacilityAlertPhone.mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject }))
    open(<FacilityDetailPage actor={actor(['platform.facility.manage'])} />)
    const section = await alertPhone()
    const phone = section.getByLabelText('Facility phone number')
    fireEvent.change(phone, { target: { value: '12345' } })
    fireEvent.change(section.getByLabelText('Reason for changing the alert phone number'), { target: { value: 'Front desk line confirmed' } })
    const save = section.getByRole('button', { name: 'Save alert phone number' })
    save.focus()
    fireEvent.click(save)
    const shown = focusWhenShown(refused(phone))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    refuse(new HidApiError(400, 'Enter the facility phone in international format (+234...) or as an 11-digit number starting '
      + 'with 0', { code: 'ADMIN_INVALID_FACILITY_PHONE' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the address field as soon as it is marked refused', async () => {
    let refuse: (reason: unknown) => void = () => {}
    mocks.api.optOutEmergencyContact.mockReturnValueOnce(new Promise((_resolve, reject) => { refuse = reject }))
    open(<EmergencyContactAlertsPage />, '/admin/emergency-contacts', '/admin/emergency-contacts')
    const address = screen.getByLabelText('Email address')
    fireEvent.change(address, { target: { value: 'ada@example' } })
    fireEvent.change(screen.getByLabelText('Reason for stopping these alerts'), { target: { value: 'Recipient called support' } })
    const stop = screen.getByRole('button', { name: 'Stop alerts' })
    stop.focus()
    fireEvent.click(stop)
    const shown = focusWhenShown(refused(address))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    refuse(new HidApiError(400, 'Enter a valid email address', { code: 'EMERGENCY_CONTACT_DESTINATION_INVALID' }))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
