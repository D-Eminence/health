import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { EmergencyContact, PatientProfile } from '../api'
import type { HealthProfile } from '../profileParity'
import { EmergencyContactsCard } from '../routes/AccountSafety'
import { ProfilePage } from '../routes/Portal'
import { described, json, openSection, press, problem, profile, renderPortal, shownText, type Handler, type Sent } from './portalHarness'
import { enterCode } from './codeBoxes'

/**
 * Launch readiness of the profile's Health information and emergency contacts (audit HE-01 to HE-14, 2026-11-04):
 * plain words for every refusal, errors beside what they are about, focus after each action, busy buttons, a designed
 * empty state, and a loading state that does not let the page jump.
 */
const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
beforeEach(() => { novu.on = true })
afterEach(() => { novu.on = true })

const AVAILABILITY = '/identity/me/emergency-contacts/availability'
const LIST = '/identity/me/emergency-contacts'
const ID = 'a0000000-0000-4000-8000-000000000001'
const CHALLENGE = 'b0000000-0000-4000-8000-000000000001'

const contact = (overrides: Partial<EmergencyContact> = {}): EmergencyContact => ({
  contactId: ID, name: 'Chidi Okafor', relationship: 'sibling', channel: 'email', destinationHint: 'c•••@example.com',
  status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true, eligibleForEmergencyNotification: false, version: 1,
  pendingVerification: null, lastNotification: null, ...overrides,
})

interface Backend { offer: { delivery: boolean; channels: string[] }; listed: EmergencyContact[] }
const on = (listed: EmergencyContact[] = []): Backend => ({ offer: { delivery: true, channels: ['email'] }, listed })

function serve(backend: Backend, command: Handler = () => problem(404, 'NOT_FOUND', 'Not served'), at?: string) {
  return renderPortal(<EmergencyContactsCard />, (path, method, body) => path === AVAILABILITY ? json(backend.offer)
    : path === LIST && method === 'GET' ? json(backend.listed) : command(path, method, body), {}, at ? { at } : {})
}
const commands = (sent: Sent[]) => sent.filter(request => request.method === 'POST')
const listReads = (sent: Sent[]) => sent.filter(request => request.method === 'GET' && request.path === LIST).length
const sentCode = () => json({ challengeId: CHALLENGE, expiresAt: '2026-11-04T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
const codeBox = () => screen.getByRole('textbox', { name: /Code from Chidi Okafor/ })

async function fillNewContact(destination: string) {
  await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Ada Obi' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: destination } })
}

describe('HE-01 and HE-10: a refused code', () => {
  it('says a wrong code is wrong, not a permission, and marks the code boxes with it', async () => {
    serve(on([contact()]), path => path.endsWith('/verification') ? sentCode()
      : problem(403, 'EMERGENCY_CONTACT_CODE_INVALID', 'The verification code is not valid'))
    await press(await screen.findByRole('button', { name: /^Send code/ }))
    await waitFor(() => expect(document.activeElement).toBe(codeBox()))
    await enterCode(codeBox(), '123456')
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe('That code isn’t right. Check it with Chidi Okafor and try again.')
    expect(screen.queryByText(/don’t have access/)).toBeNull()
    const first = codeBox()
    expect(first.getAttribute('aria-invalid')).toBe('true')
    expect(described(first)).toContain('That code isn’t right.')
    // The error sits in the code's own form, next to the boxes.
    expect(alert.closest('form')).toBe(first.closest('form'))
    expect(document.activeElement?.closest('fieldset')).toBe(first.closest('fieldset'))
  })

  it('says an expired code has expired, and offers a new code in the form', async () => {
    const { sent } = serve(on([contact()]), path => path.endsWith('/verification') ? sentCode()
      : problem(403, 'EMERGENCY_CONTACT_CODE_EXPIRED', 'The verification code has expired. Send a new code.'))
    await press(await screen.findByRole('button', { name: /^Send code/ }))
    await waitFor(() => expect(document.activeElement).toBe(codeBox()))
    await enterCode(codeBox(), '123456')
    expect(shownText(await screen.findByRole('alert'))).toBe('This code has expired. Send a new code.')
    const again = screen.getByRole('button', { name: /^Send a new code/ })
    // The boxes hold nothing left to correct: focus is on the way forward.
    await waitFor(() => expect(document.activeElement).toBe(again))
    await press(again)
    await waitFor(() => expect(commands(sent).filter(request => request.path.endsWith('/verification'))).toHaveLength(2))
    expect(await screen.findByText(/^Code sent to c•••@example.com/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Send a new code/ })).toBeNull()
    expect(codeBox().getAttribute('aria-invalid')).toBeNull()
  })
})

describe('HE-02: the contact row on a phone', () => {
  it('gives the details a real width, so the status wraps under them rather than squeezing them', async () => {
    serve(on([contact({ name: 'Oluwaseun Adebayo-Ogunleye' })]))
    const name = await screen.findByText('Oluwaseun Adebayo-Ogunleye')
    const details = name.parentElement as HTMLElement
    expect(details.className).toContain('flex-[1_1_12rem]')
    expect(details.className).not.toMatch(/(^|\s)flex-1(\s|$)/)
    expect(name.className).toContain('[overflow-wrap:anywhere]')
  })
})

describe('HE-03: Remove', () => {
  it('moves focus to the question, which names the confirmation', async () => {
    serve(on([contact()]))
    const remove = await screen.findByRole('button', { name: /^Remove/ })
    remove.focus()
    await act(async () => { fireEvent.click(remove) })
    const question = screen.getByText('Remove Chidi Okafor? They won’t get alerts any more.')
    await waitFor(() => expect(document.activeElement).toBe(question))
    expect(screen.getByRole('group', { name: 'Remove Chidi Okafor? They won’t get alerts any more.' })).toBeTruthy()
  })
})

describe('HE-04: a link to emergency contacts where they are not offered', () => {
  it('says so plainly instead of showing nothing', async () => {
    serve({ offer: { delivery: false, channels: ['email'] }, listed: [] }, undefined, '/profile#emergency-contacts')
    expect(await screen.findByText('Emergency contacts aren’t available for your account right now.')).toBeTruthy()
    expect(document.getElementById('emergency-contacts')).not.toBeNull()
  })

  it('stays out of the way on any other visit', async () => {
    const { sent } = serve({ offer: { delivery: false, channels: ['email'] }, listed: [] })
    await waitFor(() => expect(sent.some(request => request.path === AVAILABILITY)).toBe(true))
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText('Emergency contacts aren’t available for your account right now.')).toBeNull()
    expect(document.getElementById('emergency-contacts')).toBeNull()
  })
})

