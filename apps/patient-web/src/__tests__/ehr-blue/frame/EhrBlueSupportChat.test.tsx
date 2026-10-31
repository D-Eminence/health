import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { holdsPersonalDetails, REFUSAL_REASONS, refusalFor } from '../../../ehr-blue/frame/support/supportPrivacy'
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

/** Questions that hold a Health ID, a NIN, a phone number or an email address, by kind, each refused. */
const REFUSED: Record<string, readonly string[]> = {
  'a Health ID with or without its hyphen': [
    'hid-abcdef23', 'HID-ZDEMAAA2', 'HID ABCDEF', 'HID_ABC234', 'Health ID ABC234', 'Health ID is ABC234', 'Health-ID: ABC234',
    'HealthID ABC234', 'HealthIDABC234', 'Health Identity number ABC234', 'H.I.D. ABC234', 'Health I.D. ABC234', 'H I D A B C 2 3 4',
    'HID ABC234.', 'HID-ABC234\'s record', 'HID 234567', 'hids: abc234', 'HID ABCDEFGHJK', 'His HID is 7kq2m9', 'HID number is abc234',
    'HIDABC 234', 'hidabc-234', 'HIDKQ Z2M9', 'Health IDabc234', 'Health identifier: abc 234', 'Health identification no abc234',
  ],
  'a Health ID read out in groups': [
    'HID ABC-234', 'HID - ABC 234', 'HID  -  ABC234', 'HID: ABC 234', 'HID ABC\n234', 'HID ABC\r\n234', 'HID ABC\t234',
    'HID\u3000ABC\u3000234', 'HID ABC\u00A0234', 'HID ABC\u2003234', 'HID ABC\u202F234', 'HID ABC\u2028234', 'HID\u2010ABC\u2010234',
    'HID ABCD-EFGH-2345', 'HID ABC  234', 'HID ABC - 234', 'HID ABC 2 3 4', 'HID ABC 23 4', 'hid abc 234', 'Health ID ABC - 234',
    'HID    ABC234', 'Health ID number ABC 234', 'Open HID ABC-234 please', 'HID ABCD EF23', 'patient hid abc 234 cannot sign in',
    'hid abc-234 please', 'HID abc 234', 'health id: abc 234', 'Health ID is abc 234', 'HID A B C 2 3 4', 'HID-ABC 234', 'HID:ABC-234',
    'HID ABC_234', 'HID abc/234', 'HID ABC.234', 'hid abcd ef23', 'hid ab c2 34', 'HID ABC 234 per day', 'HID 234 567',
    'Health ID number: ABC 234', 'HID ABC\u00B7234', 'HID ABC\u2022234', 'HID ABC~234', 'HID ABC+234', 'HID ABC|234', 'HID ABC*234',
    'HID ABC\u2027234', 'HID ABC\u30FB234', 'HID kqz \u00B7 2x9', 'HID ABC:234', 'HID ABC, 234', 'HID ABC -- 234', 'hid 7kq xmz',
    'patient hid k2q xmz cannot sign in', 'hid 2kq xmz please', 'Health ID is 7kq xmz', 'hid ab 2c de', 'hid 2k 3m 4p', 'HID ab 23 cd',
    'HID a b c 2 3 4', 'hid a b c 2 3 4', 'hid k 7 q 2 m 9', 'h-i-d k-7-q-2-m-9', 'hid a.b.c.2.3.4', 'Health ID: k-7-q-2-m-9',
    'HID a-b-c-2-3-4',
  ],
  'a Health ID after words, signs, brackets or quotes': [
    'HID (ABC234)', 'HID "ABC234"', 'HID [ABC234]', 'HID #ABC234', 'HID=ABC234', 'HID \u00ABABC234\u00BB', 'HID \u201CABC234\u201D',
    'HID, ABC234', 'HID. 7KQ2M9 cannot sign in', 'HID \u2192 ABC234', 'HID - - ABC234', 'HID № ABC234', 'HID No: ABC234',
    'HID number ABC234 is locked', 'The HID number is ABC234', 'HID of the patient: ABC234', 'Health ID for her is 7KQ2M9',
    'HID IS ABCDEF', 'H.I.D. KQZXTW', 'HID, KQZXTW', 'Health I.D. KQZXTW', 'H.I.D.: KQZXTW', 'HID. KQZXTW',
    'Patient HID. KQZXTW cannot sign in', 'Health ID; KQZXTW', 'HID | KQZXTW', '| HID | KQZXTW |', 'HID,KQZXTW', 'Name, HID, KQZXTW',
    'HID \u2192 KQZXTW', 'HID `KQZXTW`', 'HID \u201EKQZXTW\u201C', 'HID \u300CKQZXTW\u300D', 'HID ~ KQZXTW', 'HID @ KQZXTW',
    'HID ^ KQZXTW', 'HID: kqzxtw', 'Health ID for my patient is KQZXTW', 'The HID for my new patient is abc234',
    'The HID of my new patient is ABCDEFGH2345', 'HID for bed 4 patient: abc234', 'Health ID (patient 2): abc234',
    'Hi, the HID of the patient I am seeing is kqz2xt', 'HID of the lady in bed four is kqz2xt',
  ],
  'a Health ID before HID': [
    'Patient abc234 (HID) cannot sign in', 'abc234 is her HID', 'abc 234 is her HID', 'ABC-234 is the HID',
    'kqz2xt (her Health ID) will not load', 'Record ABCDEFGH2345 (Health ID) is locked', 'patient abc234 HID',
  ],
  'a Health ID pasted from a log, a link or a page': [
    'health_id: abc234', 'health_id=kqzxtw', 'patient_health_id: ABCDEFGH2345', '{"health_id":"kqz2xt"}', 'Health_ID KQZXTW',
    'H_I_D abc234', 'search?q=hid%20abc234', 'https://ehr.example.test/search?q=HID%20KQZXTW', '?q=hid+abc+234', '?q=HID+KQZXTW',
    'HID&#45;KQZXTW', 'HID&nbsp;KQZXTW',
  ],
  'a Health ID of letters only': [
    'hid ABCDEF', 'hid: abcdef', 'Health ID ABCDEF', 'HEALTH ID ABCDEF', 'Health ID: ABCDEF', 'HID-KQZXTW',
  ],
  'a Health ID alone, as issued': [
    'Patient 7KQ2M9 cannot sign in', 'K7P2QX will not open', 'Patient AB23CD',
  ],
  'a Health ID through Unicode tricks': [
    'ＨＩＤ\uFF0DＡＢＣ２３４', 'HID AB\u200BC234', 'HID\u2063ABC234', 'Open HID-\u200EABC234', 'HID\u200E-ABC234', 'HID\u200EABC234',
    'HID-\u034FABC234', 'HID-\u180EABC234', 'HID-\uFE0FABC234', 'HID-\u{E0041}ABC234', 'HID-\u202AABC234\u202C', 'Health\u200BID ABC234',
    'HID A\u0301BC234', 'HID ABC２３４', 'HID ABC²³⁴', 'HID ABC①②③', 'HID ⒶⒷⒸ234', 'HID 𝐀𝐁𝐂234', 'HID ABC٢٣٤', 'HID \u202E432CBA',
    'НID-ABC234', 'Open НІD ABC234', 'HID АВС234', 'һіԁ abcdef', 'ʜɪᴅ ABC234', 'hıd abc234', 'Hıd: kqzxtw', 'HlD abc234', 'H1D abc234',
    'HӀD abc234', 'HǀD abc234', 'HID ABC2З4', 'HID 7кq2м9', 'hid кqzxтw', 'HID 7κq2m9', 'ꓧꓲꓓ abc234', 'HID 7ꓗQ2ꓟ9',
  ],
  'a NIN': [
    'The NIN 12345678901 is refused', 'NIN: 98765432109', 'NIN 1234 5678 901', 'NIN: 123-456-789-01', 'NIN 12345\u200E678901',
    '12345\u2061678901', '12345\u034F678901', '۱۲۳۴۵۶۷۸۹۰۱', 'Her NIN-1990-1234567 is refused', 'NIN/2001/2345678 fails',
    'NIN-1990-1234567', 'NIN/2001/2345678', 'NIN-20123456-789', 'NIN one two three four five six seven eight nine one two',
  ],
  'a phone number': [
    '(0803) 123-4567', '+44 20 7946 0958', '123 - 4567 - 8901', '0803\u2013123\u20134567', '0803.12.30.4567', '0803 123 4567',
    '0803.123.4567', '0803  -  123  -  4567', '0803_123_4567', '0803\u2022123\u20224567', '0803~123~4567', '0803\u00B7123\u00B74567',
    '0 8 0 3 1 2 3 4 5 6 7', '0-8-0-3-1-2-3-4-5-6-7', '(+234) 803 123 4567', '+234-803-123-4567', '234 803 123 4567', '00234 803 123 4567',
    '0803 123 456 7', '080 312 345 67', '+1 (555) 123-4567', '555-123-4567', 'O8O3 123 4567', 'Call o803 123 4567',
    'version 0803 123 4567', 'Chrome 118.0.5993.88 and 0803.123.4567', '30/10/2026-0803-123-4567', '2026-10-01\u20130803-123-4567',
    '1990-12-25-4567', '19901225-1234', '0803 123 4567 naira', '₦0803 123 4567', 'Pay 0803 123 4567 NGN', '01 234 5678', '09 876 5432',
    'Ring (01) 234 5678', '+234 1 234 5678', 'Call the patient on (0803) - 123 - 4567', '0803 -- 123 -- 4567', 'Call 0803 -- 123 -- 4567',
    '0803 ... 123 ... 4567', '(01) - 234 - 5678', 'Call [0803] 123 4567', 'Call 0803|123|4567', '{0803} 123 4567', '<0803> 123 4567',
    '\u30100803\u3011 123 4567', '0803\\123\\4567', 'Ring the clinic on +234.1.234.5678', 'Ring +44.20.7946.0958', '+234.1.234.5678',
    '+234.9.876.5432', '+49.30.12345.6789', '+234.80.3123.4567', '+1.55.5123.4567', 'Tel +234.1.234.5678 or +234.1.234.5679',
    'TEL-2080-3123456', 'MOB/2080/31234567', 'Ring 0 1 2 3 4 5 6 7 8', 'Ring (0)1 234 5678', '0 1 234 5678', '(0)1 234 5678',
    '0-1-2345678', '0 9 876 5432', 'Call 0803 l23 4567', '0803 I23 4567', '08O3 l23 4567', '0803 |23 4567', 'Call Ø8Ø3 123 4567',
    'ø8ø3 123 4567', '\u30078\u30073 123 4567', '\u22058\u22053 123 4567', 'Call ++2348031234567', '++2348031234567',
    'Her phone=+234%20803%20123%204567', 'tel:+234%20803%20123%204567', 'tel=+234+803+123+4567',
    'Call zero eight zero three one two three four five six seven', 'Call oh eight oh three, one two three, four five six seven',
  ],
  'a phone number through Unicode tricks': [
    '0803\u200B123\u200B4567', 'Call 0803\u200E123\u200E4567', '0803\u200F1234567', '0803\u20661234567\u2069',
    'Call 0803\u2066123\u20694567', '0803\u180E1234567', '0803\uFE0F1234567', '0803\u{E0020}1234567', '0803\u31641234567',
    '0803\u115F1234567', '0803\uFFA01234567', '0803\u00AD1234567', '0803\u061C1234567', '+234\u200E803\u200E123\u200E4567',
    '0803\u2003123\u20034567', '٠٨٠٣١٢٣٤٥٦٧', '०८०३१२३४५६७', 'Call 0803\u2E3A123\u2E3A4567', '0803\u2E3B123\u2E3B4567',
    '0803\u058A123\u058A4567', '0803\u05BE123\u05BE4567', '0803\u1806123\u18064567', '0803\u301C123\u301C4567', '0803\u3030123\u30304567',
    '0803\u2E40123\u2E404567', '0803\u2E17123\u2E174567', '0803\u1400123\u14004567', '0803\u30FC123\u30FC4567', '0803\uFF70123\uFF704567',
    '0803\u02D7123\u02D74567', '0803\u2043123\u20434567', '0803\u2027123\u20274567', '0803➖123➖4567', '0803─123─4567',
    '0803\u2053123\u20534567', 'Call 0803\u2219123\u22194567', 'Call 0803\u30FB123\u30FB4567', '0803\u22C5123\u22C54567',
    '0803 \u22C5 123 \u22C5 4567', '0803\uFF65123\uFF654567', '0803\u3002123\u30024567', '0803\uFF61123\uFF614567',
    '0803\u2E31123\u2E314567', '0803\u16EB123\u16EB4567', '0803●123●4567', '0803\u06D4123\u06D44567', '0803\u2044123\u20444567',
    '0803\u2215123\u22154567', '0803\u29F8123\u29F84567', '0803╱123╱4567', 'Call ⓪❽⓪❸❶❷❸❹❺❻❼', '⓪➇⓪➂➀➁➂➃➄➅➆', '⓿➑⓿➌➊➋➌➍➎➏➐', '⓵⓶⓷⓸⓹⓺⓻⓼⓽⓾⓵',
    'Call 0803\u0085123\u00854567', 'Call 0803\u0090123\u00904567', '0803\u009F123\u009F4567',
  ],
  'an email address': [
    'me@clinic.example', 'Add ada.example@example.test to my team', 'ada@gmail', 'ada.obi@yahoo please', 'ada  @  example.com',
    'ada@example . com', 'ada@163.com', 'ada @ example.test', 'ADA@EXAMPLE.COM', 'ada\uFF20example.com', 'ada\uFE6Bexample.com',
    'ada@example\u3002com', 'ada+test@example.com', 'ada@sub.example.co.uk', 'ada @example.com', 'ada@ example.com',
    'ada at example dot com', 'ada [at] example [dot] com', 'ada (at) example (dot) com', 'ada AT example DOT com', 'ada(at)gmail.com',
    'write to ada at gmail.com', 'Invite link https://app.example.test/accept?email=ada%40example.com fails', 'ada%40example.com',
    'ada%40gmail.com', 'ada&#64;example.com', 'ada&commat;example.com', 'Add ada [@] example.com to my team',
    'Add ada (@) example.com to my team', 'Add ada[@]example[.]com to my team', 'Write to ada <at> example <dot> com',
    'ada[@] example.com', 'ada [@] example [.] com', 'ada(@)example(.)com', 'ada<at>example<dot>com', 'ada <at> example.com',
    'ada _at_ example _dot_ com', 'ada -at- example -dot- com', 'ada @ example [.] com', 'Add ada@@example.com to my team',
    'ada@@example.com', 'ada@@gmail.com', 'ada@ @example.com', 'Add ada @ example\u3002com to my team', 'ada @ example\u00B7com',
    'ada @ example\uFF61com', 'ada @ example\u2219com', 'ada@ example\u3002com', 'ada @example\u3002com', 'Add ada@ gmail to my team',
    'ada @gmail', 'ada @ gmail', 'Email ada @ yahoo please', 'ada @ gmail com', 'ada@\ngmail', 'Write to ada at rocketmail.com',
    'ada at live.com', 'ada at msn.com', 'ada at gmx.com', 'ada at zoho.com', 'ada at yandex.com', 'ada at gmail',
    'write to ada at gmail please', 'Write to \u202Emoc.elpmaxe @ ada\u202C please', 'Write to \u202Emoc tod elpmaxe ta ada\u202C',
    '\u202Emoc.elpmaxe @ ada', '\u202Emoc.liamg @ ada', 'ada@ɡmail', 'ada@ɑol',
  ],
  'the review of 3cbf25a: with words, wards, beds and ordinals between HID and the code': [
    'HID for my patient KQZXTW cannot sign in', 'HID for the patient KQZXTW', 'Health ID of patient KQZXTW will not load',
    'The Health ID of the patient in ward 3B is kqz2xt', 'The HID of my 2nd patient today is kqz2xt',
    'The HID of the 4th patient is kqz2xt', 'HID for bed 12A patient: kqz2xt',
    'The HID of the woman in bed four who came in this morning is kqz2xt',
    'The Health ID of the elderly patient admitted yesterday afternoon to ward three is abc234', 'I searched for kqz2xt this morning',
  ],
  'the review of 3cbf25a: without HID, or as a patient ID': [
    'Patient kqz2xt cannot sign in', 'patient 7kq2m9 record will not open', 'Search for kqz2xt returns no patient',
    'Patient KQZ2XTWM cannot sign in', 'Patient ID: kqz2xt', 'Patient ID kqz2xt cannot sign in', 'Her ID is 7kq2m9', 'ID number kqz2xt',
    'Her HID is ABC120', 'The HID number is KQ0ZXT', 'HID of the patient: AB1234',
  ],
  'the review of 3cbf25a: from keys, JSON and links': [
    '{"patientHealthId":"kqz2xt"}', 'HIDNo: kqz2xt', 'healthIdNumber: kqz2xt', '?patientHid=kqz2xt', 'patientHID: kqz2xt', 'myHID abc234',
    'HealthIdNo kqz2xt', 'hidNumber=kqz2xt', 'HIDno. kqz2xt',
  ],
  'the review of 3cbf25a: after HID misspelled or drawn with other letters': [
    'h1d kqz2xt', 'hld kqz2xt', 'Hld: kqz2xt', 'H1d kqz2xt', 'HlDkqz2xt', 'H1Dkqz2xt', 'hldkqz2xt', 'Heath ID kqz2xt', 'Helath ID: kqz2xt',
    'Helth ID kqz2xt', 'Hlth ID kqz2xt', 'H-ID: kqz2xt', 'H.ID kqz2xt', 'H|D kqz2xt', 'H!D kqz2xt', 'ĦID kqzxtw', 'ħid abc234',
    'hiđ abc234', 'HIĐ kqz2xt', 'HIÐ kqz2xt', 'HIƊ kqz2xt', 'HƖD kqz2xt', 'Hɩd kqz2xt', 'H丨D kqz2xt',
  ],
  'the review of 3cbf25a: read out in uneven groups, spelled or with signs between': [
    'hid kqzx 2m9', 'hid abc 2 3 4', 'hid abc 23 4', 'Health ID: kqz2 m9', 'HID kqz2 xt cannot sign in',
    'Patient hid 7kq2 m9 will not load', 'HID Kqz2 M9', 'HID\tkqz2\txt', 'HID kilo quebec zulu two mike nine',
    'Health ID is Kilo Quebec Zulu X-ray Tango Whiskey', 'HID seven kilo quebec two mike nine', 'HID seven K Q two M nine',
    'hid abc two three four', 'HID ABC ... 234', 'hid abc \u2026 234', 'HID ABC - - 234', 'HID KQZ --- 2XT', 'HID ABC (234)',
    'HID (KQZ) (2XT)', 'HID ABC = 234', 'HID ABC ; 234', 'HID \'ABC\' \'234\'', 'HID kqz # 2xt', 'HID KQZ\\2XT',
    'Health ID ........ kqz2xt', 'HID........kqz2xt', 'HID ________ kqz2xt', 'HID::::::: kqz2xt', 'HID: -> -> kqz2xt',
    'HID \u2192\u2192 \u2192\u2192 kqz2xt', 'HID 👉👉👉👉👉 kqz2xt',
  ],
  'the review of 3cbf25a: in other scripts, symbols and enclosed letters': [
    'HID ᎪᏴᏟ234', 'HID ᏦᎤZᎡᎢᎳ', 'HID ᗅᗷᑕ234', 'HID αbc234', 'HID ϲba234', 'HID 7ƙq2m9', 'HID 🅰🅱🅲234', 'HID 🅺🆀🆉🆇🆃🆆', 'HID 🅐🅑🅒234',
    'HID 🇰🇶🇿🇽🇹🇼', '🅷🅸🅳 abc234', '⒣⒤⒟ ⒜⒝⒞234', 'HID ⒜⒝⒞⑵⑶⑷', 'HID KQZ\uA4F82XT', 'HID\uA4FD kqz2xt', 'HID kqz\uA4F92xt', 'HID\u02D0 kqz2xt',
    'HID KQZ\u02D02XT', 'HID \u02BCkqz2xt\u02BC', 'HID ꞌkqz2xtꞌ',
  ],
  'the review of 3cbf25a: phone numbers and NINs': [
    'Ring + 234.1.234.5678', '+ 234.1.234.5678', '+ 44.20.7946.0958', '+(234.1.234.5678)', '+-234.1.234.5678', 'Call + 234.1.234.5678',
    'Call 0803:123:4567', 'Call 0803*123*4567', 'Call 0803,123,4567', '0803:123:4567', '+234:803:123:4567', 'NIN: 1234:5678:901',
    '0803*123*4567', 'Call 0803\u23AF123\u23AF4567', 'Call 0803ㅡ123ㅡ4567', 'Call 080з 12з 4567', '080з 12з 4567', 'Call 080б 123 4567',
    '080Ʒ 12Ʒ 4567', 'Call nought eight nought three one two three four five six seven', 'Call zero 8 zero 3 one 2 three 4 five 6 seven',
    'Call 0803&ndash;123&ndash;4567', '0803&mdash;123&mdash;4567', '0803&minus;123&minus;4567', '0803&middot;123&middot;4567',
    '0803&thinsp;123&thinsp;4567', '🄋➇🄋➂➀➁➂➃➄➅➆', '🄌➑🄌➌➊➋➌➍➎➏➐', '🄁🄉🄁🄄🄂🄃🄄🄅🄆🄇🄈', '0803 - - - 123 - - - 4567', '0803 . . . 123 . . . 4567',
    '0803 ------ 123 ------ 4567', '0803 ______ 123 ______ 4567', 'N.I.N-1990-1234567', 'NIN no-1990-1234567', 'NIN No/2001/2345678',
    'NIN: ID-2001-2345678',
  ],
  'the review of 3cbf25a: email addresses': [
    'Write to \u2067example.com\u200F @ \u200Fada\u2069 please', 'Invite ada%4\u200B0example.com please', 'ada%４０example.com',
    'Add ada @ example . com to my team', 'ada @ example . com', 'ada@ example. com', 'ada @example .com', 'ada@ example .com',
    'ada @ example .ng', 'Add ada @ example\u2E33com to my team', 'ada @ example\u2E33com', 'ada@ example\u2E33com', 'ada @ exampleꞏcom',
    'ada @ exampleᐧcom', 'Write to ada "at" example "dot" com', 'ada \'at\' example \'dot\' com',
    'ada \u201Cat\u201D example \u201Cdot\u201D com', 'ada *at* example *dot* com', 'ada *at* gmail *dot* com',
    'Write to ada at example [dot] com', 'ada at example (dot) com', 'ada at example {dot} com', 'ada at example <dot> com',
    'ada at example _dot_ com', 'Her email is ada.obi at example.com', 'email: ada at example.com', 'Write to ada at mail.com',
    'ada at me.com', 'ada at mac.com', 'ada at pm.me', 'ada at fastmail.com', 'ada at hey.com', 'ada at qq.com', 'ada at 163.com',
    'ada at my-clinic dot com', 'ada @ my-clinic dot com', 'ada at the-clinic dot ng', 'ada at a-z dot com', 'Add ada@օutlook to my team',
    'ada@ⲟutlook', 'ada@үahoo', 'ada@ǥmail', 'ada@ɠmail', 'ada(a)example.com', 'ada (a) example.com', 'adaⓐexample.com',
    'ada ⓐ example.com',
  ],
  'a Health ID of letters only, keyed in after its label and a sign': [
    'hid: kqzxtw', 'HID: abcdef', 'Health ID: kqzxtw', 'health_id=kqzxtw', 'Patient ID: kqzxtw', 'ID: abcdef', 'HID number: abcdef',
    '?patientHid=kqzxtw', '{"hid":"kqzxtw"}', 'Health ID # KQZXTW', 'HID: abcdefgh', 'patient_id: zdemaaah',
  ],
}

