import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { renderDept } from '../harness'
import {
  CLAIM_CODE_LOST, CLAIM_CODE_ON_SLIP, CONFIRM_UNANSWERED, CREATE_UNANSWERED, CreateHealthId, forgetUnservedHealthIdWays, HEALTH_ID_PROBLEMS, MADE_BEFORE, NO_PASSWORD_YET,
  REQUEST_USED, START_UNAVAILABLE,
} from '../../../../ehr-blue/departments/outreach/CreateHealthId'

/*
 * "Create Health ID" at an outreach event (outreach-api 0119, proposed): only where Outreach serves it, only once the
 * person wants one, by email code or with no email (a claim code); text messages not yet. Fictional data only.
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
  // Each test is a tab of its own: nothing kept from another.
  sessionStorage.clear()
  // And a page of its own: no route found not served by another.
  forgetUnservedHealthIdWays()
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

  it('offers nothing until they want a Health ID, then Email first, No email (even with a phone), and Text message disabled', async () => {
    renderSection()
    expect(within(region()).queryByRole('radio')).toBeNull()
    const box = within(region()).getByRole('checkbox', { name: /They want a Health ID/ }) as HTMLInputElement
    expect(box.checked).toBe(false)
    await want()
    expect(within(region()).getByRole('group', { name: 'How should we make their Health ID?' })).toBeTruthy()
    const radios = within(region()).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map(radio => radio.labels?.[0]?.textContent)).toEqual([
      'EmailWe send a 6-digit code. They read it to you.', 'No emailEven if they have a phone. They get a claim code on their slip.',
      'Text messageNot available yet.'])
    expect(radios[0]!.checked).toBe(true)
    expect(radios[2]!.disabled).toBe(true)
    const email = within(region()).getByRole('textbox', { name: /Their email address/ }) as HTMLInputElement
    expect(email.type).toBe('email')
    // Not remembered by the volunteer's device, nor offered for the next person.
    expect(email.autocomplete).toBe('off')
  })

  it('says under-18s get no Health ID here', () => {
    renderSection({ ...ITEM, ageYears: 15 })
    expect(region().textContent).toContain('A Health ID can’t be created here for under-18s yet.')
    expect(within(region()).queryByRole('checkbox')).toBeNull()
  })

  it('shows a Health ID made before', () => {
    renderSection({ ...ITEM, healthId: 'HID-ABC123', healthIdCreatedByOutreach: true })
    expect(region().textContent).toContain('HID-ABC123')
    // Said plainly that it was made, and what to do: print the slip or write the Health ID on it.
    expect(region().textContent).toContain(MADE_BEFORE)
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
    // 0119 makes it with no password and sends no email after the code: they set one with "Forgot password".
    expect(region().textContent).toContain(NO_PASSWORD_YET)
    expect(NO_PASSWORD_YET).toBe('They have no password yet. To start using it, they open the Health ID app, tap “Forgot password?” and enter the email they gave you. They can add the rest of their details then.')
    expect(region().textContent).not.toContain('They’ll get an email')
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
    await press(within(region()).getByRole('radio', { name: /^No email/ }))
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region()).findByText('HID-UNVER1')).toBeTruthy()
    expect(within(region()).getByText('K7Q-4MZ')).toBeTruthy()
    expect(region().textContent).toContain('They’ll need the Health ID and this code to start using it later.')
  })

  it.each([
    ['OUTREACH_HEALTH_ID_EMAIL_TAKEN', 409], ['OUTREACH_HEALTH_ID_EMAIL_INVALID', 422], ['OUTREACH_HEALTH_ID_TOO_MANY_CODES', 429],
    // 503 OUTREACH_HEALTH_ID_UNAVAILABLE from start has its own words (below): the email couldn't be sent.
    ['OUTREACH_REGISTRATION_REDACTED', 409], ['OUTREACH_REGISTRATION_NOT_FOUND', 404], ['OUTREACH_HEALTH_ID_UNDER_18', 422], ['OUTREACH_HEALTH_ID_NOT_AVAILABLE', 403], ['OUTREACH_HEALTH_ID_PHONE_TAKEN', 409],
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
    expect((within(region()).getByRole('radio', { name: /^No email/ }) as HTMLInputElement).checked).toBe(true)
    expect(region().textContent).toContain('Email codes aren’t available yet. Choose “No email”, or give them the slip.')
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Create Health ID' })).toBeNull())
  })
})

async function sendEmailAgain(email: string) {
  fireEvent.change(within(region()).getByRole('textbox', { name: /Their email address/ }), { target: { value: email } })
  await press(within(region()).getByRole('button', { name: 'Send code' }))
}

/*
 * A reload while waiting for the code (the owner's "no hassle" rule, 14 November 2026): the code box is still there,
 * with the email and the key in use kept for this tab, never the code. Fictional data only.
 */
