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

  it('keeps focus in the question while support replies, and reads the notice with it', async () => {
    const { drawer } = await openHelp({ [SUPPORT]: [answer('Use Forgot password on the sign-in page.')] })
    const question = drawer.getByRole('textbox', { name: 'Your question' }) as HTMLInputElement
    expect(question.getAttribute('aria-describedby')?.split(' ').map(id => document.getElementById(id)?.textContent))
      .toContain(NOTICE)
    question.focus()
    ask(drawer, 'How do I reset my password?')
    // While the reply is on its way the box is read-only, not disabled, so focus stays in it (in the drawer).
    expect(question.readOnly).toBe(true)
    expect(question.disabled).toBe(false)
    expect(document.activeElement).toBe(question)
    expect(await drawer.findByText('Use Forgot password on the sign-in page.')).toBeDefined()
    expect(question.readOnly).toBe(false)
    expect(document.activeElement).toBe(question)
  })

  it('says to wait when support-api is busy', async () => {
    const { drawer } = await openHelp({ [SUPPORT]: [() => problem(429, 'SUPPORT_RATE_LIMITED', 'Too many messages')] })
    ask(drawer, 'How do I sign in?')
    expect(await drawer.findByRole('alert')).toBeDefined()
    expect(drawer.getByRole('alert').textContent).toBe('Please wait before sending another message.')
  })
})

