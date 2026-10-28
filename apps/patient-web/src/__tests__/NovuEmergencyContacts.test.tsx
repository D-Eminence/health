import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { EmergencyContact } from '../api'
import { EmergencyContactsCard } from '../routes/AccountSafety'
import { described, json, press, problem, renderPortal, type Handler, type Sent } from './portalHarness'
import { enterCode } from './codeBoxes'

/**
 * The emergency contacts card on the novu-v1 build, against hid-system #109 (services/identity-api/src/patient-safety
 * on staging-novu-ci-20261005): availability first, then the list. Its refusals are 4xx, because Novu's gateway
 * answers every upstream 502, 503 and 504 as 503 UPSTREAM_UNAVAILABLE.
 */
beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })
afterEach(() => { vi.unstubAllEnvs() })

const AVAILABILITY = '/identity/me/emergency-contacts/availability'
const LIST = '/identity/me/emergency-contacts'
const ID = 'a0000000-0000-4000-8000-000000000001'
const ID2 = 'a0000000-0000-4000-8000-000000000002'
const OFF = { delivery: false, channels: ['email'] }
const shown = (iso: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
const upstream = () => json({ type: 'about:blank', title: 'Service Unavailable', status: 503, code: 'UPSTREAM_UNAVAILABLE',
  detail: 'A required platform service is temporarily unavailable.', retryable: false }, 503)

const contact = (overrides: Partial<EmergencyContact> = {}): EmergencyContact => ({
  contactId: ID, name: 'Chidi Okafor', relationship: 'sibling', channel: 'email', destinationHint: 'c•••@example.com',
  status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true, eligibleForEmergencyNotification: false, version: 1,
  pendingVerification: null, lastNotification: null, ...overrides,
})
const verified = (overrides: Partial<EmergencyContact> = {}) => contact({ status: 'verified', verifiedAt: '2026-10-20T09:00:00Z',
  eligibleForEmergencyNotification: true, ...overrides })

/** What #109 answers now: a command may change it, as Identity would. */
interface Backend { offer: { delivery: boolean; channels: string[] }; listed: EmergencyContact[] }
const on = (listed: EmergencyContact[] = [], channels = ['email']): Backend => ({ offer: { delivery: true, channels }, listed })

function serve(backend: Backend, command: Handler = () => problem(404, 'NOT_FOUND', 'Not served')) {
  return renderPortal(<EmergencyContactsCard />, (path, method, body) => path === AVAILABILITY ? json(backend.offer)
    : path === LIST && method === 'GET' ? json(backend.listed) : command(path, method, body))
}
const reads = (sent: Sent[], path: string) => sent.filter(request => request.method === 'GET' && request.path === path).length
const commands = (sent: Sent[]) => sent.filter(request => request.method === 'POST')
const heading = () => screen.getByRole('heading', { name: 'Emergency contacts' })

async function fillNewContact(destination: string) {
  await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Contact name' }), { target: { value: 'Ada Obi' } })
  fireEvent.change(screen.getByRole('textbox', { name: /^(Email address|Phone number)$/ }), { target: { value: destination } })
}

describe('what a contact is told', () => {
  it('says what #109\'s alert carries, and never the first name only', async () => {
    serve(on([contact()]))
    // One short line (the owner's decision of 2026-10-28): who, where and when, and never medical details.
    const copy = (await screen.findByText(/verified contacts are told who opened it/)).textContent
    expect(copy).toBe('If a health worker opens your record in an emergency, verified contacts are told who opened it, where and when. Never medical details.')
    expect(screen.queryByText(/first name/)).toBeNull()
  })
})

describe('channels: only those Identity can deliver on now', () => {
  it('asks no channel while only email is on, and adds the contact by email', async () => {
    const backend = on()
    const { sent } = serve(backend, () => { backend.listed = [contact({ name: 'Ada Obi' })]; return json(contact({ name: 'Ada Obi' }), 201) })
    await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
    expect(screen.queryByRole('combobox', { name: 'How should we reach them?' })).toBeNull()
    const field = screen.getByRole('textbox', { name: 'Email address' }) as HTMLInputElement
    expect(field.type).toBe('email')
    expect(described(field)).toBe('')
    fireEvent.change(screen.getByRole('textbox', { name: 'Contact name' }), { target: { value: 'Ada Obi' } })
    fireEvent.change(field, { target: { value: ' ada@example.com ' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText('Contact added. Send a verification code so they can be notified in an emergency.')).toBeTruthy()
    expect(commands(sent)).toEqual([{ path: LIST, method: 'POST', body: { name: 'Ada Obi', relationship: 'relative', channel: 'email',
      destination: 'ada@example.com', notifyOnEmergencyAccess: true } }])
  })

  it('asks how to reach them once SMS is on too, in Identity\'s order, and gives the phone format', async () => {
    serve(on([], ['email', 'sms']))
    await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
    const reach = screen.getByRole('combobox', { name: 'How should we reach them?' }) as HTMLSelectElement
    expect([...reach.options].map(option => option.textContent)).toEqual(['Email', 'SMS'])
    expect(reach.value).toBe('email')
    fireEvent.change(reach, { target: { value: 'sms' } })
    const phone = screen.getByRole('textbox', { name: 'Phone number' }) as HTMLInputElement
    expect(phone.type).toBe('tel')
    expect(described(phone)).toBe('For example 0803 123 4567 or +234 803 123 4567.')
  })

  it('reads availability again when a channel is refused on add, and offers only what is left', async () => {
    const backend = on([], ['email', 'sms'])
    const { sent } = serve(backend, () => {
      backend.offer = { delivery: true, channels: ['email'] }
      return problem(400, 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE', 'Emergency contacts cannot be reached on this channel yet')
    })
    await press(await screen.findByRole('button', { name: 'Add emergency contact' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'How should we reach them?' }), { target: { value: 'sms' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Contact name' }), { target: { value: 'Ada Obi' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '0803 123 4567' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Emergency contacts cannot be reached by SMS yet, so this contact was not added.')
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'How should we reach them?' })).toBeNull())
    expect((screen.getByRole('textbox', { name: 'Email address' }) as HTMLInputElement).value).toBe('')
    expect(reads(sent, AVAILABILITY)).toBe(2)
  })
})

describe('the destination field', () => {
  it.each([
    ['EMERGENCY_CONTACT_DESTINATION_INVALID', 'Enter a valid email address'],
    ['VALIDATION_FAILED', 'One or more request fields are invalid.'],
  ])('needs 5 characters after trimming, and says the add\'s %s at the field', async (code, detail) => {
    let answer!: (response: Response) => void
    serve(on(), () => new Promise<Response>(resolve => { answer = resolve }))
    await fillNewContact(' a@b ')
    const field = screen.getByRole('textbox', { name: 'Email address' }) as HTMLInputElement
    const save = screen.getByRole('button', { name: 'Save contact' }) as HTMLButtonElement
    expect(field.minLength).toBe(5)
    expect(save.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'ada@example' } })
    expect(save.disabled).toBe(false)
    await press(save)
    // Chromium takes focus off a button as it becomes disabled; jsdom does not (PortalFocus.test.tsx).
    expect(save.disabled).toBe(true)
    save.disabled = false; save.blur(); save.disabled = true
    await act(async () => { answer(problem(400, code, detail)) })
    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'))
    expect(described(field)).toBe('Enter a valid email address.')
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.')
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'ada@example.com' } })
    expect(field.getAttribute('aria-invalid')).toBeNull()
  })
})

