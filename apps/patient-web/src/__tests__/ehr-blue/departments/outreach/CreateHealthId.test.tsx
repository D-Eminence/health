import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import { CreateHealthId, HEALTH_ID_PROBLEMS } from '../../../../ehr-blue/departments/outreach/CreateHealthId'

/*
 * "Create Health ID" at an outreach event (outreach-api 0119, proposed): only where Outreach serves it, only once the
 * person wants one, by email code or unverified with a claim code; text messages not yet. Fictional data only.
 */

const GROUP_ID = '0e7c0000-0000-4000-8000-000000000001'
vi.mock('../../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../harness')
  return { useStaff: () => staffContext(fakeFacility(['outreach.registration.read', 'outreach.registration.write'], { id: GROUP_ID, roles: ['outreach_volunteer'] })) }
})
const api = vi.hoisted(() => ({ startOutreachHealthId: vi.fn(), confirmOutreachHealthId: vi.fn(), createUnverifiedOutreachHealthId: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

const ITEM = { id: 'case-1', status: 'identity_resolution_pending', fullName: 'Kemi Balogun', ageYears: 30, sex: 'female', rowVersion: 1, healthId: null }
const STARTED = { channel: 'email', expiresAt: '2026-11-14T10:10:00.000Z', destinationHint: 'k***@example.test', resendAfterSeconds: 60 }
const onCreated = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  api.startOutreachHealthId.mockResolvedValue(STARTED)
})

async function press(button: HTMLElement) {
  await act(async () => { fireEvent.click(button) })
}
function renderSection(item: Record<string, unknown> = ITEM, canWrite = true) {
  return renderDept(<CreateHealthId facilityId={GROUP_ID} item={item as never} canWrite={canWrite} onCreated={onCreated} />)
}
const region = () => screen.getByRole('region', { name: 'Create Health ID' })
async function want() {
  await press(within(region()).getByRole('checkbox', { name: /They want a Health ID/ }))
}
async function sendEmail(email = 'kemi@example.test') {
  await want()
  fireEvent.change(within(region()).getByRole('textbox', { name: /Their email address/ }), { target: { value: email } })
  await press(within(region()).getByRole('button', { name: 'Send code' }))
}

describe('Create Health ID', () => {
  it('is not shown where Outreach does not serve it (the registration carries no healthId)', () => {
    const { healthId: _none, ...older } = ITEM
    renderSection(older)
    expect(screen.queryByRole('region', { name: 'Create Health ID' })).toBeNull()
  })

  it('offers nothing until they want a Health ID, then Email first, No email or phone, and Text message disabled', async () => {
    renderSection()
    expect(within(region()).queryByRole('radio')).toBeNull()
    const box = within(region()).getByRole('checkbox', { name: /They want a Health ID/ }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await want()
    const radios = within(region()).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(radio => radio.labels?.[0]?.textContent)).toEqual([
      'EmailThey read you the code from the email.', 'No email or phoneA Health ID with a claim code for their slip.',
      'Text messageText messages aren’t available yet.'])
    expect(radios[0]!.checked).toBe(true)
    expect(radios[2]!.disabled).toBe(true)
    const email = within(region()).getByRole('textbox', { name: /Their email address/ }) as HTMLInputElement
    expect(email.type).toBe('email')
    expect(email.autocomplete).toBe('email')
  })

  it('says under-18s get no Health ID here', () => {
    renderSection({ ...ITEM, ageYears: 15 })
    expect(region().textContent).toContain('A Health ID can’t be created here for under-18s yet.')
    expect(within(region()).queryByRole('checkbox')).toBeNull()
  })

  it('shows a Health ID made before', () => {
    renderSection({ ...ITEM, healthId: 'HID-ABC123', healthIdCreatedByOutreach: true })
    expect(region().textContent).toContain('HID-ABC123')
    expect(region().textContent).toContain('Write this on their slip.')
  })

  it('sends a code to the email, confirms it, and shows the Health ID big', async () => {
    api.confirmOutreachHealthId.mockResolvedValue({ healthId: 'HID-ZDEMAA', registration: { ...ITEM, healthId: 'HID-ZDEMAA' } })
    renderSection()
    await sendEmail()
    expect(api.startOutreachHealthId).toHaveBeenCalledWith(GROUP_ID, 'case-1', { channel: 'email', email: 'kemi@example.test' }, expect.stringMatching(/^[0-9a-f-]{36}$/))
    expect(region().textContent).toContain('We sent a code to k***@example.test. Ask them to read you the code from the email.')
    const code = within(region()).getByRole('textbox', { name: /6-digit code/ }) as HTMLInputElement
    expect(code.inputMode).toBe('numeric')
    expect(code.autocomplete).toBe('one-time-code')
    expect((within(region()).getByRole('button', { name: /Send a new code in/ })).getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(code, { target: { value: '123456' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.confirmOutreachHealthId).toHaveBeenCalledWith(GROUP_ID, 'case-1', '123456', expect.any(String)))
    expect(await within(region()).findByText('HID-ZDEMAA')).toBeTruthy()
    expect(region().textContent).toContain('Write this on their slip.')
    expect(region().textContent).toContain('They’ll get an email to set a password.')
    expect(onCreated).toHaveBeenCalled()
  })

  it('checks the email and the code before sending', async () => {
    renderSection()
    await sendEmail('not-an-email')
    expect(within(region()).getByText('Enter their email address, like name@example.com.')).toBeTruthy()
    expect(api.startOutreachHealthId).not.toHaveBeenCalled()
    await sendEmailAgain('kemi@example.test')
    fireEvent.change(within(region()).getByRole('textbox', { name: /6-digit code/ }), { target: { value: '123' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    expect(within(region()).getByText('Enter the 6-digit code from the email.')).toBeTruthy()
    expect(api.confirmOutreachHealthId).not.toHaveBeenCalled()
  })

  it('a new key for each code sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      api.startOutreachHealthId.mockResolvedValue({ ...STARTED, resendAfterSeconds: 1 })
      renderSection()
      await sendEmail()
      await act(async () => { vi.advanceTimersByTime(1500) })
      await press(await within(region()).findByRole('button', { name: 'Send a new code' }))
      await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(2))
      expect(api.startOutreachHealthId.mock.calls[1]![3]).not.toBe(api.startOutreachHealthId.mock.calls[0]![3])
    } finally { vi.useRealTimers() }
  })

  it('makes an unverified Health ID, with its claim code shown once', async () => {
    api.createUnverifiedOutreachHealthId.mockResolvedValue({ healthId: 'HID-UNVER1', claimCode: 'K7Q-4MZ', registration: { ...ITEM, healthId: 'HID-UNVER1' } })
    renderSection()
    await want()
    await press(within(region()).getByRole('radio', { name: /No email or phone/ }))
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region()).findByText('HID-UNVER1')).toBeTruthy()
    expect(within(region()).getByText('K7Q-4MZ')).toBeTruthy()
    expect(region().textContent).toContain('They’ll need the Health ID and this code to start using it later.')
  })

  it.each([
    ['OUTREACH_HEALTH_ID_EMAIL_TAKEN', 409], ['OUTREACH_HEALTH_ID_EMAIL_INVALID', 422], ['OUTREACH_HEALTH_ID_TOO_MANY_CODES', 429],
    ['OUTREACH_HEALTH_ID_UNAVAILABLE', 503], ['OUTREACH_REGISTRATION_REDACTED', 409], ['OUTREACH_REGISTRATION_NOT_FOUND', 404],
    ['OUTREACH_HEALTH_ID_UNDER_18', 422], ['OUTREACH_HEALTH_ID_NOT_AVAILABLE', 403], ['OUTREACH_HEALTH_ID_PHONE_TAKEN', 409],
  ])('says %s from start in plain words', async (code, status) => {
    api.startOutreachHealthId.mockRejectedValue(new HidApiError(status, 'x', { code }))
    renderSection()
    await sendEmail()
    expect(await within(region()).findByText(HEALTH_ID_PROBLEMS[code]!)).toBeTruthy()
  })

  it.each([
    ['OUTREACH_HEALTH_ID_CODE_INVALID', 422], ['OUTREACH_HEALTH_ID_CODE_EXPIRED', 422], ['OUTREACH_HEALTH_ID_TOO_MANY_TRIES', 429],
    ['OUTREACH_HEALTH_ID_EMAIL_TAKEN', 409], ['OUTREACH_REGISTRATION_REDACTED', 409],
  ])('says %s from confirm in plain words', async (code, status) => {
    api.confirmOutreachHealthId.mockRejectedValue(new HidApiError(status, 'x', { code }))
    renderSection()
    await sendEmail()
    fireEvent.change(within(region()).getByRole('textbox', { name: /6-digit code/ }), { target: { value: '123456' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    expect(await within(region()).findByText(HEALTH_ID_PROBLEMS[code]!)).toBeTruthy()
  })

  it('shows the Health ID a 409 OUTREACH_HEALTH_ID_ALREADY_CREATED names', async () => {
    api.startOutreachHealthId.mockRejectedValue(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_ALREADY_CREATED', details: { healthId: 'HID-OLD001' } }))
    renderSection()
    await sendEmail()
    expect(await within(region()).findByText('HID-OLD001')).toBeTruthy()
    expect(onCreated).toHaveBeenCalled()
  })

  it('hides each way on its own when its route is not served, and the section when neither is', async () => {
    api.startOutreachHealthId.mockRejectedValue(new HidApiError(404, 'x', { code: 'API_ROUTE_NOT_FOUND' }))
    api.createUnverifiedOutreachHealthId.mockRejectedValue(new HidApiError(404, 'x', { code: 'NOT_FOUND' }))
    renderSection()
    await sendEmail()
    await waitFor(() => expect(within(region()).queryByRole('radio', { name: /^Email/ })).toBeNull())
    expect((within(region()).getByRole('radio', { name: /No email or phone/ }) as HTMLInputElement).checked).toBe(true)
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Health ID' })).toBeNull())
  })
})

async function sendEmailAgain(email: string) {
  fireEvent.change(within(region()).getByRole('textbox', { name: /Their email address/ }), { target: { value: email } })
  await press(within(region()).getByRole('button', { name: 'Send code' }))
}