/** Personal details as people type them, by kind (the reviews' cases among them), each refused. */
const REFUSED: Record<string, readonly string[]> = {
  'a Health ID with or without its hyphen': [
    'hid-abcdef23', 'HID-ZDEMAAA2', 'HID ABCDEF', 'HID_ABC234', 'Health ID ABC234', 'Health ID is ABC234', 'Health-ID: ABC234',
    'HealthID ABC234', 'HealthIDABC234', 'Health Identity number ABC234', 'H.I.D. ABC234', 'Health I.D. ABC234', 'H I D A B C 2 3 4',
    'HID ABC234.', 'HID-ABC234\'s record', 'HID 234567', 'hids: abc234', 'HID ABCDEFGHJK', 'His HID is 7kq2m9', 'HID number is abc234',
  ],
  'a Health ID read out in groups': [
    'HID ABC-234', 'HID - ABC 234', 'HID  -  ABC234', 'HID: ABC 234', 'HID ABC\n234', 'HID ABC\r\n234', 'HID ABC\t234', 'HID\u3000ABC\u3000234',
    'HID ABC\u00A0234', 'HID ABC\u2003234', 'HID ABC\u202F234', 'HID ABC\u2028234', 'HID\u2010ABC\u2010234', 'HID ABCD-EFGH-2345', 'HID ABC  234',
    'HID ABC - 234', 'HID ABC 2 3 4', 'HID ABC 23 4', 'hid abc 234', 'Health ID ABC - 234', 'HID    ABC234', 'Health ID number ABC 234',
    'Open HID ABC-234 please', 'HID ABCD EF23', 'patient hid abc 234 cannot sign in', 'hid abc-234 please', 'HID abc 234', 'health id: abc 234',
    'Health ID is abc 234', 'HID A B C 2 3 4', 'HID-ABC 234', 'HID:ABC-234', 'HID ABC_234', 'HID abc/234', 'HID ABC.234', 'hid abcd ef23',
    'hid ab c2 34', 'HID ABC 234 per day', 'HID 234 567', 'HID ABC DEF', 'HID ABC DEF GHJ', 'HID ABCD EFGH', 'HID KQZ XTW', 'Health ID number: ABC 234',
  ],
  'a Health ID after words, signs, brackets or quotes': [
    'HID (ABC234)', 'HID "ABC234"', 'HID [ABC234]', 'HID #ABC234', 'HID=ABC234', 'HID «ABC234»', 'HID “ABC234”', 'HID, ABC234',
    'HID. 7KQ2M9 cannot sign in', 'HID → ABC234', 'HID - - ABC234', 'HID № ABC234', 'HID No: ABC234', 'HID number ABC234 is locked',
    'The HID number is ABC234', 'HID of the patient: ABC234', 'Health ID for her is 7KQ2M9', 'MY HID NUMBER IS ABCDEF', 'HID IS ABCDEF',
  ],
  'a Health ID of letters only': [
    'patient hid abcdef will not load', 'HID abcdef', 'HID Abcdef', 'hid ABCDEF', 'Hid abcdef', 'hidabcdef', 'HIDabcdef', 'hid: abcdef',
    'hid – abcdef', 'hid\nabcdef', 'HID-abcdef', 'Health ID ABCDEF', 'HEALTH ID ABCDEF', 'Health ID: ABCDEF', 'HID-KQZXTW', 'hid-kqzxtw',
  ],
  'a Health ID alone, as issued': ['Patient 7KQ2M9 cannot sign in', 'K7P2QX will not open', 'Patient AB23CD'],
  'a Health ID through Unicode tricks': [
    'ＨＩＤ－ＡＢＣ\uFF12\uFF13\uFF14', 'hid ａｂｃｄｅｆ', 'HID AB\u200BC234', 'HID\u200Babcdef', 'HID\u2063ABC234', 'Open HID-\u200EABC234', 'HID\u200E-ABC234',
    'HID\u200EABC234', 'HID-\u034FABC234', 'HID-\u180EABC234', 'HID-\uFE0FABC234', 'HID-\u{E0041}ABC234', 'HID-\u202AABC234\u202C',
    'Health\u200BID ABC234', 'HID A\u0301BC234', 'HID ABC\uFF12\uFF13\uFF14', 'HID ABC²³⁴', 'HID ABC①②③',
    'HID ⒶⒷⒸ234', 'HID \u{1D400}\u{1D401}\u{1D402}234', 'HID ABC\u0662\u0663\u0664', 'HID \u202E432CBA',
    // Look-alike letters: Cyrillic H and I, Cyrillic A, B and C, Cyrillic h, i and d, small capitals.
    '\u041DID-ABC234', 'Open \u041D\u0406D ABC234', 'HID \u0410\u0412\u0421234', '\u04BB\u0456\u0501 abcdef', '\u029C\u026A\u1D05 ABC234',
  ],
  'a NIN': ['The NIN 12345678901 is refused', 'NIN: 98765432109', 'NIN 1234 5678 901', 'NIN: 123-456-789-01', 'NIN 12345\u200E678901',
    '12345\u2061678901', '12345\u034F678901', '\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9\u06F0\u06F1'],
  'a phone number': [
    '(0803) 123-4567', '+44 20 7946 0958', '123 - 4567 - 8901', '0803–123–4567', '0803.12.30.4567', '0803 123 4567', '0803.123.4567',
    '0803  -  123  -  4567', '0803_123_4567', '0803•123•4567', '0803~123~4567', '0803·123·4567', '0 8 0 3 1 2 3 4 5 6 7',
    '0-8-0-3-1-2-3-4-5-6-7', '(+234) 803 123 4567', '+234-803-123-4567', '234 803 123 4567', '00234 803 123 4567', '0803 123 456 7',
    '080 312 345 67', '+1 (555) 123-4567', '555-123-4567', 'O8O3 123 4567', 'Call o803 123 4567',
    // Next to a version, a date or an amount, the number is still read.
    'version 0803 123 4567', 'Chrome 118.0.5993.88 and 0803.123.4567', '30/10/2026-0803-123-4567', '2026-10-01–0803-123-4567',
    '1990-12-25-4567', '19901225-1234', '0803 123 4567 naira', '₦0803 123 4567', 'Pay 0803 123 4567 NGN',
    // Nigerian landlines: 0 and 8 digits.
    '01 234 5678', '09 876 5432', 'Ring (01) 234 5678', '+234 1 234 5678',
  ],
  'a phone number through Unicode tricks': [
    '0803\u200B123\u200B4567', 'Call 0803\u200E123\u200E4567', '0803\u200F1234567', '0803\u20661234567\u2069', 'Call 0803\u2066123\u20694567',
    '0803\u180E1234567', '0803\uFE0F1234567', '0803\u{E0020}1234567', '0803\u31641234567', '0803\u115F1234567', '0803\uFFA01234567',
    '0803\u00AD1234567', '0803\u061C1234567', '+234\u200E803\u200E123\u200E4567', '0803\u2003123\u20034567',
    '\u0660\u0668\u0660\u0663\u0661\u0662\u0663\u0664\u0665\u0666\u0667', '\u0966\u096E\u0966\u0969\u0967\u0968\u0969\u096A\u096B\u096C\u096D',
  ],
  'an email address': [
    'me@clinic.example', 'Add ada.example@example.test to my team', 'ada@gmail', 'ada.obi@yahoo please', 'ada  @  example.com', 'ada@example . com',
    'ada@163.com', 'ada @ example.test', 'ADA@EXAMPLE.COM', 'ada＠example.com', 'ada﹫example.com', 'ada@example。com',
    'ada+test@example.com', 'ada@sub.example.co.uk', 'ada @example.com', 'ada@ example.com', 'ada at example dot com',
    'ada [at] example [dot] com', 'ada (at) example (dot) com', 'ada AT example DOT com', 'ada(at)gmail.com', 'write to ada at gmail.com',
  ],
}