describe('HE-05 and HE-09: add refusals said where they happen', () => {
  it('says a refused address under the field itself', async () => {
    serve(on(), () => problem(400, 'EMERGENCY_CONTACT_DESTINATION_INVALID', 'Enter a valid email address'))
    await fillNewContact('ada@example')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    const field = screen.getByRole('textbox', { name: 'Email address' })
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    expect(described(field)).toBe('Enter a valid email address.')
    const message = screen.getByText('Enter a valid email address.')
    expect(message.parentElement).toBe(field.parentElement)
  })

  it('says a contact already listed, at the field', async () => {
    serve(on([contact()]), () => problem(409, 'EMERGENCY_CONTACT_DUPLICATE', 'This contact is already on your list'))
    await fillNewContact('chidi@example.com')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    const field = screen.getByRole('textbox', { name: 'Email address' })
    await waitFor(() => expect(described(field)).toBe('This person is already one of your emergency contacts.'))
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByText(/couldn’t be added. Try again/)).toBeNull()
  })

  it('says the limit of 5, closes the form and reads the list again', async () => {
    const { sent } = serve(on([contact()]), () => problem(409, 'EMERGENCY_CONTACT_LIMIT_REACHED', 'You can keep up to five emergency contacts'))
    await fillNewContact('ada@example.com')
    const before = listReads(sent)
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect(shownText(await screen.findByRole('alert'))).toBe('You already have 5 emergency contacts. Remove one to add another.')
    expect(screen.queryByRole('textbox', { name: 'Email address' })).toBeNull()
    await waitFor(() => expect(listReads(sent)).toBe(before + 1))
  })

  it('says any other refusal inside the add form, beside its buttons', async () => {
    serve(on(), () => json({ type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'UPSTREAM_UNAVAILABLE',
      detail: 'A required platform service is temporarily unavailable.', retryable: false }, 503))
    await fillNewContact('ada@example.com')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    const alert = await screen.findByRole('alert')
    expect(alert.closest('form')).toBe(screen.getByRole('textbox', { name: 'Name' }).closest('form'))
  })
})

