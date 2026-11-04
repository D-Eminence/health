import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createCardReceiverApi, type CardReceiverApi } from '../cardReceiverApi'
import { CardPrivacyPage, CardReceiverPage, CardStopPage } from '../routes/CardReceiver'
import { enterCode } from './codeBoxes'
import { json, problem, shownText } from './portalHarness'

/**
 * Step 8 (hid-system 0118, switched off until legal signs off): the page a card link opens, /card#<token>. It sends
 * nothing about the token until the person asks for a code; the token leaves the address bar at once and travels only
 * in POST bodies; every read after the code names its own view (X-Card-View), so two cards in one browser never mix;
 * nothing is kept in browser storage; a reload needs a new code; it covers itself after 5 minutes idle; and no answer
 * signs anyone in or out (the page never calls auth/ and never sends a patient's CSRF token).
 */
const flag = vi.hoisted(() => ({ on: true }))
vi.mock('../cardSharesFlag', () => ({ cardSharesEnabled: () => flag.on }))
vi.mock('../Turnstile', () => ({
  Turnstile: ({ action, onTokenChange }: { action: string; onTokenChange: (token: string | null) => void }) =>
    <button type="button" data-action={action} onClick={() => onTokenChange('turnstile-token')}>Complete check</button>,
}))

const TOKEN = 'k3Jx9QpLm2Vt7RwYz5NcBd8FgHs4Ae6UoP1qR2sT3uV' // 43 characters, base64url
const VIEW = 'view-7d2c'
const card = (overrides: Record<string, unknown> = {}) => ({
  viewId: VIEW, card: { fullName: 'Chiamaka Obi', healthId: 'HID-CHI4821', ninVerified: true, hasPhoto: false },
  scope: 'card_and_records', sharedBy: 'Chiamaka', recipientHint: 'd•••@gmail.com', reference: 'K7P2-QX9M',
  expiresAt: '2026-11-05T09:04:00.000Z', viewExpiresAt: '2026-11-04T10:34:00.000Z', ...overrides,
})
const records = (overrides: Record<string, unknown> = {}) => ({
  encounters: [{ id: 'enc-1', facilityId: 'f-1', encounterType: 'outpatient', status: 'completed', startedAt: '2026-10-20T09:00:00.000Z', endedAt: null }],
  notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'f-1', noteType: 'progress', title: 'Malaria review', status: 'signed', revisionNo: 1,
    content: 'Fever resolving.', signedAt: '2026-10-20T10:00:00.000Z' }],
  importedRecords: [], importedHealthProfile: null,
  healthProfile: { bloodGroup: 'O+', genotype: 'AS', allergies: 'Penicillin', currentMedications: null, chronicConditions: null, medicalNotes: null },
  patientEntries: [{ id: 'pe-1', source: 'patient', kind: 'medicine', title: 'Metformin 500mg', facilityName: null, occurredOn: '2026-09-01',
    notes: null, createdAt: '2026-09-01T08:00:00.000Z', documents: [{ id: 'd-1', fileName: 'prescription.jpg', mediaType: 'image/jpeg', sizeBytes: 2048,
      status: 'available', scanStatus: 'clean', createdAt: '2026-09-01T08:00:00.000Z' }] }],
  patientEntriesMore: false, diagnoses: [], prescriptions: [], labRequests: [], vitals: [], documents: [], limit: 50, ...overrides,
})

interface Seen { path: string; method: string; body: unknown; headers: Headers; url: string; credentials: RequestCredentials | undefined }
type Handler = (path: string, method: string, body: unknown, headers: Headers) => Response | Promise<Response>

function receiverApi(handler: Handler): { api: CardReceiverApi; seen: Seen[] } {
  const seen: Seen[] = []
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = new URL(url).pathname.replace('/api/v1/', '/')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) as unknown : null
    const headers = new Headers(init?.headers)
    seen.push({ path, method, body, headers, url, credentials: init?.credentials })
    return handler(path, method, body, headers)
  }) as typeof fetch
  const client = createRegisteredBrowserClient(createApiClient({ baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl }), 'patient-web')
  return { api: createCardReceiverApi(client), seen }
}