/** Ordinary support questions, by kind (the reviews' cases among them), each sent. */
const SENT: Record<string, readonly string[]> = {
  'common words after HID': [
    'Health ID charged me out', 'Health ID deducts me out', 'Health ID deducted me out', 'Health ID refunds me out',
    'Health ID refunded me out', 'Health ID rejects me out', 'Health ID refused me out', 'Health ID accepts me out',
    'Health ID marked me out', 'Health ID flagged me out', 'Health ID warned me out', 'Health ID handles me out',
    'Health ID handled me out', 'Health ID generates me out', 'Health ID generated me out', 'Health ID restarts me out',
    'Health ID restarted me out', 'Health ID refreshes me out', 'Health ID refreshed me out', 'Health ID upgraded me out',
    'Health ID deletes me out', 'Health ID suddenly me out', 'Health ID frequently me out', 'Health ID usually me out',
    'Health ID repeatedly me out', 'Health ID recently me out', 'Health ID rarely me out', 'Health ID generally me out',
    'Health ID regularly me out', 'Health ID barely me out', 'Health ID nearly me out', 'Health ID currently me out',
    'Health ID expects me out', 'Health ID requested me out', 'Health ID texted me out', 'Health ID messaged me out',
    'Health ID synced me out', 'Health ID tracks me out', 'Health ID tracked me out', 'Health ID matches me out',
    'Health ID matched me out', 'Health ID merges me out', 'Health ID creates me out', 'Health ID remembers me out', 'HID clerks question',
    'HID agency question', 'HID weekly question', 'HID yearly question', 'HID annual question', 'HID quarterly question',
    'HID backup question', 'HID backups question', 'HID refund question', 'HID refunds question', 'HID charge question',
    'HID bundle question', 'HID bundles question', 'HID budget question', 'HID tablets question', 'HID dental question',
    'HID antenatal question', 'HID surgery question', 'HID theatre question', 'HID survey question', 'HID surveys question',
    'HID launch question', 'HID latency question', 'HID standard question', 'HID starter question', 'HID advanced question',
  ],
  'dates, times and date ranges': [
    'I could not sign in on 2026-10-30 07:15, why?', 'Error at 31.10.2026 14:05', 'Between 09:00 and 17:30 on 30.10.2026',
    'Meeting at 14:30 on 2026-10-30', '30/10/2026-02/11/2026', '2026-10-01\u20132026-10-31', '01.10.2026-31.10.2026',
    'Report 2026-10-01\u20132026-10-31 is empty', '01/10/2026-31/10/2026', 'US 10/01/2026-10/31/2026 report', 'Times 09:00-17:30 daily',
    'ISO 2026-10-30T07:15:00Z', 'Between 2026-10-01 and 2026-10-31', 'From 01/10/2026 to 31/10/2026', '07:15 - 08:30 - 09:45 - 10:00',
    '2026-10-01 \u2013 2026-10-31', 'HID update 2026-10-30 failed', 'Lab result 12.5 mmol/L at 10:30', 'O2 sat 98% at 10:30',
    'HID support hours 9am-5pm?', 'Health ID helpdesk hours 9am-5pm?', 'HID clinic 8am\u20136pm', 'HID 2pm-4pm', 'HID Mon-Fri 8am-6pm',
    'HID SMS between 8am-9am', 'HID was slow at 2pm and 4pm', 'Health ID SMS came at 8am and 9am', 'Is Health ID open 9am to 5pm?',
    'HID card expired on the 5th', 'HID login failed for the 2nd time', 'Health ID renewal due Jan 3rd', 'HID card expires Dec 2nd',
    'HID May 2nd', 'Health ID was down Tue 3rd', 'Health ID down Sat 7th and Sun 8th', 'Health ID down since Sept 23rd',
    'HID outage 23rd-25th Oct', 'HID down from the 2nd to the 4th', 'Health ID 2nd/3rd attempt', 'HID 22:34:56 log',
    'Report 01/10/26 - 31/10/26 is empty', 'Downtime on 30/10/26 1430hrs, was it planned?',
    'Shift times 07.00-15.00 / 15.00-23.00 do not show',
  ],
  'prices, with or without @': [
    'Pay NGN 1,000,000', 'Our invoice of 2026-10-30 for NGN 25,000: when is it due?', 'Invoice 2026/10/30 for NGN 12,500', '₦10000000.00',
    'NGN 25000000 was charged', '5000000 naira refund', '₦1,500,000.00 for 12 months', '$1,000,000', 'Dose 500mg x 2 x 3 days',
    'Is the plan ₦25000-50000 per month?', 'Plans cost NGN 25000 - 50000 per month?', 'Is the fee two thousand naira?',
  ],
  'versions and IP addresses': [
    'Version 2.1 on 30/10/2026', 'App version 1.0.2026.1030', 'Chrome Version 130.0.6723.92 (Official Build) (64-bit)',
    'Safari 18.1 on iOS 18.1.1', 'Samsung Internet 26.0.3.1', 'Firefox 131.0.3', 'App 1.2.3 (build 4567)', 'Build 22631.4317',
    'Health ID app v1.0.2026.1030 on Android', 'Why does the HID page say v2.3.1?', 'the HID team asked for v2.3.1',
    'Microsoft 365 Version 2409 (Build 18025.20140) cannot open the export', 'App version 1.0.20261030 will not install',
    'About page says Build 20261030.12',
  ],
  'references and ids': [
    '98d00002-0000-4000-8000-000000000001', 'Request id 0f2b5a5e-7c1d-4e8a-9b3c-2d4e6f8a0b1c', 'Postcode 100001', 'Room 101 to 120',
    'Pages 12, 13 and 14',
  ],
  'product words and questions about Health IDs': [
    'How do I reset my password?', 'What is a HID- number?', 'What is my HID number?', 'WHAT IS MY HID NUMBER?', 'HIDE the menu',
    'HID number', 'HID-Pharmacy', 'Our HID-Pharmacy page is blank', 'hid-1.0', 'HID-1.0 app', 'the HID-1.0 app', 'Where is hid-system?',
    'Health ID app', 'HID PHARMACY NOT LOADING', 'HID SECURE LOGIN FAILS', 'HID REPLACEMENT CARD', 'HID APP UPDATE FAILED',
    'Our HID WEB APP is down', 'Where is my HID API KEY?', 'the HID EHR LAB page', 'MY HID CARD WAS LOST', 'MY HID CARD HAS BEEN BLOCKED',
    'MY HID CARD PAGE IS BLANK', 'HID NEW USER', 'HID-ehr-blue not loading', 'hid-backend release', 'HID gateway 502 error',
    'Our HID gateway and database are slow', 'HID health records', 'The HID helpdesk is closed', 'My HID scanner beeps',
    'Can a HID be changed?', 'My HID changed', 'HID card was renewed', 'Is the HID system down?', 'What does HID-XXXXXX mean?',
    'The Health ID 2FA page is blank', 'Health ID 2FA codes are late', 'HID 2FA step fails', 'HID 2FA text came late',
    'Health ID v2 app went dark', 'Our HID v3 web page crashes', 'HID 24 hrs late', 'HID 24 hours later', 'HID 50 per page max?',
    'HID update 2 failed', 'HID screen 2 is blank', 'HID 2.3.4 update failed', 'The HID card has 6 letters', 'HID: 6 characters?',
    'HID is 6 characters long', 'Is HID 6 or 8 characters?', 'Can a HID have 32 characters?', 'Health ID setup takes 22 days',
    'Health ID is 22 days late', 'What is the HID used for in 2026?', 'Our clinic uses HID since 2019', 'HID login takes 30 seconds',
    'Health ID number format?', 'Where do I see my HID?', 'Can I change my HID?', 'What does HID stand for?', 'HID vs NIN',
    'HID 2026 roadmap', 'HID phase 2', 'How do I get a HID? Thanks', 'I lost my HID. Regards', 'Health ID app 2FA not working',
    'The HID app 2FA code is late', 'HID web 2FA fails', 'HID new 2FA flow', 'Health ID web and app 2FA', 'Health ID SMS limit per 24h',
    'HID 2FA app', 'Health ID 2FA SMS never came', 'Health ID app is slow on SAMSUNG A54 5G', 'Does the Health ID app need 4GB RAM?',
    'HID Standard plan', 'HID plan: STANDARD', 'Health ID Kaduna branch', 'Plateau HID office', 'HID resync button',
    'HID unsynced records', 'HID support is great. Thanks', 'HID, please help', 'HID \u2192 Settings \u2192 Users',
    'HID > Settings > Users',
  ],
  'words written after HID': [
    'Health ID unable to load', 'HID unable to verify NIN', 'HID refund request', 'HID suddenly logged me out', 'Was HID hacked?',
    'HID balance is wrong', 'HID schedule for training', 'HID feedback form', 'HID renewals are late', 'Health ID alphabet',
    'HID secret question', 'Health ID weekend support?', 'HID theatre list empty', 'Health ID launched in 2019?', 'I lost my HID. Cheers',
    'HID, unable to load', 'Health ID handles referrals?', 'Health ID generated a duplicate invoice', 'Health ID suddenly logged me out',
    'My Health ID suddenly logged me out at 10:15', 'Health ID frequently logs me out after 10 minutes', 'HID usually asks for MFA twice',
    'Health ID refused my password after the update', 'HID rejects my new password', 'Health ID charged us twice this month',
    'Health ID deducted ₦5,000 twice', 'Health ID marked the invoice as unpaid', 'Health ID restarts when I open Lab orders',
    'HID annual fee for 2027?', 'HID Starter vs HID Advanced plan?', 'What does HID Standard include?', 'Health ID agency in Kano?',
    'HID weekly report is empty', 'HID backup failed last night', 'Health ID latency is high today',
    'Can Health ID clerks register babies?', 'HID tablets keep losing Wi-Fi', 'HID dental unit cannot see referrals',
    'HID survey link is broken', 'Health ID bundle pricing?', 'The latest update hid several buttons on the dashboard',
    'The new layout hid unread messages',
  ],
  'questions typed in capitals': [
    'MY HEALTH ID IS DELAYED', 'HID CHARGED US TWICE', 'WHY DOES THE HID PAGE SAY V2.3.1?', 'THE HEALTH ID 2FA PAGE IS BLANK',
    'HID 2FA STEP FAILS', 'HID 2FA TEXT CAME LATE', 'HEALTH ID V2 APP WENT DARK', 'OUR HID V3 WEB PAGE CRASHES', 'HID 24 HRS LATE',
    'THE HID CARD HAS 6 LETTERS', 'CAN A HID HAVE 32 CHARACTERS?', 'HEALTH ID SETUP TAKES 22 DAYS', 'HEALTH ID IS 22 DAYS LATE',
    'HID PHASE 2', 'HID WEB PAGE', 'HID UPDATE FAILED', 'HID CARD PRINTER JAMS', 'HID BACKUP FAILED AT 2AM',
    'HEALTH ID APP 2FA NOT WORKING', 'HEALTH ID SUPPORT HOURS 9AM-5PM', 'HID WAS DOWN ON THE 5TH', 'MY HID CARD EXPIRES DEC 2ND',
  ],
  'questions about mail': [
    'Look at the dot matrix printer settings please',
  ],
  'text with accents, emoji, marks and @ words': [
    'Café opening hours?', 'Cafe\u0301 decomposed', 'naïve', 'Yoruba: Ẹ kú àárọ\u0300', 'Thanks 👍\u{1F3FD}',
    'Step 1\uFE0F\u20E3 then 2\uFE0F\u20E3', 'Log in at app.healthid.ng fails',
  ],
  'told apart now': [
    'Ref 2026/10/30-1234', 'HID v2 vs v3', 'Health ID Nyanya branch', 'Why is the total 45000.00 - 5000.00 = 40000.00?',
    'My Health ID login code 482935 expired', 'The Health ID app sent code 482935 but it says invalid',
  ],
  'the review of 3cbf25a: questions it found refused': [
    'Health ID created 235 new accounts today', 'Is Health ID ₦499 per month?', 'Health ID tickets 245 and 246 are still open',
    'HID PHC LGA list is wrong', 'Health ID PHC LGA mapping', 'HID KYC BVN check fails', 'HID ANC PNC visits', 'HID UBTH AKTH referrals',
    'HID GTB UBA payments', 'HID PWA APK', 'HID 2FA SMS 6 digits?', 'HID 256 GB RAM?', 'HID 25 MB PDF limit',
    'Is the plan N25000 - 50000 per month?', 'Is the plan N25000-50000 per month?', 'Plan N 25000-50000 monthly?',
    'The file backup-2026-10-30-0915.zip will not restore', 'Health ID FBC, LFT results do not show', 'HID ANC PNC REGISTER IS EMPTY',
    'HID LGA PHC LIST IS EMPTY', 'Our Q2, Q3, Q4 HID invoices are missing', 'Wards 2A, 2B, 2C cannot use Health ID',
    'HEALTH ID EHR V2 BUG', 'Shift starts 07.00 / 15.00 / 23.00 do not show', 'I tapped at three dot menu and nothing happens',
    'Look at green dot beside my name, what does it mean?', 'Click at 3-dot icon on Lab orders does nothing', 'HID Nassarawa office',
    'HID Sapele office', 'HID Mararaba office', 'HID Kafanchan office', 'HID Badagry office', 'Does HID mHealth work offline?',
    'HID ePharmacy module price?', 'Does the HID ePharmacy module support NAFDAC numbers?', 'Health ID Palmpay option missing',
    'HID GTBank transfer not reflecting', 'HID Mastercard payment declined', 'HID eTranzact payment failed', 'HID Realme C55 login fails',
  ],
}