/** Ordinary support questions, by kind (the reviews' cases among them), each sent. */
const SENT: Record<string, readonly string[]> = {
  'dates, times and date ranges': [
    'I could not sign in on 2026-10-30 07:15, why?', 'Error at 31.10.2026 14:05', 'Between 09:00 and 17:30 on 30.10.2026',
    'Meeting at 14:30 on 2026-10-30', '30/10/2026-02/11/2026', '2026-10-01–2026-10-31', '01.10.2026-31.10.2026',
    'Report 2026-10-01–2026-10-31 is empty', '01/10/2026-31/10/2026', 'US 10/01/2026-10/31/2026 report', 'Times 09:00-17:30 daily',
    'ISO 2026-10-30T07:15:00Z', 'Between 2026-10-01 and 2026-10-31', 'From 01/10/2026 to 31/10/2026', '07:15 - 08:30 - 09:45 - 10:00',
    '2026-10-01 – 2026-10-31', 'HID update 2026-10-30 failed', 'BP 120/80 at 09:15', 'Lab result 12.5 mmol/L at 10:30', 'O2 sat 98% at 10:30',
  ],
  'prices, with or without @': [
    'Pay NGN 1,000,000', 'Our invoice of 2026-10-30 for NGN 25,000: when is it due?', 'Invoice 2026/10/30 for NGN 12,500',
    'We bought 2 units @ 500.00 each', '10 boxes @ ₦5,000.00', '3 @ 1.50 each', 'Rate @ 2.5% per month', 'Meet @ 10.30 am', 'Price @ 500',
    '10 tests @ 2.50 each on the bill', 'price @ 5.00', 'units @ each', '₦10000000.00', 'NGN 25000000 was charged', '5000000 naira refund',
    '₦1,500,000.00 for 12 months', '$1,000,000', 'Dose 500mg x 2 x 3 days',
  ],
  'versions and IP addresses': [
    'Version 2.1 on 30/10/2026', 'Chrome 130.0.6723.91', 'Chrome 130.0.6723.116 on Windows 10.0.19045', 'App version 1.0.2026.1030',
    'Chrome 130.0.6723.117 shows a blank page', 'Chrome 118.0.5993.88', 'Edge 130.0.2849.68', 'IP 192.168.100.254',
    'Chrome Version 130.0.6723.92 (Official Build) (64-bit)', 'Safari 18.1 on iOS 18.1.1', 'Samsung Internet 26.0.3.1', 'Firefox 131.0.3',
    'Edge 130.0.2849.80 and Chrome 130.0.6723.91', 'Android 14 build UP1A.231005.007', 'App 1.2.3 (build 4567)', 'Windows 11 23H2',
    'Build 22631.4317', 'Health ID app v1.0.2026.1030 on Android', 'Why does the HID page say v2.3.1?', 'the HID team asked for v2.3.1',
    'Error 0x80070005',
  ],
  'references and ids': [
    'Invoice HID-2026-000123 shows the wrong amount', 'INV-2026-000123', 'ORD-20261030-0042', 'Hidden fees on invoice INV-2026-0042?',
    'Health ID billing: invoice INV-2026-0042 for NGN 45,000', 'Accession ACC-2026-000123 will not print', 'Licence MDCN/2026/12345',
    '98d00002-0000-4000-8000-000000000001', 'Request id 0f2b5a5e-7c1d-4e8a-9b3c-2d4e6f8a0b1c', 'Order 3F2A9C2B is not showing',
    'Reference 0F2B6D0E', 'Postcode 100001', 'Room 101 to 120', 'Pages 12, 13 and 14', 'Invoice No12345678',
  ],
  'product words and questions about Health IDs': [
    'How do I reset my password?', 'What is a HID- number?', 'What is my HID number?', 'WHAT IS MY HID NUMBER?', 'HIDE the menu',
    'HID number', 'HID-Pharmacy', 'Our HID-Pharmacy page is blank', 'hid-1.0', 'HID-1.0 app', 'the HID-1.0 app', 'Where is hid-system?',
    'Health ID app', 'HID PHARMACY NOT LOADING', 'HID SECURE LOGIN FAILS', 'HID REPLACEMENT CARD', 'HID SYSTEM', 'HID ACCESS problem',
    'HID APP UPDATE FAILED', 'Our HID WEB APP is down', 'Where is my HID API KEY?', 'the HID EHR LAB page', 'MY HID CARD WAS LOST',
    'MY HID CARD HAS BEEN BLOCKED', 'MY HID CARD PAGE IS BLANK', 'HID NEW USER', 'HID-ehr-blue not loading', 'hid-backend release',
    'HID gateway 502 error', 'Our HID gateway and database are slow', 'HID health records', 'The HID helpdesk is closed', 'My HID scanner beeps',
    'Can a HID be changed?', 'My HID changed', 'HID card was renewed', 'Is the HID system down?', 'What does HID-XXXXXX mean?',
    'The Health ID 2FA page is blank', 'Health ID 2FA codes are late', 'HID 2FA step fails', 'HID 2FA text came late', 'Health ID v2 app went dark',
    'Our HID v3 web page crashes', 'HID 24 hrs late', 'HID 24 hours later', 'HID 50 per page max?', 'HID update 2 failed', 'HID screen 2 is blank',
    'HID 2.3.4 update failed', 'The HID card has 6 letters', 'HID: 6 characters?', 'HID is 6 characters long', 'Is HID 6 or 8 characters?',
    'Can a HID have 32 characters?', 'Health ID setup takes 22 days', 'Health ID is 22 days late', 'What is the HID used for in 2026?',
    'Our clinic uses HID since 2019', 'HID login takes 30 seconds', 'Health ID number format?', 'Where do I see my HID?', 'Can I change my HID?',
    'What does HID stand for?', 'HID vs NIN', 'HID 2026 roadmap', 'HID phase 2', 'How do I get a HID? Thanks', 'I lost my HID. Regards',
  ],
  'text with accents, emoji, marks and @ words': [
    'Café opening hours?', 'Cafe\u0301 decomposed', 'naïve', 'Yoruba: Ẹ kú àárọ\u0300', 'Thanks \u{1F44D}\u{1F3FD}',
    'Step 1\uFE0F\u20E3 then 2\uFE0F\u20E3', 'Email support@ please', '@mention me', 'Twitter @HealthID', 'me @ 10am', 'Meet @ the lab. Thanks',
    'I\'m @ work. Please help', 'Log in at app.healthid.ng fails',
  ],
}