/** A backend serving the card routes, with each answer overridable. */
function served(overrides: Partial<Record<string, Handler>> = {}): Handler {
  return (path, method, body, headers) => {
    const own = overrides[`${method} ${path}`]
    if (own) return own(path, method, body, headers)
    if (path === '/card-share/availability') return new Response(null, { status: 204 })
    if (path === '/card-share/code') return json({ sentTo: 'd•••@gmail.com', expiresInSeconds: 600, resendAfterSeconds: 60 }, 202)
    if (path === '/card-share/verify') return json(card())
    if (path === '/card-share/view') return json(card())
    if (path === '/card-share/records') return json(records())
    if (path === '/card-share/end-view') return new Response(null, { status: 204 })
    if (path === '/card-share/stop-emails') return json({ stopped: (body as { scope: string }).scope })
    return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
  }
}

function open(at: string, handler: Handler, page: 'card' | 'stop' = 'card') {
  window.history.replaceState(null, '', at)
  const { api, seen } = receiverApi(handler)
  const view = render(page === 'card' ? <CardReceiverPage api={api} /> : <CardStopPage api={api} />)
  return { seen, view }
}

const tokenAnywhere = (seen: Seen[]) => seen.filter(item => item.url.includes(TOKEN) || [...item.headers.values()].some(value => value.includes(TOKEN)))
const focused = () => document.activeElement

async function startToCode(handler: Handler = served()) {
  const result = open(`/card#${TOKEN}`, handler)
  await screen.findByRole('heading', { level: 1, name: 'Open a shared Health ID card' })
  fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })) })
  await screen.findByRole('heading', { level: 1, name: 'Enter the code we emailed' })
  return result
}

async function openCard(handler: Handler = served()) {
  const result = await startToCode(handler)
  await enterCode(screen.getByRole('textbox', { name: /Digit 1 of 6/ }), '482913')
  await screen.findByRole('heading', { level: 1, name: 'Chiamaka Obi’s Health ID card' })
  return result
}

beforeEach(() => { flag.on = true; document.cookie = 'hid_access_csrf=patient-csrf; path=/' })
afterEach(() => {
  vi.useRealTimers()
  document.cookie = 'hid_access_csrf=; path=/; max-age=0'
  window.history.replaceState(null, '', '/')
})

describe('while switched off', () => {
  it('is today\'s dormant page, sends nothing and leaves the address as it is', async () => {
    flag.on = false
    const { seen } = open(`/card#${TOKEN}`, served())
    expect(screen.getByRole('heading', { level: 1, name: 'This isn’t available yet' })).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([])
    expect(document.body.textContent).not.toContain(TOKEN)
  })

  it('stays dormant where the backend answers availability 404, and sends nothing else', async () => {
    const { seen } = open(`/card#${TOKEN}`, () => problem(404, 'NOT_FOUND', 'Cannot GET'))
    expect(await screen.findByRole('heading', { level: 1, name: 'This isn’t available yet' })).toBeTruthy()
    expect(seen.map(item => `${item.method} ${item.path}`)).toEqual(['GET /card-share/availability'])
    expect(tokenAnywhere(seen)).toEqual([])
  })
})