/**
 * Ordinary questions refused on purpose (#61, option a): the guard refuses shapes, not words, and these have the
 * shape of a personal detail. Each is sent once it is put another way ("Chrome version 130.0.6723.91", "error 429",
 * "invoice from 30 October", "late at night with Gmail" without the @).
 */
const REFUSED_ON_PURPOSE: Record<string, readonly string[]> = {
  'codes of letters and digits, and capitals straight after HID': [
    'BP 120/80 at 09:15', 'Windows 11 23H2', 'Order 3F2A9C2B is not showing', 'Reference 0F2B6D0E', 'HID SYSTEM', 'HID ACCESS problem',
    'Health ID returns HTTP 429 when I sign in', 'Health ID returns HTTP 422 when I sign in', 'Health ID is slow on HP 255 G9',
    'Health ID will not load on MTN 4G LTE', 'HEALTH ID AT WARD 3B IS DOWN', 'HID SMS LIMIT PER 24H', 'Hash SHA256 fails',
    'The app is slow on Infinix Hot 40i (X6528B)', 'Discount code SAVE25 does not work at checkout',
  ],
  'numbers of 7 or more digits: versions without their word, references, lists and sums': [
    'Shifts 0700-1500/1500-2300 are not saved', 'Can I export 2024/2025/2026 at once?', 'Our SMS credits show 2500/5000 (50%)',
    'Total = 2500 + 2500', 'Chrome 130.0.6723.91', 'Chrome 130.0.6723.116 on Windows 10.0.19045',
    'Chrome 130.0.6723.117 shows a blank page', 'Chrome 118.0.5993.88', 'Edge 130.0.2849.68', 'IP 192.168.100.254',
    'Edge 130.0.2849.80 and Chrome 130.0.6723.91', 'Android 14 build UP1A.231005.007', 'Error 0x80070005',
    'New Teams 24295.606.3238.6194 cannot share screen for teleconsults', 'Invoice HID-2026-000123 shows the wrong amount',
    'INV-2026-000123', 'ORD-20261030-0042', 'Hidden fees on invoice INV-2026-0042?',
    'Health ID billing: invoice INV-2026-0042 for NGN 45,000', 'Accession ACC-2026-000123 will not print', 'Licence MDCN/2026/12345',
    'Invoice No12345678', 'invoice hid-2026-000123 shows the wrong amount', 'inv-2026-000123', 'ord-20261030-0042',
    'accession acc-2026-000123 will not print', 'Invoice inv-2026-000123 shows the wrong amount',
    'Invoice Inv-2026-000123 shows the wrong amount', 'Receipt RCT-202610-00042 was never emailed', 'Ticket T-2026-004821 is still open',
    'The file Screenshot_20261030-143015.png will not upload', 'Export export_20261030_143015.csv is empty',
    'We keep getting 401/403/500/502 errors', 'Our facility code 24/12/1/2/1/0001 shows the wrong name',
    'Facility map pin 9.0765 7.3986 is wrong', 'Our TIN 12345678-0001 is wrong on the invoice',
    'Remita RRR 280456123456 payment not reflecting', 'HID refund for invoice INV-2026-0042?', 'Lot number 2026-1030-4567',
    'Ticket #1234567890', 'Invoice no. 2026-000123 has the wrong total', 'Invoice INV 2026 000123 is not in the list',
    'Rooms 101 102 103 104 have no network since Monday', 'Beds 11 12 13 14 15 do not show in the ward list',
    'Invoice 20261030 (12 items) is wrong', 'PO 4500012345 was rejected',
    'Paystack reference T685312094857261 shows paid but invoice is open', 'Is the backup code format 1234-5678-9012?',
  ],
  'an @, or someone at a mail service': [
    'We bought 2 units @ 500.00 each', '10 boxes @ ₦5,000.00', '3 @ 1.50 each', 'Rate @ 2.5% per month', 'Meet @ 10.30 am', 'Price @ 500',
    '10 tests @ 2.50 each on the bill', 'price @ 5.00', 'units @ each', 'We bought 2 units@N500 each', 'Rate: 2@N500', '10 boxes@N5,000',
    'Paracetamol 10pcs@N500 on the invoice is wrong', 'Verification emails arrive late at Gmail', 'Codes never arrive at Yahoo',
    'Emails land in spam at Outlook', 'Sign in at Gmail fails', 'OTP mail goes to junk at Hotmail', 'Our staff use accounts at iCloud',
    'Reset emails go to spam at Gmail', 'I looked at Outlook and the reset email is not there', 'Emails bounce at Outlook since Monday',
    'Is the billing training @ 9a.m. on Monday?', 'Meeting @ 2p.m. about the rollout', 'Is your X account (@HealthIDng) official?',
    'Email support@ please', '@mention me', 'Twitter @HealthID', 'me @ 10am', 'Meet @ the lab. Thanks', 'I\'m @ work. Please help',
    'Can\'t log in @ app.healthid.ng', 'Is Welcome@Home2026 strong enough as a password?',
  ],
  'the review of 3cbf25a: a number or capitals straight after HID read as a Health ID': [
    'HID 235 new accounts today', 'HID 525 SSL handshake failed', 'Health ID 422 bad data', 'HID SMS 2FA 6 digits', 'IS HID EHR 24/7?',
    'Is the HID SLA 24/7?', 'HID LASHMA claims are rejected', 'Is HID LASHMA approved?', 'HID KADCHMA claims portal',
    'HID PLASCHEMA enrolment',
  ],
  'the review of 3cbf25a: codes of letters and digits': [
    'Invoices for Q2/Q3/Q4 are missing from Health ID billing', 'Rooms 2A/2B/2C on the first floor',
    'Error code ERR429 when I open Lab orders', 'Error code AUTH42 after entering the OTP', 'Error ref 7F3A9C on the billing page',
  ],
  'the review of 3cbf25a: numbers of 7 or more digits': [
    'Shift change times 0800/1400/2000 are wrong on the rota', 'Ward round at 0800/1200/1600', 'Can we have 3 shifts 0700 1500 2300?',
    'Ward round times 0800 1200 1600 2000 do not save', 'Records from 2019 2020 2021 are missing',
    'Barcode 6151234567890 does not scan in Pharmacy', 'Our tablet IMEI 356938035643809 is not enrolled in MDM',
  ],
  'the review of 3cbf25a: an @, or someone at a mail service': [
    'We bought 2 units@NGN500 each', 'Paracetamol 10pcs@NGN500 on the invoice is wrong', 'Can staff sign in with @clinic.ng emails?',
    'Do invites work for @example.test addresses?', 'Email verification not working at Outlook',
    'Verification failing at Gmail since Monday', 'Reset mails are slow at Yahoo', 'Can staff use addresses at Gmail?',
    'Codes arrive late @ Gmail', 'Emails go to spam @ Outlook', 'We bought 10 units@NGN500 each', 'SMS units@USD2 each?',
    'Is the Health ID training @ St.Mary\'s on Friday?', 'Meeting @ H.Q. on Monday', 'Can you help @ once.Thanks',
    'Logo@2x.png does not upload as the facility logo', 'icon@3x.png is too large for the logo',
  ],
}