describe('delivery switched off (409 EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE)', () => {
  it('on add: reads availability again, and lists the contacts with Remove only', async () => {
    const backend = on([verified()])
    const { sent } = serve(backend, () => {
      backend.offer = OFF
      return problem(409, 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE', 'Emergency contacts are not yet available')
    })
    await fillNewContact('ada@example.com')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Emergency contacts are not available right now, so this contact was not added.')
    expect(await screen.findByText('Verified · alerts are paused')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Contact name' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add emergency contact' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^Remove/ })).toBeTruthy()
    expect(reads(sent, AVAILABILITY)).toBe(2)
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('on add with no contacts: says so under the heading, and offers nothing else', async () => {
    const backend = on()
    const { sent } = serve(backend, () => {
      backend.offer = OFF
      return problem(409, 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE', 'Emergency contacts are not yet available')
    })
    await fillNewContact('ada@example.com')
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Emergency contacts are not available right now, so this contact was not added.')
    await waitFor(() => expect(reads(sent, LIST)).toBe(2))
    await waitFor(() => expect(screen.queryByText('You have no emergency contacts.')).toBeNull())
    expect(screen.queryByRole('button')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('on send: says the contact stays unverified, and moves to Remove only with alerts paused', async () => {
    const backend = on([contact(), verified({ contactId: ID2, name: 'Ngozi Eze', destinationHint: 'n•••@example.com' })])
    serve(backend, () => {
      backend.offer = OFF
      return problem(409, 'EMERGENCY_CONTACT_DELIVERY_UNAVAILABLE', 'Emergency contact verification is not yet available')
    })
    await press(await screen.findByRole('button', { name: 'Send verification code to Chidi Okafor, c•••@example.com' }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Contact verification is not available yet. This contact stays unverified and will not be notified.')
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Send verification code/ })).toBeNull())
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
    expect(screen.getByText('Verified · alerts are paused')).toBeTruthy()
    expect(screen.queryByText(/will be notified in an emergency/)).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })
})

describe('sending a code', () => {
  it.each([
    ['422 EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE', () => problem(422, 'EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE',
      'The verification code could not be delivered to this contact'), contact(),
    'The code could not be delivered to c•••@example.com. This contact stays unverified and will not be notified. If the email '
      + 'address is wrong, remove this contact and add it again.'],
    ['503 UPSTREAM_UNAVAILABLE', upstream, contact(), 'The code could not be sent right now. This contact stays unverified and '
      + 'will not be notified until it is verified. Try again later.'],
  ])('says what %s means, and keeps focus on Send', async (_label, answer, unverified, text) => {
    serve(on([unverified]), answer)
    const send = await screen.findByRole('button', { name: /^Send verification code/ })
    await press(send)
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(screen.queryByRole('textbox', { name: /Code from/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(send))
  })

  it.each([
    ['accepted', `A code was sent to c•••@example.com. Ask Chidi Okafor to read it to you. It expires ${shown('2026-10-24T10:05:00Z')}.`],
    ['unknown', 'We could not confirm the code was delivered to c•••@example.com. If Chidi Okafor received it, ask them to read it to '
      + `you. It expires ${shown('2026-10-24T10:05:00Z')}.`],
  ])('says when a code delivered as %s expires', async (deliveryOutcome, text) => {
    serve(on([contact()]), () => json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-24T10:05:00Z',
      deliveryOutcome }, 202))
    await press(await screen.findByRole('button', { name: /^Send verification code/ }))
    expect(await screen.findByText(text)).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Code from Chidi Okafor/ })))
  })

  it('says a channel switched off since the code was offered, and offers no code on it', async () => {
    const backend = on([contact({ channel: 'sms', destinationHint: '+234•••••567' })], ['email', 'sms'])
    const { sent } = serve(backend, () => {
      backend.offer = { delivery: true, channels: ['email'] }
      return problem(409, 'EMERGENCY_CONTACT_CHANNEL_UNAVAILABLE', 'This contact cannot be reached on its channel yet')
    })
    await press(await screen.findByRole('button', { name: /^Send verification code/ }))
    expect((await screen.findByRole('alert')).textContent)
      .toBe('Verification codes cannot be sent by SMS yet. This contact stays unverified and will not be notified.')
    expect(await screen.findByText('Verification codes cannot be sent by SMS right now.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Send verification code/ })).toBeNull()
    expect(reads(sent, AVAILABILITY)).toBe(2)
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it.each([
    ['removed elsewhere (404 EMERGENCY_CONTACT_NOT_FOUND)', [] as EmergencyContact[],
      () => problem(404, 'EMERGENCY_CONTACT_NOT_FOUND', 'The emergency contact is unavailable'), 'The emergency contact is unavailable'],
    ['verified elsewhere (409 EMERGENCY_CONTACT_ALREADY_VERIFIED)', [verified()],
      () => problem(409, 'EMERGENCY_CONTACT_ALREADY_VERIFIED', 'This contact is already verified'), 'This contact is already verified'],
  ])('reads the list again for a contact %s, and closes its code form', async (_label, after, refusal, text) => {
    const backend = on([contact()])
    let sends = 0
    const { sent } = serve(backend, () => {
      if (++sends === 1) return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-24T10:05:00Z',
        deliveryOutcome: 'accepted' }, 202)
      backend.listed = after
      return refusal()
    })
    await press(await screen.findByRole('button', { name: /^Send verification code/ }))
    expect(await screen.findByRole('textbox', { name: /Code from Chidi Okafor/ })).toBeTruthy()
    await press(screen.getByRole('button', { name: /^Send verification code/ }))
    expect((await screen.findByRole('alert')).textContent).toBe(text)
    await waitFor(() => expect(reads(sent, LIST)).toBe(2))
    await waitFor(() => expect(screen.queryByText('Not verified · will not be notified')).toBeNull())
    expect(screen.queryByRole('textbox', { name: /Code from/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Send verification code/ })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('drops a pending code that a refused resend has closed', async () => {
    const backend = on([contact({ pendingVerification: { expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'accepted' } })])
    const { sent } = serve(backend, () => {
      // #109 closed the open code ('resend') and the new one ('delivery_failed').
      backend.listed = [contact()]
      return problem(422, 'EMERGENCY_CONTACT_VERIFICATION_UNDELIVERABLE', 'The verification code could not be delivered to this contact')
    })
    expect(await screen.findByText(/A verification code is pending until/)).toBeTruthy()
    const send = screen.getByRole('button', { name: /^Send verification code/ })
    await press(send)
    expect((await screen.findByRole('alert')).textContent).toContain('The code could not be delivered to c•••@example.com.')
    await waitFor(() => expect(screen.queryByText(/A verification code is pending until/)).toBeNull())
    expect(reads(sent, LIST)).toBe(2)
    await waitFor(() => expect(document.activeElement).toBe(send))
  })

  it('says a code is still pending after a reload, and when it expires', async () => {
    serve(on([
      contact({ pendingVerification: { expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'unknown' } }),
      contact({ contactId: ID2, name: 'Ngozi Eze', pendingVerification: { expiresAt: '2026-10-24T10:06:00Z', deliveryOutcome: 'accepted' } }),
    ]))
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText(`A verification code is pending until ${shown('2026-10-24T10:05:00Z')}. We could not confirm the `
      + 'code was delivered. To enter a code here, send a new one.')).toBeTruthy()
    expect(within(items[1]!).getByText(`A verification code is pending until ${shown('2026-10-24T10:06:00Z')}. To enter a code here, `
      + 'send a new one.')).toBeTruthy()
  })
})

describe('a contact with notifications off', () => {
  it('is not said to be notified once added or verified', async () => {
    const quiet = { name: 'Ada Obi', notifyOnEmergencyAccess: false }
    const backend = on()
    serve(backend, path => {
      if (path === LIST) { backend.listed = [contact(quiet)]; return json(contact(quiet), 201) }
      if (path.endsWith('/verification')) {
        return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
      }
      backend.listed = [verified({ ...quiet, eligibleForEmergencyNotification: false, version: 2 })]
      return json({ contactId: ID, status: 'verified' })
    })
    await fillNewContact('ada@example.com')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Notify this contact if emergency access is used' }))
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText('Contact added. Notifications are off for this contact, so they will not be notified in an '
      + 'emergency. To have them notified, send a verification code and turn notifications on in Edit.')).toBeTruthy()
    await press(await screen.findByRole('button', { name: /^Send verification code/ }))
    await enterCode(await screen.findByRole('textbox', { name: /Code from Ada Obi/ }), '482913')
    expect(await screen.findByText('Contact verified. Notifications are off for this contact, so they will not be notified in an '
      + 'emergency. To have them notified, turn notifications on in Edit.')).toBeTruthy()
    expect(await screen.findByText('Verified · notifications off')).toBeTruthy()
    expect(screen.queryByText(/They will be notified/)).toBeNull()
  })
})

describe('a channel switched off since contacts were added on it', () => {
  it('says alerts on it are paused, offers no code on it, and keeps the other channel\'s contacts as they are', async () => {
    serve(on([
      verified({ channel: 'sms', destinationHint: '+234•••••567' }),
      contact({ contactId: ID2, name: 'Ngozi Eze', channel: 'sms', destinationHint: '+234•••••890',
        pendingVerification: { expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'accepted' } }),
      verified({ contactId: 'a0000000-0000-4000-8000-000000000003', name: 'Tunde Bello', destinationHint: 't•••@example.com' }),
    ], ['email']))
    const items = await screen.findAllByRole('listitem')
    const status = (item: HTMLElement, text: string) => within(item).getByText(text).className
    expect(status(items[0]!, 'Verified · alerts by SMS are paused')).toBe('patient-status-tag')
    expect(status(items[1]!, 'Not verified · will not be notified')).toBe('patient-status-tag')
    expect(within(items[1]!).getByText('Verification codes cannot be sent by SMS right now.')).toBeTruthy()
    expect(within(items[1]!).queryByText(/A verification code is pending/)).toBeNull()
    expect(status(items[2]!, 'Verified · will be notified in an emergency')).toBe('patient-status-tag patient-status-tag-ok')
    expect(screen.queryByRole('button', { name: /^Send verification code/ })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Edit/ })).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(3)
  })
})