describe('opening the link', () => {
  it('takes the token out of the address at once, sends nothing about it on load, and asks before sending a code', async () => {
    const { seen } = open(`/card#${TOKEN}`, served())
    // Out of the address bar (and history) before anything else, the Turnstile check included.
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/card')
    const title = await screen.findByRole('heading', { level: 1, name: 'Open a shared Health ID card' })
    expect(document.title).toBe('Shared Health ID card · Health ID')
    expect(screen.getByText('Someone shared their Health ID card with you. To open it, we’ll email a 6-digit code to the address this link was sent to.')).toBeTruthy()
    expect(screen.getByText(/Read only\. The person who shared it is told each time it’s opened\. If this reached you by mistake, close this page\./)).toBeTruthy()
    expect(screen.getByText('On a shared computer, press End view when you’re done.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Complete check' }).getAttribute('data-action')).toBe('card-share-code')
    // The button waits for the security check.
    expect((screen.getByRole('button', { name: 'Email me a code' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(focused()).toBe(title))
    expect(seen.map(item => `${item.method} ${item.path}`)).toEqual(['GET /card-share/availability'])
    expect(tokenAnywhere(seen)).toEqual([])
    // Links to the privacy notice and to stop these emails, on the page itself.
    expect(screen.getByRole('link', { name: 'How we use your email address' }).getAttribute('href')).toBe('/card/privacy')
    expect(screen.getByRole('button', { name: 'Stop these emails' })).toBeTruthy()
  })

  it('sends the token only in the code request\'s body, and says where the code went', async () => {
    const { seen } = await startToCode()
    const code = seen.find(item => item.path === '/card-share/code')!
    expect(code.method).toBe('POST')
    expect(code.body).toEqual({ token: TOKEN, turnstileToken: 'turnstile-token' })
    expect(code.url).toBe('https://gateway.test/api/v1/card-share/code')
    expect(tokenAnywhere(seen).map(item => item.path)).toEqual(['/card-share/code'])
    expect(screen.getByText('We sent a 6-digit code to d•••@gmail.com. It works for 10 minutes.')).toBeTruthy()
    // The security check is gone once used.
    expect(screen.queryByRole('button', { name: 'Complete check' })).toBeNull()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1, name: 'Enter the code we emailed' })))
  })

  it('never calls auth/, never sends a patient\'s CSRF token, and keeps nothing in browser storage', async () => {
    const { seen } = await openCard()
    expect(seen.some(item => item.path.startsWith('/auth/'))).toBe(false)
    for (const item of seen) expect(item.headers.get('X-CSRF-Token'), item.path).toBeNull()
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('says the link is not complete for a token that is not one, and sends nothing for it', async () => {
    const { seen } = open('/card#not-a-token', served())
    expect(await screen.findByRole('heading', { level: 1, name: 'This link isn’t complete' })).toBeTruthy()
    expect(screen.getByText('Open it again from your email.')).toBeTruthy()
    expect(seen.map(item => item.path)).toEqual(['/card-share/availability'])
  })

  it('needs the link again after a reload: a bare /card shows no card and asks for nothing', async () => {
    const { seen } = open('/card', served())
    expect(await screen.findByRole('heading', { level: 1, name: 'Open the link in your email again' })).toBeTruthy()
    expect(screen.getByText('Each time you open the card, we email you a new code.')).toBeTruthy()
    expect(seen.map(item => item.path)).toEqual(['/card-share/availability'])
  })
})

describe('the refusals, in plain words', () => {
  const codeRefusals: Array<[Response, string]> = [
    [problem(400, 'CARD_SHARE_LINK_INVALID', 'x'), 'This link isn’t complete. Open it again from your email.'],
    [problem(400, 'TURNSTILE_VALIDATION_FAILED', 'x'), 'We couldn’t check this browser. Try again.'],
    [problem(410, 'CARD_SHARE_ENDED', 'x'), 'This card is no longer shared.'],
    [json({ code: 'CARD_SHARE_LOCKED', status: 429, retryAfterSeconds: 1800 }, 429), 'Too many wrong codes. Try again in 30 minutes.'],
    [problem(429, 'CARD_SHARE_CODE_LIMITED', 'x'), 'Too many codes asked for. Try again later.'],
    [problem(429, 'RATE_LIMITED', 'x'), 'Too many tries from this connection. Wait a minute and try again.'],
  ]
  it.each(codeRefusals)('asking for a code: %#', async (answer, words) => {
    open(`/card#${TOKEN}`, served({ 'POST /card-share/code': () => answer.clone() }))
    await screen.findByRole('heading', { level: 1, name: 'Open a shared Health ID card' })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })) })
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toContain(words)
  })

  const verifyRefusals: Array<[Response, string]> = [
    [json({ code: 'CARD_SHARE_CODE_WRONG', status: 400, attemptsLeft: 3 }, 400), 'That code isn’t right. Check the email and try again. 3 tries left.'],
    [problem(410, 'CARD_SHARE_CODE_EXPIRED', 'x'), 'That code has stopped working. Ask for a new one.'],
    [problem(429, 'CARD_SHARE_LOCKED', 'x'), 'Too many wrong codes. Try again in an hour.'],
  ]
  it.each(verifyRefusals)('entering the code: %#', async (answer, words) => {
    await startToCode(served({ 'POST /card-share/verify': () => answer.clone() }))
    await enterCode(screen.getByRole('textbox', { name: /Digit 1 of 6/ }), '000000')
    await waitFor(() => expect(document.body.textContent).toContain(words))
    expect(screen.queryByRole('heading', { name: /Health ID card$/ })).toBeNull()
  })

  it('clears everything when the link has ended by the time the code is entered', async () => {
    await startToCode(served({ 'POST /card-share/verify': () => problem(410, 'CARD_SHARE_ENDED', 'x') }))
    await enterCode(screen.getByRole('textbox', { name: /Digit 1 of 6/ }), '000000')
    expect(await screen.findByRole('heading', { level: 1, name: 'This card is no longer shared' })).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: /Digit 1 of 6/ })).toBeNull()
  })

  it('never shows a server\'s own words', async () => {
    open(`/card#${TOKEN}`, served({ 'POST /card-share/code': () => problem(500, 'SOMETHING', 'stack trace and secrets') }))
    await screen.findByRole('heading', { level: 1, name: 'Open a shared Health ID card' })
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })) })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain('stack trace')
  })
})