describe('Create Health ID through a reload', () => {
  function reload() {
    cleanup()
    return renderSection()
  }
  const keptText = () => JSON.stringify({ ...sessionStorage })

  it('keeps the code box after a reload, and confirms the code as before', async () => {
    api.confirmOutreachHealthId.mockResolvedValue({ healthId: 'HID-ZDEMAA', registration: { ...ITEM, healthId: 'HID-ZDEMAA' } })
    renderSection()
    await sendEmail()
    fireEvent.change(within(region()).getByRole('textbox', { name: /6-digit code/ }), { target: { value: '123456' } })
    // What this tab keeps: that a code was sent, where, and the email typed; never the code.
    expect(keptText()).toContain('kemi@example.test')
    expect(keptText()).not.toContain('123456')
    expect(JSON.stringify({ ...localStorage })).not.toContain('kemi@example.test')

    reload()
    expect(region().textContent).toContain('We sent a code to k***@example.test. Ask them to read you the code from the email.')
    const code = within(region()).getByRole('textbox', { name: /6-digit code/ }) as HTMLInputElement
    expect(code.value).toBe('')
    // The wait before another code is kept too.
    expect(within(region()).getByRole('button', { name: /Send a new code in/ }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.change(code, { target: { value: '123456' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(api.confirmOutreachHealthId).toHaveBeenCalledWith(GROUP_ID, 'case-1', '123456', expect.any(String)))
    expect(await within(region()).findByText('HID-ZDEMAA')).toBeTruthy()
    expect(api.startOutreachHealthId).toHaveBeenCalledTimes(1)
    // Made: nothing of the code step is kept any more.
    await waitFor(() => expect(keptText()).not.toContain('kemi@example.test'))
  })

  it('after a reload, sends the code again with the same key when the first answer was lost, so no second code goes', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(STARTED)
    renderSection()
    await sendEmail()
    expect(within(region()).getByRole('textbox', { name: /6-digit code/ })).toBeTruthy()
    const first = api.startOutreachHealthId.mock.calls[0]![3]
    await waitFor(() => expect(keptText()).toContain(first))

    reload()
    await press(within(region()).getByRole('button', { name: 'Send a new code' }))
    await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(2))
    expect(api.startOutreachHealthId.mock.calls[1]![2]).toEqual({ channel: 'email', email: 'kemi@example.test' })
    expect(api.startOutreachHealthId.mock.calls[1]![3]).toBe(first)
  })

  it('“Use a different email” keeps nothing for a reload', async () => {
    renderSection()
    await sendEmail()
    await press(within(region()).getByRole('button', { name: 'Use a different email' }))
    await waitFor(() => expect(keptText()).not.toContain('kemi@example.test'))
    reload()
    expect(within(region()).queryByRole('textbox', { name: /6-digit code/ })).toBeNull()
  })
})

/*
 * A code that has ended (its email could not be sent, or it expired after a lost answer): Health ID refuses its key for
 * good (409 OUTREACH_HEALTH_ID_REQUEST_USED), so the next Send code must make a new key, here and in what a reload keeps.
 * A lost answer keeps the key, so the open code is sent again with no second email. Fictional data only.
 */
describe('Send code after a code has ended', () => {
  const keyOf = (call: number) => api.startOutreachHealthId.mock.calls[call]![3] as string
  const keptText = () => JSON.stringify({ ...sessionStorage })

  it('says the code has ended after REQUEST_USED, and the next Send code uses a new key', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_REQUEST_USED' })).mockResolvedValueOnce(STARTED)
    renderSection()
    await sendEmail()
    expect(await within(region()).findByText(REQUEST_USED)).toBeTruthy()
    expect(REQUEST_USED).toBe('That code has ended. Press Send code to send a new one.')
    await press(within(region()).getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(2))
    expect(keyOf(1)).not.toBe(keyOf(0))
    expect(await within(region()).findByRole('textbox', { name: /6-digit code/ })).toBeTruthy()
  })

  it('after a lost answer and a reload, REQUEST_USED drops the key from what the tab keeps too', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_REQUEST_USED' }))
      .mockResolvedValueOnce(STARTED)
    renderSection()
    await sendEmail()
    const first = keyOf(0)
    await waitFor(() => expect(keptText()).toContain(first))
    cleanup()
    renderSection()
    await press(within(region()).getByRole('button', { name: 'Send a new code' }))
    expect(await within(region()).findByText(REQUEST_USED)).toBeTruthy()
    expect(keyOf(1)).toBe(first)
    // The code has ended: no code box, and the key is gone from this tab's memory.
    expect(within(region()).queryByRole('textbox', { name: /6-digit code/ })).toBeNull()
    await waitFor(() => expect(keptText()).not.toContain(first))
    await press(within(region()).getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(3))
    expect(keyOf(2)).not.toBe(first)
  })

  it('after a 503 at start (the email couldn’t be sent), says so and the next Send code uses a new key', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'OUTREACH_HEALTH_ID_UNAVAILABLE' })).mockResolvedValueOnce(STARTED)
    renderSection()
    await sendEmail()
    expect(await within(region()).findByText(START_UNAVAILABLE)).toBeTruthy()
    expect(START_UNAVAILABLE).toBe('The email couldn’t be sent just now. Press Send code again in a minute, or choose “No email”.')
    await press(within(region()).getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(2))
    expect(keyOf(1)).not.toBe(keyOf(0))
  })

  it.each([[0, 'NETWORK_ERROR'], [408, 'REQUEST_TIMEOUT']])('keeps the key after a lost answer (%s), so the open code is sent again, not a new one', async (status, code) => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(status, 'x', { code })).mockResolvedValueOnce(STARTED)
    renderSection()
    await sendEmail()
    await press(within(region()).getByRole('button', { name: /^Send (code|a new code)$/ }))
    await waitFor(() => expect(api.startOutreachHealthId).toHaveBeenCalledTimes(2))
    expect(keyOf(1)).toBe(keyOf(0))
  })
})