describe('HE-11: no contacts yet', () => {
  it('is a designed empty state that says what will appear', async () => {
    serve(on())
    expect(await screen.findByText('No emergency contacts yet')).toBeTruthy()
    expect(screen.getByText('Add up to 5 people we can tell if your records are opened in an emergency.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
  })
})

describe('HE-12: busy buttons', () => {
  const held = () => {
    let answer!: (response: Response) => void
    return { promise: () => new Promise<Response>(resolve => { answer = resolve }), answer: (response: Response) => answer(response) }
  }

  it('says Saving… on Save contact while the add runs', async () => {
    const request = held()
    serve(on(), () => request.promise())
    await fillNewContact('ada@example.com')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy.getAttribute('aria-busy')).toBe('true')
    await act(async () => { request.answer(json(contact({ name: 'Ada Obi' }), 201)) })
  })

  it('says Sending… on Send code, and Checking… on Verify contact', async () => {
    const request = held()
    serve(on([contact()]), path => path.endsWith('/verification') ? request.promise() : request.promise())
    await press(await screen.findByRole('button', { name: /^Send code/ }))
    expect(screen.getByRole('button', { name: /^Sending…/ }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { request.answer(sentCode()) })
    await waitFor(() => expect(document.activeElement).toBe(codeBox()))
    await enterCode(codeBox(), '123456')
    expect(screen.getByRole('button', { name: 'Checking…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { request.answer(json({ contactId: ID, status: 'verified' })) })
  })

  it('says Removing… on Yes, remove', async () => {
    const request = held()
    serve(on([contact()]), () => request.promise())
    await press(await screen.findByRole('button', { name: /^Remove/ }))
    await press(screen.getByRole('button', { name: 'Yes, remove' }))
    expect(screen.getByRole('button', { name: 'Removing…' }).getAttribute('aria-busy')).toBe('true')
    await act(async () => { request.answer(json({ contactId: ID, status: 'deactivated', replayed: false })) })
  })
})

/* ---- Health information ---- */

const HEALTH = '/ehr/me/health-profile'
const patient: PatientProfile = { ...profile, email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false }
const nothing: HealthProfile = { bloodGroup: null, genotype: null, allergies: null, currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 0, updatedAt: null }

function gateway(health: () => Response | Promise<Response>, put?: (body: unknown) => Response): Handler {
  return (path, method, body) => {
    if (path === '/identity/me' && method === 'GET') return json(patient)
    if (path === '/ehr/me/records' && method === 'GET') return json({ encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 })
    if (path === HEALTH && method === 'GET') return health()
    if (path === HEALTH && method === 'PUT' && put) return put(body)
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const puts = (sent: Sent[]) => sent.filter(request => request.path === HEALTH && request.method === 'PUT')

describe('HE-06: a failed save', () => {
  it('moves focus to the Save button beside the error, not to Blood group, and does not tie the error to Blood group', async () => {
    const saved = { ...nothing, rowVersion: 1, updatedAt: '2026-10-27T10:00:00.000Z' }
    let answer!: (response: Response) => void
    const held = new Promise<Response>(resolve => { answer = resolve })
    const handler = gateway(() => json(saved))
    renderPortal(<ProfilePage />, (path, method, body) => path === HEALTH && method === 'PUT' ? held : handler(path, method, body),
      {}, { parityB3: true })
    const shown = within(await openSection('Health information'))
    fireEvent.change(shown.getByRole('textbox', { name: 'Allergies' }), { target: { value: 'Penicillin' } })
    const save = shown.getByRole('button', { name: 'Save health information' }) as HTMLButtonElement
    await press(save)
    // Chromium takes focus off a button as it becomes disabled; jsdom does not (PortalFocus.test.tsx).
    save.disabled = false; save.blur(); save.disabled = true
    await act(async () => { answer(problem(503, 'UPSTREAM_UNAVAILABLE', 'Down')) })
    await shown.findByRole('alert')
    await waitFor(() => expect(document.activeElement).toBe(shown.getByRole('button', { name: 'Save health information' })))
    expect(shown.getByRole('combobox', { name: 'Blood group' }).getAttribute('aria-describedby')).toBeNull()
  })
})

describe('HE-07: a save conflict', () => {
  it('keeps what the patient typed, shows the latest for the rest, and saves again against the new version', async () => {
    let row: HealthProfile = { ...nothing, rowVersion: 4, updatedAt: '2026-10-27T10:00:00.000Z' }
    let refused = false
    const { sent } = renderPortal(<ProfilePage />, gateway(() => json(row), body => {
      const { expectedVersion, ...fields } = body as HealthProfile & { expectedVersion: number }
      if (!refused) { refused = true; row = { ...row, genotype: 'AC', rowVersion: 5 }; return problem(409, 'VERSION_CONFLICT', 'Stale') }
      row = { ...fields, rowVersion: expectedVersion + 1, updatedAt: '2026-10-28T10:00:00.000Z' }
      return json(row)
    }), {}, { parityB3: true })
    const shown = within(await openSection('Health information'))
    const medicines = 'Metformin 500mg twice a day\nLisinopril 10mg in the morning'
    fireEvent.change(shown.getByRole('combobox', { name: 'Blood group' }), { target: { value: 'B+' } })
    fireEvent.change(shown.getByRole('textbox', { name: 'Current medications' }), { target: { value: medicines } })
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(shownText(await shown.findByRole('alert'))).toBe('Your health information was changed somewhere else, so this wasn’t saved. '
      + 'The latest is shown, and your changes are kept. Check them, then save again.')
    await waitFor(() => expect((shown.getByRole('combobox', { name: 'Genotype' }) as HTMLSelectElement).value).toBe('AC'))
    expect((shown.getByRole('combobox', { name: 'Blood group' }) as HTMLSelectElement).value).toBe('B+')
    expect((shown.getByRole('textbox', { name: 'Current medications' }) as HTMLTextAreaElement).value).toBe(medicines)
    await press(shown.getByRole('button', { name: 'Save health information' }))
    expect(await shown.findByText('Health information saved.')).toBeTruthy()
    expect(puts(sent)[1]?.body).toEqual({ bloodGroup: 'B+', genotype: 'AC', allergies: null, currentMedications: medicines,
      chronicConditions: null, medicalNotes: null, expectedVersion: 5 })
  })
})

describe('HE-08: while Health information is first read', () => {
  it('shows its section as loading, so the page does not jump when it arrives', async () => {
    let answer!: (response: Response) => void
    renderPortal(<ProfilePage />, gateway(() => new Promise<Response>(resolve => { answer = resolve })), {}, { parityB3: true })
    const title = await screen.findByRole('heading', { name: 'Health information', level: 2 })
    expect(within(title).getByRole('button').getAttribute('aria-describedby')).toBe('health-information-state')
    expect(document.getElementById('health-information-state')?.textContent).toBe('Loading…')
    expect(document.getElementById('health-information')?.getAttribute('aria-busy')).toBe('true')
    await act(async () => { answer(json(nothing)) })
    await waitFor(() => expect(document.getElementById('health-information')?.getAttribute('aria-busy')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Health information', level: 2 })).toBeTruthy()
  })

  it('drops the section when Health information is not served (404)', async () => {
    let answer!: (response: Response) => void
    renderPortal(<ProfilePage />, gateway(() => new Promise<Response>(resolve => { answer = resolve })), {}, { parityB3: true })
    await screen.findByRole('heading', { name: 'Health information', level: 2 })
    await act(async () => { answer(problem(404, 'NOT_FOUND', 'Not served')) })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Health information', level: 2 })).toBeNull())
  })
})

describe('HE-14: the 1,000-character limit', () => {
  it('is said on each text, and a save too long to send marks and focuses the longest answer', async () => {
    renderPortal(<ProfilePage />, gateway(() => json(nothing)), {}, { parityB3: true })
    const shown = within(await openSection('Health information'))
    for (const name of ['Allergies', 'Current medications', 'Long-term conditions', 'Notes for my doctors']) {
      expect(described(shown.getByRole('textbox', { name }))).toContain('Up to 1,000 characters.')
    }
    const yoruba = 'ẹ̀'.repeat(500)
    // Current medications is the longest in bytes (2,500); each other answer is 2,497.
    fireEvent.change(shown.getByRole('textbox', { name: 'Current medications' }), { target: { value: yoruba } })
    for (const name of ['Allergies', 'Long-term conditions', 'Notes for my doctors']) {
      fireEvent.change(shown.getByRole('textbox', { name }), { target: { value: `${'ẹ̀'.repeat(499)}ab` } })
    }
    await press(shown.getByRole('button', { name: 'Save health information' }))
    await shown.findByRole('alert')
    const longest = shown.getByRole('textbox', { name: 'Current medications' })
    expect(longest.getAttribute('aria-invalid')).toBe('true')
    expect(described(longest)).toContain('This is too long to save.')
    expect(document.activeElement).toBe(longest)
    fireEvent.change(longest, { target: { value: 'Short' } })
    expect(longest.getAttribute('aria-invalid')).toBeNull()
  })
})