describe('the card', () => {
  it('shows the card and records, read only, and every read names this view', async () => {
    const { seen } = await openCard()
    const verify = seen.find(item => item.path === '/card-share/verify')!
    expect(verify.body).toEqual({ token: TOKEN, code: '482913' })
    expect(screen.getByText('HID-CHI4821')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Clinical notes' })).toBeTruthy()
    expect(screen.getByText('Malaria review')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Health information they entered' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Records they added' })).toBeTruthy()
    expect(screen.getByText('Added by the patient. Not checked by a health worker.')).toBeTruthy()
    expect(screen.getByText('prescription.jpg')).toBeTruthy()
    // No download anywhere.
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Download/ })).toBeNull()
    expect(screen.getByText('Shared by')).toBeTruthy()
    expect(screen.getByText('Read only. Opened from an email sent to d•••@gmail.com. Chiamaka can see each time this page is opened.')).toBeTruthy()
    for (const read of seen.filter(item => ['/card-share/records', '/card-share/view', '/card-share/photo'].includes(item.path))) {
      expect(read.headers.get('X-Card-View'), read.path).toBe(VIEW)
      expect(read.credentials).toBe('include')
    }
    expect(seen.some(item => item.path === '/card-share/records')).toBe(true)
  })

  it('shows only the card face for a card-only link, and reads no records sections', async () => {
    await openCard(served({ 'POST /card-share/verify': () => json(card({ scope: 'card' })),
      'GET /card-share/records': () => json(records({ encounters: [], notes: [], patientEntries: [] })) }))
    expect(screen.getByText('HID-CHI4821')).toBeTruthy()
    expect(await screen.findByText('Card only')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Visits' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Records they added' })).toBeNull()
  })

  it('reads the photo with its view header, not by an address an image tag would load', async () => {
    const photo = vi.fn(() => new Response(new Blob(['png'], { type: 'image/png' }), { status: 200, headers: { 'content-type': 'image/png' } }))
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:card-photo')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const { seen } = await openCard(served({ 'POST /card-share/verify': () => json(card({ card: { fullName: 'Chiamaka Obi', healthId: 'HID-CHI4821', ninVerified: true, hasPhoto: true } })),
      'GET /card-share/photo': photo }))
    await waitFor(() => expect(photo).toHaveBeenCalled())
    expect(seen.find(item => item.path === '/card-share/photo')?.headers.get('X-Card-View')).toBe(VIEW)
    await waitFor(() => expect(created).toHaveBeenCalled())
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End view' })) })
    expect(revoked).toHaveBeenCalledWith('blob:card-photo')
  })

  it('ends the view on End view, clears the screen and says how to open it again', async () => {
    const { seen } = await openCard()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'End view' })) })
    const end = seen.find(item => item.path === '/card-share/end-view')!
    expect(end.method).toBe('POST')
    expect(end.headers.get('X-Card-View')).toBe(VIEW)
    expect(await screen.findByRole('heading', { level: 1, name: 'You closed the card' })).toBeTruthy()
    expect(screen.getByText('To open it again, use the link in your email. We’ll send a new code.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('HID-CHI4821')
  })

  it('checks every 30 seconds and clears the screen once the patient ends the link', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let ended = false
    await openCard(served({ 'GET /card-share/view': () => ended ? problem(410, 'CARD_SHARE_ENDED', 'x') : json(card()) }))
    ended = true
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(await screen.findByRole('heading', { level: 1, name: 'This card is no longer shared' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('HID-CHI4821')
    expect(document.body.textContent).not.toContain('Malaria review')
  })

  it('says the view ended when it timed out, and clears the screen', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let gone = false
    await openCard(served({ 'GET /card-share/view': () => gone ? problem(410, 'CARD_SHARE_VIEW_ENDED', 'x') : json(card()) }))
    gone = true
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Your view has ended' })).toBeTruthy()
    expect(screen.getByText('Open the link in your email again to get a new code.')).toBeTruthy()
    expect(document.body.textContent).not.toContain('HID-CHI4821')
  })

  it('clears the screen when another card was opened in this browser (one view per link)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let changed = false
    await openCard(served({ 'GET /card-share/view': () => changed ? problem(409, 'CARD_SHARE_VIEW_CHANGED', 'x') : json(card()) }))
    changed = true
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Another card was opened in this browser' })).toBeTruthy()
    expect(document.body.textContent).not.toContain('HID-CHI4821')
  })

  it('covers the card after 5 minutes idle, until the person asks to see it again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    await openCard()
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    const cover = await screen.findByRole('heading', { level: 1, name: 'Still there?' })
    expect(document.body.textContent).not.toContain('HID-CHI4821')
    await waitFor(() => expect(focused()).toBe(cover))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show the card again' })) })
    expect(await screen.findByText('HID-CHI4821')).toBeTruthy()
  })

  it('clears the card when the page is left, and does not show it again from the back-forward cache', async () => {
    await openCard()
    await act(async () => { window.dispatchEvent(new Event('pagehide')) })
    expect(document.body.textContent).not.toContain('HID-CHI4821')
    expect(await screen.findByRole('heading', { level: 1, name: 'Your view has ended' })).toBeTruthy()
  })
})