/**
 * Ordinary questions that read the same as a personal detail, refused on purpose (privacy first): a date run on into a
 * serial or a 10-digit reference reads as a phone number, capitals in groups after HID as a Health ID read out, and a
 * 6-character capital code as a Health ID as issued.
 */
const TOLD_APART_ONLY_BY_REPHRASING = [
  'Ref 2026/10/30-1234', 'Lot number 2026-1030-4567', 'Ticket #1234567890', 'Health ID 2FA SMS never came', 'HID v2 vs v3',
  'Hash SHA256 fails', 'Health ID Kaduna branch',
]

describe('the privacy guard refuses before anything is sent', () => {
  it.each([
    ['a Health ID', 'Why can\'t I open HID-ABCDEF23?'],
    ['an 11-digit NIN', 'The NIN 12345678901 is refused'],
    ['an email address', 'Add ada.example@example.test to my team'],
    ['a phone number', 'Call the patient on 0803 123 4567'],
    ['an international phone number', 'Text +234 803 123 4567 about the result'],
    // As people type them, without the hyphen or with other separators (normalizeHealthIdInput reads each as HID-ABC234).
    ['a Health ID with a space', 'Why can\'t I open HID ABC234?'],
    ['a Health ID in lower case', 'patient hid abc234 will not load'],
    ['a Health ID with no hyphen', 'Open HIDABC234 for me'],
    ['a Health ID after a colon', 'Record HID: ABC123 is locked'],
    ['a Health ID with an en dash', 'HID – ABC234 is missing'],
    ['a phone number with spaced dashes', 'Call the patient on 0803 - 123 - 4567'],
    ['a phone number with slashes', 'Ring 0803/123/4567 after lunch'],
    ['an email address with spaces round the @', 'Invite ada @ example.test please'],
    // Read out in groups, after words, in brackets, in lower-case letters, alone, or hidden by Unicode.
    ['a Health ID read out in groups', 'Patient HID ABC 234 cannot sign in'],
    ['a Health ID in groups of four', 'Open HID ABCD-EFGH-2345 please'],
    ['a Health ID in brackets', 'Record HID (ABC234) will not open'],
    ['a Health ID after "is"', 'The patient\'s Health ID is 7KQ2M9 and she can\'t sign in'],
    ['a Health ID after "number"', 'HID number ABC234 is locked'],
    ['a Health ID of letters in lower case', 'patient hid abcdef will not load'],
    ['a Health ID with a Cyrillic H', 'Open \u041DID-ABC234'],
    ['a Health ID alone, as issued', 'Patient 7KQ2M9 cannot sign in'],
    ['a phone number with left-to-right marks', 'Call 0803\u200E123\u200E4567'],
    ['a phone number with bidi isolates inside', 'Call 0803\u2066123\u20694567'],
    ['a phone number in Arabic-Indic digits', 'Call \u0660\u0668\u0660\u0663\u0661\u0662\u0663\u0664\u0665\u0666\u0667'],
    ['a Lagos landline', 'Ring the clinic on 01 234 5678'],
    ['an email address without a dot', 'Add ada@gmail to my team'],
    ['an email address spelled out', 'Write to ada at example dot com'],
  ])('%s', async (_, question) => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Never sent.')] })
    ask(drawer, question)
    expect(drawer.getByRole('alert').textContent).toBe(REFUSAL)
    // Nothing went out, and the question waits in the box to be changed.
    expect(sent.some(call => call.route === SUPPORT)).toBe(false)
    expect((drawer.getByRole('textbox', { name: 'Your question' }) as HTMLInputElement).value).toBe(question)
    expect(drawer.queryByText(question)).toBeNull()
  })

  it.each([
    'Our invoice of 2026-10-30 for NGN 25,000: when is it due?',
    'Chrome 130.0.6723.91 shows a blank page',
    'Report 2026-10-01–2026-10-31 is empty',
    'We bought 2 units @ 500.00 each',
    'Our HID-Pharmacy page is blank',
    'Invoice HID-2026-000123 shows the wrong amount',
    'WHAT IS MY HID NUMBER?',
  ])('sends an ordinary question: %s', async question => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Answered.')] })
    ask(drawer, question)
    expect(await drawer.findByText('Answered.')).toBeDefined()
    expect(sent.filter(call => call.route === SUPPORT).map(call => call.body)).toEqual([{ text: question }])
  })

  it.each(Object.entries(REFUSED))('reads %s, however it is typed', (_, questions) => {
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it.each(Object.entries(SENT))('leaves %s alone', (_, questions) => {
    expect(questions.filter(question => holdsPersonalDetails(question))).toEqual([])
  })

  // Privacy first: where an ordinary question reads the same as a personal detail, it is refused and rephrased.
  it('refuses an ordinary question that reads as a personal detail', () => {
    expect(TOLD_APART_ONLY_BY_REPHRASING.filter(question => !holdsPersonalDetails(question))).toEqual([])
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