/**
 * A Health ID of letters only, written other than in its printed form (lower case, before HID, in a table): the client
 * cannot tell it from a word without a dictionary, so it is sent, and support-api checks it against the Health IDs
 * issued. Pinned here so that a change to it is deliberate.
 */
const LEFT_TO_SUPPORT_API = [
  'HIDKQZ XTW', 'HID ABC DEF', 'HID ABC DEF GHJ', 'HID ABCD EFGH', 'HID KQZ XTW', 'Health ID: KQZ\u00B7XTW', 'MY HID NUMBER IS ABCDEF',
  'H.I.D. kqzxtw', 'HID; kqzxtw', 'HID \u2039kqzxtw\u203A', 'HID\u2026kqzxtw', 'HID support: KQZXTW', 'kqzxtw is the patient\'s Health ID',
  'KQZXTW is her HID', 'kqzxtw (HID)', 'patient hid abcdef will not load', 'HID abcdef', 'HID Abcdef', 'Hid abcdef', 'hidabcdef',
  'HIDabcdef', 'hid \u2013 abcdef', 'hid\nabcdef', 'HID-abcdef', 'hid-kqzxtw', 'hid ａｂｃｄｅｆ', 'HID\u200Babcdef',
  'Before the update the HID showed KQZXTW', 'Patient KQZXTW HID will not load', 'KQZXTW - her HID', 'Our patient KQZXTW has no HID card',
  'Name, HID: Ada Obi, KQZXTW', '| Name | HID |\n| Ada Obi | KQZXTW |', 'name,hid\nAda Obi,KQZXTW',
]

