import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { holdsPersonalDetails } from '../../../ehr-blue/frame/support/supportPrivacy'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt, withFramePages } from './blueHarness'

/**
 * Help in the blue EHR: Health ID's support assistant (support-api, anonymous), in a drawer of the frame, for any
 * signed-in staff member, where the build offers it (the ehr build). Its privacy guard keeps patients out of it: the
 * notice above the question, and a question holding a Health ID, a NIN, an email address or a phone number refused
 * before anything is sent. The chat's session id stays in memory and nothing is stored. Today's classic portal has no
 * chat. Every account, facility and question here is fictional.
 */
const build = vi.hoisted(() => ({ supportChatEnabled: true }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({
  apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null, supportChatEnabled: build.supportChatEnabled,
  supportContact: build.supportChatEnabled ? 'mailto:support@healthidentitydirectory.com' : null,
}) }))
// The clinic switch as it ships, unless a test turns it on: a vi.doMock outlives the test that made it.
beforeEach(() => {
  build.supportChatEnabled = true
  withFramePages()
  vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SUPPORT = 'POST /api/v1/support/chat'
const NOTICE = 'For questions about using Health ID. Do not enter patient names, Health IDs, NINs or clinical details.'
const REFUSAL = 'Remove patient or personal details before sending.'
const CHAT_SESSION = '0f2b5a5e-7c1d-4e8a-9b3c-2d4e6f8a0b1c'
const answer = (text: string) => () => json({ sessionId: CHAT_SESSION, messages: [text] })

async function openHelp(routes: Record<string, (() => Response)[]> = {}, at = DEMO_HOSPITAL) {
  const here = facility(at, 'Demo Hospital', [])
  const sent = serve({ [SESSION]: [sessionAt(here, [here])], ...routes })
  await openStaffApp('/provider')
  await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  return { sent, drawer: within(screen.getByRole('dialog', { name: 'Help' })) }
}

function ask(drawer: ReturnType<typeof within>, text: string) {
  fireEvent.change(drawer.getByRole('textbox', { name: 'Your question' }), { target: { value: text } })
  fireEvent.click(drawer.getByRole('button', { name: 'Send' }))
}

describe('Help opens the support assistant', () => {
  it('in a drawer of the frame, with the privacy notice right above the question', async () => {
    const { drawer } = await openHelp()
    const notice = drawer.getByText(NOTICE)
    const question = drawer.getByRole('textbox', { name: 'Your question' })
    expect(notice.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(drawer.getByRole('log', { name: 'Support messages' })).toBeDefined()
    expect(drawer.getByRole('link', { name: 'Email support' }).getAttribute('href')).toBe('mailto:support@healthidentitydirectory.com')
    // A live service, not a sample.
    expect(drawer.queryByText(/^Sample only/)).toBeNull()
  })

  it('at a clinic too, once the clinic switch is on, for any signed-in member', async () => {
    vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
    const { drawer } = await openHelp({ 'GET /api/v1/identity/access-requests': [() => json([]), () => json([])] }, REAL_FACILITY)
    expect(drawer.getByText(NOTICE)).toBeDefined()
  })

  it('asks support-api, keeps the chat\'s session in memory only, and sends no session cookie or token', async () => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Use Forgot password on the sign-in page.'), answer('Your administrator can.')] })
    ask(drawer, 'How do I reset my password?')
    expect(await drawer.findByText('Use Forgot password on the sign-in page.')).toBeDefined()
    ask(drawer, 'Who adds staff?')
    expect(await drawer.findByText('Your administrator can.')).toBeDefined()
    const chats = sent.filter(call => call.route === SUPPORT)
    expect(chats.map(call => call.body)).toEqual([{ text: 'How do I reset my password?' }, { text: 'Who adds staff?', sessionId: CHAT_SESSION }])
    for (const chat of chats) {
      expect(chat.headers.get('Authorization')).toBeNull()
      expect(chat.headers.get('X-CSRF-Token')).toBeNull()
    }
    const calls = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/api/v1/support/chat'))
    for (const [, init] of calls) expect(init?.credentials).toBe('omit')
    expect(window.localStorage.length).toBe(0)
    expect(window.sessionStorage.length).toBe(0)
    expect(document.cookie).toBe('')
  })

  it('starts a new chat without the last one\'s session', async () => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('First answer.'), answer('Second answer.')] })
    ask(drawer, 'How do I sign in?')
    await drawer.findByText('First answer.')
    fireEvent.click(drawer.getByRole('button', { name: 'Start new chat' }))
    expect(drawer.queryByText('First answer.')).toBeNull()
    ask(drawer, 'How do I switch facility?')
    await drawer.findByText('Second answer.')
    expect(sent.filter(call => call.route === SUPPORT).map(call => call.body)).toEqual([{ text: 'How do I sign in?' }, { text: 'How do I switch facility?' }])
  })

  it('says to wait when support-api is busy', async () => {
    const { drawer } = await openHelp({ [SUPPORT]: [() => problem(429, 'SUPPORT_RATE_LIMITED', 'Too many messages')] })
    ask(drawer, 'How do I sign in?')
    expect(await drawer.findByRole('alert')).toBeDefined()
    expect(drawer.getByRole('alert').textContent).toBe('Please wait before sending another message.')
  })
})