/*
 * Each refusal in its own words, fitting every variant Outreach answers it in (hid-system INTERFACE_CONTRACT §49, §50),
 * never "Please retry" where a retry can't help, and never the API's own detail. Fictional data only.
 */
describe('Create Health ID refusals', () => {
  async function confirmCode() {
    await sendEmail()
    fireEvent.change(within(region()).getByRole('textbox', { name: /6-digit code/ }), { target: { value: '123456' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
  }
  async function createWithNoEmail() {
    await want()
    await press(within(region()).getAllByRole('radio')[1]!)
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
  }
  const DETAIL = 'Internal: identity_outreach_health_id_start refused'

  it.each([
    ['start', 'OUTREACH_HEALTH_ID_PHONE_TAKEN', 409,
      'This phone number is already on a Health ID. If it’s their own, ask them to sign in. If the phone is shared, they can’t get one here today. Give them their slip.'],
    ['start', 'OUTREACH_HEALTH_ID_TOO_MANY_CODES', 429,
      'Too many codes today. Try another email or choose “No email”. If neither works, give them their slip.'],
    ['start', 'OUTREACH_ORGANISER_SUSPENDED', 423, 'Health ID has paused this group. Give them their slip.'],
    ['confirm', 'OUTREACH_HEALTH_ID_EMAIL_TAKEN', 409,
      'This email is already used by a Health ID or another account. If it’s their own Health ID, they already have one. If not, use another email or choose “No email”.'],
    ['confirm', 'OUTREACH_HEALTH_ID_TOO_MANY_TRIES', 429,
      'Too many wrong codes. Press Send a new code. If this shows again, use another email or choose “No email”.'],
    ['confirm', 'OUTREACH_ORGANISER_SUSPENDED', 423, 'Health ID has paused this group. Give them their slip.'],
    ['unverified', 'OUTREACH_HEALTH_ID_NAME_INVALID', 422,
      'The name on this registration can’t be used for a Health ID. Check it with them, then register them again with their name written correctly.'],
    ['unverified', 'OUTREACH_ORGANISER_SUSPENDED', 423, 'Health ID has paused this group. Give them their slip.'],
    ['unverified', 'OUTREACH_HEALTH_ID_PHONE_TAKEN', 409,
      'This phone number is already on a Health ID. If it’s their own, ask them to sign in. If the phone is shared, they can’t get one here today. Give them their slip.'],
  ])('at %s, says %s in its own words, never the API’s detail', async (call, code, status, words) => {
    const refusal = new HidApiError(status, DETAIL, { code, detail: DETAIL })
    if (call === 'start') api.startOutreachHealthId.mockRejectedValue(refusal)
    if (call === 'confirm') api.confirmOutreachHealthId.mockRejectedValue(refusal)
    if (call === 'unverified') api.createUnverifiedOutreachHealthId.mockRejectedValue(refusal)
    renderSection()
    if (call === 'start') await sendEmail()
    if (call === 'confirm') await confirmCode()
    if (call === 'unverified') await createWithNoEmail()
    expect(await within(region()).findByText(words)).toBeTruthy()
    expect(region().textContent).not.toContain(DETAIL)
    expect(region().textContent).not.toContain('Please retry')
  })

  it('after “Use a different email”, holds Send code for the same wait as Send a new code', async () => {
    renderSection()
    await sendEmail()
    await press(within(region()).getByRole('button', { name: 'Use a different email' }))
    fireEvent.change(within(region()).getByRole('textbox', { name: /Their email address/ }), { target: { value: 'kemi.b@example.test' } })
    const send = within(region()).getByRole('button', { name: /^Send code in \d+ s$/ })
    expect(send.getAttribute('aria-disabled')).toBe('true')
    await press(send)
    expect(api.startOutreachHealthId).toHaveBeenCalledTimes(1)
  })
})

/*
 * "No email" (0120): the claim code is answered once only. A create whose answer was lost says so and never shows the
 * Health ID as complete without its code; a registration whose Health ID is unclaimed, with no code in this tab, says
 * the code was lost. A route not served is remembered for the page, not asked again on every case. Fictional data only.
 */
describe('Create Health ID with no email: a lost answer', () => {
  async function createWithNoEmail() {
    await want()
    await press(within(region()).getByRole('radio', { name: /^No email/ }))
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
  }

  it.each([[0, 'NETWORK_ERROR'], [408, 'REQUEST_TIMEOUT']])('after a lost answer (%s), says it couldn’t tell; then “already created” says the code was lost', async (status, code) => {
    api.createUnverifiedOutreachHealthId.mockRejectedValueOnce(new HidApiError(status, 'x', { code }))
      .mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_ALREADY_CREATED', details: { healthId: 'HID-UNVER1' } }))
    renderSection()
    await createWithNoEmail()
    expect(await within(region()).findByText(CREATE_UNANSWERED)).toBeTruthy()
    expect(CREATE_UNANSWERED).toBe('We couldn’t tell if the Health ID was made. Keep the person with you and press Create Health ID again when you have signal.')
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region()).findByText('HID-UNVER1')).toBeTruthy()
    expect(region().textContent).toContain(CLAIM_CODE_LOST)
    expect(CLAIM_CODE_LOST).toBe('This Health ID was made, but its claim code can’t be shown again. Write the Health ID on their slip. They will need Health ID support to start using it. Don’t ask them to sign up again.')
    expect(region().textContent).not.toContain('Write this on their slip.')
  })

  it('for an under-18, does not say “Make their Health ID now” above the refusal', () => {
    renderSection({ ...ITEM, ageYears: 15 })
    expect(region().textContent).not.toContain('Make their Health ID now from this registration.')
    renderSection({ ...ITEM, id: 'case-2', ageYears: 18 })
    expect(screen.getAllByRole('region', { name: 'Create Health ID' })[1]!.textContent).toContain('Make their Health ID now from this registration.')
  })

  it('a refusal goes when “They want a Health ID” is unticked', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'OUTREACH_HEALTH_ID_UNAVAILABLE' }))
    renderSection()
    await sendEmail()
    await waitFor(() => expect(region().querySelector('[role="alert"]')).toBeTruthy())
    const said = region().querySelector('[role="alert"]')!.textContent!
    await press(within(region()).getByRole('checkbox', { name: /They want a Health ID/ }))
    expect(region().textContent).not.toContain(said)
  })

  it('for an unclaimed Health ID with no code in this tab (another phone, or later), says to check the slip, not that the code was lost', () => {
    renderSection({ ...ITEM, healthId: 'HID-UNVER1', healthIdCreatedByOutreach: true, healthIdStatus: 'unclaimed' })
    expect(region().textContent).toContain(CLAIM_CODE_ON_SLIP)
    expect(CLAIM_CODE_ON_SLIP).toBe('Made with no email. Its claim code was shown once, when it was made. Check it is on their slip.')
    expect(region().textContent).not.toContain(CLAIM_CODE_LOST)
    expect(region().textContent).not.toContain(MADE_BEFORE)
  })

  it('a 503 from Outreach when Identity did not answer in time counts as unanswered: “already created” next says the code was lost', async () => {
    api.createUnverifiedOutreachHealthId.mockRejectedValueOnce(new HidApiError(503, 'x', { code: 'OUTREACH_HEALTH_ID_UNAVAILABLE' }))
      .mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_ALREADY_CREATED', details: { healthId: 'HID-UNVER1' } }))
    renderSection()
    await want()
    await press(within(region()).getByRole('radio', { name: /^No email/ }))
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region()).findByText(CREATE_UNANSWERED)).toBeTruthy()
    await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
    expect(await within(region()).findByText(CLAIM_CODE_LOST)).toBeTruthy()
  })

  it('“already created” at Send code leaves how it was made to the registration read again (by email: the Forgot password line)', async () => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_ALREADY_CREATED', details: { healthId: 'HID-ZDEMAA' } }))
    renderSection()
    await sendEmail()
    await waitFor(() => expect(region().textContent).toContain('HID-ZDEMAA'))
    // Not "made with no email": the case view's slip takes how it was made from the registration read again.
    expect(onCreated).toHaveBeenLastCalledWith({ healthId: 'HID-ZDEMAA', byEmail: undefined })
  })

  it('says nothing of a lost code for a Health ID made by email', () => {
    renderSection({ ...ITEM, healthId: 'HID-ZDEMAA', healthIdCreatedByOutreach: true, healthIdStatus: 'verified' })
    expect(region().textContent).not.toContain(CLAIM_CODE_LOST)
    expect(region().textContent).toContain(MADE_BEFORE)
  })

  it('remembers for the page that “No email” is not served, so the next case does not offer it again', async () => {
    api.createUnverifiedOutreachHealthId.mockRejectedValue(new HidApiError(404, 'x', { code: 'API_ROUTE_NOT_FOUND' }))
    renderSection()
    await createWithNoEmail()
    await waitFor(() => expect(within(region()).queryByRole('radio', { name: /^No email/ })).toBeNull())
    cleanup()
    renderSection({ ...ITEM, id: 'case-2' })
    await want()
    expect(within(region()).queryByRole('radio', { name: /^No email/ })).toBeNull()
    expect(within(region()).getByRole('radio', { name: /^Email/ })).toBeTruthy()
    expect(api.createUnverifiedOutreachHealthId).toHaveBeenCalledTimes(1)
  })
})