describe('the last emergency alert', () => {
  it.each([
    // An attempt whose outcome is unknown is retried and may have reached the contact: only 'delivered' is certain.
    ['delivered', 'delivered'], ['failed', 'not confirmed as delivered'], ['expired', 'not confirmed as delivered within 24 hours'],
    ['pending', 'not yet confirmed as delivered'], ['suppressed', 'stopped, because notifications were turned off for this contact'],
  ])('says an alert %s as "%s"', async (status, outcome) => {
    serve(on([verified({ lastNotification: { status, createdAt: '2026-10-23T13:05:00Z' } })]))
    expect(await screen.findByText(`Last emergency alert (${shown('2026-10-23T13:05:00Z')}): ${outcome}`)).toBeTruthy()
  })

  it('says nothing for a contact never alerted', async () => {
    serve(on([verified()]))
    await screen.findByText('Verified · will be notified in an emergency')
    expect(screen.queryByText(/Last emergency alert/)).toBeNull()
  })
})

describe('a contact changed elsewhere (409 EMERGENCY_CONTACT_VERSION_CONFLICT)', () => {
  it('reads the list again, closes the edit, says why, and edits again with the current version', async () => {
    const backend = on([verified({ version: 3 })])
    let changedElsewhere = true
    const { sent } = serve(backend, (_path, _method, body) => {
      if (changedElsewhere) {
        changedElsewhere = false
        backend.listed = [verified({ name: 'Chidi O.', version: 4 })]
        return problem(409, 'EMERGENCY_CONTACT_VERSION_CONFLICT', 'This contact changed. Reload and try again.')
      }
      backend.listed = [verified({ name: (body as { name: string }).name, version: 5 })]
      return json(backend.listed[0])
    })
    await press(await screen.findByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi Okafor-Eze' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This contact was changed in another window or on another device, so '
      + 'your change was not saved. Its current details are shown now: edit it again if you still want to change it.')
    expect(await screen.findByText('Chidi O.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(reads(sent, LIST)).toBe(2)
    expect(reads(sent, AVAILABILITY)).toBe(1)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Edit/ })))

    await press(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi Okafor-Eze' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText('Contact updated.')).toBeTruthy()
    expect(commands(sent).map(request => (request.body as { expectedVersion: number }).expectedVersion)).toEqual([3, 4])
  })
})