describe('Stop these emails', () => {
  it('from the card page asks which, then stops them with the token in the body', async () => {
    const { seen } = open(`/card#${TOKEN}`, served())
    await screen.findByRole('heading', { level: 1, name: 'Open a shared Health ID card' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop these emails' })) })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Stop these emails' })
    await waitFor(() => expect(focused()).toBe(heading))
    expect(screen.getByRole('button', { name: 'Complete check' }).getAttribute('data-action')).toBe('card-share-stop')
    fireEvent.click(screen.getByLabelText(/Stop all Health ID card emails to this address/))
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop the emails' })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'We’ve stopped these emails' })).toBeTruthy()
    const stop = seen.find(item => item.path === '/card-share/stop-emails')!
    expect(stop.body).toEqual({ token: TOKEN, scope: 'address', turnstileToken: 'turnstile-token' })
    expect(tokenAnywhere(seen).map(item => item.path)).toEqual(['/card-share/stop-emails'])
  })

  it('opens from the email\'s own link, /card/stop#<token>, with the token out of the address', async () => {
    const { seen } = open(`/card/stop#${TOKEN}`, served(), 'stop')
    expect(window.location.hash).toBe('')
    expect(await screen.findByRole('heading', { level: 1, name: 'Stop these emails' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/End only this card link/))
    fireEvent.click(screen.getByRole('button', { name: 'Complete check' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop the emails' })) })
    expect(await screen.findByRole('heading', { level: 1, name: 'We’ve ended this card link' })).toBeTruthy()
    expect(seen.find(item => item.path === '/card-share/stop-emails')?.body).toEqual({ token: TOKEN, scope: 'link', turnstileToken: 'turnstile-token' })
  })

  it('is dormant while switched off', async () => {
    flag.on = false
    const { seen } = open(`/card/stop#${TOKEN}`, served(), 'stop')
    expect(screen.getByRole('heading', { level: 1, name: 'This isn’t available yet' })).toBeTruthy()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toEqual([])
  })
})

describe('the privacy notice', () => {
  it('says why the address is used, how long it is kept, and how to ask', () => {
    render(<CardPrivacyPage />)
    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1, name: 'How we use your email address' })).toBeTruthy()
    for (const words of ['30 days', '12 months', 'support@healthidentitydirectory.com', 'Stop these emails', 'Cloudflare', 'Amazon SES', 'Brevo', 'Sentry']) {
      expect(main.textContent, words).toContain(words)
    }
  })
})