describe('Send code: a lost answer', () => {
  it.each([[0, 'NETWORK_ERROR'], [408, 'REQUEST_TIMEOUT']])('shows the code box after a lost answer (%s): the code may have been sent', async (status, code) => {
    api.startOutreachHealthId.mockRejectedValueOnce(new HidApiError(status, 'x', { code }))
    renderSection()
    await sendEmail()
    expect(await within(region()).findByRole('textbox', { name: /6-digit code/ })).toBeTruthy()
    expect(region().textContent).toContain('We couldn’t tell if the code was sent. If an email arrived, ask them for the code. If not, send the code again.')
  })
})

describe('Confirm: an answer that can’t be trusted', () => {
  it.each([[503, 'OUTREACH_HEALTH_ID_UNAVAILABLE'], [0, 'NETWORK_ERROR'], [408, 'REQUEST_TIMEOUT']])('after %s, says we couldn’t tell if it was made, and to press Confirm again', async (status, code) => {
    api.confirmOutreachHealthId.mockRejectedValueOnce(new HidApiError(status, 'x', { code }))
      .mockRejectedValueOnce(new HidApiError(409, 'x', { code: 'OUTREACH_HEALTH_ID_ALREADY_CREATED', details: { healthId: 'HID-ZDEMAA' } }))
    renderSection()
    await sendEmail()
    fireEvent.change(within(region()).getByRole('textbox', { name: /6-digit code/ }), { target: { value: '123456' } })
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    expect(await within(region()).findByText(CONFIRM_UNANSWERED)).toBeTruthy()
    expect(CONFIRM_UNANSWERED).toBe('We couldn’t tell if the Health ID was made. Press Confirm again.')
    expect(region().textContent).not.toContain('Give them the slip')
    await press(within(region()).getByRole('button', { name: 'Confirm' }))
    // Made by the code just proved: shown as made by email.
    expect(await within(region()).findByText('HID-ZDEMAA')).toBeTruthy()
    expect(region().textContent).toContain(NO_PASSWORD_YET)
  })
})

describe('Copy', () => {
  it('copies the Health ID only, never the claim code, onto a phone others may share', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      api.createUnverifiedOutreachHealthId.mockResolvedValue({ healthId: 'HID-UNVER1', claimCode: 'K7Q-4MZ', registration: { ...ITEM, healthId: 'HID-UNVER1' } })
      renderSection()
      await want()
      await press(within(region()).getByRole('radio', { name: /^No email/ }))
      await press(within(region()).getByRole('button', { name: 'Create Health ID' }))
      expect(await within(region()).findByText('K7Q-4MZ')).toBeTruthy()
      await press(within(region()).getByRole('button', { name: 'Copy' }))
      expect(writeText).toHaveBeenCalledWith('HID-UNVER1')
      expect(JSON.stringify(writeText.mock.calls)).not.toContain('K7Q-4MZ')
    } finally {
      Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