describe('an edit the list no longer matches', () => {
  it('reads the list again and closes the edit when the contact was removed elsewhere (404 EMERGENCY_CONTACT_NOT_FOUND)', async () => {
    const backend = on([verified()])
    const { sent } = serve(backend, () => {
      backend.listed = []
      return problem(404, 'EMERGENCY_CONTACT_NOT_FOUND', 'The emergency contact is unavailable')
    })
    await press(await screen.findByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi O.' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The emergency contact is unavailable')
    expect(await screen.findByText('You have no emergency contacts.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()
    expect(reads(sent, LIST)).toBe(2)
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it('closes an edit open on a contact verified in this card, so Edit opens with its new version', async () => {
    const backend = on([contact()])
    const { sent } = serve(backend, (path, _method, body) => {
      if (path.endsWith('/verification')) {
        return json({ challengeId: 'b0000000-0000-4000-8000-000000000001', expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'accepted' }, 202)
      }
      if (path.endsWith('/verification/confirm')) {
        backend.listed = [verified({ version: 2 })]
        return json({ contactId: ID, status: 'verified' })
      }
      backend.listed = [verified({ name: (body as { name: string }).name, version: 3 })]
      return json(backend.listed[0])
    })
    await press(await screen.findByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi O.' } })
    await press(screen.getByRole('button', { name: /^Send verification code/ }))
    await enterCode(await screen.findByRole('textbox', { name: /Code from Chidi Okafor/ }), '482913')
    expect(await screen.findByText('Contact verified. They will be notified if emergency access to your record is used.')).toBeTruthy()
    expect(await screen.findByText('Verified · will be notified in an emergency')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull()

    await press(screen.getByRole('button', { name: /^Edit/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Chidi O.' } })
    await press(screen.getByRole('button', { name: 'Save contact' }))
    expect(await screen.findByText('Contact updated.')).toBeTruthy()
    expect(commands(sent).filter(request => request.path === `${LIST}/${ID}`)
      .map(request => (request.body as { expectedVersion: number }).expectedVersion)).toEqual([2])
  })
})

describe('delivery off with contacts (state B)', () => {
  it('lists them with Remove only, says alerts are paused, and still removes one', async () => {
    const backend: Backend = { offer: OFF, listed: [
      // A code sent just before delivery was switched off: none can be entered or sent now.
      contact({ pendingVerification: { expiresAt: '2026-10-24T10:05:00Z', deliveryOutcome: 'accepted' } }),
      verified({ contactId: ID2, name: 'Ngozi Eze', destinationHint: 'n•••@example.com' }),
      verified({ contactId: 'a0000000-0000-4000-8000-000000000003', name: 'Tunde Bello', destinationHint: 't•••@example.com',
        notifyOnEmergencyAccess: false, eligibleForEmergencyNotification: false }),
    ] }
    const { sent } = serve(backend, path => {
      backend.listed = backend.listed.filter(item => !path.includes(item.contactId))
      return json({ contactId: ID, status: 'deactivated', replayed: false })
    })
    const items = await screen.findAllByRole('listitem')
    expect(within(items[0]!).getByText('Not verified · will not be notified')).toBeTruthy()
    expect(within(items[1]!).getByText('Verified · alerts are paused')).toBeTruthy()
    expect(within(items[2]!).getByText('Verified · notifications off')).toBeTruthy()
    expect(screen.getByText('Alerts are paused. You can only remove contacts for now.')).toBeTruthy()
    expect(screen.queryByText(/will be notified in an emergency/)).toBeNull()
    expect(screen.queryByText(/A verification code is pending/)).toBeNull()
    for (const name of [/^Send verification code/, /^Edit/, /^Add emergency contact/]) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(3)

    await press(screen.getByRole('button', { name: 'Remove Chidi Okafor, c•••@example.com' }))
    await press(screen.getByRole('button', { name: 'Confirm removal' }))
    expect(await screen.findByText('Contact removed. They will no longer be notified.')).toBeTruthy()
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2))
    expect(commands(sent).map(request => request.path)).toEqual([`${LIST}/${ID}/deactivate`])
  })
})

describe('a failed read (state D)', () => {
  it('shows today\'s load error when availability fails, reads no list, and Try again reads both', async () => {
    let failed = false
    let answer!: (response: Response) => void
    const { sent } = renderPortal(<EmergencyContactsCard />, path => {
      if (path === AVAILABILITY) {
        if (!failed) { failed = true; return upstream() }
        return new Promise<Response>(resolve => { answer = resolve })
      }
      return json([contact()])
    })
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.getByRole('alert').textContent).toContain('A required platform service is temporarily unavailable.')
    expect(reads(sent, LIST)).toBe(0)
    await press(retry)
    // The card it was on stays while the read runs.
    await waitFor(() => expect(reads(sent, AVAILABILITY)).toBe(2))
    expect(heading()).toBeTruthy()
    expect(screen.getByText('Loading your contacts…')).toBeTruthy()
    await act(async () => { answer(json({ delivery: true, channels: ['email'] })) })
    expect(await screen.findByText('Chidi Okafor')).toBeTruthy()
    expect([reads(sent, AVAILABILITY), reads(sent, LIST)]).toEqual([2, 1])
    await waitFor(() => expect(document.activeElement).toBe(heading()))
  })

  it.each([
    ['the routes are not served (404)', () => problem(404, 'NOT_FOUND', `Cannot GET /api/v1${AVAILABILITY}`)],
    ['delivery is off for a patient without contacts', () => json(OFF)],
  ])('says so, and focuses the heading, when Try again finds %s', async (_label, answer) => {
    let failed = false
    renderPortal(<EmergencyContactsCard />, path => {
      if (path === AVAILABILITY) {
        if (!failed) { failed = true; return upstream() }
        return answer()
      }
      return json([])
    })
    await press(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(document.activeElement).toBe(heading()))
    expect(screen.getByText('Emergency contacts are not available for your account right now.').closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reads only the list again when the list failed', async () => {
    let failed = false
    const { sent } = renderPortal(<EmergencyContactsCard />, path => {
      if (path === AVAILABILITY) return json({ delivery: true, channels: ['email'] })
      if (!failed) { failed = true; return upstream() }
      return json([contact()])
    })
    await press(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Chidi Okafor')).toBeTruthy()
    expect([reads(sent, AVAILABILITY), reads(sent, LIST)]).toEqual([1, 2])
  })
})