describe('the privacy guard refuses before anything is sent', () => {
  it.each([
    ['a Health ID', 'Why can\'t I open HID-ABCDEF23?'],
    ['an 11-digit NIN', 'The NIN 12345678901 is refused'],
    ['an email address', 'Add ada.example@example.test to my team'],
    ['a phone number', 'Call the patient on 0803 123 4567'],
    ['an international phone number', 'Text +234 803 123 4567 about the result'],
  ])('%s', async (_, question) => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Never sent.')] })
    ask(drawer, question)
    expect(drawer.getByRole('alert').textContent).toBe(REFUSAL)
    // Nothing went out, and the question waits in the box to be changed.
    expect(sent.some(call => call.route === SUPPORT)).toBe(false)
    expect((drawer.getByRole('textbox', { name: 'Your question' }) as HTMLInputElement).value).toBe(question)
    expect(drawer.queryByText(question)).toBeNull()
  })

  it('sends a question with a date or an amount in it', async () => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Answered.')] })
    ask(drawer, 'Our invoice of 2026-10-30 for NGN 25,000: when is it due?')
    expect(await drawer.findByText('Answered.')).toBeDefined()
    expect(sent.filter(call => call.route === SUPPORT)).toHaveLength(1)
  })

  it('reads each kind of personal detail, and leaves ordinary questions alone', () => {
    for (const text of ['hid-abcdef23', 'NIN: 98765432109', 'me@clinic.example', '(0803) 123-4567', '+44 20 7946 0958']) {
      expect({ text, refused: holdsPersonalDetails(text) }).toEqual({ text, refused: true })
    }
    for (const text of ['How do I reset my password?', 'What is a HID- number?', 'Version 2.1 on 30/10/2026', 'Pay NGN 1,000,000']) {
      expect({ text, refused: holdsPersonalDetails(text) }).toEqual({ text, refused: false })
    }
  })
})

describe('where the build does not offer it', () => {
  it('keeps Help as today\'s sample text, and asks nothing', async () => {
    build.supportChatEnabled = false
    const { sent, drawer } = await openHelp()
    expect(drawer.getByText(/^Use Search Health ID/)).toBeDefined()
    expect(drawer.queryByText(NOTICE)).toBeNull()
    expect(sent.some(call => call.route === SUPPORT)).toBe(false)
  })
})

describe('today\'s classic portal', () => {
  it('has no support chat', async () => {
    const riverside = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.patient.read'])
    const sent = serve({ [SESSION]: [sessionAt(riverside, [riverside])] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('complementary', { name: 'Provider navigation' })).toBeDefined()
    expect(document.querySelector('.hid-ehr')).toBeNull()
    expect(screen.queryByRole('log', { name: 'Support messages' })).toBeNull()
    expect(screen.queryByRole('button', { name: /support chat/i })).toBeNull()
    expect(screen.queryByText(NOTICE)).toBeNull()
    await waitFor(() => expect(sent.some(call => call.route === SUPPORT)).toBe(false))
  })
})