describe('the privacy guard refuses before anything is sent', () => {
  it.each([
    ['a Health ID', 'Why can\'t I open HID-ABCDEF23?'],
    ['an 11-digit NIN', 'The NIN 12345678901 is refused'],
    ['an email address', 'Add ada.example@example.test to my team'],
    ['a phone number', 'Call the patient on 0803 123 4567'],
    ['an international phone number', 'Text +234 803 123 4567 about the result'],
    ['a Health ID with a space', 'Why can\'t I open HID ABC234?'],
    ['a Health ID in lower case', 'patient hid abc234 will not load'],
    ['a Health ID with no hyphen', 'Open HIDABC234 for me'],
    ['a Health ID after a colon', 'Record HID: ABC123 is locked'],
    ['a Health ID with an en dash', 'HID – ABC234 is missing'],
    ['a phone number with spaced dashes', 'Call the patient on 0803 - 123 - 4567'],
    ['a phone number with slashes', 'Ring 0803/123/4567 after lunch'],
    ['an email address with spaces round the @', 'Invite ada @ example.test please'],
    ['a Health ID read out in groups', 'Patient HID ABC 234 cannot sign in'],
    ['a Health ID in groups of four', 'Open HID ABCD-EFGH-2345 please'],
    ['a Health ID in brackets', 'Record HID (ABC234) will not open'],
    ['a Health ID after "is"', 'The patient\'s Health ID is 7KQ2M9 and she can\'t sign in'],
    ['a Health ID after "number"', 'HID number ABC234 is locked'],
    ['a Health ID of letters, as printed', 'Open HID-KQZXTW please'],
    ['a Health ID with a Cyrillic H', 'Open НID-ABC234'],
    ['a Health ID alone, as issued', 'Patient 7KQ2M9 cannot sign in'],
    ['a phone number with left-to-right marks', 'Call 0803‎123‎4567'],
    ['a phone number with bidi isolates inside', 'Call 0803⁦123⁩4567'],
    ['a phone number in Arabic-Indic digits', 'Call ٠٨٠٣١٢٣٤٥٦٧'],
    ['a Lagos landline', 'Ring the clinic on 01 234 5678'],
    ['an email address without a dot', 'Add ada@gmail to my team'],
    ['an email address spelled out', 'Write to ada at example dot com'],
    ['a Health ID before HID', 'Patient abc234 (HID) cannot sign in'],
    ['a Health ID after H.I.D. and its dot', 'H.I.D. KQZXTW'],
    ['a Health ID with a middle dot between groups', 'HID ABC·234'],
    ['a Health ID from a log line', 'health_id: abc234'],
    ['a Health ID typed against HID, in groups', 'HIDABC 234'],
    ['a Health ID in a pasted search link', 'search?q=hid%20abc234'],
    ['a phone number with doubled dashes', 'Call 0803 -- 123 -- 4567'],
    ['a dotted international number', 'Ring the clinic on +234.1.234.5678'],
    ['a NIN after a NIN label', 'Her NIN-1990-1234567 is refused'],
    ['a phone number with C1 controls inside', 'Call 0803\u0085123\u00854567'],
    ['a defanged email address', 'Add ada [@] example.com to my team'],
    ['an email address at a webmail name', 'Add ada@ gmail to my team'],
    ['an email address turned round by a right-to-left override', 'Write to ‮moc.elpmaxe @ ada‬ please'],
    // The review of 3cbf25a, one of each kind, through the drawer.
    ['a Health ID after words between', 'HID for my patient KQZXTW cannot sign in'],
    ['a Health ID after a ward number', 'The Health ID of the patient in ward 3B is kqz2xt'],
    ['a Health ID in a JSON key', '{"patientHealthId":"kqz2xt"}'],
    ['a Health ID read out by the spelling alphabet', 'HID kilo quebec zulu two mike nine'],
    ['a Health ID in Cherokee letters', 'HID ᎪᏴᏟ234'],
    ['a phone number with colons', 'Call 0803:123:4567'],
    ['a phone number spelled out', 'Call nought eight nought three one two three four five six seven'],
    ['an email address with "at" in quotes', 'Write to ada "at" example "dot" com'],
  ])('%s', async (_, question) => {
    const { sent, drawer } = await openHelp({ [SUPPORT]: [answer('Never sent.')] })
    ask(drawer, question)
    const reason = refusalFor(question)
    expect(reason).not.toBeNull()
    expect(drawer.getByRole('alert').textContent).toBe(`${REFUSAL} ${REFUSAL_REASONS[reason!]}`)
    // Nothing went out, and the question waits in the box to be changed.
    expect(sent.some(call => call.route === SUPPORT)).toBe(false)
    expect((drawer.getByRole('textbox', { name: 'Your question' }) as HTMLInputElement).value).toBe(question)
    expect(drawer.queryByText(question)).toBeNull()
  })

  it('takes the refusal away once the question is changed', async () => {
    const { drawer } = await openHelp({ [SUPPORT]: [answer('Answered.')] })
    ask(drawer, 'Call the patient on 0803 123 4567')
    expect(drawer.getByRole('alert').textContent).toBe(`${REFUSAL} Remove phone numbers, NINs and other numbers of 7 or more digits.`)
    fireEvent.change(drawer.getByRole('textbox', { name: 'Your question' }), { target: { value: 'How do I reset my password?' } })
    expect(drawer.queryByRole('alert')).toBeNull()
  })

  it.each([
    'Our invoice of 2026-10-30 for NGN 25,000: when is it due?',
    'Chrome version 130.0.6723.91 shows a blank page',
    'Report 2026-10-01–2026-10-31 is empty',
    'We bought 2 units at ₦500.00 each',
    'Our HID-Pharmacy page is blank',
    'WHAT IS MY HID NUMBER?',
    'HID support hours 9am-5pm?',
    'Health ID handles referrals?',
    'Health ID app 2FA not working',
    'Health ID returns error 429 when I sign in',
    'Health ID created 235 new accounts today',
    'HID PHC LGA list is wrong',
    'Report 01/10/26 - 31/10/26 is empty',
    'I tapped at three dot menu and nothing happens',
    'Is the billing training at 9a.m. on Monday?',
    'Log in at app.healthid.ng fails',
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

  it.each(Object.entries(REFUSED_ON_PURPOSE))('refuses on purpose %s', (_, questions) => {
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it('sends a Health ID of letters only written other than as printed, for support-api to check', () => {
    expect(LEFT_TO_SUPPORT_API.filter(question => holdsPersonalDetails(question))).toEqual([])
  })

  it.each([
    ['characters', 'Open НID-ABC234'], ['characters', 'Call 0803⁦123⁩4567'], ['characters', 'HID \u{1F170}\u{1F171}\u{1F172}234'],
    ['characters', 'adaⓐexample.com'], ['characters', 'Call 080з 12з 4567'], ['encoded', 'search?q=hid%20abc234'],
    ['encoded', 'ada&#64;example.com'], ['encoded', 'Call 0803&ndash;123&ndash;4567'], ['email', 'Add ada.example@example.test to my team'],
    ['email', 'Write to ada at example dot com'], ['email', 'write to ada at gmail please'], ['number', 'Call the patient on 0803 123 4567'],
    ['number', 'The NIN 12345678901 is refused'], ['number', 'Chrome 130.0.6723.91'], ['code', 'Why can\'t I open HID-ABCDEF23?'],
    ['code', 'Patient 7KQ2M9 cannot sign in'], ['code', 'Open HID-KQZXTW please'], ['code', 'HID kilo quebec zulu two mike nine'],
  ] as const)('says what to remove: %s for %j', (reason, question) => {
    expect(refusalFor(question)).toBe(reason)
  })
})

/** A seeded random source (mulberry32): the same generated questions on every run. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

const pickFrom = <T,>(next: () => number, items: readonly T[]): T => items[Math.floor(next() * items.length)]!
const HID_ALPHABET = [...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789']
const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

// Read out in groups, a group that reads as a term, a time or an amount ("2FA", "7GB", "3RD", "V2", "5AM", "N725") is one:
// such a code is left to support-api's check against the Health IDs issued.
const READS_AS_A_TERM = /\d(?:FA|GB|MB|KB|TB|HZ|PX|HR|MS|MG|ML|KG|CM|MM|KM|ST|ND|RD|TH|AM|PM)|V\d|N\d/

/** A fictional Health ID of `length` characters from the Health ID alphabet, with a digit and a letter. */
function fictionalHealthId(next: () => number, length: number): string {
  for (;;) {
    const id = Array.from({ length }, () => pickFrom(next, HID_ALPHABET)).join('')
    if (/\d/.test(id) && /[A-Z]/.test(id) && !READS_AS_A_TERM.test(id)) return id
  }
}

const inGroups = (text: string, size: number, between: string) => text.match(new RegExp(`.{1,${size}}`, 'g'))!.join(between)
const digits = (next: () => number, count: number) => Array.from({ length: count }, () => String(Math.floor(next() * 10))).join('')

/** Generated attacks, seeded and fictional: what a person could paste or type, in many shapes, each refused. */
describe('the privacy guard against generated questions', () => {
  it('refuses 400 Health IDs with a digit, as they are printed, pasted, keyed and read out', () => {
    const next = seeded(61)
    const shapes: readonly ((id: string) => string)[] = [
      id => `Why can't I open HID-${id}?`, id => `hid ${id.toLowerCase()} will not load`, id => `Patient ${id} cannot sign in`,
      id => `Her Health ID is ${id}`, id => `${id.toLowerCase()} is her HID`, id => `{"patientHealthId":"${id.toLowerCase()}"}`,
      id => `search?q=hid+${id}`, id => `Open ${inGroups(id, 3, ' ')} for me`, id => `Open ${inGroups(id, 4, '-')} please`,
      id => `HID ${inGroups(id.toLowerCase(), 3, ' ')}`, id => `HID ${inGroups(id, 2, ' . ')}`, id => `H I D ${[...id].join(' ')}`,
      id => `Health ID: ${inGroups(id, 3, '\n')}`, id => `The patient's Health ID is ${id.toLowerCase()} and she can't sign in`,
      id => `HID ${[...id].map(character => /\d/.test(character) ? DIGIT_NAMES[Number(character)] : character).join(' ')}`,
      id => `Health ID number ${inGroups(id, 3, ' - ')}`, id => `| Name | HID |\n| Ada Obi | ${id} |`,
    ]
    // As issued: 6 characters (the demo tenant's 8).
    const questions = Array.from({ length: 400 }, () => pickFrom(next, shapes)(fictionalHealthId(next, pickFrom(next, [6, 6, 6, 8]))))
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it('refuses 300 Health IDs of letters only, as printed or keyed in after a label and a sign', () => {
    const next = seeded(18)
    const shapes: readonly ((id: string) => string)[] = [
      id => `Why can't I open HID-${id}?`, id => `HID ${id} cannot sign in`, id => `Her Health ID is ${id}`, id => `hid: ${id.toLowerCase()}`,
      id => `health_id=${id.toLowerCase()}`, id => `Patient ID: ${id.toLowerCase()}`, id => `ID: ${id.toLowerCase()}`,
      id => `HID number: ${id.toLowerCase()}`, id => `?patientHid=${id.toLowerCase()}`, id => `{"hid":"${id.toLowerCase()}"}`,
      id => `HID for my patient ${id}`, id => `Health ID # ${id}`,
    ]
    const letters = HID_ALPHABET.filter(character => /[A-Z]/.test(character))
    const questions = Array.from({ length: 300 }, () => {
      const id = Array.from({ length: pickFrom(next, [6, 6, 6, 8]) }, () => pickFrom(next, letters)).join('')
      return pickFrom(next, shapes)(id)
    })
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it('refuses 300 phone numbers and NINs, grouped, signed or spelled out', () => {
    const next = seeded(234)
    const between = [' ', '-', '.', '/', ' - ', '  ', ':', '*', '_', '|', ' / ', '--', '·', '–', ' ', ' . ']
    const shapes: readonly ((phone: string, nin: string, sign: string) => string)[] = [
      phone => `Call the patient on ${phone}`, (phone, _, sign) => `Ring ${phone.slice(0, 4)}${sign}${phone.slice(4, 7)}${sign}${phone.slice(7)}`,
      (phone, _, sign) => `Text +234${sign}${phone.slice(1, 4)}${sign}${phone.slice(4, 7)}${sign}${phone.slice(7)}`,
      phone => `(${phone.slice(0, 4)}) ${phone.slice(4, 7)} ${phone.slice(7)}`, phone => `Ring ${[...phone].map(digit => DIGIT_NAMES[Number(digit)]).join(' ')}`,
      phone => `Text ${[...phone].map((digit, at) => at % 2 ? DIGIT_NAMES[Number(digit)] : digit).join(' ')}`,
      (_, nin, sign) => `NIN ${nin.slice(0, 4)}${sign}${nin.slice(4, 8)}${sign}${nin.slice(8)}`, (_, nin) => `Her NIN is ${[...nin].join(' ')}`,
      (phone, _, sign) => `${phone.slice(0, 4)}${sign}${sign}${phone.slice(4)}`, (_, nin) => `The NIN ${nin} is refused`,
    ]
    const questions = Array.from({ length: 300 }, () => {
      const phone = `0${pickFrom(next, ['7', '8', '9'])}${pickFrom(next, ['0', '1'])}${digits(next, 8)}`
      return pickFrom(next, shapes)(phone, digits(next, 11), pickFrom(next, between))
    })
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it('refuses 300 email addresses, with an @, spelled out, defanged or encoded', () => {
    const next = seeded(64)
    const locals = ['ada', 'ada.obi', 'obi_ada', 'ada.obi23', 'nurse.ada', 'a.obi', 'chidi99', 'ngozi-eze']
    const hosts = [['example', 'com'], ['example', 'ng'], ['clinic.example', 'org'], ['mail.example.co', 'uk'], ['gmail', 'com'], ['yahoo', 'com']]
    const shapes: readonly ((local: string, host: string, tld: string) => string)[] = [
      (local, host, tld) => `Add ${local}@${host}.${tld} to my team`, (local, host, tld) => `${local} @ ${host}.${tld}`,
      (local, host, tld) => `${local}@ ${host} . ${tld}`, (local, host, tld) => `Write to ${local} at ${host}.${tld}`,
      (local, host, tld) => `${local} [at] ${host} [dot] ${tld}`, (local, host, tld) => `${local} (at) ${host} (dot) ${tld}`,
      (local, host, tld) => `${local} at ${host} dot ${tld}`, (local, host, tld) => `${local}(a)${host}.${tld}`,
      (local, host, tld) => `${local}&#64;${host}.${tld}`, (local, host, tld) => `${local}%40${host}.${tld}`,
      (local, host, tld) => `${local}＠${host}.${tld}`, (local, host, tld) => `Write to ${local.toUpperCase()} AT ${host.toUpperCase()}.${tld.toUpperCase()}`,
      (local, host, tld) => `${local} "at" ${host} "dot" ${tld}`, (local, host, tld) => `${local} *at* ${host} *dot* ${tld}`,
    ]
    const questions = Array.from({ length: 300 }, () => {
      const [host, tld] = pickFrom(next, hosts)
      return pickFrom(next, shapes)(pickFrom(next, locals), host!, tld!)
    })
    expect(questions.filter(question => !holdsPersonalDetails(question))).toEqual([])
  })

  it('refuses 200 ordinary questions with a character from outside the set, for that character', () => {
    const next = seeded(65)
    const outside = ['а', 'ο', 'Ꭺ', 'ꓸ', '‮', '⁦', 'ⓐ', '①', '\u{1F170}', '\u{1F1E6}', '',
      '͸', 'ː', '⸳', 'օ', 'Ħ', '丨', 'ㅡ', '⎯']
    const questions = Array.from({ length: 200 }, () => {
      const question = pickFrom(next, ['How do I reset my password?', 'HID support hours 9am-5pm?', 'Our HID-Pharmacy page is blank'])
      const at = Math.floor(next() * question.length)
      return question.slice(0, at) + pickFrom(next, outside) + question.slice(at)
    })
    expect(questions.filter(question => refusalFor(question) !== 'characters')).toEqual([])
  })

  it('sends 200 ordinary questions with dates, times, amounts, versions and short numbers', () => {
    const next = seeded(66)
    const number = (low: number, high: number) => low + Math.floor(next() * (high - low + 1))
    const two = (value: number) => String(value).padStart(2, '0')
    const date = () => pickFrom(next, [
      () => `${number(2019, 2027)}-${two(number(1, 12))}-${two(number(1, 28))}`,
      () => `${two(number(1, 28))}/${two(number(1, 12))}/${number(2019, 2027)}`,
      () => `${two(number(1, 28))}.${two(number(1, 12))}.${number(2019, 2027)}`,
    ])()
    const time = () => `${two(number(0, 23))}:${two(number(0, 59))}`
    const amount = () => pickFrom(next, [String(number(100, 99999999)), number(1000, 9999999).toLocaleString('en-US')])
    const shapes: readonly (() => string)[] = [
      () => `Report ${date()} – ${date()} is empty`, () => `Our invoice of ${date()} for NGN ${amount()} is not paid`,
      () => `Health ID was down from ${time()} to ${time()} on ${date()}`, () => `App version ${number(1, 200)}.${number(0, 9)}.${number(1000, 9999)}.${number(1, 300)} will not install`,
      () => `HID support hours ${number(7, 10)}am-${number(4, 7)}pm?`, () => `Rooms ${number(1, 300)}, ${number(1, 300)} and ${number(1, 300)} have no network`,
      () => `Is the fee ₦${amount()} per month?`, () => `I could not sign in on ${date()} ${time()}, why?`,
      () => `Health ID returns error ${number(400, 599)} when I sign in`, () => `My code ${digits(next, 6)} expired`,
    ]
    const questions = Array.from({ length: 200 }, () => pickFrom(next, shapes)())
    expect(questions.filter(question => holdsPersonalDetails(question))).toEqual([])
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
